using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Lecture de la valorisation de stock, consciente de la méthode de chaque article.
///
/// Trois règles tenues dans tout le fichier :
/// <list type="number">
/// <item>aucune requête de couches n'est émise quand le drapeau FIFO/LIFO est à false — c'est ce
///       qui garantit des écrans identiques au bit près dans ce cas ;</item>
/// <item>les agrégats de couches sont obtenus par sous-requêtes corrélées, donc une seule
///       instruction SQL et jamais un aller-retour par article ;</item>
/// <item>tout passe par la fabrique de contexte du tenant, en lecture seule.</item>
/// </list>
///
/// Les sous-requêtes ramènent les DEUX frontières (la plus ancienne et la plus récente) dans la
/// même ligne : un seul aller-retour sert FIFO et LIFO, et le choix se fait en mémoire, là où la
/// méthode est connue. Le tri reprend celui du moteur de consommation, départage par identifiant
/// compris — sans quoi deux couches reçues dans la même milliseconde seraient confondues.
/// </summary>
public sealed class EfStockValuationReader : IStockValuationReader
{
    /// <summary>
    /// Découpage des lots d'identifiants. SQL Server plafonne à 2100 paramètres par instruction ;
    /// une page d'écran n'approche jamais cette limite, mais un appel en lot (inventaire) le peut.
    /// </summary>
    private const int IdChunkSize = 500;

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly StockTraceabilityOptions _options;

    public EfStockValuationReader(
        ITenantDbContextFactory contextFactory,
        IOptions<StockTraceabilityOptions> options)
    {
        _contextFactory = contextFactory;
        _options = options.Value;
    }

    public async Task<IReadOnlyDictionary<Guid, StockCostReading>> GetByStockItemIdsAsync(
        IReadOnlyCollection<Guid> stockItemIds,
        CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<Guid, StockCostReading>();
        if (stockItemIds is null || stockItemIds.Count == 0)
            return result;

        await using var context = _contextFactory.CreateContext();

        foreach (var chunk in stockItemIds.Distinct().Chunk(IdChunkSize))
        {
            var rows = await QueryRowsAsync(
                context,
                q => q.Where(x => chunk.Contains(x.s.Id)),
                cancellationToken);

            foreach (var row in rows)
                result[row.StockItemId] = ToReading(row);
        }

        return result;
    }

    public async Task<StockCostReading?> GetByProductAndWarehouseAsync(
        Guid productId,
        Guid warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var rows = await QueryRowsAsync(
            context,
            q => q.Where(x => x.s.ProductId == productId && x.s.WarehouseId == warehouseId),
            cancellationToken);

        var row = rows.FirstOrDefault();
        return row is null ? null : ToReading(row);
    }

    /// <summary>
    /// La valeur totale, en deux sommes ensemblistes plutôt qu'une expression conditionnelle :
    /// la somme des couches ouvertes des articles FIFO/LIFO, plus la somme du cache pour tout le
    /// reste (CMUP, et FIFO/LIFO sans couche — le repli). Aucun article n'est compté deux fois,
    /// aucun n'est oublié : les deux filtres sont exactement complémentaires.
    /// </summary>
    public async Task<decimal> GetTotalStockValueAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        if (!_options.FifoLifoValuationEnabled)
        {
            return await context.StockItems
                .AsNoTracking()
                .Where(s => s.IsActive && (!warehouseId.HasValue || s.WarehouseId == warehouseId.Value))
                .Select(s => (decimal?)(s.QuantityOnHand * s.AverageCost))
                .SumAsync(cancellationToken) ?? 0m;
        }

        var layerTotal = await (
            from l in context.StockValuationLayers.AsNoTracking()
            join s in context.StockItems.AsNoTracking() on l.StockItemId equals s.Id
            join p in context.Products.AsNoTracking() on s.ProductId equals p.Id
            where s.IsActive
                  && l.RemainingQuantity > 0
                  && (p.CostingMethod == CostingMethod.Fifo || p.CostingMethod == CostingMethod.Lifo)
                  && (!warehouseId.HasValue || s.WarehouseId == warehouseId.Value)
            select (decimal?)(l.RemainingQuantity * l.UnitCost)
        ).SumAsync(cancellationToken) ?? 0m;

