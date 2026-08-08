using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using UnityEngine;

namespace NeonSchedule1.GameDataExporter;

internal static partial class GameDataCollector
{
    internal const string NativeConvexValidationRequestFileName =
        "native-convex-validation-request.json";
    internal const string NativeConvexValidationResponseFileName =
        "native-convex-validation-response.json";

    private const string NativeConvexValidationRequestSchema =
        "neonschedule1-native-convex-validation-request-1";
    private const string NativeConvexValidationResponseSchema =
        "neonschedule1-native-convex-validation-response-1";
    private const int MaximumConvexRequestBytes = 4_194_304;
    private const int MaximumConvexCases = 128;
    private const int MaximumConvexRays = 2_048;

    internal static bool TryRunNativeConvexValidation(
        string outputDirectory,
        string exporterVersion,
        Action<string> progress)
    {
        var requestPath = Path.Combine(outputDirectory, NativeConvexValidationRequestFileName);
        if (!File.Exists(requestPath))
        {
            return false;
        }

        var fileLength = new FileInfo(requestPath).Length;
        if (fileLength <= 0 || fileLength > MaximumConvexRequestBytes)
        {
            throw new InvalidOperationException(
                $"Native convex validation request must contain 1 to " +
                $"{MaximumConvexRequestBytes} bytes.");
        }

        progress($"Native convex validation request found at {requestPath}");
        var requestBytes = File.ReadAllBytes(requestPath);
        var request = JsonSerializer.Deserialize<NativeConvexValidationRequest>(
            requestBytes,
            ExportJson.Options)
            ?? throw new InvalidOperationException("Native convex validation request is empty.");
        ValidateConvexRequest(request);
        if (!string.Equals(request.Dataset.GameVersion, Application.version, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Native convex validation request targets game {request.Dataset.GameVersion}, " +
                $"but the running game is {Application.version}.");
        }

        var results = request.Cases.Select(EvaluateConvexCase).ToList();
        var requestHash = Convert.ToHexString(SHA256.HashData(requestBytes)).ToLowerInvariant();
        var response = new NativeConvexValidationResponse
        {
            Schema = NativeConvexValidationResponseSchema,
            ExporterVersion = exporterVersion,
            EvaluatedAtUtc = DateTimeOffset.UtcNow,
            GameVersion = Application.version,
            RequestSha256 = requestHash,
            Cases = results,
        };
        var json = JsonSerializer.Serialize(response, ExportJson.Options);
        var responsePath = Path.Combine(outputDirectory, NativeConvexValidationResponseFileName);
        WriteAtomic(responsePath, json, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        var responseHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))
            .ToLowerInvariant();
        WriteAtomic(responsePath + ".sha256", responseHash + Environment.NewLine, Encoding.ASCII);
        progress(
            $"Native convex validation complete: {results.Count} colliders and " +
            $"{results.Sum(result => result.Rays.Count)} rays. Response {responsePath}. " +
            $"SHA-256 {responseHash}");
        return true;
    }

    private static NativeConvexValidationResult EvaluateConvexCase(
        NativeConvexValidationCase testCase)
    {
        var collider = ResolveConvexCollider(testCase);
        var results = testCase.Rays.Select(ray =>
        {
            var origin = ToVector(ray.Origin);
            var direction = ToVector(ray.Direction);
            var hit = collider.Raycast(
                new Ray(origin, direction),
                out var hitInfo,
                ray.MaxDistance);
            return new NativeConvexValidationRayResult
            {
                Id = ray.Id,
                Hit = hit,
                Point = hit ? VectorSnapshot3.FromVector(hitInfo.point) : null,
                Normal = hit ? VectorSnapshot3.FromVector(hitInfo.normal) : null,
                Distance = hit ? hitInfo.distance : null,
            };
        }).ToList();
        return new NativeConvexValidationResult
        {
            Id = testCase.Id,
            PropertyCode = testCase.PropertyCode,
            SurfaceId = testCase.SurfaceId,
            ColliderPath = testCase.ColliderPath,
            MeshName = collider.sharedMesh?.name ?? string.Empty,
            CookingOptions = (int)collider.cookingOptions,
            CookingOptionsName = collider.cookingOptions.ToString(),
            Rays = results,
        };
    }

    private static MeshCollider ResolveConvexCollider(NativeConvexValidationCase testCase)
    {
        var properties = Il2CppScheduleOne.Property.Property.Properties
            ?? throw new InvalidOperationException("Property registry is unavailable after load.");
        Il2CppScheduleOne.Property.Property? property = null;
        for (var index = 0; index < properties.Count; index++)
        {
            var candidate = properties[index];
            if (candidate is not null && string.Equals(
                    candidate.PropertyCode,
                    testCase.PropertyCode,
                    StringComparison.Ordinal))
            {
                property = candidate;
                break;
            }
        }
        if (property is null)
        {
            throw new InvalidOperationException(
                $"Convex validation case '{testCase.Id}' has unknown property " +
                $"'{testCase.PropertyCode}'.");
        }

        var matches = new List<MeshCollider>();
        var surfaces = property.GetComponentsInChildren<Il2CppScheduleOne.Building.Surface>(true);
        for (var surfaceIndex = 0; surfaceIndex < surfaces.Length; surfaceIndex++)
        {
            var surface = surfaces[surfaceIndex];
            if (surface is null || !string.Equals(
                    SurfaceId(surface),
                    testCase.SurfaceId,
                    StringComparison.Ordinal))
            {
                continue;
            }
            var colliders = surface.GetComponentsInChildren<MeshCollider>(true);
            for (var colliderIndex = 0; colliderIndex < colliders.Length; colliderIndex++)
            {
                var collider = colliders[colliderIndex];
                var owner = collider?.GetComponentInParent<Il2CppScheduleOne.Building.Surface>();
                if (collider is null || owner is null ||
                    owner.GetInstanceID() != surface.GetInstanceID() ||
                    !string.Equals(
                        DiscoveryReflection.ObjectPath(collider.transform),
                        testCase.ColliderPath,
                        StringComparison.Ordinal) ||
                    !string.Equals(
                        collider.sharedMesh?.name ?? string.Empty,
                        testCase.MeshName,
                        StringComparison.Ordinal))
                {
                    continue;
                }
                matches.Add(collider);
            }
        }
        if (matches.Count != 1)
        {
            throw new InvalidOperationException(
                $"Convex validation case '{testCase.Id}' resolved {matches.Count} colliders.");
        }
        var result = matches[0];
        if (!result.enabled || result.isTrigger || !result.convex || result.sharedMesh is null)
        {
            throw new InvalidOperationException(
                $"Convex validation case '{testCase.Id}' resolved an unavailable collider.");
        }
        return result;
    }

    private static string SurfaceId(Il2CppScheduleOne.Building.Surface surface)
    {
        var guid = surface.GUID.ToString();
        return string.IsNullOrEmpty(guid) ||
            string.Equals(guid, "00000000-0000-0000-0000-000000000000", StringComparison.Ordinal)
            ? $"path:{DiscoveryReflection.ObjectPath(surface.transform)}"
            : guid;
    }

    private static void ValidateConvexRequest(NativeConvexValidationRequest request)
    {
        if (!string.Equals(
                request.Schema,
                NativeConvexValidationRequestSchema,
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Unsupported native convex validation request schema '{request.Schema}'.");
        }
        if (request.Dataset is null || string.IsNullOrWhiteSpace(request.Dataset.GameVersion) ||
            !IsLowerSha256(request.Dataset.DatasetSha256) ||
            string.IsNullOrWhiteSpace(request.Dataset.NormalizerVersion) ||
            request.Cases is null || request.Cases.Count == 0 ||
            request.Cases.Count > MaximumConvexCases)
        {
            throw new InvalidOperationException("Native convex validation request identity is invalid.");
        }

        var caseIds = new HashSet<string>(StringComparer.Ordinal);
        var rayCount = 0;
        foreach (var testCase in request.Cases)
        {
            if (testCase is null || string.IsNullOrWhiteSpace(testCase.Id) ||
                !caseIds.Add(testCase.Id) || string.IsNullOrWhiteSpace(testCase.PropertyCode) ||
                string.IsNullOrWhiteSpace(testCase.SurfaceId) ||
                string.IsNullOrWhiteSpace(testCase.ColliderPath) ||
                string.IsNullOrWhiteSpace(testCase.MeshName) ||
                testCase.Rays is null || testCase.Rays.Count == 0)
            {
                throw new InvalidOperationException(
                    "Native convex validation request contains an invalid case.");
            }
            var rayIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var ray in testCase.Rays)
            {
                rayCount++;
                if (ray is null || string.IsNullOrWhiteSpace(ray.Id) || !rayIds.Add(ray.Id) ||
                    !IsFinite(ray.Origin) || !IsFinite(ray.Direction) ||
                    !IsFinite(ray.ExpectedPoint) || !float.IsFinite(ray.MaxDistance) ||
                    ray.MaxDistance <= 0 ||
                    Math.Abs(ToVector(ray.Direction).magnitude - 1f) > 1e-4f)
                {
                    throw new InvalidOperationException(
                        "Native convex validation request contains an invalid ray.");
                }
            }
        }
        if (rayCount > MaximumConvexRays)
        {
            throw new InvalidOperationException(
                $"Native convex validation request contains {rayCount} rays, maximum " +
                $"{MaximumConvexRays}.");
        }
    }

    private static bool IsLowerSha256(string value) =>
        value.Length == 64 && value.All(character =>
            Uri.IsHexDigit(character) && !char.IsUpper(character));

    private static bool IsFinite(VectorSnapshot3? value) => value is not null &&
        float.IsFinite(value.X) && float.IsFinite(value.Y) && float.IsFinite(value.Z);

    private static Vector3 ToVector(VectorSnapshot3 value) => new(value.X, value.Y, value.Z);
}

