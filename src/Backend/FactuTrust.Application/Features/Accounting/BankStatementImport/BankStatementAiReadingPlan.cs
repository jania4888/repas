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

    /// <summary>Mode « IA seule » : toute page de tout relevé est lue par l'IA, quelle que soit la lecture directe.</summary>
    public const string AllDocuments = "all_documents";
}

/// <summary>Mode de lecture d'un plan (porté par <see cref="BankStatementAiPlan.Mode"/>, donc par le <c>ResultJson</c>).</summary>
public static class BankStatementAiReadingModes
{
    /// <summary>Historique : lecture directe du PDF complétée par l'IA sur les pages non prouvées.</summary>
    public const string Complement = "complement";

    /// <summary>D1 : les opérations viennent uniquement de l'IA ; la lecture directe ne fournit que des métadonnées.</summary>
    public const string AiOnly = "ai_only";
}

/// <summary>Moteur qui a fourni une page (valeurs de <see cref="BankStatementPageReading.Engine"/>).</summary>
public static class BankStatementPageReadingEngines
{
    /// <summary>Étage 1 : GLM-OCR, gabarit JSON natif.</summary>
    public const string GlmOcr = "glm-ocr";

    /// <summary>Étage 2 : GLM-OCR « Table Recognition: » + analyseur déterministe.</summary>
    public const string GlmOcrTable = "glm-ocr-table";

    /// <summary>Étage 3 : modèle texte local (repli D2).</summary>
    public const string TextModel = "text-model";

    /// <summary>Les trois étages ont échoué : page non lue.</summary>
    public const string Failed = "failed";
}

