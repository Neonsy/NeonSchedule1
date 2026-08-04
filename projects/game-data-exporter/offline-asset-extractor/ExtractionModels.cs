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

internal sealed class MeshTarget
{
    public required string Signature { get; init; }
    public required string Name { get; init; }
    public required int VertexCount { get; init; }
    public required int SubMeshCount { get; init; }
    public required Vector3Record BoundsCenter { get; init; }
    public required Vector3Record BoundsSize { get; init; }
    public List<string> AssetReferenceKeys { get; set; } = new();

    public static MeshTarget FromJson(JsonElement mesh)
    {
        var center = Vector3Record.FromJson(mesh.GetProperty("boundsCenter"));
        var size = Vector3Record.FromJson(mesh.GetProperty("boundsSize"));
        var name = mesh.GetProperty("name").GetString() ?? string.Empty;
        var vertexCount = mesh.GetProperty("vertexCount").GetInt32();
        var subMeshCount = mesh.GetProperty("subMeshCount").GetInt32();
        var signature = string.Join(
            '|',
            name,
            vertexCount.ToString(CultureInfo.InvariantCulture),
            subMeshCount.ToString(CultureInfo.InvariantCulture),
            center.X.ToString("R", CultureInfo.InvariantCulture),
            center.Y.ToString("R", CultureInfo.InvariantCulture),
            center.Z.ToString("R", CultureInfo.InvariantCulture),
            size.X.ToString("R", CultureInfo.InvariantCulture),
            size.Y.ToString("R", CultureInfo.InvariantCulture),
            size.Z.ToString("R", CultureInfo.InvariantCulture));
        return new MeshTarget
        {
            Signature = signature,
            Name = name,
            VertexCount = vertexCount,
            SubMeshCount = subMeshCount,
            BoundsCenter = center,
            BoundsSize = size,
            AssetReferenceKeys = new List<string>
            {
                mesh.GetProperty("assetReferenceKey").GetString() ?? string.Empty,
            },
        };
    }
}

internal sealed class ExtractorManifest
{
    public string Schema { get; set; } = string.Empty;
    public string ExtractorVersion { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string SourceReport { get; set; } = string.Empty;
    public string SourceReportSha256 { get; set; } = string.Empty;
    public string GameDataPath { get; set; } = string.Empty;
    public string AssetRipperExe { get; set; } = string.Empty;
    public int TargetCount { get; set; }
    public int ReferenceCount { get; set; }
    public int ProcessedCount { get; set; }
    public Dictionary<string, int> StatusCounts { get; set; } = new(StringComparer.Ordinal);
    public List<MeshManifestEntry> Entries { get; set; } = new();
}

internal sealed class MeshManifestEntry
{
    public string Signature { get; set; } = string.Empty;
    public List<string> AssetReferenceKeys { get; set; } = new();
    public string Name { get; set; } = string.Empty;
    public int VertexCount { get; set; }
    public int SubMeshCount { get; set; }
    public Vector3Record BoundsCenter { get; set; } = new();
    public Vector3Record BoundsSize { get; set; } = new();
    public string Status { get; set; } = "pending";
    public List<CandidateManifestRecord> Candidates { get; set; } = new();
    public List<MeshFileManifestRecord> Files { get; set; } = new();
    public string Error { get; set; } = string.Empty;

    public static MeshManifestEntry FromTarget(MeshTarget target) => new()
    {
        Signature = target.Signature,
        AssetReferenceKeys = target.AssetReferenceKeys,
        Name = target.Name,
        VertexCount = target.VertexCount,
        SubMeshCount = target.SubMeshCount,
        BoundsCenter = target.BoundsCenter,
        BoundsSize = target.BoundsSize,
    };
}

internal sealed class CandidateManifestRecord
{
    public long PathId { get; set; }
    public string Collection { get; set; } = string.Empty;
    public string ViewPath { get; set; } = string.Empty;
    public int VertexCount { get; set; }
    public int SubMeshCount { get; set; }
    public Vector3Record BoundsCenter { get; set; } = new();
    public Vector3Record BoundsSize { get; set; } = new();
    public bool MatchesReportSignature { get; set; }
}

internal sealed class MeshFileManifestRecord
{
    public string RelativePath { get; set; } = string.Empty;
    public long ByteLength { get; set; }
    public string Sha256 { get; set; } = string.Empty;
    public long PathId { get; set; }
    public string Collection { get; set; } = string.Empty;
}

internal sealed class AssetCandidate
{
    public string Name { get; init; } = string.Empty;
    public long PathId { get; init; }
    public string Collection { get; init; } = string.Empty;
    public string ViewPath { get; init; } = string.Empty;
}

internal sealed class CandidateGeometry
{
    public int VertexCount { get; init; }
    public int SubMeshCount { get; init; }
    public Vector3Record BoundsCenter { get; init; } = new();
    public Vector3Record BoundsSize { get; init; } = new();
}

internal sealed class Vector3Record
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }

    public static Vector3Record FromJson(JsonElement element) => new()
    {
        X = element.GetProperty("x").GetDouble(),
        Y = element.GetProperty("y").GetDouble(),
        Z = element.GetProperty("z").GetDouble(),
    };
}
