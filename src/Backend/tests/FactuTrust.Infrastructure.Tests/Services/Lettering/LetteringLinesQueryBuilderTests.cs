using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.Lettering;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// Phase 3 du lettrage (p3-2) : le constructeur de requête extrait de
/// <see cref="LetteringQueryService"/> garde son comportement (brouillons en paramètre, états,
/// compte exact ou préfixe, bornes de dates inclusives) ; le résolveur de noms de tiers extrait
/// rend les mêmes noms. Les tests existants de <c>LetteringQueryServiceTests</c> restent la garde
/// principale de l'écran.
/// </summary>
public sealed class LetteringLinesQueryBuilderTests
{
    private readonly string _dbName = $"LetteringQB_{Guid.NewGuid():N}";
    private readonly Guid _periodId;

    public LetteringLinesQueryBuilderTests()
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
        public TenantDbContext CreateContext() => create();
    }

    private static GetLetteringLinesQuery Query(
        string account = "4111",
        LetteringAccountMatch match = LetteringAccountMatch.Exact,
        LetteringStateFilter state = LetteringStateFilter.All,
        DateTime? from = null, DateTime? to = null) =>
        new(account, match, from ?? new DateTime(2026, 1, 1), to ?? new DateTime(2026, 12, 31), state,
            null, null, null, null, LetteringSideFilter.All, null, null, null);

    private Guid Seed(int number, string account, decimal debit, decimal credit, DateTime? date = null,
        JournalEntryStatus status = JournalEntryStatus.Validee, Guid? thirdPartyId = null,
        ThirdPartyKind kind = ThirdPartyKind.None)
    {
        var entry = JournalEntry.Create(
            number, "JV", date ?? new DateTime(2026, 5, 10), $"Écriture {number}", _periodId, false, "Manual", Guid.NewGuid(),
            new[]
            {
                new JournalLineInput(account, "Ligne", debit, credit, thirdPartyId, kind),
                new JournalLineInput("707", "Contrepartie", credit, debit, null, ThirdPartyKind.None),
            },
            initialStatus: status).Value;
        entry.SetAuditInfo("test", false);
        using var ctx = NewContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == account).Id;
    }

    private async Task<HashSet<Guid>> IdsAsync(GetLetteringLinesQuery query, bool showDrafts)
    {
        await using var ctx = NewContext();
        return (await LetteringLinesQueryBuilder.Build(ctx, query, showDrafts).Select(l => l.Id).ToListAsync()).ToHashSet();
    }

    [Fact]
    public async Task ShowDraftsFalse_ExcludesDrafts_ShowDraftsTrue_IncludesThem()
    {
        var validated = Seed(1, "4111", 100m, 0m);
        var draft = Seed(2, "4111", 50m, 0m, status: JournalEntryStatus.Brouillon);

        Assert.Equal(new HashSet<Guid> { validated }, await IdsAsync(Query(), showDrafts: false));
        Assert.Equal(new HashSet<Guid> { validated, draft }, await IdsAsync(Query(), showDrafts: true));
    }

    [Fact]
    public async Task StateUnlettered_ExcludesLetteredAndPartial()
    {
        var d1 = Seed(1, "4111", 100m, 0m);
        var c1 = Seed(2, "4111", 0m, 100m);
        var d2 = Seed(3, "4111", 80m, 0m);
        var c2 = Seed(4, "4111", 0m, 30m);
        var free = Seed(5, "4111", 10m, 0m);
        var service = new LetteringService(new Factory(NewContext), new TenantAmbientTransaction());
        Assert.True((await service.ManualLetterAsync(new[] { d1, c1 })).IsSuccess);
        Assert.True((await service.ManualLetterAsync(new[] { d2, c2 }, allowPartial: true)).IsSuccess);

        Assert.Equal(new HashSet<Guid> { free }, await IdsAsync(Query(state: LetteringStateFilter.Unlettered), true));
        Assert.Equal(new HashSet<Guid> { d2, c2 }, await IdsAsync(Query(state: LetteringStateFilter.Partial), true));
        Assert.Equal(new HashSet<Guid> { d1, c1 }, await IdsAsync(Query(state: LetteringStateFilter.Lettered), true));
        Assert.Equal(5, (await IdsAsync(Query(), true)).Count);
    }

    [Fact]
    public async Task AccountMatch_ExactVersusPrefix()
    {
        var exact = Seed(1, "4111", 100m, 0m);
        var sub = Seed(2, "41110001", 100m, 0m);
        Seed(3, "4011", 0m, 100m);

        Assert.Equal(new HashSet<Guid> { exact }, await IdsAsync(Query("4111"), true));
        Assert.Equal(new HashSet<Guid> { exact, sub }, await IdsAsync(Query("4111", LetteringAccountMatch.Prefix), true));
    }

    [Fact]
    public async Task DateBounds_AreInclusive_OnBothEnds()
    {
        var first = Seed(1, "4111", 1m, 0m, new DateTime(2026, 5, 1));
        var last = Seed(2, "4111", 2m, 0m, new DateTime(2026, 5, 31, 23, 59, 0));
        Seed(3, "4111", 3m, 0m, new DateTime(2026, 4, 30));
        Seed(4, "4111", 4m, 0m, new DateTime(2026, 6, 1));

        var ids = await IdsAsync(Query(from: new DateTime(2026, 5, 1), to: new DateTime(2026, 5, 31)), true);

        Assert.Equal(new HashSet<Guid> { first, last }, ids);
    }

    [Fact]
    public async Task ThirdPartyNames_ResolvesEachKind_AndIgnoresMissingIds()
    {
        await using var ctx = NewContext();
        var address = Address.Create("1 rue Test", "Tunis", "Tunis", postalCode: "1000").Value;
        var client = Client.Create("Client Alpha", ClientType.Individual, address, Email.Create("a@lettering.tn").Value).Value;
        ctx.Clients.Add(client);
        await ctx.SaveChangesAsync();

        var names = await LetteringThirdPartyNames.ResolveAsync(ctx, new (Guid?, ThirdPartyKind)[]
        {
            (client.Id, ThirdPartyKind.Client),
            (client.Id, ThirdPartyKind.Client),
            (null, ThirdPartyKind.Client),
            (Guid.NewGuid(), ThirdPartyKind.Supplier),
        }, CancellationToken.None);

        var single = Assert.Single(names);
        Assert.Equal((ThirdPartyKind.Client, client.Id), single.Key);
        Assert.Equal("Client Alpha", single.Value);
    }
}
