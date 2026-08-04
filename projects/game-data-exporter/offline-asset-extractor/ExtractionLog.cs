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

internal sealed class ExtractionLog : IAsyncDisposable
{
    private readonly object _gate = new();
    private readonly StreamWriter _writer;

    public ExtractionLog(string path)
    {
        _writer = new StreamWriter(
            new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read),
            new UTF8Encoding(false))
        {
            AutoFlush = true,
        };
        Write("INFO", $"NeonSchedule1 Offline Asset Extractor {ProgramVersion()} starting. Log: {path}");
    }

    public void Write(string level, string message)
    {
        var line = $"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz}] [{level}] {message}";
        lock (_gate)
        {
            Console.WriteLine(line);
            _writer.WriteLine(line);
        }
    }

    public ValueTask DisposeAsync() => _writer.DisposeAsync();

    private static string ProgramVersion() =>
        typeof(Program).Assembly.GetName().Version?.ToString() ?? "unknown";
}
