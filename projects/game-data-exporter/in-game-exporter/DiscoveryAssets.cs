using System.Reflection;
using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using Il2CppInterop.Runtime;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.UI;

namespace NeonSchedule1.GameDataExporter;

internal sealed class DiscoveryVisualAssetRegistry
{
    private readonly DiscoveryAssetExporter _assets;
    private readonly Dictionary<string, DiscoveryMeshSnapshot> _meshes =
        new(StringComparer.Ordinal);
    private readonly Dictionary<string, DiscoveryMaterialSnapshot> _materials =
        new(StringComparer.Ordinal);

    internal DiscoveryVisualAssetRegistry(DiscoveryAssetExporter assets)
    {
        _assets = assets;
    }

    internal string RegisterMesh(Mesh mesh)
    {
        var key = $"mesh:{mesh.name}:{mesh.GetInstanceID()}";
        if (!_meshes.ContainsKey(key))
        {
            _meshes[key] = new DiscoveryMeshSnapshot
            {
                AssetReferenceKey = key,
                Name = mesh.name ?? string.Empty,
                IsReadable = mesh.isReadable,
                CanExportGeometry = mesh.isReadable,
                VertexCount = mesh.vertexCount,
                SubMeshCount = mesh.subMeshCount,
                BoundsCenter = VectorSnapshot3.FromVector(mesh.bounds.center),
                BoundsSize = VectorSnapshot3.FromVector(mesh.bounds.size),
                Asset = _assets.ExportMesh(mesh, "meshes", key),
            };
        }

        return key;
    }

    internal string RegisterMaterial(Material material)
    {
        var key = $"material:{material.name}:{material.GetInstanceID()}";
        if (_materials.ContainsKey(key))
        {
            return key;
        }

        var snapshot = new DiscoveryMaterialSnapshot
        {
            AssetReferenceKey = key,
            Name = material.name ?? string.Empty,
            ShaderName = material.shader?.name ?? string.Empty,
            RenderQueue = material.renderQueue,
            MainTextureScale = VectorSnapshot2.FromVector(material.mainTextureScale),
            MainTextureOffset = VectorSnapshot2.FromVector(material.mainTextureOffset),
        };
        if (material.HasProperty("_Color"))
        {
            snapshot.Color = ColorSnapshot.FromColor(material.color);
        }

        var textureNames = material.GetTexturePropertyNames();
        for (var index = 0; index < textureNames.Length; index++)
        {
            var propertyName = textureNames[index];
            var texture = material.GetTexture(propertyName);
            if (texture is null)
            {
                continue;
            }

            var texture2D = texture.TryCast<Texture2D>();
            snapshot.Textures.Add(new DiscoveryMaterialTextureSnapshot
            {
                PropertyName = propertyName,
                AssetReferenceKey = $"texture:{texture.name}:{texture.GetInstanceID()}",
                TextureName = texture.name ?? string.Empty,
                RuntimeType = DiscoveryReflection.RuntimeTypeName(texture),
                Width = texture.width,
                Height = texture.height,
                CanExport = texture2D is not null,
                Asset = _assets.ExportTexture(
                    texture2D,
                    "material-textures",
                    $"{key}-{propertyName}"),
            });
        }

        if (material.shader is not null)
        {
            for (var index = 0; index < material.shader.GetPropertyCount(); index++)
            {
                var propertyName = material.shader.GetPropertyName(index);
                var propertyType = material.shader.GetPropertyType(index).ToString();
                var value = string.Empty;
                try
                {
                    value = propertyType switch
                    {
                        "Color" => DiscoveryReflection.DescribeValue(
                            material.GetColor(propertyName)),
                        "Vector" => DiscoveryReflection.DescribeValue(
                            material.GetVector(propertyName)),
                        "Float" or "Range" => material.GetFloat(propertyName)
                            .ToString("R", CultureInfo.InvariantCulture),
                        "Int" => material.GetInt(propertyName)
                            .ToString(CultureInfo.InvariantCulture),
                        "Texture" => material.GetTexture(propertyName)?.name ?? string.Empty,
                        _ => string.Empty,
                    };
                }
                catch (Exception exception)
                {
                    value = $"error:{exception.GetType().Name}";
                }

                snapshot.ShaderProperties.Add(new DiscoveryShaderPropertySnapshot
                {
                    Name = propertyName,
                    Type = propertyType,
                    Value = value,
                });
            }
        }

        _materials[key] = snapshot;
        return key;
    }

