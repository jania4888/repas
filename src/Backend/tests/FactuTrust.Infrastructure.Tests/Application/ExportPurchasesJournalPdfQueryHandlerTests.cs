using System.Globalization;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class ExportPurchasesJournalPdfQueryHandlerTests
{
    [Fact]
    public async Task Handle_RejectsDetailPeriodLongerThan366Days()
    {
        var from = new DateTime(2025, 1, 1);
        var to = from.AddDays(PurchasesJournalReportConstants.MaxDetailPeriodDays);
        var handler = CreateHandler();

        var result = await handler.Handle(
            new ExportPurchasesJournalPdfQuery(from, to, SalesJournalViewMode.Detail, PurchasesJournalSource.SupplierInvoice),
            CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Handle_ReturnsNoData_WhenCountIsZero()
    {
        var invoiceRepo = new Mock<ISupplierInvoiceRepository>();
        invoiceRepo
            .Setup(r => r.CountPurchasesJournalDetailAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);

        var handler = CreateHandler(invoiceRepo: invoiceRepo);
        var day = new DateTime(2026, 3, 1);

        var result = await handler.Handle(
            new ExportPurchasesJournalPdfQuery(day, day, SalesJournalViewMode.Detail, PurchasesJournalSource.SupplierInvoice),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(PurchasesJournalReportConstants.EmptyPeriodMessage, result.Error.Description);
    }

    [Fact]
    public async Task Handle_ReturnsTooManyLines_WhenAbovePdfCap()
    {
        var invoiceRepo = new Mock<ISupplierInvoiceRepository>();
        invoiceRepo
            .Setup(r => r.CountPurchasesJournalDetailAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(PurchasesJournalReportConstants.MaxLinesForPdf + 1);

        var handler = CreateHandler(invoiceRepo: invoiceRepo);
        var day = new DateTime(2026, 3, 1);

        var result = await handler.Handle(
            new ExportPurchasesJournalPdfQuery(day, day, SalesJournalViewMode.Detail, PurchasesJournalSource.SupplierInvoice),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(PurchasesJournalReportConstants.TooManyLinesForPdfMessage, result.Error.Description);
    }

    [Theory]
    [InlineData("fr-FR", "Journal d'achats", false)]
    [InlineData("ar-TN", "يومية المشتريات", true)]
    public async Task Export_PassesLocalizedTitle(string culture, string title, bool rightToLeft)
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(culture);
        try
        {
            var invoiceRepo = new Mock<ISupplierInvoiceRepository>();
            invoiceRepo
                .Setup(r => r.CountPurchasesJournalDetailAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
                .ReturnsAsync(1);
            invoiceRepo
                .Setup(r => r.GetPurchasesJournalDetailAllAsync(
                    It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Array.Empty<PurchasesJournalDetailRowDto>());
            invoiceRepo
                .Setup(r => r.GetPurchasesJournalDetailTotalsAsync(
                    It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
                .ReturnsAsync(new PurchasesJournalTotalsDto { Currency = "TND" });

            PurchasesJournalPdfContext? captured = null;
            var pdf = new Mock<IPdfService>();
            pdf.Setup(p => p.GeneratePurchasesJournalReportPdfAsync(It.IsAny<PurchasesJournalPdfContext>(), It.IsAny<CancellationToken>()))
                .Callback<PurchasesJournalPdfContext, CancellationToken>((document, _) => captured = document)
                .ReturnsAsync(new byte[] { 0x25, 0x50, 0x44, 0x46 });

            var companyRepo = new Mock<ICompanyRepository>();
            companyRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

            var handler = new ExportPurchasesJournalPdfQueryHandler(
                invoiceRepo.Object,
                new Mock<IPurchaseReceiptRepository>().Object,
                new Mock<ISupplierRepository>().Object,
                companyRepo.Object,
                pdf.Object,
                new Mock<IAuditService>().Object);

            var day = new DateTime(2026, 4, 10);
            var result = await handler.Handle(
                new ExportPurchasesJournalPdfQuery(day, day, SalesJournalViewMode.Detail, PurchasesJournalSource.SupplierInvoice),
                CancellationToken.None);

            Assert.True(result.IsSuccess);
            Assert.StartsWith("Journal_achats_", result.Value.FileName);
            Assert.EndsWith(".pdf", result.Value.FileName);
            Assert.DoesNotContain("يومية", result.Value.FileName);
            Assert.NotNull(captured);
            Assert.Equal(title, captured!.Title);
            Assert.Equal(rightToLeft, captured.RightToLeft);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static ExportPurchasesJournalPdfQueryHandler CreateHandler(Mock<ISupplierInvoiceRepository>? invoiceRepo = null)
    {
        invoiceRepo ??= new Mock<ISupplierInvoiceRepository>();
        var receiptRepo = new Mock<IPurchaseReceiptRepository>();
        var supplierRepo = new Mock<ISupplierRepository>();
        var companyRepo = new Mock<ICompanyRepository>();
        companyRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

        var pdf = new Mock<IPdfService>();
        pdf.Setup(p => p.GeneratePurchasesJournalReportPdfAsync(It.IsAny<PurchasesJournalPdfContext>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new byte[] { 1, 2, 3 });

        var audit = new Mock<IAuditService>();

        return new ExportPurchasesJournalPdfQueryHandler(
            invoiceRepo.Object,
            receiptRepo.Object,
            supplierRepo.Object,
            companyRepo.Object,
            pdf.Object,
            audit.Object);
    }
}
