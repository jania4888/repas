using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for PurchaseOrder aggregate.
/// </summary>
public interface IPurchaseOrderRepository : IRepository<PurchaseOrder>
{
    /// <summary>
    /// Gets a purchase order by ID with lines and product details.
    /// </summary>
    Task<PurchaseOrder?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets the latest purchase order number for sequence generation.
    /// </summary>
    Task<string?> GetLatestNumberAsync(int year, CancellationToken cancellationToken = default);

    /// <summary>
    /// Searches purchase orders with pagination and filters.
    /// </summary>
    Task<(IReadOnlyList<PurchaseOrder> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        PurchaseOrderStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Aggregated totals over the ENTIRE filtered set (same filters as <see cref="SearchAsync"/>,
    /// without pagination). Powers the purchase order list "totals zone".
    /// </summary>
    Task<PurchaseOrderListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        PurchaseOrderStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets pending purchase orders (Confirmed + PartiallyReceived).
    /// </summary>
    Task<IReadOnlyList<PurchaseOrder>> GetPendingOrdersAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Confirms a draft order atomically in storage to prevent concurrent double confirmation.
    /// Returns false when the order no longer matches confirmation preconditions in persistence.
    /// </summary>
    Task<bool> TryConfirmDraftAsync(Guid id, DateTime confirmedAt, CancellationToken cancellationToken = default);

    Task<HeaderLinesExportData<PurchaseOrderExportRow, PurchaseOrderLineExportRow>> ListForExportAsync(
        string? searchTerm,
        PurchaseOrderStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default);
}
