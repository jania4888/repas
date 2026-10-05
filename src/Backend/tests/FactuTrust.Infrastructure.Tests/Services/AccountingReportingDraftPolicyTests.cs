using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using FactuTrust.Infrastructure.Tests.Fakes;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// C3 : politique brouillard des états.
/// — Consultation (journal, grand livre, balance) : brouillons inclus selon
///   <see cref="AccountingSettings.IncludeBrouillardInReports"/>.
/// — Synthèse (bilan, compte de résultat) : brouillons exclus inconditionnellement.
/// — <c>SumDebitsByAccountAsync</c> (déclaration TVA) : brouillons exclus inconditionnellement.
/// </summary>
public sealed class AccountingReportingDraftPolicyTests
{
    private readonly string _dbName = $"DraftPolicyDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;

    public AccountingReportingDraftPolicyTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);
        Seed();
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

    private static JournalEntry MakeEntry(
        int number, decimal amount, JournalEntryStatus status, Guid? accountingPeriodId = null)
    {
        var lines = new[]
        {
            new JournalLineInput("4111", "Client", amount, 0m, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Vente", 0m, amount, null, ThirdPartyKind.None)
        };
        var entry = JournalEntry.Create(
            number, "JV", new DateTime(2026, 5, 15), $"Vente {number}", accountingPeriodId ?? Guid.NewGuid(),
            false, "Manual", null, lines, initialStatus: status).Value;
        entry.SetAuditInfo("test", false);
        return entry;
    }

    private void Seed()
    {
        using var ctx = _factory.CreateContext();
        // 1 écriture validée de 100 + 1 brouillon de 50 sur le même mois.
        ctx.JournalEntries.Add(MakeEntry(1, 100m, JournalEntryStatus.Validee));
        ctx.JournalEntries.Add(MakeEntry(2, 50m, JournalEntryStatus.Brouillon));
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create("4111", "Clients", 4, "411", AccountNatureType.Debit).Value);
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create("707", "Ventes", 7, null, AccountNatureType.Credit).Value);
        ctx.SaveChanges();
    }

    private AccountingReportingService BuildService(bool includeDrafts)
        => new(_factory, Options.Create(new AccountingSettings { IncludeBrouillardInReports = includeDrafts }));

    private static readonly DateTime From = new(2026, 1, 1);
    private static readonly DateTime To = new(2026, 12, 31);

    [Fact]
    public async Task Journal_FlagOn_IncludesMarkedDrafts()
    {
        var result = await BuildService(includeDrafts: true).GetJournalEntriesAsync(null, From, To);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Count);
        Assert.Contains(result.Value, e => e.IsDraft);
    }

    [Fact]
    public async Task Journal_FlagOff_ExcludesDrafts()
    {
        var result = await BuildService(includeDrafts: false).GetJournalEntriesAsync(null, From, To);

        Assert.True(result.IsSuccess);
        var entry = Assert.Single(result.Value);
        Assert.False(entry.IsDraft);
    }

    [Fact]
    public async Task Ledger_FlagOff_ExcludesDraftLines()
    {
        var on = await BuildService(includeDrafts: true).GetLedgerAsync("4111", From, To);
        var off = await BuildService(includeDrafts: false).GetLedgerAsync("4111", From, To);

        Assert.Equal(2, on.Value.Count);
        var row = Assert.Single(off.Value);
        Assert.Equal(100m, row.Debit);
    }

    [Fact]
    public async Task Balance_FollowsFlag()
    {
        var on = await BuildService(includeDrafts: true).GetBalanceAsync(From, To);
        var off = await BuildService(includeDrafts: false).GetBalanceAsync(From, To);

        Assert.Equal(150m, on.Value.Single(r => r.AccountNumber == "4111").MovementDebit);
        Assert.Equal(100m, off.Value.Single(r => r.AccountNumber == "4111").MovementDebit);
    }

    [Fact]
    public async Task BalanceSheet_AlwaysExcludesDrafts_EvenWithFlagOn()
    {
        var result = await BuildService(includeDrafts: true).GetBalanceSheetAsync(2026);

        Assert.True(result.IsSuccess);
        var clients = result.Value.Assets.Single(a => a.AccountNumber == "4111");
        Assert.Equal(100m, clients.Amount);
    }

    [Fact]
    public async Task IncomeStatement_AlwaysExcludesDrafts_EvenWithFlagOn()
    {
        var result = await BuildService(includeDrafts: true).GetIncomeStatementAsync(2026);

        Assert.True(result.IsSuccess);
        Assert.Equal(100m, result.Value.TotalRevenue);
    }

    [Fact]
    public async Task Synthesis_IncludesValidatedAutoEntry_ExcludesManualDraftOfSamePeriod()
    {
        await using (var ctx = _factory.CreateContext())
        {
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create("607", "Achats", 6, null, AccountNatureType.Debit).Value);
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create("401", "Fournisseurs", 4, null, AccountNatureType.Credit).Value);

            var autoLines = new[]
            {
                new JournalLineInput("607", "Achats", 100m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("401", "Fournisseur", 0m, 100m, null, ThirdPartyKind.None)
            };
            var auto = JournalEntry.Create(
                30, "JA", new DateTime(2026, 5, 16), "Facture fournisseur", Guid.NewGuid(),
                true, "SupplierInvoice", Guid.NewGuid(), autoLines,
                initialStatus: JournalEntryStatus.Validee).Value;
            auto.SetAuditInfo("system", false);

            var draftLines = new[]
            {
                new JournalLineInput("607", "Achats brouillon", 40m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("401", "Fournisseur brouillon", 0m, 40m, null, ThirdPartyKind.None)
            };
            var draft = JournalEntry.Create(
                31, "JA", new DateTime(2026, 5, 16), "OD manuelle", Guid.NewGuid(),
                false, "Manual", null, draftLines,
                initialStatus: JournalEntryStatus.Brouillon).Value;
            draft.SetAuditInfo("user", false);

            ctx.JournalEntries.Add(auto);
            ctx.JournalEntries.Add(draft);
            await ctx.SaveChangesAsync();
        }

        var service = BuildService(includeDrafts: true);
        var income = await service.GetIncomeStatementAsync(2026);
        var balance = await service.GetBalanceSheetAsync(2026);

        Assert.True(income.IsSuccess);
        Assert.Equal(100m, income.Value.TotalExpenses);
        Assert.Equal(100m, income.Value.Expenses.Single(e => e.AccountNumber == "607").Amount);

        Assert.True(balance.IsSuccess);
        var supplier = balance.Value.Liabilities.Single(l => l.AccountNumber == "401");
        Assert.Equal(100m, supplier.Amount);
    }

    [Fact]
    public async Task SumDebitsByAccount_AlwaysExcludesDrafts()
    {
        var repo = new JournalEntryRepository(_factory);

        var sum = await repo.SumDebitsByAccountAsync("4111", From, To);

        Assert.Equal(100m, sum);
    }

    private static JournalEntry MakeRentEntry(
        int number, string account, decimal debit, JournalEntryStatus status, DateTime date)
    {
        var lines = new[]
        {
            new JournalLineInput(account, "Loyer", debit, 0m, null, ThirdPartyKind.None),
            new JournalLineInput("5411", "Caisse", 0m, debit, null, ThirdPartyKind.None)
        };
        var entry = JournalEntry.Create(
            number, "JC", date, $"Loyer {number}", Guid.NewGuid(),
            false, "CashOperation", null, lines, initialStatus: status).Value;
        entry.SetAuditInfo("test", false);
        return entry;
    }

    [Fact]
    public async Task SumDebitsByAccountPrefix_613_IncludesValidatedRootAndSubAccount_ExcludesDrafts()
    {
        var repo = new JournalEntryRepository(_factory);
        var date = new DateTime(2026, 8, 15);
        await using (var ctx = _factory.CreateContext())
        {
            ctx.JournalEntries.Add(MakeRentEntry(20, "613", 750m, JournalEntryStatus.Validee, date));
            ctx.JournalEntries.Add(MakeRentEntry(21, "6132", 600m, JournalEntryStatus.Validee, date));
            ctx.JournalEntries.Add(MakeRentEntry(22, "613", 400m, JournalEntryStatus.Brouillon, date));
            await ctx.SaveChangesAsync();
        }

        var sum = await repo.SumDebitsByAccountPrefixAsync(
            "613", new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));

        Assert.Equal(1_350m, sum);
    }

    // ── Non-régression : édition cabinet d'un brouillon (plan v3, tâche 7) ──────────────────
    // Le brouillard est par nature provisoire : une édition cabinet d'un brouillon doit se
    // refléter IMMÉDIATEMENT dans les écrans de consultation (brouillard inclus) — comportement
    // voulu (plan §1.4/§5), couvert ici en non-régression.

    /// <summary>Mock <see cref="ICurrentUser"/> minimal : seul <see cref="IsAccountingFirmDelegatedContext"/> est paramétrable.</summary>
    private sealed class FakeCurrentUser : ICurrentUser
    {
        public bool IsAccountingFirmDelegatedContext { get; set; }
        public Guid? UserId => null;
        public string? Email => "comptable@cabinet.tn";
        public Guid? TenantId => null;
        public UserRole? Role => null;
        public bool IsAuthenticated => true;
        public bool HasPermission(string permission) => true;
        public Guid? PortalClientId => null;
        public bool IsClientPortal => false;
        public string? IpAddress => null;
        public string? UserAgent => null;
    }

    /// <summary>Modèle : <c>ValidatePurchaseReceiptCommandHandlerTests.cs</c> — pas de transaction,
    /// l'atomicité réelle est prouvée par les tests SQL (tâche 5, hors périmètre ici).</summary>
    private sealed class PassthroughTenantUnitOfWork : ITenantUnitOfWork
    {
        public Task<Result> ExecuteAsync(
            Func<CancellationToken, Task<Result>> action,
            CancellationToken cancellationToken = default)
            => action(cancellationToken);

        public Task<Result<T>> ExecuteAsync<T>(
            Func<CancellationToken, Task<Result<T>>> action,
            CancellationToken cancellationToken = default)
            => action(cancellationToken);
    }

    /// <summary>Période comptable réelle requise par <c>GetByIdForUpdateAsync</c> (Include AccountingPeriod).</summary>
    private async Task<AccountingPeriod> SeedPeriodAsync(int year, int month)
    {
        var start = new DateTime(year, month, 1);
        var period = AccountingPeriod.Create(year, month, start, start.AddMonths(1).AddDays(-1));
        period.SetAuditInfo("test", false);
        await using var ctx = _factory.CreateContext();
        ctx.AccountingPeriods.Add(period);
        await ctx.SaveChangesAsync();
        return period;
    }

    private UpdateDraftJournalEntryCommandHandler BuildUpdateHandler(
        IJournalEntryRepository repository, bool isFirm = true)
    {
        var lettering = new LetteringService(_factory, new TenantAmbientTransaction());
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string acc, CancellationToken _) =>
                ChartOfAccount.Create(acc, $"Compte {acc}", int.Parse(acc[..1]), null, AccountNatureType.Debit).Value);
        return new UpdateDraftJournalEntryCommandHandler(
            repository, chart.Object, new Mock<IAuditService>().Object,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = isFirm },
            lettering,
            new PassthroughTenantUnitOfWork(),
            new FakeExchangeRateResolver(),
            NullLogger<UpdateDraftJournalEntryCommandHandler>.Instance);
    }

    private static UpdateDraftJournalEntryRequest ManualRequest(decimal amount, string label) => new()
    {
        Label = label,
        Lines = new[]
        {
            new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = amount, Credit = 0m },
            new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Vente", Debit = 0m, Credit = amount }
        }
    };

    private static UpdateDraftJournalEntryRequest CashRequest(decimal ht, decimal vat, string label) => new()
    {
        Label = label,
        Lines = new[]
        {
            new ManualJournalLineRequest { AccountNumber = "5411", LineLabel = "Caisse", Debit = ht + vat, Credit = 0m },
            new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Ventes HT", Debit = 0m, Credit = ht },
            new ManualJournalLineRequest { AccountNumber = "436711", LineLabel = "TVA collectée", Debit = 0m, Credit = vat }
        }
    };

    [Fact]
    public async Task Balance_AfterFirmEditOfDraft_ReflectsEditedLines_WhenBrouillardIncluded()
    {
        var period = await SeedPeriodAsync(2026, 5);
        var draft = MakeEntry(3, 50m, JournalEntryStatus.Brouillon, period.Id);
        await using (var ctx = _factory.CreateContext())
        {
            ctx.JournalEntries.Add(draft);
            await ctx.SaveChangesAsync();
        }

        var repository = new JournalEntryRepository(_factory);
        var editResult = await BuildUpdateHandler(repository).Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, ManualRequest(200m, "Vente corrigée par le cabinet")),
            CancellationToken.None);
        Assert.True(editResult.IsSuccess, editResult.Error?.Description);

        var on = await BuildService(includeDrafts: true).GetBalanceAsync(From, To);
        var off = await BuildService(includeDrafts: false).GetBalanceAsync(From, To);

        // 100 (validée) + 50 (brouillon initial, non touché) + 200 (brouillon édité par le
        // cabinet) = 350 quand le brouillard est inclus.
        Assert.Equal(350m, on.Value.Single(r => r.AccountNumber == "4111").MovementDebit);
        // Hors brouillard : seule l'écriture validée reste — le brouillon édité disparaît toujours.
        Assert.Equal(100m, off.Value.Single(r => r.AccountNumber == "4111").MovementDebit);
    }

    [Fact]
    public async Task Dashboard_AfterFirmEditOfCashDraft_VatAndRevenueFollowEditedLines()
    {
        var now = DateTime.UtcNow;
        var period = await SeedPeriodAsync(now.Year, now.Month);
        var lines = new[]
        {
            new JournalLineInput("5411", "Caisse", 119m, 0m, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Ventes HT", 0m, 100m, null, ThirdPartyKind.None),
            new JournalLineInput("436711", "TVA collectée", 0m, 19m, null, ThirdPartyKind.None)
        };
        var draft = JournalEntry.Create(
            10, "JC", new DateTime(now.Year, now.Month, 10), "Encaissement ventes au comptant", period.Id,
            isAutoGenerated: true, sourceEntityType: "CashOperation", sourceEntityId: Guid.NewGuid(),
            lineInputs: lines, initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);
        await using (var ctx = _factory.CreateContext())
        {
            ctx.JournalEntries.Add(draft);
            await ctx.SaveChangesAsync();
        }

        var before = await BuildService(includeDrafts: true).GetDashboardAsync();
        Assert.True(before.IsSuccess);
        Assert.Equal(19m, before.Value.VatDueEstimate);
        Assert.Equal(100m, before.Value.MonthlyRevenue);

        var repository = new JournalEntryRepository(_factory);
        var editResult = await BuildUpdateHandler(repository).Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, CashRequest(200m, 38m, "Corrigé par le cabinet")),
            CancellationToken.None);
        Assert.True(editResult.IsSuccess, editResult.Error?.Description);

        var after = await BuildService(includeDrafts: true).GetDashboardAsync();
        Assert.True(after.IsSuccess);
        // TVA et CA estimés suivent immédiatement les lignes ÉDITÉES par le cabinet (§1.4/§5).
        Assert.Equal(38m, after.Value.VatDueEstimate);
        Assert.Equal(200m, after.Value.MonthlyRevenue);
    }
}
