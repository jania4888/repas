namespace FactuTrust.Application.Configuration;

/// <summary>Garde-fous de charge et de rétention de l'import IA de relevés bancaires (section <c>Accounting:BankStatementImport</c>).</summary>
public sealed class BankStatementImportLimits
{
    /// <summary>Taille maximale du fichier (10 Mo, comme l'import de facture).</summary>
    public long MaxFileBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>
    /// Nombre maximal de pages du PDF (refus avant lecture). Valeur unique, propagée à l'extracteur
    /// de texte (<c>AiDocumentTextExtractor</c>) pour qu'aucune page ne soit tronquée en silence.
    /// </summary>
    public int MaxPages { get; set; } = 50;

    /// <summary>
    /// Nombre maximal de pages lues par l'IA dans une même analyse (borné à [1 ; 60]). En mode
    /// « IA seule », un relevé qui dépasse ce plafond est refusé en amont (lecture partielle inutile).
    /// </summary>
    public int MaxAiPages { get; set; } = 20;

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

    // ── Lecture vision GLM-OCR (relevés non prouvés) ──

    /// <summary>Active la lecture page par page via le modèle vision (GLM-OCR).</summary>
    public bool VisionReadingEnabled { get; set; }

    /// <summary>
    /// Mode « IA seule » (D1 + D3) : toutes les pages de tout relevé sont lues par l'IA
    /// (<see cref="Features.Accounting.BankStatementImport.BankStatementAiReadingModes.AiOnly"/>) ;
    /// la lecture directe du PDF ne fournit plus que des métadonnées et un RIB différent du compte
    /// n'empêche plus la lecture. OFF (défaut code) = chemin historique « complément ».
    /// Évalué à travers <c>AccountingSettings.IsAiForAllDocumentsEnabledFor</c> (dossiers pilotes).
    /// </summary>
    public bool AiOnlyReadingEnabled { get; set; }

    /// <summary>
    /// D4 : quand toutes les lignes viennent de l'IA (aucune ligne lue directement, aucune page en
    /// échec), un contrôle de solde qui ne boucle pas devient un avertissement à reconnaître
    /// explicitement à la confirmation, au lieu d'un blocage. OFF (défaut code) = blocage.
    /// </summary>
    public bool AiBalanceMismatchAsWarning { get; set; }

    /// <summary>Dossiers pilotes (GUID). Vide = tous les dossiers.</summary>
    public List<Guid> AiPilotTenantIds { get; set; } = new();

    /// <summary>Repli qwen / chemin historique si GLM-OCR échoue sur une page.</summary>
    public bool VisionTextFallbackEnabled { get; set; } = true;

    /// <summary>Inclure le texte OCR/couche texte dans le message utilisateur avec l'image.</summary>
    public bool VisionSendTextLayer { get; set; }

    public int VisionRenderDpi { get; set; } = 200;

    public int VisionMaxLongSidePx { get; set; } = 3000;

    public int VisionMaxOutputTokens { get; set; } = 4096;

    public int VisionCallTimeoutSeconds { get; set; } = 300;

    /// <summary>Durée estimée par page vision (affichage UI).</summary>
    public int VisionEstimatedSecondsPerPage { get; set; } = 180;

    /// <summary>Refus des images dont largeur×hauteur dépasse ce seuil (MP).</summary>
    public int MaxImageMegapixels { get; set; } = 60;

    /// <summary>
    /// Workers Hangfire dédiés à la file <c>bank_statement_ai</c>. Règle : ≤ <c>Ollama:MaxConcurrentGenerations</c>
    /// (un second ouvrier attendrait derrière le créneau unique du moteur pendant que son budget s'écoule).
    /// </summary>
    public int AiWorkerCount { get; set; } = 1;

    public int EffectiveVisionRenderDpi => Math.Clamp(VisionRenderDpi, 120, 300);

    public int EffectiveVisionMaxLongSidePx => Math.Clamp(VisionMaxLongSidePx, 1200, 4000);

    public int EffectiveVisionMaxOutputTokens => Math.Clamp(VisionMaxOutputTokens, 1024, 8192);

    public int EffectiveVisionCallTimeoutSeconds => Math.Clamp(VisionCallTimeoutSeconds, 60, 600);

    public int EffectiveVisionEstimatedSecondsPerPage => Math.Clamp(VisionEstimatedSecondsPerPage, 30, 900);

    public int EffectiveMaxImageMegapixels => Math.Clamp(MaxImageMegapixels, 10, 120);

    public int EffectiveAiWorkerCount => Math.Clamp(AiWorkerCount, 1, 4);

    public int EffectiveMaxPages => Math.Clamp(MaxPages, 1, 200);

    public int EffectiveMaxAiPages => Math.Clamp(MaxAiPages, 1, 60);

    public bool IsPilotTenant(Guid? tenantId) =>
        AiPilotTenantIds.Count == 0 || (tenantId is { } id && AiPilotTenantIds.Contains(id));

    public int EffectiveAiTextOperationsPerCall => Math.Clamp(AiTextOperationsPerCall, 3, 15);

    public int EffectiveMaxAiCalls => Math.Max(1, MaxAiCalls);

    public int EffectiveAiJobBudgetMinutes => Math.Clamp(AiJobBudgetMinutes, 20, 240);

    public int EffectiveAiEstimatedSecondsPerCall => Math.Clamp(AiEstimatedSecondsPerCall, 10, 900);
}
