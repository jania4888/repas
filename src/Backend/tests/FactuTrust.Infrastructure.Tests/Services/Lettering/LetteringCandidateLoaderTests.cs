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
/// Phase 3 du lettrage (p3-8) : le chargeur des candidats du moteur de propositions. Il ne garde que
/// des lignes lettrables (non lettrées, validées, ni extournées ni extournes, montant non nul, hors
/// période verrouillée), ignore les filtres d'état et de sens, applique les autres filtres, remplit
/// les liens règlement → facture et signale le plafond.
/// </summary>
public sealed class LetteringCandidateLoaderTests
{
    private readonly string _dbName = $"LetteringLoader_{Guid.NewGuid():N}";
    private readonly Guid _periodId;
    private int _nextEntryNumber = 1;

    public LetteringCandidateLoaderTests()
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

    private static GetLetteringLinesQuery Filter(
        string account = "4111",
        LetteringStateFilter state = LetteringStateFilter.All,
        LetteringSideFilter side = LetteringSideFilter.All,
        string? journalCode = null,
        IReadOnlyList<string>? categories = null,
        Guid? thirdPartyId = null,
        ThirdPartyKind? thirdPartyKind = null) =>
        new(account, LetteringAccountMatch.Exact, new DateTime(2025, 1, 1), new DateTime(2026, 12, 31), state,
            journalCode, categories, thirdPartyId, thirdPartyKind, side, null, null, null);

    private sealed record SeedOptions
    {
        public string Account { get; init; } = "4111";
        public decimal Debit { get; init; }
        public decimal Credit { get; init; }
        public DateTime Date { get; init; } = new(2026, 5, 10);
        public JournalEntryStatus Status { get; init; } = JournalEntryStatus.Validee;
        public string Journal { get; init; } = "JV";
        public string? SourceType { get; init; } = "Manual";
        public Guid? SourceId { get; init; }
        public Guid? ThirdPartyId { get; init; }
        public ThirdPartyKind Kind { get; init; } = ThirdPartyKind.None;
        public Guid? PeriodId { get; init; }
        public Guid? ReversesEntryId { get; init; }
        public bool MarkReversed { get; init; }
        public string Currency { get; init; } = Money.DefaultCurrency;
        public decimal? ExchangeRate { get; init; }
        public decimal DebitInCurrency { get; init; }
        public decimal CreditInCurrency { get; init; }
        public string? PieceRef { get; init; }
    }

