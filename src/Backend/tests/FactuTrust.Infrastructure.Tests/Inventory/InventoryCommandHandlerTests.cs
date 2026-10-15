using Microsoft.Extensions.Options;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Inventory.Commands;
using FactuTrust.Application.Features.Inventory.Queries;
using FactuTrust.Infrastructure.Tests.Stock;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Inventory;

public sealed class InventoryCommandHandlerTests
{
    private static Product CreateStockManagedProduct()
    {
        var categoryId = Guid.NewGuid();
        var result = Product.Create(
            "TST001",
            "Produit test stock",
            ProductType.Product,
            Money.Create(10m, Money.DefaultCurrency),
            VatRate.Standard,
            categoryId,
            isStockManaged: true);

        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static Product CreateLotTrackedProduct()
    {
        var product = CreateStockManagedProduct();
        Assert.True(product.ConfigureTraceability(
            TrackingMode.Lot,
            false,
            PickingPolicy.Fefo,
            CostingMethod.Average,
            null).IsSuccess);
        return product;
    }

    private static Mock<IProductRepository> ProductRepoWithTracking(
        params (Guid ProductId, TrackingMode Mode)[] modes)
    {
        var repo = new Mock<IProductRepository>();
        repo
            .Setup(p => p.GetTrackingInfoByIdsAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyCollection<Guid> ids, CancellationToken _) =>
                ids.Distinct().ToDictionary(
                    id => id,
                    id => new ProductTrackingInfo(
                        modes.FirstOrDefault(m => m.ProductId == id).Mode,
                        false)));
        // La validation d'inventaire charge désormais les produits EN LOT, pour résoudre le coût
        // des écarts positifs. Aucun produit retourné ⇒ repli sur le CMUP, comme auparavant.
        repo
            .Setup(p => p.GetByIdsAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, Product>());
        return repo;
    }

