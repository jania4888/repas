namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>Pourquoi l'IA relit un relevé (codes stables, lus par le front).</summary>
public static class BankStatementAiReadingReasons
{
    /// <summary>Pages scannées (sans couche texte) : seule l'IA peut les lire.</summary>
    public const string Scanned = "scanned";

    /// <summary>Pages texte dont certaines lignes n'ont pas été lues avec certitude.</summary>
    public const string LineIssues = "line_issues";

    /// <summary>Relevé texte non vérifié (solde qui ne boucle pas, aucune opération lue) : tout est relu.</summary>
    public const string Unverified = "unverified";
}

/// <summary>Pages confiées à l'IA pour un relevé, avec l'estimation de durée affichée pendant l'analyse.</summary>
public sealed record BankStatementAiPlan
{
    /// <summary>Pages sans couche texte : lues par l'IA page par page (image + OCR).</summary>
    public IReadOnlyList<int> ScannedPages { get; init; } = Array.Empty<int>();

    /// <summary>Pages texte relues par l'IA par extraits de quelques opérations, en complément de la lecture directe.</summary>
    public IReadOnlyList<int> TextPages { get; init; } = Array.Empty<int>();

    /// <summary>Voir <see cref="BankStatementAiReadingReasons"/> ; null quand le plan est vide.</summary>
    public string? Reason { get; init; }

    /// <summary>Nombre d'appels IA prévus (une page scannée = un appel ; une page texte = un appel par extrait).</summary>
    public int EstimatedCalls { get; init; }

    public int EstimatedSeconds { get; init; }

    public bool IsEmpty => ScannedPages.Count == 0 && TextPages.Count == 0;

    public static BankStatementAiPlan Empty { get; } = new();
}

/// <summary>
/// Choisit les pages qu'il faut faire relire par l'IA : toute page qui n'a pas été lue avec certitude
/// par la lecture directe. Une lecture prouvée (aucun blocage, solde vérifié au millime) donne un plan
/// vide : l'IA n'est pas appelée. Seuls les signalements BLOQUANTS comptent ; un avertissement ne
/// déclenche jamais l'IA. Fonction pure (aucun accès base, aucun appel IA).
/// </summary>
public static class BankStatementAiReadingPlanner
{
    /// <summary>Blocages qu'une relecture ne peut pas lever : l'IA n'est alors pas sollicitée du tout.</summary>
    private static readonly IReadOnlySet<string> NotFixableByReading = new HashSet<string>(StringComparer.Ordinal)
    {
        StatementIssueCodes.RibMismatch,
        StatementIssueCodes.CurrencyNotSupported,
        StatementIssueCodes.TooManyPages,
        StatementIssueCodes.TooManyStatements,
        StatementIssueCodes.MultipleStatements,
        StatementIssueCodes.PeriodsOverlap,
        StatementIssueCodes.Unreadable
    };

    /// <summary>Signalements de ligne : la page qui les porte est relue.</summary>
    public static readonly IReadOnlySet<string> LineLevelCodes = new HashSet<string>(StringComparer.Ordinal)
    {
        StatementIssueCodes.OrphanAmount,
        StatementIssueCodes.LineNoAmount,
        StatementIssueCodes.LineSeveralAmounts,
        StatementIssueCodes.LineInvalidDate,
        StatementIssueCodes.LineAmbiguousSide
    };

    public static BankStatementAiPlan Select(ExtractedBankStatement statement)
    {
        ArgumentNullException.ThrowIfNull(statement);
        var blocking = statement.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).ToList();
        if (blocking.Any(i => NotFixableByReading.Contains(i.Code)))
            return BankStatementAiPlan.Empty;

        var scanned = statement.UnresolvedPages.Distinct().OrderBy(p => p).ToList();
        var scannedSet = scanned.ToHashSet();
        var textPages = Enumerable.Range(1, Math.Max(0, statement.PageCount)).Where(p => !scannedSet.Contains(p)).ToList();

        var wholeDocument =
            blocking.Any(i => StatementIssueCodes.BalanceCodes.Contains(i.Code))
            || blocking.Any(i => i.Code == StatementIssueCodes.LineAmbiguousSide && i.PageNumber is null)
            || (scanned.Count == 0 && blocking.Any(i => i.Code == StatementIssueCodes.NoTransactions));

        List<int> textToRead;
        string? textReason;
        if (wholeDocument)
        {
            textToRead = textPages;
            textReason = BankStatementAiReadingReasons.Unverified;
        }
        else
        {
            var textSet = textPages.ToHashSet();
            textToRead = blocking
                .Where(i => LineLevelCodes.Contains(i.Code) && i.PageNumber is { } p && textSet.Contains(p))
                .Select(i => i.PageNumber!.Value)
                .Distinct()
                .OrderBy(p => p)
                .ToList();
            textReason = textToRead.Count > 0 ? BankStatementAiReadingReasons.LineIssues : null;
        }

        if (scanned.Count == 0 && textToRead.Count == 0)
            return BankStatementAiPlan.Empty;

        return new BankStatementAiPlan
        {
            ScannedPages = scanned,
            TextPages = textToRead,
            Reason = textReason ?? BankStatementAiReadingReasons.Scanned
        };
    }

    /// <summary>Complète le plan avec le nombre d'appels prévus et la durée estimée.</summary>
    public static BankStatementAiPlan WithEstimate(BankStatementAiPlan plan, int textCalls, int secondsPerCall)
    {
        var calls = plan.ScannedPages.Count + Math.Max(0, textCalls);
        return plan with { EstimatedCalls = calls, EstimatedSeconds = calls * Math.Max(0, secondsPerCall) };
    }
}
