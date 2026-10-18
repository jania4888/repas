using System.Globalization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Interfaces.Treasury;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.FiscalSchedule;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Tableau de bord comptable du dossier délégué (plan §3.4). Lecture seule, écritures validées
/// uniquement (<c>Status != Brouillon</c>), exercice = année civile. Soldes des classes 4-5 ancrés
/// sur l'à-nouveau via <see cref="FiscalAnchorHelper"/> (même convention que la balance et le
/// grand livre) ; produits/charges = mouvements de l'exercice seuls.
/// </summary>
public sealed class AccountingOverviewService : IAccountingOverviewService
{
    private const string CachePrefix = "accounting-overview";

    private static readonly string[] MonthLabels =
        { "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc" };

    private static readonly CultureInfo FrenchCulture = CultureInfo.GetCultureInfo("fr-FR");

    /// <summary>Comptes principaux du plan NCT suivis au tableau de bord (ordre d'affichage fixe).</summary>
    private static readonly (string Prefix, string Label, string Nature)[] MainAccountDefinitions =
    {
        ("411", "Clients", "Debit"),
        ("401", "Fournisseurs", "Credit"),
        ("54", "Caisse", "Debit"),
        ("532", "Banques", "Debit"),
        ("43666", "TVA déductible", "Debit"),
        ("43671", "TVA collectée", "Credit"),
        ("432", "État, retenues à la source", "Credit"),
        ("434", "État, impôt sur les bénéfices", "Credit"),
        ("70", "Ventes", "Credit"),
    };

    /// <summary>Familles de charges (classe 6), ordre fixe ; la dernière absorbe le reste de la classe.</summary>
    private static readonly (string Key, string Label, string[] Prefixes)[] ExpenseCategories =
    {
        ("purchases", "Achats", new[] { "60" }),
        ("externalServices", "Services extérieurs", new[] { "61", "62" }),
        ("personnel", "Charges de personnel", new[] { "64" }),
        ("taxes", "Impôts et taxes", new[] { "66" }),
        ("depreciation", "Dotations aux amortissements", new[] { "68" }),
        ("other", "Autres charges", Array.Empty<string>()),
    };

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ITenantContext _tenantContext;
    private readonly IMemoryCache _cache;
    private readonly TimeProvider _timeProvider;
    private readonly Application.Configuration.AccountingSettings _settings;
    private readonly ILogger<AccountingOverviewService> _logger;

    public AccountingOverviewService(
        ITenantDbContextFactory contextFactory,
        ITenantContext tenantContext,
        IMemoryCache cache,
        TimeProvider timeProvider,
        IOptions<Application.Configuration.AccountingSettings> settings,
        ILogger<AccountingOverviewService> logger)
    {
        _contextFactory = contextFactory;
        _tenantContext = tenantContext;
        _cache = cache;
        _timeProvider = timeProvider;
        _settings = settings.Value;
        _logger = logger;
    }

    private DateTime Today => _timeProvider.GetLocalNow().Date;

    // ── Période ──────────────────────────────────────────────────────────────────────────────

    public async Task<OverviewPeriod> ResolvePeriodAsync(int? fiscalYear, int? month, CancellationToken cancellationToken = default)
    {
        var today = Today;

        if (fiscalYear.HasValue && month.HasValue)
            return new OverviewPeriod(fiscalYear.Value, month.Value);

        if (fiscalYear.HasValue)
            return new OverviewPeriod(fiscalYear.Value, fiscalYear.Value == today.Year ? today.Month : 12);

        await using var ctx = _contextFactory.CreateContext();
        var posted = PostedEntries(ctx);

        var yearStart = new DateTime(today.Year, 1, 1);
        var hasCurrentYear = await posted.AnyAsync(e => e.EntryDate >= yearStart, cancellationToken);
        if (hasCurrentYear)
            return new OverviewPeriod(today.Year, today.Month);

        var latest = await posted
            .OrderByDescending(e => e.EntryDate)
            .Select(e => (DateTime?)e.EntryDate)
            .FirstOrDefaultAsync(cancellationToken);

        return latest.HasValue
            ? new OverviewPeriod(latest.Value.Year, latest.Value.Month)
            : new OverviewPeriod(today.Year, today.Month);
    }

    // ── Cœur du tableau de bord ───────────────────────────────────────────────────────────────

