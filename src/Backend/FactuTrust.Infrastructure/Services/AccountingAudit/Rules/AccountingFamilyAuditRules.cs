using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Audit;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.AccountingAudit.Rules;

/// <summary>
/// Famille « Comptable » du réviseur : cohérence interne des écritures et de leur rattachement aux
/// documents et aux tiers.
///
/// <para>Toutes ces règles sont <b>déterministes et reproductibles</b> : deux exécutions sur les
/// mêmes données donnent le même résultat, condition pour qu'une anomalie tienne devant un
/// auditeur. Aucune n'ouvre de contexte propre — elles lisent par <c>ctx.Db</c>, seul contexte
/// garanti pointer sur le dossier balayé.</para>
/// </summary>
internal static class AccountingFamilyRuleConstants
{
    /// <summary>
    /// Tolérance de comparaison des montants, en dinars. Un millime : c'est la précision du
    /// dinar tunisien, en deçà de laquelle un écart n'est qu'un arrondi de calcul et non une
    /// anomalie comptable.
    /// </summary>
    internal const decimal MillimeTolerance = 0.001m;

    /// <summary>Plafond de lignes détaillées par anomalie, pour qu'un dossier dégradé ne noie pas l'écran.</summary>
    internal const int MaxDetailLines = 200;
}

/// <summary>
/// TVA comptabilisée incohérente avec la TVA du document d'origine.
///
/// <para>Compare, pour chaque écriture issue d'une facture de vente ou d'achat, la somme des lignes
/// de TVA à la TVA portée par le document. Un écart signale soit une saisie manuelle divergente,
/// soit une facture modifiée après comptabilisation, soit une ventilation par taux erronée — trois
/// cas qui se soldent en contrôle fiscal.</para>
/// </summary>
public sealed class VatVersusDocumentAuditRule : AccountingAuditRuleBase
{
    /// <summary>Racines de TVA : collectée (4367x) et déductible (4366x).</summary>
    private const string VatCollectedRoot = "4367";
    private const string VatDeductibleRoot = "4366";

    public override string Code => "entry-vat-vs-document";
    public override string ModuleCode => "vat";
    public override int Category => (int)AnomalyCategory.Tva;
    public override int DefaultSeverity => (int)PreClosingSeverity.Warning;

