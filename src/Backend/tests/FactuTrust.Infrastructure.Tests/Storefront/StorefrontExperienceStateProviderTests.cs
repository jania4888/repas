using System.Buffers;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using FactuTrust.Infrastructure.Services.Storefront;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Storefront;

public sealed class StorefrontExperienceStateProviderTests
{
    private const string Legacy = """
        {"schemaVersion":1,"configRevision":"cfg-1","mode":"legacy","catalogVersion":null,"leaseSeconds":50}
        """;
    private static readonly TimeSpan CoordinationTimeout = TimeSpan.FromSeconds(10);
    private readonly ManualTimeProvider _time = new();

    [Fact]
    public void Startup_is_unavailable_list_not_healthy_defaults()
    {
        var state = new StorefrontExperienceStateProvider(_time).GetState();
        AssertClosed(state, StorefrontExperienceSourceHealth.Unavailable);
        Assert.Null(state.LastValidatedRevision);
        Assert.Null(state.LastValidatedSourceHash);
    }

    [Fact]
    public void Successful_read_has_immutable_value_and_hash_of_the_exact_bytes()
    {
        var provider = CreateHealthy();
        var state = provider.GetState();
        Assert.Equal(StorefrontExperienceSourceHealth.Healthy, state.Health);
        Assert.Equal("legacy", state.Configuration.Mode);
        Assert.Equal("cfg-1", state.Configuration.ConfigRevision);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Legacy))).ToLowerInvariant(), state.LastValidatedSourceHash);

        var modifiedCopy = state.Configuration with { Mode = "list" };
        Assert.NotEqual(modifiedCopy, provider.GetState().Configuration);
    }

    [Fact]
    public void Starting_reload_closes_before_any_parse_or_error_callback()
    {
        var provider = CreateHealthy();
        provider.BeginReload();
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
        Assert.Equal("cfg-1", provider.GetState().LastValidatedRevision);
    }

    [Fact]
    public void Missing_or_failed_source_never_reuses_old_favorable_value()
    {
        var provider = CreateHealthy();
        var generation = provider.BeginReload();
        provider.FailReload(generation);
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
        Assert.False(provider.CompleteReload(generation, Encoding.UTF8.GetBytes(Legacy)));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
    }

    public static IEnumerable<object[]> InvalidDocuments()
    {
        foreach (var invalid in new[]
        {
            "", "not json", "null", "[]", "{}", "{", Legacy[..^1],
            Legacy.Replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
            Legacy.Replace("\"schemaVersion\":1", "\"schemaVersion\":1.5"),
            Legacy.Replace("\"schemaVersion\":1,", ""),
            Legacy.Replace("\"configRevision\":\"cfg-1\",", ""),
            Legacy.Replace("\"mode\":\"legacy\",", ""),
            Legacy.Replace("\"catalogVersion\":null,", ""),
            Legacy.Replace(",\"leaseSeconds\":50", ""),
            Legacy.Replace("\"leaseSeconds\":50", "\"leaseSeconds\":\"50\""),
            Legacy.Replace("\"leaseSeconds\":50", "\"leaseSeconds\":1e999"),
            Legacy.Replace("\"leaseSeconds\":50", "\"leaseSeconds\":0"),
            Legacy.Replace("\"leaseSeconds\":50", "\"leaseSeconds\":61"),
            Legacy.Replace("\"mode\":\"legacy\"", "\"mode\":\"Legacy\""),
            Legacy.Replace("\"catalogVersion\":null", "\"catalogVersion\":false"),
            Legacy.Replace("\"configRevision\":\"cfg-1\"", "\"configRevision\":null"),
            Legacy.Replace("\"configRevision\":\"cfg-1\"", "\"configRevision\":\" \""),
            Legacy.Replace("cfg-1", "\\uD800"),
            Legacy.Replace("configRevision", "\\uD800"),
            Legacy.Replace("\"mode\":\"legacy\"", "\"mode\":\"list\",\"mode\":\"legacy\""),
            Legacy.Replace("\"mode\":\"legacy\"", "\"Mode\":\"legacy\""),
            Legacy.Replace("\"mode\":\"legacy\"", "\"mode\":\"legacy\",\"secret\":\"not-public\""),
            Legacy.Replace("\"mode\":\"legacy\"", "\"mode\":[[[[[\"legacy\"]]]]]"),
            Legacy.Replace("\"mode\":\"legacy\"", "\"mode\":/*comment*/\"legacy\""),
            Legacy[..^1] + ",}",
            new string(' ', StorefrontExperienceStateProvider.MaximumDocumentBytes + 1) + Legacy
        })
            yield return new object[] { invalid };
    }

    [Theory]
    [MemberData(nameof(InvalidDocuments))]
    public void Valid_favorable_state_followed_by_invalid_document_is_closed(string document)
    {
        var provider = CreateHealthy();
        var oldHash = provider.GetState().LastValidatedSourceHash;
        Assert.False(provider.CompleteReload(provider.BeginReload(), Encoding.UTF8.GetBytes(document)));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Invalid);
        // Diagnostics survive, but never provide the previous favorable configuration.
        Assert.Equal("cfg-1", provider.GetState().LastValidatedRevision);
        Assert.Equal(oldHash, provider.GetState().LastValidatedSourceHash);
    }

    [Fact]
    public void Invalid_utf8_fails_closed_without_throwing()
    {
        var provider = CreateHealthy();
        var bytes = Encoding.UTF8.GetBytes(Legacy);
        bytes[Array.IndexOf(bytes, (byte)'c', 20)] = 0xff;
        Assert.False(provider.CompleteReload(provider.BeginReload(), bytes));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Invalid);
    }

    [Fact]
    public void Valid_catalog_cannot_admit_without_the_unwired_authorized_delivery_index()
    {
        var provider = CreateHealthy();
        var catalog = Legacy.Replace("\"legacy\"", "\"catalog-v2\"").Replace("null", "\"v4-pilots-r1\"");
        Assert.False(provider.CompleteReload(provider.BeginReload(), Encoding.UTF8.GetBytes(catalog)));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.OutOfSync);
    }

    [Fact]
    public void Fractional_wire_lease_and_document_at_byte_limit_are_accepted()
    {
        var provider = new StorefrontExperienceStateProvider(_time);
        var document = Legacy.Replace("\"leaseSeconds\":50", "\"leaseSeconds\":0.5");
        document = document.PadRight(StorefrontExperienceStateProvider.MaximumDocumentBytes);
        Assert.True(provider.CompleteReload(provider.BeginReload(), Encoding.UTF8.GetBytes(document)));
        Assert.Equal(0.5, provider.GetState().Configuration.LeaseSeconds);
    }

    [Fact]
    public void Old_completions_and_failures_cannot_overwrite_newer_success()
    {
        var provider = CreateHealthy();
        var older = provider.BeginReload();
        var current = provider.BeginReload();
        Assert.True(provider.CompleteReload(current, Encoding.UTF8.GetBytes(Legacy.Replace("cfg-1", "cfg-2"))));
        Assert.False(provider.CompleteReload(older, Encoding.UTF8.GetBytes(Legacy)));
        provider.FailReload(older);
        Assert.Equal(StorefrontExperienceSourceHealth.Healthy, provider.GetState().Health);
        Assert.Equal("cfg-2", provider.GetState().Configuration.ConfigRevision);
    }

    [Fact]
    public void Old_success_cannot_reopen_after_a_newer_failure()
    {
        var provider = CreateHealthy();
        var older = provider.BeginReload();
        provider.FailReload(provider.BeginReload());
        Assert.False(provider.CompleteReload(older, Encoding.UTF8.GetBytes(Legacy)));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
    }

    [Fact]
    public async Task Begin_reload_during_copy_rejects_old_generation_without_consuming_new_pending_reload()
    {
        var provider = CreateHealthy();
        var older = provider.BeginReload();
        var expectedState = provider.GetState();
        long current = 0;

        Assert.False(await CompleteWithPausedCopy(provider, older, () =>
        {
            current = provider.BeginReload();
            AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
        }));

        // The old completion must not publish its candidate or consume the newer pending token.
        Assert.Equal(expectedState, provider.GetState());
        Assert.True(provider.CompleteReload(current, Encoding.UTF8.GetBytes(Legacy.Replace("cfg-1", "cfg-2"))));
        Assert.Equal("cfg-2", provider.GetState().Configuration.ConfigRevision);
    }

    [Fact]
    public async Task Fail_reload_during_copy_rejects_same_generation_after_pending_is_cleared()
    {
        var provider = CreateHealthy();
        var generation = provider.BeginReload();
        var expectedState = provider.GetState();

        Assert.False(await CompleteWithPausedCopy(provider, generation, () => provider.FailReload(generation)));

        // Generation is unchanged: this specifically requires the second pending check.
        Assert.Equal(expectedState, provider.GetState());
        Assert.False(provider.CompleteReload(generation, Encoding.UTF8.GetBytes(Legacy)));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Copy_coordination_does_not_require_the_callers_constrained_context(bool beginNewReload)
    {
        var provider = CreateHealthy();
        var generation = provider.BeginReload();
        var expectedState = provider.GetState();
        using var allowCopyStart = new ManualResetEventSlim(false);
        var context = new DeferredSynchronizationContext();
        var previousContext = SynchronizationContext.Current;
        Task<bool> completion;
        try
        {
            SynchronizationContext.SetSynchronizationContext(context);
            completion = CompleteWithPausedCopy(provider, generation, () =>
            {
                if (beginNewReload)
                    provider.BeginReload();
                else
                    provider.FailReload(generation);
            }, allowCopyStart);
        }
        finally
        {
            SynchronizationContext.SetSynchronizationContext(previousContext);
        }

        // Force CopyStarted to be incomplete when the helper awaits it, avoiding a lucky
        // synchronous completion that could hide a captured-context regression.
        allowCopyStart.Set();
        try
        {
            var finished = await Task.WhenAny(completion, context.PostAttempted).WaitAsync(CoordinationTimeout);
            Assert.Same(completion, finished);
            Assert.False(await completion);
            Assert.False(context.PostAttempted.IsCompleted);
            Assert.Equal(expectedState, provider.GetState());
        }
        finally
        {
            // On regression, dispatch queued callbacks so cleanup never strands the copy.
            context.Resume();
            await completion.WaitAsync(CoordinationTimeout);
        }
    }

    [Fact]
    public void Missing_watchdog_or_lost_event_expires_at_five_seconds()
    {
        var provider = CreateHealthy();
        _time.Advance(TimeSpan.FromMilliseconds(4999));
        Assert.Equal(StorefrontExperienceSourceHealth.Healthy, provider.GetState().Health);
        _time.Advance(TimeSpan.FromMilliseconds(1));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
    }

    [Fact]
    public void Slow_read_counts_from_start_and_cannot_publish_after_check_expiry()
    {
        var provider = CreateHealthy();
        var generation = provider.BeginReload();
        _time.Advance(StorefrontExperienceStateProvider.SourceCheckLifetime);
        Assert.False(provider.CompleteReload(generation, Encoding.UTF8.GetBytes(Legacy)));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
    }

    [Fact]
    public void Duplicate_completion_does_not_renew_the_check_lifetime()
    {
        var provider = new StorefrontExperienceStateProvider(_time);
        var generation = provider.BeginReload();
        Assert.True(provider.CompleteReload(generation, Encoding.UTF8.GetBytes(Legacy)));
        _time.Advance(TimeSpan.FromSeconds(4));
        Assert.False(provider.CompleteReload(generation, Encoding.UTF8.GetBytes(Legacy)));
        _time.Advance(TimeSpan.FromSeconds(1));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
    }

    [Fact]
    public void Real_recheck_of_unchanged_bytes_can_restore_health_after_expiry_or_failure()
    {
        var provider = CreateHealthy();
        _time.Advance(TimeSpan.FromSeconds(6));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
        Assert.True(provider.CompleteReload(provider.BeginReload(), Encoding.UTF8.GetBytes(Legacy)));
        Assert.Equal(StorefrontExperienceSourceHealth.Healthy, provider.GetState().Health);
        provider.FailReload(provider.BeginReload());
        Assert.True(provider.CompleteReload(provider.BeginReload(), Encoding.UTF8.GetBytes(Legacy)));
        Assert.Equal("cfg-1", provider.GetState().Configuration.ConfigRevision);
    }

    [Fact]
    public void Wall_clock_adjustment_does_not_extend_source_health()
    {
        var provider = CreateHealthy();
        _time.UtcNow = _time.UtcNow.AddDays(-1);
        _time.Advance(StorefrontExperienceStateProvider.SourceCheckLifetime);
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Unavailable);
    }

    [Fact]
    public void Explicit_list_is_healthy_but_does_not_disable_the_global_storefront_flag()
    {
        var provider = CreateHealthy();
        Assert.True(provider.CompleteReload(provider.BeginReload(), Encoding.UTF8.GetBytes(Legacy.Replace("legacy", "list"))));
        AssertClosed(provider.GetState(), StorefrontExperienceSourceHealth.Healthy);
    }

    private StorefrontExperienceStateProvider CreateHealthy()
    {
        var provider = new StorefrontExperienceStateProvider(_time);
        Assert.True(provider.CompleteReload(provider.BeginReload(), Encoding.UTF8.GetBytes(Legacy)));
        return provider;
    }

    private static void AssertClosed(StorefrontExperienceState state, StorefrontExperienceSourceHealth health)
    {
        Assert.Equal(health, state.Health);
        Assert.Equal("list", state.Configuration.Mode);
        Assert.Null(state.Configuration.CatalogVersion);
    }

    private static async Task<bool> CompleteWithPausedCopy(
        StorefrontExperienceStateProvider provider, long generation, Action whileCopyPaused,
        ManualResetEventSlim? allowCopyStart = null)
    {
        using var memory = new PausedCopyMemoryManager(
            Encoding.UTF8.GetBytes(Legacy.Replace("cfg-1", "cfg-obsolete")), allowCopyStart);
        var document = memory.Document;
        // The synchronous paused copy must not occupy a shared thread-pool worker.
        var completion = Task.Factory.StartNew(() => provider.CompleteReload(generation, document),
            CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        try
        {
            // ToArray accesses GetSpan only after CompleteReload has left its first lock.
            // Releasing it must not queue behind unrelated tests on xUnit's bounded context.
            await memory.CopyStarted.WaitAsync(CoordinationTimeout).ConfigureAwait(false);
            whileCopyPaused();
        }
        finally
        {
            memory.ReleaseCopy();
            // Join before disposing the wait handle, even if an assertion above fails.
            await completion.WaitAsync(CoordinationTimeout).ConfigureAwait(false);
        }

        return await completion.ConfigureAwait(false);
    }

    private sealed class DeferredSynchronizationContext : SynchronizationContext
    {
        private readonly ConcurrentQueue<(SendOrPostCallback Callback, object? State)> _callbacks = new();
        private readonly TaskCompletionSource _postAttempted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _resumed;

        public Task PostAttempted => _postAttempted.Task;

        public override void Post(SendOrPostCallback callback, object? state)
        {
            _callbacks.Enqueue((callback, state));
            _postAttempted.TrySetResult();
            if (Volatile.Read(ref _resumed) != 0)
                DispatchPending();
        }

        public void Resume()
        {
            Interlocked.Exchange(ref _resumed, 1);
            DispatchPending();
        }

        private void DispatchPending()
        {
            while (_callbacks.TryDequeue(out var work))
                ThreadPool.QueueUserWorkItem(static item => item.Callback(item.State), work, preferLocal: false);
        }
    }

    private sealed class PausedCopyMemoryManager(byte[] bytes, ManualResetEventSlim? allowCopyStart = null) : MemoryManager<byte>
    {
        private readonly TaskCompletionSource _copyStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly ManualResetEventSlim _releaseCopy = new(false);

        // Base Memory would call GetSpan eagerly; CreateMemory leaves it for the actual copy.
        public ReadOnlyMemory<byte> Document => CreateMemory(bytes.Length);
        public Task CopyStarted => _copyStarted.Task;
        public void ReleaseCopy() => _releaseCopy.Set();

        public override Span<byte> GetSpan()
        {
            if (allowCopyStart is not null && !allowCopyStart.Wait(CoordinationTimeout))
                throw new TimeoutException("The test did not allow the document copy to start.");
            _copyStarted.TrySetResult();
            if (!_releaseCopy.Wait(CoordinationTimeout))
                throw new TimeoutException("The test did not release the paused document copy.");
            return bytes;
        }

        public override MemoryHandle Pin(int elementIndex = 0) => throw new NotSupportedException();
        public override void Unpin() => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
                _releaseCopy.Dispose();
        }
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private long _timestamp;
        public DateTimeOffset UtcNow { get; set; } = new(2026, 9, 17, 13, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => UtcNow;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => _timestamp;
        public void Advance(TimeSpan elapsed) => _timestamp += elapsed.Ticks;
    }
}
