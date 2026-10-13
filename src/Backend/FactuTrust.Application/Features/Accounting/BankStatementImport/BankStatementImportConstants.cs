namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Valeurs stables de <c>BankStatementImportSession.ExtractionMethod</c> (nvarchar(20)). Le libellé
/// affiché est construit par le front ; le backend ne stocke aucun libellé.
/// </summary>
public static class BankStatementImportExtractionMethods
{
    /// <summary>Lecture directe du PDF seule (chemin historique).</summary>
    public const string Layout = "layout";

    /// <summary>Lecture directe complétée par l'IA (chemin historique).</summary>
    public const string LayoutAndAi = "layout+ai";

    /// <summary>IA seule, chemin historique (image ou PDF scanné) ou session antérieure.</summary>
    public const string Ai = "ai";

    /// <summary>Plan « IA seule », moteur vision (GLM-OCR), même si des pages ont été repliées sur le modèle texte.</summary>
    public const string AiVision = "ai-vision";

    /// <summary>Plan « IA seule », moteur texte pour tout le relevé (GLM-OCR indisponible ou lecture vision désactivée).</summary>
    public const string AiText = "ai-text";

    /// <summary>Plan « IA seule » sans lecture : IA indisponible avant lancement (session relançable).</summary>
    public const string None = "none";

    /// <summary>Lecture tabulaire d'un fichier CSV mappé par colonnes (sans IA).</summary>
    public const string Csv = "csv";

    /// <summary>Lecture tabulaire d'un fichier XLSX mappé par colonnes (sans IA).</summary>
    public const string Xlsx = "xlsx";

    /// <summary><c>BankStatementImportSession.ProfileId</c> commun aux imports CSV et XLSX.</summary>
    public const string TabularProfileId = "tabular";
}

/// <summary>Valeurs stables de <c>BankStatementImportSession.ErrorCode</c> (session <c>Failed</c>), lues par le front.</summary>
public static class BankStatementImportSessionErrorCodes
{
    /// <summary>Budget de lecture dépassé.</summary>
    public const string AiTimeout = "ai_timeout";

    /// <summary>Erreur inattendue pendant la lecture.</summary>
    public const string AiFailed = "ai_failed";

    /// <summary>Perte totale de l'IA en cours de lecture (ni vision ni modèle texte).</summary>
    public const string AiUnavailable = "ai_unavailable";

    /// <summary>Codes qui autorisent la relance d'une session <c>Failed</c> (D3).</summary>
    public static readonly IReadOnlySet<string> Relaunchable = new HashSet<string>(StringComparer.Ordinal)
    {
        AiTimeout, AiFailed, AiUnavailable
    };
}
