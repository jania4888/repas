using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FactuTrust.Application.Configuration;

namespace FactuTrust.Infrastructure.Services.Storefront;

public enum StorefrontExperienceSourceHealth
{
    Unavailable,
    Healthy,
    Invalid,
    OutOfSync
}

/// <summary>
/// Internal observation, not an API DTO. Last validated identifiers are diagnostic only;
/// Configuration is always list when the source is not healthy and fresh.
/// </summary>
public sealed record StorefrontExperienceState(
    StorefrontExperienceSourceHealth Health,
    StorefrontExperienceOptions Configuration,
    string? LastValidatedRevision,
    string? LastValidatedSourceHash);

/// <summary>
/// Dormant source-health/validation boundary, not a file watcher or an IOptionsMonitor adapter.
/// Call BeginReload BEFORE reading a source, then CompleteReload or FailReload for that token.
/// A missing signal cannot keep an admission alive beyond the bounded source-check lifetime.
/// </summary>
public sealed class StorefrontExperienceStateProvider
{
    public const int MaximumDocumentBytes = 4096;
    public static readonly TimeSpan SourceCheckLifetime = TimeSpan.FromSeconds(5);

    private static readonly StorefrontExperienceOptions ListFallback = new();
    private static readonly StorefrontExperienceOptionsValidator Validator = new();
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private readonly object _gate = new();
    private readonly TimeProvider _timeProvider;
    private StorefrontExperienceSourceHealth _health = StorefrontExperienceSourceHealth.Unavailable;
    private StorefrontExperienceOptions? _lastValid;
    private string? _lastValidHash;
    private long _generation;
    private long _checkStarted;
    private bool _reloadPending;

    public StorefrontExperienceStateProvider(TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        _timeProvider = timeProvider;
    }

    public StorefrontExperienceState GetState()
    {
        lock (_gate)
        {
            if (_health == StorefrontExperienceSourceHealth.Healthy && !IsCheckFresh())
                _health = StorefrontExperienceSourceHealth.Unavailable;

            return new StorefrontExperienceState(
                _health,
                _health == StorefrontExperienceSourceHealth.Healthy ? _lastValid! : ListFallback,
                _lastValid?.ConfigRevision,
                _lastValidHash);
        }
    }

    /// <summary>Immediately closes admission, including while parsing/binding has not yet completed.</summary>
    public long BeginReload()
    {
        lock (_gate)
        {
            _health = StorefrontExperienceSourceHealth.Unavailable;
            _generation = checked(_generation + 1);
            _checkStarted = _timeProvider.GetTimestamp();
            _reloadPending = true;
            return _generation;
        }
    }

    /// <summary>
    /// Missing source, denied access, I/O or binding/reload exception. A stale failure is ignored.
    /// The caller must not complete with a cached IOptionsMonitor.CurrentValue after a read error.
    /// </summary>
    public void FailReload(long generation)
    {
        lock (_gate)
        {
            if (generation != _generation || !_reloadPending)
                return;

            _health = StorefrontExperienceSourceHealth.Unavailable;
            _reloadPending = false;
        }
    }

    /// <summary>
    /// Consumes one bounded UTF-8 document, never a cached options value. Returns true only on
    /// fresh admission. Late/duplicate completions cannot renew or overwrite a newer generation.
    /// catalog-v2 stays out-of-sync until the subsequent validated delivery-index wiring exists.
    /// </summary>
    public bool CompleteReload(long generation, ReadOnlyMemory<byte> document)
    {
        lock (_gate)
        {
            if (generation != _generation || !_reloadPending)
                return false;
        }

        // Own the bytes: parsing and the diagnostic hash must describe the same candidate.
        var bytes = document.Length <= MaximumDocumentBytes ? document.ToArray() : Array.Empty<byte>();
        var options = Parse(bytes);
        var hash = options is null ? null : Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        lock (_gate)
        {
            if (generation != _generation || !_reloadPending)
                return false;

            _reloadPending = false;
            if (options is null)
            {
                _health = StorefrontExperienceSourceHealth.Invalid;
                return false;
            }

            // Count from check start, not receipt/parse completion. Slow reads do not gain time.
            if (!IsCheckFresh())
            {
                _health = StorefrontExperienceSourceHealth.Unavailable;
                return false;
            }

            if (options.Mode == "catalog-v2")
            {
                _health = StorefrontExperienceSourceHealth.OutOfSync;
                return false;
            }

            _lastValid = options;
            _lastValidHash = hash;
            _health = StorefrontExperienceSourceHealth.Healthy;
            return true;
        }
    }

    private bool IsCheckFresh()
    {
        var elapsed = _timeProvider.GetElapsedTime(_checkStarted);
        return elapsed >= TimeSpan.Zero && elapsed < SourceCheckLifetime;
    }

    private static StorefrontExperienceOptions? Parse(byte[] bytes)
    {
        try
        {
            // JsonDocument may defer decoding string contents until GetString is called.
            StrictUtf8.GetCharCount(bytes);
            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return null;

            var fields = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (property.Name is not ("schemaVersion" or "configRevision" or "mode" or "catalogVersion" or "leaseSeconds")
                    || !fields.Add(property.Name))
                    return null;
            }

            // Missing fields never inherit favorable defaults. No unknown fields are retained.
            if (fields.Count != 5
                || root.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number
                || !root.GetProperty("schemaVersion").TryGetInt32(out var schema)
                || root.GetProperty("configRevision").ValueKind != JsonValueKind.String
                || root.GetProperty("mode").ValueKind != JsonValueKind.String
                || root.GetProperty("catalogVersion").ValueKind is not (JsonValueKind.String or JsonValueKind.Null)
                || root.GetProperty("leaseSeconds").ValueKind != JsonValueKind.Number
                || !root.GetProperty("leaseSeconds").TryGetDouble(out var lease))
                return null;

            var options = new StorefrontExperienceOptions
            {
                SchemaVersion = schema,
                ConfigRevision = root.GetProperty("configRevision").GetString()!,
                Mode = root.GetProperty("mode").GetString()!,
                CatalogVersion = root.GetProperty("catalogVersion").GetString(),
                LeaseSeconds = lease
            };
            return Validator.Validate(null, options).Succeeded ? options : null;
        }
        // GetString/Name can also reject an invalid escaped UTF-16 surrogate lazily.
        catch (Exception exception) when (exception is JsonException or DecoderFallbackException or InvalidOperationException)
        {
            return null;
        }
    }
}