    public override async Task<IReadOnlyList<AnomalyCandidate>> EvaluateAsync(
        IAuditEvaluationContext ctx, CancellationToken cancellationToken)
    {
        var c = ctx.Ctx();

        var entries = await c.Db.JournalEntries.AsNoTracking()
            .Include(e => e.Lines)
            .Where(e => e.EntryDate.Year == ctx.FiscalYear
                        && e.Status != JournalEntryStatus.Brouillon
                        && e.SourceEntityId != null
                        && (e.SourceEntityType == AccountingService.SourceInvoice
                            || e.SourceEntityType == AccountingService.SourceSupplierInvoice))
            .Select(e => new
            {
                e.Id,
                e.EntryDate,
                e.JournalCode,
                e.EntryNumber,
                e.Label,
                e.SourceEntityType,
                e.SourceEntityId,
                VatAmount = e.Lines
                    .Where(l => l.AccountNumber.StartsWith(VatCollectedRoot)
                                || l.AccountNumber.StartsWith(VatDeductibleRoot))
                    .Sum(l => l.DebitAmount.Amount + l.CreditAmount.Amount)
            })
            .ToListAsync(cancellationToken);

        if (entries.Count == 0) return Array.Empty<AnomalyCandidate>();

        var salesIds = entries
            .Where(e => e.SourceEntityType == AccountingService.SourceInvoice)
            .Select(e => e.SourceEntityId!.Value).Distinct().ToList();
        var purchaseIds = entries
            .Where(e => e.SourceEntityType == AccountingService.SourceSupplierInvoice)
            .Select(e => e.SourceEntityId!.Value).Distinct().ToList();

        var salesVat = await c.Db.Invoices.AsNoTracking()
            .Where(i => salesIds.Contains(i.Id))
            .Select(i => new { i.Id, Number = i.Number.Value, Vat = i.TotalVat.Amount })
            .ToDictionaryAsync(x => x.Id, x => (x.Number, x.Vat), cancellationToken);

        var purchaseVat = await c.Db.SupplierInvoices.AsNoTracking()
            .Where(i => purchaseIds.Contains(i.Id))
            .Select(i => new { i.Id, Number = i.InvoiceNumber, Vat = i.TotalVat.Amount })
            .ToDictionaryAsync(x => x.Id, x => (x.Number, x.Vat), cancellationToken);

        var results = new List<AnomalyCandidate>();
        foreach (var entry in entries)
        {
            var isSale = entry.SourceEntityType == AccountingService.SourceInvoice;
            var source = isSale ? salesVat : purchaseVat;

            // Document introuvable : c'est une anomalie d'intégrité référentielle, pas de TVA.
            // Une autre règle la couvre ; ici on s'abstient plutôt que de conclure à tort.
            if (!source.TryGetValue(entry.SourceEntityId!.Value, out var document))
                continue;

            var booked = MillimeRounding.Round(entry.VatAmount);
            var expected = MillimeRounding.Round(document.Vat);
            var gap = Math.Abs(booked - expected);
            if (gap <= AccountingFamilyRuleConstants.MillimeTolerance)
                continue;

            var pieceRef = $"{entry.JournalCode}-{entry.EntryNumber}";
            var documentLabel = isSale ? "Facture client" : "Facture fournisseur";

            results.Add(SingleGroup(
                Code, ModuleCode, Category, DefaultSeverity,
                "TVA comptabilisée incohérente avec la facture",
                $"{documentLabel} {document.Number} : TVA de {expected:N3} TND sur le document, " +
                $"{booked:N3} TND comptabilisés (écart {gap:N3} TND).",
                "La TVA déclarée ne pourra pas être justifiée à partir de la comptabilité.",
                accountRef: isSale ? VatCollectedRoot : VatDeductibleRoot,
                amount: gap,
                periodFrom: DateOnly.FromDateTime(entry.EntryDate),
                periodTo: DateOnly.FromDateTime(entry.EntryDate),
                lines:
                [
                    new AnomalyLineCandidate(
                        entry.Id, null, entry.EntryDate, isSale ? VatCollectedRoot : VatDeductibleRoot,
                        entry.Label, booked, expected, pieceRef, null)
                ],
                recommendations:
                [
                    "Comparer la ventilation par taux du document et celle de l'écriture.",
                    "Extourner puis recomptabiliser la facture si l'écart est confirmé."
                ],
                deepLinkRoute: "/accounting/entry-search",
                // Une anomalie par écriture : sans discriminant, toutes celles du même compte et de
                // la même journée partageraient une empreinte et s'écraseraient.
                discriminator: entry.Id.ToString("N")));
        }

        return results;
    }
}

/// <summary>
/// Tiers et compte collectif incohérents.
///
/// <para>Trois situations, toutes des ruptures du plan tiers : un client porté sur un compte qui
/// n'est pas un 411, un fournisseur sur un compte qui n'est pas un 401, et une ligne de compte
/// collectif sans tiers rattaché — cette dernière rendant la balance auxiliaire fausse en silence.
/// Complète <c>health-thirdparty-mislink</c>, qui ne détecte qu'un tiers posé hors des classes
/// 40/41 sans vérifier la concordance du sens.</para>
/// </summary>
public sealed class ThirdPartyAccountMismatchAuditRule : AccountingAuditRuleBase
{
    private const string ClientRoot = "411";
    private const string SupplierRoot = "401";

    /// <summary>Projection de lecture. Type nommé plutôt qu'anonyme pour rester passable en argument.</summary>
    private sealed record MismatchedLine(
        Guid Id,
        Guid JournalEntryId,
        DateTime EntryDate,
        string JournalCode,
        int EntryNumber,
        string AccountNumber,
        string? Label,
        ThirdPartyKind? ThirdPartyKind,
        Guid? ThirdPartyId,
        decimal Debit,
        decimal Credit);