internal sealed class NativeConvexValidationRequest
{
    public string Schema { get; init; } = string.Empty;
    public NativeConvexValidationDataset Dataset { get; init; } = new();
    public List<NativeConvexValidationCase> Cases { get; init; } = new();
}

internal sealed class NativeConvexValidationDataset
{
    public string GameVersion { get; init; } = string.Empty;
    public string DatasetSha256 { get; init; } = string.Empty;
    public string NormalizerVersion { get; init; } = string.Empty;
}

internal sealed class NativeConvexValidationCase
{
    public string Id { get; init; } = string.Empty;
    public string PropertyCode { get; init; } = string.Empty;
    public string SurfaceId { get; init; } = string.Empty;
    public string ColliderPath { get; init; } = string.Empty;
    public string MeshName { get; init; } = string.Empty;
    public List<NativeConvexValidationRay> Rays { get; init; } = new();
}

internal sealed class NativeConvexValidationRay
{
    public string Id { get; init; } = string.Empty;
    public VectorSnapshot3 Origin { get; init; } = new();
    public VectorSnapshot3 Direction { get; init; } = new();
    public float MaxDistance { get; init; }
    public VectorSnapshot3 ExpectedPoint { get; init; } = new();
}

internal sealed class NativeConvexValidationResponse
{
    public string Schema { get; init; } = string.Empty;
    public string ExporterVersion { get; init; } = string.Empty;
    public DateTimeOffset EvaluatedAtUtc { get; init; }
    public string GameVersion { get; init; } = string.Empty;
    public string RequestSha256 { get; init; } = string.Empty;
    public List<NativeConvexValidationResult> Cases { get; init; } = new();
}

internal sealed class NativeConvexValidationResult
{
    public string Id { get; init; } = string.Empty;
    public string PropertyCode { get; init; } = string.Empty;
    public string SurfaceId { get; init; } = string.Empty;
    public string ColliderPath { get; init; } = string.Empty;
    public string MeshName { get; init; } = string.Empty;
    public int CookingOptions { get; init; }
    public string CookingOptionsName { get; init; } = string.Empty;
    public List<NativeConvexValidationRayResult> Rays { get; init; } = new();
}

internal sealed class NativeConvexValidationRayResult
{
    public string Id { get; init; } = string.Empty;
    public bool Hit { get; init; }
    public VectorSnapshot3? Point { get; init; }
    public VectorSnapshot3? Normal { get; init; }
    public float? Distance { get; init; }
}
