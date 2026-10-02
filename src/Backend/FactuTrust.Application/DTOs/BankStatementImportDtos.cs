namespace FactuTrust.Application.DTOs;

/// <summary>Format du fichier de relevé bancaire importé.</summary>
public enum BankStatementFileFormat
{
    /// <summary>CSV délimité (colonnes : date, libelle, [reference], debit/credit ou montant signé).</summary>
    Csv = 0,

    /// <summary>Classeur Excel (.xlsx), mêmes colonnes que le CSV, première ligne = en-têtes.</summary>
    Excel = 1,

    /// <summary>Relevé bancaire PDF (texte natif ou scanné).</summary>
    Pdf = 2,

    /// <summary>Image scannée (JPEG/PNG).</summary>
    Image = 3,

    /// <summary>Fichier OFX (Open Financial Exchange) — export bancaire standard.</summary>
    Ofx = 4,

    /// <summary>Fichier MT940 (relevé SWIFT).</summary>
    Mt940 = 5
}

/// <summary>
/// Résultat de l'analyse d'un fichier de relevé bancaire : lignes exploitables prêtes à être
/// soumises à l'import (<see cref="ImportBankStatementRequest"/>) + rapport d'anomalies.
/// Aucune donnée n'est persistée à ce stade.
/// </summary>
public sealed record BankStatementFilePreviewDto
{
    public int TotalLines { get; init; }
    public int ValidLines { get; init; }
    public decimal TotalDebit { get; init; }
    public decimal TotalCredit { get; init; }
    /// <summary>Bornes détectées dans le fichier (pré-remplissage de la période du relevé).</summary>
    public DateTime? PeriodStart { get; init; }
    public DateTime? PeriodEnd { get; init; }
    /// <summary>Vrai si aucune anomalie bloquante : l'import est alors autorisé.</summary>
    public bool CanImport { get; init; }
    public IReadOnlyList<ImportIssueDto> Issues { get; init; } = Array.Empty<ImportIssueDto>();
    public IReadOnlyList<ImportBankStatementLineRequest> Lines { get; init; } = Array.Empty<ImportBankStatementLineRequest>();

    // ── Enrichissements PDF/OCR ─────────────────────────────────────────────
    public string? DetectedBankCode { get; init; }
    public string? DetectedRib { get; init; }
    public string? DetectedIban { get; init; }
    public Guid? MatchedBankAccountId { get; init; }
    public string? MatchedChartOfAccountNumber { get; init; }
    public string? SuggestedBankName { get; init; }
    public decimal? SuggestedOpeningBalance { get; init; }
    public decimal? SuggestedClosingBalance { get; init; }
    public BankStatementExtractionMethod ExtractionMethod { get; init; }
    public int ConfidenceScore { get; init; }
    public int SourcePageCount { get; init; }
    /// <summary>Écart entre solde calculé et solde final déclaré (null si non calculable).</summary>
    public decimal? BalanceDiscrepancy { get; init; }

    /// <summary>
    /// Fichier contenant PLUSIEURS relevés (ex. deux mois assemblés) : un aperçu par relevé, dans
    /// l'ordre chronologique, chacun avec son propre <see cref="CanImport"/>. Null = un seul relevé
    /// (cas historique). Quand il est renseigné, les champs racine reprennent le premier relevé et
    /// <see cref="CanImport"/> racine vaut false : un client qui ignore ce champ ne peut pas importer
    /// une partie du fichier en la prenant pour le tout.
    /// </summary>
    public IReadOnlyList<BankStatementFilePreviewDto>? Statements { get; init; }
}

/// <summary>Codes stables des échecs de l'aperçu d'un relevé (testés par le front, jamais le texte).</summary>
public static class BankStatementPreviewErrorCodes
{
    /// <summary>La lecture OCR + IA a dépassé le budget de l'aperçu (attente de la file IA comprise).</summary>
    public const string PreviewTimeout = "bank_statement.preview_timeout";

    /// <summary>Le moteur IA a répondu en erreur ou n'a pas répondu (délai, modèle absent, 5xx).</summary>
    public const string AiUnavailable = "bank_statement.ai_unavailable";
}