        var cacheTotal = await (
            from s in context.StockItems.AsNoTracking()
            join p in context.Products.AsNoTracking() on s.ProductId equals p.Id
            where s.IsActive
                  && (!warehouseId.HasValue || s.WarehouseId == warehouseId.Value)
                  && (!(p.CostingMethod == CostingMethod.Fifo || p.CostingMethod == CostingMethod.Lifo)
                      || !context.StockValuationLayers.Any(l => l.StockItemId == s.Id && l.RemainingQuantity > 0))
            select (decimal?)(s.QuantityOnHand * s.AverageCost)
        ).SumAsync(cancellationToken) ?? 0m;

        return layerTotal + cacheTotal;
    }

    public async Task<IReadOnlyList<StockValuationDriftRow>> ListValuationDriftAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        // Drapeau éteint : la valorisation par couches n'est pas en vigueur, il n'y a donc aucune
        // dérive à signaler. Sans cette garde, chaque article FIFO/LIFO serait rapporté comme
        // « sans couche » alors que c'est le comportement attendu dans ce mode.
        if (!_options.FifoLifoValuationEnabled)
            return Array.Empty<StockValuationDriftRow>();

        await using var context = _contextFactory.CreateContext();

        var rows = await QueryRowsAsync(
            context,
            q => q.Where(x => x.s.IsActive
                              && (x.p.CostingMethod == CostingMethod.Fifo || x.p.CostingMethod == CostingMethod.Lifo)
                              && (!warehouseId.HasValue || x.s.WarehouseId == warehouseId.Value)),
            cancellationToken,
            includeLabels: true);

        var drift = new List<StockValuationDriftRow>();
        foreach (var row in rows)
        {
            var cachedValue = row.QuantityOnHand * row.AverageCost;
            var quantityDrift = row.LayerCount > 0
                                && Math.Abs(row.LayerQuantity - row.QuantityOnHand) > StockValuation.QuantityTolerance;
            var valueDrift = row.LayerCount > 0
                             && Math.Abs(row.LayerValue - cachedValue) > StockValuation.ValueTolerance;
            var missingLayers = row.LayerCount == 0 && row.QuantityOnHand > 0;

            if (!quantityDrift && !valueDrift && !missingLayers)
                continue;

            drift.Add(new StockValuationDriftRow(
                row.StockItemId,
                row.ProductId,
                row.ProductCode ?? string.Empty,
                row.WarehouseId,
                row.WarehouseName ?? string.Empty,
                row.CostingMethod,
                row.QuantityOnHand,
                row.AverageCost,
                cachedValue,
                row.LayerCount,
                row.LayerQuantity,
                row.LayerValue,
                NextExitUnitCost(row),
                quantityDrift,
                valueDrift));
        }

        return drift;
    }

    private static decimal? NextExitUnitCost(ValuationRow row) =>
        row.CostingMethod == CostingMethod.Lifo ? row.LastInUnitCost : row.FirstInUnitCost;

    private StockCostReading ToReading(ValuationRow row)
    {
        var snapshot = StockValuation.FromAggregate(
            row.CostingMethod,
            layered: _options.RequiresLayeredCosting(row.CostingMethod),
            row.QuantityOnHand,
            row.AverageCost,
            row.LayerQuantity,
            row.LayerValue,
            row.FirstInUnitCost,
            row.LastInUnitCost,
            hasLayers: row.LayerCount > 0);

        return new StockCostReading(row.StockItemId, row.ProductId, row.WarehouseId, snapshot);
    }

    /// <summary>
    /// La requête commune. Les agrégats de couches ne sont demandés QUE si le drapeau est actif :
    /// sinon les colonnes restent à zéro et aucune sous-requête n'est émise.
    /// </summary>
    private async Task<List<ValuationRow>> QueryRowsAsync(
        TenantDbContext context,
        Func<IQueryable<StockItemWithProduct>, IQueryable<StockItemWithProduct>> filter,
        CancellationToken cancellationToken,
        bool includeLabels = false)
    {
        var baseQuery =
            from s in context.StockItems.AsNoTracking()
            join p in context.Products.AsNoTracking() on s.ProductId equals p.Id
            select new StockItemWithProduct { s = s, p = p };

        var filtered = filter(baseQuery);

        if (!_options.FifoLifoValuationEnabled)
        {
            return await filtered
                .Select(x => new ValuationRow
                {
                    StockItemId = x.s.Id,
                    ProductId = x.s.ProductId,
                    WarehouseId = x.s.WarehouseId,
                    ProductCode = includeLabels ? x.p.Code : null,
                    WarehouseName = null,
                    CostingMethod = x.p.CostingMethod,
                    QuantityOnHand = x.s.QuantityOnHand,
                    AverageCost = x.s.AverageCost,
                    LayerCount = 0,
                    LayerQuantity = 0m,
                    LayerValue = 0m,
                    FirstInUnitCost = null,
                    LastInUnitCost = null
                })
                .ToListAsync(cancellationToken);
        }

        return await filtered
            .Select(x => new ValuationRow
            {
                StockItemId = x.s.Id,
                ProductId = x.s.ProductId,
                WarehouseId = x.s.WarehouseId,
                ProductCode = includeLabels ? x.p.Code : null,
                WarehouseName = includeLabels
                    ? context.Warehouses.Where(w => w.Id == x.s.WarehouseId).Select(w => w.Name).FirstOrDefault()
                    : null,
                CostingMethod = x.p.CostingMethod,
                QuantityOnHand = x.s.QuantityOnHand,
                AverageCost = x.s.AverageCost,
                LayerCount = context.StockValuationLayers
                    .Count(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0),
                LayerQuantity = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .Sum(l => (decimal?)l.RemainingQuantity) ?? 0m,
                LayerValue = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .Sum(l => (decimal?)(l.RemainingQuantity * l.UnitCost)) ?? 0m,
                // Frontière FIFO : la couche la plus ancienne. Le ThenBy(Id) reprend le départage
                // du moteur de consommation — deux réceptions de même instant ne doivent pas être
                // départagées différemment ici et là.
                FirstInUnitCost = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .OrderBy(l => l.ReceivedAt).ThenBy(l => l.Id)
                    .Select(l => (decimal?)l.UnitCost).FirstOrDefault(),
                // Frontière LIFO : la couche la plus récente.
                LastInUnitCost = context.StockValuationLayers
                    .Where(l => l.StockItemId == x.s.Id && l.RemainingQuantity > 0)
                    .OrderByDescending(l => l.ReceivedAt).ThenByDescending(l => l.Id)
                    .Select(l => (decimal?)l.UnitCost).FirstOrDefault()
            })
            .ToListAsync(cancellationToken);
    }

    /// <summary>Projection intermédiaire : EF ne compose pas sur un type anonyme passé en paramètre.</summary>
    private sealed class StockItemWithProduct
    {
        public required Domain.Entities.StockItem s { get; init; }
        public required Domain.Entities.Product p { get; init; }
    }

    private sealed class ValuationRow
    {
        public Guid StockItemId { get; init; }
        public Guid ProductId { get; init; }
        public Guid WarehouseId { get; init; }
        public string? ProductCode { get; init; }
        public string? WarehouseName { get; init; }
        public CostingMethod CostingMethod { get; init; }
        public decimal QuantityOnHand { get; init; }
        public decimal AverageCost { get; init; }
        public int LayerCount { get; init; }
        public decimal LayerQuantity { get; init; }
        public decimal LayerValue { get; init; }
        public decimal? FirstInUnitCost { get; init; }
        public decimal? LastInUnitCost { get; init; }
    }
}
