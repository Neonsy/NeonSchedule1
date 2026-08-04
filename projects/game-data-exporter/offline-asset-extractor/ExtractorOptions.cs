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

internal sealed class ExtractorOptions
{
    internal const string Usage =
        "Usage: NeonSchedule1.OfflineAssetExtractor " +
        "--report <neonschedule1-game-data.json> --assetripper <AssetRipper.GUI.Free.exe> " +
        "--game-data <Schedule I_Data> --output <directory> " +
        "[--port <0-65535>] [--limit <count>] [--checkpoint <count>] [--no-resume]";

    public required string ReportPath { get; init; }
    public required string AssetRipperExe { get; init; }
    public required string GameDataPath { get; init; }
    public required string OutputDirectory { get; init; }
    public int Port { get; init; }
    public int Limit { get; init; }
    public int CheckpointInterval { get; init; } = 10;
    public bool Resume { get; init; } = true;
    public bool ShowHelp { get; init; }

    public static ExtractorOptions Parse(string[] args)
    {
        if (args.Length == 0 || args.Contains("--help", StringComparer.Ordinal))
        {
            return new ExtractorOptions
            {
                ReportPath = string.Empty,
                AssetRipperExe = string.Empty,
                GameDataPath = string.Empty,
                OutputDirectory = string.Empty,
                ShowHelp = true,
            };
        }

        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var resume = true;
        for (var index = 0; index < args.Length; index++)
        {
            var key = args[index];
            if (string.Equals(key, "--no-resume", StringComparison.Ordinal))
            {
                resume = false;
                continue;
            }
            if (!key.StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length)
            {
                throw new ArgumentException($"Invalid argument: {key}");
            }
            values[key] = args[++index];
        }

        string Required(string key) => values.TryGetValue(key, out var value)
            ? Path.GetFullPath(value)
            : throw new ArgumentException($"Missing required argument: {key}");
        int Integer(string key, int defaultValue, int minimum, int maximum)
        {
            if (!values.TryGetValue(key, out var value))
            {
                return defaultValue;
            }
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var result) ||
                result < minimum ||
                result > maximum)
            {
                throw new ArgumentException(
                    $"{key} must be an integer from {minimum} through {maximum}.");
            }
            return result;
        }

        return new ExtractorOptions
        {
            ReportPath = Required("--report"),
            AssetRipperExe = Required("--assetripper"),
            GameDataPath = Required("--game-data"),
            OutputDirectory = Required("--output"),
            Port = Integer("--port", 0, 0, 65535),
            Limit = Integer("--limit", 0, 0, 1_000_000),
            CheckpointInterval = Integer("--checkpoint", 10, 1, 10_000),
            Resume = resume,
        };
    }
}
