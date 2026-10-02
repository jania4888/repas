using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Domain.Entities;
using Moq;
using Xunit;
using StockStatusGroupingMode = FactuTrust.Application.DTOs.StockStatusGroupingMode;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class ExportStockStatusPdfQueryHandlerTests
{
    [Fact]
    public async Task Handle_ReturnsNoData_WhenCountIsZero()
    {
        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(r => r.CountStockStatusReportRowsAsync(
                It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);

        var handler = CreateHandler(stockRepo);
        var result = await handler.Handle(
            new ExportStockStatusPdfQuery(null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(StockStatusReportConstants.EmptyReportMessage, result.Error.Description);
    }

    [Fact]
    public async Task Handle_ReturnsTooManyLines_WhenAbovePdfCap()
    {
        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(r => r.CountStockStatusReportRowsAsync(
                It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(StockStatusReportConstants.MaxLinesForPdf + 1);

        var handler = CreateHandler(stockRepo);
        var result = await handler.Handle(
            new ExportStockStatusPdfQuery(null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(StockStatusReportConstants.TooManyLinesForPdfMessage, result.Error.Description);
    }

    [Fact]
    public async Task Handle_LogsAuditOnSuccess()
    {
        var stockRepo = new Mock<IStockItemRepository>();
        stockRepo
            .Setup(r => r.CountStockStatusReportRowsAsync(
                It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);
        stockRepo
            .Setup(r => r.GetStockStatusReportRowsAsync(
                It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<bool>(),
                It.IsAny<StockStatusGroupingMode>(), 1, 1, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new List<StockStatusReportRowDto>
            {
                new()
                {
                    ProductId = Guid.NewGuid(),
                    ProductCode = "P1",
                    ProductName = "Produit",
                    CategoryName = "Cat",
                    WarehouseId = Guid.NewGuid(),
                    WarehouseCode = "W1",
                    WarehouseName = "Magasin",
                    QuantityOnHand = 1,
                    UnitCost = 1,
                    StockValue = 1
                }
            }, 1));

        var audit = new Mock<IAuditService>();
        var handler = CreateHandler(stockRepo, audit: audit);
        var result = await handler.Handle(
            new ExportStockStatusPdfQuery(null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        audit.Verify(
            a => a.LogAsync(
                AuditActions.Export.Pdf,
                "StockStatusReport",
                null,
                null,
                null,
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    private static ExportStockStatusPdfQueryHandler CreateHandler(
        Mock<IStockItemRepository> stockRepo,
        Mock<IAuditService>? audit = null)
    {
        var warehouseRepo = new Mock<IWarehouseRepository>();
        var categoryRepo = new Mock<IProductCategoryRepository>();
        var companyRepo = new Mock<ICompanyRepository>();
        companyRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

        var pdf = new Mock<IPdfService>();
        pdf.Setup(p => p.GenerateStockStatusReportPdfAsync(It.IsAny<StockStatusPdfContext>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new byte[] { 1, 2, 3 });

        audit ??= new Mock<IAuditService>();

        return new ExportStockStatusPdfQueryHandler(
            stockRepo.Object,
            warehouseRepo.Object,
            categoryRepo.Object,
            companyRepo.Object,
            pdf.Object,
            audit.Object,
            TimeProvider.System);
    }
}
