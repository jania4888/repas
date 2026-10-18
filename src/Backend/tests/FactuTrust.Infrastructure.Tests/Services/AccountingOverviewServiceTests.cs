using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Tableau de bord comptable du dossier délégué (plan §3.4 / §6) : KPI du mois, comparaisons,
/// graphiques, comptes principaux, blocs récents, résolution de période et cache.
/// </summary>
public sealed class AccountingOverviewServiceTests
{
    private static readonly DateTime Today = new(2026, 10, 18);
    private static readonly Guid TenantId = Guid.NewGuid();

    private readonly TestTenantDbContextFactory _factory;
    private readonly Guid _entryWithAttachmentId;
    private readonly Guid _deadlineId;

    public AccountingOverviewServiceTests()
    {
        _factory = new TestTenantDbContextFactory($"OverviewDb_{Guid.NewGuid()}");
        (_entryWithAttachmentId, _deadlineId) = Seed();
    }

    // ── Infrastructure de test ───────────────────────────────────────────────────────────────

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

    private sealed class FixedTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _now;
        public FixedTimeProvider(DateTime localDate) => _now = new DateTimeOffset(localDate, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }

    private static JournalEntry Entry(
        int number, string journalCode, DateTime date, string debitAccount, string creditAccount,
        decimal amount, JournalEntryStatus status = JournalEntryStatus.Validee)
    {
        var lines = new[]
        {
            new JournalLineInput(debitAccount, "Débit", amount, 0m, null, ThirdPartyKind.None),
            new JournalLineInput(creditAccount, "Crédit", 0m, amount, null, ThirdPartyKind.None)
        };
        var entry = JournalEntry.Create(
            number, journalCode, date, $"Pièce {number}", Guid.NewGuid(),
            false, "Manual", null, lines, initialStatus: status).Value;
        entry.SetAuditInfo("test", false);
        return entry;
    }

    private (Guid entryWithAttachmentId, Guid deadlineId) Seed()
    {
        using var ctx = _factory.CreateContext();

        var e1 = Entry(1, "JV", new DateTime(2026, 1, 10), "4111", "707", 1000m);
        var e2 = Entry(2, "JA", new DateTime(2026, 2, 5), "607", "401", 300m);
        var e3 = Entry(3, "JB", new DateTime(2026, 2, 15), "532", "4111", 800m);
        var e4 = Entry(4, "JV", new DateTime(2026, 2, 20), "4111", "707", 500m);
        var e5 = Entry(5, "OD", new DateTime(2026, 2, 25), "613", "401", 100m);
        var e6 = Entry(6, "OD", new DateTime(2026, 2, 27), "641", "421", 50m);
        var prevDec = Entry(7, "JV", new DateTime(2025, 12, 10), "4111", "707", 2000m);
        var prevFeb = Entry(8, "JV", new DateTime(2025, 2, 10), "4111", "707", 400m);
        var draft = Entry(9, "JV", new DateTime(2026, 2, 28), "4111", "707", 9999m, JournalEntryStatus.Brouillon);
        ctx.JournalEntries.AddRange(e1, e2, e3, e4, e5, e6, prevDec, prevFeb, draft);

        ctx.JournalEntryAttachments.Add(JournalEntryAttachment.Create(
            e4.Id, "facture-4.pdf", "/secret/storage/facture-4.pdf", "application/pdf", 1234).Value);

        var deadline = FiscalScheduleEntry.Create(
            FiscalObligationType.MonthlyDeclaration, "Déclaration mensuelle octobre", 2026,
            new DateTime(2026, 10, 28), 1200m).Value;
        var cancelled = FiscalScheduleEntry.Create(
            FiscalObligationType.WithholdingTax, "Annulée", 2026, new DateTime(2026, 10, 20), 10m).Value;
        cancelled.Cancel();
        var paid = FiscalScheduleEntry.Create(
            FiscalObligationType.WithholdingTax, "Payée", 2026, new DateTime(2026, 10, 22), 10m).Value;
        paid.CapturePayment(new DateTime(2026, 10, 1));
        var past = FiscalScheduleEntry.Create(
            FiscalObligationType.WithholdingTax, "Passée", 2026, new DateTime(2026, 9, 28), 10m).Value;
        ctx.FiscalScheduleEntries.AddRange(deadline, cancelled, paid, past);

        ctx.FiscalScheduleAttachments.Add(FiscalScheduleAttachment.Create(
            deadline.Id, "quittance.pdf", "application/pdf", 999, "/secret/storage/quittance.pdf").Value);

        ctx.SaveChanges();
        return (e4.Id, deadline.Id);
    }

