using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// DTO for invoice list/summary.
/// </summary>
public sealed record InvoiceListDto
{
    public Guid Id { get; init; }
    public string Number { get; init; } = null!;
    /// <summary>"INVOICE" for FAC, "CREDIT_NOTE" for AVO.</summary>
    public string Type { get; init; } = "INVOICE";
    /// <summary>Convenience flag derived from Type — true on credit notes (AVO).</summary>
    public bool IsCreditNote { get; init; }
    public DateTime IssueDate { get; init; }
    public DateTime? DueDate { get; init; }
    public string Status { get; init; } = null!;
    public string StatusCssClass { get; init; } = null!;
    public string ClientName { get; init; } = null!;
    /// <summary>Signed total: positive on FAC, negative on AVO.</summary>
    public decimal TotalAmount { get; init; }
    /// <summary>HT signé (négatif pour un avoir), net de remise globale, hors FODEC/TVA/timbre.</summary>
    public decimal SubTotal { get; init; }
    public string Currency { get; init; } = null!;
    public bool IsOverdue { get; init; }
    public DateTime? PaidAt { get; init; }
    public decimal TotalPaid { get; init; }
    /// <summary>Remaining magnitude (always >= 0). For AVO this is the amount still to refund.</summary>
    public decimal RemainingAmount { get; init; }
    public Guid? WarehouseId { get; init; }
    public string? WarehouseName { get; init; }
}

/// <summary>
/// Aggregated totals for an invoice list, computed over the ENTIRE filtered set
/// (not just the current page) so the UI "totals zone" reflects the active filters.
/// </summary>
public sealed record InvoiceListSummaryDto
{
    /// <summary>Number of invoices matching the filters.</summary>
    public int Count { get; init; }
    /// <summary>Sum of signed totals TTC (credit notes reduce the total).</summary>
    public decimal TotalTtc { get; init; }
    /// <summary>Sum of signed totals HT.</summary>
    public decimal TotalHt { get; init; }
    /// <summary>Sum of signed VAT totals.</summary>
    public decimal TotalVat { get; init; }
    /// <summary>Sum of non-refunded payments (net + retenue subie) across the filtered invoices.</summary>
    public decimal TotalPaid { get; init; }
    /// <summary>Sum of per-invoice remaining = max(0, |TTC| - paid), matching the list "Reste à payer" column.</summary>
    public decimal TotalRemaining { get; init; }
    /// <summary>Number of filtered invoices currently overdue.</summary>
    public int OverdueCount { get; init; }
    public string Currency { get; init; } = "TND";
    /// <summary>
    /// Sum of signed HT totals restricted to Paid + Validated documents (see
    /// InvoiceStatusExtensions.IsRealizedRevenue / frontend REALIZED_REVENUE_STATUSES), regardless of
    /// whether the <c>realizedRevenueOnly</c> filter is active. Equals <see cref="TotalHt"/> when it is.
    /// </summary>
    public decimal RealizedRevenueHt { get; init; }
    /// <summary>Sum of signed HT totals for documents of type INVOICE (FAC) among the filtered set.</summary>
    public decimal InvoicesHt { get; init; }
    /// <summary>Sum of signed HT totals for documents of type CREDIT_NOTE (AVO) among the filtered set.</summary>
    public decimal CreditNotesHt { get; init; }
}

/// <summary>
/// Request DTO for recording a payment on a client invoice.
/// </summary>
public sealed record RecordInvoicePaymentRequest
{
    public DateTime PaymentDate { get; init; }
    /// <summary>Montant net encaissé (banque). Si omis avec retenue subie, déduit du restant dû.</summary>
    public decimal? Amount { get; init; }
    public PaymentMethod? Method { get; init; }
    public string? Reference { get; init; }
    public string? Notes { get; init; }
    /// <summary>Retenue à la source subie par le client sur ce paiement (hors fichier TEJ déclarant).</summary>
    public decimal? ClientWithholdingAmount { get; init; }
    /// <summary>Échéance de la traite. Obligatoire lorsque <see cref="Method"/> == Traite.</summary>
    public DateTime? EffetDueDate { get; init; }
    /// <summary>Optional POS cash-register session. When omitted, inherited from the invoice.</summary>
    public Guid? CashRegisterSessionId { get; init; }
}

/// <summary>
/// Requête de règlement d'un effet client à échéance (action « Encaisser l'effet »).
/// </summary>
public sealed record SettleEffetRequest
{
    public DateTime SettlementDate { get; init; }
    /// <summary>Issue du règlement : 1 = encaissé, 2 = impayé.</summary>
    public int Outcome { get; init; }
}

/// <summary>
/// DTO for a payment record.
/// </summary>
public sealed record PaymentDto
{
    public Guid Id { get; init; }
    public decimal Amount { get; init; }
    public string Currency { get; init; } = null!;
    public DateTime PaymentDate { get; init; }
    public int Method { get; init; }
    public string MethodDisplay { get; init; } = null!;
    public string? Reference { get; init; }
    public string? Notes { get; init; }
    public bool IsRefunded { get; init; }
    public DateTime CreatedAt { get; init; }
    public decimal? ClientWithholdingAmount { get; init; }
    public decimal TotalAppliedTowardInvoice { get; init; }
    /// <summary>Échéance de la traite (effet de commerce), si ce paiement en est une.</summary>
    public DateTime? EffetDueDate { get; init; }
    /// <summary>Statut de l'effet (0 En portefeuille, 1 Encaissé, 2 Impayé) ; null si non-traite.</summary>
    public int? EffetStatus { get; init; }
    public string? EffetStatusDisplay { get; init; }
}

