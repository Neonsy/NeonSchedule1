using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace NeonSchedule1.OfflineAssetExtractor;

internal static partial class Program
{
    private const string ExtractorVersion = "0.0.1";
    private const string ManifestSchema = "neonschedule1-offline-mesh-export-1";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly HashSet<string> CompleteStatuses = new(StringComparer.Ordinal)
    {
        "matched",
        "matched-identical-duplicates",
        "ambiguous-variants-preserved",
    };

    public static async Task<int> Main(string[] args)
    {
        ExtractorOptions options;
        try
        {
            options = ExtractorOptions.Parse(args);
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            Console.Error.WriteLine(ExtractorOptions.Usage);
            return 64;
        }

        if (options.ShowHelp)
        {
            Console.WriteLine(ExtractorOptions.Usage);
            return 0;
        }

        Directory.CreateDirectory(options.OutputDirectory);
        await using var log = new ExtractionLog(
            Path.Combine(options.OutputDirectory, "offline-extractor.log"));
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
            log.Write("WARN", "Cancellation requested. Finishing the current operation and saving a checkpoint.");
        };

        Process? assetRipper = null;
        ExtractorManifest? manifest = null;
        var manifestPath = Path.Combine(options.OutputDirectory, "offline-mesh-manifest.json");
        var targetCount = 0;
        try
        {
            ValidateInputs(options);
            var reportHash = await ComputeSha256Async(options.ReportPath, cancellation.Token);
            var targets = await LoadTargetsAsync(options.ReportPath, log, cancellation.Token);
            if (options.Limit > 0)
            {
                targets = targets.Take(options.Limit).ToList();
            }
            targetCount = targets.Count;

            manifest = await LoadOrCreateManifestAsync(
                manifestPath,
                options,
                reportHash,
                targets,
                log,
                cancellation.Token);

            var port = options.Port == 0 ? GetFreeTcpPort() : options.Port;
            var baseUri = new Uri($"http://127.0.0.1:{port}/", UriKind.Absolute);
            using var client = CreateHttpClient();
            await EnsurePortIsFreeAsync(client, baseUri, cancellation.Token);

            var assetRipperLog = Path.Combine(options.OutputDirectory, "assetripper.log");
            assetRipper = StartAssetRipper(options.AssetRipperExe, port, assetRipperLog);
            log.Write(
                "INFO",
                $"Started AssetRipper PID {assetRipper.Id} on {baseUri}. Log: {assetRipperLog}");
            await WaitForAssetRipperAsync(client, baseUri, assetRipper, log, cancellation.Token);

            var loadStarted = Stopwatch.StartNew();
            log.Write("INFO", $"Loading Unity data folder: {options.GameDataPath}");
            using (var form = new FormUrlEncodedContent(new Dictionary<string, string>
                   {
                       ["path"] = options.GameDataPath,
                   }))
            using (var response = await client.PostAsync(
                       new Uri(baseUri, "LoadFolder"),
                       form,
                       cancellation.Token))
            {
                response.EnsureSuccessStatusCode();
            }
            log.Write("INFO", $"AssetRipper load completed in {loadStarted.Elapsed.TotalSeconds:F1}s.");

            var processedThisRun = 0;
            var completedThisRun = 0;
            var batchTimer = Stopwatch.StartNew();
            for (var targetIndex = 0; targetIndex < targets.Count; targetIndex++)
            {
                cancellation.Token.ThrowIfCancellationRequested();
                var target = targets[targetIndex];
                var existing = manifest.Entries.FirstOrDefault(entry =>
                    string.Equals(entry.Signature, target.Signature, StringComparison.Ordinal));
                if (existing is not null &&
                    CompleteStatuses.Contains(existing.Status) &&
                    await ValidateExistingFilesAsync(existing, options.OutputDirectory, cancellation.Token))
                {
                    log.Write(
                        "INFO",
                        $"SKIP {targetIndex + 1}/{targets.Count} {target.Name} " +
                        $"status={existing.Status} files={existing.Files.Count}");
                    continue;
                }

                var itemTimer = Stopwatch.StartNew();
                log.Write(
                    "INFO",
                    $"START {targetIndex + 1}/{targets.Count} {target.Name} " +
                    $"vertices={target.VertexCount} submeshes={target.SubMeshCount} " +
                    $"references={target.AssetReferenceKeys.Count}");

                MeshManifestEntry entry;
                try
                {
                    entry = await ExportTargetAsync(
                        target,
                        client,
                        baseUri,
                        options.OutputDirectory,
                        log,
                        cancellation.Token);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    entry = MeshManifestEntry.FromTarget(target);
                    entry.Status = "error";
                    entry.Error = exception.ToString();
                    log.Write(
                        "ERROR",
                        $"FAIL {targetIndex + 1}/{targets.Count} {target.Name}: " +
                        $"{exception.GetType().Name}: {exception.Message}");
                }

                UpsertEntry(manifest, entry);
                processedThisRun++;
                if (CompleteStatuses.Contains(entry.Status))
                {
                    completedThisRun++;
                }

                var averageSeconds = batchTimer.Elapsed.TotalSeconds / processedThisRun;
                var remainingToProcess = targets.Count - targetIndex - 1;
                var eta = TimeSpan.FromSeconds(Math.Max(0, averageSeconds * remainingToProcess));
                log.Write(
                    CompleteStatuses.Contains(entry.Status) ? "INFO" : "WARN",
                    $"DONE {targetIndex + 1}/{targets.Count} {target.Name} " +
                    $"status={entry.Status} candidates={entry.Candidates.Count} files={entry.Files.Count} " +
                    $"elapsed={itemTimer.Elapsed.TotalSeconds:F1}s eta={FormatDuration(eta)}");

                if (processedThisRun % options.CheckpointInterval == 0)
                {
                    await SaveManifestAsync(
                        manifestPath,
                        manifest,
                        targets.Count,
                        completed: false,
                        cancellation.Token);
                    log.Write(
                        "INFO",
                        $"CHECKPOINT processedThisRun={processedThisRun} " +
                        $"completeThisRun={completedThisRun} manifest={manifestPath}");
                }
            }

            await SaveManifestAsync(
                manifestPath,
                manifest,
                targets.Count,
                completed: true,
                cancellation.Token);

            var unresolved = manifest.Entries.Count(entry => !CompleteStatuses.Contains(entry.Status));
            var complete = manifest.Entries.Count(entry => CompleteStatuses.Contains(entry.Status));
            log.Write(
                unresolved == 0 ? "INFO" : "WARN",
                $"COMPLETE targets={targets.Count} complete={complete} unresolved={unresolved} " +
                $"duration={FormatDuration(batchTimer.Elapsed)} manifest={manifestPath}");
            foreach (var group in manifest.Entries
                         .GroupBy(entry => entry.Status, StringComparer.Ordinal)
                         .OrderBy(group => group.Key, StringComparer.Ordinal))
            {
                log.Write("INFO", $"STATUS {group.Key}={group.Count()}");
            }
            return unresolved == 0 ? 0 : 2;
        }
        catch (OperationCanceledException)
        {
            if (manifest is not null && targetCount > 0)
            {
                try
                {
                    await SaveManifestAsync(
                        manifestPath,
                        manifest,
                        targetCount,
                        completed: false,
                        CancellationToken.None);
                    log.Write("INFO", $"Cancellation checkpoint saved: {manifestPath}");
                }
                catch (Exception exception)
                {
                    log.Write("ERROR", $"Could not save cancellation checkpoint: {exception.Message}");
                }
            }
            log.Write("WARN", "Extraction canceled.");
            return 130;
        }
        catch (Exception exception)
        {
            log.Write("ERROR", exception.ToString());
            return 1;
        }
        finally
        {
            if (assetRipper is not null && !assetRipper.HasExited)
            {
                try
                {
                    assetRipper.Kill(entireProcessTree: true);
                    await assetRipper.WaitForExitAsync();
                    log.Write("INFO", $"Stopped owned AssetRipper PID {assetRipper.Id}.");
                }
                catch (Exception exception)
                {
                    log.Write("WARN", $"Could not stop owned AssetRipper PID {assetRipper.Id}: {exception.Message}");
                }
            }
            assetRipper?.Dispose();
        }
    }

}
