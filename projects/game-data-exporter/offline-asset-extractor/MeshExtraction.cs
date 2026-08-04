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
    private static async Task<MeshManifestEntry> ExportTargetAsync(
        MeshTarget target,
        HttpClient client,
        Uri baseUri,
        string outputDirectory,
        ExtractionLog log,
        CancellationToken cancellationToken)
    {
        var entry = MeshManifestEntry.FromTarget(target);
        var candidates = await FindCandidatesAsync(
            target.Name,
            client,
            baseUri,
            cancellationToken);
        var matching = new List<AssetCandidate>();
        foreach (var candidate in candidates)
        {
            var geometry = await ReadCandidateGeometryAsync(
                candidate,
                client,
                baseUri,
                cancellationToken);
            var matches = GeometryMatches(target, geometry);
            entry.Candidates.Add(new CandidateManifestRecord
            {
                PathId = candidate.PathId,
                Collection = candidate.Collection,
                ViewPath = candidate.ViewPath,
                VertexCount = geometry.VertexCount,
                SubMeshCount = geometry.SubMeshCount,
                BoundsCenter = geometry.BoundsCenter,
                BoundsSize = geometry.BoundsSize,
                MatchesReportSignature = matches,
            });
            if (matches)
            {
                matching.Add(candidate);
            }
        }

        if (matching.Count == 0)
        {
            entry.Status = candidates.Count == 0 ? "not-found" : "signature-mismatch";
            return entry;
        }

        var meshDirectory = Path.Combine(outputDirectory, "meshes");
        Directory.CreateDirectory(meshDirectory);
        var safeName = SafeFileName(target.Name);
        var signatureHash = ShortHash(target.Signature);
        foreach (var candidate in matching)
        {
            var suffix = matching.Count == 1
                ? string.Empty
                : $"-{SafeFileName(candidate.Collection)}-{candidate.PathId}";
            var fileName = $"{safeName}-{signatureHash}{suffix}.glb";
            var filePath = Path.Combine(meshDirectory, fileName);
            var temporaryPath = filePath + ".tmp";
            var modelPath = candidate.ViewPath.Replace(
                "/Assets/View?",
                "/Assets/Model.glb?",
                StringComparison.Ordinal);
            using (var response = await client.GetAsync(
                       new Uri(baseUri, modelPath),
                       HttpCompletionOption.ResponseHeadersRead,
                       cancellationToken))
            {
                response.EnsureSuccessStatusCode();
                await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
                await using var destination = File.Create(temporaryPath);
                await source.CopyToAsync(destination, cancellationToken);
            }
            ValidateGlb(temporaryPath);
            File.Move(temporaryPath, filePath, overwrite: true);
            var fileHash = await ComputeSha256Async(filePath, cancellationToken);
            var relativePath = Path.GetRelativePath(outputDirectory, filePath)
                .Replace('\\', '/');
            entry.Files.Add(new MeshFileManifestRecord
            {
                RelativePath = relativePath,
                ByteLength = new FileInfo(filePath).Length,
                Sha256 = fileHash,
                PathId = candidate.PathId,
                Collection = candidate.Collection,
            });
        }

        var uniqueHashes = entry.Files
            .Select(file => file.Sha256)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        entry.Status = matching.Count == 1
            ? "matched"
            : uniqueHashes == 1
                ? "matched-identical-duplicates"
                : "ambiguous-variants-preserved";
        if (entry.Status == "ambiguous-variants-preserved")
        {
            log.Write(
                "WARN",
                $"Preserved {matching.Count} distinct matching variants for {target.Name}.");
        }
        return entry;
    }

    private static async Task<List<AssetCandidate>> FindCandidatesAsync(
        string name,
        HttpClient client,
        Uri baseUri,
        CancellationToken cancellationToken)
    {
        var query = Uri.EscapeDataString(name);
        var html = await client.GetStringAsync(
            new Uri(baseUri, $"Search/View?q={query}"),
            cancellationToken);
        var candidates = new List<AssetCandidate>();
        foreach (Match rowMatch in MeshRowRegex().Matches(html))
        {
            var match = MeshCandidateRegex().Match(rowMatch.Value);
            if (!match.Success)
            {
                continue;
            }
            var candidateName = WebUtility.HtmlDecode(match.Groups["name"].Value);
            if (!string.Equals(candidateName, name, StringComparison.Ordinal))
            {
                continue;
            }
            candidates.Add(new AssetCandidate
            {
                Name = candidateName,
                PathId = long.Parse(match.Groups["pathId"].Value, CultureInfo.InvariantCulture),
                Collection = WebUtility.HtmlDecode(match.Groups["collection"].Value),
                ViewPath = WebUtility.HtmlDecode(match.Groups["href"].Value),
            });
        }
        return candidates;
    }

    private static async Task<CandidateGeometry> ReadCandidateGeometryAsync(
        AssetCandidate candidate,
        HttpClient client,
        Uri baseUri,
        CancellationToken cancellationToken)
    {
        var jsonPath = candidate.ViewPath.Replace(
            "/Assets/View?",
            "/Assets/Json?",
            StringComparison.Ordinal);
        var json = await client.GetStringAsync(new Uri(baseUri, jsonPath), cancellationToken);
        json = AssetRipperNonFiniteNumberRegex().Replace(json, "0");
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var bounds = root.GetProperty("m_LocalAABB");
        var center = bounds.GetProperty("m_Center");
        var extent = bounds.GetProperty("m_Extent");
        return new CandidateGeometry
        {
            VertexCount = root.GetProperty("m_VertexData").GetProperty("m_VertexCount").GetInt32(),
            SubMeshCount = root.GetProperty("m_SubMeshes").GetArrayLength(),
            BoundsCenter = new Vector3Record
            {
                X = center.GetProperty("m_X").GetDouble(),
                Y = center.GetProperty("m_Y").GetDouble(),
                Z = center.GetProperty("m_Z").GetDouble(),
            },
            BoundsSize = new Vector3Record
            {
                X = extent.GetProperty("m_X").GetDouble() * 2,
                Y = extent.GetProperty("m_Y").GetDouble() * 2,
                Z = extent.GetProperty("m_Z").GetDouble() * 2,
            },
        };
    }

    private static bool GeometryMatches(MeshTarget expected, CandidateGeometry actual) =>
        (actual.VertexCount == expected.VertexCount || actual.VertexCount == 0) &&
        actual.SubMeshCount == expected.SubMeshCount &&
        Near(actual.BoundsCenter.X, expected.BoundsCenter.X) &&
        Near(actual.BoundsCenter.Y, expected.BoundsCenter.Y) &&
        Near(actual.BoundsCenter.Z, expected.BoundsCenter.Z) &&
        Near(actual.BoundsSize.X, expected.BoundsSize.X) &&
        Near(actual.BoundsSize.Y, expected.BoundsSize.Y) &&
        Near(actual.BoundsSize.Z, expected.BoundsSize.Z);

    private static bool Near(double actual, double expected)
    {
        var tolerance = Math.Max(0.00001, Math.Abs(expected) * 0.0001);
        return Math.Abs(actual - expected) <= tolerance;
    }

}
