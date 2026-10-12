using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// API de lecture dédiée à l'écran de lettrage (plan de refonte, §4.1/4.2, Annexe A §1). Service
/// séparé d'<c>AccountingReportingService</c> (déjà volumineux) : filtres/pagination/totaux côté
/// SQL, projection directe (pas d'<c>Include</c>), <see cref="LetteringPeriodLock"/> partagé avec
/// <see cref="LetteringService"/> pour que le flag <c>PeriodLocked</c> suive exactement la même
/// règle (D8) que le refus serveur.
/// </summary>
public sealed class LetteringQueryService : ILetteringQueryService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly AccountingSettings _settings;
    private readonly ICurrentUser _currentUser;
    private readonly MasterDbContext? _masterDb;

    public LetteringQueryService(
        ITenantDbContextFactory contextFactory,
        IOptions<AccountingSettings> settings,
        ICurrentUser currentUser,
        MasterDbContext? masterDb = null)
    {
        _contextFactory = contextFactory;
        _settings = settings.Value;
        _currentUser = currentUser;
        _masterDb = masterDb;
    }

    private bool ShowDrafts => _settings.IncludeBrouillardInReports;

    private const int MaxPageSize = 2000;

    public async Task<Result<LetteringLinesPageDto>> GetLinesAsync(
        GetLetteringLinesQuery query, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var q = BuildFilteredQuery(ctx, query);

        var totalsRow = await ComputeTotalsAsync(q, cancellationToken);

        var page = Math.Max(query.Page, 1);
        var pageSize = Math.Clamp(query.PageSize <= 0 ? 500 : query.PageSize, 1, MaxPageSize);

        var rawRows = await q
            .OrderBy(l => l.JournalEntry.EntryDate)
            .ThenBy(l => l.JournalEntry.JournalCode)
            .ThenBy(l => l.JournalEntry.EntryNumber)
            .ThenBy(l => l.LineNumber)
            .ThenBy(l => l.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(l => new RawLineRow
            {
                LineId = l.Id,
                EntryId = l.JournalEntryId,
                EntryDate = l.JournalEntry.EntryDate,
                JournalCode = l.JournalEntry.JournalCode,
                EntryNumber = l.JournalEntry.EntryNumber,
                LineNumber = l.LineNumber,
                AccountNumber = l.AccountNumber,
                Label = l.Label,
                EntryLabel = l.JournalEntry.Label,
                PieceRef = l.JournalEntry.PieceRef,
                SourceEntityType = l.JournalEntry.SourceEntityType,
                Debit = l.DebitAmount.Amount,
                Credit = l.CreditAmount.Amount,
                OperationCurrency = l.JournalEntry.CurrencyCode,
                DebitInCurrency = l.DebitAmountInCurrency,
                CreditInCurrency = l.CreditAmountInCurrency,
                LetteringCode = l.LetteringCode,
                ThirdPartyId = l.ThirdPartyId,
                ThirdPartyKind = l.ThirdPartyKind,
                IsDraft = l.JournalEntry.Status == JournalEntryStatus.Brouillon,
                IsReversed = l.JournalEntry.IsReversed,
                IsReversal = l.JournalEntry.ReversesEntryId != null,
                Status = l.JournalEntry.Status,
                PeriodIsClosed = l.JournalEntry.AccountingPeriod != null && l.JournalEntry.AccountingPeriod.IsClosed,
                FiscalYear = l.JournalEntry.AccountingPeriod != null ? l.JournalEntry.AccountingPeriod.FiscalYear : l.JournalEntry.EntryDate.Year
            })
            .ToListAsync(cancellationToken);

        var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
        var names = await ResolveThirdPartyNamesAsync(ctx, rawRows, cancellationToken);

        var items = rawRows.Select(r => ToDto(r, lockedYears, names)).ToList();

        var totalCount = totalsRow?.Count ?? 0;
        var totals = BuildTotalsDto(totalsRow, items);

        var dto = new LetteringLinesPageDto(items, page, pageSize, totalCount, totalCount > items.Count, totals);
        return Result.Success(dto);
    }

    public async Task<Result<LetteringGroupDto>> GetGroupAsync(string code, CancellationToken cancellationToken = default)
    {
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();

        await using var ctx = _contextFactory.CreateContext();

        var group = await ctx.LetteringGroups
            .AsNoTracking()
            .Include(g => g.Members)
            .FirstOrDefaultAsync(g => g.Code == normalized, cancellationToken);

        if (group is null)
            return Result.Failure<LetteringGroupDto>(LetteringErrors.GroupNotFound($"Groupe de lettrage « {normalized} » introuvable."));

        var lineIds = group.Members.Select(m => m.JournalEntryLineId).ToList();

        var rawRows = await ctx.JournalEntryLines.AsNoTracking()
            .Where(l => lineIds.Contains(l.Id))
            .Select(l => new RawLineRow
            {
                LineId = l.Id,
                EntryId = l.JournalEntryId,
                EntryDate = l.JournalEntry.EntryDate,
                JournalCode = l.JournalEntry.JournalCode,
                EntryNumber = l.JournalEntry.EntryNumber,
                LineNumber = l.LineNumber,
                AccountNumber = l.AccountNumber,
                Label = l.Label,
                EntryLabel = l.JournalEntry.Label,
                PieceRef = l.JournalEntry.PieceRef,
                SourceEntityType = l.JournalEntry.SourceEntityType,
                Debit = l.DebitAmount.Amount,
                Credit = l.CreditAmount.Amount,
                OperationCurrency = l.JournalEntry.CurrencyCode,
                DebitInCurrency = l.DebitAmountInCurrency,
                CreditInCurrency = l.CreditAmountInCurrency,
                LetteringCode = l.LetteringCode,
                ThirdPartyId = l.ThirdPartyId,
                ThirdPartyKind = l.ThirdPartyKind,
                IsDraft = l.JournalEntry.Status == JournalEntryStatus.Brouillon,
                IsReversed = l.JournalEntry.IsReversed,
                IsReversal = l.JournalEntry.ReversesEntryId != null,
                Status = l.JournalEntry.Status,
                PeriodIsClosed = l.JournalEntry.AccountingPeriod != null && l.JournalEntry.AccountingPeriod.IsClosed,
                FiscalYear = l.JournalEntry.AccountingPeriod != null ? l.JournalEntry.AccountingPeriod.FiscalYear : l.JournalEntry.EntryDate.Year
            })
            .ToListAsync(cancellationToken);

        var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
        var names = await ResolveThirdPartyNamesAsync(ctx, rawRows, cancellationToken);

        var lines = rawRows
            .OrderBy(r => r.EntryDate).ThenBy(r => r.JournalCode).ThenBy(r => r.EntryNumber).ThenBy(r => r.LineNumber)
            .Select(r => ToDto(r, lockedYears, names))
            .ToList();

        var anyLocked = lines.Any(l => l.PeriodLocked);

        // CanComplete : affichage seulement (le serveur revérifie tout à l'action). Il faut le
        // droit de lettrage (AccountingCreate) ET qu'aucune ligne du groupe ne soit verrouillée
        // (D8) — sinon le bouton « Compléter » proposerait une action vouée au refus.
        var hasCreatePermission = _currentUser.HasPermission(Permissions.Accounting.Create);
        var canComplete = group.IsPartial && hasCreatePermission && !anyLocked;
        var createdByDisplayName = await ResolveDisplayNameAsync(group.CreatedBy, cancellationToken);

        // CanUnletter / UnletterBlockedReason : affichage seulement, le serveur revérifie tout à
        // l'action (policy AccountingUnletter + relecture du verrou d'exercice par UnletterAsync).
        var hasUnletterPermission = _currentUser.HasPermission(Permissions.Accounting.Unletter);
        bool canUnletter = hasUnletterPermission && !anyLocked;
        string? blockedReason = !hasUnletterPermission ? "permission" : anyLocked ? "period_locked" : null;

        // Devise d'opération : celle des ÉCRITURES du groupe (CurrencyCode des lignes), pas celle
        // du montant du groupe — celui-ci est toujours exprimé en devise de tenue (TND).
        var operationCurrency = lines.Count > 0 && !string.IsNullOrEmpty(lines[0].OperationCurrency)
            ? lines[0].OperationCurrency
            : group.Amount.Currency;

        var dto = new LetteringGroupDto(
            group.Id, group.Code, group.AccountNumber, group.Amount.Amount, operationCurrency, group.IsPartial,
            group.LetteredAt, createdByDisplayName, lines, canUnletter, blockedReason, canComplete);

        return Result.Success(dto);
    }

    /// <summary>
    /// Nom d'affichage du créateur du groupe (§4.2) : « Prénom Nom » résolu depuis la base master
    /// (le lettrage trace l'email technique). L'identifiant brut / l'email ne sont JAMAIS exposés :
    /// à défaut de résolution, un libellé neutre est renvoyé (« Système » pour les flux
    /// automatiques, « Utilisateur » pour un compte introuvable ou sans nom).
    /// </summary>
    private async Task<string> ResolveDisplayNameAsync(string? createdBy, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(createdBy) || string.Equals(createdBy, "system", StringComparison.OrdinalIgnoreCase))
            return "Système";

        if (_masterDb is not null)
        {
            var email = createdBy.Trim();
            var displayName = await _masterDb.Users
                .AsNoTracking()
                .Where(u => u.Email == email)
                .Select(u => (u.FirstName + " " + u.LastName).Trim())
                .FirstOrDefaultAsync(cancellationToken);
            if (!string.IsNullOrWhiteSpace(displayName))
                return displayName;
        }

        return "Utilisateur";
    }

    private IQueryable<JournalEntryLine> BuildFilteredQuery(Persistence.TenantDbContext ctx, GetLetteringLinesQuery query)
    {
        var account = (query.Account ?? string.Empty).Trim();
        var q = ctx.JournalEntryLines.AsNoTracking().AsQueryable();

        q = query.AccountMatch == LetteringAccountMatch.Prefix
            ? q.Where(l => l.AccountNumber.StartsWith(account))
            : q.Where(l => l.AccountNumber == account);

        var from = query.From.Date;
        var toExclusive = query.To.Date.AddDays(1);
        q = q.Where(l => l.JournalEntry.EntryDate >= from && l.JournalEntry.EntryDate < toExclusive);

        if (!ShowDrafts)
            q = q.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        q = query.State switch
        {
            LetteringStateFilter.Unlettered => q.Where(l => l.LetteringCode == null || l.LetteringCode == string.Empty),
            LetteringStateFilter.Partial => q.Where(l => l.LetteringCode != null && l.LetteringCode.StartsWith("P")),
            LetteringStateFilter.Lettered => q.Where(l => l.LetteringCode != null && l.LetteringCode != string.Empty && !l.LetteringCode.StartsWith("P")),
            _ => q
        };

        if (!string.IsNullOrWhiteSpace(query.JournalCode))
        {
            var jc = query.JournalCode.Trim().ToUpperInvariant();
            q = q.Where(l => l.JournalEntry.JournalCode == jc);
        }

        var (sourceTypes, includeManual, includeOther) = LetteringSourceCategories.ResolveFilter(query.SourceCategories);
        if (sourceTypes.Count > 0 || includeManual || includeOther)
        {
            var knownTypes = LetteringSourceCategories.KnownSourceEntityTypes;
            q = q.Where(l =>
                sourceTypes.Contains(l.JournalEntry.SourceEntityType!)
                || (includeManual && l.JournalEntry.SourceEntityType == null)
                || (includeOther && l.JournalEntry.SourceEntityType != null && !knownTypes.Contains(l.JournalEntry.SourceEntityType)));
        }

        if (query.ThirdPartyId.HasValue)
        {
            var tid = query.ThirdPartyId.Value;
            var tkind = query.ThirdPartyKind!.Value;
            q = q.Where(l => l.ThirdPartyId == tid && l.ThirdPartyKind == tkind);
        }

        q = query.Side switch
        {
            LetteringSideFilter.Debit => q.Where(l => l.DebitAmount.Amount > 0),
            LetteringSideFilter.Credit => q.Where(l => l.CreditAmount.Amount > 0),
            _ => q
        };

        if (query.MinAmount.HasValue)
        {
            var mn = query.MinAmount.Value;
            q = q.Where(l => l.DebitAmount.Amount + l.CreditAmount.Amount >= mn);
        }
        if (query.MaxAmount.HasValue)
        {
            var mx = query.MaxAmount.Value;
            q = q.Where(l => l.DebitAmount.Amount + l.CreditAmount.Amount <= mx);
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            if (int.TryParse(term, out var entryNumber))
            {
                q = q.Where(l => l.JournalEntry.EntryNumber == entryNumber
                    || l.Label.Contains(term) || l.JournalEntry.Label.Contains(term)
                    || (l.JournalEntry.PieceRef != null && l.JournalEntry.PieceRef.Contains(term)));
            }
            else
            {
                q = q.Where(l => l.Label.Contains(term) || l.JournalEntry.Label.Contains(term)
                    || (l.JournalEntry.PieceRef != null && l.JournalEntry.PieceRef.Contains(term)));
            }
        }

        return q;
    }

    private static async Task<TotalsRow?> ComputeTotalsAsync(IQueryable<JournalEntryLine> q, CancellationToken cancellationToken)
    {
        // Deux requêtes simples, toutes deux traduisibles en SQL (EF Core 8 ne traduit ni les
        // agrégats sur des groupes d'entités avec types possédés Money, ni les sous-requêtes
        // Where/Distinct imbriquées dans une projection de GroupBy) :
        //  A) totaux scalaires via projection en colonnes AVANT le GroupBy constant ;
        //  B) sondage des devises étrangères DISTINCTES du filtre, plafonné à 2 lignes
        //     (Take(2)) — la seule information utile est « 0, 1 ou plusieurs » (§4.1 : totaux
        //     en devise exposés seulement s'il y a EXACTEMENT une devise étrangère ; la devise
        //     de tenue TND ne compte pas). Déterministe, pas de FirstOrDefault sur un groupe.
        var totals = await q
            .Select(l => new
            {
                Debit = l.DebitAmount.Amount,
                Credit = l.CreditAmount.Amount,
                l.DebitAmountInCurrency,
                l.CreditAmountInCurrency,
                IsUnlettered = l.LetteringCode == null || l.LetteringCode == string.Empty
            })
            .GroupBy(_ => 1)
            .Select(g => new TotalsRow
            {
                Count = g.Count(),
                DebitCount = g.Sum(x => x.Debit > 0 ? 1 : 0),
                CreditCount = g.Sum(x => x.Credit > 0 ? 1 : 0),
                TotalDebit = g.Sum(x => x.Debit),
                TotalCredit = g.Sum(x => x.Credit),
                UnletteredDebit = g.Sum(x => x.IsUnlettered ? x.Debit : 0m),
                UnletteredCredit = g.Sum(x => x.IsUnlettered ? x.Credit : 0m),
                TotalDebitInCurrency = g.Sum(x => x.DebitAmountInCurrency),
                TotalCreditInCurrency = g.Sum(x => x.CreditAmountInCurrency)
            })
            .SingleOrDefaultAsync(cancellationToken);

        var foreignCurrencies = await q
            .Where(l => l.JournalEntry.CurrencyCode != Money.DefaultCurrency)
            .Select(l => l.JournalEntry.CurrencyCode)
            .Distinct()
            .Take(2)
            .ToListAsync(cancellationToken);

        if (totals is null)
            return null;

        totals.DistinctForeignCurrencies = foreignCurrencies.Count; // plafonné à 2 = « plusieurs »
        totals.SingleForeignCurrency = foreignCurrencies.Count == 1 ? foreignCurrencies[0] : null;
        return totals;
    }

    private static LetteringTotalsDto BuildTotalsDto(TotalsRow? row, List<LetteringLineDto> pageItems)
    {
        if (row is null)
            return new LetteringTotalsDto(0, 0, 0, 0m, 0m, 0m, 0m, 0m, 0m, null, null, null);

        string? singleForeignCurrency = null;
        decimal? totalDebitInCurrency = null;
        decimal? totalCreditInCurrency = null;
        if (row.DistinctForeignCurrencies == 1 && row.SingleForeignCurrency is not null)
        {
            singleForeignCurrency = row.SingleForeignCurrency;
            totalDebitInCurrency = row.TotalDebitInCurrency;
            totalCreditInCurrency = row.TotalCreditInCurrency;
        }

        return new LetteringTotalsDto(
            row.Count, row.DebitCount, row.CreditCount,
            row.TotalDebit, row.TotalCredit, row.TotalDebit - row.TotalCredit,
            row.UnletteredDebit, row.UnletteredCredit, row.UnletteredDebit - row.UnletteredCredit,
            singleForeignCurrency, totalDebitInCurrency, totalCreditInCurrency);
    }

    private static async Task<Dictionary<(ThirdPartyKind, Guid), string>> ResolveThirdPartyNamesAsync(
        Persistence.TenantDbContext ctx, List<RawLineRow> rows, CancellationToken cancellationToken)
    {
        var result = new Dictionary<(ThirdPartyKind, Guid), string>();

        var clientIds = rows.Where(r => r.ThirdPartyKind == ThirdPartyKind.Client && r.ThirdPartyId.HasValue)
            .Select(r => r.ThirdPartyId!.Value).Distinct().ToList();
        var supplierIds = rows.Where(r => r.ThirdPartyKind == ThirdPartyKind.Supplier && r.ThirdPartyId.HasValue)
            .Select(r => r.ThirdPartyId!.Value).Distinct().ToList();
        var employeeIds = rows.Where(r => r.ThirdPartyKind == ThirdPartyKind.Employee && r.ThirdPartyId.HasValue)
            .Select(r => r.ThirdPartyId!.Value).Distinct().ToList();

        if (clientIds.Count > 0)
        {
            var clients = await ctx.Clients.AsNoTracking()
                .Where(c => clientIds.Contains(c.Id))
                .Select(c => new { c.Id, c.Name })
                .ToListAsync(cancellationToken);
            foreach (var c in clients)
                result[(ThirdPartyKind.Client, c.Id)] = c.Name;
        }
        if (supplierIds.Count > 0)
        {
            var suppliers = await ctx.Suppliers.AsNoTracking()
                .Where(s => supplierIds.Contains(s.Id))
                .Select(s => new { s.Id, s.Name })
                .ToListAsync(cancellationToken);
            foreach (var s in suppliers)
                result[(ThirdPartyKind.Supplier, s.Id)] = s.Name;
        }
        if (employeeIds.Count > 0)
        {
            var employees = await ctx.Employees.AsNoTracking()
                .Where(e => employeeIds.Contains(e.Id))
                .Select(e => new { e.Id, e.FirstName, e.LastName })
                .ToListAsync(cancellationToken);
            foreach (var e in employees)
                result[(ThirdPartyKind.Employee, e.Id)] = $"{e.FirstName} {e.LastName}".Trim();
        }

        return result;
    }

    private static LetteringLineDto ToDto(
        RawLineRow r, HashSet<int> lockedYears, Dictionary<(ThirdPartyKind, Guid), string> names)
    {
        string? thirdPartyName = r.ThirdPartyId.HasValue && names.TryGetValue((r.ThirdPartyKind, r.ThirdPartyId.Value), out var n)
            ? n
            : null;

        // Prédicat unique (D8) : la projection fournit les trois faits scalaires, la règle reste
        // celle de LetteringPeriodLock — jamais de logique de verrou dupliquée ici.
        var periodLocked = LetteringPeriodLock.IsLocked(r.Status, r.PeriodIsClosed, r.FiscalYear, lockedYears);

        return new LetteringLineDto(
            r.LineId, r.EntryId, r.EntryDate, r.JournalCode, r.EntryNumber, r.LineNumber,
            r.AccountNumber, string.IsNullOrEmpty(r.Label) ? r.EntryLabel : r.Label, r.EntryLabel, r.PieceRef,
            LetteringSourceCategories.Resolve(r.SourceEntityType),
            r.Debit, r.Credit, r.OperationCurrency,
            r.DebitInCurrency, r.CreditInCurrency,
            r.LetteringCode, !string.IsNullOrEmpty(r.LetteringCode) && r.LetteringCode.StartsWith("P", StringComparison.Ordinal),
            r.ThirdPartyId, (int)r.ThirdPartyKind, thirdPartyName,
            r.IsDraft, r.IsReversed, r.IsReversal,
            periodLocked);
    }

    private sealed class RawLineRow
    {
        public Guid LineId { get; set; }
        public Guid EntryId { get; set; }
        public DateTime EntryDate { get; set; }
        public string JournalCode { get; set; } = string.Empty;
        public int EntryNumber { get; set; }
        public int LineNumber { get; set; }
        public string AccountNumber { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public string EntryLabel { get; set; } = string.Empty;
        public string? PieceRef { get; set; }
        public string? SourceEntityType { get; set; }
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public string OperationCurrency { get; set; } = string.Empty;
        public decimal DebitInCurrency { get; set; }
        public decimal CreditInCurrency { get; set; }
        public string? LetteringCode { get; set; }
        public Guid? ThirdPartyId { get; set; }
        public ThirdPartyKind ThirdPartyKind { get; set; }
        public bool IsDraft { get; set; }
        public bool IsReversed { get; set; }
        public bool IsReversal { get; set; }
        public JournalEntryStatus Status { get; set; }
        public bool PeriodIsClosed { get; set; }
        public int FiscalYear { get; set; }
    }

    private sealed class TotalsRow
    {
        public int Count { get; set; }
        public int DebitCount { get; set; }
        public int CreditCount { get; set; }
        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }
        public decimal UnletteredDebit { get; set; }
        public decimal UnletteredCredit { get; set; }
        public int DistinctForeignCurrencies { get; set; }
        public decimal TotalDebitInCurrency { get; set; }
        public decimal TotalCreditInCurrency { get; set; }
        public string? SingleForeignCurrency { get; set; }
    }
}
