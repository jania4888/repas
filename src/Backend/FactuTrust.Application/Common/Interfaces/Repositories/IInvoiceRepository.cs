using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for Invoice aggregate.
/// </summary>
public interface IInvoiceRepository : IRepository<Invoice>
{
    /// <summary>
    /// Gets an invoice with all its lines.
    /// </summary>
    Task<Invoice?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets an invoice by its number.
    /// </summary>
    Task<Invoice?> GetByNumberAsync(string number, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all invoices for a client.
    /// </summary>
    Task<IReadOnlyList<Invoice>> GetByClientIdAsync(Guid clientId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets invoices by status.
    /// </summary>
    Task<IReadOnlyList<Invoice>> GetByStatusAsync(InvoiceStatus status, CancellationToken cancellationToken = default);

    /// <summary>
    /// Somme des droits de timbre (FiscalStampAmount) des factures éligibles à la déclaration
    /// (toutes sauf Brouillon et Annulée) émises dans la période. Sert au préremplissage du droit
    /// de timbre de la déclaration mensuelle — même assiette de statuts que la TVA collectée.
    /// </summary>
    Task<decimal> SumFiscalStampAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Somme des montants FODEC (FodecAmount) des factures réalisées émises dans la période.
    /// </summary>
    Task<decimal> SumFodecAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Base imposable FODEC = somme HT (SubTotal) des lignes éligibles (IsFodecApplicable) sur factures réalisées.
    /// </summary>
    Task<decimal> SumFodecTaxableBaseAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets invoices within a date range.
    /// </summary>
    Task<IReadOnlyList<Invoice>> GetByDateRangeAsync(DateTime startDate, DateTime endDate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets invoices within a date range with lines, product and category (for reports).
    /// </summary>
    Task<IReadOnlyList<Invoice>> GetByDateRangeWithLinesAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default);

    /// <summary>
    /// Aggregated sales revenue rows for AI/reporting (SQL GROUP BY, no full invoice graph load).
    /// </summary>
    Task<IReadOnlyList<SalesRevenueReportRowDto>> GetSalesRevenueAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        SalesRevenueGroupBy groupBy,
        CancellationToken cancellationToken = default);

    Task<BasketMetricsReportDto> GetBasketMetricsAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InvoiceProductLineAggregateDto>> GetProductPerformanceAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InvoiceProductPeriodAggregateDto>> GetProductSalesTrendAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    Task<IReadOnlySet<Guid>> GetSoldProductIdsInDateRangeAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CommercialProfitLineSourceDto>> GetCommercialProfitLineSourcesAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Agrège la TVA collectée par taux sur la période. Quand <paramref name="realizedOnly"/> est
    /// vrai, les factures Brouillon et Annulée sont exclues (assiette légale de la déclaration
    /// mensuelle). Défaut false = comportement historique (toutes factures) pour les états de
    /// consultation.
    /// </summary>
    Task<IReadOnlyList<SalesVatReportRowDto>> GetSalesVatAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        bool realizedOnly = false,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<SalesByLineReportRowDto>> GetSalesByLineAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    Task<(IReadOnlyList<SalesJournalDetailRowDto> Rows, int TotalCount)> GetSalesJournalDetailPagedAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? clientId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<SalesJournalDetailRowDto>> GetSalesJournalDetailAllAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? clientId,
        int maxRows,
        CancellationToken cancellationToken = default);

    Task<int> CountSalesJournalDetailAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? clientId,
        CancellationToken cancellationToken = default);

    Task<SalesJournalTotalsDto> GetSalesJournalDetailTotalsAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? clientId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<SalesJournalAggregatedRowDto>> GetSalesJournalAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? clientId,
        SalesJournalViewMode groupBy,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets invoices for report export (by date range and optional client).
    /// </summary>
    Task<IReadOnlyList<Invoice>> GetForReportAsync(
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId = null,
        InvoiceType? type = null,
        // When true, restricts the report to realized revenue documents (Paid + Validated); see
        // InvoiceStatusExtensions.IsRealizedRevenue / frontend REALIZED_REVENUE_STATUSES.
        bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets the next invoice number.
    /// </summary>
    [Obsolete("Use IDocumentNumberService instead.")]
    Task<InvoiceNumber> GetNextNumberAsync(string prefix, int year, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets overdue invoices.
    /// </summary>
    Task<IReadOnlyList<Invoice>> GetOverdueInvoicesAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets invoice count for the current month.
    /// </summary>
    Task<int> GetMonthlyCountAsync(int year, int month, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Searches invoices by various criteria.
    /// </summary>
    Task<(IReadOnlyList<Invoice> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        InvoiceStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int page,
        int pageSize,
        bool unpaidOnly = false,
        InvoiceType? type = null,
        // When true, restricts the list to realized revenue documents (Paid + Validated); see
        // InvoiceStatusExtensions.IsRealizedRevenue / frontend REALIZED_REVENUE_STATUSES.
        bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Aggregated totals over the ENTIRE filtered set (same filters as <see cref="SearchAsync"/>,
    /// without pagination). Powers the invoice list "totals zone" so it reflects the active filters.
    /// </summary>
    Task<InvoiceListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        InvoiceStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        bool unpaidOnly = false,
        InvoiceType? type = null,
        // When true, restricts the summary to realized revenue documents (Paid + Validated); see
        // InvoiceStatusExtensions.IsRealizedRevenue / frontend REALIZED_REVENUE_STATUSES.
        bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Sum of invoice totals (TND) per assigned commercial user and calendar month for a year.
    /// Excludes draft and cancelled invoices. Attribution: client.AssignedUserId.
    /// </summary>
    Task<IReadOnlyDictionary<(Guid UserId, int Month), decimal>> GetAchievedRevenueTndByUserMonthForYearAsync(
        int year,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Somme du TTC commercial (Abs(TotalAmount − FiscalStampAmount)) des avoirs déjà émis
    /// (hors brouillon et annulé) qui rectifient <paramref name="linkedInvoiceId"/>.
    /// </summary>
    Task<decimal> SumIssuedCreditNoteCommercialTtcAsync(
        Guid linkedInvoiceId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Invoice>> GetByCashRegisterSessionIdAsync(
        Guid cashRegisterSessionId,
        CancellationToken cancellationToken = default);
}
