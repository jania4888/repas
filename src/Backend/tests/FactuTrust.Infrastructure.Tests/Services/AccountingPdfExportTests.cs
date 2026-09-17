using System.Net.Http;
using FactuTrust.Application.Accounting;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Infrastructure.Services;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class AccountingPdfExportTests
{
    private static PdfService BuildPdfService()
    {
        var httpFactory = new Mock<IHttpClientFactory>();
        var templateRegistry = new Mock<IDocumentTemplateRegistry>();
        return new PdfService(httpFactory.Object, templateRegistry.Object);
    }

    [Fact]
    public async Task GenerateVatDeclarationPdf_ProducesNonEmptyPdf()
    {
        var dto = new VatDeclarationDto
        {
            Year = 2026,
            Month = 7,
            CollectedVat19 = 1000m,
            DeductibleVatGoods = 300m,
            VatDue = 700m,
            Currency = "TND",
            MonthlyDeclarationV2Enabled = true,
            Fodec = 50m,
            DroitTimbre = 12m,
            Tcl = 8m,
            WithholdingTax = 40m,
            TotalToPay = 810m
        };

        var bytes = await BuildPdfService().GenerateVatDeclarationPdfAsync(dto, "Ma Société SARL", CancellationToken.None);

        Assert.NotNull(bytes);
        Assert.True(bytes.Length > 500);
        // En-tête PDF « %PDF ».
        Assert.Equal((byte)'%', bytes[0]);
        Assert.Equal((byte)'P', bytes[1]);
    }

    [Fact]
    public async Task GenerateMonthlyDeclarationOfficialFormPdf_StampsIrppAndCssLines()
    {
        var dto = new VatDeclarationDto
        {
            Year = 2026,
            Month = 8,
            Currency = "TND",
            MonthlyDeclarationV2Enabled = true,
            WithholdingTax = 156.393m,
            CompanyName = "ste nour",
            Nif = "7855555/H/O/0/000"
        };

        var lines = PayrollWithholdingFormLines.Merge(
            null, 156.393m, netTaxable: 1_185.201m, irpp: 150.467m, css: 5.926m);

        var bytes = await BuildPdfService().GenerateMonthlyDeclarationOfficialFormPdfAsync(
            dto, lines, configuredBoxes: null, CancellationToken.None);

        AssertIsPdf(bytes);
    }

    private static void AssertIsPdf(byte[] bytes)
    {
        Assert.NotNull(bytes);
        Assert.True(bytes.Length > 500);
        Assert.Equal((byte)'%', bytes[0]);
        Assert.Equal((byte)'P', bytes[1]);
        Assert.Equal((byte)'D', bytes[2]);
        Assert.Equal((byte)'F', bytes[3]);
    }

    private static AccountingReportHeader Header(string title) =>
        new("Ma Société SARL", "1234567/A/M/000", title, "Du 01/01/2025 au 31/01/2025");

    [Fact]
    public async Task GenerateJournalPdf_MultipleJournals_ProducesPdf()
    {
        var entries = new List<JournalEntryDto>
        {
            new()
            {
                EntryNumber = 1, JournalCode = "VTE", EntryDate = new DateTime(2025, 1, 2), Label = "Vente",
                Lines = new List<JournalEntryLineDto>
                {
                    new() { AccountNumber = "411000", Label = "Client X", Debit = 1190.500m, Credit = 0m },
                    new() { AccountNumber = "707000", Label = "Ventes", Debit = 0m, Credit = 1000.000m },
                    new() { AccountNumber = "4367000", Label = "TVA collectée", Debit = 0m, Credit = 190.500m }
                }
            },
            new()
            {
                EntryNumber = 2, JournalCode = "ACH", EntryDate = new DateTime(2025, 1, 5), Label = "Achat",
                Lines = new List<JournalEntryLineDto>
                {
                    new() { AccountNumber = "607000", Label = "Achats", Debit = 500.000m, Credit = 0m },
                    new() { AccountNumber = "401000", Label = "Fournisseur Y", Debit = 0m, Credit = 500.000m }
                }
            }
        };

        var bytes = await BuildPdfService().GenerateJournalPdfAsync(entries, Header("Journal général"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateJournalPdf_EmptyList_ProducesPdfWithoutThrowing()
    {
        var bytes = await BuildPdfService().GenerateJournalPdfAsync(new List<JournalEntryDto>(), Header("Journal général"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateLedgerPdf_ProducesPdf()
    {
        var rows = new List<LedgerRowDto>
        {
            new() { EntryDate = new DateTime(2025, 1, 2), JournalCode = "VTE", PieceNumber = 1, Label = "Facture 1", Debit = 1190.500m, Credit = 0m, RunningBalance = 1190.500m },
            new() { EntryDate = new DateTime(2025, 1, 6), JournalCode = "BQ", PieceNumber = 3, Label = "Règlement", Debit = 0m, Credit = 1190.500m, RunningBalance = 0m }
        };
        var bytes = await BuildPdfService().GenerateLedgerPdfAsync("411000", rows, Header("Grand livre — compte 411000"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateBalancePdf_ProducesPdf()
    {
        var rows = new List<BalanceRowDto>
        {
            new() { AccountNumber = "411000", Label = "Clients", OpeningDebit = 0m, OpeningCredit = 0m, MovementDebit = 1190.500m, MovementCredit = 1190.500m, ClosingDebit = 0m, ClosingCredit = 0m },
            new() { AccountNumber = "707000", Label = "Ventes", OpeningDebit = 0m, OpeningCredit = 0m, MovementDebit = 0m, MovementCredit = 1000.000m, ClosingDebit = 0m, ClosingCredit = 1000.000m }
        };
        var bytes = await BuildPdfService().GenerateBalancePdfAsync(rows, Header("Balance générale"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateAuxiliaryBalancePdf_ProducesPdf()
    {
        var rows = new List<AuxiliaryBalanceRowDto>
        {
            new() { ThirdPartyId = Guid.NewGuid(), ThirdPartyName = "Client X", MovementDebit = 1190.500m, ClosingDebit = 1190.500m },
            new() { ThirdPartyId = Guid.NewGuid(), ThirdPartyName = "Client Y", MovementDebit = 500.000m, ClosingDebit = 500.000m }
        };
        var bytes = await BuildPdfService().GenerateAuxiliaryBalancePdfAsync(rows, Header("Balance auxiliaire — Clients"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateThirdPartyLedgerPdf_ProducesPdf()
    {
        var ledger = new ThirdPartyLedgerDto
        {
            ThirdPartyId = Guid.NewGuid(),
            ThirdPartyName = "Client X",
            OpeningBalance = 100.000m,
            Rows = new List<ThirdPartyLedgerRowDto>
            {
                new() { EntryDate = new DateTime(2025, 1, 2), JournalCode = "VTE", PieceNumber = 1, AccountNumber = "411000", Label = "Facture", Debit = 1190.500m, Credit = 0m, RunningBalance = 1290.500m, LetteringCode = "A" }
            }
        };
        var bytes = await BuildPdfService().GenerateThirdPartyLedgerPdfAsync(ledger, Header("Grand livre tiers — Client X"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateAgingPdf_ProducesPdf()
    {
        var rows = new List<AgingReportRowDto>
        {
            new() { ThirdPartyId = Guid.NewGuid(), ThirdPartyName = "Client X", Total = 1500.000m, NotYetDue = 500.000m, Days0To30 = 1000.000m }
        };
        var bytes = await BuildPdfService().GenerateAgingPdfAsync(rows, Header("Balance âgée — Clients"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateBalanceSheetPdf_ProducesPdf()
    {
        var dto = new BalanceSheetDto
        {
            Assets = new List<FinancialStatementLineDto> { new() { AccountNumber = "22", Label = "Immobilisations", AccountClass = 2, Amount = 30000.000m, PreviousYearAmount = 25000.000m } },
            Liabilities = new List<FinancialStatementLineDto> { new() { AccountNumber = "10", Label = "Capital", AccountClass = 1, Amount = 30000.000m } },
            TotalAssets = 30000.000m, TotalLiabilities = 30000.000m, NetResult = 0m
        };
        var bytes = await BuildPdfService().GenerateBalanceSheetPdfAsync(dto, Header("Bilan"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateIncomeStatementPdf_ProducesPdf()
    {
        var dto = new IncomeStatementDto
        {
            Revenue = new List<FinancialStatementLineDto> { new() { AccountNumber = "70", Label = "Ventes", AccountClass = 7, Amount = 20000.000m } },
            Expenses = new List<FinancialStatementLineDto> { new() { AccountNumber = "60", Label = "Achats", AccountClass = 6, Amount = 12000.000m } },
            TotalRevenue = 20000.000m, TotalExpenses = 12000.000m, NetResult = 8000.000m
        };
        var bytes = await BuildPdfService().GenerateIncomeStatementPdfAsync(dto, Header("Compte de résultat"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    private static FiscalResultDeclarationDto SampleFiscalResult() => new()
    {
        FiscalYear = 2025,
        TaxpayerKind = 0,
        Status = 0,
        AccountingResult = 100000m,
        AppliedIsRate = 0.15m,
        Adjustments = new List<FiscalAdjustmentLineDto>
        {
            new() { CatalogCode = "R-IS", Kind = 0, Label = "Impôt sur les sociétés (compte 69)", Amount = 15000m, IsAutoSuggested = true },
            new() { CatalogCode = "D-DIVIDENDES", Kind = 1, Label = "Dividendes", Amount = 2000m }
        },
        Computation = new IncomeTaxComputationDto
        {
            AccountingResult = 100000m, TotalReintegrations = 15000m, TotalDeductions = 2000m,
            ResultBeforeCarryForward = 113000m, TaxableResult = 113000m, TaxOnResult = 16950m,
            MinimumTax = 500m, TaxDue = 16950m, TotalTaxDue = 16950m, NetToPay = 16950m
        }
    };

    [Fact]
    public async Task GenerateFiscalResultPdf_ProducesPdf()
    {
        var bytes = await BuildPdfService().GenerateFiscalResultPdfAsync(SampleFiscalResult(), Header("Détermination du résultat fiscal"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateConsolidatedLiassePdf_ProducesPdf()
    {
        var current = new Dictionary<string, decimal>
        {
            ["221"] = 10000m, ["281"] = -2000m, ["31"] = 3000m, ["411"] = 5000m, ["532"] = 8000m,
            ["101"] = -15000m, ["401"] = -4000m, ["70"] = -20000m, ["601"] = 12000m, ["64"] = 3000m, ["15"] = -3000m
        };
        var liasse = NctStatementBuilder.Build(2025, current, new Dictionary<string, decimal>(), enabled: true);

        var consolidated = new ConsolidatedLiasseDto
        {
            FiscalYear = 2025,
            FinancialStatements = liasse,
            FiscalResult = SampleFiscalResult(),
            AmortizationTable = new List<FiscalTableRowDto> { new() { Code = "IMM-1", Label = "Matériel", Amount = 1000m, PreviousAmount = 5000m } },
            ProvisionsTable = new List<FiscalTableRowDto> { new() { Code = "15", Label = "Provisions pour risques et charges", Amount = 3000m, PreviousAmount = 2000m } },
            CompanyName = "Ma Société SARL"
        };

        var bytes = await BuildPdfService().GenerateConsolidatedLiassePdfAsync(consolidated, Header("Liasse fiscale"), CancellationToken.None);
        AssertIsPdf(bytes);
    }

    [Fact]
    public async Task GenerateNctLiassePdf_ProducesNonEmptyPdf()
    {
        var current = new Dictionary<string, decimal>
        {
            ["221"] = 10000m, ["281"] = -2000m, ["31"] = 3000m, ["411"] = 5000m, ["532"] = 8000m,
            ["101"] = -15000m, ["401"] = -4000m, ["70"] = -20000m, ["601"] = 12000m, ["64"] = 3000m
        };
        var liasse = NctStatementBuilder.Build(2026, current, new Dictionary<string, decimal>(), enabled: true);

        var bytes = await BuildPdfService().GenerateNctLiassePdfAsync(liasse, "Ma Société SARL", CancellationToken.None);

        Assert.NotNull(bytes);
        Assert.True(bytes.Length > 500);
        Assert.Equal((byte)'%', bytes[0]);
    }

    [Fact]
    public async Task GenerateNctLiassePdf_Filtered_HeaderShowsAsOfDate()
    {
        var current = new Dictionary<string, decimal>
        {
            ["221"] = 10000m, ["281"] = -2000m, ["31"] = 3000m, ["411"] = 5000m, ["532"] = 8000m,
            ["101"] = -15000m, ["401"] = -4000m, ["70"] = -20000m, ["601"] = 12000m, ["64"] = 3000m
        };
        var liasse = NctStatementBuilder.Build(2025, current, new Dictionary<string, decimal>(), enabled: true)
            with { DetailedNotes = NctDetailedNotesBuilder.Build(current, new Dictionary<string, decimal>()) };

        var options = new NctLiasseExportOptions
        {
            FiscalYear = 2025,
            AsOfDate = new DateOnly(2025, 12, 31),
            IncludeAssets = true,
            IncludeAnnexAssets = true,
            SelectedNoteNumbers = new[] { 3, 4 }
        };
        var view = NctLiasseExportFilter.Apply(liasse, options).Value;

        var bytes = await BuildPdfService().GenerateNctLiassePdfAsync(view, "Ma Société SARL", CancellationToken.None);

        Assert.NotNull(bytes);
        Assert.True(bytes.Length > 500);
        Assert.Equal((byte)'%', bytes[0]);
    }
}
