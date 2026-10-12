using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Tests.Fixtures;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Plan de refonte du lettrage (Phase 1, §11) : batterie de <see cref="LetteringQueryService"/> —
/// correspondance compte exacte/préfixe, états (non lettrées / partielles / lettrées / toutes),
/// brouillards selon <c>IncludeBrouillardInReports</c>, drapeaux d'extourne, totaux calculés sur
/// TOUT le filtre avant pagination, pagination stable, flag <c>Truncated</c>, tiers + résolution
/// de nom, catégories de pièces, <c>PeriodLocked</c> aux trois causes (D8), totaux mono-devise
/// (TND exclue du comptage), <c>CanComplete</c> (permission + verrou), et une passe de traduction
/// SQL réelle (opt-in) pour interdire toute évaluation cliente.
/// </summary>
public sealed class LetteringQueryServiceTests
{
    private static readonly DateTime From = new(2026, 1, 1);
    private static readonly DateTime To = new(2027, 12, 31);

    private readonly string _dbName = $"LetteringQuerySvc_{Guid.NewGuid():N}";
    private readonly TestTenantDbContextFactory _factory;
    private readonly Guid _periodId;

    public LetteringQueryServiceTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);

        // AccountingPeriod réelle requise (cf. LetteringServiceTests) : relation obligatoire,
        // jointure interne silencieuse sur le provider InMemory sinon.
        using var ctx = _factory.CreateContext();
        var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
        ctx.AccountingPeriods.Add(period);
        ctx.SaveChanges();
        _periodId = period.Id;
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;
        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    private LetteringQueryService BuildService(
        bool includeDrafts = true,
        bool hasCreatePermission = true,
        bool hasUnletterPermission = true,
        MasterDbContext? masterDb = null)
    {
        var settings = Options.Create(new AccountingSettings { IncludeBrouillardInReports = includeDrafts });
        var user = new Mock<ICurrentUser>();
        user.Setup(u => u.HasPermission(Permissions.Accounting.Create)).Returns(hasCreatePermission);
        user.Setup(u => u.HasPermission(Permissions.Accounting.Unletter)).Returns(hasUnletterPermission);
        return new LetteringQueryService(_factory, settings, user.Object, masterDb);
    }

    private static GetLetteringLinesQuery Query(
        string account = "4111",
        LetteringAccountMatch match = LetteringAccountMatch.Exact,
        LetteringStateFilter state = LetteringStateFilter.All,
        string? journalCode = null,
        IReadOnlyList<string>? categories = null,
        Guid? thirdPartyId = null,
        ThirdPartyKind? thirdPartyKind = null,
        int page = 1,
        int pageSize = 500) =>
        new(account, match, From, To, state, journalCode, categories,
            thirdPartyId, thirdPartyKind, LetteringSideFilter.All, null, null, null, page, pageSize);

    /// <summary>
    /// Écriture validée : ligne <paramref name="account"/> au débit de <paramref name="amount"/>,
    /// contrepartie 707. Renvoie (entryId, lineId).
    /// </summary>
    private (Guid EntryId, Guid LineId) SeedDebitLine(
        int number, string account, decimal amount, string journal = "JV",
        DateTime? date = null, string? sourceType = "Manual",
        JournalEntryStatus status = JournalEntryStatus.Validee,
        Guid? periodId = null, Guid? thirdPartyId = null,
        ThirdPartyKind thirdPartyKind = ThirdPartyKind.None,
        string? currency = null, decimal? exchangeRate = null,
        decimal debitInCurrency = 0m, decimal creditInCurrency = 0m,
        Guid? reversesEntryId = null)
    {
        var entry = JournalEntry.Create(
            number, journal, date ?? new DateTime(2026, 5, 10), $"Écriture {number}",
            periodId ?? _periodId, false, sourceType, sourceType is null ? null : Guid.NewGuid(),
            new[]
            {
                new JournalLineInput(account, "Ligne test", amount, 0m, thirdPartyId, thirdPartyKind, debitInCurrency, 0m),
                new JournalLineInput("707", "Contrepartie", 0m, amount, null, ThirdPartyKind.None, 0m, creditInCurrency)
            },
            currency: currency ?? Money.DefaultCurrency,
            exchangeRate: exchangeRate,
            initialStatus: status,
            reversesEntryId: reversesEntryId).Value;
        entry.SetAuditInfo("test", false);

        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return (entry.Id, entry.Lines.Single(l => l.AccountNumber == account).Id);
    }

    /// <summary>Ligne <paramref name="account"/> au CRÉDIT (contrepartie 532 au débit).</summary>
    private Guid SeedCreditLine(int number, string account, decimal amount, DateTime? date = null)
    {
        var entry = JournalEntry.Create(
            number, "JB", date ?? new DateTime(2026, 5, 12), $"Règlement {number}",
            _periodId, false, "Payment", Guid.NewGuid(),
            new[]
            {
                new JournalLineInput("532", "Banque", amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput(account, "Règlement", 0m, amount, null, ThirdPartyKind.None)
            }).Value;
        entry.SetAuditInfo("test", false);

        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == account).Id;
    }

    private async Task<string> LetterAsync(params Guid[] lineIds)
    {
        var service = new LetteringService(_factory, new TenantAmbientTransaction());
        var result = await service.ManualLetterAsync(lineIds);
        Assert.True(result.IsSuccess, result.Error?.Description);
        return result.Value.Code;
    }

    private async Task<string> LetterPartialAsync(params Guid[] lineIds)
    {
        var service = new LetteringService(_factory, new TenantAmbientTransaction());
        var result = await service.ManualLetterAsync(lineIds, allowPartial: true);
        Assert.True(result.IsSuccess, result.Error?.Description);
        return result.Value.Code;
    }

    // ── Compte : exact / préfixe ────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetLines_ExactMatch_ExcludesAuxiliaryAccounts()
    {
        SeedDebitLine(1, "4111", 100m);
        SeedDebitLine(2, "4111001", 200m);

        var result = await BuildService().GetLinesAsync(Query(account: "4111", match: LetteringAccountMatch.Exact));

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Totals.Count);
        var item = Assert.Single(result.Value.Items);
        Assert.Equal("4111", item.AccountNumber);
    }

    [Fact]
    public async Task GetLines_PrefixMatch_IncludesAuxiliaryAccounts()
    {
        SeedDebitLine(1, "4111", 100m);
        SeedDebitLine(2, "4111001", 200m);
        SeedDebitLine(3, "4011", 300m);

        var result = await BuildService().GetLinesAsync(Query(account: "4111", match: LetteringAccountMatch.Prefix));

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Totals.Count);
        Assert.Equal(new[] { "4111", "4111001" }, result.Value.Items.Select(i => i.AccountNumber).OrderBy(a => a).ToArray());
    }

    // ── États de lettrage ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetLines_StateFilters_Unlettered_Partial_Lettered()
    {
        var free = SeedDebitLine(1, "4111", 100m).LineId;
        var partialD = SeedDebitLine(2, "4111", 100m, date: new DateTime(2026, 5, 11)).LineId;
        var partialC = SeedCreditLine(3, "4111", 60m);
        var fullD = SeedDebitLine(4, "4111", 100m, date: new DateTime(2026, 5, 12)).LineId;
        var fullC = SeedCreditLine(5, "4111", 100m);
        await LetterPartialAsync(partialD, partialC);
        await LetterAsync(fullD, fullC);

        var service = BuildService();

        var unlettered = await service.GetLinesAsync(Query(state: LetteringStateFilter.Unlettered));
        Assert.Equal(free, Assert.Single(unlettered.Value.Items).LineId);

        var partial = await service.GetLinesAsync(Query(state: LetteringStateFilter.Partial));
        Assert.Equal(2, partial.Value.Items.Count);
        Assert.All(partial.Value.Items, i => Assert.True(i.IsPartiallyLettered));

        var lettered = await service.GetLinesAsync(Query(state: LetteringStateFilter.Lettered));
        Assert.Equal(2, lettered.Value.Items.Count);
        Assert.All(lettered.Value.Items, i => Assert.False(i.IsPartiallyLettered));
        Assert.All(lettered.Value.Items, i => Assert.StartsWith("L", i.LetteringCode));

        var all = await service.GetLinesAsync(Query(state: LetteringStateFilter.All));
        Assert.Equal(5, all.Value.Totals.Count);
    }

    // ── Brouillards selon le paramétrage ────────────────────────────────────────────────────

    [Fact]
    public async Task GetLines_DraftsFollow_IncludeBrouillardInReports()
    {
        SeedDebitLine(1, "4111", 100m);
        SeedDebitLine(2, "4111", 200m, status: JournalEntryStatus.Brouillon);

        var withDrafts = await BuildService(includeDrafts: true).GetLinesAsync(Query());
        Assert.Equal(2, withDrafts.Value.Items.Count);
        Assert.Contains(withDrafts.Value.Items, i => i.IsDraft);

        var withoutDrafts = await BuildService(includeDrafts: false).GetLinesAsync(Query());
        var item = Assert.Single(withoutDrafts.Value.Items);
        Assert.False(item.IsDraft);
    }

    // ── Extournes ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetLines_ReversalFlags()
    {
        var (originalId, originalLine) = SeedDebitLine(1, "4111", 100m);
        var reversal = SeedDebitLine(2, "4111", 100m, date: new DateTime(2026, 5, 15), reversesEntryId: originalId);

        using (var ctx = _factory.CreateContext())
        {
            var original = ctx.JournalEntries.Single(e => e.Id == originalId);
            original.MarkReversedBy(reversal.EntryId);
            ctx.SaveChanges();
        }

        var result = await BuildService().GetLinesAsync(Query());

        var originalDto = result.Value.Items.Single(i => i.LineId == originalLine);
        var reversalDto = result.Value.Items.Single(i => i.LineId == reversal.LineId);
        Assert.True(originalDto.IsReversed);
        Assert.False(originalDto.IsReversal);
        Assert.False(reversalDto.IsReversed);
        Assert.True(reversalDto.IsReversal);
    }

    // ── Totaux sur tout le filtre, pagination stable, Truncated ─────────────────────────────

    [Fact]
    public async Task GetLines_TotalsCoverWholeFilter_BeforePaging()
    {
        SeedDebitLine(1, "4111", 100m, date: new DateTime(2026, 5, 1));
        SeedDebitLine(2, "4111", 200m, date: new DateTime(2026, 5, 2));
        SeedDebitLine(3, "4111", 300m, date: new DateTime(2026, 5, 3));

        var result = await BuildService().GetLinesAsync(Query(page: 1, pageSize: 2));

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Items.Count);
        // Les totaux portent sur les TROIS lignes du filtre, pas sur la page.
        Assert.Equal(3, result.Value.TotalCount);
        Assert.Equal(3, result.Value.Totals.Count);
        Assert.Equal(600m, result.Value.Totals.TotalDebit);
        Assert.Equal(600m, result.Value.Totals.Balance);
        Assert.True(result.Value.Truncated);
    }

    [Fact]
    public async Task GetLines_StablePaging_OrderedAndDisjoint()
    {
        var l1 = SeedDebitLine(3, "4111", 300m, date: new DateTime(2026, 5, 3)).LineId;
        var l2 = SeedDebitLine(1, "4111", 100m, date: new DateTime(2026, 5, 1)).LineId;
        var l3 = SeedDebitLine(2, "4111", 200m, date: new DateTime(2026, 5, 2)).LineId;

        var service = BuildService();
        var page1 = await service.GetLinesAsync(Query(page: 1, pageSize: 2));
        var page2 = await service.GetLinesAsync(Query(page: 2, pageSize: 2));

        // Tri stable : EntryDate puis journal/numéro/ligne — pages disjointes et ordonnées.
        Assert.Equal(new[] { l2, l3 }, page1.Value.Items.Select(i => i.LineId).ToArray());
        Assert.Equal(new[] { l1 }, page2.Value.Items.Select(i => i.LineId).ToArray());
    }

    [Fact]
    public async Task GetLines_TruncatedFlag_ReflectsWholeFilter()
    {
        SeedDebitLine(1, "4111", 100m, date: new DateTime(2026, 5, 1));
        SeedDebitLine(2, "4111", 200m, date: new DateTime(2026, 5, 2));
        SeedDebitLine(3, "4111", 300m, date: new DateTime(2026, 5, 3));

        var service = BuildService();
        var page1 = await service.GetLinesAsync(Query(page: 1, pageSize: 2));
        var all = await service.GetLinesAsync(Query(page: 1, pageSize: 500));

        Assert.True(page1.Value.Truncated);   // 3 lignes au total > 2 affichées
        Assert.False(all.Value.Truncated);    // tout tient dans la page
    }

    // ── Tiers + résolution de nom ───────────────────────────────────────────────────────────

    [Fact]
    public async Task GetLines_ThirdPartyFilter_ResolvesClientName()
    {
        Guid clientId;
        using (var ctx = _factory.CreateContext())
        {
            var address = Address.Create("1 rue Test", "Tunis", "Tunis", postalCode: "1000").Value;
            var email = Email.Create("client@lettering.tn").Value;
            // Individual : le NIF est obligatoire pour Business/Government/Association.
            var client = Client.Create("Société Atlas", ClientType.Individual, address, email).Value;
            ctx.Clients.Add(client);
            ctx.SaveChanges();
            clientId = client.Id;
        }

        SeedDebitLine(1, "4111", 100m, thirdPartyId: clientId, thirdPartyKind: ThirdPartyKind.Client);
        SeedDebitLine(2, "4111", 200m);

        var result = await BuildService().GetLinesAsync(
            Query(thirdPartyId: clientId, thirdPartyKind: ThirdPartyKind.Client));

        Assert.True(result.IsSuccess);
        var item = Assert.Single(result.Value.Items);
        Assert.Equal(clientId, item.ThirdPartyId);
        Assert.Equal("Société Atlas", item.ThirdPartyName);
    }

    // ── Catégories de pièces (SourceEntityType → code stable) ───────────────────────────────

    [Fact]
    public async Task GetLines_SourceCategories_Filter()
    {
        SeedDebitLine(1, "4111", 100m, sourceType: "Invoice");
        SeedDebitLine(2, "4111", 100m, sourceType: "Payment");
        SeedDebitLine(3, "4111", 100m, sourceType: null);   // manual
        SeedDebitLine(4, "4111", 100m, sourceType: "FixedAsset"); // inconnu → other

        var service = BuildService();

        var invoices = await service.GetLinesAsync(Query(categories: new[] { LetteringSourceCategories.Invoice }));
        Assert.All(invoices.Value.Items, i => Assert.Equal(LetteringSourceCategories.Invoice, i.SourceCategory));
        Assert.Single(invoices.Value.Items);

        var manual = await service.GetLinesAsync(Query(categories: new[] { LetteringSourceCategories.Manual }));
        Assert.All(manual.Value.Items, i => Assert.Equal(LetteringSourceCategories.Manual, i.SourceCategory));
        Assert.Single(manual.Value.Items);

        var other = await service.GetLinesAsync(Query(categories: new[] { LetteringSourceCategories.Other }));
        Assert.All(other.Value.Items, i => Assert.Equal(LetteringSourceCategories.Other, i.SourceCategory));
        Assert.Single(other.Value.Items);

        var combined = await service.GetLinesAsync(Query(categories: new[]
        {
            LetteringSourceCategories.Invoice, LetteringSourceCategories.Payment
        }));
        Assert.Equal(2, combined.Value.Items.Count);
    }

    // ── PeriodLocked : les trois causes D8 ──────────────────────────────────────────────────

    [Fact]
    public async Task GetLines_PeriodLocked_ThreeCauses()
    {
        // Cause 1 : écriture au statut Cloturee.
        var lockedByStatus = SeedDebitLine(1, "4111", 100m, date: new DateTime(2026, 5, 5)).LineId;
        using (var ctx = _factory.CreateContext())
        {
            var entry = ctx.JournalEntryLines.Include(l => l.JournalEntry).Single(l => l.Id == lockedByStatus).JournalEntry;
            entry.MarkPeriodClosed();
            ctx.SaveChanges();
        }

        // Cause 2 : période IsClosed (juin 2026, clôturée à la création).
        var closedPeriod = AccountingPeriod.Create(2026, 6, new DateTime(2026, 6, 1), new DateTime(2026, 6, 30));
        closedPeriod.Close("test");
        using (var ctx = _factory.CreateContext())
        {
            ctx.AccountingPeriods.Add(closedPeriod);
            ctx.SaveChanges();
        }
        var lockedByPeriod = SeedDebitLine(2, "4111", 100m, date: new DateTime(2026, 6, 10), periodId: closedPeriod.Id).LineId;

        // Cause 3 : exercice verrouillé (2027), écriture de mai 2027 dans une période ouverte.
        var openPeriod2027 = AccountingPeriod.Create(2027, 5, new DateTime(2027, 5, 1), new DateTime(2027, 5, 31));
        using (var ctx = _factory.CreateContext())
        {
            ctx.AccountingPeriods.Add(openPeriod2027);
            ctx.AccountingYearLocks.Add(AccountingYearLock.Create(2027, "test"));
            ctx.SaveChanges();
        }
        var lockedByYear = SeedDebitLine(3, "4111", 100m, date: new DateTime(2027, 5, 10), periodId: openPeriod2027.Id).LineId;

        // Témoin : écriture de mai 2026, période ouverte, aucune cause.
        var unlocked = SeedDebitLine(4, "4111", 100m, date: new DateTime(2026, 5, 20)).LineId;

        var result = await BuildService().GetLinesAsync(Query());

        Assert.True(result.Value.Items.Single(i => i.LineId == lockedByStatus).PeriodLocked);
        Assert.True(result.Value.Items.Single(i => i.LineId == lockedByPeriod).PeriodLocked);
        Assert.True(result.Value.Items.Single(i => i.LineId == lockedByYear).PeriodLocked);
        Assert.False(result.Value.Items.Single(i => i.LineId == unlocked).PeriodLocked);
    }

    // ── Totaux mono-devise (TND exclue du comptage des devises) ─────────────────────────────

    [Fact]
    public async Task GetLines_Totals_AllTnd_NoForeignCurrencyTotals()
    {
        SeedDebitLine(1, "4111", 100m);
        SeedDebitLine(2, "4111", 200m);

        var result = await BuildService().GetLinesAsync(Query());

        Assert.Null(result.Value.Totals.SingleForeignCurrency);
        Assert.Null(result.Value.Totals.TotalDebitInCurrency);
        Assert.Null(result.Value.Totals.TotalCreditInCurrency);
    }

    [Fact]
    public async Task GetLines_Totals_SingleForeignCurrency_Exposed()
    {
        SeedDebitLine(1, "4111", 3000m, currency: "EUR", exchangeRate: 3.0m, debitInCurrency: 1000m, creditInCurrency: 1000m);
        SeedDebitLine(2, "4111", 1500m, currency: "EUR", exchangeRate: 3.0m, debitInCurrency: 500m, creditInCurrency: 500m);

        var result = await BuildService().GetLinesAsync(Query());

        Assert.Equal("EUR", result.Value.Totals.SingleForeignCurrency);
        Assert.Equal(1500m, result.Value.Totals.TotalDebitInCurrency);
    }

    [Fact]
    public async Task GetLines_Totals_MixedForeignCurrencies_NotExposed()
    {
        SeedDebitLine(1, "4111", 3000m, currency: "EUR", exchangeRate: 3.0m, debitInCurrency: 1000m, creditInCurrency: 1000m);
        SeedDebitLine(2, "4111", 2400m, currency: "USD", exchangeRate: 2.4m, debitInCurrency: 1000m, creditInCurrency: 1000m);

        var result = await BuildService().GetLinesAsync(Query());

        Assert.Null(result.Value.Totals.SingleForeignCurrency);
        Assert.Null(result.Value.Totals.TotalDebitInCurrency);
    }

    [Fact]
    public async Task GetLines_Totals_TndPlusOneForeign_ForeignExposed()
    {
        // TND ne compte pas comme devise : un filtre TND + EUR expose les totaux EUR (les lignes
        // TND contribuent 0 aux montants en devise — convention DebitAmountInCurrency).
        SeedDebitLine(1, "4111", 100m);
        SeedDebitLine(2, "4111", 3000m, currency: "EUR", exchangeRate: 3.0m, debitInCurrency: 1000m, creditInCurrency: 1000m);

        var result = await BuildService().GetLinesAsync(Query());

        Assert.Equal("EUR", result.Value.Totals.SingleForeignCurrency);
        Assert.Equal(1000m, result.Value.Totals.TotalDebitInCurrency);
    }

    // ── GetGroupAsync : CanComplete (permission + verrou), devise d'opération, créateur ────────

    private async Task<string> SeedPartialGroupForGroupTests()
    {
        var debit = SeedDebitLine(1, "4111", 100m).LineId;
        var credit = SeedCreditLine(2, "4111", 60m);
        return await LetterPartialAsync(debit, credit);
    }

    [Fact]
    public async Task GetGroup_CanComplete_PartialWithPermission_Unlocked()
    {
        var code = await SeedPartialGroupForGroupTests();

        var result = await BuildService(hasCreatePermission: true).GetGroupAsync(code);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsPartial);
        Assert.True(result.Value.CanComplete);
    }

    [Fact]
    public async Task GetGroup_CanComplete_FalseWithoutCreatePermission()
    {
        var code = await SeedPartialGroupForGroupTests();

        var result = await BuildService(hasCreatePermission: false).GetGroupAsync(code);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanComplete);
    }

    [Fact]
    public async Task GetGroup_CanComplete_FalseWhenAMemberIsLocked()
    {
        var code = await SeedPartialGroupForGroupTests();
        using (var ctx = _factory.CreateContext())
        {
            ctx.AccountingYearLocks.Add(AccountingYearLock.Create(2026, "test"));
            ctx.SaveChanges();
        }

        var result = await BuildService(hasCreatePermission: true).GetGroupAsync(code);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanComplete);
    }

    [Fact]
    public async Task GetGroup_CanComplete_FalseForDefinitiveGroup()
    {
        var debit = SeedDebitLine(1, "4111", 100m).LineId;
        var credit = SeedCreditLine(2, "4111", 100m);
        var code = await LetterAsync(debit, credit);

        var result = await BuildService(hasCreatePermission: true).GetGroupAsync(code);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IsPartial);
        Assert.False(result.Value.CanComplete);
    }

    /// <summary>Crée une écriture EUR et renvoie sa ligne 4111 (au crédit de <paramref name="creditEur"/>).</summary>
    private Guid SeedEuroCreditLine(int number, decimal creditEur, decimal rate)
    {
        var entry = JournalEntry.Create(
            number, "JB", new DateTime(2026, 5, 12), $"Règlement EUR {number}", _periodId,
            false, "Payment", Guid.NewGuid(),
            new[]
            {
                new JournalLineInput("532", "Banque", creditEur * rate, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Règlement", 0m, creditEur * rate, null, ThirdPartyKind.None, 0m, creditEur)
            },
            currency: "EUR", exchangeRate: rate).Value;
        entry.SetAuditInfo("test", false);
        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == "4111").Id;
    }

    /// <summary>La devise d'opération du groupe vient des LIGNES (CurrencyCode), pas du montant (toujours TND).</summary>
    [Fact]
    public async Task GetGroup_OperationCurrency_ComesFromLines()
    {
        var debit = SeedDebitLine(1, "4111", 3000m, currency: "EUR", exchangeRate: 3.0m,
            debitInCurrency: 1000m, creditInCurrency: 1000m).LineId;
        var euroCredit = SeedEuroCreditLine(2, 600m, 3.0m);

        var service = new LetteringService(_factory, new TenantAmbientTransaction());
        var lettered = await service.ManualLetterAsync(new[] { debit, euroCredit }, allowPartial: true);
        Assert.True(lettered.IsSuccess, lettered.Error?.Description);

        var result = await BuildService().GetGroupAsync(lettered.Value.Code);

        Assert.True(result.IsSuccess);
        Assert.Equal("EUR", result.Value.OperationCurrency);
        Assert.Equal(1800m, result.Value.Amount); // min(3000, 1800) en TND — la devise du MONTANT reste TND
        Assert.All(result.Value.Lines, l => Assert.Equal("EUR", l.OperationCurrency));
    }

    // ── CreatedByDisplayName : résolution master, jamais d'identifiant brut (§4.2) ─────────────

    private static async Task<MasterDbContext> NewMasterDbWithUserAsync(
        string email = "marie.dupont@cabinet.tn", string firstName = "Marie", string lastName = "Dupont")
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase($"master_{Guid.NewGuid():N}")
            .Options;
        var master = new MasterDbContext(options);
        master.Users.Add(new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            NormalizedUserName = email.ToUpperInvariant(),
            Email = email,
            NormalizedEmail = email.ToUpperInvariant(),
            FirstName = firstName,
            LastName = lastName,
            TenantId = Guid.NewGuid()
        });
        await master.SaveChangesAsync();
        return master;
    }

    private async Task<string> SeedGroupCreatedBy(string createdBy)
    {
        var debit = SeedDebitLine(1, "4111", 100m).LineId;
        var credit = SeedCreditLine(2, "4111", 100m);
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns(createdBy);
        var service = new LetteringService(_factory, new TenantAmbientTransaction(), user.Object);
        var result = await service.ManualLetterAsync(new[] { debit, credit });
        Assert.True(result.IsSuccess, result.Error?.Description);
        return result.Value.Code;
    }

    [Fact]
    public async Task GetGroup_CreatedByDisplayName_ResolvesMasterUserName()
    {
        var code = await SeedGroupCreatedBy("marie.dupont@cabinet.tn");
        await using var master = await NewMasterDbWithUserAsync();

        var result = await BuildService(masterDb: master).GetGroupAsync(code);

        Assert.True(result.IsSuccess);
        Assert.Equal("Marie Dupont", result.Value.CreatedByDisplayName);
        Assert.DoesNotContain("@", result.Value.CreatedByDisplayName!);
    }

    [Fact]
    public async Task GetGroup_CreatedByDisplayName_UnknownEmail_NeutralLabelNeverRawEmail()
    {
        var code = await SeedGroupCreatedBy("inconnu@cabinet.tn");
        await using var master = await NewMasterDbWithUserAsync();

        var result = await BuildService(masterDb: master).GetGroupAsync(code);

        Assert.True(result.IsSuccess);
        Assert.Equal("Utilisateur", result.Value.CreatedByDisplayName);
    }

    [Fact]
    public async Task GetGroup_CreatedByDisplayName_System_StaysSystem()
    {
        var code = await SeedGroupCreatedBy("system");

        var result = await BuildService().GetGroupAsync(code);

        Assert.True(result.IsSuccess);
        Assert.Equal("Système", result.Value.CreatedByDisplayName);
    }
}

