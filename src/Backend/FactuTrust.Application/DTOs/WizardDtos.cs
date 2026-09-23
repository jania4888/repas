using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

#region Request DTOs

/// <summary>
/// DTO for saving draft progress (partial save).
/// </summary>
public sealed record SaveDraftRequest
{
    public Guid? DraftId { get; init; }
    public int CurrentStep { get; init; }
    public WizardStepMetadataDto? Metadata { get; init; }
    public Guid? SellerId { get; init; }
    public WizardStepClientDto? Client { get; init; }
    public List<WizardStepLineDto>? Lines { get; init; }
    public WizardStepPaymentLegalDto? PaymentLegal { get; init; }
}

/// <summary>
/// DTO for step 1 - Metadata.
/// </summary>
public sealed record WizardStepMetadataDto
{
    public string Type { get; init; } = "INVOICE"; // INVOICE or CREDIT_NOTE
    public DateTime IssueDate { get; init; }
    public DateTime? DueDate { get; init; }
    public string Currency { get; init; } = "TND";
    public string? InternalReference { get; init; }
    public Guid? LinkedInvoiceId { get; init; }
    public Guid? WarehouseId { get; init; }
    public Guid? CashRegisterSessionId { get; init; }
}

/// <summary>
/// DTO for step 3 - Client.
/// </summary>
public sealed record WizardStepClientDto
{
    public Guid? ClientId { get; init; }
    public bool IsNewClient { get; init; }
    public WizardNewClientDto? NewClient { get; init; }
}

/// <summary>
/// DTO for creating a new client within the wizard.
/// </summary>
public sealed record WizardNewClientDto
{
    public string Name { get; init; } = null!;
    public string TaxType { get; init; } = null!; // TAX_SUBJECT, NON_TAX_SUBJECT, TAX_EXEMPT
    public string? Nif { get; init; }
    public WizardAddressDto Address { get; init; } = null!;
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? ContactPerson { get; init; }
}

/// <summary>
/// DTO for address in wizard.
/// </summary>
public sealed record WizardAddressDto
{
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string? PostalCode { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
}

/// <summary>
/// DTO for step 4 - Invoice Line.
/// </summary>
public sealed record WizardStepLineDto
{
    public string? ProductId { get; init; }
    public string Designation { get; init; } = null!;
    public string? Description { get; init; }
    public decimal Quantity { get; init; }
    public string? Unit { get; init; }
    public decimal UnitPriceHT { get; init; }
    /// <summary>True when the user manually set the unit price (bypasses server price resolver on submit).</summary>
    public bool PriceOverridden { get; init; }
    public string? DiscountType { get; init; } // PERCENT or AMOUNT
    public decimal? DiscountValue { get; init; }
    public int VatRate { get; init; } // 0, 7, 13, or 19
    public bool FodecApplicable { get; init; }
}

/// <summary>
/// DTO for step 5 - Payment & Legal.
/// </summary>
public sealed record WizardStepPaymentLegalDto
{
    public string PaymentMethod { get; init; } = null!; // CASH, BANK_TRANSFER, CHECK, CARD, EFFECT
    public string? PaymentTerms { get; init; }
    public int? DaysUntilDue { get; init; }
    public WizardBankInfoDto? BankInfo { get; init; }
    public string? PurchaseOrderRef { get; init; }
    public WizardLegalMentionsDto? LegalMentions { get; init; }
}

/// <summary>
/// DTO for bank information.
/// </summary>
public sealed record WizardBankInfoDto
{
    public string? BankName { get; init; }
    public string? Iban { get; init; }
    public string? Rib { get; init; }
}

/// <summary>
/// DTO for legal mentions.
/// </summary>
public sealed record WizardLegalMentionsDto
{
    public string VatMention { get; init; } = "TVA due par le vendeur";
    public string? ExemptionMention { get; init; }
    public string? CustomMention { get; init; }
}

/// <summary>
/// DTO for final invoice submission.
/// </summary>
public sealed record SubmitInvoiceWizardRequest
{
    public Guid DraftId { get; init; }
    public string IdempotencyKey { get; init; } = null!;
}

#endregion

#region Response DTOs

/// <summary>
/// DTO for draft response.
/// </summary>
public sealed record DraftResponseDto
{
    public Guid Id { get; init; }
    public int CurrentStep { get; init; }
    public bool IsComplete { get; init; }
    public bool IsConverted { get; init; }
    public Guid? ConvertedInvoiceId { get; init; }
    public DateTime LastModifiedAt { get; init; }
    public DateTime ExpiresAt { get; init; }

    // Step data
    public WizardStepMetadataDto? Metadata { get; init; }
    public SellerSummaryDto? Seller { get; init; }
    public WizardClientResponseDto? Client { get; init; }
    public List<WizardLineResponseDto>? Lines { get; init; }
    public WizardStepPaymentLegalDto? PaymentLegal { get; init; }

