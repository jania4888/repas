using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>Résultat du chargement des candidats du moteur de propositions.</summary>
/// <param name="Candidates">Lignes candidates, dans l'ordre de lecture stable ; <c>OrderRank</c> = index.</param>
/// <param name="Links">Liens règlement → facture des lignes de règlement chargées (règle R1).</param>
/// <param name="Truncated">Vrai si plus de lignes que le plafond correspondaient au filtre.</param>
internal sealed record LoadedCandidates(
    IReadOnlyList<LetteringCandidate> Candidates,
    DocumentLinks Links,
    bool Truncated);

/// <summary>
/// Charge les lignes candidates aux propositions de lettrage (plan v2, Phase 3, annexe C §2.1).
/// Lecture seule, <c>AsNoTracking</c>, projection directe, aucun <c>Include</c>.
/// </summary>
/// <remarks>
/// <para>
/// Une ligne candidate est : non lettrée (ni totale, ni partielle), d'une écriture validée (jamais un
/// brouillon), ni extournée ni extourne, de montant non nul, et hors période verrouillée (D8). Toutes
/// ces exclusions sont faites <b>en SQL, avant le plafond</b> : sinon des lignes inutilisables
/// consommeraient le plafond et masqueraient des candidates valides.
/// </para>
/// <para>
/// Les filtres d'état et de sens de l'écran sont ignorés (une proposition a besoin des deux sens) ;
/// les autres filtres (compte, dates, journal, catégorie, tiers, montants, recherche) s'appliquent
/// via <see cref="LetteringLinesQueryBuilder"/>, la même requête que l'écran.
/// </para>
/// <para>
/// Le verrou de période est revérifié en mémoire avec <see cref="LetteringPeriodLock.IsLocked(JournalEntryStatus, bool, int, HashSet{int})"/>,
/// le prédicat unique partagé avec les commandes : le filtre SQL ne fait qu'éviter de charger ces
/// lignes, la règle qui fait foi reste celle-ci.
/// </para>
/// </remarks>
internal static class LetteringCandidateLoader
{
    /// <summary>
    /// Taille des paquets d'identifiants de règlement : reste loin de la limite de 2 100 paramètres
    /// de SQL Server, quelle que soit la stratégie de traduction de <c>Contains</c>.
    /// </summary>
    internal const int PaymentIdChunkSize = 1000;