    private Guid Seed(SeedOptions o)
    {
        var entry = JournalEntry.Create(
            _nextEntryNumber++, o.Journal, o.Date, "Écriture", o.PeriodId ?? _periodId, false, o.SourceType, o.SourceId ?? Guid.NewGuid(),
            new[]
            {
                new JournalLineInput(o.Account, "Ligne", o.Debit, o.Credit, o.ThirdPartyId, o.Kind, o.DebitInCurrency, o.CreditInCurrency),
                new JournalLineInput("707", "Contrepartie", o.Credit, o.Debit, null, ThirdPartyKind.None, o.CreditInCurrency, o.DebitInCurrency),
            },
            currency: o.Currency,
            reversesEntryId: o.ReversesEntryId,
            initialStatus: o.Status,
            pieceRef: o.PieceRef,
            exchangeRate: o.ExchangeRate).Value;
        if (o.MarkReversed)
            entry.MarkReversedBy(Guid.NewGuid());
        entry.SetAuditInfo("test", false);
        using var ctx = NewContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == o.Account).Id;
    }

    private Guid Debit(decimal amount, string account = "4111") => Seed(new SeedOptions { Account = account, Debit = amount });
    private Guid Credit(decimal amount, string account = "4111") => Seed(new SeedOptions { Account = account, Credit = amount });

    private async Task<LoadedCandidates> LoadAsync(GetLetteringLinesQuery? filter = null, int max = 5000)
    {
        await using var ctx = NewContext();
        return await LetteringCandidateLoader.LoadAsync(ctx, filter ?? Filter(), max, CancellationToken.None);
    }

    private static HashSet<Guid> Ids(LoadedCandidates loaded) => loaded.Candidates.Select(c => c.LineId).ToHashSet();

    [Fact]
    public async Task Excludes_LetteredPartialDraftReversedReversalAndOtherAccounts()
    {
        var keptDebit = Debit(40m);
        var keptCredit = Credit(15m);

        var d1 = Debit(100m);
        var c1 = Credit(100m);
        var d2 = Debit(80m);
        var c2 = Credit(30m);
        var lettering = new LetteringService(new Factory(NewContext), new TenantAmbientTransaction());
        Assert.True((await lettering.ManualLetterAsync(new[] { d1, c1 })).IsSuccess);
        Assert.True((await lettering.ManualLetterAsync(new[] { d2, c2 }, allowPartial: true)).IsSuccess);

        Seed(new SeedOptions { Debit = 11m, Status = JournalEntryStatus.Brouillon });
        Seed(new SeedOptions { Debit = 12m, MarkReversed = true });
        Seed(new SeedOptions { Credit = 12m, ReversesEntryId = Guid.NewGuid() });
        Debit(13m, account: "41110001");
        Credit(14m, account: "4011");

        var loaded = await LoadAsync();

        Assert.Equal(new HashSet<Guid> { keptDebit, keptCredit }, Ids(loaded));
        Assert.False(loaded.Truncated);
    }

    [Fact]
    public async Task Excludes_LockedLines_ForEachCauseOfThePeriodLock()
    {
        var kept = Debit(10m);

        // Statut « clôturée ».
        Seed(new SeedOptions { Debit = 20m, Status = JournalEntryStatus.Cloturee });

        // Période close.
        Guid closedPeriodId;
        Guid yearLockedPeriodId;
        await using (var ctx = NewContext())
        {
            var closed = AccountingPeriod.Create(2026, 4, new DateTime(2026, 4, 1), new DateTime(2026, 4, 30));
            closed.Close("test");
            var year2025 = AccountingPeriod.Create(2025, 12, new DateTime(2025, 12, 1), new DateTime(2025, 12, 31));
            ctx.AccountingPeriods.AddRange(closed, year2025);
            ctx.AccountingYearLocks.Add(AccountingYearLock.Create(2025, "test"));
            await ctx.SaveChangesAsync();
            closedPeriodId = closed.Id;
            yearLockedPeriodId = year2025.Id;
        }
        Seed(new SeedOptions { Debit = 30m, Date = new DateTime(2026, 4, 10), PeriodId = closedPeriodId });

        // Exercice présent dans AccountingYearLocks.
        Seed(new SeedOptions { Credit = 40m, Date = new DateTime(2025, 12, 10), PeriodId = yearLockedPeriodId });

        var loaded = await LoadAsync();

        Assert.Equal(new HashSet<Guid> { kept }, Ids(loaded));
    }

    [Fact]
    public async Task LockedFilter_MatchesTheSharedPeriodLockPredicate()
    {
        Guid closedPeriodId;
        await using (var ctx = NewContext())
        {
            var closed = AccountingPeriod.Create(2026, 3, new DateTime(2026, 3, 1), new DateTime(2026, 3, 31));
            closed.Close("test");
            ctx.AccountingPeriods.Add(closed);
            ctx.AccountingYearLocks.Add(AccountingYearLock.Create(2024, "test"));
            await ctx.SaveChangesAsync();
            closedPeriodId = closed.Id;
        }

        Debit(1m);
        Credit(2m);
        Seed(new SeedOptions { Debit = 3m, Status = JournalEntryStatus.Cloturee });
        Seed(new SeedOptions { Credit = 4m, Date = new DateTime(2026, 3, 5), PeriodId = closedPeriodId });
        Seed(new SeedOptions { Debit = 5m, Date = new DateTime(2026, 6, 5) });

        // Référence : les lignes non lettrées, validées, évaluées par le prédicat unique en mémoire.
        HashSet<Guid> expected;
        await using (var ctx = NewContext())
        {
            var lockedYears = await LetteringLockedYears.LoadAsync(ctx, CancellationToken.None);
            var lines = await ctx.JournalEntryLines.AsNoTracking()
                .Include(l => l.JournalEntry).ThenInclude(e => e.AccountingPeriod)
                .Where(l => l.AccountNumber == "4111")
                .ToListAsync();
            expected = lines.Where(l => !LetteringPeriodLock.IsLocked(l, lockedYears)).Select(l => l.Id).ToHashSet();
        }

        var loaded = await LoadAsync();

        Assert.Equal(3, expected.Count);
        Assert.Equal(expected, Ids(loaded));
    }

    [Fact]
    public async Task IgnoresStateAndSideFilters()
    {
        var d = Debit(10m);
        var c = Credit(10m);

        var loaded = await LoadAsync(Filter(state: LetteringStateFilter.Lettered, side: LetteringSideFilter.Debit));

        Assert.Equal(new HashSet<Guid> { d, c }, Ids(loaded));
    }

    [Fact]
    public async Task AppliesThirdPartyJournalAndCategoryFilters()
    {
        var clientA = Guid.NewGuid();
        var clientB = Guid.NewGuid();
        var a = Seed(new SeedOptions { Debit = 10m, ThirdPartyId = clientA, Kind = ThirdPartyKind.Client, SourceType = null });
        var b = Seed(new SeedOptions { Debit = 10m, ThirdPartyId = clientB, Kind = ThirdPartyKind.Client, SourceType = null });
        var bank = Seed(new SeedOptions { Credit = 10m, Journal = "BQ", SourceType = AccountingService.SourcePayment });

        Assert.Equal(new HashSet<Guid> { a },
            Ids(await LoadAsync(Filter(thirdPartyId: clientA, thirdPartyKind: ThirdPartyKind.Client))));
        Assert.Equal(new HashSet<Guid> { bank }, Ids(await LoadAsync(Filter(journalCode: "bq"))));
        Assert.Equal(new HashSet<Guid> { bank },
            Ids(await LoadAsync(Filter(categories: new[] { LetteringSourceCategories.Payment }))));
        Assert.Equal(new HashSet<Guid> { a, b },
            Ids(await LoadAsync(Filter(categories: new[] { LetteringSourceCategories.Manual }))));
    }

    [Fact]
    public async Task Cap_ReturnsFirstLinesInStableOrder_AndSetsTruncated()
    {
        var day3 = Seed(new SeedOptions { Debit = 3m, Date = new DateTime(2026, 5, 3) });
        var day1 = Seed(new SeedOptions { Debit = 1m, Date = new DateTime(2026, 5, 1) });
        var day2 = Seed(new SeedOptions { Credit = 2m, Date = new DateTime(2026, 5, 2) });

        var capped = await LoadAsync(max: 2);
        var exact = await LoadAsync(max: 3);

        Assert.True(capped.Truncated);
        Assert.Equal(new[] { day1, day2 }, capped.Candidates.Select(c => c.LineId));
        Assert.Equal(new[] { 0, 1 }, capped.Candidates.Select(c => c.OrderRank));
        Assert.False(exact.Truncated);
        Assert.Equal(new[] { day1, day2, day3 }, exact.Candidates.Select(c => c.LineId));
        Assert.Equal(new[] { 0, 1, 2 }, exact.Candidates.Select(c => c.OrderRank));
    }

    [Fact]
    public async Task MapsAmountsToMillimes_ForLocalAndForeignCurrency()
    {
        var local = Seed(new SeedOptions { Debit = 1234.567m, PieceRef = "FAC-2026-001" });
        var foreign = Seed(new SeedOptions
        {
            Credit = 340.250m, Currency = "EUR", ExchangeRate = 3.4025m, CreditInCurrency = 100m
        });

        var loaded = await LoadAsync();
        var l = loaded.Candidates.Single(c => c.LineId == local);
        var f = loaded.Candidates.Single(c => c.LineId == foreign);

        Assert.Equal(Money.DefaultCurrency, l.CurrencyCode);
        Assert.Equal(1_234_567, l.SignedMillimesLocal);
        Assert.Equal(1_234_567, l.SignedMillimesOp);
        Assert.Equal(1_234_567, l.SignedForBalance);
        Assert.Equal("FAC-2026-001", l.PieceRef);

        Assert.Equal("EUR", f.CurrencyCode);
        Assert.Equal(-340_250, f.SignedMillimesLocal);
        Assert.Equal(-100_000, f.SignedMillimesOp);
        Assert.Equal(-100_000, f.SignedForBalance);
    }

    [Fact]
    public async Task ExcludesForeignLines_WithoutAmountInOperationCurrency()
    {
        var kept = Debit(10m);
        Seed(new SeedOptions { Credit = 34m, Currency = "EUR", ExchangeRate = 3.4m });

        var loaded = await LoadAsync();

        Assert.Equal(new HashSet<Guid> { kept }, Ids(loaded));
    }

    [Fact]
    public async Task FillsPaymentLinks_ForClientAndSupplierPayments()
    {
        var clientPayment = ClientPayment();
        var supplierPayment = NewSupplierPayment();
        await using (var ctx = NewContext())
        {
            ctx.Payments.Add(clientPayment);
            ctx.SupplierPayments.Add(supplierPayment);
            await ctx.SaveChangesAsync();
        }

        Seed(new SeedOptions { Credit = 50m, SourceType = AccountingService.SourcePayment, SourceId = clientPayment.Id });
        Seed(new SeedOptions
        {
            Account = "4011", Debit = 50m, SourceType = AccountingService.SourceSupplierPayment, SourceId = supplierPayment.Id
        });
        Seed(new SeedOptions { Credit = 60m, SourceType = AccountingService.SourcePayment, SourceId = Guid.NewGuid() });

        var clients = await LoadAsync();
        var suppliers = await LoadAsync(Filter(account: "4011"));

        Assert.Equal(clientPayment.InvoiceId, Assert.Single(clients.Links.PaymentToInvoice).Value);
        Assert.Equal(clientPayment.Id, clients.Links.PaymentToInvoice.Keys.Single());
        Assert.Empty(clients.Links.SupplierPaymentToInvoice);
        Assert.Equal(supplierPayment.SupplierInvoiceId, Assert.Single(suppliers.Links.SupplierPaymentToInvoice).Value);
        Assert.Empty(suppliers.Links.PaymentToInvoice);
    }

    [Fact]
    public async Task NoPaymentLines_ReturnsEmptyLinks()
    {
        Debit(10m);

        var loaded = await LoadAsync();

        Assert.Same(DocumentLinks.Empty, loaded.Links);
    }

    [Fact]
    public async Task LoadedCandidates_FeedTheEngine_WithADocumentLinkProposal()
    {
        var payment = ClientPayment();
        await using (var ctx = NewContext())
        {
            ctx.Payments.Add(payment);
            await ctx.SaveChangesAsync();
        }

        var invoiceLine = Seed(new SeedOptions { Debit = 50m, SourceType = AccountingService.SourceInvoice, SourceId = payment.InvoiceId });
        var paymentLine = Seed(new SeedOptions { Credit = 50m, SourceType = AccountingService.SourcePayment, SourceId = payment.Id });

        var loaded = await LoadAsync();
        var output = LetteringSuggestionEngine.Run(loaded.Candidates, loaded.Links, LetteringEngineOptions.Default, CancellationToken.None);

        var suggestion = Assert.Single(output.Suggestions);
        Assert.Equal(SuggestionKind.DocumentLink, suggestion.Kind);
        Assert.Equal(new HashSet<Guid> { invoiceLine, paymentLine }, suggestion.Lines.Select(l => l.LineId).ToHashSet());
    }

    [Fact]
    public async Task RejectsInvalidArguments()
    {
        await using var ctx = NewContext();
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => LetteringCandidateLoader.LoadAsync(ctx, Filter(), 0, CancellationToken.None));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1.5, 1500)]
    [InlineData(-0.001, -1)]
    [InlineData(999999999999.999, 999_999_999_999_999)]
    public void ToMillimes_IsExactForThreeDecimals(decimal amount, long expected)
        => Assert.Equal(expected, LetteringCandidateLoader.ToMillimes(amount));

    internal static Payment ClientPayment()
    {
        var address = Address.Create("1 rue de la République", "Tunis", "Tunis").Value;
        var email = Email.Create("client@lettering.tn").Value;
        var client = Client.Create("Client lettrage", ClientType.Individual, address, email).Value;
        var invoice = Invoice.Create(
            InvoiceNumber.Create("FAC", 2026, 7001),
            client,
            issueDate: new DateTime(2026, 5, 1),
            dueDate: new DateTime(2026, 5, 31)).Value;
        return Payment.Create(invoice, Money.Create(50m, Money.DefaultCurrency), new DateTime(2026, 5, 10), PaymentMethod.Cash).Value;
    }

    private static SupplierPayment NewSupplierPayment()
    {
        var address = Address.Create("1 rue de test", "Tunis", "Tunis").Value;
        var email = Email.Create("supplier@lettering.tn").Value;
        var nif = NIF.Create("1234567/A/B/C/000").Value;
        var supplier = Supplier.Create("Fournisseur lettrage", SupplierType.Business, address, email, nif: nif).Value;
        var category = ProductCategory.Create("GEN", "Général").Value;
        var product = Product.Create("PR-LT-1", "Article", ProductType.Product, Money.Create(25m, Money.DefaultCurrency),
            VatRate.Standard, category.Id, purchasePrice: Money.Create(25m, Money.DefaultCurrency)).Value;

        var po = PurchaseOrder.Create(PurchaseOrderNumber.Create("BC", 2026, 700001), supplier, new DateTime(2026, 5, 1)).Value;
        po.AddLine(product, 2m);
        po.Confirm();
        po.ReceiveGoods(new[] { (po.Lines.First().Id, 2m) });
        var selections = po.Lines.Select(l => (l.Id, l.ReceivedNotInvoicedQuantity)).ToList();
        var invoice = SupplierInvoice.CreateFromPurchaseOrder(po, "FS-2026-LT-1", new DateTime(2026, 5, 5), selections).Value;
        return FactuTrust.Domain.Entities.SupplierPayment.Create(invoice, Money.Create(invoice.TotalAmount.Amount, Money.DefaultCurrency), new DateTime(2026, 5, 10), PaymentMethod.Cash).Value;
    }
}