    public async Task<Result<AccountingOverviewDashboardDto>> GetOverviewAsync(
        OverviewPeriod period, DashboardComparison comparison, CancellationToken cancellationToken = default)
    {
        if (period.Month is < 1 or > 12 || period.FiscalYear is < 1 or > 9999)
            return Result.Failure<AccountingOverviewDashboardDto>(Error.Validation("Period", "Période invalide."));

        var ttl = _settings.DashboardOverviewCacheSeconds;
        var tenantId = _tenantContext.TenantId;
        if (ttl <= 0 || tenantId is null)
            return await ComputeAsync(period, comparison, cancellationToken);

        var key = $"{CachePrefix}:{tenantId}:{period.FiscalYear}:{period.Month}:{comparison.ToCode()}";
        if (_cache.TryGetValue<AccountingOverviewDashboardDto>(key, out var cached) && cached is not null)
            return Result.Success(cached);

        var result = await ComputeAsync(period, comparison, cancellationToken);
        if (result.IsSuccess)
            _cache.Set(key, result.Value, TimeSpan.FromSeconds(ttl));
        return result;
    }

    private async Task<Result<AccountingOverviewDashboardDto>> ComputeAsync(
        OverviewPeriod period, DashboardComparison comparison, CancellationToken ct)
    {
        var today = Today;
        var n = period.FiscalYear;
        var m = period.Month;
        var p = n - 1;

        var (cmpYear, cmpMonth) = comparison == DashboardComparison.PreviousYear
            ? (p, m)
            : m == 1 ? (p, 12) : (n, m - 1);

        await using var ctx = _contextFactory.CreateContext();

        var current = await LoadYearAsync(ctx, n, ct);
        var previous = await LoadYearAsync(ctx, p, ct);
        YearData DataFor(int year) => year == n ? current : previous;

        // KPI du mois sélectionné vs fenêtre de comparaison.
        var cmpData = DataFor(cmpYear);
        var totalRevenue = Kpi(current.Revenue(m), cmpData.Revenue(cmpMonth));
        var totalExpenses = Kpi(current.Expenses(m), cmpData.Expenses(cmpMonth));
        var netResult = Kpi(current.Revenue(m) - current.Expenses(m), cmpData.Revenue(cmpMonth) - cmpData.Expenses(cmpMonth));
        var availableCash = Kpi(
            TreasuryAccountRoots.RoundBalance(current.BalanceAt(m, TreasuryAccountRoots.IsTreasuryAccount)),
            TreasuryAccountRoots.RoundBalance(cmpData.BalanceAt(cmpMonth, TreasuryAccountRoots.IsTreasuryAccount)));

        // Graphiques (12 mois de l'exercice courant ; CA = comptes 70).
        var revenueByMonth = Enumerable.Range(1, 12).Select(month => new MonthlyRevenuePointDto
        {
            Month = month,
            Label = MonthLabels[month - 1],
            Current = current.Turnover(month),
            PreviousYear = previous.Turnover(month)
        }).ToList();

        var netResultByMonth = Enumerable.Range(1, 12).Select(month =>
        {
            var revenue = current.Revenue(month);
            var expenses = current.Expenses(month);
            return new MonthlyNetResultPointDto
            {
                Month = month,
                Label = MonthLabels[month - 1],
                Revenue = revenue,
                Expenses = expenses,
                NetResult = revenue - expenses
            };
        }).ToList();

        var expenseBreakdown = BuildExpenseBreakdown(current, m);
        var mainAccounts = BuildMainAccounts(current, cmpData, m, cmpMonth);

        var recentEntries = await LoadRecentEntriesAsync(ctx, ct);
        var upcomingDeadlines = await LoadUpcomingDeadlinesAsync(ctx, today, ct);
        var recentDocuments = await LoadRecentDocumentsAsync(ctx, ct);
        var availableYears = await LoadAvailableYearsAsync(ctx, today, ct);

        return Result.Success(new AccountingOverviewDashboardDto
        {
            FiscalYear = n,
            Month = m,
            PeriodStart = period.Start,
            PeriodEnd = period.End,
            PeriodLabel = PeriodLabel(n, m),
            Comparison = comparison.ToCode(),
            ComparisonFiscalYear = cmpYear,
            ComparisonMonth = cmpMonth,
            ComparisonLabel = PeriodLabel(cmpYear, cmpMonth),
            Currency = Money.DefaultCurrency,
            GeneratedAt = _timeProvider.GetUtcNow().UtcDateTime,
            HasEntriesInPeriod = current.HasMovements(m),
            AvailableYears = availableYears,
            TotalRevenue = totalRevenue,
            TotalExpenses = totalExpenses,
            NetResult = netResult,
            AvailableCash = availableCash,
            RevenueByMonth = revenueByMonth,
            NetResultByMonth = netResultByMonth,
            ExpenseBreakdown = expenseBreakdown,
            MainAccounts = mainAccounts,
            Clients = null,
            Suppliers = null,
            RecentEntries = recentEntries,
            UpcomingDeadlines = upcomingDeadlines,
            RecentDocuments = recentDocuments,
            Warnings = Array.Empty<string>()
        });
    }

