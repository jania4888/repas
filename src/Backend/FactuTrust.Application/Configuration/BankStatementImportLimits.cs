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
}
