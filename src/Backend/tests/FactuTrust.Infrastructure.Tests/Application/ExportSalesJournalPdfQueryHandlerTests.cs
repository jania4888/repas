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

public sealed class ExportSalesJournalPdfQueryHandlerTests
{
    [Fact]
    public async Task Handle_RejectsDetailPeriodLongerThan366Days()
    {
        var from = new DateTime(2025, 1, 1);
        var to = from.AddDays(SalesJournalReportConstants.MaxDetailPeriodDays);
        var handler = CreateHandler();

        var result = await handler.Handle(
            new ExportSalesJournalPdfQuery(from, to, SalesJournalViewMode.Detail),
            CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Handle_ReturnsNoData_WhenCountIsZero()
    {
        var invoiceRepo = new Mock<IInvoiceRepository>();
        invoiceRepo
            .Setup(r => r.CountSalesJournalDetailAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);

        var handler = CreateHandler(invoiceRepo: invoiceRepo);
        var day = new DateTime(2026, 3, 1);

        var result = await handler.Handle(
            new ExportSalesJournalPdfQuery(day, day, SalesJournalViewMode.Detail),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(SalesJournalReportConstants.EmptyPeriodMessage, result.Error.Description);
    }

    [Fact]
    public async Task Handle_ReturnsTooManyLines_WhenAbovePdfCap()
    {
        var invoiceRepo = new Mock<IInvoiceRepository>();
        invoiceRepo
            .Setup(r => r.CountSalesJournalDetailAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(SalesJournalReportConstants.MaxLinesForPdf + 1);

        var handler = CreateHandler(invoiceRepo: invoiceRepo);
        var day = new DateTime(2026, 3, 1);

        var result = await handler.Handle(
            new ExportSalesJournalPdfQuery(day, day, SalesJournalViewMode.Detail),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(SalesJournalReportConstants.TooManyLinesForPdfMessage, result.Error.Description);
    }

    [Fact]
    public async Task Handle_UsesArabicLabels_WhenUiCultureIsArabic()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar-TN");
        try
        {
            var invoiceRepo = new Mock<IInvoiceRepository>();
            invoiceRepo
                .Setup(r => r.CountSalesJournalDetailAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
                .ReturnsAsync(0);
            var handler = CreateHandler(invoiceRepo: invoiceRepo);
            var day = new DateTime(2026, 3, 1);

            var empty = await handler.Handle(
                new ExportSalesJournalPdfQuery(day, day, SalesJournalViewMode.Detail),
                CancellationToken.None);

            Assert.True(empty.IsFailure);
            Assert.Equal("NoData", empty.Error.Code);
            Assert.NotEqual(SalesJournalReportConstants.EmptyPeriodMessage, empty.Error.Description);
            Assert.Equal(SalesJournalLabels.EmptyPeriod(), empty.Error.Description);

            SalesJournalPdfContext? captured = null;
            var pdf = new Mock<IPdfService>();
            pdf.Setup(p => p.GenerateSalesJournalReportPdfAsync(It.IsAny<SalesJournalPdfContext>(), It.IsAny<CancellationToken>()))
                .Callback<SalesJournalPdfContext, CancellationToken>((context, _) => captured = context)
                .ReturnsAsync(new byte[] { 1, 2, 3 });
            invoiceRepo
                .Setup(r => r.CountSalesJournalDetailAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
                .ReturnsAsync(1);
            invoiceRepo
                .Setup(r => r.GetSalesJournalDetailAllAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Array.Empty<SalesJournalDetailRowDto>());
            invoiceRepo
                .Setup(r => r.GetSalesJournalDetailTotalsAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
                .ReturnsAsync(new SalesJournalTotalsDto { Currency = "TND" });

            var successHandler = CreateHandler(invoiceRepo: invoiceRepo, pdf: pdf);
            var success = await successHandler.Handle(
                new ExportSalesJournalPdfQuery(day, day, SalesJournalViewMode.Detail),
                CancellationToken.None);

            Assert.True(success.IsSuccess);
            Assert.NotNull(captured);
            Assert.True(captured!.RightToLeft);
            Assert.Equal("يومية المبيعات", captured.Title);
            Assert.Equal("التفاصيل", captured.ViewModeLabel);
            Assert.StartsWith("Journal_ventes_", success.Value.FileName);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static ExportSalesJournalPdfQueryHandler CreateHandler(
        Mock<IInvoiceRepository>? invoiceRepo = null,
        Mock<IPdfService>? pdf = null)
    {
        invoiceRepo ??= new Mock<IInvoiceRepository>();
        var clientRepo = new Mock<IClientRepository>();
        var companyRepo = new Mock<ICompanyRepository>();
        companyRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

        if (pdf is null)
        {
            pdf = new Mock<IPdfService>();
            pdf.Setup(p => p.GenerateSalesJournalReportPdfAsync(It.IsAny<SalesJournalPdfContext>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new byte[] { 1, 2, 3 });
        }

        var audit = new Mock<IAuditService>();

        return new ExportSalesJournalPdfQueryHandler(
            invoiceRepo.Object,
            clientRepo.Object,
            companyRepo.Object,
            pdf.Object,
            audit.Object);
    }
}
