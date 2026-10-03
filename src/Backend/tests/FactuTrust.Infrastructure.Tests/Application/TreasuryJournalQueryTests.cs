using System.Globalization;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.CashDesk;
using FactuTrust.Application.Features.CashDesk.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class TreasuryJournalQueryTests
{
    private static readonly DateTime Day = new(2026, 9, 1);

    [Fact]
    public async Task Handle_RejectsPeriodLongerThan366Days()
    {
        var repo = new Mock<ICashOperationRepository>(MockBehavior.Strict);
        var handler = new GetTreasuryJournalQueryHandler(repo.Object, Mock.Of<IPaymentRepository>(), Mock.Of<ISupplierPaymentRepository>());

        var result = await handler.Handle(
            new GetTreasuryJournalQuery(Day, Day.AddDays(TreasuryJournalConstants.MaxPeriodDays), null),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(TreasuryJournalConstants.PeriodTooLongMessage, result.Error.Description);
    }

    [Fact]
    public async Task Handle_RejectsUnknownPaymentMethod()
    {
        var repo = new Mock<ICashOperationRepository>(MockBehavior.Strict);
        var handler = new GetTreasuryJournalQueryHandler(repo.Object, Mock.Of<IPaymentRepository>(), Mock.Of<ISupplierPaymentRepository>());

        var result = await handler.Handle(
            new GetTreasuryJournalQuery(Day, Day, (PaymentMethod)999),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(TreasuryJournalConstants.InvalidMethodMessage, result.Error.Description);
    }

    [Fact]
    public async Task Handle_UsesPeriodAggregates_NotTheCurrentPage()
    {
        var repo = new Mock<ICashOperationRepository>();
        repo.Setup(r => r.GetNonCancelledJournalCategoryTotalsAsync(Day, Day, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[]
            {
                new CashJournalCategoryTotal(CashOperationType.Credit, (int)CashRevenueCategory.CashSalesReceipt, 4, 1000m),
                new CashJournalCategoryTotal(CashOperationType.Debit, (int)CashExpenseCategory.BankDeposit, 1, 40m)
            });
        repo.Setup(r => r.GetNonCancelledJournalLinesAsync(Day, Day, null, 1, TreasuryJournalConstants.MaxPageSize, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Array.Empty<CashOperation>(), 5));

        var handler = new GetTreasuryJournalQueryHandler(repo.Object, Mock.Of<IPaymentRepository>(), Mock.Of<ISupplierPaymentRepository>());
        var result = await handler.Handle(
            new GetTreasuryJournalQuery(Day, Day, null, 1, 999),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1000m, result.Value.TotalCredits);
        Assert.Equal(40m, result.Value.TotalDebits);
        Assert.Equal(960m, result.Value.Balance);
        Assert.Equal(5, result.Value.OperationCount);
        Assert.Empty(result.Value.Lines.Items);
        var deposit = Assert.Single(result.Value.Groups, g => g.Category == (int)CashExpenseCategory.BankDeposit);
        Assert.Equal((int)CashOperationType.Debit, deposit.OperationType);
        Assert.Equal(40m, deposit.Total);
        Assert.Equal((int)CashOperationType.Credit, result.Value.Groups[0].OperationType);
    }

    [Fact]
    public async Task Export_RejectsWhenLineCountExceedsPdfCap()
    {
        var repo = new Mock<ICashOperationRepository>();
        repo.Setup(r => r.GetNonCancelledJournalCategoryTotalsAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<CashJournalCategoryTotal>());
        repo.Setup(r => r.GetNonCancelledJournalLinesAsync(
                It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, 1, TreasuryJournalConstants.MaxLinesForPdf, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Array.Empty<CashOperation>(), TreasuryJournalConstants.MaxLinesForPdf + 1));
        var pdf = new Mock<IPdfService>(MockBehavior.Strict);

        var handler = new ExportTreasuryJournalPdfQueryHandler(
            repo.Object,
            Mock.Of<ICompanyRepository>(),
            pdf.Object,
            Mock.Of<IAuditService>());

        var result = await handler.Handle(new ExportTreasuryJournalPdfQuery(Day, Day, null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(TreasuryJournalConstants.TooManyLinesForPdfMessage, result.Error.Description);
    }

    [Theory]
    [InlineData("fr-FR", "Journal de trésorerie", false)]
    [InlineData("ar-TN", "يومية الخزينة", true)]
    public async Task Export_PassesLocalizedTitle(string culture, string title, bool rightToLeft)
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo(culture);
        try
        {
            var repo = new Mock<ICashOperationRepository>();
            repo.Setup(r => r.GetNonCancelledJournalCategoryTotalsAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, It.IsAny<CancellationToken>()))
                .ReturnsAsync(Array.Empty<CashJournalCategoryTotal>());
            repo.Setup(r => r.GetNonCancelledJournalLinesAsync(
                    It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, 1, TreasuryJournalConstants.MaxLinesForPdf, It.IsAny<CancellationToken>()))
                .ReturnsAsync((Array.Empty<CashOperation>(), 0));

            TreasuryJournalPdfDocument? captured = null;
            var pdf = new Mock<IPdfService>();
            pdf.Setup(p => p.GenerateTreasuryJournalPdfAsync(It.IsAny<TreasuryJournalPdfDocument>(), It.IsAny<CancellationToken>()))
                .Callback<TreasuryJournalPdfDocument, CancellationToken>((document, _) => captured = document)
                .ReturnsAsync(new byte[] { 0x25, 0x50, 0x44, 0x46 });

            var companies = new Mock<ICompanyRepository>();
            companies.Setup(c => c.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Company?)null);

            var handler = new ExportTreasuryJournalPdfQueryHandler(repo.Object, companies.Object, pdf.Object, Mock.Of<IAuditService>());
            var result = await handler.Handle(new ExportTreasuryJournalPdfQuery(Day, Day, null), CancellationToken.None);

            Assert.True(result.IsSuccess);
            Assert.StartsWith("journal-tresorerie_", result.Value.FileName);
            Assert.EndsWith(".pdf", result.Value.FileName);
            Assert.NotNull(captured);
            Assert.Equal(title, captured!.Title);
            Assert.Equal(rightToLeft, captured.RightToLeft);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void FrenchCategoryLabels_MatchDomainDisplayStrings()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo("fr-FR");
        try
        {
            foreach (var category in Enum.GetValues<CashExpenseCategory>())
                Assert.Equal(category.ToDisplayString(), TreasuryJournalLabels.Expense(category));
            foreach (var category in Enum.GetValues<CashRevenueCategory>())
                Assert.Equal(category.ToDisplayString(), TreasuryJournalLabels.Revenue(category));
            foreach (var method in Enum.GetValues<PaymentMethod>())
                Assert.Equal(method.ToDisplayString(), TreasuryJournalLabels.Method(method));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void ArabicCategoryLabels_DifferFromFrench()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo("ar-TN");
        try
        {
            foreach (var category in Enum.GetValues<CashExpenseCategory>())
                Assert.NotEqual(category.ToDisplayString(), TreasuryJournalLabels.Expense(category));
            Assert.Equal("يومية الخزينة", TreasuryJournalLabels.Title());
            Assert.Equal("إيداع في البنك", TreasuryJournalLabels.Expense(CashExpenseCategory.BankDeposit));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }
}
