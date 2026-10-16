using System.Globalization;
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
        SetupPage(stockRepo, new List<StockStatusReportRowDto>(), totalCount: 0);

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
        SetupPage(stockRepo, OneRow(), totalCount: StockStatusReportConstants.MaxLinesForPdf + 1);

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
        SetupPage(stockRepo, OneRow(), totalCount: 1);

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

    [Theory]
    [InlineData("fr-FR", "État de stock", "Par catégorie puis entrepôt", false)]
    [InlineData("ar-TN", "حالة المخزون", "حسب الفئة ثم المستودع", true)]
    public async Task Handle_PassesLocalizedPdfContext(string culture, string title, string grouping, bool rightToLeft)
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(culture);
        try
        {
            var stockRepo = new Mock<IStockItemRepository>();
            SetupPage(stockRepo, OneRow(), totalCount: 1);

            StockStatusPdfContext? captured = null;
            var pdf = new Mock<IPdfService>();
            pdf.Setup(p => p.GenerateStockStatusReportPdfAsync(It.IsAny<StockStatusPdfContext>(), It.IsAny<CancellationToken>()))
                .Callback<StockStatusPdfContext, CancellationToken>((context, _) => captured = context)
                .ReturnsAsync(new byte[] { 1, 2, 3 });

            var handler = CreateHandler(stockRepo, pdf: pdf);
            var result = await handler.Handle(
                new ExportStockStatusPdfQuery(null, null, "ماء%", false, StockStatusGroupingMode.CategoryThenWarehouse),
                CancellationToken.None);

            Assert.True(result.IsSuccess);
            Assert.StartsWith("Etat_stock_", result.Value.FileName);
            Assert.EndsWith(".pdf", result.Value.FileName);
            Assert.NotNull(captured);
            Assert.Equal(title, captured!.Title);
            Assert.Equal(grouping, captured.GroupingModeLabel);
            Assert.Equal(rightToLeft, captured.RightToLeft);
            Assert.Equal(1m, captured.GrandTotalValue);
            Assert.Equal(1.19m, captured.GrandTotalValueTtc);
            Assert.Contains("ماء[%]", captured.FiltersSummary);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public async Task Handle_ReturnsArabicNoDataMessage_WhenUiIsArabic()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar-TN");
        try
        {
            var stockRepo = new Mock<IStockItemRepository>();
            SetupPage(stockRepo, new List<StockStatusReportRowDto>(), totalCount: 0);

            var handler = CreateHandler(stockRepo);
            var result = await handler.Handle(
                new ExportStockStatusPdfQuery(null, null, null, false, StockStatusGroupingMode.WarehouseThenCategory),
                CancellationToken.None);

            Assert.True(result.IsFailure);
            Assert.Equal("NoData", result.Error.Code);
            Assert.Equal("لا توجد أصناف في المخزون لهذه المعايير.", result.Error.Description);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    /// <summary>
    /// Amorce le dépôt sur la nouvelle API : UNE seule construction du jeu, totaux compris.
    /// Le handler comptait puis relisait tout ; il ne fait plus qu'un appel.
    /// </summary>
    private static void SetupPage(
        Mock<IStockItemRepository> stockRepo,
        List<StockStatusReportRowDto> rows,
        int totalCount)
    {
        stockRepo
            .Setup(r => r.GetStockStatusReportPageAsync(
                It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<bool>(),
                It.IsAny<StockStatusGroupingMode>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new StockStatusReportPage(
                rows,
                totalCount,
                rows.Sum(r => r.QuantityOnHand),
                rows.Sum(r => r.StockValue),
                rows.Count(r => r.UnitCostIsNextExit),
                0,
                rows.Sum(r => r.StockValueTtc)));
    }

    private static List<StockStatusReportRowDto> OneRow() =>
    [
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
            StockValue = 1,
            VatRatePercent = 19,
            StockValueTtc = 1.19m
        }
    ];

    private static ExportStockStatusPdfQueryHandler CreateHandler(
        Mock<IStockItemRepository> stockRepo,
        Mock<IAuditService>? audit = null,
        Mock<IPdfService>? pdf = null)
    {
        var warehouseRepo = new Mock<IWarehouseRepository>();
        var categoryRepo = new Mock<IProductCategoryRepository>();
        var companyRepo = new Mock<ICompanyRepository>();
        companyRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

        if (pdf is null)
        {
            pdf = new Mock<IPdfService>();
            pdf.Setup(p => p.GenerateStockStatusReportPdfAsync(It.IsAny<StockStatusPdfContext>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new byte[] { 1, 2, 3 });
        }

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