    public override string Code => "thirdparty-account-mismatch";
    public override string ModuleCode => "integrity";
    public override int Category => (int)AnomalyCategory.Comptes;
    public override int DefaultSeverity => (int)PreClosingSeverity.Warning;

    public override async Task<IReadOnlyList<AnomalyCandidate>> EvaluateAsync(
        IAuditEvaluationContext ctx, CancellationToken cancellationToken)
    {
        var c = ctx.Ctx();

        var lines = await c.Db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry.EntryDate.Year == ctx.FiscalYear
                        && l.JournalEntry.Status != JournalEntryStatus.Brouillon)
            .Where(l =>
                // Client posé ailleurs que sur un 411.
                (l.ThirdPartyKind == ThirdPartyKind.Client && !l.AccountNumber.StartsWith(ClientRoot))
                // Fournisseur posé ailleurs que sur un 401.
                || (l.ThirdPartyKind == ThirdPartyKind.Supplier && !l.AccountNumber.StartsWith(SupplierRoot))
                // Compte collectif sans tiers : la balance auxiliaire ne bouclera pas. Un compte
                // auxiliaire (40x.../41x...) individualise déjà le tiers par lui-même : une ligne
                // posée sans fiche dessus n'est pas une rupture (D-matricule fiscal, plan §5.8).
                || ((l.AccountNumber.StartsWith(ClientRoot) || l.AccountNumber.StartsWith(SupplierRoot))
                    && l.ThirdPartyId == null
                    && !c.Db.ChartOfAccounts.Any(a => a.AccountNumber == l.AccountNumber && a.IsAuxiliary
                        && (a.AccountType == AccountType.Client || a.AccountType == AccountType.Supplier))))
            .Select(l => new MismatchedLine(
                l.Id,
                l.JournalEntryId,
                l.JournalEntry.EntryDate,
                l.JournalEntry.JournalCode,
                l.JournalEntry.EntryNumber,
                l.AccountNumber,
                l.Label,
                l.ThirdPartyKind,
                l.ThirdPartyId,
                l.DebitAmount.Amount,
                l.CreditAmount.Amount))
            .Take(AccountingFamilyRuleConstants.MaxDetailLines)
            .ToListAsync(cancellationToken);

        if (lines.Count == 0) return Array.Empty<AnomalyCandidate>();

        // Une anomalie par nature de rupture : le comptable traite trois lots homogènes plutôt
        // qu'une liste mélangée, et chaque lot a sa propre action corrective.
        var results = new List<AnomalyCandidate>();

        void Emit(string kind, string title, string description, IEnumerable<MismatchedLine> group)
        {
            var items = group.ToList();
            if (items.Count == 0) return;

            results.Add(SingleGroup(
                Code, ModuleCode, Category, DefaultSeverity,
                title,
                $"{items.Count} ligne(s) — {description}",
                "Balance auxiliaire et grand livre des tiers incohérents.",
                accountRef: null,
                amount: items.Sum(i => i.Debit + i.Credit),
                periodFrom: null,
                periodTo: null,
                lines: items.Select(i => new AnomalyLineCandidate(
                    i.JournalEntryId, i.Id, i.EntryDate, i.AccountNumber,
                    i.Label, i.Debit, i.Credit,
                    $"{i.JournalCode}-{i.EntryNumber}", null)).ToList(),
                recommendations:
                [
                    "Corriger le compte d'imputation ou le tiers rattaché.",
                    "Vérifier le compte collectif du tiers dans le plan tiers."
                ],
                deepLinkRoute: "/accounting/entry-search",
                discriminator: kind));
        }

        Emit("client-off-411",
            "Client imputé hors compte 411",
            "un client est rattaché à un compte qui n'est pas un compte client.",
            lines.Where(l => l.ThirdPartyKind == ThirdPartyKind.Client
                             && !l.AccountNumber.StartsWith(ClientRoot, StringComparison.Ordinal)));