    // Calculated totals
    public WizardTotalsDto? Totals { get; init; }
}

/// <summary>
/// DTO for seller summary in wizard.
/// </summary>
public sealed record SellerSummaryDto
{
    public Guid Id { get; init; }
    public string CompanyName { get; init; } = null!;
    public string? TradeName { get; init; }
    public string Nif { get; init; } = null!;
    public string? Logo { get; init; }
    public WizardAddressDto Address { get; init; } = null!;
    public string? Email { get; init; }
    public string? Phone { get; init; }
}

/// <summary>
/// DTO for client in wizard response.
/// </summary>
public sealed record WizardClientResponseDto
{
    public Guid? Id { get; init; }
    public bool IsNewClient { get; init; }
    public string Name { get; init; } = null!;
    public string TaxType { get; init; } = null!;
    public string? Nif { get; init; }
    public WizardAddressDto Address { get; init; } = null!;
    public string? Email { get; init; }
    public string? Phone { get; init; }
}

/// <summary>
/// DTO for invoice line in wizard response.
/// </summary>
public sealed record WizardLineResponseDto
{
    public int LineNumber { get; init; }
    public string? ProductId { get; init; }
    public string Designation { get; init; } = null!;
    public string? Description { get; init; }
    public decimal Quantity { get; init; }
    public string? Unit { get; init; }
    public decimal UnitPriceHT { get; init; }
    public string? DiscountType { get; init; }
    public decimal? DiscountValue { get; init; }
    public decimal DiscountAmount { get; init; }
    public int VatRate { get; init; }
    public bool FodecApplicable { get; init; }
    public decimal TotalHT { get; init; }
    public decimal FodecAmount { get; init; }
    public decimal VatAmount { get; init; }
    public decimal TotalTTC { get; init; }
}

/// <summary>
/// DTO for calculated totals.
/// </summary>
public sealed record WizardTotalsDto
{
    public decimal SubTotalHT { get; init; }
    public decimal TotalDiscount { get; init; }
    public decimal TotalHT { get; init; }
    public decimal TotalFodec { get; init; }
    public List<WizardVatBreakdownDto> VatBreakdown { get; init; } = new();
    public decimal TotalVat { get; init; }
    /// <summary>Signed fiscal stamp (e.g. +1 or -1 TND).</summary>
    public decimal FiscalStampAmount { get; init; }
    public decimal TotalTTC { get; init; }
    public string Currency { get; init; } = "TND";
    public decimal FodecRatePercent { get; init; } = 1.0m;
}

/// <summary>
/// DTO for VAT breakdown.
/// </summary>
public sealed record WizardVatBreakdownDto
{
    public int Rate { get; init; }
    public string RateDisplay { get; init; } = null!;
    public decimal BaseAmount { get; init; }
    public decimal VatAmount { get; init; }
}

/// <summary>
/// DTO for validation result.
/// </summary>
public sealed record WizardValidationResultDto
{
    public bool IsValid { get; init; }
    public bool CanProceed { get; init; }
    public int ErrorCount { get; init; }
    public int WarningCount { get; init; }
    public List<WizardValidationCheckDto> Checks { get; init; } = new();
}

/// <summary>
/// DTO for individual validation check.
/// </summary>
public sealed record WizardValidationCheckDto
{
    public string Id { get; init; } = null!;
    public string Category { get; init; } = null!; // LEGAL, FISCAL, CALCULATION, FORMAT
    public string Label { get; init; } = null!;
    public string Description { get; init; } = null!;
    public string Status { get; init; } = null!; // VALID, WARNING, ERROR
    public bool IsBlocking { get; init; }
    public string? Field { get; init; }
}

/// <summary>
/// DTO for next invoice number preview.
/// </summary>
public sealed record NextInvoiceNumberDto
{
    public string Number { get; init; } = null!;
    public string Prefix { get; init; } = null!;
    public int Year { get; init; }
    public int Sequence { get; init; }
}

/// <summary>
/// DTO for invoice creation result.
/// </summary>
public sealed record InvoiceCreatedResultDto
{
    public Guid InvoiceId { get; init; }
    public string InvoiceNumber { get; init; } = null!;
    public string Status { get; init; } = null!;
    public DateTime CreatedAt { get; init; }
}

#endregion

#region Validation Enums

/// <summary>
/// Tunisian VAT rates.
/// </summary>
public static class TunisianVatRates
{
    public const int Exempt = 0;
    public const int Reduced = 7;
    public const int Intermediate = 13;
    public const int Standard = 19;

    public static readonly int[] ValidRates = { Exempt, Reduced, Intermediate, Standard };

    public static bool IsValid(int rate) => ValidRates.Contains(rate);

    public static string GetDescription(int rate) => rate switch
    {
        0 => "Exonéré",
        7 => "Taux réduit",
        13 => "Taux intermédiaire",
        19 => "Taux normal",
        _ => "Inconnu"
    };
}

/// <summary>
/// Client tax types for Tunisia.
/// </summary>
public static class ClientTaxTypes
{
    public const string TaxSubject = "TAX_SUBJECT";
    public const string NonTaxSubject = "NON_TAX_SUBJECT";
    public const string TaxExempt = "TAX_EXEMPT";

    public static bool IsValid(string type) => 
        type is TaxSubject or NonTaxSubject or TaxExempt;

    public static bool RequiresNif(string type) => type == TaxSubject;
}

/// <summary>
/// Payment methods.
/// </summary>
public static class PaymentMethods
{
    public const string Cash = "CASH";
    public const string BankTransfer = "BANK_TRANSFER";
    public const string Check = "CHECK";
    public const string Card = "CARD";
    public const string Effect = "EFFECT";

    public static readonly string[] ValidMethods = { Cash, BankTransfer, Check, Card, Effect };

    public static bool IsValid(string method) => ValidMethods.Contains(method);

    public static string GetDescription(string method) => method switch
    {
        Cash => "Espèces",
        BankTransfer => "Virement bancaire",
        Check => "Chèque",
        Card => "Carte bancaire",
        Effect => "Effet de commerce",
        _ => "Inconnu"
    };
}

#endregion