    // ── Chargement des agrégats d'un exercice ────────────────────────────────────────────────

    private sealed record Movement(string AccountNumber, int Month, decimal Debit, decimal Credit);

    /// <summary>
    /// Agrégats d'un exercice : ouverture ancrée (classes 4-5, solde débit − crédit par compte) et
    /// mouvements par (compte, mois). Toutes les lectures de l'exercice dérivent de ces deux listes.
    /// </summary>
    private sealed class YearData
    {
        private readonly Dictionary<string, decimal> _opening;
        private readonly List<Movement> _movements;

        public YearData(Dictionary<string, decimal> opening, List<Movement> movements)
        {
            _opening = opening;
            _movements = movements;
        }

        public static YearData Empty { get; } = new(new Dictionary<string, decimal>(), new List<Movement>());

        public bool HasMovements(int month) => _movements.Any(x => x.Month == month);

        /// <summary>Produits du mois : crédit − débit de la classe 7.</summary>
        public decimal Revenue(int month) => Sum(month, a => a.StartsWith('7'), credit: true);

        /// <summary>Charges du mois : débit − crédit de la classe 6.</summary>
        public decimal Expenses(int month) => Sum(month, a => a.StartsWith('6'), credit: false);

        /// <summary>Chiffre d'affaires du mois : crédit − débit des comptes 70.</summary>
        public decimal Turnover(int month) => Sum(month, a => a.StartsWith("70", StringComparison.Ordinal), credit: true);

        /// <summary>Débit − crédit du mois pour les comptes filtrés.</summary>
        public decimal NetDebit(int month, Func<string, bool> accounts) => Sum(month, accounts, credit: false);

        /// <summary>Solde (débit − crédit) en fin de mois : ouverture + mouvements de janvier au mois.</summary>
        public decimal BalanceAt(int month, Func<string?, bool> accounts)
        {
            var opening = _opening.Where(kv => accounts(kv.Key)).Sum(kv => kv.Value);
            var moves = _movements
                .Where(x => x.Month <= month && accounts(x.AccountNumber))
                .Sum(x => x.Debit - x.Credit);
            return opening + moves;
        }

        private decimal Sum(int month, Func<string, bool> accounts, bool credit)
        {
            var total = 0m;
            foreach (var x in _movements)
            {
                if (x.Month != month || !accounts(x.AccountNumber)) continue;
                total += credit ? x.Credit - x.Debit : x.Debit - x.Credit;
            }
            return total;
        }
    }

    private static IQueryable<JournalEntry> PostedEntries(TenantDbContext ctx) =>
        ctx.JournalEntries.AsNoTracking().Where(e => e.Status != JournalEntryStatus.Brouillon);

    private static IQueryable<JournalEntryLine> PostedLines(TenantDbContext ctx) =>
        ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

    private static async Task<YearData> LoadYearAsync(TenantDbContext ctx, int year, CancellationToken ct)
    {
        if (year < 1 || year > 9999)
            return YearData.Empty;

        var from = new DateTime(year, 1, 1);
        var to = new DateTime(year, 12, 31);
        var anchor = await FiscalAnchorHelper.ResolveFiscalAnchorAsync(ctx, from, ct);
        var source = PostedLines(ctx);

        // Q3/Q4 — ouverture ancrée des classes 4 et 5 (les classes 6-7 ne se reportent jamais).
        var opening = await FiscalAnchorHelper.OpeningLines(source, anchor, from)
            .Where(l => l.AccountNumber.StartsWith("4") || l.AccountNumber.StartsWith("5"))
            .GroupBy(l => l.AccountNumber)
            .Select(g => new { AccountNumber = g.Key, Balance = g.Sum(l => l.DebitAmount.Amount) - g.Sum(l => l.CreditAmount.Amount) })
            .ToListAsync(ct);

        // Q1/Q2 — mouvements de l'exercice par (compte, mois).
        var movements = await FiscalAnchorHelper.MovementLines(source, anchor, from, to)
            .GroupBy(l => new { l.AccountNumber, l.JournalEntry.EntryDate.Month })
            .Select(g => new Movement(
                g.Key.AccountNumber,
                g.Key.Month,
                g.Sum(l => l.DebitAmount.Amount),
                g.Sum(l => l.CreditAmount.Amount)))
            .ToListAsync(ct);

        return new YearData(opening.ToDictionary(x => x.AccountNumber, x => x.Balance), movements);
    }

