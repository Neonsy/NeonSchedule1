using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using UnityEngine;

namespace NeonSchedule1.GameDataExporter;

internal static partial class GameDataCollector
{
    internal const string PropertyVisualCaptureRequestFileName =
        "property-visual-capture-request.json";
    internal const string PropertyVisualCaptureResponseFileName =
        "property-visual-capture-response.json";

    private const string PropertyVisualCaptureRequestSchema =
        "neonschedule1-property-visual-capture-request-1";
    private const string PropertyVisualCaptureResponseSchema =
        "neonschedule1-property-visual-capture-response-1";
    private const int MaximumPropertyVisualCaptureRequestBytes = 65_536;
    private const int CaptureWidth = 1_280;
    private const int CaptureHeight = 960;
    private const int MaximumPropertyCount = 64;
    private const float MinimumFootprintSize = 4f;
    private const float CameraElevationDegrees = 32f;
    private const float CapturePadding = 1.18f;
    private const float MinimumOrthographicSize = 5f;

    private static readonly Regex PropertyCodePattern = new(
        "^[a-z0-9][a-z0-9-]{0,63}$",
        RegexOptions.CultureInvariant);

    private static readonly PropertyVisualView[] PropertyVisualViews =
    [
        new("north-east", 45f),
        new("south-east", 135f),
        new("south-west", 225f),
        new("north-west", 315f),
    ];

