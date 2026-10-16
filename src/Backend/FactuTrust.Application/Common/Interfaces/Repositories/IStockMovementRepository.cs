using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for StockMovement entity (read-only operations mostly).
/// </summary>
public interface IStockMovementRepository : IRepository<StockMovement>
{
    /// <summary>
    /// Gets movements for a stock item with pagination.
    /// </summary>
    Task<(IReadOnlyList<StockMovement> Items, int TotalCount)> GetByStockItemAsync(
        Guid stockItemId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets movements for a product across all warehouses.
    /// </summary>
    Task<IReadOnlyList<StockMovement>> GetByProductAsync(
        Guid productId,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets movements by type and/or reason.
    /// </summary>
    Task<(IReadOnlyList<StockMovement> Items, int TotalCount)> SearchAsync(
        Guid? stockItemId,
        MovementType? type,
        MovementReason? reason,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets movements by reference (e.g., invoice number).
    /// </summary>
    Task<IReadOnlyList<StockMovement>> GetByReferenceAsync(
        string reference,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets exit movement cost information for a set of references and a specific reason (e.g., Sale or Delivery).
    /// This is optimized for reports to avoid N+1 queries by fetching and mapping product identifiers in one query.
    /// </summary>
    Task<IReadOnlyList<StockExitMovementCostRowDto>> GetExitMovementsCostByReferencesAsync(
        IReadOnlyList<string> references,
        MovementReason reason,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets movements for the report (all products) with product and warehouse names, paginated.
    /// </summary>
    Task<(IReadOnlyList<StockMovementReportRowDto> Items, int TotalCount)> GetReportPageAsync(
        Guid? warehouseId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets stock snapshot at a given date (last BalanceAfter per stock item for movements on or before asOfEndOfDayUtc).
    /// </summary>
    Task<IReadOnlyList<StockSnapshotRowDto>> GetStockSnapshotAtDateAsync(
        DateTime asOfEndOfDayUtc,
        Guid? warehouseId,
        CancellationToken cancellationToken = default);

    Task<CountedRows<StockMovementExportRow>> ListForExportAsync(
        Guid? warehouseId,
        DateTime? fromDate,
        DateTime? toDate,
        int maxRows,
        CancellationToken cancellationToken = default);
}