/// <summary>
/// Traduction SQL réelle (opt-in <c>FACTUTRUST_TEST_SQL_CONNECTION</c>, modèle
/// <c>LetteringServiceAmbientTransactionTests</c>) : la requête filtrée/paginée et surtout les
/// TOTAUX (GroupBy + agrégats filtrés, Max/Distinct sur les devises) doivent être traduits en SQL
/// sans évaluation cliente — un échec ici signifie une requête non traduisible en production.
/// </summary>
public sealed class LetteringQueryServiceSqlTests : IDisposable
{
    private readonly SqlTestDatabase _sqlDb = new(nameof(LetteringQueryServiceSqlTests));
    private readonly TenantDbContextFactory? _factory;

    public LetteringQueryServiceSqlTests()
    {
        if (!_sqlDb.CanRun)
            return;

        var tenantContext = new Mock<ITenantContext>();
        tenantContext.SetupGet(c => c.ConnectionString).Returns(_sqlDb.ConnectionString);
        var hostEnvironment = new Mock<IHostEnvironment>();
        hostEnvironment.SetupGet(e => e.EnvironmentName).Returns(Environments.Development);

        _factory = new TenantDbContextFactory(
            tenantContext.Object,
            new Mock<IMediator>().Object,
            new TenantAmbientTransaction(),
            NullLogger<TenantDbContext>.Instance,
            NullLoggerFactory.Instance,
            new ConfigurationBuilder().Build(),
            hostEnvironment.Object);
    }

