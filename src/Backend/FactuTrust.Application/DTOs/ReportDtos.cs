using FactuTrust.Application.Features.Reports;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// One row in the client payments report (encaissements).
/// </summary>
public sealed record ClientPaymentReportRowDto
{
    public Guid PaymentId { get; init; }
    public DateTime PaymentDate { get; init; }
    public string ClientName { get; init; } = null!;
    public Guid InvoiceId { get; init; }
    public string InvoiceNumber { get; init; } = null!;
    public decimal Amount { get; init; }
    public string Currency { get; init; } = null!;
    public string MethodDisplay { get; init; } = null!;
    public string? Reference { get; init; }
}

/// <summary>Projected client payment row before display-string mapping.</summary>
public sealed record ClientPaymentReportSourceDto
{
    public Guid PaymentId { get; init; }
    public DateTime PaymentDate { get; init; }
    public string ClientName { get; init; } = null!;
    public Guid InvoiceId { get; init; }
    public string InvoiceNumber { get; init; } = null!;
    public decimal Amount { get; init; }
    public string Currency { get; init; } = null!;
    public int Method { get; init; }
    public string? Reference { get; init; }
}

/// <summary>
/// One row in the supplier payments report (décaissements).
/// </summary>
public sealed record SupplierPaymentReportRowDto
{
    public Guid PaymentId { get; init; }
    public DateTime PaymentDate { get; init; }
    public string SupplierName { get; init; } = null!;
    public Guid SupplierInvoiceId { get; init; }
    public string InvoiceNumber { get; init; } = null!;
    public decimal Amount { get; init; }
    public string Currency { get; init; } = null!;
    public string MethodDisplay { get; init; } = null!;
    public string? Reference { get; init; }
}

/// <summary>
/// One row in the client transactions report (factures + paiements).
/// </summary>
public sealed record ClientTransactionReportRowDto
{
    public DateTime Date { get; init; }
    public string TransactionType { get; init; } = null!; // "Facture" or "Paiement"
    public string ClientName { get; init; } = null!;
    public string Reference { get; init; } = null!; // Invoice number or payment ref
    public decimal Amount { get; init; }
    public string Currency { get; init; } = null!;
    public Guid? InvoiceId { get; init; }
    public Guid? PaymentId { get; init; }
}

/// <summary>
/// One row in the supplier transactions report.
/// </summary>
public sealed record SupplierTransactionReportRowDto
{
    public DateTime Date { get; init; }
    public string TransactionType { get; init; } = null!; // "Facture fournisseur" or "Paiement"
    public string SupplierName { get; init; } = null!;
    public string Reference { get; init; } = null!;
    public decimal Amount { get; init; }
    public string Currency { get; init; } = null!;
    public Guid? SupplierInvoiceId { get; init; }
    public Guid? PaymentId { get; init; }
}