    internal DiscoveryVisualAssetManifestSnapshot CreateSnapshot() => new()
    {
        Meshes = _meshes.Values
            .OrderBy(x => x.AssetReferenceKey, StringComparer.Ordinal)
            .ToList(),
        Materials = _materials.Values
            .OrderBy(x => x.AssetReferenceKey, StringComparer.Ordinal)
            .ToList(),
    };
}

internal sealed class DiscoveryAssetExporter : IDisposable
{
    private readonly string _assetDirectory;
    private readonly string _assetDirectoryName;
    private readonly DiscoveryTextureReadback _textureReadback = new();
    private readonly Dictionary<int, DiscoveryAssetSnapshot> _spriteCache = new();
    private readonly Dictionary<int, DiscoveryAssetSnapshot> _textureCache = new();
    private readonly Dictionary<int, DiscoveryFileAssetSnapshot> _meshCache = new();

    internal DiscoveryAssetExporter(string assetDirectory, string assetDirectoryName)
    {
        _assetDirectory = assetDirectory;
        _assetDirectoryName = assetDirectoryName;
    }

    internal int ExportedAssetCount { get; private set; }

    public void Dispose() => _textureReadback.Dispose();

    internal int CountPhysicalFiles()
    {
        try
        {
            return Directory.Exists(_assetDirectory)
                ? Directory.EnumerateFiles(
                    _assetDirectory,
                    "*",
                    SearchOption.AllDirectories).Count()
                : 0;
        }
        catch
        {
            return 0;
        }
    }

    internal List<string> VerifyExportedAssets()
    {
        var errors = new List<string>();
        var checkedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Verify(string relativePath, string expectedHash)
        {
            if (string.IsNullOrWhiteSpace(relativePath) ||
                !checkedPaths.Add(relativePath))
            {
                return;
            }

            try
            {
                var normalized = relativePath.Replace('/', Path.DirectorySeparatorChar);
                var separatorIndex = normalized.IndexOf(Path.DirectorySeparatorChar);
                var pathBelowAssetDirectory = separatorIndex >= 0
                    ? normalized[(separatorIndex + 1)..]
                    : normalized;
                var absolutePath = Path.Combine(_assetDirectory, pathBelowAssetDirectory);
                if (!File.Exists(absolutePath))
                {
                    errors.Add($"Missing exported asset: {relativePath}");
                    return;
                }

                var actualHash = Convert.ToHexString(
                        SHA256.HashData(File.ReadAllBytes(absolutePath)))
                    .ToLowerInvariant();
                if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add($"Hash mismatch for exported asset: {relativePath}");
                }
            }
            catch (Exception exception)
            {
                errors.Add(
                    $"Could not verify {relativePath}: {exception.GetType().Name}: {exception.Message}");
            }
        }

        foreach (var asset in _spriteCache.Values)
        {
            Verify(asset.RelativePath, asset.Sha256);
        }
        foreach (var asset in _textureCache.Values)
        {
            Verify(asset.RelativePath, asset.Sha256);
        }
        foreach (var asset in _meshCache.Values)
        {
            Verify(asset.RelativePath, asset.Sha256);
        }

