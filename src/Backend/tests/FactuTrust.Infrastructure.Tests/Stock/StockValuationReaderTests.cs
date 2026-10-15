using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Services;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Stock;

/// <summary>
/// La lecture de valorisation, sur la vraie base (en mémoire) et par les vraies requêtes.
///
/// Le test le plus important du fichier est <see cref="ScreenNeverLiesAboutTheNextExit"/> : il
/// prouve que la couche annoncée par l'écran est bien celle que le moteur consommera. Sans lui,
/// l'écran et le grand-livre pourraient diverger sans que rien ne le signale.
/// </summary>
public sealed class StockValuationReaderTests
{
    private static InMemoryTenantDbContextFactory CreateFactory() => new(Guid.NewGuid().ToString());

    private static StockTraceabilityOptions Flags(bool fifoLifo = true) =>
        new() { FifoLifoValuationEnabled = fifoLifo };

    private static EfStockValuationReader Reader(
        InMemoryTenantDbContextFactory factory, StockTraceabilityOptions options) =>
        new(factory, Options.Create(options));

    private static StockMutationService Mutation(
        InMemoryTenantDbContextFactory factory, StockTraceabilityOptions options) =>
        new(factory, Options.Create(options));

    [Theory]
    [InlineData(CostingMethod.Fifo, 2)]
    [InlineData(CostingMethod.Lifo, 4)]
    public async Task UnitCost_IsTheNextExitLayer(CostingMethod method, int expectedUnitCost)
    {
        var factory = CreateFactory();
        var (productId, warehouseId) = await Seed(factory, method);
        var options = Flags();

        await Receive(factory, options, productId, warehouseId, qty: 10m, cost: 2m);
        await Receive(factory, options, productId, warehouseId, qty: 10m, cost: 3m);
        await Receive(factory, options, productId, warehouseId, qty: 10m, cost: 4m);

        var reading = await Reader(factory, options)
            .GetByProductAndWarehouseAsync(productId, warehouseId);

        Assert.NotNull(reading);
        Assert.Equal(expectedUnitCost, reading!.Cost.UnitCost);
        Assert.Equal(90m, reading.Cost.StockValue);
        Assert.True(reading.Cost.UnitCostIsNextExit);
        Assert.False(reading.Cost.QuantityDrift);
    }

    /// <summary>
    /// LE test de parité. Ce que le lecteur annonce comme « prochaine sortie » doit être le coût
    /// que le moteur porte effectivement sur le mouvement de sortie suivant.
    /// </summary>
    [Theory]
    [InlineData(CostingMethod.Fifo)]
    [InlineData(CostingMethod.Lifo)]
    public async Task ScreenNeverLiesAboutTheNextExit(CostingMethod method)
    {
        var factory = CreateFactory();
        var (productId, warehouseId) = await Seed(factory, method);
        var options = Flags();

        await Receive(factory, options, productId, warehouseId, qty: 10m, cost: 2m);
        await Receive(factory, options, productId, warehouseId, qty: 10m, cost: 7m);

        var announced = (await Reader(factory, options)
            .GetByProductAndWarehouseAsync(productId, warehouseId))!.Cost.UnitCost;

        var exit = await Mutation(factory, options).ApplyAsync(new StockMutationRequest
        {
            ProductId = productId,
            WarehouseId = warehouseId,
            Kind = StockMutationKind.Exit,
            Quantity = 1m,
            Reason = MovementReason.Sale
        });
        Assert.True(exit.IsSuccess);

        await using var ctx = factory.CreateContext();
        var stockItemId = ctx.StockItems.Single(s => s.ProductId == productId).Id;
        var applied = ctx.StockMovements
            .Where(m => m.StockItemId == stockItemId && m.Type == MovementType.Exit)
            .OrderByDescending(m => m.OccurredAt)
            .ThenByDescending(m => m.Id)
            .First();

        Assert.Equal(announced, applied.UnitCost);
    }

