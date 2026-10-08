namespace FactuTrust.Application.Features.Accounting.DocumentImport;

/// <summary>
/// Données extraites d'une pièce commerciale (facture de vente ou d'achat) en vue de sa
/// comptabilisation. Modèle unique, quelle que soit la source de l'extraction : parseur natif
/// du gabarit InstaFact ou LLM.
///
/// Distinct de <c>InvoiceImportResultDto</c> (import du wizard de facturation) : la comptabilité
/// a besoin de l'émetteur, de la ventilation TVA par taux telle qu'imprimée, du timbre fiscal,
/// du FODEC et de la retenue à la source — champs que le wizard ignore.
/// </summary>
public sealed record AccountingDocumentExtractionDto
{
    /// <summary>INVOICE, CREDIT_NOTE, PROFORMA, DELIVERY_NOTE ou UNKNOWN.</summary>
    public string DocumentType { get; init; } = DocumentTypes.Invoice;

    public string? DocumentNumber { get; init; }

    public DateOnly? IssueDate { get; init; }

    public DateOnly? DueDate { get; init; }

    /// <summary>Statut imprimé sur la pièce (Brouillon, Validée, Payée…) lorsqu'il est présent.</summary>
    public string? DocumentStatus { get; init; }

    public string Currency { get; init; } = "TND";

    /// <summary>Émetteur de la pièce. Indispensable pour déterminer le sens (vente ou achat).</summary>
    public ExtractedPartyDto? Seller { get; init; }

    /// <summary>Destinataire de la pièce.</summary>
    public ExtractedPartyDto? Buyer { get; init; }

    public IReadOnlyList<ExtractedLineDto> Lines { get; init; } = Array.Empty<ExtractedLineDto>();

    /// <summary>
    /// Ventilation TVA lue telle quelle sur le document (tableau « Taxe / Base imposable / Montant »).
    /// C'est la vérité comptable : la recalculer depuis les lignes dérive au millime dès qu'il y a
    /// des remises. Vide lorsque le document ne l'imprime pas.
    /// </summary>
    public IReadOnlyList<ExtractedVatBucketDto> VatBreakdown { get; init; } = Array.Empty<ExtractedVatBucketDto>();

    public decimal? TotalHt { get; init; }

    public decimal? TotalVat { get; init; }

    public decimal? FodecAmount { get; init; }

    public decimal? FiscalStampAmount { get; init; }

    /// <summary>Retenue à la source détectée. Signalée à l'utilisateur, jamais intégrée à l'écriture.</summary>
    public decimal? WithholdingAmount { get; init; }

    public decimal? TotalTtc { get; init; }

    /// <summary>Auto-évaluation : "high", "medium" ou "low".</summary>
    public string Confidence { get; init; } = "medium";

    public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();

    /// <summary>Voir <see cref="AccountingDocumentExtractionMethods"/>.</summary>
    public string ExtractionMethod { get; init; } = AccountingDocumentExtractionMethods.Unknown;

    public bool OcrApplied { get; init; }

    /// <summary>Vrai lorsque la ventilation TVA a été reconstruite depuis les lignes faute d'être imprimée.</summary>
    public bool VatBreakdownRecomputed { get; init; }
}

/// <summary>Une ligne du tableau de ventilation TVA : un taux, sa base imposable, son montant.</summary>
public sealed record ExtractedVatBucketDto(int RatePercent, decimal BaseAmount, decimal VatAmount);

/// <summary>Une ligne d'article. Best-effort : sert au rapprochement produit et à l'affichage.</summary>
public sealed record ExtractedLineDto
{
    public string Designation { get; init; } = "";
    public string? Reference { get; init; }
    public decimal Quantity { get; init; } = 1m;
    public string? Unit { get; init; }
    public decimal UnitPriceHt { get; init; }
    public decimal? DiscountPercent { get; init; }
    public int VatRatePercent { get; init; } = 19;
    /// <summary>Montant HT de la ligne, remise déduite. Null si non calculable de façon fiable.</summary>
    public decimal? LineTotalHt { get; init; }
}

public sealed record ExtractedPartyDto
{
    public string? Name { get; init; }
    /// <summary>Matricule fiscal tel qu'imprimé (non normalisé).</summary>
    public string? Nif { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Street { get; init; }
    public string? City { get; init; }
    public string? PostalCode { get; init; }
    public string? Governorate { get; init; }
}

public static class DocumentTypes
{
    public const string Invoice = "INVOICE";
    public const string CreditNote = "CREDIT_NOTE";
    public const string Proforma = "PROFORMA";
    public const string DeliveryNote = "DELIVERY_NOTE";
    public const string Unknown = "UNKNOWN";
}

public static class AccountingDocumentExtractionMethods
{
    /// <summary>Parseur déterministe du gabarit InstaFact — exact, sans appel LLM.</summary>
    public const string NativePdf = "native-pdf";

    /// <summary>LLM à partir de la couche texte du document.</summary>
    public const string LlmText = "llm-text";

    /// <summary>LLM en mode vision (document scanné ou photographié).</summary>
    public const string LlmVision = "llm-vision";

    /// <summary>
    /// Service d'extraction documentaire externe (Docstrange). Les montants sont demandés en
    /// chaîne et convertis côté serveur : voir <c>LlmOutputSchemas.AccountingDocumentVerbatim</c>.
    /// </summary>
    public const string ExternalExtraction = "external-extraction";

    public const string Unknown = "";
}