/// <summary>
/// DTO for invoice details.
/// </summary>
public sealed record InvoiceDetailDto
{
    public Guid Id { get; init; }
    public string Number { get; init; } = null!;
    /// <summary>"INVOICE" for FAC, "CREDIT_NOTE" for AVO.</summary>
    public string Type { get; init; } = "INVOICE";
    /// <summary>Convenience flag derived from Type — true on credit notes (AVO).</summary>
    public bool IsCreditNote { get; init; }
    public DateTime IssueDate { get; init; }
    public DateTime? DueDate { get; init; }
    public InvoiceStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    
    public Guid ClientId { get; init; }
    public ClientSummaryDto Client { get; init; } = null!;
    
    public string? Reference { get; init; }
    public string? Notes { get; init; }
    public string? PaymentTerms { get; init; }
    
    public IReadOnlyList<InvoiceLineDto> Lines { get; init; } = Array.Empty<InvoiceLineDto>();
    
    public decimal SubTotal { get; init; }
    public decimal? GlobalDiscountPercent { get; init; }
    public decimal GlobalDiscountAmount { get; init; }
    public decimal FodecAmount { get; init; }
    public decimal TotalVat { get; init; }
    /// <summary>Signed fiscal stamp (e.g. +1 or -1 TND on credit notes).</summary>
    public decimal FiscalStampAmount { get; init; }
    public decimal TotalAmount { get; init; }
    public string Currency { get; init; } = null!;
    
    public IReadOnlyList<VatBreakdownDto> VatBreakdown { get; init; } = Array.Empty<VatBreakdownDto>();
    
    public string? SignatureHash { get; init; }
    public DateTime? SignedAt { get; init; }
    public DateTime? SentAt { get; init; }
    public DateTime? PaidAt { get; init; }
    
    public IReadOnlyList<PaymentDto> Payments { get; init; } = Array.Empty<PaymentDto>();
    public decimal TotalPaid { get; init; }
    /// <summary>Remaining magnitude (always >= 0). For AVO this is the amount still to refund.</summary>
    public decimal RemainingAmount { get; init; }
    /// <summary>Somme des retenues subies sur les encaissements (informationnel).</summary>
    public decimal TotalClientWithholding { get; init; }
    
    public Guid? WarehouseId { get; init; }
    public string? WarehouseName { get; init; }

    /// <summary>Facture rectifiée par cet avoir (null hors avoir, ou avoir historique).</summary>
    public Guid? LinkedInvoiceId { get; init; }
    /// <summary>Numéro de la facture rectifiée, pour affichage et impression.</summary>
    public string? LinkedInvoiceNumber { get; init; }

    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

/// <summary>
/// DTO for invoice line.
/// </summary>
public sealed record InvoiceLineDto
{
    public Guid Id { get; init; }
    public int LineNumber { get; init; }
    public Guid? ProductId { get; init; }
    public string ProductCode { get; init; } = null!;
    public string ProductName { get; init; } = null!;
    public string? ProductDescription { get; init; }
    public decimal Quantity { get; init; }
    public string? Unit { get; init; }
    public decimal UnitPrice { get; init; }
    public int VatRatePercent { get; init; }
    public decimal? DiscountPercent { get; init; }
    public Guid? AppliedPromotionId { get; init; }
    public string? AppliedPromotionName { get; init; }
    public decimal DiscountAmount { get; init; }
    public decimal AllocatedGlobalDiscount { get; init; }
    public decimal SubTotal { get; init; }
    public bool IsFodecApplicable { get; init; }
    public decimal FodecAmount { get; init; }
    public decimal VatAmount { get; init; }
    public decimal Total { get; init; }
}

/// <summary>
/// DTO for VAT breakdown.
/// </summary>
public sealed record VatBreakdownDto
{
    public int Rate { get; init; }
    public string RateDisplay { get; init; } = null!;
    public decimal BaseAmount { get; init; }
    public decimal VatAmount { get; init; }
}

/// <summary>
/// DTO for creating an invoice.
/// </summary>
public sealed record CreateInvoiceDto
{
    public Guid ClientId { get; init; }
    public DateTime IssueDate { get; init; }
    public DateTime? DueDate { get; init; }
    public string? Reference { get; init; }
    public string? Notes { get; init; }
    public string? PaymentTerms { get; init; }

    /// <summary>
    /// Condition de règlement structurée à appliquer. Elle produit le texte imprimé et
    /// l'échéance ; <c>PaymentTerms</c> et <c>DueDate</c> saisis à la main restent prioritaires.
    /// </summary>
    public Guid? PaymentTermTemplateId { get; init; }
    public Guid? WarehouseId { get; init; }
    public IReadOnlyList<CreateInvoiceLineDto> Lines { get; init; } = Array.Empty<CreateInvoiceLineDto>();
}

/// <summary>
/// DTO for creating an invoice line.
/// </summary>
public sealed record CreateInvoiceLineDto
{
    public Guid ProductId { get; init; }
    public decimal Quantity { get; init; }
    public decimal? CustomUnitPrice { get; init; }
    public decimal? DiscountPercent { get; init; }
}

/// <summary>
/// DTO for updating an invoice.
/// </summary>
public sealed record UpdateInvoiceDto
{
    public DateTime? DueDate { get; init; }
    public string? Reference { get; init; }
    public string? Notes { get; init; }
    public string? PaymentTerms { get; init; }
}
