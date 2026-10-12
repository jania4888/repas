using System.Linq.Expressions;
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
using FactuTrust.Infrastructure.Services.Lettering;
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

        var q = LetteringLinesQueryBuilder.Build(ctx, query, ShowDrafts);

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
            .Select(RawLineProjection)
            .ToListAsync(cancellationToken);

        var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
        var names = await LetteringThirdPartyNames.ResolveAsync(ctx, rawRows.Select(r => (r.ThirdPartyId, r.ThirdPartyKind)), cancellationToken);

        var items = rawRows.Select(r => ToDto(r, lockedYears, names)).ToList();

        var totalCount = totalsRow?.Count ?? 0;
        var totals = BuildTotalsDto(totalsRow);

        var dto = new LetteringLinesPageDto(items, page, pageSize, totalCount, totalCount > items.Count, totals);
        return Result.Success(dto);
    }

    public async Task<IReadOnlyDictionary<Guid, string?>> GetLineCodesAsync(
        IReadOnlyCollection<Guid> lineIds, CancellationToken cancellationToken = default)
    {
        if (lineIds.Count == 0)
            return new Dictionary<Guid, string?>();

        var ids = lineIds.Distinct().ToList();
        await using var ctx = _contextFactory.CreateContext();
        return await ctx.JournalEntryLines.AsNoTracking()
            .Where(l => ids.Contains(l.Id))
            .Select(l => new { l.Id, l.LetteringCode })
            .ToDictionaryAsync(l => l.Id, l => l.LetteringCode, cancellationToken);
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
            .Select(RawLineProjection)
            .ToListAsync(cancellationToken);

        var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
        var names = await LetteringThirdPartyNames.ResolveAsync(ctx, rawRows.Select(r => (r.ThirdPartyId, r.ThirdPartyKind)), cancellationToken);

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

    private static LetteringTotalsDto BuildTotalsDto(TotalsRow? row)
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

    /// <summary>
    /// Projection unique ligne d'écriture → <see cref="RawLineRow"/>, partagée par les deux
    /// requêtes (lignes filtrées et contenu d'un groupe) : les faits scalaires du prédicat D8
    /// (statut, période close, exercice) y sont lus une seule fois.
    /// </summary>
    private static readonly Expression<Func<JournalEntryLine, RawLineRow>> RawLineProjection = l => new RawLineRow
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
    };

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
