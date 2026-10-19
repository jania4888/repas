using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// Proposition en lecture seule renvoyée par l'import de document fournisseur (PDF / image) pour
/// pré-remplir un bon de réception. Voir <c>PurchaseReceiptDocumentImportController</c> et
/// <c>ImportPurchaseReceiptFromDocumentHandler</c>.
///
/// Ce ne sont PAS des DTO LLM : la règle « tout nullable » de <c>LlmDtoContractTests</c> ne
/// s'applique pas ici (leurs racines ne sont pas ajoutées à <c>LlmDtoContractTests.Roots</c>).
/// Sérialisés en camelCase par la configuration JSON globale de l'API.
/// </summary>
public sealed record PurchaseReceiptImportProposalDto(
    string ExtractionProvider,            // "docstrange" | "llm-text" | "llm-vision" | "native-pdf"
    bool OcrApplied,
    string? DocumentType,                 // valeur de DocumentTypes
    string? DocumentNumber,               // numéro brut lu
    PurchaseReceiptImportHeaderDto Header,
    PurchaseReceiptImportSupplierDto Supplier,
    IReadOnlyList<PurchaseReceiptImportLineDto> Lines,
    PurchaseReceiptImportTotalsDto DocumentTotals,
    PurchaseReceiptImportExpectedTotalsDto ExpectedReceiptTotals,
    string? Confidence,                   // "high" | "medium" | "low" (NormalizeConfidence)
    IReadOnlyList<PurchaseReceiptImportWarningDto> Warnings,
    bool CanCreateSupplier,               // HasPermission(Suppliers.Create)
    bool CanCreateProduct);                // HasPermission(Products.Create)

public sealed record PurchaseReceiptImportHeaderDto(
    DateTime? ReceiptDate,                 // IssueDate du document, sinon null (l'UI met la date du jour)
    string? DeliveryNoteNumber,            // DocumentNumber si DocumentType = bon de livraison, <= 100 car.
    string? SupplierReference,             // DocumentNumber si facture, <= 100 car.
    string? Currency,                      // NormalizeCurrency
    string? SuggestedNotes,                // ex. « Timbre fiscal : 1,000 TND » ; <= 2000 car.
    Guid? SuggestedWarehouseId);           // IWarehouseRepository.GetDefaultAsync, si actif

public sealed record PurchaseReceiptImportSupplierDto(
    string MatchOutcome,                   // MatchedByNif | MatchedByName | Ambiguous | NameConflictsWithNif | MatchedInactive | NotFound | Missing
    Guid? SupplierId,                      // présélection (null si inactif / ambigu / absent)
    string? SupplierName,
    string? ExtractedName,
    string? ExtractedNif,                  // texte lu, pour affichage
    IReadOnlyList<SupplierCandidateDto> Candidates,
    SupplierPrefillDto? Prefill);

public sealed record SupplierCandidateDto(Guid Id, string Name, string? Nif, string? City, bool IsActive);

public sealed record SupplierPrefillDto(
    string? Name, SupplierType Type, string? Nif,
    string? Street, string? City, string? PostalCode, string? Governorate,
    string? Email, string? Phone,
    IReadOnlyList<string> MissingRequiredFields);

public sealed record PurchaseReceiptImportLineDto(
    int Index,                             // ordre du document, base 0
    string? ExtractedCode,                 // Reference
    string? Designation,
    string? Unit,
    decimal? Quantity,
    decimal? UnitPriceHt,
    decimal? DiscountPercent,              // null si hors bornes
    decimal? VatRatePercent,               // extrait
    decimal? LineTotalHt,                  // extrait
    string MatchMethod,                    // code | barcode | name | ambiguous | none | skipped
    Guid? ProductId,
    string? ProductCode,
    string? ProductName,
    decimal? ProductVatRatePercent,        // taux qui sera appliqué
    bool VatMismatch,
    IReadOnlyList<ProductCandidateDto> Candidates,
    ProductPrefillDto? Prefill);

public sealed record ProductCandidateDto(Guid Id, string Code, string Name, decimal VatRatePercent, decimal? PurchasePrice);

public sealed record ProductPrefillDto(
    string? Code, bool CodeConflict, string Name, ProductType Type,
    decimal? PurchasePrice, VatRate VatRate, string? Unit, string? Barcode,
    bool IsStockManaged, Guid? PreferredSupplierId);

public sealed record PurchaseReceiptImportTotalsDto(
    decimal? TotalHt, decimal? TotalVat, decimal? FodecAmount, decimal? FiscalStampAmount,
    decimal? WithholdingAmount, decimal? TotalTtc,
    IReadOnlyList<PurchaseReceiptImportVatBreakdownDto> VatBreakdown);

public sealed record PurchaseReceiptImportVatBreakdownDto(decimal RatePercent, decimal BaseHt, decimal VatAmount);

public sealed record PurchaseReceiptImportExpectedTotalsDto(decimal SubTotal, decimal TotalVat, decimal TotalAmount);

public sealed record PurchaseReceiptImportWarningDto(string Code, string Severity, string Message, int? LineIndex);

/// <summary>Capacités d'import de document fournisseur, pour la modale et les écrans de revue.</summary>
public sealed record PurchaseReceiptImportCapabilitiesDto(
    bool Available,
    string? ExtractionProvider,            // "docstrange" | "llm" ; jamais une URL ni une clé
    bool OcrAvailable,
    bool VisionCapable,
    bool ExternalProcessing,               // vrai si Docstrange lit, ou si le modèle résolu n'est pas local (Ollama)
    long MaxFileBytes,
    IReadOnlyList<string> AcceptedContentTypes,
    bool CanCreateSupplier,
    bool CanCreateProduct,
    bool CanAttach);                        // HasPermission(PurchaseReceipts.Update)
