using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Application.Features.WithholdingTax.Queries;
using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Filtre société (EnforceCompanySubmittedOnly) : seules les déclarations Soumise/Verrouillée sont exposées.
/// </summary>
public sealed class GetVatDeclarationCompanyAccessTests
{
    private const string Tnd = "TND";

    private static Mock<ITenantCompanySummaryProvider> CreateTenantSummaryMock()
    {
        var mock = new Mock<ITenantCompanySummaryProvider>();
        mock.Setup(p => p.GetCurrentTenantSummaryAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TenantCompanySummaryDto
            {
                CompanyName = "Ma Société SARL",
                Nif = "1234567/A/B/C/000",
                TaxRegimeDisplay = "Régime réel"
            });
        return mock;
    }

    /// <summary>Aucun cycle de paie : ces tests portent sur l'accès, pas sur les montants.</summary>
    private static PayrollDeclarationContributionProvider CreatePayrollProvider()
    {
        var runs = new Mock<IPayrollRunRepository>();
        runs.Setup(r => r.GetByPeriodAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PayrollRun?)null);

        return new PayrollDeclarationContributionProvider(runs.Object, Mock.Of<IPayrollParametersRepository>());
    }

    private static VatDeclaration DraftEntity() => VatDeclaration.CreateDraft(
        2026, 9,
        Money.Create(100m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
        Money.Zero(Tnd), Money.Zero(Tnd), Money.Zero(Tnd), Tnd);

    private static GetVatDeclarationQueryHandler BuildHandler(Mock<IVatDeclarationRepository> vatRepo, Mock<IMediator> mediator)
    {
        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        var invoices = new Mock<IInvoiceRepository>();
        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        var settings = Options.Create(new AccountingSettings { MonthlyDeclarationV2Enabled = true });

        return new GetVatDeclarationQueryHandler(
            mediator.Object,
            vatRepo.Object,
            journals.Object,
            invoices.Object,
            supplierInvoices.Object,
            CreateTenantSummaryMock().Object,
            CreatePayrollProvider(),
            MonthlyDeclarationTestComposer.NoFamilyIncluded(settings),
            settings);
    }

    private static Mock<IMediator> BuildMediator()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 9, new(), 0m, 0m, 0));
        return mediator;
    }

    [Fact]
    public async Task FlagOff_NullSaved_SucceedsAsDraft()
    {
        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);
        var mediator = BuildMediator();

        var result = await BuildHandler(vatRepo, mediator)
            .Handle(new GetVatDeclarationQuery(2026, 9, EnforceCompanySubmittedOnly: false), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.Status);
        mediator.Verify(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task FlagOn_NullSaved_FailsNotSubmitted_WithoutRecalc()
    {
        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(2026, 9, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);
        var mediator = BuildMediator();

        var result = await BuildHandler(vatRepo, mediator)
            .Handle(new GetVatDeclarationQuery(2026, 9, EnforceCompanySubmittedOnly: true), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(VatDeclarationAccess.NotSubmittedErrorCode, result.Error.Code);
        Assert.Equal(VatDeclarationAccess.NotSubmittedMessage, result.Error.Description);
        mediator.Verify(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task FlagOn_Draft_FailsNotSubmitted()
    {
        var draft = DraftEntity();
        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(2026, 9, It.IsAny<CancellationToken>()))
            .ReturnsAsync(draft);
        var mediator = BuildMediator();

        var result = await BuildHandler(vatRepo, mediator)
            .Handle(new GetVatDeclarationQuery(2026, 9, EnforceCompanySubmittedOnly: true), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(VatDeclarationAccess.NotSubmittedErrorCode, result.Error.Code);
        mediator.Verify(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task FlagOn_Submitted_Succeeds()
    {
        var submitted = DraftEntity();
        submitted.Submit();
        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(submitted);
        var mediator = BuildMediator();

        var result = await BuildHandler(vatRepo, mediator)
            .Handle(new GetVatDeclarationQuery(2026, 9, EnforceCompanySubmittedOnly: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Status);
    }

    [Fact]
    public async Task FlagOn_Locked_Succeeds()
    {
        var locked = DraftEntity();
        locked.Submit();
        locked.Lock();
        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(locked);
        var mediator = BuildMediator();

        var result = await BuildHandler(vatRepo, mediator)
            .Handle(new GetVatDeclarationQuery(2026, 9, EnforceCompanySubmittedOnly: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Status);
    }
}
