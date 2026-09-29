using System.Text.Json;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Application.Features.WithholdingTax.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Payroll;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class GetVatDeclarationV2Tests
{
    private static Mock<ITenantCompanySummaryProvider> CreateTenantSummaryMock(
        TenantCompanySummaryDto? summary = null)
    {
        var mock = new Mock<ITenantCompanySummaryProvider>();
        mock.Setup(p => p.GetCurrentTenantSummaryAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(summary ?? new TenantCompanySummaryDto
            {
                CompanyName = "Ma Société SARL",
                Nif = "1234567/A/B/C/000",
                TaxRegimeDisplay = "Régime réel",
                TradeName = "Commerce"
            });
        return mock;
    }

    /// <summary>
    /// Fournisseur réel monté sur des dépôts simulés : la logique de sélection du cycle et de
    /// dérivation de l'assiette est celle de production, seules les données sont contrôlées.
    /// </summary>
    private static PayrollDeclarationContributionProvider CreatePayrollProvider(
        PayrollRun? run = null,
        PayrollYearParameters? parameters = null)
    {
        var runs = new Mock<IPayrollRunRepository>();
        runs.Setup(r => r.GetByPeriodAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(run);

        var settings = new Mock<IPayrollParametersRepository>();
        settings.Setup(r => r.GetByFiscalYearAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(parameters);

        return new PayrollDeclarationContributionProvider(runs.Object, settings.Object);
    }

    /// <summary>
    /// Cycle de paie porteur de totaux figés. Le workflow réel (SetPayslips → Validate → Close)
    /// exigerait des bulletins complets ; on positionne directement les totaux, qui sont la seule
    /// chose que la déclaration consomme.
    /// </summary>
    private static PayrollRun PayrollRunWith(
        PayrollRunStatus status,
        decimal tfp = 1.680m,
        decimal foprolos = 1.680m,
        decimal irpp = 0m,
        decimal css = 0m,
        decimal gross = 168.000m,
        decimal netTaxable = 0m)
    {
        var run = PayrollRun.Create(2026, 7, 2026).Value;
        Set(run, nameof(PayrollRun.Status), status);
        Set(run, nameof(PayrollRun.TotalTfp), tfp);
        Set(run, nameof(PayrollRun.TotalFoprolos), foprolos);
        Set(run, nameof(PayrollRun.TotalIrpp), irpp);
        Set(run, nameof(PayrollRun.TotalCss), css);
        Set(run, nameof(PayrollRun.TotalGross), gross);
        Set(run, nameof(PayrollRun.TotalNetTaxable), netTaxable);
        return run;

        static void Set(PayrollRun target, string property, object value) =>
            typeof(PayrollRun).GetProperty(property)!.SetValue(target, value);
    }

    /// <summary>Exercice paramétré en secteur industriel : TFP 1 %, FOPROLOS 1 %.</summary>
    private static PayrollYearParameters IndustrialParameters()
    {
        var parameters = PayrollParameterDefaults.CreateDefaults(2026).Value;
        Set(nameof(PayrollYearParameters.IsIndustrialSector), true);
        Set(nameof(PayrollYearParameters.TfpRateIndustry), 1m);
        Set(nameof(PayrollYearParameters.FoprolosRate), 1m);
        return parameters;

        void Set(string property, object value) =>
            typeof(PayrollYearParameters).GetProperty(property)!.SetValue(parameters, value);
    }

    [Fact]
    public async Task Handle_V2_AutoComputesFodecTclTimbreAndRs()
    {
        var mediator = new Mock<IMediator>();
        var salesRows = new List<SalesVatReportRowDto>
        {
            new() { VatRatePercent = 19, VatRateDisplay = "19 %", TotalVatAmount = 190m, TotalTaxableAmount = 1000m, Currency = "TND" }
        };
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(salesRows));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 7, new(), 0m, 40m, 0));

        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var invoices = new Mock<IInvoiceRepository>();
        invoices.Setup(r => r.SumFiscalStampAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(12m);
        invoices.Setup(r => r.SumFodecAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(10m);
        invoices.Setup(r => r.SumFodecTaxableBaseAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1000m);

        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = true,
            FodecRatePercent = 1.0m,
            TclRatePercent = 0.2m
        });

        var tenantSummary = CreateTenantSummaryMock();
        var handler = new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object, tenantSummary.Object, CreatePayrollProvider(), MonthlyDeclarationTestComposer.Inactive(settings), settings);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var dto = result.Value;
        Assert.Equal(10m, dto.Fodec);
        Assert.Equal(1000m, dto.FodecTaxableBase);
        Assert.Equal(2.38m, dto.Tcl);
        Assert.Equal(12m, dto.DroitTimbre);
        Assert.Equal(40m, dto.WithholdingTax);
        Assert.True(dto.MonthlyDeclarationV2Enabled);
        Assert.Equal(254.38m, dto.TotalToPay);
        Assert.Equal(1000m, dto.SalesTaxableBase);
        Assert.Equal(1190m, dto.SalesGrossBase);
        // Taux configurés exposés pour l'affichage / la valeur suggérée à l'écran.
        Assert.Equal(1.0m, dto.FodecRatePercent);
        Assert.Equal(0.2m, dto.TclRatePercent);
        // Assiette légale : la déclaration ne consomme que les factures éligibles (hors brouillon/annulée).
        mediator.Verify(m => m.Send(It.Is<GetSalesVatReportQuery>(q => q.RealizedOnly), It.IsAny<CancellationToken>()), Times.Once);
        mediator.Verify(m => m.Send(It.Is<GetPurchasesVatReportQuery>(q => q.RealizedOnly), It.IsAny<CancellationToken>()), Times.Once);
        Assert.Equal(new DateTime(2026, 8, 22), dto.FilingDeadline);
        Assert.Equal("Déclaration mensuelle unique", dto.DeclarationTypeDisplay);
        Assert.Equal(3, dto.CollectedVatBreakdown.Count);
        Assert.Equal(1000m, dto.CollectedVatBreakdown.First(r => r.RatePercent == 19).TaxableBase);
        Assert.Equal(190m, dto.CollectedVatBreakdown.First(r => r.RatePercent == 19).VatAmount);
        Assert.Equal("Ma Société SARL", dto.CompanyName);
        Assert.Equal("1234567/A/B/C/000", dto.Nif);
        Assert.Equal("Régime réel", dto.TaxRegimeDisplay);
    }

    [Fact]
    public async Task Handle_DeductibleAssets_DerivedFromSupplierInvoiceLines_NotJournal()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>
            {
                new() { VatRatePercent = 19, VatRateDisplay = "19 %", TotalVatAmount = 300m, TotalTaxableAmount = 2000m, Currency = "TND" }
            }));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 7, new(), 0m, 0m, 0));

        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(999m); // ne doit PAS être utilisé quand des lignes immobilisation existent
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var invoices = new Mock<IInvoiceRepository>();
        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(120m);

        var settings = Options.Create(new AccountingSettings { MonthlyDeclarationV2Enabled = true });
        var tenantSummary = CreateTenantSummaryMock();

        var handler = new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object, tenantSummary.Object, CreatePayrollProvider(), MonthlyDeclarationTestComposer.Inactive(settings), settings);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // TVA immobilisations issue des lignes de facture fournisseur, biens = total − immobilisations.
        Assert.Equal(120m, result.Value.DeductibleVatAssets);
        Assert.Equal(180m, result.Value.DeductibleVatGoods);
        journals.Verify(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_DeductibleAssets_FallsBackToJournal_WhenNoFixedAssetLines()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>
            {
                new() { VatRatePercent = 19, VatRateDisplay = "19 %", TotalVatAmount = 300m, TotalTaxableAmount = 2000m, Currency = "TND" }
            }));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 7, new(), 0m, 0m, 0));

        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync("43662", It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(50m);
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var invoices = new Mock<IInvoiceRepository>();
        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m); // aucune ligne immobilisation → repli journal

        var settings = Options.Create(new AccountingSettings { MonthlyDeclarationV2Enabled = true });
        var tenantSummary = CreateTenantSummaryMock();

        var handler = new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object, tenantSummary.Object, CreatePayrollProvider(), MonthlyDeclarationTestComposer.Inactive(settings), settings);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(50m, result.Value.DeductibleVatAssets);
        Assert.Equal(250m, result.Value.DeductibleVatGoods);
    }

    [Fact]
    public async Task Handle_SavedDeclaration_IncludesMetadata()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>()));
        // Le recalcul temps réel tourne désormais même sur une déclaration enregistrée : c'est lui
        // qui alimente la valeur suggérée et donc l'écart affiché.
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2024, 5, new(), 0m, 0m, 0));

        var createdAt = new DateTime(2024, 6, 1, 10, 30, 0, DateTimeKind.Utc);
        var saved = VatDeclaration.CreateDraft(
            2024, 5,
            Money.Create(100m, "TND"), Money.Create(0m, "TND"), Money.Create(0m, "TND"),
            Money.Create(0m, "TND"), Money.Create(0m, "TND"), Money.Create(0m, "TND"));
        saved.GetType().GetProperty("CreatedAt")!.SetValue(saved, createdAt);
        saved.GetType().GetProperty("CreatedBy")!.SetValue(saved, "admin@test.com");

        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(2024, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(saved);
        vatRepo.Setup(r => r.GetByYearMonthAsync(2024, 4, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

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
        var tenantSummary = CreateTenantSummaryMock();

        var handler = new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object, tenantSummary.Object, CreatePayrollProvider(), MonthlyDeclarationTestComposer.Inactive(settings), settings);
        var result = await handler.Handle(new GetVatDeclarationQuery(2024, 5), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(createdAt, result.Value.CreatedAt);
        Assert.Equal("admin@test.com", result.Value.CreatedBy);
        Assert.Equal(new DateTime(2024, 6, 22), result.Value.FilingDeadline);
    }

    [Fact]
    public void VatFilingDeadline_ForPeriod_May2024_ReturnsJune22()
    {
        Assert.Equal(new DateTime(2024, 6, 22), VatFilingDeadline.ForPeriod(2024, 5));
    }

    [Fact]
    public async Task Handle_V2Disabled_LeavesOtherTaxesZero()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>
            {
                new() { VatRatePercent = 19, VatRateDisplay = "19 %", TotalVatAmount = 190m, TotalTaxableAmount = 1000m, Currency = "TND" }
            }));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>()));

        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);
        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        var invoices = new Mock<IInvoiceRepository>();
        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        var settings = Options.Create(new AccountingSettings { MonthlyDeclarationV2Enabled = false });
        var tenantSummary = CreateTenantSummaryMock();

        var handler = new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object, tenantSummary.Object, CreatePayrollProvider(), MonthlyDeclarationTestComposer.Inactive(settings), settings);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0m, result.Value.Fodec);
        Assert.Equal(0m, result.Value.DroitTimbre);
        Assert.Equal(190m, result.Value.TotalToPay);
        invoices.Verify(r => r.SumFiscalStampAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Alimentation TFP/FOPROLOS depuis le module paie ────────────────────

    /// <summary>
    /// Monte un handler avec des sources vides (ventes/achats/RS à zéro) : seuls le cycle de paie
    /// et l'éventuelle déclaration sauvegardée pilotent le résultat.
    /// </summary>
    private static GetVatDeclarationQueryHandler BuildPayrollHandler(
        PayrollRun? payrollRun,
        VatDeclaration? saved = null,
        PayrollYearParameters? parameters = null)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 7, new(), 0m, 0m, 0));

        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(saved);
        vatRepo.Setup(r => r.GetByYearMonthAsync(2026, 6, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var invoices = new Mock<IInvoiceRepository>();
        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = true,
            FodecRatePercent = 1.0m,
            TclRatePercent = 0.2m
        });

        return new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object,
            CreateTenantSummaryMock().Object, CreatePayrollProvider(payrollRun, parameters), MonthlyDeclarationTestComposer.Inactive(settings), settings);
    }

    [Theory]
    [InlineData(PayrollRunStatus.Validated)]
    [InlineData(PayrollRunStatus.Closed)]
    public async Task Handle_V2_NoSavedDeclaration_PrefillsTfpFoprolosFromPayrollRun(PayrollRunStatus status)
    {
        var handler = BuildPayrollHandler(PayrollRunWith(status));

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1.680m, result.Value.Tfp);
        Assert.Equal(1.680m, result.Value.Foprolos);
    }

    [Theory]
    [InlineData(PayrollRunStatus.Draft)]
    [InlineData(PayrollRunStatus.Calculated)]
    public async Task Handle_V2_UnvalidatedPayrollRun_IsNotPrefilledButIsReported(PayrollRunStatus status)
    {
        // Un cycle non validé est provisoire : il ne doit jamais alimenter une déclaration fiscale.
        // Son existence est en revanche remontée, pour que l'écran invite à le valider.
        var handler = BuildPayrollHandler(PayrollRunWith(status));

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0m, result.Value.Tfp);
        Assert.Equal(0m, result.Value.Foprolos);

        var suggested = result.Value.Suggested!;
        Assert.True(suggested.PayrollRunExists);
        Assert.False(suggested.PayrollRunUsable);
        Assert.Equal((int)status, suggested.PayrollRunStatus);
        Assert.Equal(0m, suggested.Tfp);
    }

    [Fact]
    public async Task Handle_V2_SavedDeclaration_KeepsDeclaredAmountsAndExposesTheGap()
    {
        // Le cas exact du dossier : déclaration déposée le 11/07 avec TFP/FOPROLOS à zéro, cycle
        // de paie clôturé après coup. Snapshot strict : le dépôt fait foi, l'écart est exposé.
        var saved = VatDeclaration.CreateDraft(
            2026, 7,
            Money.Zero("TND"), Money.Zero("TND"), Money.Zero("TND"),
            Money.Zero("TND"), Money.Zero("TND"), Money.Zero("TND"));
        saved.SetAdditionalTaxes(0m, 0m, 0m, 0m, 0m, 0m, 0m);

        var handler = BuildPayrollHandler(PayrollRunWith(PayrollRunStatus.Closed), saved);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);

        // Déclaré : intact, rien n'est réécrit dans le dos de l'utilisateur.
        Assert.Equal(0m, result.Value.Tfp);
        Assert.Equal(0m, result.Value.Foprolos);

        // Calculé : ce que la paie produirait aujourd'hui — l'écart devient visible.
        var suggested = result.Value.Suggested!;
        Assert.Equal(1.680m, suggested.Tfp);
        Assert.Equal(1.680m, suggested.Foprolos);
        Assert.True(suggested.PayrollRunUsable);
    }

    [Fact]
    public async Task Handle_LiveValuation_IgnoresSavedDeclaration()
    {
        // Mode LIVE (sauvegarde, tableau de bord) : le dépôt est ignoré, on veut le recalcul.
        var saved = VatDeclaration.CreateDraft(
            2026, 7,
            Money.Zero("TND"), Money.Zero("TND"), Money.Zero("TND"),
            Money.Zero("TND"), Money.Zero("TND"), Money.Zero("TND"));
        saved.SetAdditionalTaxes(0m, 0m, 0m, 0m, 0m, 0m, 0m);

        var handler = BuildPayrollHandler(PayrollRunWith(PayrollRunStatus.Closed), saved);

        var result = await handler.Handle(
            new GetVatDeclarationQuery(2026, 7, Valuation: VatDeclarationValuation.Live),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1.680m, result.Value.Tfp);
        Assert.Equal(1.680m, result.Value.Foprolos);
    }

    [Fact]
    public async Task Handle_V2_ExposesPayrollTaxBaseAndRates()
    {
        // Assiette et taux réels, requis par le formulaire officiel : 1,680 à 1 % ⇒ 168,000.
        var handler = BuildPayrollHandler(
            PayrollRunWith(PayrollRunStatus.Closed),
            parameters: IndustrialParameters());

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(168.000m, result.Value.PayrollTaxBase);
        Assert.Equal(1m, result.Value.TfpRatePercent);
        Assert.Equal(1m, result.Value.FoprolosRatePercent);
    }

    [Fact]
    public async Task Handle_V2_AddsPayrollWithholdingToTheInvoiceWithholding()
    {
        // La RS de la déclaration couvre les factures fournisseurs ET les traitements et salaires.
        // Ici : 0 sur factures (mock) + IRPP 25,500 + CSS 4,500 = 30,000.
        var handler = BuildPayrollHandler(
            PayrollRunWith(PayrollRunStatus.Closed, irpp: 25.500m, css: 4.500m, netTaxable: 1_185.201m));

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 7), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var suggested = result.Value.Suggested!;
        Assert.Equal(0m, suggested.WithholdingFromInvoices);
        Assert.Equal(30.000m, suggested.WithholdingFromSalaries);
        Assert.Equal(30.000m, suggested.WithholdingTax);
        Assert.Equal(1_185.201m, result.Value.PayrollSalariesNetTaxableBase);
        Assert.Equal(25.500m, result.Value.PayrollWithholdingIrpp);
        Assert.Equal(4.500m, result.Value.PayrollWithholdingCss);
        Assert.Equal(168.000m, result.Value.PayrollSalariesGrossBase);
    }

    [Fact]
    public async Task Handle_V2_AddsRentJournalWithholdingFromAccount613()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>()));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 8, new(), 0m, 0m, 0));

        var vatRepo = new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync("613", It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1_350m);

        var invoices = new Mock<IInvoiceRepository>();
        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        var settings = Options.Create(new AccountingSettings { MonthlyDeclarationV2Enabled = true });
        var handler = new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object,
            CreateTenantSummaryMock().Object, CreatePayrollProvider(), MonthlyDeclarationTestComposer.Inactive(settings), settings);

        var result = await handler.Handle(new GetVatDeclarationQuery(2026, 8), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1_350m, result.Value.RentWithholdingBase);
        Assert.Equal(135m, result.Value.RentWithholdingAmount);
        var suggested = result.Value.Suggested!;
        Assert.Equal(135m, suggested.WithholdingFromRentJournal);
        Assert.Equal(135m, suggested.WithholdingTax);
    }

    // ── Activation de la déclaration paramétrable (2026-09-24) ─────────────

    /// <summary>
    /// Le drapeau <c>MonthlyDeclarationConfigurableLinesEnabled</c> est allumé pour toute la
    /// plateforme. Pour un dossier qui n'a jamais quitté le calcul historique — aucune ligne de
    /// réglages, l'état de tous les dossiers à l'activation —, la déclaration rendue doit être
    /// identique <b>champ par champ</b> à celle d'avant, dans les deux valorisations, avec ou sans
    /// dépôt enregistré. C'est la garantie de non-régression de l'activation, prise de bout en bout.
    /// </summary>
    [Theory]
    [InlineData(VatDeclarationValuation.Declared, false)]
    [InlineData(VatDeclarationValuation.Declared, true)]
    [InlineData(VatDeclarationValuation.Live, false)]
    [InlineData(VatDeclarationValuation.Live, true)]
    public async Task Allumer_la_declaration_parametrable_ne_change_rien_pour_un_dossier_en_calcul_historique(
        VatDeclarationValuation valuation, bool withSavedDeclaration)
    {
        // Un seul dépôt pour les deux appels : son horodatage de création fait partie du DTO.
        VatDeclaration? saved = null;
        if (withSavedDeclaration)
        {
            saved = VatDeclaration.CreateDraft(
                2026, 7,
                Money.Create(190m, "TND"), Money.Zero("TND"), Money.Zero("TND"),
                Money.Create(57m, "TND"), Money.Zero("TND"), Money.Zero("TND"));
            saved.SetAdditionalTaxes(10m, 12m, 2.38m, 1.68m, 1.68m, 40m, 0m);
        }

        var before = await HandleRichPeriodAsync(configurableLinesEnabled: false, valuation, saved);
        var after = await HandleRichPeriodAsync(configurableLinesEnabled: true, valuation, saved);

        Assert.Equal(JsonSerializer.Serialize(before), JsonSerializer.Serialize(after));
        Assert.Equal((int)MonthlyDeclarationMode.Legacy, after.MonthlyDeclarationMode);
        Assert.Empty(after.Lines);
        Assert.Empty(after.MonthlyDeclarationDiagnostics);
        Assert.Equal(0, after.ParityMaxGapMillimes);
        // Garde-fou du test lui-même : la période porte bien des montants dans chaque famille
        // qu'une configuration pourrait déplacer, sans quoi l'égalité ne prouverait rien.
        Assert.NotEqual(0m, after.Suggested!.Fodec);
        Assert.NotEqual(0m, after.Suggested.DroitTimbre);
        Assert.NotEqual(0m, after.Suggested.Tcl);
        Assert.NotEqual(0m, after.Suggested.Tfp);
        Assert.NotEqual(0m, after.Suggested.WithholdingTax);
    }

    // ── Un dépôt reste figé, jusque dans son détail ─────────────────────────

    private static VatDeclaration SavedWithoutLines()
    {
        var saved = VatDeclaration.CreateDraft(
            2026, 7,
            Money.Create(190m, "TND"), Money.Zero("TND"), Money.Zero("TND"),
            Money.Create(57m, "TND"), Money.Zero("TND"), Money.Zero("TND"));
        saved.SetAdditionalTaxes(10m, 12m, 2.38m, 1.68m, 1.68m, 40m, 0m);
        return saved;
    }

    private static Func<IOptions<AccountingSettings>, MonthlyDeclarationLineComposer> ConfiguredComposer(
        params MonthlyDeclarationFamily[] included) =>
        settings => MonthlyDeclarationTestComposer.Configured(
            settings,
            new[]
            {
                MonthlyDeclarationTestComposer.FixedRubric(
                    MonthlyDeclarationFamily.Withholding, "F1_5", "99.9", gross: 1_000m, withheld: 100m)
            },
            included);

    /// <summary>
    /// Une déclaration déposée sous le calcul historique n'a aucune ligne. Lui prêter les lignes
    /// recomposées aujourd'hui ferait afficher — et réimprimer sur le formulaire officiel — un
    /// détail qui n'a jamais été déposé. Le recalcul, lui, reste visible en valorisation « en direct ».
    /// </summary>
    [Fact]
    public async Task Un_depot_sans_ligne_n_emprunte_pas_les_lignes_recomposees()
    {
        var saved = SavedWithoutLines();
        var composer = ConfiguredComposer(MonthlyDeclarationFamily.Withholding);

        var declared = await HandleRichPeriodAsync(true, VatDeclarationValuation.Declared, saved, composer);
        var live = await HandleRichPeriodAsync(true, VatDeclarationValuation.Live, saved, composer);

        Assert.Empty(declared.Lines);
        Assert.Equal(40m, declared.WithholdingTax);
        Assert.Equal("F1_5", Assert.Single(live.Lines).Code);
    }

    /// <summary>
    /// La société ne voit que ses dépôts. Les signalements du moteur et le sort des lignes sur le
    /// formulaire sont des éléments de travail du cabinet, pas le contenu de la déclaration déposée.
    /// </summary>
    [Fact]
    public async Task La_societe_ne_recoit_pas_les_signalements_du_moteur()
    {
        var saved = SavedWithoutLines();
        saved.Submit();
        // T.F.P cochée sans rubrique : signalement « famille sans rubrique ».
        var composer = ConfiguredComposer(MonthlyDeclarationFamily.Withholding, MonthlyDeclarationFamily.Tfp);

        var firm = await HandleRichPeriodAsync(
            true, VatDeclarationValuation.Live, saved, composer, officialFormEnabled: true);
        var company = await HandleRichPeriodAsync(
            true, VatDeclarationValuation.Declared, saved, composer,
            enforceCompanySubmittedOnly: true, officialFormEnabled: true);

        Assert.NotEmpty(firm.MonthlyDeclarationDiagnostics);
        // Code rapport sans case : la ligne dit pourquoi elle ne sera pas imprimée.
        Assert.Contains(
            Assert.Single(firm.Lines).Diagnostics,
            d => d.Kind == (int)RubricDiagnosticKind.UnmappedReportCode);
        Assert.Empty(company.MonthlyDeclarationDiagnostics);
        Assert.All(company.Lines, l => Assert.Empty(l.Diagnostics));
    }

    /// <summary>
    /// Période « pleine » : TVA collectée, FODEC, timbre, RS sur factures, paie clôturée (TFP,
    /// FOPROLOS, IRPP, CSS) et RS sur loyers du journal. Le composeur est le vrai, monté sur un
    /// dépôt de configuration sans réglage enregistré (<c>GetSettingsAsync</c> rend <c>null</c>).
    /// </summary>
    private static async Task<VatDeclarationDto> HandleRichPeriodAsync(
        bool configurableLinesEnabled,
        VatDeclarationValuation valuation,
        VatDeclaration? saved,
        Func<IOptions<AccountingSettings>, MonthlyDeclarationLineComposer>? composer = null,
        bool enforceCompanySubmittedOnly = false,
        bool officialFormEnabled = false)
    {
        var settings = RichPeriodSettings(configurableLinesEnabled, officialFormEnabled);
        var handler = CreateRichPeriodHandler(settings, saved, composer);

        var result = await handler.Handle(
            new GetVatDeclarationQuery(2026, 7, enforceCompanySubmittedOnly, valuation), CancellationToken.None);

        Assert.True(result.IsSuccess);
        return result.Value;
    }

    /// <summary>Réglages de la période « pleine » : TCL 0,2 %, FODEC 1 %.</summary>
    internal static IOptions<AccountingSettings> RichPeriodSettings(
        bool configurableLinesEnabled = true, bool officialFormEnabled = false) =>
        Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = true,
            MonthlyDeclarationConfigurableLinesEnabled = configurableLinesEnabled,
            MonthlyDeclarationOfficialFormEnabled = officialFormEnabled,
            FodecRatePercent = 1.0m,
            TclRatePercent = 0.2m
        });

    /// <summary>
    /// Handler de la période « pleine » de juillet 2026 : ventes 1 000 HT + 190 TVA, FODEC 10 sur
    /// 1 000, timbre 12, RS factures 40 (rapport sans ligne), paie clôturée (TFP 1,68, FOPROLOS
    /// 1,68, IRPP 25,5, CSS 4,5, net imposable 150), loyers 613 : 1 350 → RS 135.
    /// </summary>
    internal static GetVatDeclarationQueryHandler CreateRichPeriodHandler(
        IOptions<AccountingSettings> settings,
        VatDeclaration? saved = null,
        Func<IOptions<AccountingSettings>, MonthlyDeclarationLineComposer>? composer = null,
        Mock<IVatDeclarationRepository>? vatRepo = null)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetSalesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<SalesVatReportRowDto>>(new List<SalesVatReportRowDto>
            {
                new() { VatRatePercent = 19, VatRateDisplay = "19 %", TotalVatAmount = 190m, TotalTaxableAmount = 1000m, Currency = "TND" }
            }));
        mediator.Setup(m => m.Send(It.IsAny<GetPurchasesVatReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<PurchasesVatReportRowDto>>(new List<PurchasesVatReportRowDto>
            {
                new() { VatRatePercent = 19, VatRateDisplay = "19 %", TotalVatAmount = 57m, TotalTaxableAmount = 300m, Currency = "TND" }
            }));
        mediator.Setup(m => m.Send(It.IsAny<GetWithholdingMonthlyReportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new WithholdingMonthlyReportDto(2026, 7, new(), 0m, 40m, 0));

        vatRepo ??= new Mock<IVatDeclarationRepository>();
        vatRepo.Setup(r => r.GetByYearMonthAsync(2026, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(saved);
        vatRepo.Setup(r => r.GetByYearMonthAsync(2026, 6, It.IsAny<CancellationToken>()))
            .ReturnsAsync((VatDeclaration?)null);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(r => r.SumDebitsByAccountAsync(It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);
        journals.Setup(r => r.SumDebitsByAccountPrefixAsync("613", It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1_350m);

        var invoices = new Mock<IInvoiceRepository>();
        invoices.Setup(r => r.SumFiscalStampAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(12m);
        invoices.Setup(r => r.SumFodecAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(10m);
        invoices.Setup(r => r.SumFodecTaxableBaseAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1000m);

        var supplierInvoices = new Mock<ISupplierInvoiceRepository>();
        supplierInvoices.Setup(r => r.SumFixedAssetDeductibleVatAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0m);

        return new GetVatDeclarationQueryHandler(
            mediator.Object, vatRepo.Object, journals.Object, invoices.Object, supplierInvoices.Object,
            CreateTenantSummaryMock().Object,
            CreatePayrollProvider(
                PayrollRunWith(PayrollRunStatus.Closed, irpp: 25.500m, css: 4.500m, netTaxable: 150m),
                IndustrialParameters()),
            composer?.Invoke(settings) ?? MonthlyDeclarationTestComposer.Inactive(settings),
            settings);
    }
}
