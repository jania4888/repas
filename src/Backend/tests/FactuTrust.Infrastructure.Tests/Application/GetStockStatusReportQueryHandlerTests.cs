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

        // Le jeu n'est construit QU'UNE fois : les totaux sortent des mêmes lignes que la page,
        // là où le handler relisait tout une seconde fois juste pour sommer.
        var stockRepo = new Mock<IStockItemRepository>(MockBehavior.Strict);
        stockRepo
            .Setup(r => r.GetStockStatusReportPageAsync(
                null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory, 1, 50, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new StockStatusReportPage(
                rows.Take(1).ToList(),
                TotalCount: 2,
                GrandTotalQuantity: rows.Sum(r => r.QuantityOnHand),
                GrandTotalValue: rows.Sum(r => r.StockValue),
                LayeredRowCount: 0,
                DriftRowCount: 0,
                // 28,5 n'est pas 25 × 1,19 : le handler transmet la somme déjà faite, il ne recalcule pas.
                GrandTotalValueTtc: 28.5m));

        var handler = CreateHandler(Guid.NewGuid(), out _, stockRepo);
        var result = await handler.Handle(
            new GetStockStatusReportQuery(null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory, 1, 50),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(25, result.Value.GrandTotalValue);
        Assert.Equal(28.5m, result.Value.GrandTotalValueTtc);
        Assert.NotEqual(25m * 1.19m, result.Value.GrandTotalValueTtc);
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
                .Setup(r => r.GetStockStatusReportPageAsync(
                    It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<bool>(),
                    It.IsAny<StockStatusGroupingMode>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new StockStatusReportPage(
                    new List<StockStatusReportRowDto>(), 0, 0m, 0m, 0, 0, 0m));
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
