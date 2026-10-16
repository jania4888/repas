using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for SupplierInvoice aggregate.
/// </summary>
public interface ISupplierInvoiceRepository : IRepository<SupplierInvoice>
{
    /// <summary>
    /// Records a payment on a supplier invoice within a single DbContext.
    /// Loads the invoice, applies the payment, and saves in one atomic operation.
    /// </summary>
    Task<Result<RecordPaymentAuditData>> RecordPaymentAsync(
        Guid invoiceId,
        decimal? amount,
        DateTime paymentDate,
        PaymentMethod method,
        string? reference,
        string? notes,
        DateTime? effetDueDate,
        string userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets a supplier invoice by ID with all lines.
    /// </summary>
    Task<SupplierInvoice?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Checks if a supplier invoice already exists for a given purchase order.
    /// </summary>
    Task<bool> ExistsForPurchaseOrderAsync(Guid purchaseOrderId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Checks if a supplier invoice with the given number already exists.
    /// </summary>
    Task<bool> ExistsByInvoiceNumberAsync(string invoiceNumber, CancellationToken cancellationToken = default);

    /// <summary>
    /// Non-cancelled invoices' external references for a supplier (paper invoice numbers).
    /// Used to detect duplicate standalone captures after normalization.
    /// </summary>
    Task<IReadOnlyList<string>> GetNonCancelledExternalReferencesForSupplierAsync(
        Guid supplierId,
        CancellationToken cancellationToken = default);

    Task<(IReadOnlyList<SupplierInvoice> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        SupplierInvoiceStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        Guid? purchaseReceiptId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        bool unpaidOnly = false,
        CancellationToken cancellationToken = default);

    Task<SupplierInvoiceListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        SupplierInvoiceStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        Guid? purchaseReceiptId,
        DateTime? fromDate,
        DateTime? toDate,
        bool unpaidOnly = false,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<LinkedSupplierInvoiceSummaryDto>> GetLinkedSummariesByPurchaseOrderIdAsync(
        Guid purchaseOrderId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<LinkedSupplierInvoiceSummaryDto>> GetLinkedSummariesByPurchaseReceiptIdAsync(
        Guid purchaseReceiptId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Somme de la TVA déductible sur immobilisations (lignes marquées <c>IsFixedAsset</c>) des
    /// factures fournisseur de la période. Quand <paramref name="realizedOnly"/> est vrai, les
    /// factures Annulée sont exclues (même assiette que la TVA déductible de la déclaration). Sert à
    /// isoler la TVA immobilisations depuis la même source que la TVA achats (évite la source croisée
    /// journal 43662).
    /// </summary>
    Task<decimal> SumFixedAssetDeductibleVatAsync(
        DateTime fromDate,
        DateTime toDate,
        bool realizedOnly = false,
        CancellationToken cancellationToken = default);

    /// <summary>Loads a supplier payment with invoice (lines, supplier, payments graph).</summary>
    Task<SupplierPayment?> GetPaymentByIdWithInvoiceAsync(Guid paymentId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Marque un effet fournisseur payé à échéance (dans un seul contexte). Retourne l'id du paiement
    /// et le numéro de facture pour l'audit, ou un échec si le paiement n'est pas une traite en portefeuille.
    /// </summary>
    Task<Result<(Guid PaymentId, string InvoiceNumber)>> SettleEffetAsync(
        Guid paymentId,
        DateTime settlementDate,
        string userId,
        CancellationToken cancellationToken = default);

    /// <summary>Non-cancelled supplier invoices still awaiting full payment (recalculate RS when supplier defaults change).</summary>
    Task<IReadOnlyList<SupplierInvoice>> GetOpenInvoicesForSupplierAsync(
        Guid supplierId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Paid supplier invoices with withholding, <see cref="SupplierInvoice.PaidAt"/> in the given calendar month (TEJ déclaration RS).
    /// </summary>
    Task<IReadOnlyList<SupplierInvoice>> GetPaidWithholdingInvoicesForTejPeriodAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default);

    Task<int> CountPaidWithholdingInvoicesForTejPeriodAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default);

    Task<(int Count, decimal TotalWithheld)> GetPaidWithholdingSummaryForTejPeriodAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default);

    /// <summary>Per-month aggregates for supplier invoices fully paid with RS in <paramref name="year"/> (by <see cref="SupplierInvoice.PaidAt"/>).</summary>
    Task<List<(int Month, int Count, decimal TotalHT, decimal TotalWithheld, decimal TotalNetPaid)>> GetMonthlyWithholdingAggregatesForPaidInvoicesAsync(
        int year,
        CancellationToken cancellationToken = default);

    /// <summary>Supplier withholdings report aggregates grouped by supplier (PaidAt date range).</summary>
    Task<IReadOnlyList<SupplierWithholdingReportRowDto>> GetSupplierWithholdingReportRowsAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    Task<(IReadOnlyList<PurchasesJournalDetailRowDto> Rows, int TotalCount)> GetPurchasesJournalDetailPagedAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PurchasesJournalDetailRowDto>> GetPurchasesJournalDetailAllAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        int maxRows,
        CancellationToken cancellationToken = default);

    Task<PurchasesJournalTotalsDto> GetPurchasesJournalDetailTotalsAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        CancellationToken cancellationToken = default);

    Task<int> CountPurchasesJournalDetailAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PurchasesJournalAggregatedRowDto>> GetPurchasesJournalAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        SalesJournalViewMode groupBy,
        CancellationToken cancellationToken = default);

    Task<HeaderLinesPaymentsExportData<SupplierInvoiceExportRow, SupplierInvoiceLineExportRow, SupplierPaymentExportRow>> ListForExportAsync(
        string? searchTerm,
        SupplierInvoiceStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        bool unpaidOnly,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default);
}