        Emit("supplier-off-401",
            "Fournisseur imputé hors compte 401",
            "un fournisseur est rattaché à un compte qui n'est pas un compte fournisseur.",
            lines.Where(l => l.ThirdPartyKind == ThirdPartyKind.Supplier
                             && !l.AccountNumber.StartsWith(SupplierRoot, StringComparison.Ordinal)));

        Emit("collective-without-thirdparty",
            "Compte de tiers sans tiers rattaché",
            "un compte collectif 401/411 est mouvementé sans tiers, la balance auxiliaire est incomplète.",
            lines.Where(l => l.ThirdPartyId is null
                             && (l.AccountNumber.StartsWith(ClientRoot, StringComparison.Ordinal)
                                 || l.AccountNumber.StartsWith(SupplierRoot, StringComparison.Ordinal))));

        return results;
    }
}

/// <summary>
/// Lettrages orphelins ou incohérents.
///
/// <para>Un groupe de lettrage est censé rapprocher des lignes d'un <b>même compte</b> dont les
/// débits égalent les crédits — sauf lettrage explicitement partiel. Trois dérives possibles :
/// un membre qui pointe une ligne disparue, un groupe étalé sur plusieurs comptes (l'invariant
/// mono-compte est rompu), et un groupe non partiel déséquilibré. Chacune fausse silencieusement
/// le solde du tiers.</para>
/// </summary>
public sealed class LetteringOrphanAuditRule : AccountingAuditRuleBase
{
    public override string Code => "lettering-orphan";
    public override string ModuleCode => "lettering";
    public override int Category => (int)AnomalyCategory.Lettrage;
    public override int DefaultSeverity => (int)PreClosingSeverity.Warning;

    public override async Task<IReadOnlyList<AnomalyCandidate>> EvaluateAsync(
        IAuditEvaluationContext ctx, CancellationToken cancellationToken)
    {
        var c = ctx.Ctx();

        var groups = await c.Db.LetteringGroups.AsNoTracking()
            .Include(g => g.Members)
            .Where(g => g.LetteredAt.Year <= ctx.FiscalYear)
            .ToListAsync(cancellationToken);

        if (groups.Count == 0) return Array.Empty<AnomalyCandidate>();

        var memberLineIds = groups.SelectMany(g => g.Members.Select(m => m.JournalEntryLineId))
            .Distinct().ToList();

        var lineFacts = await c.Db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => memberLineIds.Contains(l.Id))
            .Select(l => new
            {
                l.Id,
                l.JournalEntryId,
                l.JournalEntry.EntryDate,
                l.AccountNumber,
                l.Label,
                Debit = l.DebitAmount.Amount,
                Credit = l.CreditAmount.Amount
            })
            .ToListAsync(cancellationToken);

        var byLineId = lineFacts.ToDictionary(l => l.Id);
        var results = new List<AnomalyCandidate>();

