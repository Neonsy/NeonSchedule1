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
    private static void ValidateInputs(ExtractorOptions options)
    {
        if (!File.Exists(options.ReportPath))
        {
            throw new FileNotFoundException("Game-data report not found.", options.ReportPath);
        }
        if (!File.Exists(options.AssetRipperExe))
        {
            throw new FileNotFoundException("AssetRipper executable not found.", options.AssetRipperExe);
        }
        if (!Directory.Exists(options.GameDataPath))
        {
            throw new DirectoryNotFoundException($"Game data folder not found: {options.GameDataPath}");
        }
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = true,
        };
        return new HttpClient(handler)
        {
            Timeout = TimeSpan.FromMinutes(5),
        };
    }

    private static async Task EnsurePortIsFreeAsync(
        HttpClient client,
        Uri baseUri,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            using var response = await client.GetAsync(new Uri(baseUri, "openapi.json"), timeout.Token);
            throw new InvalidOperationException(
                $"Port {baseUri.Port} already hosts an HTTP service. Choose another port.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
        }
        catch (HttpRequestException)
        {
        }
    }

    private static Process StartAssetRipper(string executablePath, int port, string logPath)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add("--headless");
        startInfo.ArgumentList.Add("--port");
        startInfo.ArgumentList.Add(port.ToString(CultureInfo.InvariantCulture));
        startInfo.ArgumentList.Add("--log-path");
        startInfo.ArgumentList.Add(logPath);
        return Process.Start(startInfo)
            ?? throw new InvalidOperationException("AssetRipper did not start.");
    }

    private static async Task WaitForAssetRipperAsync(
        HttpClient client,
        Uri baseUri,
        Process process,
        ExtractionLog log,
        CancellationToken cancellationToken)
    {
        var timer = Stopwatch.StartNew();
        while (timer.Elapsed < TimeSpan.FromSeconds(60))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (process.HasExited)
            {
                throw new InvalidOperationException(
                    $"AssetRipper exited with code {process.ExitCode} before its API became ready.");
            }

            using var attempt = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            attempt.CancelAfter(TimeSpan.FromSeconds(2));
            try
            {
                using var response = await client.GetAsync(new Uri(baseUri, "openapi.json"), attempt.Token);
                if (response.IsSuccessStatusCode)
                {
                    log.Write("INFO", $"AssetRipper API ready after {timer.Elapsed.TotalSeconds:F1}s.");
                    return;
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
            }
            catch (HttpRequestException)
            {
            }
            await Task.Delay(500, cancellationToken);
        }
        throw new TimeoutException("AssetRipper API did not become ready within 60 seconds.");
    }

}
