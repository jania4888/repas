using FactuTrust.Domain.Banking;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Fusion « 100 % IA » (décision D1) : les lignes du relevé viennent UNIQUEMENT des pages lues par
/// l'IA ; la mise en page (couche texte) ne fournit que les métadonnées (profil, devise, période,
/// totaux imprimés, RIB en dernier recours). Fonctions pures. Rien n'est inventé : un solde absent
/// reste absent, une ligne douteuse est signalée — jamais corrigée en silence.
/// </summary>
public static class BankStatementAiOnlyMerge
{
    /// <summary>Codes de la mise en page retirés : ils décrivent une lecture qui n'est plus la source des lignes.</summary>
    private static readonly HashSet<string> DroppedLayoutCodes = new(StringComparer.Ordinal)
    {
        StatementIssueCodes.NoTransactions,
        StatementIssueCodes.LineAmbiguousSide,
        StatementIssueCodes.LineNoAmount,
        StatementIssueCodes.LineSeveralAmounts,
        StatementIssueCodes.LineInvalidDate,
        StatementIssueCodes.OrphanAmount,
        StatementIssueCodes.RibMismatch,
        StatementIssueCodes.AiNotStarted
    };

    private static readonly string[] SummaryLabelPrefixes =
    {
        "SOLDE", "REPORT", "TOTAL", "TOTAUX", "A NOUVEAU", "ANCIEN SOLDE", "NOUVEAU SOLDE", "SOLDE PRECEDENT", "A REPORTER"
    };