    public void Dispose() => _sqlDb.Dispose();

    private LetteringQueryService BuildService()
    {
        var settings = Options.Create(new AccountingSettings { IncludeBrouillardInReports = true });
        var user = new Mock<ICurrentUser>();
        user.Setup(u => u.HasPermission(It.IsAny<string>())).Returns(true);
        return new LetteringQueryService(_factory!, settings, user.Object);
    }

    [SkippableFact]
    public async Task GetLines_TranslatesToSql_IncludingTotalsAndSingleForeignCurrency()
    {
        Skip.If(!_sqlDb.CanRun, "SQL Server/LocalDB indisponible dans ce bac à sable.");

        Guid periodId;
        await using (var ctx = _factory!.CreateContext())
        {
            var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
            ctx.AccountingPeriods.Add(period);
            await ctx.SaveChangesAsync();
            periodId = period.Id;

            // Deux lignes TND sur 4111, une ligne EUR sur 4112.
            var e1 = JournalEntry.Create(1, "JV", new DateTime(2026, 5, 10), "TND 1", periodId,
                false, "Manual", null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 100m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("707", "Vente", 0m, 100m, null, ThirdPartyKind.None)
                }).Value;
            var e2 = JournalEntry.Create(2, "JV", new DateTime(2026, 5, 11), "TND 2", periodId,
                false, "Manual", null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 200m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("707", "Vente", 0m, 200m, null, ThirdPartyKind.None)
                }).Value;
            var e3 = JournalEntry.Create(3, "JV", new DateTime(2026, 5, 12), "EUR 1", periodId,
                false, "Invoice", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("4112", "Client EUR", 3000m, 0m, null, ThirdPartyKind.None, 1000m, 0m),
                    new JournalLineInput("707", "Vente", 0m, 3000m, null, ThirdPartyKind.None, 0m, 1000m)
                },
                currency: "EUR", exchangeRate: 3.0m).Value;
            foreach (var e in new[] { e1, e2, e3 })
                e.SetAuditInfo("test", false);
            ctx.JournalEntries.AddRange(e1, e2, e3);
            await ctx.SaveChangesAsync();
        }

        var service = BuildService();

        // Filtre 100 % TND : pas de devise étrangère exposée.
        var tnd = await service.GetLinesAsync(new GetLetteringLinesQuery(
            "4111", LetteringAccountMatch.Exact, new DateTime(2026, 1, 1), new DateTime(2026, 12, 31),
            LetteringStateFilter.All, null, null, null, null, LetteringSideFilter.All, null, null, null, 1, 500));

        Assert.True(tnd.IsSuccess);
        Assert.Equal(2, tnd.Value.Totals.Count);
        Assert.Equal(300m, tnd.Value.Totals.TotalDebit);
        Assert.Null(tnd.Value.Totals.SingleForeignCurrency);
        Assert.Null(tnd.Value.Totals.TotalDebitInCurrency);

        // Filtre 100 % EUR : devise unique exposée avec ses totaux en devise.
        var eur = await service.GetLinesAsync(new GetLetteringLinesQuery(
            "4112", LetteringAccountMatch.Exact, new DateTime(2026, 1, 1), new DateTime(2026, 12, 31),
            LetteringStateFilter.All, null, null, null, null, LetteringSideFilter.All, null, null, null, 1, 500));

        Assert.True(eur.IsSuccess);
        Assert.Equal(1, eur.Value.Totals.Count);
        Assert.Equal("EUR", eur.Value.Totals.SingleForeignCurrency);
        Assert.Equal(1000m, eur.Value.Totals.TotalDebitInCurrency);
        Assert.Equal(0m, eur.Value.Totals.TotalCreditInCurrency);
    }
}
