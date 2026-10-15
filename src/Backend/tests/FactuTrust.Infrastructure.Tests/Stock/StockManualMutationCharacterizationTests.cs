using Microsoft.Extensions.Options;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Stock.Commands;
using FactuTrust.Application.Features.Stock.EventHandlers;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Stock;

/// <summary>
/// Vague 0 — caractérisation des mutateurs manuels (entrée/sortie/comptage rapide/annulation facture)
/// via <see cref="IStockMutationService"/>, flags off = même résultat que RecordEntry/RecordExit/AdjustStock.
/// </summary>
public sealed class StockManualMutationCharacterizationTests
{
    [Fact]
    public async Task RecordStockEntry_TwoLots_UpdatesCmup()
    {
        var product = NewProduct();
        var warehouse = Warehouse.Create("WH1", "Principal", isDefault: true).Value;
        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo.Setup(s => s.GetByProductAndWarehouseAsync(product.Id, warehouse.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((StockItem?)null);
        StockItem? created = null;
        stockRepo.Setup(s => s.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Callback<StockItem, CancellationToken>((s, _) =>
            {
                created = s;
                stockRepo.Setup(x => x.GetByProductAndWarehouseAsync(product.Id, warehouse.Id, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(s);
            })
            .ReturnsAsync((StockItem s, CancellationToken _) => s);
        stockRepo.Setup(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new RecordStockEntryCommandHandler(
            WarehouseRepo(warehouse),
            ProductRepo(product),
            Tenant(),
            StockTestDoubles.Passthrough(stockRepo.Object));

        var first = await handler.Handle(
            new RecordStockEntryCommand(product.Id, warehouse.Id, 10m, 2m, MovementReason.Purchase, "BR-1", null),
            CancellationToken.None);
        Assert.True(first.IsSuccess, first.Error?.Description);

        var second = await handler.Handle(
            new RecordStockEntryCommand(product.Id, warehouse.Id, 10m, 4m, MovementReason.Purchase, "BR-2", null),
            CancellationToken.None);
        Assert.True(second.IsSuccess, second.Error?.Description);
        Assert.NotNull(created);
        Assert.Equal(20m, created!.QuantityOnHand);
        Assert.Equal(3m, created.AverageCost);
    }

    [Fact]
    public async Task RecordStockExit_DecrementsOnHand_AtCurrentAverageCost()
    {
        var product = NewProduct();
        var warehouse = Warehouse.Create("WH1", "Principal", isDefault: true).Value;
        var stockItem = StockItem.Create(product.Id, warehouse.Id).Value;
        Assert.True(stockItem.RecordEntry(10m, 5m, MovementReason.InitialStock).IsSuccess);

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo.Setup(s => s.GetByProductAndWarehouseAsync(product.Id, warehouse.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(stockItem);
        stockRepo.Setup(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new RecordStockExitCommandHandler(
            WarehouseRepo(warehouse),
            ProductRepo(product),
            Tenant(),
            StockTestDoubles.Passthrough(stockRepo.Object));

        var result = await handler.Handle(
            new RecordStockExitCommand(product.Id, warehouse.Id, 4m, MovementReason.Damage, "BS-1", null),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(6m, stockItem.QuantityOnHand);
        Assert.Equal(5m, stockItem.AverageCost);
    }

    [Fact]
    public async Task QuickStockCount_Untracked_AdjustsToActualQuantity()
    {
        var product = NewProduct();
        var warehouse = Warehouse.Create("WH1", "Principal", isDefault: true).Value;
        var stockItem = StockItem.Create(product.Id, warehouse.Id).Value;
        Assert.True(stockItem.RecordEntry(10m, 3m, MovementReason.InitialStock).IsSuccess);

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo.Setup(s => s.GetByProductAndWarehouseAsync(product.Id, warehouse.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(stockItem);
        stockRepo.Setup(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new QuickStockCountCommandHandler(
            stockRepo.Object,
            WarehouseRepo(warehouse),
            ProductRepo(product),
            Tenant(),
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()));

        var result = await handler.Handle(
            new QuickStockCountCommand(product.Id, 7m, warehouse.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(10m, result.Value.PreviousQuantity);
        Assert.Equal(7m, result.Value.NewQuantity);
        Assert.Equal(7m, stockItem.QuantityOnHand);
    }

    [Fact]
    public async Task QuickStockCount_TrackedProduct_IsRefused()
    {
        var product = NewProduct();
        Assert.True(product.ConfigureTraceability(TrackingMode.Lot, false, PickingPolicy.Fefo, CostingMethod.Average, null).IsSuccess);
        var warehouse = Warehouse.Create("WH1", "Principal", isDefault: true).Value;

        var handler = new QuickStockCountCommandHandler(
            new Mock<IStockItemRepository>().Object,
            WarehouseRepo(warehouse),
            ProductRepo(product),
            Tenant(),
            StockTestDoubles.Passthrough(new Mock<IStockItemRepository>().Object),
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()));

        var result = await handler.Handle(
            new QuickStockCountCommand(product.Id, 1m, warehouse.Id),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("inventaire par lot", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RestoreStockOnInvoiceCancelled_WhenReferenceExists_Skips()
    {
        var notification = new InvoiceCancelledEvent(Guid.NewGuid(), "FAC-2026-000099", "Erreur");
        var movementRepo = new Mock<IStockMovementRepository>();
        movementRepo.Setup(m => m.GetByReferenceAsync($"Annulation facture {notification.InvoiceNumber}", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { DummyMovement() });

        var invoiceRepo = new Mock<IInvoiceRepository>(MockBehavior.Strict);
        var stockRepo = new Mock<IStockItemRepository>(MockBehavior.Strict);
        var warehouseRepo = new Mock<IWarehouseRepository>(MockBehavior.Strict);
        var productRepo = new Mock<IProductRepository>(MockBehavior.Strict);

        var handler = new RestoreStockOnInvoiceCancelledHandler(
            invoiceRepo.Object,
            stockRepo.Object,
            warehouseRepo.Object,
            productRepo.Object,
            movementRepo.Object,
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            NullLogger<RestoreStockOnInvoiceCancelledHandler>.Instance);

        await handler.Handle(notification, CancellationToken.None);

        invoiceRepo.VerifyNoOtherCalls();
        stockRepo.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task RestoreStockOnInvoiceCancelled_ReplaysOriginalExitQuantity()
    {
        var product = NewProduct();
        var warehouse = Warehouse.Create("WH1", "Principal", isDefault: true).Value;
        var stockItem = StockItem.Create(product.Id, warehouse.Id).Value;
        Assert.True(stockItem.RecordEntry(10m, 8m, MovementReason.InitialStock).IsSuccess);
        Assert.True(stockItem.RecordExit(3m, MovementReason.Sale, "Facture FAC-2026-000100").IsSuccess);
        var exit = stockItem.Movements.Last(m => m.Type == MovementType.Exit);

        var notification = new InvoiceCancelledEvent(Guid.NewGuid(), "FAC-2026-000100", "Annulation");
        var movementRepo = new Mock<IStockMovementRepository>();
        movementRepo.Setup(m => m.GetByReferenceAsync($"Annulation facture {notification.InvoiceNumber}", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StockMovement>());
        movementRepo.Setup(m => m.GetByReferenceAsync($"Facture {notification.InvoiceNumber}", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { exit });

        var address = Address.Create("1 rue de la République", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;
        var invoice = Invoice.Create(
            InvoiceNumber.Create("FAC", 2026, 100),
            client,
            new DateTime(2026, 7, 20),
            warehouseId: warehouse.Id).Value;

        var invoiceRepo = new Mock<IInvoiceRepository>();
        invoiceRepo.Setup(i => i.GetByIdWithLinesAsync(notification.InvoiceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(invoice);

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo.Setup(s => s.GetByIdAsync(stockItem.Id, It.IsAny<CancellationToken>())).ReturnsAsync(stockItem);
        stockRepo.Setup(s => s.GetByProductAndWarehouseAsync(product.Id, warehouse.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(stockItem);
        stockRepo.Setup(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var warehouseRepo = new Mock<IWarehouseRepository>();
        warehouseRepo.Setup(w => w.GetByIdAsync(warehouse.Id, It.IsAny<CancellationToken>())).ReturnsAsync(warehouse);

        var handler = new RestoreStockOnInvoiceCancelledHandler(
            invoiceRepo.Object,
            stockRepo.Object,
            warehouseRepo.Object,
            new Mock<IProductRepository>().Object,
            movementRepo.Object,
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            NullLogger<RestoreStockOnInvoiceCancelledHandler>.Instance);

        await handler.Handle(notification, CancellationToken.None);

        Assert.Equal(10m, stockItem.QuantityOnHand);
    }

    private static Product NewProduct() =>
        Product.Create(
            "P-STOCK",
            "Produit stocké",
            ProductType.Product,
            Money.Create(100m, Money.DefaultCurrency),
            VatRate.Standard,
            Guid.NewGuid(),
            isStockManaged: true).Value;

    private static ITenantContext Tenant()
    {
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(Guid.NewGuid());
        return tenant.Object;
    }

    private static IProductRepository ProductRepo(Product product)
    {
        var repo = new Mock<IProductRepository>();
        repo.Setup(p => p.GetByIdAsync(product.Id, It.IsAny<CancellationToken>())).ReturnsAsync(product);
        return repo.Object;
    }

    private static IWarehouseRepository WarehouseRepo(Warehouse warehouse)
    {
        var repo = new Mock<IWarehouseRepository>();
        repo.Setup(w => w.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync(warehouse);
        repo.Setup(w => w.ExistsAsync(warehouse.Id, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        return repo.Object;
    }

    private static StockMovement DummyMovement()
    {
        var stockItem = StockItem.Create(Guid.NewGuid(), Guid.NewGuid()).Value;
        Assert.True(stockItem.RecordEntry(1m, 10m, MovementReason.CustomerReturn, "Annulation facture FAC-X").IsSuccess);
        return stockItem.Movements.Last();
    }
}