    internal static bool TryRunPropertyVisualCapture(
        string outputDirectory,
        string exporterVersion,
        Action<string>? progress)
    {
        var requestPath = Path.Combine(outputDirectory, PropertyVisualCaptureRequestFileName);
        if (!File.Exists(requestPath))
        {
            return false;
        }

        var fileLength = new FileInfo(requestPath).Length;
        if (fileLength <= 0 || fileLength > MaximumPropertyVisualCaptureRequestBytes)
        {
            throw new InvalidOperationException(
                $"Property visual capture request must contain 1 to " +
                $"{MaximumPropertyVisualCaptureRequestBytes} bytes.");
        }

        var requestBytes = File.ReadAllBytes(requestPath);
        ValidatePropertyVisualCaptureRequestJson(requestBytes);
        var request = JsonSerializer.Deserialize<PropertyVisualCaptureRequest>(
            requestBytes,
            ExportJson.Options)
            ?? throw new InvalidOperationException("Property visual capture request is empty.");
        ValidatePropertyVisualCaptureRequest(request);
        if (!string.Equals(request.Dataset.GameVersion, Application.version, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Property visual capture request targets game {request.Dataset.GameVersion}, " +
                $"but the loaded game is {Application.version}.");
        }

        progress?.Invoke(
            $"Property visual capture request found. Capturing {request.PropertyCodes.Count} " +
            "properties into private local evidence.");
        var capturedAtUtc = DateTimeOffset.UtcNow;
        var runId = capturedAtUtc.UtcDateTime.ToString(
            "yyyyMMdd'T'HHmmssfff'Z'",
            CultureInfo.InvariantCulture);
        var captureDirectoryName = $"property-visual-captures-{runId}";
        var captureDirectory = Path.Combine(outputDirectory, captureDirectoryName);
        Directory.CreateDirectory(captureDirectory);

        var captures = CaptureRequestedProperties(
            request,
            captureDirectory,
            captureDirectoryName,
            progress);
        var requestHash = Convert.ToHexString(SHA256.HashData(requestBytes)).ToLowerInvariant();
        var response = new PropertyVisualCaptureResponse
        {
            Schema = PropertyVisualCaptureResponseSchema,
            ExporterVersion = exporterVersion,
            CapturedAtUtc = capturedAtUtc,
            GameVersion = Application.version,
            RequestId = request.RequestId,
            RequestSha256 = requestHash,
            DatasetSha256 = request.Dataset.DatasetSha256,
            Captures = captures,
        };
        var responseJson = JsonSerializer.Serialize(response, ExportJson.Options);
        var responsePath = Path.Combine(outputDirectory, PropertyVisualCaptureResponseFileName);
        WriteTextAtomic(responsePath, responseJson);
        var responseHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(responseJson))).ToLowerInvariant();
        WriteTextAtomic(
            responsePath + ".sha256",
            responseHash + Environment.NewLine,
            Encoding.ASCII);
        progress?.Invoke(
            $"Property visual capture complete: {captures.Count} private candidates. " +
            $"Response {responsePath}. SHA-256 {responseHash}");
        return true;
    }

    private static List<PropertyVisualCaptureResult> CaptureRequestedProperties(
        PropertyVisualCaptureRequest request,
        string captureDirectory,
        string captureDirectoryName,
        Action<string>? progress)
    {
        var properties = Il2CppScheduleOne.Property.Property.Properties
            ?? throw new InvalidOperationException("The loaded scene contains no property registry.");
        var propertiesByCode = new Dictionary<
            string,
            Il2CppScheduleOne.Property.Property>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < properties.Count; index++)
        {
            var property = properties[index];
            if (property is null || string.IsNullOrWhiteSpace(property.PropertyCode))
            {
                continue;
            }

            if (!propertiesByCode.TryAdd(property.PropertyCode, property))
            {
                throw new InvalidOperationException(
                    $"The loaded scene contains duplicate property code {property.PropertyCode}.");
            }
        }

        var captureLayer = ResolveCaptureLayer();
        var cameraObject = new GameObject("NeonSchedule1 Property Visual Capture Camera")
        {
            hideFlags = HideFlags.HideAndDontSave,
        };
        var camera = cameraObject.AddComponent<Camera>();
        ConfigureCaptureCamera(camera, captureLayer);
        var results = new List<PropertyVisualCaptureResult>();
        try
        {
            for (var propertyIndex = 0;
                 propertyIndex < request.PropertyCodes.Count;
                 propertyIndex++)
            {
                var propertyCode = request.PropertyCodes[propertyIndex];
                if (!propertiesByCode.TryGetValue(propertyCode, out var property))
                {
                    throw new InvalidOperationException(
                        $"The loaded scene does not contain requested property {propertyCode}.");
                }

                var geometry = ResolvePropertyCaptureGeometry(property);
                var suspendedRenderers = SuspendOtherRenderersOnLayer(
                    property,
                    captureLayer);
                try
                {
                    var layers = MoveHierarchyToLayer(property.gameObject, captureLayer);
                    try
                    {
                        foreach (var view in PropertyVisualViews)
                        {
                            results.Add(CapturePropertyView(
                                camera,
                                property,
                                geometry,
                                view,
                                captureDirectory,
                                captureDirectoryName));
                        }
                    }
                    finally
                    {
                        RestoreLayers(layers);
                    }
                }
                finally
                {
                    RestoreRenderers(suspendedRenderers);
                }

                progress?.Invoke(
                    $"Property visual capture progress: {propertyIndex + 1}/" +
                    $"{request.PropertyCodes.Count} properties.");
            }
        }
        finally
        {
            camera.targetTexture = null;
            UnityEngine.Object.Destroy(cameraObject);
        }

        return results;
    }

    private static PropertyVisualCaptureResult CapturePropertyView(
        Camera camera,
        Il2CppScheduleOne.Property.Property property,
        PropertyCaptureGeometry geometry,
        PropertyVisualView view,
        string captureDirectory,
        string captureDirectoryName)
    {
        var radians = view.YawDegrees * Mathf.Deg2Rad;
        var elevationRadians = CameraElevationDegrees * Mathf.Deg2Rad;
        var horizontalDistance = Math.Max(24f, geometry.HorizontalDiagonal * 2.5f);
        var horizontal = new Vector3(Mathf.Sin(radians), 0f, Mathf.Cos(radians));
        var cameraPosition = geometry.Target +
            horizontal * horizontalDistance +
            Vector3.up * (horizontalDistance * Mathf.Tan(elevationRadians));
        camera.transform.position = cameraPosition;
        camera.transform.rotation = Quaternion.LookRotation(
            geometry.Target - cameraPosition,
            Vector3.up);
        camera.orthographicSize = ResolveOrthographicSize(geometry);
        camera.nearClipPlane = 0.1f;
        camera.farClipPlane = Math.Max(200f, horizontalDistance * 4f);

        var target = RenderTexture.GetTemporary(
            CaptureWidth,
            CaptureHeight,
            24,
            RenderTextureFormat.ARGB32);
        var previous = RenderTexture.active;
        var texture = new Texture2D(CaptureWidth, CaptureHeight, TextureFormat.RGBA32, false);
        try
        {
            camera.targetTexture = target;
            camera.Render();
            RenderTexture.active = target;
            texture.ReadPixels(new Rect(0, 0, CaptureWidth, CaptureHeight), 0, 0);
            texture.Apply(false, false);
            var png = ImageConversion.EncodeToPNG(texture);
            var fileName = $"{property.PropertyCode}-{view.Id}.png";
            var outputPath = Path.Combine(captureDirectory, fileName);
            WriteBytesAtomic(outputPath, png);
            return new PropertyVisualCaptureResult
            {
                PropertyCode = property.PropertyCode,
                PropertyName = property.PropertyName ?? string.Empty,
                View = view.Id,
                RelativePath = $"{captureDirectoryName}/{fileName}",
                Sha256 = Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(),
                Width = CaptureWidth,
                Height = CaptureHeight,
                VisibleRendererCount = geometry.VisibleRendererCount,
                SubjectBoundsCenter = VectorSnapshot3.FromVector(geometry.SubjectBounds.center),
                SubjectBoundsSize = VectorSnapshot3.FromVector(geometry.SubjectBounds.size),
                CameraPosition = VectorSnapshot3.FromVector(cameraPosition),
                CameraTarget = VectorSnapshot3.FromVector(geometry.Target),
            };
        }
        finally
        {
            camera.targetTexture = null;
            RenderTexture.active = previous;
            RenderTexture.ReleaseTemporary(target);
            UnityEngine.Object.Destroy(texture);
        }
    }

    private static PropertyCaptureGeometry ResolvePropertyCaptureGeometry(
        Il2CppScheduleOne.Property.Property property)
    {
        var footprint = ResolvePropertyFootprint(property);
        var horizontalLimit = Math.Max(
            12f,
            Math.Max(footprint.size.x, footprint.size.z) * 1.75f);
        var renderers = property.GetComponentsInChildren<Renderer>(true);
        var minimumY = float.PositiveInfinity;
        var maximumY = float.NegativeInfinity;
        var visibleRendererCount = 0;
        for (var index = 0; index < renderers.Length; index++)
        {
            var renderer = renderers[index];
            if (renderer is null || !renderer.enabled || !renderer.gameObject.activeInHierarchy)
            {
                continue;
            }
            var runtimeType = renderer.GetType().FullName ?? string.Empty;
            if (runtimeType.Contains("Particle", StringComparison.Ordinal) ||
                runtimeType.Contains("Trail", StringComparison.Ordinal) ||
                runtimeType.Contains("Line", StringComparison.Ordinal))
            {
                continue;
            }
            var bounds = renderer.bounds;
            if (!IsFinite(bounds.center) || !IsFinite(bounds.size) ||
                bounds.size.sqrMagnitude <= 1e-6f ||
                Math.Abs(bounds.center.x - footprint.center.x) > horizontalLimit ||
                Math.Abs(bounds.center.z - footprint.center.z) > horizontalLimit ||
                bounds.size.x > horizontalLimit * 3f ||
                bounds.size.z > horizontalLimit * 3f ||
                bounds.size.y > 100f)
            {
                continue;
            }

            minimumY = Math.Min(minimumY, bounds.min.y);
            maximumY = Math.Max(maximumY, bounds.max.y);
            visibleRendererCount++;
        }

        if (!float.IsFinite(minimumY) || !float.IsFinite(maximumY) || maximumY <= minimumY)
        {
            minimumY = footprint.center.y - 1f;
            maximumY = footprint.center.y + 5f;
        }
        var height = Math.Max(4f, maximumY - minimumY);
        var center = new Vector3(
            footprint.center.x,
            (minimumY + maximumY) / 2f,
            footprint.center.z);
        var subjectBounds = new Bounds(
            center,
            new Vector3(
                Math.Max(MinimumFootprintSize, footprint.size.x),
                height,
                Math.Max(MinimumFootprintSize, footprint.size.z)));
        return new PropertyCaptureGeometry
        {
            SubjectBounds = subjectBounds,
            Target = center,
            HorizontalDiagonal = Mathf.Sqrt(
                subjectBounds.size.x * subjectBounds.size.x +
                subjectBounds.size.z * subjectBounds.size.z),
            VisibleRendererCount = visibleRendererCount,
        };
    }

    private static Bounds ResolvePropertyFootprint(Il2CppScheduleOne.Property.Property property)
    {
        var hasBounds = false;
        var footprint = new Bounds();
        if (property.propertyBoundsColliders is not null)
        {
            for (var index = 0; index < property.propertyBoundsColliders.Count; index++)
            {
                var collider = property.propertyBoundsColliders[index];
                if (collider is null || !IsUsableFootprint(collider.bounds))
                {
                    continue;
                }
                if (hasBounds)
                {
                    footprint.Encapsulate(collider.bounds);
                }
                else
                {
                    footprint = collider.bounds;
                    hasBounds = true;
                }
            }
        }

        var boundingCollider = property.BoundingBox?.GetComponent<Collider>();
        if (!hasBounds && boundingCollider is not null && IsUsableFootprint(boundingCollider.bounds))
        {
            footprint = boundingCollider.bounds;
            hasBounds = true;
        }
        if (hasBounds)
        {
            return footprint;
        }

        var hasGridPoint = false;
        var minimum = new Vector3(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
        var maximum = new Vector3(float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity);
        if (property.Grids is not null)
        {
            for (var gridIndex = 0; gridIndex < property.Grids.Count; gridIndex++)
            {
                var pairs = property.Grids[gridIndex]?.CoordinateTilePairs;
                if (pairs is null)
                {
                    continue;
                }
                for (var pairIndex = 0; pairIndex < pairs.Count; pairIndex++)
                {
                    var tile = pairs[pairIndex]?.tile;
                    if (tile is null || !IsFinite(tile.transform.position))
                    {
                        continue;
                    }
                    minimum = Vector3.Min(minimum, tile.transform.position);
                    maximum = Vector3.Max(maximum, tile.transform.position);
                    hasGridPoint = true;
                }
            }
        }
        if (hasGridPoint)
        {
            var center = (minimum + maximum) / 2f;
            var size = maximum - minimum + new Vector3(0.5f, 1f, 0.5f);
            return new Bounds(center, size);
        }

        var fallback = property.InteriorSpawnPoint?.position ??
            property.SpawnPoint?.position ??
            property.transform.position;
        return new Bounds(fallback, new Vector3(10f, 6f, 10f));
    }

    private static bool IsUsableFootprint(Bounds bounds) =>
        IsFinite(bounds.center) && IsFinite(bounds.size) &&
        bounds.size.x >= 1f && bounds.size.z >= 1f &&
        bounds.size.x <= 100f && bounds.size.z <= 100f;

    private static float ResolveOrthographicSize(PropertyCaptureGeometry geometry)
    {
        var elevation = CameraElevationDegrees * Mathf.Deg2Rad;
        var projectedHeight =
            geometry.HorizontalDiagonal * Mathf.Sin(elevation) +
            geometry.SubjectBounds.size.y * Mathf.Cos(elevation);
        var widthLimitedSize = geometry.HorizontalDiagonal / (2f * CaptureWidth / CaptureHeight);
        return Math.Max(
            MinimumOrthographicSize,
            Math.Max(projectedHeight / 2f, widthLimitedSize) * CapturePadding);
    }

    private static void ConfigureCaptureCamera(Camera camera, int captureLayer)
    {
        var source = Camera.main;
        if (source is not null)
        {
            camera.CopyFrom(source);
        }
        camera.enabled = false;
        camera.cullingMask = unchecked(1 << captureLayer);
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
        camera.orthographic = true;
        camera.aspect = (float)CaptureWidth / CaptureHeight;
        camera.allowHDR = false;
        camera.allowMSAA = false;
        camera.useOcclusionCulling = false;
    }

    private static int ResolveCaptureLayer()
    {
        var activeRendererCounts = new int[32];
        var renderers = Resources.FindObjectsOfTypeAll<Renderer>();
        for (var index = 0; index < renderers.Length; index++)
        {
            var renderer = renderers[index];
            if (renderer is not null && renderer.enabled && renderer.gameObject.activeInHierarchy)
            {
                activeRendererCounts[renderer.gameObject.layer]++;
            }
        }
        return Enumerable.Range(24, 8)
            .OrderBy(layer => activeRendererCounts[layer])
            .ThenByDescending(layer => layer)
            .First();
    }

    private static List<Renderer> SuspendOtherRenderersOnLayer(
        Il2CppScheduleOne.Property.Property property,
        int captureLayer)
    {
        var renderers = Resources.FindObjectsOfTypeAll<Renderer>();
        var result = new List<Renderer>();
        for (var index = 0; index < renderers.Length; index++)
        {
            var renderer = renderers[index];
            if (renderer is null || !renderer.enabled || !renderer.gameObject.activeInHierarchy ||
                renderer.gameObject.layer != captureLayer ||
                renderer.transform.IsChildOf(property.transform))
            {
                continue;
            }
            result.Add(renderer);
        }
        var suspendedCount = 0;
        try
        {
            for (; suspendedCount < result.Count; suspendedCount++)
            {
                result[suspendedCount].enabled = false;
            }
        }
        catch
        {
            RestoreRenderers(result.Take(suspendedCount));
            throw;
        }
        return result;
    }

    private static void RestoreRenderers(IEnumerable<Renderer> renderers)
    {
        foreach (var renderer in renderers)
        {
            if (renderer is not null)
            {
                renderer.enabled = true;
            }
        }
    }

    private static List<PropertyVisualOriginalLayer> MoveHierarchyToLayer(
        GameObject root,
        int captureLayer)
    {
        var transforms = root.GetComponentsInChildren<Transform>(true);
        var result = new List<PropertyVisualOriginalLayer>(transforms.Length);
        for (var index = 0; index < transforms.Length; index++)
        {
            var gameObject = transforms[index].gameObject;
            result.Add(new PropertyVisualOriginalLayer(gameObject, gameObject.layer));
        }
        var movedCount = 0;
        try
        {
            for (; movedCount < result.Count; movedCount++)
            {
                result[movedCount].GameObject.layer = captureLayer;
            }
        }
        catch
        {
            RestoreLayers(result.Take(movedCount));
            throw;
        }
        return result;
    }

    private static void RestoreLayers(IEnumerable<PropertyVisualOriginalLayer> layers)
    {
        foreach (var entry in layers)
        {
            if (entry.GameObject is not null)
            {
                entry.GameObject.layer = entry.Layer;
            }
        }
    }

    private static bool IsFinite(Vector3 vector) =>
        float.IsFinite(vector.x) && float.IsFinite(vector.y) && float.IsFinite(vector.z);

    private static void ValidatePropertyVisualCaptureRequestJson(byte[] content)
    {
        using var document = JsonDocument.Parse(content);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Property visual capture request must be an object.");
        }
        var allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            "schema",
            "requestId",
            "dataset",
            "width",
            "height",
            "propertyCodes",
        };
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (!allowed.Remove(property.Name))
            {
                throw new InvalidOperationException(
                    $"Property visual capture request contains unsupported property " +
                    $"{property.Name}.");
            }
        }
        if (allowed.Count != 0)
        {
            throw new InvalidOperationException(
                "Property visual capture request is missing a required property.");
        }
    }

    private static void ValidatePropertyVisualCaptureRequest(PropertyVisualCaptureRequest request)
    {
        if (!string.Equals(
                request.Schema,
                PropertyVisualCaptureRequestSchema,
                StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(request.RequestId) ||
            request.RequestId.Length > 128 ||
            request.RequestId.Contains('\0') ||
            request.Width != CaptureWidth ||
            request.Height != CaptureHeight ||
            request.Dataset is null ||
            string.IsNullOrWhiteSpace(request.Dataset.GameVersion) ||
            !IsLowerSha256(request.Dataset.DatasetSha256) ||
            string.IsNullOrWhiteSpace(request.Dataset.NormalizerVersion) ||
            request.PropertyCodes is null ||
            request.PropertyCodes.Count == 0 ||
            request.PropertyCodes.Count > MaximumPropertyCount)
        {
            throw new InvalidOperationException("Property visual capture request is invalid.");
        }

        var codes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var propertyCode in request.PropertyCodes)
        {
            if (!PropertyCodePattern.IsMatch(propertyCode) || !codes.Add(propertyCode))
            {
                throw new InvalidOperationException(
                    "Property visual capture request contains an invalid or duplicate property code.");
            }
        }
    }

    private static void WriteTextAtomic(
        string outputPath,
        string content,
        Encoding? encoding = null)
    {
        encoding ??= new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        var temporaryPath = outputPath + ".tmp";
        File.WriteAllText(temporaryPath, content, encoding);
        File.Move(temporaryPath, outputPath, overwrite: true);
    }

    private static void WriteBytesAtomic(string outputPath, byte[] content)
    {
        var temporaryPath = outputPath + ".tmp";
        File.WriteAllBytes(temporaryPath, content);
        File.Move(temporaryPath, outputPath, overwrite: true);
    }
}