    /// <summary>
    /// Drapeau éteint sur un produit FIFO : la lecture doit se comporter comme le cache, sans
    /// quoi l'écran annoncerait une valorisation par couches qui n'a pas eu lieu.
    /// </summary>
    [Fact]
    public async Task FlagOff_ReadsLikeTheCache()
    {
        var factory = CreateFactory();
        var (productId, warehouseId) = await Seed(factory, CostingMethod.Fifo);

        // Les mouvements sont appliqués drapeau ALLUMÉ : les couches existent bel et bien.
        await Receive(factory, Flags(), productId, warehouseId, qty: 10m, cost: 2m);
        await Receive(factory, Flags(), productId, warehouseId, qty: 10m, cost: 8m);

        var offOptions = Flags(fifoLifo: false);
        var reading = await Reader(factory, offOptions)
            .GetByProductAndWarehouseAsync(productId, warehouseId);

        await using var ctx = factory.CreateContext();
        var cached = ctx.StockItems.Single(s => s.ProductId == productId).AverageCost;

        Assert.NotNull(reading);
        Assert.False(reading!.Cost.Layered);
        Assert.Equal(cached, reading.Cost.UnitCost);
        Assert.Equal(20m * cached, reading.Cost.StockValue);
        Assert.False(reading.Cost.UnitCostIsNextExit);
    }

    [Fact]
    public async Task LayeredWithoutLayers_FallsBackToCache()
    {
        var factory = CreateFactory();
        var (productId, warehouseId) = await Seed(factory, CostingMethod.Average);
        var options = Flags();

        await Receive(factory, options, productId, warehouseId, qty: 5m, cost: 4m);

        // Bascule brutale en FIFO sans couche d'ouverture — exactement le cas que le diagnostic
        // recense : l'écran doit continuer d'afficher une valeur, pas zéro.
        await using (var ctx = factory.CreateContext())
        {
            var product = ctx.Products.Single(p => p.Id == productId);
            Assert.True(product.ConfigureTraceability(
                TrackingMode.None, false, PickingPolicy.None, CostingMethod.Fifo, null).IsSuccess);
            await ctx.SaveChangesAsync();
        }

        var reading = await Reader(factory, options)
            .GetByProductAndWarehouseAsync(productId, warehouseId);

        Assert.NotNull(reading);
        Assert.False(reading!.Cost.HasLayers);
        Assert.Equal(4m, reading.Cost.UnitCost);
        Assert.Equal(20m, reading.Cost.StockValue);
    }

    [Fact]
    public async Task ZeroQuantity_IsZero()
    {
        var factory = CreateFactory();
        var (productId, warehouseId) = await Seed(factory, CostingMethod.Fifo);
        var options = Flags();

        await Receive(factory, options, productId, warehouseId, qty: 3m, cost: 5m);
        var exit = await Mutation(factory, options).ApplyAsync(new StockMutationRequest
        {
            ProductId = productId,
            WarehouseId = warehouseId,
            Kind = StockMutationKind.Exit,
            Quantity = 3m,
            Reason = MovementReason.Sale
        });
        Assert.True(exit.IsSuccess);

        var reading = await Reader(factory, options)
            .GetByProductAndWarehouseAsync(productId, warehouseId);

        Assert.NotNull(reading);
        Assert.Equal(0m, reading!.Cost.UnitCost);
        Assert.Equal(0m, reading.Cost.StockValue);
    }

