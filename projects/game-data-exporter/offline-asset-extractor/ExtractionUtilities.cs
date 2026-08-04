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
    private static async Task<bool> ValidateExistingFilesAsync(
        MeshManifestEntry entry,
        string outputDirectory,
        CancellationToken cancellationToken)
    {
        if (entry.Files.Count == 0)
        {
            return false;
        }
        foreach (var file in entry.Files)
        {
            var path = Path.Combine(outputDirectory, file.RelativePath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(path) || new FileInfo(path).Length != file.ByteLength)
            {
                return false;
            }
            ValidateGlb(path);
            var hash = await ComputeSha256Async(path, cancellationToken);
            if (!string.Equals(hash, file.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }
        return true;
    }

    private static void ValidateGlb(string path)
    {
        using var stream = File.OpenRead(path);
        Span<byte> header = stackalloc byte[4];
        if (stream.Read(header) != header.Length ||
            !header.SequenceEqual("glTF"u8))
        {
            throw new InvalidDataException($"AssetRipper returned a non-GLB payload: {path}");
        }
    }

    private static void UpsertEntry(ExtractorManifest manifest, MeshManifestEntry entry)
    {
        var index = manifest.Entries.FindIndex(existing =>
            string.Equals(existing.Signature, entry.Signature, StringComparison.Ordinal));
        if (index >= 0)
        {
            manifest.Entries[index] = entry;
        }
        else
        {
            manifest.Entries.Add(entry);
        }
        manifest.Entries = manifest.Entries
            .OrderBy(existing => existing.Name, StringComparer.Ordinal)
            .ThenBy(existing => existing.Signature, StringComparer.Ordinal)
            .ToList();
    }

    private static async Task SaveManifestAsync(
        string manifestPath,
        ExtractorManifest manifest,
        int targetCount,
        bool completed,
        CancellationToken cancellationToken)
    {
        manifest.UpdatedAtUtc = DateTimeOffset.UtcNow;
        manifest.CompletedAtUtc = completed ? DateTimeOffset.UtcNow : null;
        manifest.TargetCount = targetCount;
        manifest.ProcessedCount = manifest.Entries.Count;
        manifest.StatusCounts = manifest.Entries
            .GroupBy(entry => entry.Status, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
        var temporaryPath = manifestPath + ".tmp";
        await using (var stream = File.Create(temporaryPath))
        {
            await JsonSerializer.SerializeAsync(
                stream,
                manifest,
                JsonOptions,
                cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        File.Move(temporaryPath, manifestPath, overwrite: true);
    }

    private static async Task<string> ComputeSha256Async(
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static int GetFreeTcpPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        try
        {
            listener.Start();
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }

    private static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var safe = new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray())
            .Trim();
        if (string.IsNullOrWhiteSpace(safe))
        {
            safe = "unnamed-mesh";
        }
        return safe.Length <= 80 ? safe : safe[..80];
    }

    private static string ShortHash(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(hash).ToLowerInvariant()[..12];
    }

    private static string FormatDuration(TimeSpan value) =>
        value.TotalHours >= 1
            ? $"{(int)value.TotalHours}h{value.Minutes:D2}m"
            : value.TotalMinutes >= 1
                ? $"{(int)value.TotalMinutes}m{value.Seconds:D2}s"
                : $"{value.TotalSeconds:F0}s";

    [GeneratedRegex("<tr data-class=\"Mesh\">.*?</tr>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex MeshRowRegex();

    [GeneratedRegex(
        "<td>(?<pathId>-?\\d+)</td><td>Mesh</td><td><a href=\"(?<href>/Assets/View\\?Path=[^\"]+)\"[^>]*>(?<name>.*?)</a></td><td><a[^>]*>(?<collection>.*?)</a>",
        RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex MeshCandidateRegex();

    [GeneratedRegex("(?<![\"A-Za-z0-9_])(?:[+-]?Infinity|NaN)(?![\"A-Za-z0-9_])", RegexOptions.CultureInvariant)]
    private static partial Regex AssetRipperNonFiniteNumberRegex();
}