    [Fact]
    public async Task StartInventory_Complete_WarehouseHasNoStockItems_ButCatalogHasManagedProducts_Succeeds()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateStockManagedProduct();

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var productRepo = new Mock<IProductRepository>();
        productRepo
            .Setup(p => p.GetStockManagedProductsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Product> { product });

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(s => s.GetByWarehouseForInventoryAsync(warehouseId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StockItem>());

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo.Setup(i => i.HasActiveInventoryAsync(warehouseId, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        invRepo.Setup(i => i.GetNextReferenceAsync(It.IsAny<CancellationToken>())).ReturnsAsync("INVE-000001");
        invRepo
            .Setup(i => i.AddAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PhysicalInventory inv, CancellationToken _) => inv);

        var warehouseRepo = new Mock<IWarehouseRepository>();

        var numberService = new Mock<IDocumentNumberService>();
        numberService
            .Setup(n => n.ReserveNextAsync(tenantId, NumberingDocumentType.PhysicalInventory, It.IsAny<int>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DocumentNumberResult("INVE-000001", DateTime.UtcNow.Year, 1, "INVE"));

        var handler = new StartInventoryCommandHandler(
            invRepo.Object,
            stockRepo.Object,
            warehouseRepo.Object,
            productRepo.Object,
            tenant.Object,
            numberService.Object,
            StockTestDoubles.EmptyLots());

        var result = await handler.Handle(
            new StartInventoryCommand(InventoryType.Complete, warehouseId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.TotalProducts);
        Assert.Equal(product.Id, result.Value.Products[0].ProductId);
        Assert.Equal(0m, result.Value.Products[0].TheoreticalQuantity);
    }

    [Fact]
    public async Task StartInventory_Complete_NoStockManagedProductsInCatalog_Fails()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var productRepo = new Mock<IProductRepository>();
        productRepo
            .Setup(p => p.GetStockManagedProductsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<Product>());

        var stockRepo = new Mock<IStockItemRepository>();
        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo.Setup(i => i.HasActiveInventoryAsync(warehouseId, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var warehouseRepo = new Mock<IWarehouseRepository>();

        var numberService = new Mock<IDocumentNumberService>();
        numberService
            .Setup(n => n.ReserveNextAsync(tenantId, NumberingDocumentType.PhysicalInventory, It.IsAny<int>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DocumentNumberResult("INVE-000001", DateTime.UtcNow.Year, 1, "INVE"));

        var handler = new StartInventoryCommandHandler(
            invRepo.Object,
            stockRepo.Object,
            warehouseRepo.Object,
            productRepo.Object,
            tenant.Object,
            numberService.Object,
            StockTestDoubles.EmptyLots());

        var result = await handler.Handle(
            new StartInventoryCommand(InventoryType.Complete, warehouseId),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("catalogue", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ValidateInventory_LineWithDifference_NoStockItem_CreatesStockItemAndAdjusts()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateStockManagedProduct();

        var start = PhysicalInventory.Start(
            "INVE-000001",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;
        Assert.True(inventory.RecordCount(product.Id, 7m).IsSuccess);

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);
        invRepo.Setup(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(s => s.GetByProductAndWarehouseAsync(product.Id, warehouseId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((StockItem?)null);
        stockRepo
            .Setup(s => s.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((StockItem si, CancellationToken _) => si);
        stockRepo
            .Setup(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new ValidateInventoryCommandHandler(
            invRepo.Object,
            stockRepo.Object,
            ProductRepoWithTracking().Object,
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()),
            tenant.Object);

        var result = await handler.Handle(new ValidateInventoryCommand(inventory.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.ProductsWithChanges);
        stockRepo.Verify(s => s.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()), Times.Once);
        stockRepo.Verify(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ValidateInventory_LotTrackedWithoutLotNumber_FailsBeforeMutation()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateLotTrackedProduct();

        var start = PhysicalInventory.Start(
            "INVE-LOT-001",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;
        Assert.True(inventory.RecordCount(product.Id, 7m).IsSuccess);

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);

        var mutation = new Mock<IStockMutationService>();
        var handler = new ValidateInventoryCommandHandler(
            invRepo.Object,
            new Mock<IStockItemRepository>().Object,
            ProductRepoWithTracking((product.Id, TrackingMode.Lot)).Object,
            mutation.Object,
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()),
            tenant.Object);

        var result = await handler.Handle(new ValidateInventoryCommand(inventory.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("numéro de lot", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        invRepo.Verify(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()), Times.Never);
        mutation.Verify(
            m => m.ApplyAsync(It.IsAny<StockMutationRequest>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task ValidateInventory_LotTrackedWithLotNumber_UsesAllocatedEntry()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateLotTrackedProduct();

        var start = PhysicalInventory.Start(
            "INVE-LOT-002",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;
        Assert.True(inventory.RecordCount(product.Id, 7m, lotNumber: "LOT-OPEN-1").IsSuccess);
        Assert.Equal("LOT-OPEN-1", inventory.CountLines.Single().LotNumber);

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);
        invRepo.Setup(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(s => s.GetByProductAndWarehouseAsync(product.Id, warehouseId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((StockItem?)null);

        StockMutationRequest? captured = null;
        var mutation = new Mock<IStockMutationService>();
        mutation
            .Setup(m => m.ApplyAsync(It.IsAny<StockMutationRequest>(), It.IsAny<CancellationToken>()))
            .Callback<StockMutationRequest, CancellationToken>((req, _) => captured = req)
            .ReturnsAsync(Result.Success(new StockMutationResult(Guid.NewGuid(), 7m, 0m)));

        var handler = new ValidateInventoryCommandHandler(
            invRepo.Object,
            stockRepo.Object,
            ProductRepoWithTracking((product.Id, TrackingMode.Lot)).Object,
            mutation.Object,
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()),
            tenant.Object);

        var result = await handler.Handle(new ValidateInventoryCommand(inventory.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(captured);
        Assert.Equal(StockMutationKind.Entry, captured!.Kind);
        Assert.Equal(7m, captured.Quantity);
        Assert.NotNull(captured.Allocations);
        Assert.Equal("LOT-OPEN-1", captured.Allocations![0].LotNumber);
        mutation.Verify(
            m => m.ApplyAsync(It.IsAny<StockMutationRequest>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ValidateInventory_NoCounts_ConfirmsTheoretical_NoStockAdjustments()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateStockManagedProduct();

        var start = PhysicalInventory.Start(
            "INVE-000002",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 4m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);
        invRepo.Setup(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var stockRepo = new Mock<IStockItemRepository>();
        var handler = new ValidateInventoryCommandHandler(
            invRepo.Object,
            stockRepo.Object,
            ProductRepoWithTracking().Object,
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()),
            tenant.Object);

        var result = await handler.Handle(new ValidateInventoryCommand(inventory.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.ProductsWithChanges);
        Assert.Equal(InventoryStatus.Validated, inventory.Status);
        Assert.All(inventory.CountLines, line => Assert.Equal(line.TheoreticalQuantity, line.CountedQuantity));
        stockRepo.Verify(s => s.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()), Times.Never);
        stockRepo.Verify(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ValidateInventory_PendingCounts_AppliesDirtyThenValidates()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var counted = CreateStockManagedProduct();
        var confirmed = CreateStockManagedProduct();

        var start = PhysicalInventory.Start(
            "INVE-000003",
            warehouseId,
            InventoryType.Complete,
            new[]
            {
                (counted.Id, counted.Name, (string?)counted.Code, 10m),
                (confirmed.Id, confirmed.Name, (string?)confirmed.Code, 5m)
            },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);
        invRepo.Setup(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(s => s.GetByProductAndWarehouseAsync(counted.Id, warehouseId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((StockItem?)null);
        stockRepo
            .Setup(s => s.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((StockItem si, CancellationToken _) => si);
        stockRepo
            .Setup(s => s.UpdateAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new ValidateInventoryCommandHandler(
            invRepo.Object,
            stockRepo.Object,
            ProductRepoWithTracking((counted.Id, TrackingMode.None), (confirmed.Id, TrackingMode.None)).Object,
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()),
            tenant.Object);

        var result = await handler.Handle(
            new ValidateInventoryCommand(
                inventory.Id,
                new[] { new InventoryPendingCount(counted.Id, 13m) }),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.ProductsWithChanges);
        Assert.Equal(13m, inventory.CountLines.Single(l => l.ProductId == counted.Id).CountedQuantity);
        Assert.Equal(5m, inventory.CountLines.Single(l => l.ProductId == confirmed.Id).CountedQuantity);
        stockRepo.Verify(s => s.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ValidateInventory_PendingCounts_UnknownProduct_FailsAndStaysInProgress()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateStockManagedProduct();

        var start = PhysicalInventory.Start(
            "INVE-000004",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 2m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);

        var stockRepo = new Mock<IStockItemRepository>();
        var handler = new ValidateInventoryCommandHandler(
            invRepo.Object,
            stockRepo.Object,
            ProductRepoWithTracking().Object,
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            Options.Create(new StockTraceabilityOptions()),
            tenant.Object);

        var result = await handler.Handle(
            new ValidateInventoryCommand(
                inventory.Id,
                new[] { new InventoryPendingCount(Guid.NewGuid(), 3m) }),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(InventoryStatus.InProgress, inventory.Status);
        invRepo.Verify(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()), Times.Never);
        stockRepo.Verify(s => s.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RecordCount_LotTrackedWithoutLotNumber_FailsWhenVariance()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateLotTrackedProduct();

        var start = PhysicalInventory.Start(
            "INVE-LOT-COUNT-001",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);

        var handler = new RecordCountCommandHandler(
            invRepo.Object,
            ProductRepoWithTracking((product.Id, TrackingMode.Lot)).Object,
            tenant.Object);

        var result = await handler.Handle(
            new RecordCountCommand(inventory.Id, product.Id, 7m),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("numéro de lot", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(product.Name, result.Error.Description);
        invRepo.Verify(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.False(inventory.CountLines.Single().IsCounted);
    }

    [Fact]
    public async Task RecordCount_LotTrackedWithLotNumber_SucceedsWhenVariance()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateLotTrackedProduct();

        var start = PhysicalInventory.Start(
            "INVE-LOT-COUNT-002",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);
        invRepo.Setup(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = new RecordCountCommandHandler(
            invRepo.Object,
            ProductRepoWithTracking((product.Id, TrackingMode.Lot)).Object,
            tenant.Object);

        var result = await handler.Handle(
            new RecordCountCommand(inventory.Id, product.Id, 7m, LotNumber: "LOT-OPEN-1"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("LOT-OPEN-1", inventory.CountLines.Single().LotNumber);
        Assert.Equal(7m, inventory.CountLines.Single().CountedQuantity);
        invRepo.Verify(i => i.UpdateAsync(inventory, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RecordCount_LotTrackedZeroVariance_SucceedsWithoutLot()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateLotTrackedProduct();

        var start = PhysicalInventory.Start(
            "INVE-LOT-COUNT-003",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);
        invRepo.Setup(i => i.UpdateAsync(It.IsAny<PhysicalInventory>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var productRepo = ProductRepoWithTracking((product.Id, TrackingMode.Lot));
        var handler = new RecordCountCommandHandler(
            invRepo.Object,
            productRepo.Object,
            tenant.Object);

        var result = await handler.Handle(
            new RecordCountCommand(inventory.Id, product.Id, 0m),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(inventory.CountLines.Single().IsCounted);
        Assert.Null(inventory.CountLines.Single().LotNumber);
        invRepo.Verify(i => i.UpdateAsync(inventory, It.IsAny<CancellationToken>()), Times.Once);
        productRepo.Verify(
            p => p.GetTrackingInfoByIdsAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task GetInventorySummary_LotTrackedVarianceWithoutLot_CannotValidate()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateLotTrackedProduct();

        var start = PhysicalInventory.Start(
            "INVE-SUM-001",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;
        Assert.True(inventory.RecordCount(product.Id, 7m).IsSuccess);

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);

        var handler = new GetInventorySummaryQueryHandler(
            invRepo.Object,
            ProductRepoWithTracking((product.Id, TrackingMode.Lot)).Object,
            tenant.Object);

        var result = await handler.Handle(new GetInventorySummaryQuery(inventory.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanValidate);
        Assert.Contains("numéro de lot", result.Value.StatusMessage, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(product.Name, result.Value.StatusMessage);
        Assert.Equal(TrackingMode.Lot, result.Value.ProductsWithDifferenceList.Single().TrackingMode);
    }

    [Fact]
    public async Task GetInventorySummary_LotTrackedWithLotNumber_CanValidate()
    {
        var tenantId = Guid.NewGuid();
        var warehouseId = Guid.NewGuid();
        var product = CreateLotTrackedProduct();

        var start = PhysicalInventory.Start(
            "INVE-SUM-002",
            warehouseId,
            InventoryType.Complete,
            new[] { (product.Id, product.Name, (string?)product.Code, 0m) },
            null);
        Assert.True(start.IsSuccess);
        var inventory = start.Value;
        Assert.True(inventory.RecordCount(product.Id, 7m, lotNumber: "LOT-OPEN-1").IsSuccess);

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        var invRepo = new Mock<IPhysicalInventoryRepository>();
        invRepo
            .Setup(i => i.GetWithLinesAsync(inventory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inventory);

        var handler = new GetInventorySummaryQueryHandler(
            invRepo.Object,
            ProductRepoWithTracking((product.Id, TrackingMode.Lot)).Object,
            tenant.Object);

        var result = await handler.Handle(new GetInventorySummaryQuery(inventory.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.CanValidate);
        Assert.Contains("Prêt à valider", result.Value.StatusMessage);
        Assert.Equal("LOT-OPEN-1", result.Value.ProductsWithDifferenceList.Single().LotNumber);
    }
}