    /// <summary>
    /// Multi-entrepôt : les couches vivent par article de stock (produit × entrepôt), jamais par
    /// produit. Deux entrepôts doivent donc pouvoir annoncer deux frontières différentes.
    /// </summary>
    [Fact]
    public async Task TwoWarehouses_HaveIndependentBoundaries()
    {
        var factory = CreateFactory();
        var (productId, warehouseA) = await Seed(factory, CostingMethod.Fifo);
        var options = Flags();

        Guid warehouseB;
        await using (var ctx = factory.CreateContext())
        {
            var second = Warehouse.Create("WH2", "Secondaire").Value;
            ctx.Warehouses.Add(second);
            await ctx.SaveChangesAsync();
            warehouseB = second.Id;
        }

        await Receive(factory, options, productId, warehouseA, qty: 5m, cost: 1m);
        await Receive(factory, options, productId, warehouseB, qty: 5m, cost: 9m);

        var reader = Reader(factory, options);
        var a = await reader.GetByProductAndWarehouseAsync(productId, warehouseA);
        var b = await reader.GetByProductAndWarehouseAsync(productId, warehouseB);

        Assert.Equal(1m, a!.Cost.UnitCost);
        Assert.Equal(9m, b!.Cost.UnitCost);
        Assert.Equal(5m, a.Cost.StockValue);
        Assert.Equal(45m, b.Cost.StockValue);
    }

    /// <summary>
    /// Le total mélange les deux mondes : couches pour les articles FIFO/LIFO, cache pour le CMUP.
    /// Il doit différer du total « tout au cache » que l'ancien calcul produisait.
    /// </summary>
    [Fact]
    public async Task TotalStockValue_MixesLayersAndCache()
    {
        var factory = CreateFactory();
        var options = Flags();

        var (fifoId, warehouseId) = await Seed(factory, CostingMethod.Fifo);
        await Receive(factory, options, fifoId, warehouseId, qty: 10m, cost: 2m);
        await Receive(factory, options, fifoId, warehouseId, qty: 10m, cost: 4m);

        Guid averageId;
        await using (var ctx = factory.CreateContext())
        {
            var category = ctx.ProductCategories.First();
            var product = Product.Create(
                "SKU-CMUP", "Article CMUP", ProductType.Product,
                Money.Create(10m, Money.DefaultCurrency), VatRate.Standard,
                category.Id, isStockManaged: true).Value;
            ctx.Products.Add(product);
            await ctx.SaveChangesAsync();
            averageId = product.Id;
        }

        await Receive(factory, options, averageId, warehouseId, qty: 4m, cost: 5m);

        var total = await Reader(factory, options).GetTotalStockValueAsync();

        // FIFO : 10×2 + 10×4 = 60 (somme des couches). CMUP : 4×5 = 20.
        Assert.Equal(80m, total);
    }

    [Fact]
    public async Task GetByStockItemIds_IsEmptyForEmptyInput()
    {
        var factory = CreateFactory();
        var result = await Reader(factory, Flags()).GetByStockItemIdsAsync(Array.Empty<Guid>());
        Assert.Empty(result);
    }

    // --- amorçage -------------------------------------------------------------------------

    private static async Task<(Guid ProductId, Guid WarehouseId)> Seed(
        InMemoryTenantDbContextFactory factory,
        CostingMethod costing)
    {
        await using var ctx = factory.CreateContext();
        var category = ProductCategory.Create("CAT", "Cat").Value;
        ctx.ProductCategories.Add(category);

        var product = Product.Create(
            "SKU-1", "Article", ProductType.Product,
            Money.Create(10m, Money.DefaultCurrency), VatRate.Standard,
            category.Id, isStockManaged: true).Value;
        if (costing != CostingMethod.Average)
        {
            Assert.True(product.ConfigureTraceability(
                TrackingMode.None, false, PickingPolicy.None, costing, null).IsSuccess);
        }
        ctx.Products.Add(product);

        var warehouse = Warehouse.Create("WH1", "Principal", isDefault: true).Value;
        ctx.Warehouses.Add(warehouse);

        await ctx.SaveChangesAsync();
        return (product.Id, warehouse.Id);
    }

    private static async Task Receive(
        InMemoryTenantDbContextFactory factory,
        StockTraceabilityOptions options,
        Guid productId,
        Guid warehouseId,
        decimal qty,
        decimal cost)
    {
        var result = await Mutation(factory, options).ApplyAsync(new StockMutationRequest
        {
            ProductId = productId,
            WarehouseId = warehouseId,
            Kind = StockMutationKind.Entry,
            Quantity = qty,
            UnitCost = cost,
            Reason = MovementReason.Purchase
        });
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
    }
}
