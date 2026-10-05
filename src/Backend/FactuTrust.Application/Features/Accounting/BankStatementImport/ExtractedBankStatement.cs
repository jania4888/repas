namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Résultat d'extraction d'un relevé bancaire (import IA vers le journal de banque).
///
/// Convention de signe : un solde POSITIF est créditeur (en faveur du titulaire), un solde
/// négatif est débiteur (découvert). Les montants de ligne sont toujours positifs ; le sens
/// est porté par <see cref="ExtractedStatementLine.IsDebit"/> (true = sortie d'argent).
/// </summary>
public sealed record ExtractedBankStatement
{
    public required ExtractedStatementHeader Header { get; init; }
    public required IReadOnlyList<ExtractedStatementLine> Lines { get; init; }
    public required IReadOnlyList<StatementExtractionIssue> Issues { get; init; }

    /// <summary>Identifiant du profil de mise en page retenu (ex. « stb-historique », « generic »).</summary>
    public required string ProfileId { get; init; }

    public required int PageCount { get; init; }

    /// <summary>Pages sans couche texte exploitable (scannées) : à traiter par OCR / IA.</summary>
    public IReadOnlyList<int> UnresolvedPages { get; init; } = Array.Empty<int>();

    /// <summary>
    /// Pages confiées à l'IA et pourquoi (drapeau « tout document par l'IA »). Null = ancien
    /// fonctionnement : seules les <see cref="UnresolvedPages"/> sont lues par l'IA.
    /// </summary>
    public BankStatementAiPlan? AiPlan { get; init; }

    /// <summary>Numéros de pages absolus dans le PDF source (segment multi-relevés). Null = pages 1..PageCount.</summary>
    public IReadOnlyList<int>? SourcePages { get; init; }

    public bool HasBlockingIssue => Issues.Any(i => i.Severity == StatementIssueSeverity.Blocking);
}

public sealed record ExtractedStatementHeader
{
    /// <summary>RIB à 20 chiffres (clé vérifiée) ou null s'il n'a pas été trouvé.</summary>
    public string? Rib { get; init; }

    /// <summary>Code banque BCT (2 premiers chiffres du RIB).</summary>
    public string? BankCode { get; init; }

    public string? Currency { get; init; }
    public DateOnly? PeriodStart { get; init; }
    public DateOnly? PeriodEnd { get; init; }

    /// <summary>
    /// True si la période vient du document (période ou dates de solde imprimées), false si elle a été
    /// déduite des dates des opérations lues. Sert à borner les dates proposées par l'IA.
    /// </summary>
    public bool PeriodPrinted { get; init; }

    public StatementAmount? OpeningBalance { get; init; }
    public StatementAmount? ClosingBalance { get; init; }

    /// <summary>Totaux imprimés (toujours positifs).</summary>
    public StatementAmount? TotalDebits { get; init; }

    public StatementAmount? TotalCredits { get; init; }

    /// <summary>True si les totaux ont été lus sous un libellé explicite (« TOTAL », « Totaux »…).</summary>
    public bool TotalsLabelled { get; init; }

    /// <summary>Le total crédit imprimé inclut le solde d'ouverture (convention BIAT).</summary>
    public bool CreditTotalIncludesOpening { get; init; }
}

/// <summary>Montant imprimé, avec le nombre de décimales effectivement imprimées (précision du contrôle).</summary>
public sealed record StatementAmount(decimal Value, int PrintedDecimals, StatementSignSource SignSource = StatementSignSource.Column);

public enum StatementSignSource
{
    /// <summary>Sens lu par la colonne (Débit / Crédit) ou par un signe explicite.</summary>
    Column = 0,

    /// <summary>Sens lu par un mot (CREDITEUR / DEBITEUR).</summary>
    Keyword = 1,

    /// <summary>Aucune indication : supposé créditeur. Le contrôle arithmétique tranchera.</summary>
    Assumed = 2
}

public sealed record ExtractedStatementLine
{
    /// <summary>Rang 0-based dans le relevé (ordre d'impression).</summary>
    public required int Index { get; init; }

    public required int PageNumber { get; init; }
    public required DateOnly TransactionDate { get; init; }
    public DateOnly? ValueDate { get; init; }

    /// <summary>Libellé brut, lignes jointes par une espace.</summary>
    public required string Label { get; init; }

    /// <summary>Libellé ligne à ligne (affichage fidèle en relecture).</summary>
    public IReadOnlyList<string> LabelLines { get; init; } = Array.Empty<string>();

    /// <summary>Montant strictement positif.</summary>
    public required decimal Amount { get; init; }

    /// <summary>true = débit du relevé (sortie d'argent), false = crédit (entrée).</summary>
    public required bool IsDebit { get; init; }

    public StatementLineSource Source { get; init; } = StatementLineSource.Layout;
}