    internal static async Task<LoadedCandidates> LoadAsync(
        TenantDbContext ctx,
        GetLetteringLinesQuery filter,
        int maxCandidateLines,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ctx);
        ArgumentNullException.ThrowIfNull(filter);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxCandidateLines, 1);

        var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
        var lockedYearList = lockedYears.OrderBy(y => y).ToList();

        var candidateFilter = filter with { State = LetteringStateFilter.Unlettered, Side = LetteringSideFilter.All };

        var rows = await LetteringLinesQueryBuilder.Build(ctx, candidateFilter, showDrafts: false)
            .Where(l => !l.JournalEntry.IsReversed && l.JournalEntry.ReversesEntryId == null)
            // Montant non nul dans la devise qui équilibre le groupe (même règle que SignedForBalance) :
            // TND pour une opération en TND, devise de l'opération sinon. CurrencyCode est normalisé
            // (majuscules, vide → TND) par JournalEntry : la comparaison est sûre en SQL.
            .Where(l => l.JournalEntry.CurrencyCode == Money.DefaultCurrency
                ? l.DebitAmount.Amount != l.CreditAmount.Amount
                : l.DebitAmountInCurrency != l.CreditAmountInCurrency)
            .Where(l => l.JournalEntry.Status != JournalEntryStatus.Cloturee
                && !(l.JournalEntry.AccountingPeriod != null && l.JournalEntry.AccountingPeriod.IsClosed)
                && !lockedYearList.Contains(l.JournalEntry.AccountingPeriod != null
                    ? l.JournalEntry.AccountingPeriod.FiscalYear
                    : l.JournalEntry.EntryDate.Year))
            .OrderBy(l => l.JournalEntry.EntryDate)
            .ThenBy(l => l.JournalEntry.JournalCode)
            .ThenBy(l => l.JournalEntry.EntryNumber)
            .ThenBy(l => l.LineNumber)
            .ThenBy(l => l.Id)
            .Take(maxCandidateLines + 1)
            .Select(l => new CandidateRow
            {
                LineId = l.Id,
                EntryId = l.JournalEntryId,
                LineNumber = l.LineNumber,
                AccountNumber = l.AccountNumber,
                CurrencyCode = l.JournalEntry.CurrencyCode,
                Debit = l.DebitAmount.Amount,
                Credit = l.CreditAmount.Amount,
                DebitInCurrency = l.DebitAmountInCurrency,
                CreditInCurrency = l.CreditAmountInCurrency,
                ThirdPartyKind = l.ThirdPartyKind,
                ThirdPartyId = l.ThirdPartyId,
                Label = l.Label,
                PieceRef = l.JournalEntry.PieceRef,
                EntryLabel = l.JournalEntry.Label,
                JournalCode = l.JournalEntry.JournalCode,
                EntryNumber = l.JournalEntry.EntryNumber,
                EntryDate = l.JournalEntry.EntryDate,
                SourceEntityType = l.JournalEntry.SourceEntityType,
                SourceEntityId = l.JournalEntry.SourceEntityId,
                Status = l.JournalEntry.Status,
                PeriodIsClosed = l.JournalEntry.AccountingPeriod != null && l.JournalEntry.AccountingPeriod.IsClosed,
                FiscalYear = l.JournalEntry.AccountingPeriod != null
                    ? l.JournalEntry.AccountingPeriod.FiscalYear
                    : l.JournalEntry.EntryDate.Year
            })
            .ToListAsync(cancellationToken);

        // Calculé avant la revérification en mémoire : celle-ci ne retire une ligne que si SQL et
        // mémoire divergeaient (filet de sécurité). Dans ce cas rare, Truncated peut être vrai avec
        // moins de maxCandidateLines candidats ; c'est voulu (le plafond a bien été atteint en SQL).
        var truncated = rows.Count > maxCandidateLines;
        if (truncated)
            rows.RemoveRange(maxCandidateLines, rows.Count - maxCandidateLines);

        var candidates = new List<LetteringCandidate>(rows.Count);
        foreach (var row in rows)
        {
            // Revérification par le prédicat unique (D8) : une ligne verrouillée ne doit jamais
            // atteindre le moteur, même si le filtre SQL divergeait.
            if (LetteringPeriodLock.IsLocked(row.Status, row.PeriodIsClosed, row.FiscalYear, lockedYears))
                continue;

            var candidate = ToCandidate(row, candidates.Count);
            if (candidate.SignedForBalance == 0)
                continue;

            candidates.Add(candidate);
        }

        var links = await LoadLinksAsync(ctx, candidates, cancellationToken);
        return new LoadedCandidates(candidates, links, truncated);
    }

    private static LetteringCandidate ToCandidate(CandidateRow row, int orderRank)
    {
        var currency = string.IsNullOrEmpty(row.CurrencyCode) ? Money.DefaultCurrency : row.CurrencyCode;
        var signedLocal = ToMillimes(row.Debit) - ToMillimes(row.Credit);

        // Écriture en devise de tenue : les colonnes « en devise » restent à 0 par convention
        // (JournalEntryLine.DebitAmountInCurrency) et le montant TND fait foi.
        var signedOp = currency == Money.DefaultCurrency
            ? signedLocal
            : ToMillimes(row.DebitInCurrency) - ToMillimes(row.CreditInCurrency);

        return new LetteringCandidate(
            row.LineId,
            row.EntryId,
            row.LineNumber,
            row.AccountNumber,
            currency,
            signedOp,
            signedLocal,
            row.ThirdPartyKind,
            row.ThirdPartyId,
            row.Label,
            row.PieceRef,
            row.EntryLabel,
            row.JournalCode,
            row.EntryNumber,
            row.EntryDate,
            row.SourceEntityType,
            row.SourceEntityId,
            orderRank);
    }

    /// <summary>
    /// Montant décimal → millimes entiers. Les colonnes sont en <c>decimal(18,3)</c> : la conversion
    /// est exacte ; l'arrondi ne protège que des valeurs hors schéma (fournisseur en mémoire).
    /// </summary>
    internal static long ToMillimes(decimal amount) =>
        checked((long)decimal.Round(amount * 1000m, 0, MidpointRounding.AwayFromZero));

    private static async Task<DocumentLinks> LoadLinksAsync(
        TenantDbContext ctx,
        IReadOnlyList<LetteringCandidate> candidates,
        CancellationToken cancellationToken)
    {
        var paymentIds = SourceIds(candidates, AccountingService.SourcePayment);
        var supplierPaymentIds = SourceIds(candidates, AccountingService.SourceSupplierPayment);

        var paymentToInvoice = new Dictionary<Guid, Guid>();
        foreach (var chunk in paymentIds.Chunk(PaymentIdChunkSize))
        {
            var pairs = await ctx.Payments.AsNoTracking()
                .Where(p => chunk.Contains(p.Id))
                .Select(p => new { p.Id, p.InvoiceId })
                .ToListAsync(cancellationToken);
            foreach (var pair in pairs)
                paymentToInvoice[pair.Id] = pair.InvoiceId;
        }

        var supplierPaymentToInvoice = new Dictionary<Guid, Guid>();
        foreach (var chunk in supplierPaymentIds.Chunk(PaymentIdChunkSize))
        {
            var pairs = await ctx.SupplierPayments.AsNoTracking()
                .Where(p => chunk.Contains(p.Id))
                .Select(p => new { p.Id, p.SupplierInvoiceId })
                .ToListAsync(cancellationToken);
            foreach (var pair in pairs)
                supplierPaymentToInvoice[pair.Id] = pair.SupplierInvoiceId;
        }

        return paymentToInvoice.Count == 0 && supplierPaymentToInvoice.Count == 0
            ? DocumentLinks.Empty
            : new DocumentLinks(paymentToInvoice, supplierPaymentToInvoice);
    }

    private static List<Guid> SourceIds(IReadOnlyList<LetteringCandidate> candidates, string sourceType) =>
        candidates
            .Where(c => c.SourceEntityType == sourceType && c.SourceEntityId.HasValue)
            .Select(c => c.SourceEntityId!.Value)
            .Distinct()
            .OrderBy(id => id)
            .ToList();

    private sealed class CandidateRow
    {
        public Guid LineId { get; init; }
        public Guid EntryId { get; init; }
        public int LineNumber { get; init; }
        public string AccountNumber { get; init; } = string.Empty;
        public string CurrencyCode { get; init; } = string.Empty;
        public decimal Debit { get; init; }
        public decimal Credit { get; init; }
        public decimal DebitInCurrency { get; init; }
        public decimal CreditInCurrency { get; init; }
        public ThirdPartyKind ThirdPartyKind { get; init; }
        public Guid? ThirdPartyId { get; init; }
        public string Label { get; init; } = string.Empty;
        public string? PieceRef { get; init; }
        public string EntryLabel { get; init; } = string.Empty;
        public string JournalCode { get; init; } = string.Empty;
        public int EntryNumber { get; init; }
        public DateTime EntryDate { get; init; }
        public string? SourceEntityType { get; init; }
        public Guid? SourceEntityId { get; init; }
        public JournalEntryStatus Status { get; init; }
        public bool PeriodIsClosed { get; init; }
        public int FiscalYear { get; init; }
    }
}