/// <summary>
/// Trace de lecture d'une page (D2) : quel moteur l'a fournie, en combien d'étages, en combien de temps.
/// Alimentée page après page pendant la lecture et persistée dans le <c>ResultJson</c> ; aucune donnée de relevé.
/// </summary>
/// <param name="Engine">Voir <see cref="BankStatementPageReadingEngines"/>.</param>
/// <param name="Model">Référence canonique du modèle qui a fourni la page (null si échec).</param>
/// <param name="Attempts">Étages tentés (1..3).</param>
/// <param name="DurationMs">Somme des appels IA de la page.</param>
/// <param name="FailureReason">Dernière raison d'échec d'étage (code court : <c>json_invalid</c>, <c>json_empty</c>, <c>truncated</c>, <c>timeout</c>, <c>circuit_open</c>, <c>vision_model_unavailable</c>, <c>render_failed</c>…) ; null si l'étage 1 a réussi.</param>
public sealed record BankStatementPageReading(
    int Page,
    string Engine,
    string? Model,
    int Attempts,
    long DurationMs,
    int LineCount,
    string? FailureReason)
{
    public bool IsTextFallback => string.Equals(Engine, BankStatementPageReadingEngines.TextModel, StringComparison.Ordinal);

    public bool IsFailed => string.Equals(Engine, BankStatementPageReadingEngines.Failed, StringComparison.Ordinal);
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

    /// <summary><c>vision</c> (GLM-OCR page par page) ou <c>text</c> (historique). Null = plan ancien.</summary>
    public string? Engine { get; init; }

    /// <summary>Pages relues en repli texte / historique après échec vision (dérivé de <see cref="PageReadings"/> en mode « IA seule »).</summary>
    public IReadOnlyList<int> FallbackPages { get; init; } = Array.Empty<int>();

    /// <summary>Voir <see cref="BankStatementAiReadingModes"/> ; null = plan ancien, lu comme <c>complement</c>.</summary>
    public string? Mode { get; init; }

    /// <summary>Trace par page (D2), remplie au fil de la lecture. Vide pour un plan ancien ou avant la première page.</summary>
    public IReadOnlyList<BankStatementPageReading> PageReadings { get; init; } = Array.Empty<BankStatementPageReading>();

    public bool IsEmpty => ScannedPages.Count == 0 && TextPages.Count == 0;

    public bool IsAiOnly => string.Equals(Mode, BankStatementAiReadingModes.AiOnly, StringComparison.Ordinal);

    /// <summary>Toutes les pages planifiées, ordonnées (scannées et texte confondues).</summary>
    public IReadOnlyList<int> PlannedPages => ScannedPages.Concat(TextPages).Distinct().OrderBy(p => p).ToList();

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

    /// <summary>
    /// Tueurs de plan en mode « IA seule » : <c>RibMismatch</c> n'en fait plus partie (D3 : l'IA lit, le
    /// blocage est recalculé après lecture) ; <c>MultipleStatements</c> n'est jamais produit par <c>ExtractAll</c>.
    /// </summary>
    public static readonly IReadOnlySet<string> AiOnlyPlanKillers = new HashSet<string>(StringComparer.Ordinal)
    {
        StatementIssueCodes.TooManyPages,
        StatementIssueCodes.Unreadable,
        StatementIssueCodes.TooManyStatements,
        StatementIssueCodes.PeriodsOverlap,
        StatementIssueCodes.CurrencyNotSupported
    };

    /// <summary>
    /// Mode « IA seule » (D1) : toutes les pages du relevé — ou du segment, via <see cref="ExtractedBankStatement.SourcePages"/> —
    /// sont confiées à l'IA. <c>ScannedPages</c> = pages sans couche texte, <c>TextPages</c> = les autres :
    /// une partition du document (les estimations et plafonds par page restent justes).
    /// Plan vide seulement si un tueur de plan (<see cref="AiOnlyPlanKillers"/>) est présent. Fonction pure.
    /// </summary>
    public static BankStatementAiPlan SelectAiOnly(ExtractedBankStatement statement)
    {
        ArgumentNullException.ThrowIfNull(statement);
        if (statement.Issues.Any(i => i.Severity == StatementIssueSeverity.Blocking && AiOnlyPlanKillers.Contains(i.Code)))
            return BankStatementAiPlan.Empty;

        var pages = statement.SourcePages is { Count: > 0 } source
            ? source.Distinct().OrderBy(p => p).ToList()
            : Enumerable.Range(1, Math.Max(0, statement.PageCount)).ToList();
        if (pages.Count == 0)
            return BankStatementAiPlan.Empty;

        var unresolved = statement.UnresolvedPages.ToHashSet();
        var scanned = pages.Where(unresolved.Contains).ToList();
        var text = pages.Where(p => !unresolved.Contains(p)).ToList();

        return new BankStatementAiPlan
        {
            ScannedPages = scanned,
            TextPages = text,
            Reason = BankStatementAiReadingReasons.AllDocuments,
            Mode = BankStatementAiReadingModes.AiOnly
        };
    }

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
            || blocking.Any(i => i.Code == StatementIssueCodes.NoTransactions);

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

    public static BankStatementAiPlan WithVisionEstimate(BankStatementAiPlan plan, int secondsPerPage)
    {
        var pages = plan.ScannedPages.Count + plan.TextPages.Count;
        return plan with { EstimatedCalls = pages, EstimatedSeconds = pages * Math.Max(0, secondsPerPage) };
    }

    /// <summary>Code du premier blocage qu'une relecture ne peut pas lever (mode « complément »), ou null.</summary>
    public static string? NotFixableBlocker(ExtractedBankStatement statement) =>
        NotFixableBlocker(statement, BankStatementAiReadingModes.Complement);

    /// <summary>Code du premier tueur de plan pour le mode donné, ou null.</summary>
    public static string? NotFixableBlocker(ExtractedBankStatement statement, string? mode)
    {
        ArgumentNullException.ThrowIfNull(statement);
        var killers = string.Equals(mode, BankStatementAiReadingModes.AiOnly, StringComparison.Ordinal)
            ? AiOnlyPlanKillers
            : NotFixableByReading;
        return statement.Issues
            .Where(i => i.Severity == StatementIssueSeverity.Blocking && killers.Contains(i.Code))
            .Select(i => i.Code)
            .FirstOrDefault();
    }

    /// <summary>Pages fournies par le modèle texte, dérivées de la trace par page (D2).</summary>
    public static IReadOnlyList<int> FallbackPagesOf(IEnumerable<BankStatementPageReading> readings) =>
        readings.Where(r => r.IsTextFallback).Select(r => r.Page).Distinct().OrderBy(p => p).ToList();
}