    // ── Blocs calculés ───────────────────────────────────────────────────────────────────────

    private static List<ExpenseCategoryDto> BuildExpenseBreakdown(YearData data, int month)
    {
        var total = data.Expenses(month);
        var assigned = 0m;
        var result = new List<ExpenseCategoryDto>(ExpenseCategories.Length);

        foreach (var (key, label, prefixes) in ExpenseCategories)
        {
            decimal amount;
            if (prefixes.Length == 0)
            {
                amount = total - assigned;
            }
            else
            {
                amount = data.NetDebit(month, a => prefixes.Any(prefix => a.StartsWith(prefix, StringComparison.Ordinal)));
                assigned += amount;
            }

            result.Add(new ExpenseCategoryDto
            {
                Key = key,
                Label = label,
                Amount = amount,
                Percent = total == 0m ? 0m : Math.Round(amount / total * 100m, 1, MidpointRounding.AwayFromZero)
            });
        }

        return result;
    }

    private static List<MainAccountRowDto> BuildMainAccounts(YearData current, YearData cmpData, int month, int cmpMonth)
    {
        var rows = new List<MainAccountRowDto>(MainAccountDefinitions.Length);
        foreach (var (prefix, label, nature) in MainAccountDefinitions)
        {
            bool Match(string? a) => a is not null && a.StartsWith(prefix, StringComparison.Ordinal);

            var balance = current.BalanceAt(month, Match);
            var previousBalance = cmpData.BalanceAt(cmpMonth, Match);
            var sparkline = Enumerable.Range(1, month).Select(mm => current.BalanceAt(mm, Match)).ToList();

            rows.Add(new MainAccountRowDto
            {
                AccountPrefix = prefix,
                Label = label,
                Nature = nature,
                Balance = balance,
                PreviousBalance = previousBalance,
                DeltaAbsolute = balance - previousBalance,
                DeltaPercent = DeltaPercent(balance, previousBalance),
                Sparkline = sparkline
            });
        }
        return rows;
    }

    private static async Task<List<RecentJournalEntryDto>> LoadRecentEntriesAsync(TenantDbContext ctx, CancellationToken ct)
    {
        // Q5 — 5 dernières écritures validées.
        var entries = await PostedEntries(ctx)
            .OrderByDescending(e => e.EntryDate)
            .ThenByDescending(e => e.EntryNumber)
            .Take(5)
            .Select(e => new { e.Id, e.EntryDate, e.JournalCode, e.EntryNumber, e.PieceRef, e.Label, e.IsReversed })
            .ToListAsync(ct);

        if (entries.Count == 0)
            return new List<RecentJournalEntryDto>();

        var ids = entries.Select(e => e.Id).ToList();
        var totals = await ctx.JournalEntryLines.AsNoTracking()
            .Where(l => ids.Contains(l.JournalEntryId))
            .GroupBy(l => l.JournalEntryId)
            .Select(g => new { EntryId = g.Key, Debit = g.Sum(l => l.DebitAmount.Amount), Credit = g.Sum(l => l.CreditAmount.Amount) })
            .ToListAsync(ct);
        var totalsById = totals.ToDictionary(t => t.EntryId);

        return entries.Select(e =>
        {
            totalsById.TryGetValue(e.Id, out var t);
            return new RecentJournalEntryDto
            {
                Id = e.Id,
                EntryDate = e.EntryDate,
                JournalCode = e.JournalCode,
                EntryNumber = e.EntryNumber,
                PieceRef = e.PieceRef,
                Label = e.Label,
                TotalDebit = t?.Debit ?? 0m,
                TotalCredit = t?.Credit ?? 0m,
                IsReversed = e.IsReversed
            };
        }).ToList();
    }

