using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for StockItem aggregate.
/// </summary>
public interface IStockItemRepository : IRepository<StockItem>
{
    /// <summary>
    /// Gets a stock item by product and warehouse.
    /// </summary>
    Task<StockItem?> GetByProductAndWarehouseAsync(
        Guid productId, 
        Guid warehouseId, 
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all stock items for a product across all warehouses.
    /// </summary>
    Task<IReadOnlyList<StockItem>> GetByProductAsync(
        Guid productId, 
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all stock items in a warehouse.
    /// </summary>
    Task<IReadOnlyList<StockItem>> GetByWarehouseAsync(
        Guid warehouseId, 
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets all stock rows for a warehouse, including inactive lines (for physical inventory theoretical quantities).
    /// </summary>
    Task<IReadOnlyList<StockItem>> GetByWarehouseForInventoryAsync(
        Guid warehouseId,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets stock items with low stock (below minimum threshold).
    /// </summary>
    Task<IReadOnlyList<StockItem>> GetLowStockItemsAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets stock items that are out of stock.
    /// </summary>
    Task<IReadOnlyList<StockItem>> GetOutOfStockItemsAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets stock items with their movements (for detailed view).
    /// </summary>
    Task<StockItem?> GetWithMovementsAsync(
        Guid stockItemId,
        int movementLimit = 50,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Searches stock items with pagination.
    /// </summary>
    Task<(IReadOnlyList<StockItem> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        Guid? warehouseId,
        bool? lowStockOnly,
        bool? outOfStockOnly,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets the total stock value across all warehouses or for a specific warehouse.
    /// </summary>
    Task<decimal> GetTotalStockValueAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Sums available quantity (on hand − reserved) per product in the given warehouse for the specified product ids.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, decimal>> GetAvailableQuantityByProductIdsAsync(
        Guid warehouseId,
        IReadOnlyList<Guid> productIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Flat rows for the current stock status report (products × warehouses), with optional filters.
    /// </summary>
    Task<(IReadOnlyList<StockStatusReportRowDto> Items, int TotalCount)> GetStockStatusReportRowsAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        StockStatusGroupingMode groupingMode,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>Count of rows matching stock status filters (for PDF cap).</summary>
    Task<int> CountStockStatusReportRowsAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        CancellationToken cancellationToken = default);
}
