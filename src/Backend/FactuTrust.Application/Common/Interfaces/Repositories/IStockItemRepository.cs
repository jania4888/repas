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
    /// Sums available quantity (on hand − reserved) per product in the given warehouse for the specified product ids.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, decimal>> GetAvailableQuantityByProductIdsAsync(
        Guid warehouseId,
        IReadOnlyList<Guid> productIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Une page de l'état de stock ET ses totaux, construits en UNE SEULE passe.
    ///
    /// Remplace le couple « lire les lignes » + « compter », qui obligeait les appelants à
    /// reconstruire tout le jeu une seconde fois juste pour sommer. Les totaux sont la somme des
    /// <see cref="StockStatusReportRowDto.StockValue"/> du même jeu : jamais un recalcul
    /// <c>P.U. × Qté</c>, qui serait faux en FIFO/LIFO.
    /// </summary>
    Task<StockStatusReportPage> GetStockStatusReportPageAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        StockStatusGroupingMode groupingMode,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

}

/// <summary>
/// Une page de l'état de stock, avec les totaux du jeu COMPLET (pas de la page) et les compteurs
/// qui permettent à l'écran de n'afficher la légende « P.U. = prochaine sortie » que si elle sert.
/// </summary>
public sealed record StockStatusReportPage(
    IReadOnlyList<StockStatusReportRowDto> Items,
    int TotalCount,
    decimal GrandTotalQuantity,
    decimal GrandTotalValue,
    int LayeredRowCount,
    int DriftRowCount);
