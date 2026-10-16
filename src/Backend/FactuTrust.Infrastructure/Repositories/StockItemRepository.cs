using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for StockItem aggregate.
/// </summary>
public sealed partial class StockItemRepository : IStockItemRepository
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly StockTraceabilityOptions _options;

    public StockItemRepository(
        ITenantDbContextFactory contextFactory,
        IOptions<StockTraceabilityOptions> options)
    {
        _contextFactory = contextFactory;
        _options = options.Value;
    }

    public async Task<StockItem?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
    }

    public async Task<StockItem?> GetByProductAndWarehouseAsync(
        Guid productId,
        Guid warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .FirstOrDefaultAsync(s => s.ProductId == productId && s.WarehouseId == warehouseId, cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetByProductAsync(
        Guid productId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.ProductId == productId)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetByWarehouseAsync(
        Guid warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.WarehouseId == warehouseId && s.IsActive)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetByWarehouseForInventoryAsync(
        Guid warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.WarehouseId == warehouseId)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetLowStockItemsAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.StockItems
            .Where(s => s.IsActive && s.QuantityOnHand <= s.MinimumStock && s.QuantityOnHand > 0);

        if (warehouseId.HasValue)
            query = query.Where(s => s.WarehouseId == warehouseId.Value);

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetOutOfStockItemsAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.StockItems
            .Where(s => s.IsActive && s.QuantityOnHand == 0);

        if (warehouseId.HasValue)
            query = query.Where(s => s.WarehouseId == warehouseId.Value);

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<StockItem?> GetWithMovementsAsync(
        Guid stockItemId,
        int movementLimit = 50,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // Get stock item with recent movements
        var stockItem = await context.StockItems
            .Include(s => s.Movements.OrderByDescending(m => m.OccurredAt).Take(movementLimit))
            .FirstOrDefaultAsync(s => s.Id == stockItemId, cancellationToken);

        return stockItem;
    }

    public async Task<(IReadOnlyList<StockItem> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        Guid? warehouseId,
        bool? lowStockOnly,
        bool? outOfStockOnly,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.StockItems
            .Where(s => s.IsActive)
            .AsQueryable();

        if (warehouseId.HasValue)
            query = query.Where(s => s.WarehouseId == warehouseId.Value);

        if (lowStockOnly == true)
            query = query.Where(s => s.QuantityOnHand <= s.MinimumStock && s.QuantityOnHand > 0);

        if (outOfStockOnly == true)
            query = query.Where(s => s.QuantityOnHand == 0);

        // Note: searchTerm would need to join with Products table for product name search
        // This is a simplified implementation

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderBy(s => s.ProductId)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<IReadOnlyDictionary<Guid, decimal>> GetAvailableQuantityByProductIdsAsync(
        Guid warehouseId,
        IReadOnlyList<Guid> productIds,
        CancellationToken cancellationToken = default)
    {
        if (productIds.Count == 0)
            return new Dictionary<Guid, decimal>();

        await using var context = _contextFactory.CreateContext();

        var rows = await context.StockItems
            .AsNoTracking()
            .Where(s => s.WarehouseId == warehouseId && s.IsActive && productIds.Contains(s.ProductId))
            .Select(s => new { s.ProductId, Available = s.QuantityOnHand - s.QuantityReserved })
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(r => r.ProductId)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Available));
    }

    public async Task<IReadOnlyList<StockItem>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.IsActive)
            .ToListAsync(cancellationToken);
    }

    public async Task<StockItem> AddAsync(StockItem entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StockItems.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(StockItem entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // Fetch existing stock item from DB to get tracked entity
        var existingItem = await context.StockItems
            .Include(s => s.Movements)
            .FirstOrDefaultAsync(s => s.Id == entity.Id, cancellationToken);
        
        if (existingItem == null)
        {
            throw new InvalidOperationException($"StockItem with Id {entity.Id} not found for update.");
        }
        
        // Update scalar properties from the passed entity
        context.Entry(existingItem).CurrentValues.SetValues(entity);
        
        // Handle new movements (those not in existing movements)
        var existingMovementIds = existingItem.Movements.Select(m => m.Id).ToHashSet();
        foreach (var movement in entity.Movements)
        {
            if (!existingMovementIds.Contains(movement.Id))
            {
                // New movement - add directly to the context
                context.StockMovements.Add(movement);
            }
        }
        
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(StockItem entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // Attach the entity before removing - entity may be from a different context
        context.StockItems.Attach(entity);
        context.StockItems.Remove(entity);
        
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems.AnyAsync(s => s.Id == id, cancellationToken);
    }

    public async Task<StockStatusReportPage> GetStockStatusReportPageAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        StockStatusGroupingMode groupingMode,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        // UNE seule construction du jeu : les totaux sortent des mêmes lignes que la page.
        var rows = await BuildStockStatusRowsAsync(
            warehouseId, categoryId, search, includeZeroStock, cancellationToken);
        rows = SortStockStatusRows(rows, groupingMode);

        var paged = rows
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToList();

        return new StockStatusReportPage(
            paged,
            rows.Count,
            rows.Sum(r => r.QuantityOnHand),
            // La somme des valeurs déjà calculées, jamais un recalcul P.U. × Qté : en FIFO/LIFO le
            // P.U. est un coût de prochaine sortie, le produit serait faux. Le TTC suit la même
            // règle : somme des lignes, jamais le total HT multiplié par un taux moyen.
            rows.Sum(r => r.StockValue),
            rows.Count(r => r.UnitCostIsNextExit),
            rows.Count(r => r.QuantityDrift),
            rows.Sum(r => r.StockValueTtc));
    }

    private async Task<List<StockStatusReportRowDto>> BuildStockStatusRowsAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        CancellationToken cancellationToken)
    {
        await using var context = _contextFactory.CreateContext();

        var query =
            from s in context.StockItems.AsNoTracking()
            join p in context.Products.AsNoTracking() on s.ProductId equals p.Id
            join w in context.Warehouses.AsNoTracking() on s.WarehouseId equals w.Id
            join c in context.ProductCategories.AsNoTracking() on p.CategoryId equals c.Id into categoryJoin
            from c in categoryJoin.DefaultIfEmpty()
            where s.IsActive && p.IsActive && p.IsStockManaged && w.IsActive
            select new { s, p, w, c };

        if (warehouseId.HasValue)
            query = query.Where(x => x.s.WarehouseId == warehouseId.Value);

        if (categoryId.HasValue)
            query = query.Where(x => x.p.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(x =>
                EF.Functions.Like(x.p.Name, $"%{term}%") ||
                EF.Functions.Like(x.p.Code, $"%{term}%"));
        }

        if (!includeZeroStock)
            query = query.Where(x => x.s.QuantityOnHand > 0);

        var raw = await query
            .Select(x => new StockStatusRawRow
            {
                StockItemId = x.s.Id,
                ProductId = x.p.Id,
                ProductCode = x.p.Code,
                ProductName = x.p.Name,
                CategoryId = x.p.CategoryId,
                CategoryName = x.c != null ? x.c.Name : StockStatusReportConstants.UncategorizedLabel,
                WarehouseId = x.w.Id,
                WarehouseCode = x.w.Code,
                WarehouseName = x.w.Name,
                QuantityOnHand = x.s.QuantityOnHand,
                AverageCost = x.s.AverageCost,
                CostingMethod = x.p.CostingMethod,
                VatRate = x.p.VatRate
            })
            .ToListAsync(cancellationToken);

        // UNE seule requête supplémentaire, restreinte côté serveur par la jointure Products —
        // donc pas de liste d'identifiants en paramètres, et aucun rapport avec la taille de page.
        // Drapeau à false ⇒ dictionnaire vide et AUCUNE requête émise : l'écran est alors
        // identique au bit près à ce qu'il était avant ce chantier.
        var aggregates = await LoadLayerAggregatesAsync(
            context, warehouseId, categoryId, search, cancellationToken);

        var fromStockItems = raw.Select(r => ToRow(r, aggregates)).ToList();

        if (!includeZeroStock || !warehouseId.HasValue)
        {
            LocalizeUncategorized(fromStockItems);
            return fromStockItems;
        }

        var warehouse = await context.Warehouses.AsNoTracking()
            .FirstOrDefaultAsync(w => w.Id == warehouseId.Value && w.IsActive, cancellationToken);
        if (warehouse is null)
        {
            LocalizeUncategorized(fromStockItems);
            return fromStockItems;
        }

        var existingProductIds = fromStockItems.Select(r => r.ProductId).ToHashSet();

        var missingProductsQuery =
            from p in context.Products.AsNoTracking()
            join c in context.ProductCategories.AsNoTracking() on p.CategoryId equals c.Id into categoryJoin
            from c in categoryJoin.DefaultIfEmpty()
            where p.IsActive && p.IsStockManaged
                  && !existingProductIds.Contains(p.Id)
                  && !context.StockItems.Any(s =>
                      s.IsActive && s.ProductId == p.Id && s.WarehouseId == warehouse.Id)
            select new { p, c };

        if (categoryId.HasValue)
            missingProductsQuery = missingProductsQuery.Where(x => x.p.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            missingProductsQuery = missingProductsQuery.Where(x =>
                EF.Functions.Like(x.p.Name, $"%{term}%") ||
                EF.Functions.Like(x.p.Code, $"%{term}%"));
        }

        // Le taux est appliqué en mémoire : PurchaseStockValueTtc n'est pas traduisible en SQL.
        var missingRows = (await missingProductsQuery
            .Select(x => new
            {
                ProductId = x.p.Id,
                ProductCode = x.p.Code,
                ProductName = x.p.Name,
                CategoryId = x.p.CategoryId,
                CategoryName = x.c != null ? x.c.Name : StockStatusReportConstants.UncategorizedLabel,
                VatRate = x.p.VatRate,
                CostingMethod = x.p.CostingMethod
            })
            .ToListAsync(cancellationToken))
            .Select(x => new StockStatusReportRowDto
            {
                ProductId = x.ProductId,
                ProductCode = x.ProductCode,
                ProductName = x.ProductName,
                CategoryId = x.CategoryId,
                CategoryName = x.CategoryName,
                WarehouseId = warehouse.Id,
                WarehouseCode = warehouse.Code,
                WarehouseName = warehouse.Name,
                QuantityOnHand = 0,
                UnitCost = 0,
                StockValue = 0,
                VatRatePercent = PurchaseStockValueTtc.Percent(x.VatRate),
                StockValueTtc = PurchaseStockValueTtc.FromHt(0m, x.VatRate),
                // Ces produits n'ont aucun article de stock dans l'entrepôt : ni couche, ni coût.
                // La méthode reste celle de la fiche, pour que le badge de l'écran reste cohérent.
                CostingMethod = x.CostingMethod,
                UnitCostIsNextExit = false,
                HasValuationLayers = false,
                QuantityDrift = false
            })
            .ToList();
        fromStockItems.AddRange(missingRows);
        LocalizeUncategorized(fromStockItems);
        return fromStockItems;
    }

    /// <summary>
    /// Le SQL conserve le libellé français historique. La traduction n'est appliquée qu'en mémoire,
    /// après lecture, et seulement quand l'interface est en arabe.
    ///
    /// ⚠️ Cette méthode RECOPIE la ligne champ à champ. Tout champ ajouté à
    /// <see cref="StockStatusReportRowDto"/> doit être repris ici, sinon il est perdu
    /// EN ARABE UNIQUEMENT — sans qu'aucun test français ne le voie.
    /// </summary>
    private static void LocalizeUncategorized(List<StockStatusReportRowDto> rows)
    {
        if (!StockStatusLabels.IsArabic)
            return;

        var label = StockStatusLabels.Uncategorized();
        for (var i = 0; i < rows.Count; i++)
        {
            if (rows[i].CategoryName != StockStatusReportConstants.UncategorizedLabel)
                continue;

            var row = rows[i];
            rows[i] = new StockStatusReportRowDto
            {
                ProductId = row.ProductId,
                ProductCode = row.ProductCode,
                ProductName = row.ProductName,
                CategoryId = row.CategoryId,
                CategoryName = label,
                WarehouseId = row.WarehouseId,
                WarehouseCode = row.WarehouseCode,
                WarehouseName = row.WarehouseName,
                QuantityOnHand = row.QuantityOnHand,
                UnitCost = row.UnitCost,
                StockValue = row.StockValue,
                VatRatePercent = row.VatRatePercent,
                StockValueTtc = row.StockValueTtc,
                CostingMethod = row.CostingMethod,
                UnitCostIsNextExit = row.UnitCostIsNextExit,
                HasValuationLayers = row.HasValuationLayers,
                QuantityDrift = row.QuantityDrift
            };
        }
    }

    /// <summary>
    /// Les agrégats de couches, en UNE instruction SQL restreinte aux articles réellement valorisés
    /// par couches.
    ///
    /// La restriction se fait par la jointure sur Products, et non par une liste d'identifiants :
    /// pas de plafond des 2100 paramètres de SQL Server, et le coût ne dépend pas de la pagination.
    ///
    /// Les DEUX frontières (plus ancienne et plus récente) reviennent dans la même ligne : un seul
    /// aller-retour sert FIFO et LIFO, et le choix se fait en mémoire, là où la méthode est connue.
    /// Le départage par Id reprend celui du moteur de consommation — sans lui, deux réceptions de
    /// la même milliseconde seraient confondues et l'écran annoncerait une « prochaine sortie »
    /// que le moteur ne choisirait pas.
    ///
    /// Pas de ROW_NUMBER ni de SQL brut : les tests tournent sur le fournisseur en mémoire, qui ne
    /// les traduit pas. Les sous-requêtes corrélées, elles, sont évaluées par les deux.
    /// </summary>
    private async Task<Dictionary<Guid, LayerAggregate>> LoadLayerAggregatesAsync(
        TenantDbContext context,
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        CancellationToken cancellationToken)
    {
        if (!_options.FifoLifoValuationEnabled)
            return new Dictionary<Guid, LayerAggregate>();

        var query =
            from s in context.StockItems.AsNoTracking()
            join p in context.Products.AsNoTracking() on s.ProductId equals p.Id
            where s.IsActive && p.IsActive && p.IsStockManaged
                  && (p.CostingMethod == CostingMethod.Fifo || p.CostingMethod == CostingMethod.Lifo)
            select new { s, p };

        if (warehouseId.HasValue)
            query = query.Where(x => x.s.WarehouseId == warehouseId.Value);

        if (categoryId.HasValue)
            query = query.Where(x => x.p.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(x =>
                EF.Functions.Like(x.p.Name, $"%{term}%") ||
                EF.Functions.Like(x.p.Code, $"%{term}%"));
        }

        var rows = await query
            .Select(x => new LayerAggregate
            {
                StockItemId = x.s.Id,
                LayerCount = context.StockValuationLayers
                    .Count(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0),
                LayerQuantity = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .Sum(l => (decimal?)l.RemainingQuantity) ?? 0m,
                LayerValue = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .Sum(l => (decimal?)(l.RemainingQuantity * l.UnitCost)) ?? 0m,
                FirstInUnitCost = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .OrderBy(l => l.ReceivedAt).ThenBy(l => l.Id)
                    .Select(l => (decimal?)l.UnitCost).FirstOrDefault(),
                LastInUnitCost = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .OrderByDescending(l => l.ReceivedAt).ThenByDescending(l => l.Id)
                    .Select(l => (decimal?)l.UnitCost).FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        return rows.ToDictionary(r => r.StockItemId);
    }

    /// <summary>
    /// La projection finale d'une ligne : c'est <see cref="StockValuation"/> qui décide, jamais
    /// une formule locale. Un article sans agrégat (CMUP, ou drapeau à false) retombe sur le cache.
    /// </summary>
    private StockStatusReportRowDto ToRow(
        StockStatusRawRow raw,
        IReadOnlyDictionary<Guid, LayerAggregate> aggregates)
    {
        aggregates.TryGetValue(raw.StockItemId, out var aggregate);

        var snapshot = StockValuation.FromAggregate(
            raw.CostingMethod,
            layered: _options.RequiresLayeredCosting(raw.CostingMethod),
            raw.QuantityOnHand,
            raw.AverageCost,
            aggregate?.LayerQuantity ?? 0m,
            aggregate?.LayerValue ?? 0m,
            aggregate?.FirstInUnitCost,
            aggregate?.LastInUnitCost,
            hasLayers: (aggregate?.LayerCount ?? 0) > 0);

        return new StockStatusReportRowDto
        {
            ProductId = raw.ProductId,
            ProductCode = raw.ProductCode,
            ProductName = raw.ProductName,
            CategoryId = raw.CategoryId,
            CategoryName = raw.CategoryName,
            WarehouseId = raw.WarehouseId,
            WarehouseCode = raw.WarehouseCode,
            WarehouseName = raw.WarehouseName,
            QuantityOnHand = snapshot.QuantityOnHand,
            UnitCost = snapshot.UnitCost,
            StockValue = snapshot.StockValue,
            VatRatePercent = PurchaseStockValueTtc.Percent(raw.VatRate),
            StockValueTtc = PurchaseStockValueTtc.FromHt(snapshot.StockValue, raw.VatRate),
            CostingMethod = snapshot.CostingMethod,
            UnitCostIsNextExit = snapshot.UnitCostIsNextExit,
            HasValuationLayers = snapshot.HasLayers,
            QuantityDrift = snapshot.QuantityDrift
        };
    }

    private sealed class StockStatusRawRow
    {
        public Guid StockItemId { get; init; }
        public Guid ProductId { get; init; }
        public string ProductCode { get; init; } = null!;
        public string ProductName { get; init; } = null!;
        public Guid? CategoryId { get; init; }
        public string CategoryName { get; init; } = null!;
        public Guid WarehouseId { get; init; }
        public string WarehouseCode { get; init; } = null!;
        public string WarehouseName { get; init; } = null!;
        public decimal QuantityOnHand { get; init; }
        public decimal AverageCost { get; init; }
        public CostingMethod CostingMethod { get; init; }
        public VatRate VatRate { get; init; }
    }

    private sealed class LayerAggregate
    {
        public Guid StockItemId { get; init; }
        public int LayerCount { get; init; }
        public decimal LayerQuantity { get; init; }
        public decimal LayerValue { get; init; }
        public decimal? FirstInUnitCost { get; init; }
        public decimal? LastInUnitCost { get; init; }
    }

    private static List<StockStatusReportRowDto> SortStockStatusRows(
        List<StockStatusReportRowDto> rows,
        StockStatusGroupingMode groupingMode)
    {
        return groupingMode == StockStatusGroupingMode.CategoryThenWarehouse
            ? rows.OrderBy(r => r.CategoryName)
                .ThenBy(r => r.WarehouseName)
                .ThenBy(r => r.ProductCode)
                .ToList()
            : rows.OrderBy(r => r.WarehouseName)
                .ThenBy(r => r.CategoryName)
                .ThenBy(r => r.ProductCode)
                .ToList();
    }
}
