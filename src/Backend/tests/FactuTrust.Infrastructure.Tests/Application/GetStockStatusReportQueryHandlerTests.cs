using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using Moq;
using Xunit;
using StockStatusGroupingMode = FactuTrust.Application.DTOs.StockStatusGroupingMode;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class GetStockStatusReportQueryHandlerTests
{
    [Fact]
    public async Task Handle_RejectsWhenTenantMissing()
    {
        var handler = CreateHandler(tenantId: null, out _);
        var result = await handler.Handle(
            new GetStockStatusReportQuery(null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory),
            CancellationToken.None);
        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Handle_RejectsInactiveWarehouse()
    {
        var warehouseId = Guid.NewGuid();
        var warehouse = Warehouse.Create("WH1", "Entrepôt test").Value!;
        warehouse.Deactivate();
        var warehouseRepo = new Mock<IWarehouseRepository>();
        warehouseRepo
            .Setup(r => r.GetByIdAsync(warehouseId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(warehouse);

        var handler = CreateHandler(tenantId: Guid.NewGuid(), out _, warehouseRepo: warehouseRepo);
        var result = await handler.Handle(
            new GetStockStatusReportQuery(warehouseId, null, null, false, StockStatusGroupingMode.WarehouseThenCategory),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Warehouse", result.Error.Code);
    }

    [Fact]
    public async Task Handle_ComputesGrandTotalsFromAllRows()
    {
        var rows = new List<StockStatusReportRowDto>
        {
            new()
            {
                ProductId = Guid.NewGuid(),
                ProductCode = "A",
                ProductName = "Article A",
                CategoryName = "Cat",
                WarehouseId = Guid.NewGuid(),
                WarehouseCode = "WH",
                WarehouseName = "Principal",
                QuantityOnHand = 2,
                UnitCost = 10,
                StockValue = 20
            },
            new()
            {
                ProductId = Guid.NewGuid(),
                ProductCode = "B",
                ProductName = "Article B",
                CategoryName = "Cat",
                WarehouseId = Guid.NewGuid(),
                WarehouseCode = "WH",
                WarehouseName = "Principal",
                QuantityOnHand = 1,
                UnitCost = 5,
                StockValue = 5
            }
        };

        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(r => r.GetStockStatusReportRowsAsync(
                null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory, 1, 50, It.IsAny<CancellationToken>()))
            .ReturnsAsync((rows.Take(1).ToList(), 2));
        stockRepo
            .Setup(r => r.GetStockStatusReportRowsAsync(
                null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory, 1, 2, It.IsAny<CancellationToken>()))
            .ReturnsAsync((rows, 2));

        var handler = CreateHandler(Guid.NewGuid(), out _, stockRepo);
        var result = await handler.Handle(
            new GetStockStatusReportQuery(null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory, 1, 50),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(25, result.Value.GrandTotalValue);
        Assert.Equal(3, result.Value.GrandTotalQuantity);
    }

    private static GetStockStatusReportQueryHandler CreateHandler(
        Guid? tenantId,
        out Mock<IStockItemRepository> stockRepo,
        Mock<IStockItemRepository>? stockRepoOverride = null,
        Mock<IWarehouseRepository>? warehouseRepo = null,
        Mock<IProductCategoryRepository>? categoryRepo = null)
    {
        stockRepo = stockRepoOverride ?? new Mock<IStockItemRepository>();
        if (stockRepoOverride is null)
        {
            stockRepo
                .Setup(r => r.GetStockStatusReportRowsAsync(
                    It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<bool>(),
                    It.IsAny<StockStatusGroupingMode>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((new List<StockStatusReportRowDto>(), 0));
        }

        warehouseRepo ??= new Mock<IWarehouseRepository>();
        categoryRepo ??= new Mock<IProductCategoryRepository>();

        var companyRepo = new Mock<ICompanyRepository>();
        companyRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);

        return new GetStockStatusReportQueryHandler(
            stockRepo.Object,
            warehouseRepo.Object,
            categoryRepo.Object,
            companyRepo.Object,
            tenant.Object,
            TimeProvider.System);
    }
}
