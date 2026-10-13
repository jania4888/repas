using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.Lettering;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// Phase 3 du lettrage (p3-9) : le service des propositions. Drapeau, chargement + moteur + projection
/// en DTO, limite <c>maxResults</c>, plafond de candidats, fusible de temps et annulation du client.
/// </summary>
public sealed class LetteringSuggestionServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 12, 9, 30, 0, TimeSpan.Zero);

    private readonly string _dbName = $"LetteringSuggestions_{Guid.NewGuid():N}";
    private readonly Guid _periodId;
    private int _nextEntryNumber = 1;

    public LetteringSuggestionServiceTests()
    {
        using var ctx = NewContext();
        var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
        ctx.AccountingPeriods.Add(period);
        ctx.SaveChanges();
        _periodId = period.Id;
    }

    private TenantDbContext NewContext() =>
        new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(_dbName).Options);

    private sealed class Factory(Func<TenantDbContext> create) : ITenantDbContextFactory
    {
        public int Created { get; private set; }

        public TenantDbContext CreateContext()
        {
            Created++;
            return create();
        }
    }

    /// <summary>Horloge figée ; si <c>fireTimersAtOnce</c>, chaque minuterie expire dès sa création.</summary>
    /// <remarks><c>onCreateTimer</c> s'exécute à la création du fusible, juste avant le moteur.</remarks>
    private sealed class TestTimeProvider(bool fireTimersAtOnce, Action? onCreateTimer = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            onCreateTimer?.Invoke();
            if (fireTimersAtOnce)
                callback(state);
            return new NoTimer();
        }

        private sealed class NoTimer : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period) => true;
            public void Dispose() { }
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private LetteringSuggestionService Service(
        bool enabled = true,
        Action<LetteringSuggestionSettings>? configure = null,
        bool fireFuseAtOnce = false,
        Factory? factory = null,
        TimeProvider? timeProvider = null)
    {
        var settings = new AccountingSettings { LetteringSuggestionsEnabled = enabled };
        configure?.Invoke(settings.LetteringSuggestions);
        return new LetteringSuggestionService(
            factory ?? new Factory(NewContext),
            Options.Create(settings),
            NullLogger<LetteringSuggestionService>.Instance,
            timeProvider ?? new TestTimeProvider(fireFuseAtOnce));
    }

    private static GetLetteringLinesQuery Filter(string account = "4111") =>
        new(account, LetteringAccountMatch.Exact, new DateTime(2026, 1, 1), new DateTime(2026, 12, 31),
            LetteringStateFilter.All, null, null, null, null, LetteringSideFilter.All, null, null, null);

    private sealed record SeedOptions
    {
        public decimal Debit { get; init; }
        public decimal Credit { get; init; }
        public DateTime Date { get; init; } = new(2026, 5, 10);
        public string? SourceType { get; init; } = "Manual";
        public Guid? SourceId { get; init; }
        public Guid? ThirdPartyId { get; init; }
        public ThirdPartyKind Kind { get; init; } = ThirdPartyKind.None;
        public string Currency { get; init; } = Money.DefaultCurrency;
        public decimal? ExchangeRate { get; init; }
        public decimal DebitInCurrency { get; init; }
        public decimal CreditInCurrency { get; init; }
        public string Label { get; init; } = "Ligne";
    }

    private Guid Seed(SeedOptions o)
    {
        var entry = JournalEntry.Create(
            _nextEntryNumber++, "JV", o.Date, "Écriture", _periodId, false, o.SourceType, o.SourceId ?? Guid.NewGuid(),
            new[]
            {
                new JournalLineInput("4111", o.Label, o.Debit, o.Credit, o.ThirdPartyId, o.Kind, o.DebitInCurrency, o.CreditInCurrency),
                new JournalLineInput("707", "Contrepartie", o.Credit, o.Debit, null, ThirdPartyKind.None, o.CreditInCurrency, o.DebitInCurrency),
            },
            currency: o.Currency,
            exchangeRate: o.ExchangeRate).Value;
        entry.SetAuditInfo("test", false);
        using var ctx = NewContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == "4111").Id;
    }

    /// <summary>Paires débit/crédit de montants distincts, sans tiers : chacune donne une proposition R5.</summary>
    private void SeedAmountOnlyPairs(int count)
    {
        for (var i = 0; i < count; i++)
        {
            Seed(new SeedOptions { Debit = 100m + i });
            Seed(new SeedOptions { Credit = 100m + i, Date = new DateTime(2026, 5, 20) });
        }
    }

    [Fact]
    public async Task FeatureOff_ReturnsFeatureDisabled_WithoutReadingTheDatabase()
    {
        var factory = new Factory(NewContext);

        var result = await Service(enabled: false, factory: factory).SuggestAsync(Filter(), 50);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.FeatureDisabled, result.Error.Code);
        Assert.Equal(0, factory.Created);
    }

    [Fact]
    public async Task InvoiceAndItsPayment_GiveOneDocumentLinkSuggestion_WithTheThirdPartyName()
    {
        var address = Address.Create("1 rue de la République", "Tunis", "Tunis").Value;
        var email = Email.Create("atlas@lettering.tn").Value;
        var client = Client.Create("Société Atlas", ClientType.Individual, address, email).Value;
        var payment = LetteringCandidateLoaderTests.ClientPayment();
        await using (var ctx = NewContext())
        {
            ctx.Clients.Add(client);
            ctx.Payments.Add(payment);
            await ctx.SaveChangesAsync();
        }

        var invoiceLine = Seed(new SeedOptions
        {
            Debit = 50m, SourceType = AccountingService.SourceInvoice, SourceId = payment.InvoiceId,
            ThirdPartyId = client.Id, Kind = ThirdPartyKind.Client, Label = "Facture FAC-2026-7001",
        });
        var paymentLine = Seed(new SeedOptions
        {
            Credit = 50m, Date = new DateTime(2026, 5, 15), SourceType = AccountingService.SourcePayment,
            SourceId = payment.Id, ThirdPartyId = client.Id, Kind = ThirdPartyKind.Client, Label = "Règlement",
        });

        var result = await Service().SuggestAsync(Filter(), 50);

        Assert.True(result.IsSuccess);
        var dto = result.Value;
        Assert.Equal(1, dto.TotalFound);
        Assert.Equal(1, dto.Returned);
        Assert.Equal(2, dto.CandidateLineCount);
        Assert.False(dto.Truncated);
        Assert.Null(dto.TruncationReason);
        Assert.Equal(Now.UtcDateTime, dto.ComputedAtUtc);

        var s = Assert.Single(dto.Suggestions);
        Assert.Equal("DocumentLink", s.Kind);
        Assert.Equal("Exact", s.Category);
        Assert.Equal("High", s.Confidence);
        Assert.Equal(16, s.Key.Length);
        Assert.Equal("4111", s.AccountNumber);
        Assert.Equal(Money.DefaultCurrency, s.CurrencyCode);
        Assert.Equal(client.Id, s.ThirdPartyId);
        Assert.Equal((int)ThirdPartyKind.Client, s.ThirdPartyKind);
        Assert.Equal("Société Atlas", s.ThirdPartyName);
        Assert.Equal(50m, s.TotalAmount);
        Assert.Equal(0m, s.LocalGap);
        Assert.False(s.HasExchangeDifference);
        Assert.True(s.BulkEligible);
        Assert.Contains(s.Reasons, r => r.Code == "DocumentLink");

        var debit = Assert.Single(s.DebitLines);
        Assert.Equal(invoiceLine, debit.LineId);
        Assert.Equal((50m, 0m, 0m, 0m), (debit.Debit, debit.Credit, debit.DebitInCurrency, debit.CreditInCurrency));
        Assert.Equal("Facture FAC-2026-7001", debit.Label);
        Assert.Equal("JV", debit.JournalCode);
        var credit = Assert.Single(s.CreditLines);
        Assert.Equal(paymentLine, credit.LineId);
        Assert.Equal((0m, 50m), (credit.Debit, credit.Credit));
        Assert.Equal(new DateTime(2026, 5, 15), credit.EntryDate);
    }

    [Fact]
    public async Task MaxResults_LimitsReturnedSuggestions_ButNotTotalFound()
    {
        SeedAmountOnlyPairs(3);

        var result = await Service().SuggestAsync(Filter(), 2);

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value.TotalFound);
        Assert.Equal(2, result.Value.Returned);
        Assert.Equal(2, result.Value.Suggestions.Count);
        Assert.False(result.Value.Truncated);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(1000, 2)]
    public async Task MaxResults_IsBoundedByOneAndMaxSuggestions(int maxResults, int expectedReturned)
    {
        SeedAmountOnlyPairs(3);

        var result = await Service(configure: s => s.MaxSuggestions = 2).SuggestAsync(Filter(), maxResults);

        Assert.Equal(expectedReturned, result.Value.Returned);
        Assert.Equal(3, result.Value.TotalFound);
    }

    [Fact]
    public async Task CandidateCap_IsReportedAsTruncation()
    {
        SeedAmountOnlyPairs(2);

        var result = await Service(configure: s => s.MaxCandidateLines = 3).SuggestAsync(Filter(), 50);

        Assert.True(result.Value.Truncated);
        Assert.Equal(LetteringSuggestionService.ReasonCandidateCap, result.Value.TruncationReason);
        Assert.Equal(3, result.Value.CandidateLineCount);
    }

    [Fact]
    public async Task TimeFuse_GivesAPartialResult_WithoutException()
    {
        SeedAmountOnlyPairs(3);

        var result = await Service(fireFuseAtOnce: true).SuggestAsync(Filter(), 50);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Truncated);
        Assert.Equal("TimeFuse", result.Value.TruncationReason);
        Assert.Equal(6, result.Value.CandidateLineCount);
    }

    [Fact]
    public async Task ClientCancellation_IsPropagated()
    {
        SeedAmountOnlyPairs(1);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Service().SuggestAsync(Filter(), 50, cts.Token));
    }

    /// <summary>
    /// Revue interne p3-9 (Test 3) : le client annule après le chargement, pendant le moteur. Le moteur
    /// voit un jeton annulé et répond « TimeFuse » ; le service doit pourtant lever l'annulation, et
    /// non renvoyer un succès partiel.
    /// </summary>
    [Fact]
    public async Task ClientCancellationDuringTheEngine_IsPropagated_NotReportedAsTimeFuse()
    {
        SeedAmountOnlyPairs(3);
        using var cts = new CancellationTokenSource();
        var service = Service(timeProvider: new TestTimeProvider(fireTimersAtOnce: false, onCreateTimer: cts.Cancel));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.SuggestAsync(Filter(), 50, cts.Token));
    }

    [Fact]
    public async Task ForeignCurrencyPair_WithExchangeDifference_IsNotBulkEligible()
    {
        var debit = Seed(new SeedOptions { Debit = 340m, Currency = "EUR", ExchangeRate = 3.4m, DebitInCurrency = 100m });
        var credit = Seed(new SeedOptions
        {
            Credit = 340.250m, Date = new DateTime(2026, 5, 20), Currency = "EUR", ExchangeRate = 3.4025m, CreditInCurrency = 100m,
        });

        var result = await Service().SuggestAsync(Filter(), 50);

        var s = Assert.Single(result.Value.Suggestions);
        Assert.Equal("EUR", s.CurrencyCode);
        Assert.Equal(100m, s.TotalAmount);
        Assert.True(s.HasExchangeDifference);
        Assert.Equal(-0.25m, s.LocalGap);
        Assert.False(s.BulkEligible);
        Assert.Contains(s.Reasons, r => r.Code == "ExchangeDifference");

        var d = Assert.Single(s.DebitLines);
        Assert.Equal(debit, d.LineId);
        Assert.Equal((340m, 0m, 100m, 0m), (d.Debit, d.Credit, d.DebitInCurrency, d.CreditInCurrency));
        var c = Assert.Single(s.CreditLines);
        Assert.Equal(credit, c.LineId);
        Assert.Equal((0m, 340.25m, 0m, 100m), (c.Debit, c.Credit, c.DebitInCurrency, c.CreditInCurrency));
    }

    [Theory]
    [InlineData(2, false)]
    [InlineData(3, true)]
    public void BulkEligible_DependsOnTheLineCountLimit(int bulkMaxLinesPerGroup, bool expected)
    {
        var lines = new[]
        {
            Candidate(300_000, 0),
            Candidate(-100_000, 1),
            Candidate(-200_000, 2),
        };
        var suggestion = new EngineSuggestion(
            "0123456789abcdef", SuggestionKind.SubsetSum, SuggestionCategory.Multiple, 4, 70, SuggestionConfidence.Medium,
            "4111", Money.DefaultCurrency, null, ThirdPartyKind.None, lines, 300_000, 0,
            new[] { EngineReason.Of(EngineReasonCodes.SubsetSum, ("count", "3")) });

        var dto = LetteringSuggestionService.ToDto(suggestion, new Dictionary<(ThirdPartyKind, Guid), string>(), bulkMaxLinesPerGroup);

        Assert.Equal(expected, dto.BulkEligible);
        Assert.Single(dto.DebitLines);
        Assert.Equal(2, dto.CreditLines.Count);
        Assert.Null(dto.ThirdPartyName);
        Assert.Equal("3", Assert.Single(dto.Reasons).Args["count"]);
    }

    [Theory]
    [InlineData(null, false, null)]
    [InlineData(null, true, "CandidateCap")]
    [InlineData("SearchBudget", false, "SearchBudget")]
    [InlineData("SearchBudget", true, "CandidateCap")]
    [InlineData("TimeFuse", true, "TimeFuse")]
    [InlineData("TimeFuse", false, "TimeFuse")]
    public void TruncationReason_PutsTimeFuseFirst_ThenCandidateCap(string? engineReason, bool capReached, string? expected)
    {
        var output = new LetteringEngineOutput(Array.Empty<EngineSuggestion>(), 0, engineReason is not null, engineReason);

        Assert.Equal(expected, LetteringSuggestionService.TruncationReason(output, capReached));
    }

    private static LetteringCandidate Candidate(long signed, int rank) =>
        new(Guid.NewGuid(), Guid.NewGuid(), 1, "4111", Money.DefaultCurrency, signed, signed, ThirdPartyKind.None, null,
            "Ligne", null, "Écriture", "JV", rank + 1, new DateTime(2026, 5, 10), null, null, rank);
}
