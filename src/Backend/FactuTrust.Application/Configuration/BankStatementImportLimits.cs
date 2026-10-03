namespace FactuTrust.Application.Configuration;

/// <summary>Garde-fous de charge et de rétention de l'import IA de relevés bancaires (section <c>Accounting:BankStatementImport</c>).</summary>
public sealed class BankStatementImportLimits
{
    /// <summary>Taille maximale du fichier (10 Mo, comme l'import de facture).</summary>
    public long MaxFileBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>Nombre maximal de pages du PDF (refus avant lecture).</summary>
    public int MaxPages { get; set; } = 60;

    /// <summary>Nombre maximal de pages lues par l'IA (pages scannées) dans une même analyse.</summary>
    public int MaxAiPages { get; set; } = 30;

    /// <summary>Durée de vie d'une analyse non confirmée (fichier et résultat purgés ensuite).</summary>
    public int SessionRetentionHours { get; set; } = 24;

    /// <summary>Nombre maximal de lignes par appel de génération d'écritures.</summary>
    public int MaxGenerationBatch { get; set; } = 200;

    /// <summary>Nombre de libellés distincts envoyés à l'IA par appel de classification.</summary>
    public int ClassificationBatchSize { get; set; } = 40;

    /// <summary>Dossier racine de stockage des relevés (hors wwwroot).</summary>
    public string StorageBasePath { get; set; } = "App_Data/bank-statements";

    // ── Relecture IA des pages texte (drapeau Accounting:BankStatementAiForAllDocumentsEnabled) ──

    /// <summary>
    /// Opérations envoyées à l'IA par appel quand une page texte est relue (borné à [3 ; 15]). Des
    /// appels courts tiennent dans le délai d'un appel d'import et libèrent vite la file IA partagée.
    /// </summary>
    public int AiTextOperationsPerCall { get; set; } = 6;

    /// <summary>Nombre maximal d'appels IA pour un même relevé (pages scannées + extraits de pages texte).</summary>
    public int MaxAiCalls { get; set; } = 30;

    /// <summary>Budget total (minutes) d'une lecture IA de relevé, attente de la file comprise (borné à [20 ; 240]).</summary>
    public int AiJobBudgetMinutes { get; set; } = 120;

    /// <summary>Durée estimée d'un appel IA (secondes), pour l'affichage « ≈ N min » pendant l'analyse.</summary>
    public int AiEstimatedSecondsPerCall { get; set; } = 120;

    /// <summary>
    /// Autorise l'envoi du texte des pages lisibles à un fournisseur IA EXTERNE (OpenRouter, Modal…).
    /// OFF par défaut : avec un fournisseur externe, seules les pages scannées partent à l'IA (comme
    /// avant) et une page texte non lue avec certitude reste bloquée.
    /// </summary>
    public bool AiComplementAllowExternal { get; set; }

    public int EffectiveAiTextOperationsPerCall => Math.Clamp(AiTextOperationsPerCall, 3, 15);

    public int EffectiveMaxAiCalls => Math.Max(1, MaxAiCalls);

    public int EffectiveAiJobBudgetMinutes => Math.Clamp(AiJobBudgetMinutes, 20, 240);

    public int EffectiveAiEstimatedSecondsPerCall => Math.Clamp(AiEstimatedSecondsPerCall, 10, 900);
}