        foreach (var group in groups)
        {
            var present = group.Members
                .Select(m => byLineId.TryGetValue(m.JournalEntryLineId, out var l) ? l : null)
                .Where(l => l is not null)
                .ToList();

            var missingCount = group.Members.Count - present.Count;
            var accounts = present.Select(l => l!.AccountNumber).Distinct(StringComparer.Ordinal).ToList();
            var debit = MillimeRounding.Round(present.Sum(l => l!.Debit));
            var credit = MillimeRounding.Round(present.Sum(l => l!.Credit));
            var unbalanced = !group.IsPartial && Math.Abs(debit - credit) > AccountingFamilyRuleConstants.MillimeTolerance;

            if (missingCount == 0 && accounts.Count <= 1 && !unbalanced)
                continue;

            var reasons = new List<string>();
            if (missingCount > 0)
                reasons.Add($"{missingCount} ligne(s) référencée(s) mais introuvable(s)");
            if (accounts.Count > 1)
                reasons.Add($"lignes réparties sur {accounts.Count} comptes ({string.Join(", ", accounts)})");
            if (unbalanced)
                reasons.Add($"groupe non partiel déséquilibré (débit {debit:N3} / crédit {credit:N3})");

            results.Add(SingleGroup(
                Code, ModuleCode, Category, DefaultSeverity,
                "Lettrage incohérent",
                $"Lettrage {group.Code} sur le compte {group.AccountNumber} : {string.Join(" ; ", reasons)}.",
                "Le solde du tiers est faux tant que le lettrage n'est pas repris.",
                accountRef: group.AccountNumber,
                amount: Math.Abs(debit - credit),
                periodFrom: DateOnly.FromDateTime(group.LetteredAt),
                periodTo: DateOnly.FromDateTime(group.LetteredAt),
                lines: present.Select(l => new AnomalyLineCandidate(
                    l!.JournalEntryId, l.Id, l.EntryDate, l.AccountNumber, l.Label,
                    l.Debit, l.Credit, group.Code, null)).ToList(),
                recommendations:
                [
                    "Délettrer le groupe puis relettrer sur un seul compte.",
                    "Vérifier les écritures supprimées ou extournées depuis le lettrage."
                ],
                deepLinkRoute: "/accounting/lettering",
                discriminator: group.Code));
        }

        return results;
    }
}

/// <summary>
/// Extourne attendue mais absente.
///
/// <para>Deux cas. Une écriture marquée extournée dont l'écriture de contre-passation est
/// introuvable : la marque ment, le montant est toujours dans les comptes. Et une facture annulée
/// dont l'écriture d'origine n'a jamais été contre-passée : le chiffre d'affaires reste gonflé
/// d'une facture qui n'existe plus.</para>
///
/// <para>Sévérité bloquante : dans les deux cas les états financiers sont faux, et la correction
/// passe nécessairement par une écriture — jamais par une modification du validé.</para>
/// </summary>
public sealed class ReversalMissingAuditRule : AccountingAuditRuleBase
{
    public override string Code => "reversal-missing";
    public override string ModuleCode => "integrity";
    public override int Category => (int)AnomalyCategory.Ecritures;
    public override int DefaultSeverity => (int)PreClosingSeverity.Blocking;

