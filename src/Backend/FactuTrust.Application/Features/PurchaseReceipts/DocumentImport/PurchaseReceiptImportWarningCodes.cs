namespace FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;

/// <summary>
/// Codes d'avertissement non bloquants renvoyés par l'import de bon de réception depuis un
/// document (PDF / image). Évite les chaînes libres testées en dur côté handler et côté tests.
/// Voir le plan, section « Contrôles de cohérence et avertissements ».
/// </summary>
public static class PurchaseReceiptImportWarningCodes
{
    /// <summary>Avertissements relayés tels quels depuis <c>AccountingDocumentExtractionDto.Warnings</c>.</summary>
    public const string Extraction = "Extraction";

    public const string PartiesSwapped = "PartiesSwapped";
    public const string SupplierNotFoundInDocument = "SupplierNotFoundInDocument";
    public const string UnexpectedDocumentType = "UnexpectedDocumentType";
    public const string SupplierInactive = "SupplierInactive";
    public const string SupplierNameConflictsWithNif = "SupplierNameConflictsWithNif";
    public const string SupplierNifInvalid = "SupplierNifInvalid";
    public const string ProductVatMismatch = "ProductVatMismatch";
    public const string ProductInactiveOrTemplate = "ProductInactiveOrTemplate";
    public const string VatRateDefaulted = "VatRateDefaulted";
    public const string QuantityInvalid = "QuantityInvalid";
    public const string DiscountOutOfRange = "DiscountOutOfRange";
    public const string LineTotalMismatch = "LineTotalMismatch";
    public const string TotalHtMismatch = "TotalHtMismatch";
    public const string TotalTtcMismatch = "TotalTtcMismatch";
    public const string FiscalStampNotApplied = "FiscalStampNotApplied";
    public const string CurrencyNotTnd = "CurrencyNotTnd";
    public const string TooManyLines = "TooManyLines";
    public const string PossibleDuplicate = "PossibleDuplicate";
}

/// <summary>Sévérités possibles d'un avertissement d'import, utilisées par <c>PurchaseReceiptImportWarningDto</c>.</summary>
public static class PurchaseReceiptImportWarningSeverities
{
    public const string Info = "info";
    public const string Warning = "warning";
}