internal sealed class PropertyVisualCaptureRequest
{
    public string Schema { get; init; } = string.Empty;
    public string RequestId { get; init; } = string.Empty;
    public PropertyVisualCaptureDataset Dataset { get; init; } = new();
    public int Width { get; init; }
    public int Height { get; init; }
    public List<string> PropertyCodes { get; init; } = new();
}

internal sealed class PropertyVisualCaptureDataset
{
    public string GameVersion { get; init; } = string.Empty;
    public string DatasetSha256 { get; init; } = string.Empty;
    public string NormalizerVersion { get; init; } = string.Empty;
}

internal sealed class PropertyVisualCaptureResponse
{
    public string Schema { get; init; } = string.Empty;
    public string ExporterVersion { get; init; } = string.Empty;
    public DateTimeOffset CapturedAtUtc { get; init; }
    public string GameVersion { get; init; } = string.Empty;
    public string RequestId { get; init; } = string.Empty;
    public string RequestSha256 { get; init; } = string.Empty;
    public string DatasetSha256 { get; init; } = string.Empty;
    public List<PropertyVisualCaptureResult> Captures { get; init; } = new();
}

internal sealed class PropertyVisualCaptureResult
{
    public string PropertyCode { get; init; } = string.Empty;
    public string PropertyName { get; init; } = string.Empty;
    public string View { get; init; } = string.Empty;
    public string RelativePath { get; init; } = string.Empty;
    public string Sha256 { get; init; } = string.Empty;
    public int Width { get; init; }
    public int Height { get; init; }
    public int VisibleRendererCount { get; init; }
    public VectorSnapshot3 SubjectBoundsCenter { get; init; } = new();
    public VectorSnapshot3 SubjectBoundsSize { get; init; } = new();
    public VectorSnapshot3 CameraPosition { get; init; } = new();
    public VectorSnapshot3 CameraTarget { get; init; } = new();
}

internal sealed class PropertyCaptureGeometry
{
    public Bounds SubjectBounds { get; init; }
    public Vector3 Target { get; init; }
    public float HorizontalDiagonal { get; init; }
    public int VisibleRendererCount { get; init; }
}

internal readonly record struct PropertyVisualView(string Id, float YawDegrees);

internal readonly record struct PropertyVisualOriginalLayer(GameObject GameObject, int Layer);
