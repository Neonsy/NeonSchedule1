using UnityEngine;

namespace NeonSchedule1.GameDataExporter;

internal sealed class DiscoveryTextureReadback : IDisposable
{
    private readonly Dictionary<(int Width, int Height), Texture2D> _readableTextures = new();

    internal byte[] EncodeToPng(
        Texture source,
        int width,
        int height,
        Vector2? scale = null,
        Vector2? offset = null)
    {
        var readable = GetReadableTexture(width, height);
        var target = RenderTexture.GetTemporary(
            width,
            height,
            0,
            RenderTextureFormat.ARGB32);
        var previous = RenderTexture.active;
        try
        {
            if (scale is { } imageScale && offset is { } imageOffset)
            {
                Graphics.Blit(source, target, imageScale, imageOffset);
            }
            else
            {
                Graphics.Blit(source, target);
            }

            RenderTexture.active = target;
            readable.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            readable.Apply(false, false);
            return ImageConversion.EncodeToPNG(readable);
        }
        finally
        {
            RenderTexture.active = previous;
            RenderTexture.ReleaseTemporary(target);
        }
    }

    public void Dispose()
    {
        foreach (var texture in _readableTextures.Values)
        {
            UnityEngine.Object.Destroy(texture);
        }

        _readableTextures.Clear();
    }

    private Texture2D GetReadableTexture(int width, int height)
    {
        var key = (width, height);
        if (!_readableTextures.TryGetValue(key, out var texture))
        {
            texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            _readableTextures.Add(key, texture);
        }

        return texture;
    }
}