/// <summary>One line in the commercial sales journal (detail mode).</summary>
public sealed record SalesJournalDetailRowDto
{
    public DateTime IssueDate { get; init; }
    public Guid InvoiceId { get; init; }
    public string InvoiceNumber { get; init; } = null!;
    public string DocumentType { get; init; } = null!;
    public Guid ClientId { get; init; }
    public string ClientName { get; init; } = null!;
    public Guid? ProductId { get; init; }
    public string ProductCode { get; init; } = null!;
    public string ProductName { get; init; } = null!;
    public string? CategoryName { get; init; }
    public decimal Quantity { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal LineSubTotal { get; init; }
    public decimal LineTotal { get; init; }
    public decimal VatAmount { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>Aggregated sales journal row (day / month / year).</summary>
public sealed record SalesJournalAggregatedRowDto
{
    public string PeriodKey { get; init; } = null!;
    public Guid ClientId { get; init; }
    public string ClientName { get; init; } = null!;
    public Guid? ProductId { get; init; }
    public string ProductCode { get; init; } = null!;
    public string ProductName { get; init; } = null!;
    public decimal Quantity { get; init; }
    public decimal LineSubTotal { get; init; }
    public decimal LineTotal { get; init; }
    public decimal VatAmount { get; init; }
    public string Currency { get; init; } = null!;
}

public sealed record SalesJournalTotalsDto
{
    public decimal Quantity { get; init; }
    public decimal LineSubTotal { get; init; }
    public decimal LineTotal { get; init; }
    public decimal VatAmount { get; init; }
    public string Currency { get; init; } = null!;
}

public sealed record SalesJournalReportResultDto
{
    public required string ViewMode { get; init; }
    public DateTime From { get; init; }
    public DateTime To { get; init; }
    public Guid? ClientId { get; init; }
    public int TotalRows { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
    public SalesJournalTotalsDto Totals { get; init; } = null!;
    public IReadOnlyList<SalesJournalDetailRowDto> DetailRows { get; init; } = Array.Empty<SalesJournalDetailRowDto>();
    public IReadOnlyList<SalesJournalAggregatedRowDto> AggregatedRows { get; init; } = Array.Empty<SalesJournalAggregatedRowDto>();
}

public sealed record SalesJournalPdfContext(
    string Title,
    string ViewModeLabel,
    DateTime From,
    DateTime To,
    string? ClientName,
    string? CompanyName,
    string? MatriculeFiscal,
    SalesJournalViewMode ViewMode,
    IReadOnlyList<SalesJournalDetailRowDto> DetailRows,
    IReadOnlyList<SalesJournalAggregatedRowDto> AggregatedRows,
    SalesJournalTotalsDto Totals);

/// <summary>
/// One row in the sales-by-line report (details ventes par ligne produit).
/// </summary>
public sealed record SalesByLineReportRowDto
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string? CategoryName { get; init; }
    public decimal Quantity { get; init; }
    public decimal Revenue { get; init; }
    public decimal VatAmount { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the sales VAT report (TVA ventes).
/// </summary>
public sealed record SalesVatReportRowDto
{
    public int VatRatePercent { get; init; }
    public string VatRateDisplay { get; init; } = null!;
    public decimal TotalVatAmount { get; init; }
    public decimal TotalTaxableAmount { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the sales revenue by product/category/client report.
/// </summary>
public sealed record SalesRevenueReportRowDto
{
    public string GroupKey { get; init; } = null!; // Product name, Category name, or "ProductName - ClientName"
    public string? GroupKey2 { get; init; } // Optional second dimension (e.g. client name when grouping by product)
    public decimal Revenue { get; init; }
    public decimal Quantity { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the purchases-by-line report.
/// </summary>
public sealed record PurchasesByLineReportRowDto
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string SupplierName { get; init; } = null!;
    public decimal Quantity { get; init; }
    public decimal AmountTTC { get; init; }
    public decimal VatAmount { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the purchases VAT report (TVA achats).
/// </summary>
public sealed record PurchasesVatReportRowDto
{
    public int VatRatePercent { get; init; }
    public string VatRateDisplay { get; init; } = null!;
    public decimal TotalVatAmount { get; init; }
    public decimal TotalTaxableAmount { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the client balances report (soldes client).
/// </summary>
public sealed record ClientBalanceReportRowDto
{
    public Guid ClientId { get; init; }
    public string ClientName { get; init; } = null!;
    public decimal TotalInvoiced { get; init; }
    public decimal TotalPaid { get; init; }
    public decimal Balance { get; init; }
    public string Currency { get; init; } = null!;

    /// <summary>
    /// Balance âgée commerciale (lot 6) — ventilation du <see cref="Balance"/> par ancienneté
    /// à partir de <c>DueDate</c>. Sans échéance, le reste bascule dans <see cref="NotDue"/> :
    /// pas d'échéance = pas encore exigible.
    ///
    /// C'est un cockpit de recouvrement commercial. À ne pas confondre avec la balance âgée
    /// comptable (<c>/accounting/aging</c>), alimentée par le lettrage : elles peuvent diverger
    /// tant qu'un règlement reçu n'est pas encore lettré.
    /// </summary>
    public decimal NotDue { get; init; }

    /// <summary>Échu depuis 1 à 30 jours.</summary>
    public decimal Bucket0To30 { get; init; }

    /// <summary>Échu depuis 31 à 60 jours.</summary>
    public decimal Bucket31To60 { get; init; }

    /// <summary>Échu depuis 61 à 90 jours.</summary>
    public decimal Bucket61To90 { get; init; }

    /// <summary>Échu depuis plus de 90 jours — le signal qui appelle une action ferme.</summary>
    public decimal BucketOver90 { get; init; }
}

/// <summary>
/// One row in the supplier balances report (soldes fournisseur).
/// </summary>
public sealed record SupplierBalanceReportRowDto
{
    public Guid SupplierId { get; init; }
    public string SupplierName { get; init; } = null!;
    public decimal TotalInvoiced { get; init; }
    public decimal TotalPaid { get; init; }
    public decimal Balance { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the client withholdings report (retenues subies par client).
/// </summary>
public sealed record ClientWithholdingReportRowDto
{
    public Guid ClientId { get; init; }
    public string ClientName { get; init; } = null!;
    public int PaymentCount { get; init; }
    public decimal TotalWithholding { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the supplier withholdings report (retenues pratiquées par fournisseur).
/// </summary>
public sealed record SupplierWithholdingReportRowDto
{
    public Guid SupplierId { get; init; }
    public string SupplierName { get; init; } = null!;
    public int InvoiceCount { get; init; }
    public decimal TotalHT { get; init; }
    public decimal TotalWithholding { get; init; }
    public decimal TotalNetPaid { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the stock movements report (mouvement détaillé de stock).
/// </summary>
public sealed record StockMovementReportRowDto
{
    public Guid Id { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string WarehouseName { get; init; } = null!;
    public string TypeDisplay { get; init; } = null!;
    public string ReasonDisplay { get; init; } = null!;
    public decimal Quantity { get; init; }
    public decimal UnitCost { get; init; }
    public string? Reference { get; init; }
    public DateTime OccurredAt { get; init; }
}

/// <summary>
/// One row in the stock snapshot report (état de stock à une date antérieure).
/// </summary>
public sealed record StockSnapshotRowDto
{
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string WarehouseName { get; init; } = null!;
    public decimal Quantity { get; init; }
    public decimal UnitCost { get; init; }
    public decimal TotalValue { get; init; }
}

/// <summary>
/// One row in the commercial profit report (bénéfice par ligne, produit ou mois).
/// </summary>
public sealed record CommercialProfitReportRowDto
{
    public Guid? ProductId { get; init; }
    public string? ProductName { get; init; }
    public string? ProductCode { get; init; }
    public string? InvoiceNumber { get; init; }
    public DateTime? IssueDate { get; init; }
    public string? Period { get; init; }
    public decimal Quantity { get; init; }
    public decimal Revenue { get; init; }
    public decimal Cost { get; init; }
    public decimal Profit { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the product sales trend report (évolution ventes par produit par mois).
/// </summary>
public sealed record ProductSalesTrendRowDto
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string? CategoryName { get; init; }
    public string Period { get; init; } = null!;
    public decimal Quantity { get; init; }
    public decimal Revenue { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the product performance report (classement avec marge et part du CA).
/// </summary>
public sealed record ProductPerformanceReportRowDto
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string? CategoryName { get; init; }
    public decimal QuantitySold { get; init; }
    public decimal Revenue { get; init; }
    public decimal UnitCost { get; init; }
    public decimal TotalCost { get; init; }
    public decimal Profit { get; init; }
    public decimal? MarginPercent { get; init; }
    public decimal RevenueSharePercent { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// One row in the products never sold report (produits actifs sans vente sur la période).
/// </summary>
public sealed record ProductNeverSoldReportRowDto
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string? CategoryName { get; init; }
    public decimal UnitPrice { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>
/// Basket metrics report (panier moyen et lignes par facture).
/// </summary>
public sealed record BasketMetricsReportDto
{
    public int TotalInvoices { get; init; }
    public decimal TotalRevenue { get; init; }
    public int TotalLines { get; init; }
    public decimal AverageBasket { get; init; }
    public decimal AverageLinesPerInvoice { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>SQL aggregate row for product-level invoice line reports (performance, trends).</summary>
public sealed record InvoiceProductLineAggregateDto
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string? CategoryName { get; init; }
    public decimal Quantity { get; init; }
    public decimal Revenue { get; init; }
    public decimal TotalCost { get; init; }
    public string Currency { get; init; } = null!;
}

/// <summary>Projected invoice line for commercial profit (no full aggregate load).</summary>
public sealed record CommercialProfitLineSourceDto
{
    public Guid InvoiceId { get; init; }
    public string InvoiceNumber { get; init; } = null!;
    public DateTime IssueDate { get; init; }
    public string? Reference { get; init; }
    public Guid? ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public decimal Quantity { get; init; }
    public decimal Revenue { get; init; }
    public string Currency { get; init; } = null!;
    public decimal FallbackUnitCost { get; init; }
}

/// <summary>SQL aggregate row for product sales by calendar month.</summary>
public sealed record InvoiceProductPeriodAggregateDto
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = null!;
    public string ProductCode { get; init; } = null!;
    public string? CategoryName { get; init; }
    public int Year { get; init; }
    public int Month { get; init; }
    public decimal Quantity { get; init; }
    public decimal Revenue { get; init; }
    public string Currency { get; init; } = null!;
}