        return errors;
    }

    internal DiscoveryAssetSnapshot? ExportSprite(Sprite? sprite, string category, string key)
    {
        if (sprite?.texture is null)
        {
            return null;
        }

        var instanceId = sprite.GetInstanceID();
        if (_spriteCache.TryGetValue(instanceId, out var cached))
        {
            return cached;
        }

        try
        {
            var rect = sprite.rect;
            var width = Math.Max(1, (int)Math.Round(rect.width));
            var height = Math.Max(1, (int)Math.Round(rect.height));
            var source = sprite.texture;
            var bytes = _textureReadback.EncodeToPng(
                source,
                width,
                height,
                new Vector2(rect.width / source.width, rect.height / source.height),
                new Vector2(rect.x / source.width, rect.y / source.height));
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            var safeCategory = SafeSegment(category);
            var safeKey = SafeSegment(key);
            var relativePath = Path.Combine(
                _assetDirectoryName,
                safeCategory,
                $"{safeKey}-{hash[..12]}.png");
            var absolutePath = Path.Combine(
                _assetDirectory,
                safeCategory,
                $"{safeKey}-{hash[..12]}.png");
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);
            File.WriteAllBytes(absolutePath, bytes);
            ExportedAssetCount++;
            var result = new DiscoveryAssetSnapshot
            {
                RelativePath = relativePath.Replace('\\', '/'),
                Sha256 = hash,
                Width = width,
                Height = height,
                SpriteName = sprite.name ?? string.Empty,
            };
            _spriteCache[instanceId] = result;
            return result;
        }
        catch (Exception exception)
        {
            var result = new DiscoveryAssetSnapshot
            {
                SpriteName = sprite.name ?? string.Empty,
                Error = $"{exception.GetType().Name}: {exception.Message}",
            };
            _spriteCache[instanceId] = result;
            return result;
        }
    }

    internal DiscoveryAssetSnapshot? ExportTexture(
        Texture2D? texture,
        string category,
        string key)
    {
        if (texture is null)
        {
            return null;
        }

        var instanceId = texture.GetInstanceID();
        if (_textureCache.TryGetValue(instanceId, out var cached))
        {
            return cached;
        }

        try
        {
            var width = Math.Max(1, texture.width);
            var height = Math.Max(1, texture.height);
            var bytes = _textureReadback.EncodeToPng(texture, width, height);
            var result = WriteImageAsset(
                bytes,
                category,
                key,
                width,
                height,
                texture.name ?? string.Empty);
            _textureCache[instanceId] = result;
            return result;
        }
        catch (Exception exception)
        {
            var result = new DiscoveryAssetSnapshot
            {
                SpriteName = texture.name ?? string.Empty,
                Error = $"{exception.GetType().Name}: {exception.Message}",
            };
            _textureCache[instanceId] = result;
            return result;
        }
    }

    internal DiscoveryFileAssetSnapshot ExportMesh(Mesh mesh, string category, string key)
    {
        var instanceId = mesh.GetInstanceID();
        if (_meshCache.TryGetValue(instanceId, out var cached))
        {
            return cached;
        }

        if (!mesh.isReadable)
        {
            var unreadable = new DiscoveryFileAssetSnapshot
            {
                Name = mesh.name ?? string.Empty,
                MediaType = "model/obj",
                Error = "Mesh is not CPU-readable.",
            };
            _meshCache[instanceId] = unreadable;
            return unreadable;
        }

        try
        {
            var vertices = mesh.vertices;
            var normals = mesh.normals;
            var uv = mesh.uv;
            var triangles = mesh.triangles;
            var hasNormals = normals.Length == vertices.Length;
            var hasUv = uv.Length == vertices.Length;
            var builder = new StringBuilder(vertices.Length * 48);
            builder.Append("o ").AppendLine(SafeSegment(mesh.name ?? key));
            for (var index = 0; index < vertices.Length; index++)
            {
                var vertex = vertices[index];
                builder.AppendFormat(
                    CultureInfo.InvariantCulture,
                    "v {0:R} {1:R} {2:R}\n",
                    vertex.x,
                    vertex.y,
                    vertex.z);
            }

            if (hasUv)
            {
                for (var index = 0; index < uv.Length; index++)
                {
                    builder.AppendFormat(
                        CultureInfo.InvariantCulture,
                        "vt {0:R} {1:R}\n",
                        uv[index].x,
                        uv[index].y);
                }
            }

            if (hasNormals)
            {
                for (var index = 0; index < normals.Length; index++)
                {
                    builder.AppendFormat(
                        CultureInfo.InvariantCulture,
                        "vn {0:R} {1:R} {2:R}\n",
                        normals[index].x,
                        normals[index].y,
                        normals[index].z);
                }
            }

            for (var index = 0; index + 2 < triangles.Length; index += 3)
            {
                var a = triangles[index] + 1;
                var b = triangles[index + 1] + 1;
                var c = triangles[index + 2] + 1;
                if (hasUv && hasNormals)
                {
                    builder.AppendFormat(
                        CultureInfo.InvariantCulture,
                        "f {0}/{0}/{0} {1}/{1}/{1} {2}/{2}/{2}\n",
                        a,
                        b,
                        c);
                }
                else if (hasUv)
                {
                    builder.AppendFormat(
                        CultureInfo.InvariantCulture,
                        "f {0}/{0} {1}/{1} {2}/{2}\n",
                        a,
                        b,
                        c);
                }
                else if (hasNormals)
                {
                    builder.AppendFormat(
                        CultureInfo.InvariantCulture,
                        "f {0}//{0} {1}//{1} {2}//{2}\n",
                        a,
                        b,
                        c);
                }
                else
                {
                    builder.AppendFormat(
                        CultureInfo.InvariantCulture,
                        "f {0} {1} {2}\n",
                        a,
                        b,
                        c);
                }
            }

            var bytes = Encoding.UTF8.GetBytes(builder.ToString());
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            var relativePath = Path.Combine(
                _assetDirectoryName,
                SafeSegment(category),
                $"{SafeSegment(key)}-{hash[..12]}.obj");
            var absolutePath = Path.Combine(
                _assetDirectory,
                SafeSegment(category),
                $"{SafeSegment(key)}-{hash[..12]}.obj");
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);
            File.WriteAllBytes(absolutePath, bytes);
            ExportedAssetCount++;
            var result = new DiscoveryFileAssetSnapshot
            {
                RelativePath = relativePath.Replace('\\', '/'),
                Sha256 = hash,
                ByteLength = bytes.Length,
                Name = mesh.name ?? string.Empty,
                MediaType = "model/obj",
            };
            _meshCache[instanceId] = result;
            return result;
        }
        catch (Exception exception)
        {
            var result = new DiscoveryFileAssetSnapshot
            {
                Name = mesh.name ?? string.Empty,
                MediaType = "model/obj",
                Error = $"{exception.GetType().Name}: {exception.Message}",
            };
            _meshCache[instanceId] = result;
            return result;
        }
    }

    private DiscoveryAssetSnapshot WriteImageAsset(
        byte[] bytes,
        string category,
        string key,
        int width,
        int height,
        string sourceName)
    {
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var safeCategory = SafeSegment(category);
        var safeKey = SafeSegment(key);
        var relativePath = Path.Combine(
            _assetDirectoryName,
            safeCategory,
            $"{safeKey}-{hash[..12]}.png");
        var absolutePath = Path.Combine(
            _assetDirectory,
            safeCategory,
            $"{safeKey}-{hash[..12]}.png");
        Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);
        File.WriteAllBytes(absolutePath, bytes);
        ExportedAssetCount++;
        return new DiscoveryAssetSnapshot
        {
            RelativePath = relativePath.Replace('\\', '/'),
            Sha256 = hash,
            Width = width,
            Height = height,
            SpriteName = sourceName,
        };
    }

    private static string SafeSegment(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var chars = value.Select(character =>
                invalid.Contains(character) || character is '/' or '\\' ? '_' : character)
            .ToArray();
        return new string(chars).Trim().ToLowerInvariant();
    }
}
