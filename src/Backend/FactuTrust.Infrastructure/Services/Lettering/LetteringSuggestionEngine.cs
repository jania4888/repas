using System.Globalization;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Moteur pur de propositions de lettrage (plan v2, annexe C §2.3 à §2.6). Aucun accès base, aucune
/// horloge, aucun aléa : même entrée, même sortie (seul le fusible de temps, via le jeton d'annulation,
/// peut rendre un résultat incomplet, et il est alors signalé par <c>TruncationReason = "TimeFuse"</c>).
/// </summary>
/// <remarks>
/// <para>
/// Partitions : <c>(compte, devise)</c>, parcourues dans l'ordre ordinal des clés. Une proposition a donc
/// toujours un seul compte et une seule devise, des lignes de sens opposés dont la somme signée est
/// exactement nulle (devise de l'opération si elle diffère de TND, sinon TND), et jamais deux tiers
/// contradictoires.
/// </para>
/// <para>
/// Étapes gloutonnes R1 → R5 : chaque étape ne voit que les lignes non consommées ; ses propositions sont
/// triées dans l'ordre final puis retenues si aucune de leurs lignes n'est déjà prise. Une ligne figure
/// donc dans au plus une proposition.
/// </para>
/// </remarks>
internal static class LetteringSuggestionEngine
{
    internal const int BaseScoreDocumentLink = 95;
    internal const int BaseScoreSameReference = 85;
    internal const int BaseScoreSameThirdPartyAmount = 70;
    internal const int BaseScoreSubsetSum = 60;
    internal const int BaseScoreAmountOnly = 30;

    private delegate IEnumerable<EngineSuggestion> Rule(Partition partition, EngineState state);

    // Ordre des règles = priorité.
    private static readonly Rule[] Rules =
    {
        R1DocumentLink,
        R2SameReference,
        R3SameThirdPartyAmount,
        R4SubsetSum,
        R5AmountOnly,
    };

    public static LetteringEngineOutput Run(
        IReadOnlyList<LetteringCandidate> candidates,
        DocumentLinks links,
        LetteringEngineOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(links);
        ArgumentNullException.ThrowIfNull(options);

        var partitions = BuildPartitions(candidates);
        var state = new EngineState(links, options, cancellationToken);

        foreach (var rule in Rules)
        {
            var proposals = new List<EngineSuggestion>();
            foreach (var partition in partitions)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    state.Truncate(LetteringEngineOutput.ReasonTimeFuse);
                    break;
                }
                proposals.AddRange(rule(partition, state));
            }

            proposals.Sort(CompareFinalOrder);
            foreach (var proposal in proposals)
                state.TryAccept(proposal);