public enum StatementLineSource
{
    /// <summary>Lecture déterministe de la couche texte (positions des mots).</summary>
    Layout = 0,

    /// <summary>Lecture IA (page scannée ou non résolue).</summary>
    Ai = 1,

    /// <summary>Corrigée à la main en relecture (auditée).</summary>
    Manual = 2
}

public enum StatementIssueSeverity
{
    Info = 0,
    Warning = 1,

    /// <summary>Interdit la confirmation du relevé et la génération des écritures.</summary>
    Blocking = 2
}

/// <summary>
/// Signalement d'extraction. <see cref="Code"/> est stable (testé par le front) ;
/// <see cref="Message"/> est le texte français, traduit côté API.
/// </summary>
public sealed record StatementExtractionIssue(
    string Code,
    StatementIssueSeverity Severity,
    string Message,
    int? PageNumber = null,
    int? LineIndex = null);

/// <summary>Codes stables des signalements d'extraction.</summary>
public static class StatementIssueCodes
{
    public const string NoTextLayer = "statement.no_text_layer";
    public const string NoTransactions = "statement.no_transactions";
    public const string RibNotFound = "statement.rib_not_found";
    public const string RibInvalidKey = "statement.rib_invalid_key";
    public const string CurrencyNotFound = "statement.currency_not_found";
    public const string OpeningNotFound = "statement.opening_not_found";
    public const string ClosingNotFound = "statement.closing_not_found";
    public const string BalanceMismatch = "statement.balance_mismatch";
    public const string TotalDebitsMismatch = "statement.total_debits_mismatch";
    public const string TotalCreditsMismatch = "statement.total_credits_mismatch";
    public const string LineNoAmount = "statement.line_no_amount";
    public const string LineSeveralAmounts = "statement.line_several_amounts";
    public const string LineAmbiguousSide = "statement.line_ambiguous_side";
    public const string LineInvalidDate = "statement.line_invalid_date";
    public const string OrphanAmount = "statement.orphan_amount";
    public const string AssumedBalanceSign = "statement.assumed_balance_sign";
    public const string TooManyPages = "statement.too_many_pages";
    public const string Unreadable = "statement.unreadable";
    public const string RibMismatch = "statement.rib_mismatch";
    public const string CurrencyNotSupported = "statement.currency_not_supported";
    public const string AiUnavailable = "statement.ai_unavailable";
    public const string AiPageFailed = "statement.ai_page_failed";
    public const string AiAmountNotGrounded = "statement.ai_amount_not_grounded";
    public const string AiNotStarted = "statement.ai_not_started";
    public const string AiRibMismatch = "statement.ai_rib_mismatch";

    // ── Lecture « IA seule » (toute page de tout relevé lue par GLM-OCR) ──

    /// <summary>Warning (page) : page lue par l'IA sans aucune opération.</summary>
    public const string AiPageEmpty = "statement.ai_page_empty";
    /// <summary>Warning (page) : lecture probablement incomplète (plafond d'opérations atteint ou réponse coupée).</summary>
    public const string AiPageTruncated = "statement.ai_page_truncated";
    /// <summary>Info (page) : ligne de solde/total reconnue et non importée.</summary>
    public const string AiSummaryLineDropped = "statement.ai_summary_line_dropped";
    /// <summary>Warning (page, LineIndex) : première ligne d'une page identique à la dernière de la précédente (report possible).</summary>
    public const string AiPossibleDuplicate = "statement.ai_possible_duplicate";
    /// <summary>Warning (page) : page fournie par le modèle texte après échec ou indisponibilité de GLM-OCR (D2).</summary>
    public const string AiTextFallback = "statement.ai_text_fallback";
    /// <summary>Blocking (page, LineIndex) : ligne conservée mais incomplète (montant, date ou sens illisible) ; à corriger ou exclure.</summary>
    public const string AiLineNeedsReview = "statement.ai_line_needs_review";

    /// <summary>Le fichier contient plusieurs relevés (périodes distinctes) : à lire relevé par relevé.</summary>
    public const string MultipleStatements = "statement.multiple_statements";
    public const string TooManyStatements = "statement.too_many_statements";
    /// <summary>Deux relevés d'un même fichier se chevauchent.</summary>
    public const string PeriodsOverlap = "statement.periods_overlap";
    /// <summary>Le solde d'ouverture ne reprend pas la clôture du relevé précédent du fichier.</summary>
    public const string Discontinuity = "statement.discontinuity";

    /// <summary>Codes produits par le contrôle arithmétique (recalculés après chaque correction).</summary>
    public static readonly IReadOnlySet<string> BalanceCodes = new HashSet<string>(StringComparer.Ordinal)
    {
        OpeningNotFound, ClosingNotFound, BalanceMismatch, TotalDebitsMismatch, TotalCreditsMismatch, AssumedBalanceSign
    };
}
