using FactuTrust.Application.Accounting;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

public sealed class AccountingReportingService : IAccountingReportingService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly Application.Configuration.AccountingSettings _settings;

    public AccountingReportingService(
        ITenantDbContextFactory contextFactory,
        Microsoft.Extensions.Options.IOptions<Application.Configuration.AccountingSettings> settings)
    {
        _contextFactory = contextFactory;
        _settings = settings.Value;
    }

    /// <summary>
    /// Politique brouillard (C3) : les écrans de consultation (journal, grand livre, balance,
    /// dashboard) incluent les brouillons selon <c>IncludeBrouillardInReports</c> — toujours
    /// marqués via Status/IsDraft. Les états de synthèse (bilan, résultat, NCT) et les sorties
    /// légales (FEC, à-nouveaux, TVA) excluent les brouillons inconditionnellement.
    /// </summary>
    private bool ShowDrafts => _settings.IncludeBrouillardInReports;

    // ── Ancrage d'exercice (à-nouveaux) ────────────────────────────────────────────────────
    // Logique extraite dans FiscalAnchorHelper (partagée avec AccountingService — T7/T8).

    private static Task<FiscalAnchorHelper.FiscalAnchor> ResolveFiscalAnchorAsync(
        Persistence.TenantDbContext ctx, DateTime from, CancellationToken ct) =>
        FiscalAnchorHelper.ResolveFiscalAnchorAsync(ctx, from, ct);

    private static IQueryable<JournalEntryLine> OpeningLines(
        IQueryable<JournalEntryLine> source, FiscalAnchorHelper.FiscalAnchor anchor, DateTime from) =>
        FiscalAnchorHelper.OpeningLines(source, anchor, from);

    private static IQueryable<JournalEntryLine> MovementLines(
        IQueryable<JournalEntryLine> source, FiscalAnchorHelper.FiscalAnchor anchor, DateTime from, DateTime to) =>
        FiscalAnchorHelper.MovementLines(source, anchor, from, to);

    public async Task<Result<IReadOnlyList<ChartOfAccountDto>>> GetChartOfAccountsAsync(CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rows = await ctx.ChartOfAccounts.AsNoTracking()
            .OrderBy(c => c.AccountNumber)
            .Select(c => new ChartOfAccountDto
            {
                Id = c.Id,
                AccountNumber = c.AccountNumber,
                Label = c.Label,
                AccountClass = c.AccountClass,
                ParentAccountNumber = c.ParentAccountNumber,
                NatureType = (int)c.NatureType,
                IsSystem = c.IsSystem,
                IsActive = c.IsActive,
                Level = c.Level,
                AccountType = (int)c.AccountType,
                IsAuxiliary = c.IsAuxiliary,
                AffectationAccountNumber = c.AffectationAccountNumber
            })
            .ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<ChartOfAccountDto>>(rows);
    }

    public async Task<Result<IReadOnlyList<JournalEntryDto>>> GetJournalEntriesAsync(
        string? journalCode,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default,
        int? take = null)
    {
        var f = from.Date;
        var t = to.Date;
        await using var ctx = _contextFactory.CreateContext();
        var q = ctx.JournalEntries.AsNoTracking()
            .Include(j => j.Lines)
            .Where(j => j.EntryDate >= f && j.EntryDate <= t);
        if (!ShowDrafts)
            q = q.Where(j => j.Status != JournalEntryStatus.Brouillon);
        if (!string.IsNullOrWhiteSpace(journalCode))
        {
            var jc = journalCode.Trim().ToUpperInvariant();
            q = q.Where(j => j.JournalCode == jc);
        }

        var ordered = q.OrderByDescending(j => j.EntryDate).ThenByDescending(j => j.EntryNumber);
        // take nul : toute la période. Sinon plafond 1–30, appliqué avant le comptage des pièces jointes.
        IQueryable<JournalEntry> limited = take is int requested
            ? ordered.Take(Math.Clamp(requested, 1, 30))
            : ordered;
        var list = await limited.ToListAsync(cancellationToken);

        // Nombre de pièces jointes par écriture, en une seule requête groupée (pas de N+1).
        var entryIds = list.Select(e => e.Id).ToList();
        var attachmentCounts = entryIds.Count == 0
            ? new Dictionary<Guid, int>()
            : await ctx.JournalEntryAttachments.AsNoTracking()
                .Where(a => entryIds.Contains(a.JournalEntryId))
                .GroupBy(a => a.JournalEntryId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);

        var dtos = list
            .Select(e => MapEntry(e) with { AttachmentCount = attachmentCounts.TryGetValue(e.Id, out var c) ? c : 0 })
            .ToList();
        return Result.Success<IReadOnlyList<JournalEntryDto>>(dtos);
    }

    public async Task<Result<JournalEntryDto>> GetJournalEntryByIdAsync(
        Guid id, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var entry = await ctx.JournalEntries.AsNoTracking()
            .Include(j => j.Lines)
            .FirstOrDefaultAsync(j => j.Id == id, cancellationToken);
        if (entry is null)
            return Result.Failure<JournalEntryDto>(Error.NotFound("JournalEntry", id));

        var attachmentCount = await ctx.JournalEntryAttachments.AsNoTracking()
            .CountAsync(a => a.JournalEntryId == id, cancellationToken);

        return Result.Success(MapEntry(entry) with { AttachmentCount = attachmentCount });
    }

    public async Task<Result<JournalSummaryDto>> GetJournalSummaryAsync(
        DateTime from,
        DateTime to,
        JournalSummaryGrouping grouping,
        string? journalCode = null,
        CancellationToken cancellationToken = default)
    {
        var f = from.Date;
        var t = to.Date;
        if (t < f)
            return Result.Failure<JournalSummaryDto>(
                Error.Validation("Period", "La date de fin ne peut pas précéder la date de début."));

        await using var ctx = _contextFactory.CreateContext();

        var lines = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate >= f && l.JournalEntry.EntryDate <= t);
        if (!ShowDrafts)
            lines = lines.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
        if (!string.IsNullOrWhiteSpace(journalCode))
        {
            var jc = journalCode.Trim().ToUpperInvariant();
            lines = lines.Where(l => l.JournalEntry.JournalCode == jc);
        }

        var journalLabels = await ctx.Journals.AsNoTracking()
            .ToDictionaryAsync(j => j.Code, j => j.Label, cancellationToken);
        string LabelOf(string code) => journalLabels.TryGetValue(code, out var label) ? label : code;

        // Sous-totaux par journal : calculés quel que soit l'axe, en une seule requête agrégée.
        var totalsRaw = await lines
            .GroupBy(l => l.JournalEntry.JournalCode)
            .Select(g => new
            {
                JournalCode = g.Key,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount),
                EntryCount = g.Select(l => l.JournalEntryId).Distinct().Count()
            })
            .ToListAsync(cancellationToken);

        var journalTotals = totalsRaw
            .OrderBy(x => x.JournalCode, StringComparer.Ordinal)
            .Select(x => new JournalSummaryTotalDto
            {
                JournalCode = x.JournalCode,
                JournalLabel = LabelOf(x.JournalCode),
                Debit = x.Debit,
                Credit = x.Credit,
                EntryCount = x.EntryCount
            })
            .ToList();

        var cells = new List<JournalSummaryCellDto>();
        var periods = new List<JournalSummaryPeriodDto>();

        if (grouping == JournalSummaryGrouping.Month)
        {
            var raw = await lines
                .GroupBy(l => new
                {
                    l.JournalEntry.JournalCode,
                    l.JournalEntry.EntryDate.Year,
                    l.JournalEntry.EntryDate.Month
                })
                .Select(g => new
                {
                    g.Key.JournalCode,
                    g.Key.Year,
                    g.Key.Month,
                    Debit = g.Sum(l => l.DebitAmount.Amount),
                    Credit = g.Sum(l => l.CreditAmount.Amount)
                })
                .ToListAsync(cancellationToken);

            cells.AddRange(raw
                .OrderBy(x => x.JournalCode, StringComparer.Ordinal)
                .ThenBy(x => x.Year).ThenBy(x => x.Month)
                .Select(x => new JournalSummaryCellDto
                {
                    JournalCode = x.JournalCode,
                    JournalLabel = LabelOf(x.JournalCode),
                    Year = x.Year,
                    Month = x.Month,
                    Debit = x.Debit,
                    Credit = x.Credit
                }));

            // Colonnes du centralisateur : tous les mois de la période, même sans mouvement.
            for (var cursor = new DateTime(f.Year, f.Month, 1); cursor <= t; cursor = cursor.AddMonths(1))
            {
                periods.Add(new JournalSummaryPeriodDto
                {
                    Year = cursor.Year,
                    Month = cursor.Month,
                    Label = $"{cursor.Month:00}/{cursor.Year}"
                });
            }
        }
        else if (grouping == JournalSummaryGrouping.Account)
        {
            var raw = await lines
                .GroupBy(l => new { l.JournalEntry.JournalCode, l.AccountNumber })
                .Select(g => new
                {
                    g.Key.JournalCode,
                    g.Key.AccountNumber,
                    Debit = g.Sum(l => l.DebitAmount.Amount),
                    Credit = g.Sum(l => l.CreditAmount.Amount)
                })
                .ToListAsync(cancellationToken);

            var accountLabels = await ctx.ChartOfAccounts.AsNoTracking()
                .ToDictionaryAsync(c => c.AccountNumber, c => c.Label, cancellationToken);

            cells.AddRange(raw
                .OrderBy(x => x.JournalCode, StringComparer.Ordinal)
                .ThenBy(x => x.AccountNumber, StringComparer.Ordinal)
                .Select(x => new JournalSummaryCellDto
                {
                    JournalCode = x.JournalCode,
                    JournalLabel = LabelOf(x.JournalCode),
                    AccountNumber = x.AccountNumber,
                    AccountLabel = accountLabels.TryGetValue(x.AccountNumber, out var al) ? al : x.AccountNumber,
                    Debit = x.Debit,
                    Credit = x.Credit
                }));
        }

        var totalDebit = journalTotals.Sum(x => x.Debit);
        var totalCredit = journalTotals.Sum(x => x.Credit);

        return Result.Success(new JournalSummaryDto
        {
            Grouping = grouping,
            From = f,
            To = t,
            Periods = periods,
            Cells = cells,
            JournalTotals = journalTotals,
            TotalDebit = totalDebit,
            TotalCredit = totalCredit,
            IsBalanced = Math.Round(totalDebit - totalCredit, 3) == 0m
        });
    }

    public async Task<Result<IReadOnlyList<LedgerRowDto>>> GetLedgerAsync(
        string accountNumber,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default)
    {
        var acc = accountNumber.Trim();
        var f = from.Date;
        var t = to.Date;
        await using var ctx = _contextFactory.CreateContext();

        var lq = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountNumber == acc && l.JournalEntry.EntryDate >= f && l.JournalEntry.EntryDate <= t);
        if (!ShowDrafts)
            lq = lq.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        var lines = await lq
            .OrderBy(l => l.JournalEntry.EntryDate)
            .ThenBy(l => l.JournalEntry.EntryNumber)
            .ThenBy(l => l.LineNumber)
            .ToListAsync(cancellationToken);

        decimal running = 0;
        var rows = new List<LedgerRowDto>();
        foreach (var line in lines)
        {
            var d = line.DebitAmount.Amount;
            var c = line.CreditAmount.Amount;
            running += d - c;
            rows.Add(new LedgerRowDto
            {
                EntryDate = line.JournalEntry.EntryDate,
                JournalCode = line.JournalEntry.JournalCode,
                PieceNumber = line.JournalEntry.EntryNumber,
                Label = line.Label,
                Debit = d,
                Credit = c,
                RunningBalance = running,
                CurrencyCode = line.JournalEntry.CurrencyCode,
                // Un seul montant : une ligne porte un débit OU un crédit, jamais les deux.
                AmountInCurrency = line.DebitAmountInCurrency > 0
                    ? line.DebitAmountInCurrency
                    : line.CreditAmountInCurrency
            });
        }

        return Result.Success<IReadOnlyList<LedgerRowDto>>(rows);
    }

    /// <summary>
    /// Garde-fou : au-delà de ce nombre de comptes, l'édition est refusée explicitement plutôt que
    /// de partir en délai d'attente côté navigateur.
    /// </summary>
    private const int MaxGeneralLedgerAccounts = 5000;

    public async Task<Result<GeneralLedgerDto>> GetLedgerRangeAsync(
        string? accountFrom,
        string? accountTo,
        DateTime from,
        DateTime to,
        bool includeUnmoved = false,
        CancellationToken cancellationToken = default)
    {
        var f = from.Date;
        var t = to.Date;
        if (t < f)
            return Result.Failure<GeneralLedgerDto>(
                Error.Validation("Period", "La date de fin ne peut pas précéder la date de début."));

        var lower = string.IsNullOrWhiteSpace(accountFrom) ? null : accountFrom.Trim();
        var upper = string.IsNullOrWhiteSpace(accountTo) ? null : accountTo.Trim();
        if (lower is not null && upper is not null && string.CompareOrdinal(lower, upper) > 0)
            return Result.Failure<GeneralLedgerDto>(
                Error.Validation("Accounts", "Le compte de début doit précéder le compte de fin."));

        await using var ctx = _contextFactory.CreateContext();
        var anchor = await ResolveFiscalAnchorAsync(ctx, f, cancellationToken);

        IQueryable<JournalEntryLine> Scope()
        {
            IQueryable<JournalEntryLine> q = ctx.JournalEntryLines.AsNoTracking().Include(l => l.JournalEntry);
            if (lower is not null)
                q = q.Where(l => l.AccountNumber.CompareTo(lower) >= 0);
            if (upper is not null)
                q = q.Where(l => l.AccountNumber.CompareTo(upper) <= 0);
            if (!ShowDrafts)
                q = q.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
            return q;
        }

        var openings = await OpeningLines(Scope(), anchor, f)
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Balance = g.Sum(l => l.DebitAmount.Amount) - g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);
        var openingMap = openings.ToDictionary(x => x.Account, x => x.Balance, StringComparer.Ordinal);

        var movements = await MovementLines(Scope(), anchor, f, t)
            .OrderBy(l => l.AccountNumber)
            .ThenBy(l => l.JournalEntry.EntryDate)
            .ThenBy(l => l.JournalEntry.EntryNumber)
            .ThenBy(l => l.LineNumber)
            .ToListAsync(cancellationToken);

        var accountsInScope = new HashSet<string>(movements.Select(l => l.AccountNumber), StringComparer.Ordinal);
        if (includeUnmoved)
            foreach (var account in openingMap.Where(kv => kv.Value != 0m).Select(kv => kv.Key))
                accountsInScope.Add(account);

        if (accountsInScope.Count > MaxGeneralLedgerAccounts)
            return Result.Failure<GeneralLedgerDto>(Error.Validation("Accounts",
                $"{accountsInScope.Count} comptes dans la plage demandée (maximum {MaxGeneralLedgerAccounts}). Restreignez la plage de comptes."));

        var labels = await ctx.ChartOfAccounts.AsNoTracking()
            .ToDictionaryAsync(c => c.AccountNumber, c => c.Label, cancellationToken);

        var movementsByAccount = movements
            .GroupBy(l => l.AccountNumber, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        var accounts = new List<GeneralLedgerAccountDto>(accountsInScope.Count);
        foreach (var account in accountsInScope.OrderBy(a => a, StringComparer.Ordinal))
        {
            openingMap.TryGetValue(account, out var opening);
            var rows = new List<LedgerRowDto>();
            decimal debit = 0, credit = 0;
            var running = opening;

            if (movementsByAccount.TryGetValue(account, out var lines))
            {
                foreach (var line in lines)
                {
                    var d = line.DebitAmount.Amount;
                    var c = line.CreditAmount.Amount;
                    debit += d;
                    credit += c;
                    running += d - c;
                    rows.Add(new LedgerRowDto
                    {
                        EntryDate = line.JournalEntry.EntryDate,
                        JournalCode = line.JournalEntry.JournalCode,
                        PieceNumber = line.JournalEntry.EntryNumber,
                        Label = line.Label,
                        Debit = d,
                        Credit = c,
                        RunningBalance = running
                    });
                }
            }

            accounts.Add(new GeneralLedgerAccountDto
            {
                AccountNumber = account,
                Label = labels.TryGetValue(account, out var lb) ? lb : account,
                OpeningBalance = opening,
                Rows = rows,
                TotalDebit = debit,
                TotalCredit = credit,
                ClosingBalance = running
            });
        }

        var totalDebit = accounts.Sum(a => a.TotalDebit);
        var totalCredit = accounts.Sum(a => a.TotalCredit);

        return Result.Success(new GeneralLedgerDto
        {
            From = f,
            To = t,
            Accounts = accounts,
            TotalDebit = totalDebit,
            TotalCredit = totalCredit,
            // L'équilibre n'a de sens que sur le grand livre complet : une plage de comptes
            // n'a aucune raison d'être équilibrée à elle seule.
            IsBalanced = lower is null && upper is null && Math.Round(totalDebit - totalCredit, 3) == 0m
        });
    }

    public async Task<Result<IReadOnlyList<BalanceRowDto>>> GetLedgerRecapAsync(
        int level,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default)
    {
        if (level is < 1 or > 6)
            return Result.Failure<IReadOnlyList<BalanceRowDto>>(
                Error.Validation("Level", "Le niveau de regroupement doit être compris entre 1 et 6."));

        // Même source que la balance générale : le récapitulatif ne peut pas en diverger.
        var balance = await GetBalanceAsync(from, to, cancellationToken);
        if (balance.IsFailure)
            return balance;

        await using var ctx = _contextFactory.CreateContext();
        var labels = await ctx.ChartOfAccounts.AsNoTracking()
            .ToDictionaryAsync(c => c.AccountNumber, c => c.Label, cancellationToken);

        var rows = balance.Value
            .GroupBy(r => r.AccountNumber.Length <= level ? r.AccountNumber : r.AccountNumber[..level],
                     StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g =>
            {
                // Les soldes se recomposent en net puis se reventilent : additionner les colonnes
                // débit et crédit telles quelles gonflerait artificiellement les deux côtés.
                var openingNet = g.Sum(r => r.OpeningDebit - r.OpeningCredit);
                var closingNet = g.Sum(r => r.ClosingDebit - r.ClosingCredit);
                return new BalanceRowDto
                {
                    AccountNumber = g.Key,
                    Label = labels.TryGetValue(g.Key, out var lb) ? lb : $"Racine {g.Key}",
                    OpeningDebit = openingNet > 0 ? openingNet : 0m,
                    OpeningCredit = openingNet < 0 ? -openingNet : 0m,
                    MovementDebit = g.Sum(r => r.MovementDebit),
                    MovementCredit = g.Sum(r => r.MovementCredit),
                    ClosingDebit = closingNet > 0 ? closingNet : 0m,
                    ClosingCredit = closingNet < 0 ? -closingNet : 0m
                };
            })
            .ToList();

        return Result.Success<IReadOnlyList<BalanceRowDto>>(rows);
    }

    public async Task<Result<IReadOnlyList<BalanceRowDto>>> GetBalanceAsync(
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default)
    {
        var f = from.Date;
        var t = to.Date;
        await using var ctx = _contextFactory.CreateContext();

        // Ancrage sur l'à-nouveau de l'exercice quand il existe (sinon : comportement historique).
        var anchor = await ResolveFiscalAnchorAsync(ctx, f, cancellationToken);

        var openingQuery = OpeningLines(
            ctx.JournalEntryLines.AsNoTracking().Include(l => l.JournalEntry), anchor, f);
        if (!ShowDrafts)
            openingQuery = openingQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        var openingLines = await openingQuery
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        var openingMap = openingLines.ToDictionary(x => x.Account, x => (x.Debit, x.Credit));

        // Aggregate movements server-side instead of loading all lines into memory
        var movementQuery = MovementLines(
            ctx.JournalEntryLines.AsNoTracking().Include(l => l.JournalEntry), anchor, f, t);
        if (!ShowDrafts)
            movementQuery = movementQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        var movementLines = await movementQuery
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        var movementMap = movementLines.ToDictionary(x => x.Account, x => (x.Debit, x.Credit));

        var labels = await ctx.ChartOfAccounts.AsNoTracking()
            .ToDictionaryAsync(c => c.AccountNumber, c => c.Label, cancellationToken);

        var allAccounts = new HashSet<string>(openingMap.Keys);
        foreach (var m in movementMap.Keys) allAccounts.Add(m);

        // Devises etrangeres rencontrees par compte, ouverture et mouvements confondus : un compte
        // peut en porter plusieurs, d'ou une liste et non une valeur unique.
        var currencyQuery = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate <= t && l.JournalEntry.CurrencyCode != "TND");
        if (!ShowDrafts)
            currencyQuery = currencyQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        var currencyPairs = await currencyQuery
            .Select(l => new { l.AccountNumber, l.JournalEntry.CurrencyCode })
            .Distinct()
            .ToListAsync(cancellationToken);

        var currencyMap = currencyPairs
            .GroupBy(x => x.AccountNumber)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<string>)g.Select(x => x.CurrencyCode).Distinct().OrderBy(c => c).ToList());

        var rows = new List<BalanceRowDto>();
        foreach (var acc in allAccounts.OrderBy(x => x))
        {
            openingMap.TryGetValue(acc, out var opening);
            var openNet = opening.Debit - opening.Credit;
            decimal od = 0, oc = 0;
            if (openNet > 0) od = openNet;
            else oc = -openNet;

            movementMap.TryGetValue(acc, out var movement);
            var md = movement.Debit;
            var mc = movement.Credit;

            var closingNet = openNet + md - mc;
            decimal cd = 0, cc = 0;
            if (closingNet > 0) cd = closingNet;
            else cc = -closingNet;

            rows.Add(new BalanceRowDto
            {
                AccountNumber = acc,
                Label = labels.TryGetValue(acc, out var lb) ? lb : acc,
                OpeningDebit = od,
                OpeningCredit = oc,
                MovementDebit = md,
                MovementCredit = mc,
                ClosingDebit = cd,
                ClosingCredit = cc,
                ForeignCurrencies = currencyMap.TryGetValue(acc, out var currencies)
                    ? currencies
                    : Array.Empty<string>()
            });
        }

        return Result.Success<IReadOnlyList<BalanceRowDto>>(rows);
    }

    public async Task<Result<DetailedBalanceDto>> GetDetailedBalanceAsync(
        string? accountFrom,
        string? accountTo,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default)
    {
        // Composition stricte : la balance fournit les colonnes de soldes, le grand livre général
        // le détail. Aucune agrégation propre — les deux états ne peuvent donc pas diverger.
        var balance = await GetBalanceAsync(from, to, cancellationToken);
        if (balance.IsFailure)
            return Result.Failure<DetailedBalanceDto>(balance.Error);

        var ledger = await GetLedgerRangeAsync(accountFrom, accountTo, from, to, includeUnmoved: true, cancellationToken);
        if (ledger.IsFailure)
            return Result.Failure<DetailedBalanceDto>(ledger.Error);

        var balanceByAccount = balance.Value.ToDictionary(r => r.AccountNumber, StringComparer.Ordinal);

        var accounts = new List<DetailedBalanceAccountDto>(ledger.Value.Accounts.Count);
        foreach (var account in ledger.Value.Accounts)
        {
            if (!balanceByAccount.TryGetValue(account.AccountNumber, out var row))
                continue;
            accounts.Add(new DetailedBalanceAccountDto { Balance = row, Rows = account.Rows });
        }

        return Result.Success(new DetailedBalanceDto
        {
            From = from.Date,
            To = to.Date,
            Accounts = accounts,
            TotalMovementDebit = accounts.Sum(a => a.Balance.MovementDebit),
            TotalMovementCredit = accounts.Sum(a => a.Balance.MovementCredit)
        });
    }

    public async Task<Result<PeriodicBalanceDto>> GetBalanceByPeriodAsync(
        int fiscalYear,
        CancellationToken cancellationToken = default)
    {
        var f = new DateTime(fiscalYear, 1, 1);
        var t = new DateTime(fiscalYear, 12, 31);

        await using var ctx = _contextFactory.CreateContext();
        var anchor = await ResolveFiscalAnchorAsync(ctx, f, cancellationToken);

        IQueryable<JournalEntryLine> Base()
        {
            IQueryable<JournalEntryLine> q = ctx.JournalEntryLines.AsNoTracking().Include(l => l.JournalEntry);
            if (!ShowDrafts)
                q = q.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
            return q;
        }

        var openings = await OpeningLines(Base(), anchor, f)
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Balance = g.Sum(l => l.DebitAmount.Amount) - g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);
        var openingMap = openings.ToDictionary(x => x.Account, x => x.Balance, StringComparer.Ordinal);

        // Agrégation compte × mois en une requête — même motif que l'état budgétaire.
        var monthly = await MovementLines(Base(), anchor, f, t)
            .GroupBy(l => new { l.AccountNumber, l.JournalEntry.EntryDate.Month })
            .Select(g => new
            {
                g.Key.AccountNumber,
                g.Key.Month,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        var labels = await ctx.ChartOfAccounts.AsNoTracking()
            .ToDictionaryAsync(c => c.AccountNumber, c => c.Label, cancellationToken);

        var accounts = new HashSet<string>(monthly.Select(m => m.AccountNumber), StringComparer.Ordinal);
        foreach (var account in openingMap.Where(kv => kv.Value != 0m).Select(kv => kv.Key))
            accounts.Add(account);

        var byAccount = monthly
            .GroupBy(m => m.AccountNumber, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        var rows = new List<PeriodicBalanceRowDto>(accounts.Count);
        foreach (var account in accounts.OrderBy(a => a, StringComparer.Ordinal))
        {
            var debits = new decimal[12];
            var credits = new decimal[12];
            if (byAccount.TryGetValue(account, out var cells))
            {
                foreach (var cell in cells)
                {
                    debits[cell.Month - 1] = cell.Debit;
                    credits[cell.Month - 1] = cell.Credit;
                }
            }

            openingMap.TryGetValue(account, out var opening);
            rows.Add(new PeriodicBalanceRowDto
            {
                AccountNumber = account,
                Label = labels.TryGetValue(account, out var lb) ? lb : account,
                Opening = opening,
                MonthlyDebit = debits,
                MonthlyCredit = credits,
                Closing = opening + debits.Sum() - credits.Sum()
            });
        }

        var totalDebit = rows.Sum(r => r.MonthlyDebit.Sum());
        var totalCredit = rows.Sum(r => r.MonthlyCredit.Sum());

        return Result.Success(new PeriodicBalanceDto
        {
            FiscalYear = fiscalYear,
            Rows = rows,
            TotalDebit = totalDebit,
            TotalCredit = totalCredit,
            IsBalanced = Math.Round(totalDebit - totalCredit, 3) == 0m
        });
    }

    public async Task<Result<AccountingDashboardDto>> GetDashboardAsync(CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var now = DateTime.UtcNow;
        var year = now.Year;
        var month = now.Month;

        var vatQuery = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l =>
                (l.AccountNumber.StartsWith("43671") || l.AccountNumber.StartsWith("43666") || l.AccountNumber.StartsWith("43667")) &&
                l.JournalEntry.EntryDate.Year == year &&
                l.JournalEntry.EntryDate.Month == month);
        if (!ShowDrafts)
            vatQuery = vatQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
        var vatLines = await vatQuery.ToListAsync(cancellationToken);

        decimal collected = vatLines.Where(l => l.AccountNumber.StartsWith("43671")).Sum(l => l.CreditAmount.Amount - l.DebitAmount.Amount);
        decimal ded = vatLines.Where(l => l.AccountNumber.StartsWith("43666")).Sum(l => l.DebitAmount.Amount - l.CreditAmount.Amount);
        decimal cred = vatLines.Where(l => l.AccountNumber.StartsWith("43667")).Sum(l => l.CreditAmount.Amount - l.DebitAmount.Amount);

        var overdue = await ComputeOverdueClientsAsync(ctx, cancellationToken);

        var validatedCount = await ctx.Invoices.AsNoTracking()
            .CountAsync(i => i.Status == InvoiceStatus.Validated, cancellationToken);
        var posted = await ctx.JournalEntries.AsNoTracking()
            .CountAsync(j => j.SourceEntityType == AccountingService.SourceInvoice, cancellationToken);
        var unposted = Math.Max(0, validatedCount - posted);

        var deadline = VatFilingDeadline.ForPeriod(year, month);

        // Aggregate revenue server-side instead of loading all lines
        var monthlyRevenueQuery = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountNumber.StartsWith("7") && l.JournalEntry.EntryDate.Year == year && l.JournalEntry.EntryDate.Month == month);
        if (!ShowDrafts)
            monthlyRevenueQuery = monthlyRevenueQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
        var monthlyRevenue = await monthlyRevenueQuery
            .SumAsync(l => l.CreditAmount.Amount - l.DebitAmount.Amount, cancellationToken);

        var prevMonth = month == 1 ? 12 : month - 1;
        var prevYear = month == 1 ? year - 1 : year;
        var previousRevenueQuery = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountNumber.StartsWith("7") && l.JournalEntry.EntryDate.Year == prevYear && l.JournalEntry.EntryDate.Month == prevMonth);
        if (!ShowDrafts)
            previousRevenueQuery = previousRevenueQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
        var previousMonthRevenue = await previousRevenueQuery
            .SumAsync(l => l.CreditAmount.Amount - l.DebitAmount.Amount, cancellationToken);

        // Aggregate cash balance server-side (was loading ALL class 5 lines into memory)
        var cashQuery = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountNumber.StartsWith("5"));
        if (!ShowDrafts)
            cashQuery = cashQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);
        var availableCash = await cashQuery
            .SumAsync(l => l.DebitAmount.Amount - l.CreditAmount.Amount, cancellationToken);

        var openPeriods = await ctx.AccountingPeriods.AsNoTracking().CountAsync(p => !p.IsClosed, cancellationToken);
        var draftEntries = await ctx.JournalEntries.AsNoTracking()
            .CountAsync(j => j.Status == JournalEntryStatus.Brouillon, cancellationToken);

        var dto = new AccountingDashboardDto
        {
            // Journal-based fallback. The authoritative value is overridden by
            // GetAccountingDashboardQueryHandler using the canonical VAT declaration so the
            // dashboard matches the "Déclaration TVA" page exactly.
            VatDueEstimate = collected - ded - cred,
            OverdueReceivablesOver90 = overdue,
            UnpostedInvoiceCount = unposted,
            NextVatDeadline = deadline,
            MonthlyRevenue = monthlyRevenue,
            PreviousMonthRevenue = previousMonthRevenue,
            AvailableCash = availableCash,
            OpenPeriodsCount = openPeriods,
            DraftEntriesCount = draftEntries
        };
        return Result.Success(dto);
    }

    public async Task<Result<IReadOnlyList<AccountingPeriodDto>>> GetPeriodsAsync(CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rows = await ctx.AccountingPeriods.AsNoTracking()
            .OrderByDescending(p => p.FiscalYear).ThenByDescending(p => p.Month)
            .Select(p => new AccountingPeriodDto
            {
                Id = p.Id,
                FiscalYear = p.FiscalYear,
                Month = p.Month,
                StartDate = p.StartDate,
                EndDate = p.EndDate,
                IsClosed = p.IsClosed
            })
            .ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<AccountingPeriodDto>>(rows);
    }

    public async Task<Result<BalanceSheetDto>> GetBalanceSheetAsync(int fiscalYear, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var labels = await ctx.ChartOfAccounts.AsNoTracking()
            .ToDictionaryAsync(c => c.AccountNumber, c => (c.Label, c.AccountClass, c.NatureType), cancellationToken);

        // État de synthèse : les brouillons sont exclus inconditionnellement (même style que
        // LoadYearNetAsync pour les états NCT).
        var currentYearBalances = await ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate.Year == fiscalYear
                        && l.JournalEntry.Status != JournalEntryStatus.Brouillon)
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        var previousYear = fiscalYear - 1;
        var previousYearBalances = await ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate.Year == previousYear
                        && l.JournalEntry.Status != JournalEntryStatus.Brouillon)
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        var prevMap = previousYearBalances.ToDictionary(x => x.Account, x => x.Debit - x.Credit);

        var assets = new List<FinancialStatementLineDto>();
        var liabilities = new List<FinancialStatementLineDto>();

        foreach (var bal in currentYearBalances)
        {
            var net = bal.Debit - bal.Credit;
            if (net == 0) continue;

            labels.TryGetValue(bal.Account, out var info);
            var accountClass = info.AccountClass;
            var label = info.Label ?? bal.Account;

            // Côté du bilan : la classe 4 (comptes de tiers, nature mixte) est ventilée selon
            // la nature du compte ; les autres classes selon leur classe. Les classes 6 et 7
            // (comptes de gestion) sont ignorées — le résultat ressort comme l'écart Actif − Passif.
            bool isAsset;
            if (accountClass is 2 or 3 or 5)
                isAsset = true;
            else if (accountClass == 1)
                isAsset = false;
            else if (accountClass == 4)
                isAsset = info.NatureType == AccountNatureType.Debit;
            else
                continue;

            var hasPrev = prevMap.TryGetValue(bal.Account, out var prevNet);

            // Montant signé selon le côté : un compte d'actif présente Débit − Crédit, un compte
            // de passif présente Crédit − Débit. Un solde anormal ressort en négatif, ce qui
            // préserve l'équilibre du bilan (Total Actif − Total Passif = résultat de l'exercice).
            var line = new FinancialStatementLineDto
            {
                AccountNumber = bal.Account,
                Label = label,
                AccountClass = accountClass,
                Amount = isAsset ? net : -net,
                PreviousYearAmount = hasPrev ? (isAsset ? prevNet : -prevNet) : null
            };

            if (isAsset)
                assets.Add(line);
            else
                liabilities.Add(line);
        }

        var totalAssets = assets.Sum(a => a.Amount);
        var totalLiabilities = liabilities.Sum(l => l.Amount);

        return Result.Success(new BalanceSheetDto
        {
            Assets = assets.OrderBy(a => a.AccountNumber).ToList(),
            Liabilities = liabilities.OrderBy(l => l.AccountNumber).ToList(),
            TotalAssets = totalAssets,
            TotalLiabilities = totalLiabilities,
            NetResult = totalAssets - totalLiabilities
        });
    }

    public async Task<Result<IncomeStatementDto>> GetIncomeStatementAsync(int fiscalYear, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var labels = await ctx.ChartOfAccounts.AsNoTracking()
            .ToDictionaryAsync(c => c.AccountNumber, c => (c.Label, c.AccountClass), cancellationToken);

        // État de synthèse : brouillons exclus inconditionnellement.
        var balances = await ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate.Year == fiscalYear
                        && l.JournalEntry.Status != JournalEntryStatus.Brouillon)
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        var previousYear = fiscalYear - 1;
        var prevBalances = await ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate.Year == previousYear
                        && l.JournalEntry.Status != JournalEntryStatus.Brouillon)
            .GroupBy(l => l.AccountNumber)
            .Select(g => new
            {
                Account = g.Key,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        var prevMap = prevBalances.ToDictionary(x => x.Account);

        var revenue = new List<FinancialStatementLineDto>();
        var expenses = new List<FinancialStatementLineDto>();

        foreach (var bal in balances)
        {
            labels.TryGetValue(bal.Account, out var info);
            var accountClass = info.AccountClass;
            var label = info.Label ?? bal.Account;

            if (accountClass == 7)
            {
                var amount = bal.Credit - bal.Debit;
                decimal? prevAmount = prevMap.TryGetValue(bal.Account, out var prev)
                    ? prev.Credit - prev.Debit
                    : null;

                revenue.Add(new FinancialStatementLineDto
                {
                    AccountNumber = bal.Account,
                    Label = label,
                    AccountClass = accountClass,
                    Amount = amount,
                    PreviousYearAmount = prevAmount
                });
            }
            else if (accountClass == 6)
            {
                var amount = bal.Debit - bal.Credit;
                decimal? prevAmount = prevMap.TryGetValue(bal.Account, out var prev)
                    ? prev.Debit - prev.Credit
                    : null;

                expenses.Add(new FinancialStatementLineDto
                {
                    AccountNumber = bal.Account,
                    Label = label,
                    AccountClass = accountClass,
                    Amount = amount,
                    PreviousYearAmount = prevAmount
                });
            }
        }

        var totalRevenue = revenue.Sum(r => r.Amount);
        var totalExpenses = expenses.Sum(e => e.Amount);

        return Result.Success(new IncomeStatementDto
        {
            Revenue = revenue.OrderBy(r => r.AccountNumber).ToList(),
            Expenses = expenses.OrderBy(e => e.AccountNumber).ToList(),
            TotalRevenue = totalRevenue,
            TotalExpenses = totalExpenses,
            NetResult = totalRevenue - totalExpenses
        });
    }

    public async Task<Result<NctFinancialStatementsDto>> GetNctStatementsAsync(int fiscalYear, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var (current, currentWarnings) = await LoadYearNetAsync(ctx, fiscalYear, cancellationToken);
        var (previous, _) = await LoadYearNetAsync(ctx, fiscalYear - 1, cancellationToken);

        var labels = await ctx.ChartOfAccounts.AsNoTracking()
            .ToDictionaryAsync(c => c.AccountNumber, c => c.Label, cancellationToken);

        // Agrégats de cession (T5) : le builder ne voit que des soldes nets, il ne peut donc pas
        // distinguer une dotation d'un amortissement sorti lors d'une cession — calculés ici à partir
        // des lignes d'écritures marquées SourceEntityType == FixedAssetDisposal (statut ≠ Brouillon).
        var disposals = await LoadDisposalAggregatesAsync(ctx, fiscalYear, cancellationToken);

        var dto = NctStatementBuilder.Build(fiscalYear, current, previous, _settings.NctStatementsEnabled, disposals, currentWarnings);
        var detailed = NctDetailedNotesBuilder.Build(current, previous, labels);

        // Personnalisation des annexes par le comptable : superposition NEUTRE en l'absence de
        // ligne d'override (la liasse reste alors rigoureusement identique).
        var overrides = await ctx.NctNoteOverrides.AsNoTracking()
            .Where(o => o.FiscalYear == fiscalYear)
            .ToListAsync(cancellationToken);
        detailed = NctNoteOverrideApplier.Apply(detailed, overrides);

        return Result.Success(dto with { DetailedNotes = detailed });
    }

    public async Task<Result<IReadOnlyList<AuxiliaryBalanceRowDto>>> GetAuxiliaryBalanceAsync(
        ThirdPartyKind kind, DateTime from, DateTime to, CancellationToken cancellationToken = default)
    {
        var f = from.Date;
        var t = to.Date;
        await using var ctx = _contextFactory.CreateContext();

        IQueryable<JournalEntryLine> Base() =>
            ShowDrafts
                ? ctx.JournalEntryLines.AsNoTracking()
                    .Include(l => l.JournalEntry)
                    .Where(l => l.ThirdPartyId != null && l.ThirdPartyKind == kind)
                : ctx.JournalEntryLines.AsNoTracking()
                    .Include(l => l.JournalEntry)
                    .Where(l => l.ThirdPartyId != null && l.ThirdPartyKind == kind
                                && l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        // Même ancrage que la balance générale : l'à-nouveau auxiliarisé porte l'ouverture des tiers.
        var anchor = await ResolveFiscalAnchorAsync(ctx, f, cancellationToken);

        var opening = await OpeningLines(Base(), anchor, f)
            .GroupBy(l => l.ThirdPartyId!.Value)
            .Select(g => new { Id = g.Key, Debit = g.Sum(l => l.DebitAmount.Amount), Credit = g.Sum(l => l.CreditAmount.Amount) })
            .ToListAsync(cancellationToken);

        var movements = await MovementLines(Base(), anchor, f, t)
            .GroupBy(l => l.ThirdPartyId!.Value)
            .Select(g => new { Id = g.Key, Debit = g.Sum(l => l.DebitAmount.Amount), Credit = g.Sum(l => l.CreditAmount.Amount) })
            .ToListAsync(cancellationToken);

        var openingMap = opening.ToDictionary(x => x.Id, x => (x.Debit, x.Credit));
        var movementMap = movements.ToDictionary(x => x.Id, x => (x.Debit, x.Credit));

        var ids = new HashSet<Guid>(openingMap.Keys);
        foreach (var id in movementMap.Keys) ids.Add(id);

        var names = await LoadThirdPartyNamesAsync(ctx, kind, ids, cancellationToken);

        var rows = new List<AuxiliaryBalanceRowDto>();
        foreach (var id in ids)
        {
            openingMap.TryGetValue(id, out var op);
            movementMap.TryGetValue(id, out var mv);

            var openNet = op.Debit - op.Credit;
            decimal od = 0, oc = 0;
            if (openNet > 0) od = openNet; else oc = -openNet;

            var closingNet = openNet + mv.Debit - mv.Credit;
            decimal cd = 0, cc = 0;
            if (closingNet > 0) cd = closingNet; else cc = -closingNet;

            rows.Add(new AuxiliaryBalanceRowDto
            {
                ThirdPartyId = id,
                ThirdPartyName = names.TryGetValue(id, out var n) ? n : id.ToString("N")[..8],
                OpeningDebit = od,
                OpeningCredit = oc,
                MovementDebit = mv.Debit,
                MovementCredit = mv.Credit,
                ClosingDebit = cd,
                ClosingCredit = cc
            });
        }

        return Result.Success<IReadOnlyList<AuxiliaryBalanceRowDto>>(
            rows.OrderBy(r => r.ThirdPartyName, StringComparer.OrdinalIgnoreCase).ToList());
    }

    public async Task<Result<ThirdPartyLedgerDto>> GetThirdPartyLedgerAsync(
        Guid thirdPartyId, ThirdPartyKind kind, DateTime from, DateTime to, CancellationToken cancellationToken = default)
    {
        var f = from.Date;
        var t = to.Date;
        await using var ctx = _contextFactory.CreateContext();

        IQueryable<JournalEntryLine> Base() =>
            ShowDrafts
                ? ctx.JournalEntryLines.AsNoTracking()
                    .Include(l => l.JournalEntry)
                    .Where(l => l.ThirdPartyId == thirdPartyId && l.ThirdPartyKind == kind)
                : ctx.JournalEntryLines.AsNoTracking()
                    .Include(l => l.JournalEntry)
                    .Where(l => l.ThirdPartyId == thirdPartyId && l.ThirdPartyKind == kind
                                && l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        // Même ancrage que la balance auxiliaire : sans quoi le solde d'ouverture et la ligne
        // d'à-nouveau du tiers compteraient deux fois le même report.
        var anchor = await ResolveFiscalAnchorAsync(ctx, f, cancellationToken);

        var openingBalance = await OpeningLines(Base(), anchor, f)
            .SumAsync(l => l.DebitAmount.Amount - l.CreditAmount.Amount, cancellationToken);

        var lines = await MovementLines(Base(), anchor, f, t)
            .OrderBy(l => l.JournalEntry.EntryDate)
            .ThenBy(l => l.JournalEntry.EntryNumber)
            .ThenBy(l => l.LineNumber)
            .ToListAsync(cancellationToken);

        var running = openingBalance;
        var rows = new List<ThirdPartyLedgerRowDto>(lines.Count);
        foreach (var line in lines)
        {
            running += line.DebitAmount.Amount - line.CreditAmount.Amount;
            rows.Add(new ThirdPartyLedgerRowDto
            {
                EntryDate = line.JournalEntry.EntryDate,
                JournalCode = line.JournalEntry.JournalCode,
                PieceNumber = line.JournalEntry.EntryNumber,
                PieceRef = line.JournalEntry.PieceRef,
                AccountNumber = line.AccountNumber,
                Label = line.Label,
                Debit = line.DebitAmount.Amount,
                Credit = line.CreditAmount.Amount,
                RunningBalance = running,
                LetteringCode = line.LetteringCode,
                CurrencyCode = line.JournalEntry.CurrencyCode,
                AmountInCurrency = line.DebitAmountInCurrency > 0
                    ? line.DebitAmountInCurrency
                    : line.CreditAmountInCurrency
            });
        }

        var names = await LoadThirdPartyNamesAsync(ctx, kind, new HashSet<Guid> { thirdPartyId }, cancellationToken);

        return Result.Success(new ThirdPartyLedgerDto
        {
            ThirdPartyId = thirdPartyId,
            ThirdPartyName = names.TryGetValue(thirdPartyId, out var n) ? n : thirdPartyId.ToString("N")[..8],
            OpeningBalance = openingBalance,
            Rows = rows
        });
    }

    /// <summary>Noms des tiers chargés en lot (pattern FecExportService) — jamais de N+1.</summary>
    private static async Task<Dictionary<Guid, string>> LoadThirdPartyNamesAsync(
        Persistence.TenantDbContext ctx, ThirdPartyKind kind, IReadOnlyCollection<Guid> ids, CancellationToken ct)
    {
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();

        return kind == ThirdPartyKind.Client
            ? await ctx.Clients.AsNoTracking()
                .Where(c => ids.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id, c => c.Name, ct)
            : await ctx.Suppliers.AsNoTracking()
                .Where(s => ids.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s.Name, ct);
    }

    public async Task<Result<IReadOnlyList<JournalSearchRowDto>>> SearchJournalEntriesAsync(
        string? accountNumber, string? journalCode, DateTime? from, DateTime? to,
        decimal? minAmount, decimal? maxAmount, string? label, string? letteringCode, int? status, int take,
        string? pieceRef = null,
        int? entryNumber = null,
        CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var q = ctx.JournalEntryLines.AsNoTracking().Include(l => l.JournalEntry).AsQueryable();

        if (!string.IsNullOrWhiteSpace(accountNumber))
        {
            var acc = accountNumber.Trim();
            q = q.Where(l => l.AccountNumber.StartsWith(acc));
        }
        if (!string.IsNullOrWhiteSpace(journalCode))
        {
            var jc = journalCode.Trim().ToUpperInvariant();
            q = q.Where(l => l.JournalEntry.JournalCode == jc);
        }
        if (from.HasValue) { var f = from.Value.Date; q = q.Where(l => l.JournalEntry.EntryDate >= f); }
        if (to.HasValue) { var t = to.Value.Date; q = q.Where(l => l.JournalEntry.EntryDate <= t); }
        if (!string.IsNullOrWhiteSpace(label))
        {
            var lbl = label.Trim();
            q = q.Where(l => l.Label.Contains(lbl));
        }
        if (!string.IsNullOrWhiteSpace(letteringCode))
        {
            var lc = letteringCode.Trim();
            q = q.Where(l => l.LetteringCode == lc);
        }
        if (!string.IsNullOrWhiteSpace(pieceRef))
        {
            var pr = pieceRef.Trim();
            q = q.Where(l => l.JournalEntry.PieceRef != null && l.JournalEntry.PieceRef.Contains(pr));
        }
        if (entryNumber.HasValue)
            q = q.Where(l => l.JournalEntry.EntryNumber == entryNumber.Value);
        if (status.HasValue)
        {
            var st = (JournalEntryStatus)status.Value;
            q = q.Where(l => l.JournalEntry.Status == st);
        }
        if (minAmount.HasValue)
        {
            var mn = minAmount.Value;
            q = q.Where(l => l.DebitAmount.Amount >= mn || l.CreditAmount.Amount >= mn);
        }
        if (maxAmount.HasValue)
        {
            var mx = maxAmount.Value;
            q = q.Where(l => (l.DebitAmount.Amount > 0 && l.DebitAmount.Amount <= mx)
                          || (l.CreditAmount.Amount > 0 && l.CreditAmount.Amount <= mx));
        }

        var lim = take <= 0 ? 200 : Math.Min(take, 1000);
        var rows = await q
            .OrderByDescending(l => l.JournalEntry.EntryDate)
            .ThenByDescending(l => l.JournalEntry.EntryNumber)
            .ThenBy(l => l.LineNumber)
            .Take(lim)
            .Select(l => new JournalSearchRowDto
            {
                EntryId = l.JournalEntryId,
                LineId = l.Id,
                EntryDate = l.JournalEntry.EntryDate,
                JournalCode = l.JournalEntry.JournalCode,
                EntryNumber = l.JournalEntry.EntryNumber,
                AccountNumber = l.AccountNumber,
                Label = l.Label,
                Debit = l.DebitAmount.Amount,
                Credit = l.CreditAmount.Amount,
                LetteringCode = l.LetteringCode,
                Status = (int)l.JournalEntry.Status,
                IsDraft = l.JournalEntry.Status == JournalEntryStatus.Brouillon,
                PieceRef = l.JournalEntry.PieceRef,
                CurrencyCode = l.JournalEntry.CurrencyCode,
                AmountInCurrency = l.DebitAmountInCurrency > 0
                    ? l.DebitAmountInCurrency
                    : l.CreditAmountInCurrency
            })
            .ToListAsync(cancellationToken);

        return Result.Success<IReadOnlyList<JournalSearchRowDto>>(rows);
    }

    /// <summary>
    /// Solde net (débit − crédit) par compte pour un exercice, sur écritures VALIDÉES (hors brouillard) —
    /// sensible aux à-nouveaux (T7). Trois régimes, selon <see cref="FiscalAnchorHelper.ResolveFiscalAnchorAsync"/> :
    /// <list type="bullet">
    /// <item><b>Ancré</b> (à-nouveau généré présent) : ouverture (l'à-nouveau lui-même) + mouvements de
    /// l'année — mathématiquement identique à l'ancien comportement cumulé sur la seule année.</item>
    /// <item><b>À-nouveau manuel/importé détecté</b> (journal « JAN » ou date 01/01, comptes 131/135,
    /// sans <c>SourceEntityType</c>) : traité comme ancré manuellement — mouvements de l'année SEULS
    /// (aucune injection synthétique, l'écriture manuelle porte déjà le cumul) ; avertissement.</item>
    /// <item><b>Non ancré, sans à-nouveau</b> : cumul historique complet (classes 1-5) + mouvements de
    /// l'année (classes 6-7 uniquement — jamais l'historique, qui n'a pas de solde d'ouverture légitime)
    /// + injection synthétique en 121 « Résultats reportés » du résultat net historique (jamais 128,
    /// réservé aux modifications comptables) pour que l'identité de la partie double (Σ tous comptes = 0)
    /// reste vérifiée malgré l'exclusion des comptes 6/7 historiques ; avertissement.</item>
    /// </list>
    /// Dans tous les cas, les comptes de résultat (classes 6/7) ne reçoivent jamais de solde d'ouverture.
    /// </summary>
    private static async Task<(Dictionary<string, decimal> Net, IReadOnlyList<string> Warnings)> LoadYearNetAsync(
        Persistence.TenantDbContext ctx, int fiscalYear, CancellationToken ct)
    {
        var jan1 = new DateTime(fiscalYear, 1, 1);
        var periodEnd = new DateTime(fiscalYear, 12, 31);

        IQueryable<JournalEntryLine> Scope() =>
            ctx.JournalEntryLines.AsNoTracking()
                .Include(l => l.JournalEntry)
                .Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        async Task<Dictionary<string, decimal>> NetByAccountAsync(IQueryable<JournalEntryLine> q)
        {
            var rows = await q
                .GroupBy(l => l.AccountNumber)
                .Select(g => new { Account = g.Key, Debit = g.Sum(l => l.DebitAmount.Amount), Credit = g.Sum(l => l.CreditAmount.Amount) })
                .ToListAsync(ct);
            return rows.ToDictionary(r => r.Account, r => r.Debit - r.Credit, StringComparer.Ordinal);
        }

        var anchor = await ResolveFiscalAnchorAsync(ctx, jan1, ct);
        var openingComp = await NetByAccountAsync(OpeningLines(Scope(), anchor, jan1));
        var movementComp = await NetByAccountAsync(MovementLines(Scope(), anchor, jan1, periodEnd));

        var warnings = new List<string>();
        var manualOpeningDetected = false;
        if (!anchor.IsAnchored)
        {
            manualOpeningDetected = await ctx.JournalEntryLines.AsNoTracking()
                .Include(l => l.JournalEntry)
                .Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon
                            && l.JournalEntry.EntryDate.Year == fiscalYear
                            && string.IsNullOrEmpty(l.JournalEntry.SourceEntityType)
                            && (l.JournalEntry.JournalCode == "JAN" || l.JournalEntry.EntryDate == jan1)
                            && (l.AccountNumber.StartsWith("131") || l.AccountNumber.StartsWith("135")))
                .AnyAsync(ct);

            if (manualOpeningDetected)
                warnings.Add("À-nouveaux manuels détectés : vérifier leur exhaustivité.");
        }

        var net = new Dictionary<string, decimal>(StringComparer.Ordinal);
        void Add(string account, decimal amount)
        {
            if (amount == 0) return;
            net[account] = net.TryGetValue(account, out var existing) ? existing + amount : amount;
        }

        var accounts = new HashSet<string>(openingComp.Keys, StringComparer.Ordinal);
        foreach (var a in movementComp.Keys) accounts.Add(a);

        foreach (var account in accounts)
        {
            openingComp.TryGetValue(account, out var op);
            movementComp.TryGetValue(account, out var mv);
            var cls = !string.IsNullOrEmpty(account) && char.IsDigit(account[0]) ? account[0] - '0' : 0;

            if (cls == 6 || cls == 7)
            {
                // Comptes de résultat : jamais de solde d'ouverture légitime.
                Add(account, mv);
                continue;
            }

            // Classes 1-5 : ancré ou manuel → mouvements seuls suffisent déjà (l'ouverture porte le
            // cumul via l'à-nouveau) ; non ancré sans AN → cumul historique complet + mouvements.
            Add(account, manualOpeningDetected ? mv : op + mv);
        }

        if (!anchor.IsAnchored && !manualOpeningDetected)
        {
            // Injection synthétique en 121 : sans à-nouveau, les comptes 6/7 historiques (exclus
            // ci-dessus) restent dans openingComp sans jamais avoir été comptés — l'identité de la
            // partie double (Σ tous comptes = 0) exige de reporter ce résultat net historique sur un
            // compte de bilan. 121 « Résultats reportés » (jamais 128, réservé aux modifications
            // comptables) reçoit exactement Σnet(classes 6,7 des années < N), ce qui compense
            // l'exclusion et restitue l'équilibre du bilan.
            decimal histPnl = 0;
            foreach (var kv in openingComp)
            {
                var cls = !string.IsNullOrEmpty(kv.Key) && char.IsDigit(kv.Key[0]) ? kv.Key[0] - '0' : 0;
                if (cls == 6 || cls == 7) histPnl += kv.Value;
            }
            Add("121", histPnl);

            if (histPnl != 0)
                warnings.Add("À-nouveaux absents pour l'exercice " + fiscalYear + ".");
        }

        return (net, warnings);
    }

    /// <summary>
    /// Agrégats de cession d'immobilisations de l'exercice N (T5), calculés à partir des lignes
    /// d'écritures marquées <c>SourceEntityType == FixedAssetDisposal</c> (statut ≠ Brouillon) :
    /// <c>DepreciationRemoved</c> = Σ débits sur comptes 28x/29x (amortissements/provisions repris) ;
    /// <c>Proceeds</c> = Σ débits sur comptes des classes 4 et 5 (créance de cession/encaissement).
    /// Le builder ne voit que des soldes nets — il ne peut pas distinguer une dotation ordinaire d'un
    /// amortissement sorti lors d'une cession sans cet agrégat calculé en amont.
    /// </summary>
    private static async Task<NctDisposalAggregates> LoadDisposalAggregatesAsync(
        Persistence.TenantDbContext ctx, int fiscalYear, CancellationToken ct)
    {
        var lines = await ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.SourceEntityType == AccountingService.SourceFixedAssetDisposal
                        && l.JournalEntry.EntryDate.Year == fiscalYear
                        && l.JournalEntry.Status != JournalEntryStatus.Brouillon)
            .Select(l => new { l.AccountNumber, Debit = l.DebitAmount.Amount })
            .ToListAsync(ct);

        decimal depreciationRemoved = 0, proceeds = 0;
        foreach (var l in lines)
        {
            var root2 = l.AccountNumber.Length >= 2 ? l.AccountNumber[..2] : l.AccountNumber;
            var cls = !string.IsNullOrEmpty(l.AccountNumber) && char.IsDigit(l.AccountNumber[0]) ? l.AccountNumber[0] - '0' : 0;
            if (root2 is "28" or "29")
                depreciationRemoved += l.Debit;
            else if (cls is 4 or 5)
                proceeds += l.Debit;
        }

        return new NctDisposalAggregates(depreciationRemoved, proceeds);
    }

    private static async Task<decimal> ComputeOverdueClientsAsync(Persistence.TenantDbContext ctx, CancellationToken ct)
    {
        var invoices = await ctx.Invoices.AsNoTracking()
            .Include(i => i.Client)
            .Where(i => i.Status != InvoiceStatus.Cancelled && i.Status != InvoiceStatus.Paid)
            .ToListAsync(ct);

        var ids = invoices.Select(i => i.Id).ToList();
        if (ids.Count == 0)
            return 0;

        var paidMap = await ctx.Payments.AsNoTracking()
            .Where(p => ids.Contains(p.InvoiceId) && !p.IsRefunded)
            .GroupBy(p => p.InvoiceId)
            .Select(g => new
            {
                InvoiceId = g.Key,
                Total = g.Sum(p => p.Amount.Amount + (p.ClientWithholdingAmount ?? 0m))
            })
            .ToDictionaryAsync(x => x.InvoiceId, x => x.Total, ct);

        var today = DateTime.UtcNow.Date;
        decimal sum = 0;
        foreach (var inv in invoices)
        {
            paidMap.TryGetValue(inv.Id, out var paid);
            var balance = inv.TotalAmount.Amount - paid;
            if (balance <= 0 || !inv.DueDate.HasValue)
                continue;
            var days = (today - inv.DueDate.Value.Date).Days;
            if (days > 90)
                sum += balance;
        }

        return sum;
    }

    private static JournalEntryDto MapEntry(JournalEntry j) => new()
    {
        Id = j.Id,
        EntryNumber = j.EntryNumber,
        JournalCode = j.JournalCode,
        EntryDate = j.EntryDate,
        Label = j.Label,
        SourceEntityType = j.SourceEntityType,
        SourceEntityId = j.SourceEntityId,
        IsAutoGenerated = j.IsAutoGenerated,
        IsReversed = j.IsReversed,
        ReversesEntryId = j.ReversesEntryId,
        Status = (int)j.Status,
        IsDraft = j.Status == JournalEntryStatus.Brouillon,
        PieceRef = j.PieceRef,
        PieceDate = j.PieceDate,
        CurrencyCode = j.CurrencyCode,
        ExchangeRate = j.ExchangeRate,
        ExchangeRateOverridden = j.ExchangeRateOverridden,
        Lines = j.Lines.OrderBy(l => l.LineNumber).Select(l => new JournalEntryLineDto
        {
            Id = l.Id,
            LineNumber = l.LineNumber,
            AccountNumber = l.AccountNumber,
            Label = l.Label,
            Debit = l.DebitAmount.Amount,
            Credit = l.CreditAmount.Amount,
            Currency = l.DebitAmount.Amount > 0 ? l.DebitAmount.Currency : l.CreditAmount.Currency,
            DebitInCurrency = l.DebitAmountInCurrency,
            CreditInCurrency = l.CreditAmountInCurrency,
            LetteringCode = l.LetteringCode,
            ThirdPartyId = l.ThirdPartyId,
            ThirdPartyKind = (int)l.ThirdPartyKind
        }).ToList()
    };

    // ── État budgétaire (budget vs réalisé) ─────────────────────────────────

    public async Task<Result<BudgetReportDto>> GetBudgetReportAsync(
        int fiscalYear, int? throughMonth, CancellationToken cancellationToken = default)
    {
        if (!_settings.BudgetingEnabled)
            return Result.Failure<BudgetReportDto>(Error.Validation(
                "Budgeting", "La comptabilité budgétaire n'est pas activée."));
        if (fiscalYear is < 2000 or > 2100)
            return Result.Failure<BudgetReportDto>(Error.Validation("FiscalYear", "Exercice invalide."));
        var lastMonth = throughMonth is >= 1 and <= 12 ? throughMonth.Value : 12;

        await using var ctx = _contextFactory.CreateContext();

        var posts = await ctx.BudgetPosts.AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.DisplayOrder).ThenBy(p => p.Code)
            .ToListAsync(cancellationToken);

        var year = await ctx.BudgetYears.AsNoTracking()
            .FirstOrDefaultAsync(y => y.FiscalYear == fiscalYear, cancellationToken);
        var isValidated = year?.Status == BudgetYearStatus.Validated;

        var budgetLines = await ctx.BudgetLines.AsNoTracking()
            .Where(l => l.FiscalYear == fiscalYear)
            .ToListAsync(cancellationToken);

        // Réalisé : une seule requête, agrégée par compte + mois (mêmes règles brouillard que la balance).
        var from = new DateTime(fiscalYear, 1, 1);
        var to = new DateTime(fiscalYear, 12, 31);
        var linesQuery = ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate >= from && l.JournalEntry.EntryDate <= to);
        if (!ShowDrafts)
            linesQuery = linesQuery.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        var actualByAccountMonth = await linesQuery
            .GroupBy(l => new { l.AccountNumber, l.JournalEntry.EntryDate.Month })
            .Select(g => new
            {
                g.Key.AccountNumber,
                g.Key.Month,
                Debit = g.Sum(l => l.DebitAmount.Amount),
                Credit = g.Sum(l => l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        // Affectation compte → poste : le préfixe le plus long gagne (un compte compté une fois).
        var prefixToPost = new List<(string Prefix, BudgetPost Post)>();
        foreach (var post in posts)
            foreach (var prefix in post.GetPrefixes())
                prefixToPost.Add((prefix, post));
        prefixToPost.Sort((a, b) => b.Prefix.Length.CompareTo(a.Prefix.Length));

        BudgetPost? ResolvePost(string account)
        {
            foreach (var (prefix, post) in prefixToPost)
                if (account.StartsWith(prefix, StringComparison.Ordinal))
                    return post;
            return null;
        }

        var actualByPost = posts.ToDictionary(p => p.Id, _ => new decimal[12]);
        var offPostExpense = new decimal[12];
        var offPostRevenue = new decimal[12];
        foreach (var cell in actualByAccountMonth)
        {
            var post = ResolvePost(cell.AccountNumber);
            if (post is not null)
            {
                var signed = post.Kind == BudgetPostKind.Expense
                    ? cell.Debit - cell.Credit
                    : cell.Credit - cell.Debit;
                actualByPost[post.Id][cell.Month - 1] += signed;
            }
            else if (cell.AccountNumber.StartsWith('6'))
            {
                offPostExpense[cell.Month - 1] += cell.Debit - cell.Credit;
            }
            else if (cell.AccountNumber.StartsWith('7'))
            {
                offPostRevenue[cell.Month - 1] += cell.Credit - cell.Debit;
            }
            // Autres classes non couvertes par un préfixe : hors périmètre budgétaire.
        }

        var budgetByPost = budgetLines.ToLookup(l => l.BudgetPostId);
        var rows = new List<BudgetReportRowDto>(posts.Count + 2);
        foreach (var post in posts)
        {
            var initial = new decimal[12];
            var revised = new decimal[12];
            foreach (var line in budgetByPost[post.Id])
            {
                if (line.Version == BudgetVersion.Initial) initial[line.Month - 1] = line.Amount;
                else revised[line.Month - 1] = line.Amount;
            }
            // Tant que l'initial n'est pas validé, le « révisé » affiché = l'initial.
            if (!isValidated)
                revised = initial;

            rows.Add(BuildRow(post.Code, post.Label, (int)post.Kind, isOffPost: false,
                initial, revised, actualByPost[post.Id], lastMonth));
        }

        if (offPostExpense.Any(v => v != 0m))
            rows.Add(BuildRow("—", "Hors postes (charges)", (int)BudgetPostKind.Expense, isOffPost: true,
                new decimal[12], new decimal[12], offPostExpense, lastMonth));
        if (offPostRevenue.Any(v => v != 0m))
            rows.Add(BuildRow("—", "Hors postes (produits)", (int)BudgetPostKind.Revenue, isOffPost: true,
                new decimal[12], new decimal[12], offPostRevenue, lastMonth));

        var totals = new BudgetReportTotalsDto
        {
            ExpenseInitial = rows.Where(r => r.Kind == (int)BudgetPostKind.Expense).Sum(r => r.PeriodInitial),
            ExpenseRevised = rows.Where(r => r.Kind == (int)BudgetPostKind.Expense).Sum(r => r.PeriodRevised),
            ExpenseActual = rows.Where(r => r.Kind == (int)BudgetPostKind.Expense).Sum(r => r.PeriodActual),
            RevenueInitial = rows.Where(r => r.Kind == (int)BudgetPostKind.Revenue).Sum(r => r.PeriodInitial),
            RevenueRevised = rows.Where(r => r.Kind == (int)BudgetPostKind.Revenue).Sum(r => r.PeriodRevised),
            RevenueActual = rows.Where(r => r.Kind == (int)BudgetPostKind.Revenue).Sum(r => r.PeriodActual)
        };

        return Result.Success(new BudgetReportDto
        {
            FiscalYear = fiscalYear,
            ThroughMonth = lastMonth,
            IsValidated = isValidated,
            Rows = rows,
            Totals = totals
        });
    }

    private static BudgetReportRowDto BuildRow(string code, string label, int kind, bool isOffPost,
        decimal[] initial, decimal[] revised, decimal[] actual, int lastMonth)
    {
        var periodInitial = initial.Take(lastMonth).Sum();
        var periodRevised = revised.Take(lastMonth).Sum();
        var periodActual = actual.Take(lastMonth).Sum();
        return new BudgetReportRowDto
        {
            Code = code,
            Label = label,
            Kind = kind,
            IsOffPost = isOffPost,
            MonthlyInitial = initial,
            MonthlyRevised = revised,
            MonthlyActual = actual,
            PeriodInitial = periodInitial,
            PeriodRevised = periodRevised,
            PeriodActual = periodActual,
            Variance = periodActual - periodRevised,
            ConsumptionPercent = periodRevised != 0m
                ? Math.Round(periodActual / periodRevised * 100m, 1)
                : null
        };
    }
}
