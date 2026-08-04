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
    private static async Task<List<MeshTarget>> LoadTargetsAsync(
        string reportPath,
        ExtractionLog log,
        CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(reportPath);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var meshArray = document.RootElement
            .GetProperty("discovery")
            .GetProperty("visualAssets")
            .GetProperty("meshes");
        var groups = new Dictionary<string, MeshTarget>(StringComparer.Ordinal);
        var unreadableReferences = 0;
        var unnamedReferences = 0;
        foreach (var mesh in meshArray.EnumerateArray())
        {
            if (mesh.GetProperty("canExportGeometry").GetBoolean())
            {
                continue;
            }
            unreadableReferences++;
            var name = mesh.GetProperty("name").GetString() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(name))
            {
                unnamedReferences++;
                continue;
            }

            var target = MeshTarget.FromJson(mesh);
            if (groups.TryGetValue(target.Signature, out var existing))
            {
                existing.AssetReferenceKeys.AddRange(target.AssetReferenceKeys);
                existing.AssetReferenceKeys = existing.AssetReferenceKeys
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
            }
            else
            {
                groups.Add(target.Signature, target);
            }
        }

        if (unnamedReferences > 0)
        {
            log.Write(
                "WARN",
                $"The report has {unnamedReferences} unnamed CPU-unreadable mesh references that cannot be searched by name.");
        }
        var targets = groups.Values
            .OrderBy(target => target.Name, StringComparer.Ordinal)
            .ThenBy(target => target.Signature, StringComparer.Ordinal)
            .ToList();
        log.Write(
            "INFO",
            $"Report contains {unreadableReferences} CPU-unreadable references grouped into " +
            $"{targets.Count} unique mesh signatures.");
        return targets;
    }

    private static async Task<ExtractorManifest> LoadOrCreateManifestAsync(
        string manifestPath,
        ExtractorOptions options,
        string reportHash,
        IReadOnlyCollection<MeshTarget> targets,
        ExtractionLog log,
        CancellationToken cancellationToken)
    {
        if (options.Resume && File.Exists(manifestPath))
        {
            await using var existingStream = File.OpenRead(manifestPath);
            var existing = await JsonSerializer.DeserializeAsync<ExtractorManifest>(
                existingStream,
                JsonOptions,
                cancellationToken);
            if (existing is null)
            {
                throw new InvalidDataException($"Could not deserialize existing manifest: {manifestPath}");
            }
            if (!string.Equals(existing.SourceReportSha256, reportHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The existing manifest belongs to a different game-data report. Use a new output directory.");
            }
            log.Write(
                "INFO",
                $"Resuming manifest with {existing.Entries.Count} entries: {manifestPath}");
            existing.Schema = ManifestSchema;
            existing.ExtractorVersion = ExtractorVersion;
            return existing;
        }

        return new ExtractorManifest
        {
            Schema = ManifestSchema,
            ExtractorVersion = ExtractorVersion,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
            SourceReport = options.ReportPath,
            SourceReportSha256 = reportHash,
            GameDataPath = options.GameDataPath,
            AssetRipperExe = options.AssetRipperExe,
            TargetCount = targets.Count,
            ReferenceCount = targets.Sum(target => target.AssetReferenceKeys.Count),
        };
    }

}