    private static async Task<List<UpcomingFiscalDeadlineDto>> LoadUpcomingDeadlinesAsync(
        TenantDbContext ctx, DateTime today, CancellationToken ct)
    {
        // Q6 — 5 prochaines échéances non annulées, non payées, à partir d'aujourd'hui.
        var entries = await ctx.FiscalScheduleEntries.AsNoTracking()
            .Where(e => !e.IsCancelled && e.PaymentDate == null && e.DueDate >= today)
            .OrderBy(e => e.DueDate)
            .ThenBy(e => e.ObligationType)
            .Take(5)
            .ToListAsync(ct);

        return entries.Select(e =>
        {
            var status = e.ResolveStatus(today);
            return new UpcomingFiscalDeadlineDto
            {
                Id = e.Id,
                ObligationType = (int)e.ObligationType,
                ObligationLabel = e.ObligationLabel,
                DueDate = e.DueDate,
                DaysRemaining = (e.DueDate.Date - today).Days,
                EstimatedAmount = e.EstimatedAmount,
                Currency = e.Currency,
                Status = (int)status,
                StatusDisplay = FiscalScheduleMappings.GetStatusDisplay(status)
            };
        }).ToList();
    }

    private static async Task<List<RecentDocumentDto>> LoadRecentDocumentsAsync(TenantDbContext ctx, CancellationToken ct)
    {
        // Q7/Q8 — 5 dernières pièces jointes de chaque source, fusionnées par date décroissante.
        var journalDocs = await ctx.JournalEntryAttachments.AsNoTracking()
            .OrderByDescending(a => a.CreatedAt)
            .Take(5)
            .Select(a => new RecentDocumentDto
            {
                Id = a.Id,
                Source = "journal-entry",
                OwnerId = a.JournalEntryId,
                OwnerLabel = a.JournalEntry.JournalCode + " n°" + a.JournalEntry.EntryNumber + " — " + a.JournalEntry.Label,
                FileName = a.FileName,
                ContentType = a.ContentType,
                SizeBytes = a.SizeBytes,
                CreatedAt = a.CreatedAt,
                DownloadPath = "/api/accounting/journal/" + a.JournalEntryId + "/attachments/" + a.Id + "/download"
            })
            .ToListAsync(ct);

        var fiscalDocs = await ctx.FiscalScheduleAttachments.AsNoTracking()
            .OrderByDescending(a => a.CreatedAt)
            .Take(5)
            .Select(a => new RecentDocumentDto
            {
                Id = a.Id,
                Source = "fiscal-schedule",
                OwnerId = a.FiscalScheduleEntryId,
                OwnerLabel = a.FiscalScheduleEntry.ObligationLabel,
                FileName = a.FileName,
                ContentType = a.ContentType,
                SizeBytes = a.SizeBytes,
                CreatedAt = a.CreatedAt,
                DownloadPath = "/api/accounting/fiscal-schedule/" + a.FiscalScheduleEntryId + "/attachments/" + a.Id + "/download"
            })
            .ToListAsync(ct);

        return journalDocs.Concat(fiscalDocs)
            .OrderByDescending(d => d.CreatedAt)
            .Take(5)
            .ToList();
    }

    private static async Task<List<int>> LoadAvailableYearsAsync(TenantDbContext ctx, DateTime today, CancellationToken ct)
    {
        // Q9 — exercices ayant des écritures validées ∪ année courante.
        var years = await PostedEntries(ctx)
            .Select(e => e.EntryDate.Year)
            .Distinct()
            .ToListAsync(ct);
        years.Add(today.Year);
        return years.Distinct().OrderByDescending(y => y).ToList();
    }

    // ── Utilitaires ──────────────────────────────────────────────────────────────────────────

    private static OverviewKpiDto Kpi(decimal current, decimal previous) => new()
    {
        Current = current,
        Previous = previous,
        DeltaAbsolute = current - previous,
        DeltaPercent = DeltaPercent(current, previous)
    };

    /// <summary>Variation en % arrondie à 1 décimale ; null quand la base est nulle.</summary>
    public static decimal? DeltaPercent(decimal current, decimal previous) =>
        previous == 0m ? null : Math.Round((current - previous) / Math.Abs(previous) * 100m, 1, MidpointRounding.AwayFromZero);

    /// <summary>« Octobre 2026 » : nom de mois fr-FR, première lettre en capitale.</summary>
    public static string PeriodLabel(int year, int month)
    {
        var name = FrenchCulture.DateTimeFormat.GetMonthName(month);
        if (name.Length > 0)
            name = char.ToUpper(name[0], FrenchCulture) + name[1..];
        return $"{name} {year}";
    }
}