            if (state.TruncationReason == LetteringEngineOutput.ReasonTimeFuse)
                break;
        }

        var accepted = state.Accepted;
        accepted.Sort(CompareFinalOrder);
        var returned = accepted.Count <= options.MaxSuggestions
            ? accepted
            : accepted.GetRange(0, options.MaxSuggestions);
        return new LetteringEngineOutput(returned, accepted.Count, state.TruncationReason is not null, state.TruncationReason);
    }

    /// <summary>
    /// Ordre final (annexe C §2.6) : score décroissant, rang de règle, nombre de lignes croissant, plus
    /// petit rang d'ordre, puis clé (ordre total, donc tri déterministe).
    /// </summary>
    internal static int CompareFinalOrder(EngineSuggestion a, EngineSuggestion b)
    {
        var c = b.Score.CompareTo(a.Score);
        if (c != 0) return c;
        c = a.RuleRank.CompareTo(b.RuleRank);
        if (c != 0) return c;
        c = a.Lines.Count.CompareTo(b.Lines.Count);
        if (c != 0) return c;
        c = a.MinOrderRank.CompareTo(b.MinOrderRank);
        return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key);
    }

    // ---------------------------------------------------------------- R1 : lien documentaire

    /// <summary>
    /// R1 : {lignes de la facture sur le compte} + {lignes de tous ses règlements liés}, si la somme est
    /// exactement nulle et qu'il y a au plus <c>MaxDocumentPayments</c> règlements. Pas de sous-ensemble :
    /// une facture encore partiellement réglée reste disponible pour les règles suivantes.
    /// </summary>
    private static IEnumerable<EngineSuggestion> R1DocumentLink(Partition partition, EngineState state)
    {
        var invoices = new SortedDictionary<DocumentKey, List<LetteringCandidate>>();
        var payments = new Dictionary<DocumentKey, List<LetteringCandidate>>(); // consulté, jamais énuméré

        foreach (var line in partition.Lines)
        {
            if (state.IsConsumed(line) || line.SourceEntityId is not { } sourceId)
                continue;

            switch (line.SourceEntityType)
            {
                case AccountingService.SourceInvoice:
                case AccountingService.SourceSupplierInvoice:
                    Add(invoices, new DocumentKey(line.SourceEntityType, sourceId), line);
                    break;
                case AccountingService.SourcePayment
                    when state.Links.PaymentToInvoice.TryGetValue(sourceId, out var invoiceId):
                    Add(payments, new DocumentKey(AccountingService.SourceInvoice, invoiceId), line);
                    break;
                case AccountingService.SourceSupplierPayment
                    when state.Links.SupplierPaymentToInvoice.TryGetValue(sourceId, out var supplierInvoiceId):
                    Add(payments, new DocumentKey(AccountingService.SourceSupplierInvoice, supplierInvoiceId), line);
                    break;
            }
        }

        foreach (var (document, invoiceLines) in invoices)
        {
            if (!payments.TryGetValue(document, out var paymentLines))
                continue;

            var paymentCount = paymentLines.Select(l => l.SourceEntityId).Distinct().Count();
            if (paymentCount > state.Options.MaxDocumentPayments)
                continue;

            var group = invoiceLines.Concat(paymentLines).ToList();
            if (!IsBalanced(group) || !TryCommonThirdParty(group, out _, out _))
                continue;

            var invoiceLine = invoiceLines[0];
            var invoiceNumber = string.IsNullOrWhiteSpace(invoiceLine.PieceRef)
                ? $"{invoiceLine.JournalCode}-{invoiceLine.EntryNumber.ToString(CultureInfo.InvariantCulture)}"
                : invoiceLine.PieceRef.Trim();

            yield return Build(
                state,
                SuggestionKind.DocumentLink,
                group.Count == 2 ? SuggestionCategory.Exact : SuggestionCategory.Multiple,
                ruleRank: 1,
                BaseScoreDocumentLink,
                partition,
                group,
                new List<EngineReason>
                {
                    EngineReason.Of(EngineReasonCodes.DocumentLink,
                        ("invoiceNumber", invoiceNumber),
                        ("paymentCount", paymentCount.ToString(CultureInfo.InvariantCulture))),
                });
        }
    }

    // ---------------------------------------------------------------- R2 : même référence

    /// <summary>
    /// R2 : lignes de sens opposés qui partagent un jeton de référence (<see cref="ReferenceExtractor"/>).
    /// Groupe entier si sa somme est nulle et ses tiers compatibles ; sinon paires 1-pour-1 de même
    /// montant. Jetons portés par plus de <c>MaxLinesPerReference</c> lignes de la partition : ignorés
    /// (trop génériques). Pas de sous-ensemble (rôle de R4).
    /// </summary>
    private static IEnumerable<EngineSuggestion> R2SameReference(Partition partition, EngineState state)
    {
        // Le seuil « jeton trop générique » se compte sur TOUTES les lignes de la partition, y compris
        // celles déjà prises par R1 : un jeton ne devient pas spécifique parce que R1 a consommé des lignes.
        var byToken = new SortedDictionary<string, List<LetteringCandidate>>(StringComparer.Ordinal);
        var tokenLineCount = new Dictionary<string, int>(StringComparer.Ordinal); // consulté, jamais énuméré
        foreach (var line in partition.Lines)
        {
            foreach (var token in state.TokensOf(line))
            {
                tokenLineCount[token] = tokenLineCount.GetValueOrDefault(token) + 1;
                if (!state.IsConsumed(line))
                    Add(byToken, token, line);
            }
        }

        // Deux lignes qui partagent plusieurs jetons donneraient plusieurs propositions de même clé :
        // seule la première est gardée (jetons parcourus en ordre ordinal, donc le plus petit jeton).
        var emittedKeys = new HashSet<string>(StringComparer.Ordinal); // appartenance seulement
        foreach (var (token, lines) in byToken)
        {
            if (lines.Count < 2 || tokenLineCount[token] > state.Options.MaxLinesPerReference)
                continue;

            var debits = lines.Where(l => l.SignedForBalance > 0).ToList();
            var credits = lines.Where(l => l.SignedForBalance < 0).ToList();
            if (debits.Count == 0 || credits.Count == 0)
                continue;

            if (IsBalanced(lines) && TryCommonThirdParty(lines, out _, out _))
            {
                if (!emittedKeys.Add(SuggestionKey.Compute(partition.AccountNumber, partition.CurrencyCode, lines.Select(l => l.LineId))))
                    continue;
                yield return Build(
                    state,
                    SuggestionKind.SameReference,
                    lines.Count == 2 ? SuggestionCategory.Exact : SuggestionCategory.Multiple,
                    ruleRank: 2,
                    BaseScoreSameReference,
                    partition,
                    new List<LetteringCandidate>(lines),
                    new List<EngineReason> { EngineReason.Of(EngineReasonCodes.SameReference, ("reference", token)) });
                continue;
            }

            foreach (var (debit, credit, _) in PairSameAmount(state, partition.AccountNumber, debits, credits, requireThirdParty: false))
            {
                if (!emittedKeys.Add(SuggestionKey.Compute(partition.AccountNumber, partition.CurrencyCode, new[] { debit.LineId, credit.LineId })))
                    continue;
                yield return Build(
                    state,
                    SuggestionKind.SameReference,
                    SuggestionCategory.Exact,
                    ruleRank: 2,
                    BaseScoreSameReference,
                    partition,
                    new List<LetteringCandidate> { debit, credit },
                    new List<EngineReason> { EngineReason.Of(EngineReasonCodes.SameReference, ("reference", token)) });
            }
        }
    }

    // ---------------------------------------------------------------- R3 : même tiers + même montant

    /// <summary>
    /// R3 : par tiers renseigné, chaque débit est apparié à un crédit de même montant. Doublons de
    /// montant départagés par <see cref="PairSameAmount"/> ; les autres lignes de même montant non
    /// choisies sont signalées par la raison <c>AmbiguousAmount</c>.
    /// </summary>
    private static IEnumerable<EngineSuggestion> R3SameThirdPartyAmount(Partition partition, EngineState state)
    {
        var byThirdParty = new SortedDictionary<(ThirdPartyKind Kind, Guid Id), List<LetteringCandidate>>();
        foreach (var line in partition.Lines)
        {
            if (!state.IsConsumed(line) && line.ThirdPartyId is { } id)
                Add(byThirdParty, (line.ThirdPartyKind, id), line);
        }

        foreach (var lines in byThirdParty.Values)
        {
            var debits = lines.Where(l => l.SignedForBalance > 0).ToList();
            var credits = lines.Where(l => l.SignedForBalance < 0).ToList();
            if (debits.Count == 0 || credits.Count == 0)
                continue;

            foreach (var (debit, credit, alternatives) in PairSameAmount(state, partition.AccountNumber, debits, credits, requireThirdParty: true))
            {
                var reasons = new List<EngineReason>
                {
                    EngineReason.Of(EngineReasonCodes.SameThirdParty),
                    EngineReason.Of(EngineReasonCodes.ExactAmount,
                        ("amount", FormatMillimes(debit.SignedMillimesOp)),
                        ("currency", partition.CurrencyCode)),
                };
                if (alternatives > 0)
                {
                    reasons.Add(EngineReason.Of(EngineReasonCodes.AmbiguousAmount,
                        ("alternatives", alternatives.ToString(CultureInfo.InvariantCulture))));
                }

                yield return Build(
                    state,
                    SuggestionKind.SameThirdPartyAmount,
                    SuggestionCategory.SameAmount,
                    ruleRank: 3,
                    BaseScoreSameThirdPartyAmount,
                    partition,
                    new List<LetteringCandidate> { debit, credit },
                    reasons);
            }
        }
    }

    /// <summary>Au-delà, un montant est apparié débit par débit (coût linéaire) au lieu de paire par paire.</summary>
    internal const int MaxPairsPerAmount = 4096;

    /// <summary>
    /// Paires 1-pour-1 débit/crédit de même montant d'équilibre, aux tiers compatibles. Pour chaque montant,
    /// les paires possibles sont retenues de la meilleure à la moins bonne : écart de dates le plus faible,
    /// puis règlement postérieur ou égal à la facture, puis rangs d'ordre. Le résultat ne dépend donc pas du
    /// sens (débit ou crédit) de la ligne la plus ancienne. Au-delà de <see cref="MaxPairsPerAmount"/> paires
    /// pour un montant, chaque débit (ordre stable) prend son meilleur crédit libre. <c>Alternatives</c> =
    /// autres lignes de même montant (des deux côtés) qui auraient pu être choisies à la place.
    /// </summary>
    private static List<(LetteringCandidate Debit, LetteringCandidate Credit, int Alternatives)> PairSameAmount(
        EngineState state,
        string accountNumber,
        List<LetteringCandidate> debits,
        List<LetteringCandidate> credits,
        bool requireThirdParty)
    {
        var debitsByAmount = new SortedDictionary<long, List<LetteringCandidate>>();
        foreach (var debit in debits)
            Add(debitsByAmount, debit.SignedForBalance, debit);
        var creditsByAmount = new Dictionary<long, List<LetteringCandidate>>(); // consulté, jamais énuméré
        foreach (var credit in credits)
            Add(creditsByAmount, -credit.SignedForBalance, credit);

        var invoiceIsDebit = InvoiceIsDebit(accountNumber);
        var result = new List<(LetteringCandidate, LetteringCandidate, int)>();
        var used = new HashSet<Guid>();
        foreach (var (amount, sameDebits) in debitsByAmount)
        {
            if (!creditsByAmount.TryGetValue(amount, out var sameCredits))
                continue;
            var alternatives = sameDebits.Count - 1 + sameCredits.Count - 1;

            if ((long)sameDebits.Count * sameCredits.Count <= MaxPairsPerAmount)
            {
                var pairs = new List<(LetteringCandidate Debit, LetteringCandidate Credit)>();
                foreach (var debit in sameDebits)
                {
                    foreach (var credit in sameCredits)
                    {
                        if (Compatible(debit, credit, requireThirdParty))
                            pairs.Add((debit, credit));
                    }
                }
                pairs.Sort((x, y) => ComparePair(x.Debit, x.Credit, y.Debit, y.Credit, invoiceIsDebit));
                foreach (var (debit, credit) in pairs)
                {
                    if (used.Contains(debit.LineId) || used.Contains(credit.LineId))
                        continue;
                    used.Add(debit.LineId);
                    used.Add(credit.LineId);
                    result.Add((debit, credit, alternatives));
                }
                continue;
            }

            // Repli glouton (quadratique) : le fusible est vérifié à chaque débit. Les paires déjà
            // formées restent valides ; la sortie est marquée tronquée.
            foreach (var debit in sameDebits)
            {
                if (state.CancellationToken.IsCancellationRequested)
                {
                    state.Truncate(LetteringEngineOutput.ReasonTimeFuse);
                    return result;
                }
                LetteringCandidate? best = null;
                foreach (var credit in sameCredits)
                {
                    if (used.Contains(credit.LineId) || !Compatible(debit, credit, requireThirdParty))
                        continue;
                    if (best is null || ComparePair(debit, credit, debit, best, invoiceIsDebit) < 0)
                        best = credit;
                }
                if (best is null)
                    continue;
                used.Add(best.LineId);
                result.Add((debit, best, alternatives));
            }
        }
        return result;
    }

    private static bool Compatible(LetteringCandidate debit, LetteringCandidate credit, bool requireThirdParty)
        => requireThirdParty
            ? debit.ThirdPartyId is not null && credit.ThirdPartyId == debit.ThirdPartyId && credit.ThirdPartyKind == debit.ThirdPartyKind
            : !debit.HasThirdParty || !credit.HasThirdParty
              || (credit.ThirdPartyId == debit.ThirdPartyId && credit.ThirdPartyKind == debit.ThirdPartyKind);

    /// <summary>Compare deux paires débit/crédit (négatif : la première est meilleure).</summary>
    private static int ComparePair(
        LetteringCandidate debitA, LetteringCandidate creditA,
        LetteringCandidate debitB, LetteringCandidate creditB,
        bool invoiceIsDebit)
    {
        var c = DaysBetween(debitA, creditA).CompareTo(DaysBetween(debitB, creditB));
        if (c != 0) return c;
        c = PaymentBeforeInvoice(debitA, creditA, invoiceIsDebit).CompareTo(PaymentBeforeInvoice(debitB, creditB, invoiceIsDebit));
        if (c != 0) return c;
        c = CompareOrder(debitA, debitB);
        return c != 0 ? c : CompareOrder(creditA, creditB);
    }

    /// <summary>
    /// Côté de la facture, déduit du compte : crédit sur les comptes fournisseurs (<c>40…</c>), débit
    /// partout ailleurs (clients <c>41…</c>, personnel, etc.).
    /// </summary>
    internal static bool InvoiceIsDebit(string accountNumber) => !accountNumber.StartsWith("40", StringComparison.Ordinal);

    /// <summary>Vrai si le règlement est antérieur à la facture (cas anormal, moins probable).</summary>
    internal static bool PaymentBeforeInvoice(LetteringCandidate debit, LetteringCandidate credit, bool invoiceIsDebit)
        => invoiceIsDebit ? credit.EntryDate.Date < debit.EntryDate.Date : debit.EntryDate.Date < credit.EntryDate.Date;

    internal static int DaysBetween(LetteringCandidate a, LetteringCandidate b)
        => Math.Abs((a.EntryDate.Date - b.EntryDate.Date).Days);

    // ---------------------------------------------------------------- R4 : somme de sous-ensemble

    /// <summary>
    /// R4 : N-pour-1 et 1-pour-N, même tiers obligatoire (jamais sans tiers). Cibles : chaque ligne
    /// restante, par montant absolu décroissant puis rang d'ordre. Candidats : lignes de sens opposé de
    /// montant ≤ cible, au plus <c>SubsetMaxCandidates</c>, les plus proches en date. Recherche
    /// <see cref="SubsetSumSearch"/> bornée par <c>SubsetNodeBudgetPerTarget</c> et par le budget global
    /// <c>SubsetGlobalNodeBudget</c> ; un budget épuisé marque la sortie <c>"SearchBudget"</c>. Les lignes
    /// d'une solution sont réservées : une cible suivante ne peut plus les reprendre.
    /// </summary>
    private static IEnumerable<EngineSuggestion> R4SubsetSum(Partition partition, EngineState state)
    {
        var byThirdParty = new SortedDictionary<(ThirdPartyKind Kind, Guid Id), List<LetteringCandidate>>();
        foreach (var line in partition.Lines)
        {
            if (!state.IsConsumed(line) && line.ThirdPartyId is { } id)
                Add(byThirdParty, (line.ThirdPartyKind, id), line);
        }

        var results = new List<EngineSuggestion>();
        foreach (var lines in byThirdParty.Values)
        {
            if (lines.Count < 3)
                continue; // R4 produit au moins 3 lignes (cible + 2) ; le 1-pour-1 relève de R3
            if (!SearchThirdParty(partition, lines, state, results))
                break;
        }
        return results;
    }

    /// <summary>Faux si la recherche doit s'arrêter (budget global épuisé ou fusible).</summary>
    private static bool SearchThirdParty(Partition partition, List<LetteringCandidate> lines, EngineState state, List<EngineSuggestion> results)
    {
        // Lignes de chaque sens triées par date puis rang : la proximité de date se lit par deux curseurs.
        // Chaque sens est vu dans deux ordres : date croissante (curseur droit) et date décroissante (curseur
        // gauche) ; dans les deux, à date égale, le plus petit rang d'ordre vient d'abord.
        var debits = ByDate.Create(lines.Where(l => l.SignedForBalance > 0));
        var credits = ByDate.Create(lines.Where(l => l.SignedForBalance < 0));
        if (debits.Ascending.Count == 0 || credits.Ascending.Count == 0)
            return true;

        var targets = lines
            .OrderByDescending(l => Math.Abs(l.SignedForBalance))
            .ThenBy(l => l.OrderRank)
            .ToList();
        var reserved = new HashSet<Guid>();
        var picked = new List<LetteringCandidate>(state.Options.SubsetMaxCandidates);
        var items = new List<SubsetItem>(state.Options.SubsetMaxCandidates);

        foreach (var target in targets)
        {
            if (state.CancellationToken.IsCancellationRequested)
            {
                state.Truncate(LetteringEngineOutput.ReasonTimeFuse);
                return false;
            }
            if (reserved.Contains(target.LineId))
                continue;

            var targetAmount = Math.Abs(target.SignedForBalance);
            PickNearest(target, target.SignedForBalance > 0 ? credits : debits, targetAmount, reserved, state.Options.SubsetMaxCandidates, picked);
            if (picked.Count < SubsetSumSearch.MinSize)
                continue;

            var remaining = state.Options.SubsetGlobalNodeBudget - state.NodesUsed;
            if (remaining <= 0)
            {
                state.Truncate(LetteringEngineOutput.ReasonSearchBudget);
                return false;
            }

            items.Clear();
            for (var i = 0; i < picked.Count; i++)
                items.Add(new SubsetItem(i, Math.Abs(picked[i].SignedForBalance), picked[i].EntryDate.Ticks, picked[i].OrderRank));

            var budget = (int)Math.Min(state.Options.SubsetNodeBudgetPerTarget, remaining);
            var found = SubsetSumSearch.Find(targetAmount, items, state.Options.SubsetMaxSize, budget, target.EntryDate.Ticks);
            state.NodesUsed += found.NodesVisited;
            if (found.BudgetExhausted)
                state.Truncate(LetteringEngineOutput.ReasonSearchBudget);
            if (!found.Found)
                continue;

            var group = new List<LetteringCandidate>(found.ItemIndexes.Count + 1) { target };
            foreach (var index in found.ItemIndexes)
                group.Add(picked[index]);
            foreach (var line in group)
                reserved.Add(line.LineId);

            var reasons = new List<EngineReason>
            {
                EngineReason.Of(EngineReasonCodes.SameThirdParty),
                EngineReason.Of(EngineReasonCodes.SubsetSum, ("count", group.Count.ToString(CultureInfo.InvariantCulture))),
            };
            // Ambiguïté : autres solutions de même taille (comptées par montants), plus chaque candidat non
            // retenu de même montant qu'une ligne retenue (il donnerait une autre solution par échange).
            var alternatives = found.AlternativeCount - 1 + CountSameAmountOutside(picked, found.ItemIndexes);
            if (alternatives > 0)
            {
                reasons.Add(EngineReason.Of(EngineReasonCodes.AmbiguousAmount,
                    ("alternatives", alternatives.ToString(CultureInfo.InvariantCulture))));
            }

            results.Add(Build(state, SuggestionKind.SubsetSum, SuggestionCategory.Multiple, ruleRank: 4, BaseScoreSubsetSum, partition, group, reasons));
        }
        return true;
    }

    /// <summary>
    /// Au plus <paramref name="max"/> lignes de <paramref name="opposite"/> de montant ≤ cible et non
    /// réservées, les plus proches en date de la cible (à écart égal, et à date égale, plus petit rang
    /// d'ordre d'abord), puis triées par montant décroissant. Deux curseurs partent de la date de la
    /// cible, l'un sur l'ordre croissant, l'autre sur l'ordre décroissant : coût linéaire, aucun tri global.
    /// </summary>
    private static void PickNearest(
        LetteringCandidate target,
        ByDate opposite,
        long targetAmount,
        HashSet<Guid> reserved,
        int max,
        List<LetteringCandidate> picked)
    {
        picked.Clear();
        var ticks = target.EntryDate.Ticks;
        var asc = opposite.Ascending;
        var desc = opposite.Descending;
        var right = LowerBound(asc, ticks);       // asc[right..] : date ≥ cible
        var left = asc.Count - right;             // desc[left..] : date < cible, de la plus proche à la plus lointaine

        while (picked.Count < max)
        {
            left = Skip(desc, left, targetAmount, reserved);
            right = Skip(asc, right, targetAmount, reserved);
            var hasLeft = left < desc.Count;
            var hasRight = right < asc.Count;
            if (!hasLeft && !hasRight)
                break;

            bool takeLeft;
            if (!hasLeft) takeLeft = false;
            else if (!hasRight) takeLeft = true;
            else
            {
                var gapLeft = ticks - desc[left].EntryDate.Ticks;
                var gapRight = asc[right].EntryDate.Ticks - ticks;
                takeLeft = gapLeft != gapRight ? gapLeft < gapRight : desc[left].OrderRank < asc[right].OrderRank;
            }

            if (takeLeft) picked.Add(desc[left++]);
            else picked.Add(asc[right++]);
        }

        picked.Sort((a, b) =>
        {
            var c = Math.Abs(b.SignedForBalance).CompareTo(Math.Abs(a.SignedForBalance));
            return c != 0 ? c : a.OrderRank.CompareTo(b.OrderRank);
        });
    }

    /// <summary>Candidats non retenus de même montant absolu qu'une ligne retenue.</summary>
    private static int CountSameAmountOutside(List<LetteringCandidate> picked, IReadOnlyList<int> chosen)
    {
        var count = 0;
        for (var i = 0; i < picked.Count; i++)
        {
            var isChosen = false;
            var sameAmount = false;
            var amount = Math.Abs(picked[i].SignedForBalance);
            foreach (var index in chosen)
            {
                if (index == i) { isChosen = true; break; }
                if (Math.Abs(picked[index].SignedForBalance) == amount) sameAmount = true;
            }
            if (!isChosen && sameAmount)
                count++;
        }
        return count;
    }

    /// <summary>Lignes d'un sens, triées par date croissante et décroissante (à date égale : rang d'ordre).</summary>
    private sealed record ByDate(List<LetteringCandidate> Ascending, List<LetteringCandidate> Descending)
    {
        internal static ByDate Create(IEnumerable<LetteringCandidate> lines)
        {
            var ascending = lines.OrderBy(l => l.EntryDate.Ticks).ThenBy(l => l.OrderRank).ToList();
            var descending = ascending.OrderByDescending(l => l.EntryDate.Ticks).ThenBy(l => l.OrderRank).ToList();
            return new ByDate(ascending, descending);
        }
    }

    private static int Skip(List<LetteringCandidate> lines, int index, long targetAmount, HashSet<Guid> reserved)
    {
        while (index < lines.Count
               && (Math.Abs(lines[index].SignedForBalance) > targetAmount || reserved.Contains(lines[index].LineId)))
        {
            index++;
        }
        return index;
    }

    private static int LowerBound(List<LetteringCandidate> lines, long ticks)
    {
        int lo = 0, hi = lines.Count;
        while (lo < hi)
        {
            var mid = (lo + hi) >>> 1;
            if (lines[mid].EntryDate.Ticks < ticks) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // ---------------------------------------------------------------- R5 : montant identique sans tiers

    /// <summary>
    /// R5 : paire 1-pour-1 de même montant dans <c>(compte, devise)</c>, au moins une ligne sans tiers
    /// (deux tiers différents : jamais), et seulement si l'appariement est unique (une seule ligne de chaque
    /// sens pour ce montant parmi les lignes restantes). Confiance toujours <c>Low</c>.
    /// </summary>
    private static IEnumerable<EngineSuggestion> R5AmountOnly(Partition partition, EngineState state)
    {
        var byAmount = new SortedDictionary<long, (List<LetteringCandidate> Debits, List<LetteringCandidate> Credits)>();
        foreach (var line in partition.Lines)
        {
            if (state.IsConsumed(line))
                continue;
            var amount = Math.Abs(line.SignedForBalance);
            if (!byAmount.TryGetValue(amount, out var sides))
            {
                sides = (new List<LetteringCandidate>(), new List<LetteringCandidate>());
                byAmount[amount] = sides;
            }
            (line.SignedForBalance > 0 ? sides.Debits : sides.Credits).Add(line);
        }

        foreach (var (amount, (debits, credits)) in byAmount)
        {
            if (debits.Count != 1 || credits.Count != 1)
                continue;
            var (debit, credit) = (debits[0], credits[0]);
            if (debit.HasThirdParty && credit.HasThirdParty)
                continue; // même tiers : rôle de R3 ; tiers différents : jamais

            yield return Build(
                state,
                SuggestionKind.AmountOnly,
                SuggestionCategory.SameAmount,
                ruleRank: 5,
                BaseScoreAmountOnly,
                partition,
                new List<LetteringCandidate> { debit, credit },
                new List<EngineReason>
                {
                    EngineReason.Of(EngineReasonCodes.AmountOnly),
                    EngineReason.Of(EngineReasonCodes.ExactAmount,
                        ("amount", FormatMillimes(amount)),
                        ("currency", partition.CurrencyCode)),
                },
                forceLowConfidence: true);
        }
    }

    // ---------------------------------------------------------------- outils communs

    private static List<Partition> BuildPartitions(IReadOnlyList<LetteringCandidate> candidates)
    {
        var byKey = new SortedDictionary<(string Account, string Currency), List<LetteringCandidate>>(PartitionKeyComparer.Instance);
        var seen = new HashSet<Guid>();
        foreach (var candidate in candidates)
        {
            // Défense : une ligne en double ou de montant nul ne peut jamais entrer dans un groupe.
            if (candidate.SignedForBalance == 0 || !seen.Add(candidate.LineId))
                continue;
            Add(byKey, (candidate.AccountNumber, candidate.CurrencyCode), candidate);
        }

        var partitions = new List<Partition>(byKey.Count);
        foreach (var ((account, currency), lines) in byKey)
        {
            lines.Sort(CompareOrder);
            partitions.Add(new Partition(account, currency, lines));
        }
        return partitions;
    }

    private static EngineSuggestion Build(
        EngineState state,
        SuggestionKind kind,
        SuggestionCategory category,
        int ruleRank,
        int baseScore,
        Partition partition,
        List<LetteringCandidate> lines,
        List<EngineReason> reasons,
        bool forceLowConfidence = false)
    {
        lines.Sort(CompareOrder);
        TryCommonThirdParty(lines, out var thirdPartyKind, out var thirdPartyId);

        long debitOp = 0, localGap = 0;
        DateTime minDate = DateTime.MaxValue, maxDate = DateTime.MinValue;
        bool debitHasThirdParty = false, creditHasThirdParty = false;
        foreach (var line in lines)
        {
            if (line.SignedForBalance > 0)
            {
                debitOp += line.SignedMillimesOp;
                debitHasThirdParty |= line.HasThirdParty;
            }
            else
            {
                creditHasThirdParty |= line.HasThirdParty;
            }
            localGap += line.SignedMillimesLocal;
            if (line.EntryDate.Date < minDate) minDate = line.EntryDate.Date;
            if (line.EntryDate.Date > maxDate) maxDate = line.EntryDate.Date;
        }

        var dateGapDays = (maxDate - minDate).Days;
        var sharedReference = kind == SuggestionKind.SameReference ? null : SharedReference(lines, state);
        if (sharedReference is not null)
            reasons.Add(EngineReason.Of(EngineReasonCodes.SameReference, ("reference", sharedReference)));
        if (dateGapDays > LetteringSuggestionScoring.CloseDatesMaxDays)
            reasons.Add(EngineReason.Of(EngineReasonCodes.DateGap, ("days", dateGapDays.ToString(CultureInfo.InvariantCulture))));
        if (localGap != 0)
            reasons.Add(EngineReason.Of(EngineReasonCodes.ExchangeDifference, ("localGap", FormatMillimes(localGap))));

        var facts = new ScoreFacts(
            SharedReference: sharedReference is not null,
            SameThirdPartyBothSides: thirdPartyId is not null && debitHasThirdParty && creditHasThirdParty,
            DateGapDays: dateGapDays,
            Ambiguous: reasons.Exists(r => r.Code == EngineReasonCodes.AmbiguousAmount),
            PaymentBeforeInvoice: GroupPaymentBeforeInvoice(lines, InvoiceIsDebit(partition.AccountNumber)));
        var score = LetteringSuggestionScoring.Score(baseScore, facts);
        var confidence = forceLowConfidence ? SuggestionConfidence.Low : LetteringSuggestionScoring.Confidence(score);

        return new EngineSuggestion(
            SuggestionKey.Compute(partition.AccountNumber, partition.CurrencyCode, lines.Select(l => l.LineId)),
            kind,
            category,
            ruleRank,
            score,
            confidence,
            partition.AccountNumber,
            partition.CurrencyCode,
            thirdPartyId,
            thirdPartyKind,
            lines,
            debitOp,
            localGap,
            reasons);
    }

    /// <summary>Plus petit jeton (ordinal) présent à la fois sur un débit et sur un crédit du groupe.</summary>
    private static string? SharedReference(List<LetteringCandidate> lines, EngineState state)
    {
        var debitTokens = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in lines)
        {
            if (line.SignedForBalance > 0)
                debitTokens.UnionWith(state.TokensOf(line));
        }
        if (debitTokens.Count == 0)
            return null;

        string? best = null;
        foreach (var line in lines)
        {
            if (line.SignedForBalance > 0)
                continue;
            foreach (var token in state.TokensOf(line))
            {
                if (debitTokens.Contains(token) && (best is null || string.CompareOrdinal(token, best) < 0))
                    best = token;
            }
        }
        return best;
    }

    /// <summary>Vrai si une ligne côté règlement est antérieure à la plus ancienne ligne côté facture.</summary>
    private static bool GroupPaymentBeforeInvoice(List<LetteringCandidate> lines, bool invoiceIsDebit)
    {
        var firstInvoice = DateTime.MaxValue;
        var firstPayment = DateTime.MaxValue;
        foreach (var line in lines)
        {
            var isInvoice = (line.SignedForBalance > 0) == invoiceIsDebit;
            var date = line.EntryDate.Date;
            if (isInvoice && date < firstInvoice) firstInvoice = date;
            if (!isInvoice && date < firstPayment) firstPayment = date;
        }
        return firstPayment < firstInvoice;
    }

    /// <summary>Somme signée exactement nulle, avec au moins une ligne de chaque sens.</summary>
    internal static bool IsBalanced(IReadOnlyCollection<LetteringCandidate> lines)
    {
        if (lines.Count < 2)
            return false;
        long sum = 0;
        foreach (var line in lines)
            sum += line.SignedForBalance;
        return sum == 0; // lignes non nulles (filtrées) : une somme nulle implique les deux sens
    }

    /// <summary>
    /// Vrai si les tiers renseignés sont tous identiques (même id, même nature). Rend ce tiers commun,
    /// ou <see cref="ThirdPartyKind.None"/> / <c>null</c> si aucune ligne n'a de tiers.
    /// </summary>
    internal static bool TryCommonThirdParty(IEnumerable<LetteringCandidate> lines, out ThirdPartyKind kind, out Guid? id)
    {
        kind = ThirdPartyKind.None;
        id = null;
        foreach (var line in lines)
        {
            if (!line.HasThirdParty)
                continue;
            if (id is null)
            {
                id = line.ThirdPartyId;
                kind = line.ThirdPartyKind;
            }
            else if (line.ThirdPartyId != id || line.ThirdPartyKind != kind)
            {
                kind = ThirdPartyKind.None;
                id = null;
                return false;
            }
        }
        return true;
    }

    internal static string FormatMillimes(long millimes)
        => (millimes / 1000m).ToString("0.000", CultureInfo.InvariantCulture);

    private static int CompareOrder(LetteringCandidate a, LetteringCandidate b)
    {
        var c = a.OrderRank.CompareTo(b.OrderRank);
        return c != 0 ? c : a.LineId.CompareTo(b.LineId);
    }

    private static void Add<TKey>(IDictionary<TKey, List<LetteringCandidate>> map, TKey key, LetteringCandidate line)
    {
        if (!map.TryGetValue(key, out var list))
        {
            list = new List<LetteringCandidate>();
            map[key] = list;
        }
        list.Add(line);
    }

    private sealed record Partition(string AccountNumber, string CurrencyCode, IReadOnlyList<LetteringCandidate> Lines);

    private readonly record struct DocumentKey(string SourceType, Guid Id) : IComparable<DocumentKey>
    {
        public int CompareTo(DocumentKey other)
        {
            var c = string.CompareOrdinal(SourceType, other.SourceType);
            return c != 0 ? c : Id.CompareTo(other.Id);
        }
    }

    private sealed class PartitionKeyComparer : IComparer<(string Account, string Currency)>
    {
        internal static readonly PartitionKeyComparer Instance = new();

        public int Compare((string Account, string Currency) x, (string Account, string Currency) y)
        {
            var c = string.CompareOrdinal(x.Account, y.Account);
            return c != 0 ? c : string.CompareOrdinal(x.Currency, y.Currency);
        }
    }

    private sealed class EngineState
    {
        private readonly HashSet<Guid> _consumed = new(); // test d'appartenance seulement, jamais énuméré
        private readonly Dictionary<Guid, IReadOnlyList<string>> _tokens = new(); // cache, jamais énuméré

        internal EngineState(DocumentLinks links, LetteringEngineOptions options, CancellationToken cancellationToken)
        {
            Links = links;
            Options = options;
            CancellationToken = cancellationToken;
        }

        internal CancellationToken CancellationToken { get; }

        /// <summary>Nœuds consommés par R4 dans toute la requête (budget <c>SubsetGlobalNodeBudget</c>).</summary>
        internal long NodesUsed { get; set; }

        internal DocumentLinks Links { get; }
        internal LetteringEngineOptions Options { get; }
        internal List<EngineSuggestion> Accepted { get; } = new();
        internal string? TruncationReason { get; private set; }

        internal bool IsConsumed(LetteringCandidate line) => _consumed.Contains(line.LineId);

        /// <summary>Jetons de référence de la ligne, calculés une seule fois par candidat.</summary>
        internal IReadOnlyList<string> TokensOf(LetteringCandidate line)
        {
            if (!_tokens.TryGetValue(line.LineId, out var tokens))
            {
                tokens = ReferenceExtractor.Extract(line.PieceRef, line.Label, line.EntryLabel);
                _tokens[line.LineId] = tokens;
            }
            return tokens;
        }

        internal void TryAccept(EngineSuggestion suggestion)
        {
            foreach (var line in suggestion.Lines)
            {
                if (_consumed.Contains(line.LineId))
                    return;
            }
            foreach (var line in suggestion.Lines)
                _consumed.Add(line.LineId);
            Accepted.Add(suggestion);
        }

        /// <summary>Le fusible de temps l'emporte sur le budget de recherche (cas le plus grave).</summary>
        internal void Truncate(string reason)
        {
            if (TruncationReason != LetteringEngineOutput.ReasonTimeFuse)
                TruncationReason = reason;
        }
    }
}