    public override async Task<IReadOnlyList<AnomalyCandidate>> EvaluateAsync(
        IAuditEvaluationContext ctx, CancellationToken cancellationToken)
    {
        var c = ctx.Ctx();
        var results = new List<AnomalyCandidate>();

        // ── Cas 1 : marquée extournée, contre-passation introuvable ─────────────────────────
        var flagged = await c.Db.JournalEntries.AsNoTracking()
            .Where(e => e.EntryDate.Year == ctx.FiscalYear && e.IsReversed)
            .Select(e => new { e.Id, e.EntryDate, e.JournalCode, e.EntryNumber, e.Label, e.ReversedByEntryId })
            .ToListAsync(cancellationToken);

        if (flagged.Count > 0)
        {
            var referenced = flagged.Where(e => e.ReversedByEntryId != null)
                .Select(e => e.ReversedByEntryId!.Value).Distinct().ToList();

            var existing = await c.Db.JournalEntries.AsNoTracking()
                .Where(e => referenced.Contains(e.Id))
                .Select(e => e.Id)
                .ToListAsync(cancellationToken);
            var existingSet = existing.ToHashSet();

            var broken = flagged
                .Where(e => e.ReversedByEntryId is null || !existingSet.Contains(e.ReversedByEntryId.Value))
                .Take(AccountingFamilyRuleConstants.MaxDetailLines)
                .ToList();

            if (broken.Count > 0)
            {
                results.Add(SingleGroup(
                    Code, ModuleCode, Category, DefaultSeverity,
                    "Écriture marquée extournée sans contre-passation",
                    $"{broken.Count} écriture(s) portent la marque d'extourne sans écriture de contre-passation retrouvée.",
                    "Le montant est toujours dans les comptes alors qu'il est présenté comme annulé.",
                    accountRef: null,
                    amount: 0m,
                    periodFrom: null,
                    periodTo: null,
                    lines: broken.Select(e => new AnomalyLineCandidate(
                        e.Id, null, e.EntryDate, null, e.Label, 0, 0,
                        $"{e.JournalCode}-{e.EntryNumber}", null)).ToList(),
                    recommendations:
                    [
                        "Passer l'écriture de contre-passation manquante.",
                        "Ou retirer la marque d'extourne si l'écriture est en réalité valide."
                    ],
                    deepLinkRoute: "/accounting/entry-search",
                    discriminator: "flagged-without-counterpart"));
            }
        }

        // ── Cas 2 : facture annulée, écriture d'origine jamais contre-passée ────────────────
        var cancelledInvoices = await c.Db.Invoices.AsNoTracking()
            .Where(i => i.CancelledAt != null && i.IssueDate.Year == ctx.FiscalYear)
            .Select(i => new { i.Id, Number = i.Number.Value, i.IssueDate, Total = i.TotalAmount.Amount })
            .ToListAsync(cancellationToken);

        if (cancelledInvoices.Count > 0)
        {
            var invoiceIds = cancelledInvoices.Select(i => i.Id).ToList();

            var sourceEntries = await c.Db.JournalEntries.AsNoTracking()
                .Where(e => e.SourceEntityType == AccountingService.SourceInvoice
                            && e.SourceEntityId != null
                            && invoiceIds.Contains(e.SourceEntityId.Value))
                .Select(e => new { e.Id, InvoiceId = e.SourceEntityId!.Value, e.EntryDate, e.JournalCode, e.EntryNumber, e.Label })
                .ToListAsync(cancellationToken);

            if (sourceEntries.Count > 0)
            {
                var sourceEntryIds = sourceEntries.Select(e => e.Id).ToList();

                // Une contre-passation référence l'écriture d'origine par ReversesEntryId.
                var reversedIds = await c.Db.JournalEntries.AsNoTracking()
                    .Where(e => e.ReversesEntryId != null && sourceEntryIds.Contains(e.ReversesEntryId.Value))
                    .Select(e => e.ReversesEntryId!.Value)
                    .ToListAsync(cancellationToken);
                var reversedSet = reversedIds.ToHashSet();

                var byInvoice = cancelledInvoices.ToDictionary(i => i.Id);
                var orphans = sourceEntries
                    .Where(e => !reversedSet.Contains(e.Id))
                    .Take(AccountingFamilyRuleConstants.MaxDetailLines)
                    .ToList();

                if (orphans.Count > 0)
                {
                    var amount = MillimeRounding.Round(
                        orphans.Sum(e => byInvoice.TryGetValue(e.InvoiceId, out var inv) ? inv.Total : 0m));

                    results.Add(SingleGroup(
                        Code, ModuleCode, Category, DefaultSeverity,
                        "Facture annulée sans écriture d'extourne",
                        $"{orphans.Count} facture(s) annulée(s) dont l'écriture comptable n'a jamais été contre-passée.",
                        "Chiffre d'affaires et TVA collectée surévalués du montant de ces factures.",
                        accountRef: null,
                        amount: amount,
                        periodFrom: null,
                        periodTo: null,
                        lines: orphans.Select(e => new AnomalyLineCandidate(
                            e.Id, null, e.EntryDate, null,
                            byInvoice.TryGetValue(e.InvoiceId, out var inv) ? $"Facture {inv.Number}" : e.Label,
                            0, 0, $"{e.JournalCode}-{e.EntryNumber}", null)).ToList(),
                        recommendations:
                        [
                            "Extourner l'écriture de la facture annulée.",
                            "Vérifier qu'aucun avoir n'a déjà été émis pour la même facture."
                        ],
                        deepLinkRoute: "/accounting/mass-reversal",
                        discriminator: "cancelled-invoice-not-reversed"));
                }
            }
        }

        return results;
    }
}