    /// <param name="layout">Relevé issu de la mise en page (métadonnées, plan IA).</param>
    /// <param name="plannedPages">Pages que l'IA devait lire (ordre d'impression).</param>
    /// <param name="readings">Pages effectivement lues (clé = numéro de page), échouées comprises (lecture vide + signalement).</param>
    /// <param name="pageReadings">Traçabilité par page (moteur, modèle, durée, échec).</param>
    public static ExtractedBankStatement Merge(
        ExtractedBankStatement layout,
        IReadOnlyCollection<int> plannedPages,
        IReadOnlyDictionary<int, BankStatementAiPageReader.PageReading> readings,
        IReadOnlyList<BankStatementPageReading> pageReadings)
    {
        var orderedPages = plannedPages.Distinct().OrderBy(p => p).ToList();
        var readPages = orderedPages.Where(readings.ContainsKey).ToList();
        var unresolved = orderedPages.Where(p => !readings.ContainsKey(p)).ToList();
        var readingByPage = pageReadings
            .GroupBy(r => r.Page)
            .ToDictionary(g => g.Key, g => g.Last());

        var issues = new List<StatementExtractionIssue>();
        var lines = new List<ExtractedStatementLine>();

        // ---- RIB : première lecture vision valide (ordre des pages) ; la couche texte l'emporte en cas de conflit.
        var visionRib = readPages
            .Select(p => readings[p].Rib)
            .FirstOrDefault(r => r is not null && TunisianIban.HasValidRibKey(r));
        var layoutRib = TunisianIban.HasValidRibKey(layout.Header.Rib) ? TunisianIban.NormalizeRibDigits(layout.Header.Rib) : null;
        var rib = layoutRib ?? visionRib;
        if (layoutRib is not null && visionRib is not null && !string.Equals(layoutRib, visionRib, StringComparison.Ordinal))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiRibMismatch, StatementIssueSeverity.Warning,
                $"RIB lu par l'IA (…{MaskRibTail(visionRib)}) différent du RIB de la couche texte (…{MaskRibTail(layoutRib)}) : le RIB imprimé est retenu."));
        }

        // ---- Lignes : ordre des pages puis ordre du modèle ; index séquentiel ; LineIndex des signalements remappé.
        var pageBalances = new Dictionary<int, (decimal? Opening, decimal? Closing)>();
        var pageSums = new Dictionary<int, (decimal Debit, decimal Credit)>();
        foreach (var page in readPages)
        {
            var reading = readings[page];
            pageBalances[page] = (reading.OpeningBalance, reading.ClosingBalance);
            pageSums[page] = (
                reading.Lines.Where(l => l.IsDebit).Sum(l => l.Amount),
                reading.Lines.Where(l => !l.IsDebit).Sum(l => l.Amount));
        }

        foreach (var page in readPages)
        {
            var reading = readings[page];
            var pageIssues = reading.Issues;
            var indexMap = new Dictionary<int, int>(); // index 1-based dans la page → Index 0-based global
            var droppedPageIndexes = new HashSet<int>();
            var previousPage = readPages.TakeWhile(p => p < page).LastOrDefault(-1);
            var nextPage = readPages.FirstOrDefault(p => p > page, -1);

            for (var i = 0; i < reading.Lines.Count; i++)
            {
                var line = reading.Lines[i];
                var pageIndex = i + 1;

                if (IsSummaryLine(line, page, previousPage, nextPage, pageBalances, pageSums))
                {
                    droppedPageIndexes.Add(pageIndex);
                    issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiSummaryLineDropped, StatementIssueSeverity.Info,
                        $"Page {page} : ligne « {Truncate(line.Label, 40)} » reconnue comme solde/total, non importée.", page));
                    continue;
                }

                var globalIndex = lines.Count;
                indexMap[pageIndex] = globalIndex;

                if (i == 0 && lines.Count > 0 && previousPage > 0)
                {
                    var last = lines[^1];
                    if (last.PageNumber == previousPage && IsSameOperation(last, line))
                    {
                        issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiPossibleDuplicate, StatementIssueSeverity.Warning,
                            $"Ligne {globalIndex + 1} : identique à la dernière ligne de la page précédente (report possible).", page, globalIndex));
                    }
                }

                lines.Add(line with { Index = globalIndex, PageNumber = page, Source = StatementLineSource.Ai });
            }

            foreach (var issue in pageIssues)
            {
                if (issue.LineIndex is { } li)
                {
                    if (droppedPageIndexes.Contains(li))
                        continue;
                    if (indexMap.TryGetValue(li, out var mapped))
                    {
                        var text = issue.Message.StartsWith($"Ligne {li} :", StringComparison.Ordinal)
                            ? $"Ligne {mapped + 1} :" + issue.Message[$"Ligne {li} :".Length..]
                            : issue.Message;
                        issues.Add(issue with { LineIndex = mapped, Message = text, PageNumber = page });
                        continue;
                    }
                }
                issues.Add(issue.PageNumber is null ? issue with { PageNumber = page } : issue);
            }

            if (readingByPage.TryGetValue(page, out var trace))
                AppendPageTraceIssues(issues, page, trace, reading);
        }

        foreach (var page in unresolved)
        {
            var reason = readingByPage.TryGetValue(page, out var trace) ? trace.FailureReason : null;
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiPageFailed, StatementIssueSeverity.Blocking,
                $"Page {page} non lue par l'IA{(string.IsNullOrWhiteSpace(reason) ? string.Empty : " : " + reason)}.", page));
        }

        // ---- Soldes : première/dernière page lue, sinon ceux de la couche texte.
        var firstPage = readPages.Count > 0 ? readPages[0] : (int?)null;
        var lastPage = readPages.Count > 0 ? readPages[^1] : (int?)null;
        var printedDecimals = ModalPrintedDecimals(readPages.Select(p => readings[p].PrintedDecimals));

        var opening = firstPage is { } fp && readings[fp].OpeningBalance is { } ob
            ? new StatementAmount(ob, printedDecimals, readings[fp].OpeningBalanceSigned ? StatementSignSource.Keyword : StatementSignSource.Assumed)
            : layout.Header.OpeningBalance;
        var closing = lastPage is { } lp && readings[lp].ClosingBalance is { } cb
            ? new StatementAmount(cb, printedDecimals, readings[lp].ClosingBalanceSigned ? StatementSignSource.Keyword : StatementSignSource.Assumed)
            : layout.Header.ClosingBalance;

        // ---- Période : imprimée sinon bornes des opérations lues.
        DateOnly? periodStart = layout.Header.PeriodPrinted ? layout.Header.PeriodStart : null;
        DateOnly? periodEnd = layout.Header.PeriodPrinted ? layout.Header.PeriodEnd : null;
        if (lines.Count > 0)
        {
            periodStart ??= lines.Min(l => l.TransactionDate);
            periodEnd ??= lines.Max(l => l.TransactionDate);
        }
        periodStart ??= layout.Header.PeriodStart;
        periodEnd ??= layout.Header.PeriodEnd;

        // ---- Signalements de la mise en page conservés (hors ceux décrivant la lecture texte).
        var readSet = readPages.ToHashSet();
        foreach (var issue in layout.Issues)
        {
            if (DroppedLayoutCodes.Contains(issue.Code) || StatementIssueCodes.BalanceCodes.Contains(issue.Code))
                continue;
            if (issue.Code == StatementIssueCodes.NoTextLayer && issue.PageNumber is { } p && readSet.Contains(p))
                continue;
            if (issue.Code == StatementIssueCodes.NoTextLayer && issue.PageNumber is null && unresolved.Count == 0)
                continue;
            if (issue.Code == StatementIssueCodes.RibNotFound && rib is not null)
                continue;
            if (issue.Code == StatementIssueCodes.RibInvalidKey && rib is not null && visionRib is not null && layoutRib is null)
                continue;
            if (issues.Any(existing => existing.Code == issue.Code && existing.PageNumber == issue.PageNumber && existing.Message == issue.Message))
                continue;
            issues.Add(issue);
        }

        if (rib is null && !issues.Any(i => i.Code == StatementIssueCodes.RibNotFound))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.RibNotFound, StatementIssueSeverity.Warning,
                "RIB non lu sur le relevé : vérifiez le compte sélectionné."));
        }

        if (lines.Count == 0 && unresolved.Count == 0 && !issues.Any(i => i.Code == StatementIssueCodes.NoTransactions))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.NoTransactions, StatementIssueSeverity.Blocking,
                "Aucune opération lue sur le relevé."));
        }

        var header = layout.Header with
        {
            Rib = rib,
            BankCode = rib is not null ? TunisianIban.BankCodeOf(rib) : layout.Header.BankCode,
            OpeningBalance = opening,
            ClosingBalance = closing,
            PeriodStart = periodStart,
            PeriodEnd = periodEnd
        };

        var plan = layout.AiPlan is { } aiPlan
            ? aiPlan with
            {
                PageReadings = pageReadings,
                FallbackPages = BankStatementAiReadingPlanner.FallbackPagesOf(pageReadings)
            }
            : null;

        return layout with
        {
            Header = header,
            Lines = lines,
            Issues = OrderIssues(issues),
            UnresolvedPages = unresolved,
            AiPlan = plan
        };
    }

    private static void AppendPageTraceIssues(
        List<StatementExtractionIssue> issues,
        int page,
        BankStatementPageReading trace,
        BankStatementAiPageReader.PageReading reading)
    {
        if (trace.IsFailed)
        {
            if (!issues.Any(i => i.Code == StatementIssueCodes.AiPageFailed && i.PageNumber == page))
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiPageFailed, StatementIssueSeverity.Blocking,
                    $"Page {page} non lue par l'IA{(string.IsNullOrWhiteSpace(trace.FailureReason) ? string.Empty : " : " + trace.FailureReason)}.", page));
            }
            return;
        }

        if (trace.IsTextFallback && !issues.Any(i => i.Code == StatementIssueCodes.AiTextFallback && i.PageNumber == page))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiTextFallback, StatementIssueSeverity.Warning,
                $"Page {page} relue par le modèle texte{(string.IsNullOrWhiteSpace(trace.FailureReason) ? string.Empty : " : " + trace.FailureReason)}.", page));
        }

        if (reading.Lines.Count == 0 && !issues.Any(i => i.Code == StatementIssueCodes.AiPageEmpty && i.PageNumber == page))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiPageEmpty, StatementIssueSeverity.Warning,
                $"Page {page} : aucune opération lue par l'IA. Vérifiez qu'elle ne contient pas d'opérations.", page));
        }
    }

    /// <summary>
    /// Ligne « solde / total » recopiée comme une opération : libellé explicite ET montant égal à un
    /// solde de page (la sienne ou une voisine) ou à la somme débit/crédit de la page. Les deux
    /// conditions sont exigées : un virement libellé « SOLDE FACTURE » n'est jamais écarté.
    /// </summary>
    private static bool IsSummaryLine(
        ExtractedStatementLine line,
        int page,
        int previousPage,
        int nextPage,
        IReadOnlyDictionary<int, (decimal? Opening, decimal? Closing)> balances,
        IReadOnlyDictionary<int, (decimal Debit, decimal Credit)> sums)
    {
        var normalized = NormalizeLabel(line.Label);
        if (!SummaryLabelPrefixes.Any(p => normalized.StartsWith(p, StringComparison.Ordinal)))
            return false;

        var amount = line.Amount;
        foreach (var p in new[] { page, previousPage, nextPage })
        {
            if (p <= 0 || !balances.TryGetValue(p, out var b))
                continue;
            if (b.Opening is { } o && Math.Abs(o) == amount) return true;
            if (b.Closing is { } c && Math.Abs(c) == amount) return true;
        }

        if (sums.TryGetValue(page, out var s))
        {
            // La ligne elle-même est comprise dans la somme : on la retire pour comparer.
            var debitWithout = line.IsDebit ? s.Debit - amount : s.Debit;
            var creditWithout = line.IsDebit ? s.Credit : s.Credit - amount;
            if (debitWithout == amount || creditWithout == amount)
                return true;
        }

        return false;
    }

    private static bool IsSameOperation(ExtractedStatementLine a, ExtractedStatementLine b) =>
        a.TransactionDate == b.TransactionDate
        && a.Amount == b.Amount
        && a.IsDebit == b.IsDebit
        && string.Equals(NormalizeLabel(a.Label), NormalizeLabel(b.Label), StringComparison.Ordinal);

    private static int ModalPrintedDecimals(IEnumerable<int?> values)
    {
        var known = values.Where(v => v is not null).Select(v => v!.Value).ToList();
        if (known.Count == 0)
            return BankStatementBalanceCheck.CurrencyDecimals;
        return known.GroupBy(v => v).OrderByDescending(g => g.Count()).ThenByDescending(g => g.Key).First().Key;
    }

    private static IReadOnlyList<StatementExtractionIssue> OrderIssues(List<StatementExtractionIssue> issues) =>
        issues
            .OrderByDescending(i => i.Severity)
            .ThenBy(i => i.PageNumber ?? 0)
            .ThenBy(i => i.LineIndex ?? -1)
            .ToList();

    internal static string NormalizeLabel(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;
        var decomposed = value.Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder(decomposed.Length);
        var lastSpace = true;
        foreach (var ch in decomposed)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) == System.Globalization.UnicodeCategory.NonSpacingMark)
                continue;
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(char.ToUpperInvariant(ch));
                lastSpace = false;
            }
            else if (!lastSpace)
            {
                sb.Append(' ');
                lastSpace = true;
            }
        }
        return sb.ToString().Trim();
    }

    private static string Truncate(string value, int max)
    {
        var v = (value ?? string.Empty).Trim();
        return v.Length <= max ? v : v[..max] + "…";
    }

    private static string MaskRibTail(string rib)
    {
        var digits = TunisianIban.NormalizeRibDigits(rib);
        return digits.Length >= 4 ? digits[^4..] : digits;
    }
}