    private AccountingOverviewService BuildService(
        DateTime? today = null, int cacheSeconds = 0, IMemoryCache? cache = null, Guid? tenantId = null)
    {
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId ?? TenantId);
        return new AccountingOverviewService(
            _factory,
            tenant.Object,
            cache ?? new MemoryCache(new MemoryCacheOptions()),
            new FixedTimeProvider(today ?? Today),
            Options.Create(new AccountingSettings { DashboardOverviewCacheSeconds = cacheSeconds }));
    }

    private static OverviewPeriod Feb2026 => new(2026, 2);

    // ── KPI et comparaisons ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Overview_PreviousMonth_ComputesMonthKpis()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(2026, dto.FiscalYear);
        Assert.Equal(2, dto.Month);
        Assert.Equal("Février 2026", dto.PeriodLabel);
        Assert.Equal("previous-month", dto.Comparison);
        Assert.Equal(2026, dto.ComparisonFiscalYear);
        Assert.Equal(1, dto.ComparisonMonth);
        Assert.Equal("Janvier 2026", dto.ComparisonLabel);
        Assert.Equal("TND", dto.Currency);
        Assert.True(dto.HasEntriesInPeriod);

        // Produits : le brouillon (9 999) est exclu.
        Assert.Equal(500m, dto.TotalRevenue.Current);
        Assert.Equal(1000m, dto.TotalRevenue.Previous);
        Assert.Equal(-500m, dto.TotalRevenue.DeltaAbsolute);
        Assert.Equal(-50.0m, dto.TotalRevenue.DeltaPercent);

        // Charges : 607 + 613 + 641 ; janvier sans charge → variation % nulle.
        Assert.Equal(450m, dto.TotalExpenses.Current);
        Assert.Equal(0m, dto.TotalExpenses.Previous);
        Assert.Null(dto.TotalExpenses.DeltaPercent);

        Assert.Equal(50m, dto.NetResult.Current);
        Assert.Equal(1000m, dto.NetResult.Previous);

        // Trésorerie : 532 = 800 en février, 0 en janvier.
        Assert.Equal(800m, dto.AvailableCash.Current);
        Assert.Equal(0m, dto.AvailableCash.Previous);
    }

    [Fact]
    public async Task Overview_PreviousYear_ComparesSameMonthOfPreviousYear()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousYear)).Value;

        Assert.Equal("previous-year", dto.Comparison);
        Assert.Equal(2025, dto.ComparisonFiscalYear);
        Assert.Equal(2, dto.ComparisonMonth);
        Assert.Equal(400m, dto.TotalRevenue.Previous);
        Assert.Equal(100m, dto.TotalRevenue.DeltaAbsolute);
        Assert.Equal(25.0m, dto.TotalRevenue.DeltaPercent);
    }

    [Fact]
    public async Task Overview_January_PreviousMonth_IsDecemberOfPreviousYear()
    {
        var dto = (await BuildService().GetOverviewAsync(new OverviewPeriod(2026, 1), DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(2025, dto.ComparisonFiscalYear);
        Assert.Equal(12, dto.ComparisonMonth);
        Assert.Equal(1000m, dto.TotalRevenue.Current);
        Assert.Equal(2000m, dto.TotalRevenue.Previous);
    }

    // ── Graphiques ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Overview_RevenueByMonth_Has12Points_WithPreviousYear()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(12, dto.RevenueByMonth.Count);
        Assert.Equal(new[] { "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc" },
            dto.RevenueByMonth.Select(p => p.Label));
        Assert.Equal(1000m, dto.RevenueByMonth[0].Current);
        Assert.Equal(500m, dto.RevenueByMonth[1].Current);
        Assert.Equal(400m, dto.RevenueByMonth[1].PreviousYear);
        Assert.Equal(2000m, dto.RevenueByMonth[11].PreviousYear);
        Assert.Equal(0m, dto.RevenueByMonth[11].Current);

        Assert.Equal(12, dto.NetResultByMonth.Count);
        Assert.Equal(500m, dto.NetResultByMonth[1].Revenue);
        Assert.Equal(450m, dto.NetResultByMonth[1].Expenses);
        Assert.Equal(50m, dto.NetResultByMonth[1].NetResult);
    }

    [Fact]
    public async Task Overview_ExpenseBreakdown_HasFixedSixSlices_InOrder()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(new[] { "purchases", "externalServices", "personnel", "taxes", "depreciation", "other" },
            dto.ExpenseBreakdown.Select(c => c.Key));
        Assert.Equal(300m, dto.ExpenseBreakdown[0].Amount);
        Assert.Equal(66.7m, dto.ExpenseBreakdown[0].Percent);
        Assert.Equal(100m, dto.ExpenseBreakdown[1].Amount);
        Assert.Equal(22.2m, dto.ExpenseBreakdown[1].Percent);
        Assert.Equal(50m, dto.ExpenseBreakdown[2].Amount);
        Assert.Equal(11.1m, dto.ExpenseBreakdown[2].Percent);
        Assert.Equal(0m, dto.ExpenseBreakdown[5].Amount);
        Assert.Equal(450m, dto.ExpenseBreakdown.Sum(c => c.Amount));
    }

    [Fact]
    public async Task Overview_ExpenseBreakdown_WithNoExpenses_HasZeroPercents()
    {
        var dto = (await BuildService().GetOverviewAsync(new OverviewPeriod(2026, 1), DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(6, dto.ExpenseBreakdown.Count);
        Assert.All(dto.ExpenseBreakdown, c => Assert.Equal(0m, c.Percent));
    }

    // ── Comptes principaux ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Overview_MainAccounts_UseNctPrefixes_AnchoredOpening_AndSparkline()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(new[] { "411", "401", "54", "532", "43666", "43671", "432", "434", "70" },
            dto.MainAccounts.Select(r => r.AccountPrefix));

        // 411 : ouverture 2025 (2 000 + 400) + janvier 1 000 + février (500 − 800).
        var clients = dto.MainAccounts.Single(r => r.AccountPrefix == "411");
        Assert.Equal("Debit", clients.Nature);
        Assert.Equal(3100m, clients.Balance);
        Assert.Equal(3400m, clients.PreviousBalance);
        Assert.Equal(-300m, clients.DeltaAbsolute);
        Assert.Equal(-8.8m, clients.DeltaPercent);
        Assert.Equal(new[] { 3400m, 3100m }, clients.Sparkline);

        // 401 : solde créditeur en signe brut (débit − crédit).
        var suppliers = dto.MainAccounts.Single(r => r.AccountPrefix == "401");
        Assert.Equal("Credit", suppliers.Nature);
        Assert.Equal(-400m, suppliers.Balance);
        Assert.Equal(0m, suppliers.PreviousBalance);
        Assert.Null(suppliers.DeltaPercent);

        // 70 : les comptes de gestion ne reportent jamais l'ouverture.
        var sales = dto.MainAccounts.Single(r => r.AccountPrefix == "70");
        Assert.Equal(-1500m, sales.Balance);
    }

    // ── Blocs récents ────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Overview_RecentEntries_ExcludeDrafts_LatestFirst_WithTotals()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(5, dto.RecentEntries.Count);
        Assert.DoesNotContain(dto.RecentEntries, e => e.EntryNumber == 9);
        Assert.Equal(6, dto.RecentEntries[0].EntryNumber);
        Assert.Equal(50m, dto.RecentEntries[0].TotalDebit);
        Assert.Equal(50m, dto.RecentEntries[0].TotalCredit);
        Assert.Equal("OD", dto.RecentEntries[0].JournalCode);
        Assert.True(dto.RecentEntries.Zip(dto.RecentEntries.Skip(1))
            .All(pair => pair.First.EntryDate >= pair.Second.EntryDate));
    }

    [Fact]
    public async Task Overview_UpcomingDeadlines_ExcludeCancelled_Paid_AndPast()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        var deadline = Assert.Single(dto.UpcomingDeadlines);
        Assert.Equal(_deadlineId, deadline.Id);
        Assert.Equal("Déclaration mensuelle octobre", deadline.ObligationLabel);
        Assert.Equal(10, deadline.DaysRemaining);
        Assert.Equal(1200m, deadline.EstimatedAmount);
        Assert.Equal((int)FiscalScheduleStatus.UpcomingAfter7Days, deadline.Status);
        Assert.False(string.IsNullOrWhiteSpace(deadline.StatusDisplay));
    }

    [Fact]
    public async Task Overview_RecentDocuments_MergeBothSources_WithDownloadPath_WithoutStoragePath()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(2, dto.RecentDocuments.Count);

        var journalDoc = dto.RecentDocuments.Single(d => d.Source == "journal-entry");
        Assert.Equal(_entryWithAttachmentId, journalDoc.OwnerId);
        Assert.Equal("facture-4.pdf", journalDoc.FileName);
        Assert.Equal($"/api/accounting/journal/{_entryWithAttachmentId}/attachments/{journalDoc.Id}/download", journalDoc.DownloadPath);
        Assert.Contains("JV n°4", journalDoc.OwnerLabel);

        var fiscalDoc = dto.RecentDocuments.Single(d => d.Source == "fiscal-schedule");
        Assert.Equal(_deadlineId, fiscalDoc.OwnerId);
        Assert.Equal($"/api/accounting/fiscal-schedule/{_deadlineId}/attachments/{fiscalDoc.Id}/download", fiscalDoc.DownloadPath);
        Assert.Equal("Déclaration mensuelle octobre", fiscalDoc.OwnerLabel);

        Assert.All(dto.RecentDocuments, d => Assert.DoesNotContain("/secret/storage", d.DownloadPath));
    }

    [Fact]
    public async Task Overview_AvailableYears_IncludePostedYears_AndCurrentYear_Descending()
    {
        var dto = (await BuildService(today: new DateTime(2027, 3, 1)).GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(new[] { 2027, 2026, 2025 }, dto.AvailableYears);
    }

    [Fact]
    public async Task Overview_RecentDocuments_ExcludeAttachmentsOfDraftEntries()
    {
        using (var ctx = _factory.CreateContext())
        {
            // Pièce jointe la plus récente, mais rattachée à une écriture en brouillon : jamais exposée.
            var draft = ctx.JournalEntries.Single(e => e.Status == JournalEntryStatus.Brouillon);
            ctx.JournalEntryAttachments.Add(JournalEntryAttachment.Create(
                draft.Id, "brouillon.pdf", "/secret/storage/brouillon.pdf", "application/pdf", 10).Value);
            ctx.SaveChanges();
        }

        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Equal(2, dto.RecentDocuments.Count);
        Assert.DoesNotContain(dto.RecentDocuments, d => d.FileName == "brouillon.pdf");
    }

    [Fact]
    public async Task Overview_JanuaryWithOnlyOpeningEntry_IsNotFlaggedEmpty()
    {
        using (var ctx = _factory.CreateContext())
        {
            // Exercice 2027 : seule l'écriture d'à-nouveau (exclue des mouvements) est datée de janvier.
            var lines = new[]
            {
                new JournalLineInput("4111", "À-nouveau clients", 700m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("101", "À-nouveau capital", 0m, 700m, null, ThirdPartyKind.None)
            };
            var opening = JournalEntry.Create(
                100, "AN", new DateTime(2027, 1, 1), "À-nouveau 2027", Guid.NewGuid(),
                true, AccountingService.SourceOpeningBalance, Guid.NewGuid(), lines,
                initialStatus: JournalEntryStatus.Validee).Value;
            opening.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(opening);
            ctx.SaveChanges();
        }

        var dto = (await BuildService().GetOverviewAsync(new OverviewPeriod(2027, 1), DashboardComparison.PreviousMonth)).Value;

        Assert.True(dto.HasEntriesInPeriod);
        Assert.Equal(0m, dto.TotalRevenue.Current);
        Assert.Equal(700m, dto.MainAccounts.Single(a => a.AccountPrefix == "411").Balance);
    }

    [Fact]
    public async Task Overview_MonthWithoutEntries_FlagsEmptyPeriod_WithZeroKpis()
    {
        var dto = (await BuildService().GetOverviewAsync(new OverviewPeriod(2026, 5), DashboardComparison.PreviousMonth)).Value;

        Assert.False(dto.HasEntriesInPeriod);
        Assert.Equal(0m, dto.TotalRevenue.Current);
        Assert.Equal(0m, dto.TotalExpenses.Current);
        // La trésorerie (classe 5) se reporte : 800 reste disponible en mai.
        Assert.Equal(800m, dto.AvailableCash.Current);
    }

    [Fact]
    public async Task Overview_LeavesThirdPartyBlocks_ToHandler()
    {
        var dto = (await BuildService().GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.Null(dto.Clients);
        Assert.Null(dto.Suppliers);
        Assert.Empty(dto.Warnings);
    }

    // ── Résolution de période ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ResolvePeriod_BothProvided_IsReturnedAsIs()
    {
        var period = await BuildService().ResolvePeriodAsync(2024, 7);
        Assert.Equal(new OverviewPeriod(2024, 7), period);
    }

    [Fact]
    public async Task ResolvePeriod_YearOnly_CurrentYear_UsesCurrentMonth()
    {
        var period = await BuildService().ResolvePeriodAsync(2026, null);
        Assert.Equal(new OverviewPeriod(2026, 10), period);
    }

    [Fact]
    public async Task ResolvePeriod_YearOnly_OtherYear_UsesDecember()
    {
        var period = await BuildService().ResolvePeriodAsync(2025, null);
        Assert.Equal(new OverviewPeriod(2025, 12), period);
    }

    [Fact]
    public async Task ResolvePeriod_Nothing_WithEntriesThisYear_UsesToday()
    {
        var period = await BuildService().ResolvePeriodAsync(null, null);
        Assert.Equal(new OverviewPeriod(2026, 10), period);
    }

    [Fact]
    public async Task ResolvePeriod_Nothing_WithoutEntriesThisYear_FallsBackToLatestPostedPeriod()
    {
        var period = await BuildService(today: new DateTime(2027, 3, 1)).ResolvePeriodAsync(null, null);
        // Le brouillon du 28/02/2026 n'est pas pris en compte ; la dernière écriture validée est du 27/02/2026.
        Assert.Equal(new OverviewPeriod(2026, 2), period);
    }

    [Fact]
    public async Task ResolvePeriod_EmptyDossier_UsesToday()
    {
        var empty = new TestTenantDbContextFactory($"OverviewEmpty_{Guid.NewGuid()}");
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(TenantId);
        var service = new AccountingOverviewService(
            empty, tenant.Object, new MemoryCache(new MemoryCacheOptions()), new FixedTimeProvider(Today),
            Options.Create(new AccountingSettings()));

        var period = await service.ResolvePeriodAsync(null, null);
        Assert.Equal(new OverviewPeriod(2026, 10), period);

        var dto = (await service.GetOverviewAsync(period, DashboardComparison.PreviousMonth)).Value;
        Assert.False(dto.HasEntriesInPeriod);
        Assert.Equal(new[] { 2026 }, dto.AvailableYears);
        Assert.Empty(dto.RecentEntries);
        Assert.Equal(9, dto.MainAccounts.Count);
        Assert.Equal(6, dto.ExpenseBreakdown.Count);
    }

    // ── Cache ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Overview_WithCacheEnabled_ServesCachedResult_PerTenantAndPeriod()
    {
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = BuildService(cacheSeconds: 30, cache: cache);

        var first = (await service.GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        await using (var ctx = _factory.CreateContext())
        {
            ctx.JournalEntries.Add(Entry(10, "JV", new DateTime(2026, 2, 21), "4111", "707", 250m));
            await ctx.SaveChangesAsync();
        }

        var second = (await service.GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;
        Assert.Same(first, second);

        // Autre fenêtre de comparaison → autre clé → recalcul avec la nouvelle écriture.
        var otherWindow = (await service.GetOverviewAsync(Feb2026, DashboardComparison.PreviousYear)).Value;
        Assert.Equal(750m, otherWindow.TotalRevenue.Current);

        // Autre tenant → autre clé.
        var otherTenant = BuildService(cacheSeconds: 30, cache: cache, tenantId: Guid.NewGuid());
        var third = (await otherTenant.GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;
        Assert.NotSame(first, third);
        Assert.Equal(750m, third.TotalRevenue.Current);
    }

    [Fact]
    public async Task Overview_WithCacheDisabled_Recomputes()
    {
        var service = BuildService(cacheSeconds: 0);

        var first = (await service.GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;
        var second = (await service.GetOverviewAsync(Feb2026, DashboardComparison.PreviousMonth)).Value;

        Assert.NotSame(first, second);
    }

    // ── Utilitaires ──────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(150, 100, 50.0)]
    [InlineData(50, 100, -50.0)]
    [InlineData(-50, -100, 50.0)]
    [InlineData(100, 300, -66.7)]
    public void DeltaPercent_RoundsToOneDecimal_RelativeToAbsolutePrevious(decimal current, decimal previous, decimal expected)
    {
        Assert.Equal(expected, AccountingOverviewService.DeltaPercent(current, previous));
    }

    [Fact]
    public void DeltaPercent_IsNull_WhenPreviousIsZero()
    {
        Assert.Null(AccountingOverviewService.DeltaPercent(10m, 0m));
    }

    [Theory]
    [InlineData(2026, 10, "Octobre 2026")]
    [InlineData(2026, 8, "Août 2026")]
    [InlineData(2025, 12, "Décembre 2025")]
    public void PeriodLabel_IsFrenchCapitalised(int year, int month, string expected)
    {
        Assert.Equal(expected, AccountingOverviewService.PeriodLabel(year, month));
    }
}
