using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.OfficialForms;

/// <summary>
/// Le binder est une fonction pure : ces tests portent sur la conformité réglementaire du
/// remplissage, indépendamment du PDF.
/// </summary>
public sealed class MonthlyDeclarationFormBinderTests
{
    private static VatDeclarationDto Declaration(Action<VatDeclarationDtoBuilder>? configure = null)
    {
        var builder = new VatDeclarationDtoBuilder();
        configure?.Invoke(builder);
        return builder.Build();
    }

    private sealed class VatDeclarationDtoBuilder
    {
        public int Year { get; set; } = 2026;
        public int Month { get; set; } = 8;
        public decimal CollectedVat19 { get; set; } = 3180.980m;
        public decimal PreviousCredit { get; set; } = 868.600m;
        public decimal VatDue { get; set; } = 2312.380m;
        public decimal CreditToCarry { get; set; }
        public decimal Fodec { get; set; }
        public decimal DroitTimbre { get; set; }
        public decimal Tcl { get; set; }
        public decimal Tfp { get; set; }
        public decimal Foprolos { get; set; }
        public decimal WithholdingTax { get; set; }
        public decimal Acomptes { get; set; }
        public bool IsRectificative { get; set; }
        public string Nif { get; set; } = "4555965/P/M/L/000";
        public decimal SalesTaxableBase { get; set; }
        public decimal PayrollTaxBase { get; set; }
        public decimal TfpRatePercent { get; set; }

        public VatDeclarationDto Build() => new()
        {
            Year = Year,
            Month = Month,
            SalesTaxableBase = SalesTaxableBase,
            PayrollTaxBase = PayrollTaxBase,
            TfpRatePercent = TfpRatePercent,
            CollectedVat19 = CollectedVat19,
            PreviousCredit = PreviousCredit,
            VatDue = VatDue,
            CreditToCarry = CreditToCarry,
            Currency = "TND",
            MonthlyDeclarationV2Enabled = true,
            Fodec = Fodec,
            DroitTimbre = DroitTimbre,
            Tcl = Tcl,
            Tfp = Tfp,
            Foprolos = Foprolos,
            WithholdingTax = WithholdingTax,
            Acomptes = Acomptes,
            IsRectificative = IsRectificative,
            CompanyName = "Ste Bouzgarou",
            Nif = Nif,
            AddressLine = "12 rue de Carthage, 1000 Tunis",
            TaxRegimeDisplay = "Régime réel",
            DeclarationTypeDisplay = "Déclaration mensuelle unique",
            CollectedVatBreakdown = new List<VatRateBreakdownDto>
            {
                new() { RatePercent = 19, TaxableBase = 16742.000m, VatAmount = 3180.980m }
            }
        };
    }

    [Fact]
    public void Bind_FillsHeaderPeriodAndTaxpayerIdentifier()
    {
        var values = MonthlyDeclarationFormBinder.Bind(Declaration());

        // Année 2026 et mois 08, un chiffre par case.
        Assert.Equal("2", values["Header.Year.D1"]);
        Assert.Equal("0", values["Header.Year.D2"]);
        Assert.Equal("2", values["Header.Year.D3"]);
        Assert.Equal("6", values["Header.Year.D4"]);
        Assert.Equal("0", values["Header.Month.D1"]);
        Assert.Equal("8", values["Header.Month.D2"]);

        // Matricule 4555965/P/M/L/000 : 7 chiffres, puis catégorie, code TVA, code établissement.
        Assert.Equal("4", values["Header.Nif.D1"]);
        Assert.Equal("5", values["Header.Nif.D7"]);
        Assert.Equal("P", values["Header.Nif.D8"]);
        Assert.Equal("M", values["Header.VatCode"]);
        Assert.Equal("L", values["Header.CategoryCode"]);

        Assert.Equal("Ste Bouzgarou", values["Identity.Name"]);
    }

    [Theory]
    [InlineData("4555965/P/M/L/000")]
    [InlineData("4555965P/M/L/000")]
    public void Bind_NifSpellings_FillTheSameHeaderBoxes(string nif)
    {
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d => d.Nif = nif));

        Assert.Equal("4", values["Header.Nif.D1"]);
        Assert.Equal("5", values["Header.Nif.D7"]);
        Assert.Equal("P", values["Header.Nif.D8"]);
        Assert.Equal("M", values["Header.VatCode"]);
        Assert.Equal("L", values["Header.CategoryCode"]);
    }

    [Theory]
    [InlineData(false, "0")]  // تلقائي — déclaration spontanée
    [InlineData(true, "2")]   // تصحيح — déclaration rectificative
    public void Bind_SetsDeclarationCodeFromRectificativeFlag(bool rectificative, string expected)
    {
        var values = MonthlyDeclarationFormBinder.Bind(
            Declaration(d => d.IsRectificative = rectificative));

        Assert.Equal(expected, values["Header.DeclarationCode"]);
    }

    [Fact]
    public void Bind_FormatsAmountsWithTunisianConvention()
    {
        var values = MonthlyDeclarationFormBinder.Bind(Declaration());

        // Séparateur de milliers = espace insécable étroit ou espace, décimale = virgule, 3 décimales.
        Assert.Equal("16 742,000", values["Vat.Rate19.Base"]);
        Assert.Equal("3 180,980", values["Vat.Rate19.Due"]);
        Assert.Equal("868,600", values["Vat.PreviousCredit"]);
        Assert.Equal("2 312,380", values["Vat.Remainder"]);
    }

    [Fact]
    public void Bind_LeavesZeroAmountsBlankRatherThanPrintingZero()
    {
        // Aucun FODEC / timbre / TCL sur la période.
        var values = MonthlyDeclarationFormBinder.Bind(Declaration());

        // Une case vide et un « 0,000 » n'ont pas le même sens sur une déclaration fiscale.
        Assert.Null(values.GetValueOrDefault("Fodec.Amount"));
        Assert.Null(values.GetValueOrDefault("Recap.StampDuty.Principal"));
        Assert.Null(values.GetValueOrDefault("Recap.Tcl.Principal"));
        Assert.False(values.ContainsKey("Check.StampDuty"));
    }

    [Fact]
    public void Bind_ReportsVatCreditWithOfficialSurplusMarker()
    {
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d =>
        {
            d.VatDue = 0m;
            d.CreditToCarry = 1250.500m;
        }));

        // « الباقي: (ب) مستوجب أو (ف) فائض » : un crédit se marque « ف ».
        Assert.Equal("(ف) 1 250,500", values["Vat.Remainder"]);
    }

    [Fact]
    public void Bind_ChecksOnlyDeclaredTaxes()
    {
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d =>
        {
            d.WithholdingTax = 40m;
            d.Tcl = 39.846m;
        }));

        Assert.Equal("X", values["Check.Withholding"]);
        Assert.Equal("X", values["Check.Tcl"]);
        Assert.Equal("X", values["Check.Vat"]);
        Assert.False(values.ContainsKey("Check.Tfp"));
        Assert.False(values.ContainsKey("Check.Foprolos"));
    }

    [Fact]
    public void Bind_ReportsAcomptesInRecapDeductionOnlyForRectificative()
    {
        // Note (3) du formulaire : la colonne « الطرح (الأداء المدفوع) » est réservée aux
        // déclarations rectificatives. Le formulaire mensuel n'a aucune ligne « acomptes ».
        var ordinary = MonthlyDeclarationFormBinder.Bind(Declaration(d => d.Acomptes = 500m));
        Assert.Null(ordinary.GetValueOrDefault("Recap.Total.Deduction"));
        Assert.Equal("2 312,380", ordinary["Recap.Total.Total"]);

        var corrective = MonthlyDeclarationFormBinder.Bind(Declaration(d =>
        {
            d.Acomptes = 500m;
            d.IsRectificative = true;
        }));
        Assert.Equal("500,000", corrective["Recap.Total.Deduction"]);
        Assert.Equal("1 812,380", corrective["Recap.Total.Total"]);
    }

    [Fact]
    public void Bind_RecapTotalSumsEveryTax()
    {
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d =>
        {
            d.WithholdingTax = 100m;
            d.Tfp = 20m;
            d.Foprolos = 10m;
            d.Fodec = 5m;
            d.DroitTimbre = 1m;
            d.Tcl = 4m;
        }));

        // 2312,380 (TVA) + 100 + 20 + 10 + 5 + 1 + 4
        Assert.Equal("2 452,380", values["Recap.Total.Principal"]);
        Assert.Equal("2 452,380", values["Recap.Total.Total"]);
        Assert.Equal("100,000", values["Recap.Withholding.Principal"]);
    }

    [Fact]
    public void Bind_SelectsTfpLineFromEffectiveRate()
    {
        // Sans assiette exploitable, on retient « autres activités » (2 %), le cas prudent.
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d => d.Tfp = 20m));

        Assert.Equal("20,000", values["Tfp.Other.Amount"]);
        Assert.Null(values.GetValueOrDefault("Tfp.Manufacturing.Amount"));
    }

    [Fact]
    public void Bind_UsesPayrollBaseForTfpAndFoprolos_NotSalesBase()
    {
        // Cas réel Ste Bouzgarou 07/2026 : TFP 1,680 à 1 % (secteur industriel) sur une masse
        // salariale de 168,000, pour un chiffre d'affaires de 94 308,300. Le CA n'a rien à faire
        // ici : l'assiette de la TFP et du FOPROLOS est la masse salariale.
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d =>
        {
            d.Tfp = 1.680m;
            d.Foprolos = 1.680m;
            d.SalesTaxableBase = 94_308.300m;
            d.PayrollTaxBase = 168.000m;
            d.TfpRatePercent = 1m;
        }));

        // Taux réel 1 % ⇒ ligne « industries manufacturières », et assiette = masse salariale.
        Assert.Equal("168,000", values["Tfp.Manufacturing.Base"]);
        Assert.Equal("1,680", values["Tfp.Manufacturing.Amount"]);
        Assert.Null(values.GetValueOrDefault("Tfp.Other.Base"));
        Assert.Null(values.GetValueOrDefault("Tfp.Other.Amount"));
        Assert.Equal("168,000", values["Foprolos.Base"]);
    }

    [Fact]
    public void Bind_SelectsOtherActivitiesLineWhenRateIsTwoPercent()
    {
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d =>
        {
            d.Tfp = 3.360m;
            d.PayrollTaxBase = 168.000m;
            d.TfpRatePercent = 2m;
        }));

        Assert.Equal("168,000", values["Tfp.Other.Base"]);
        Assert.Equal("3,360", values["Tfp.Other.Amount"]);
        Assert.Null(values.GetValueOrDefault("Tfp.Manufacturing.Amount"));
    }

    [Fact]
    public void Bind_LeavesPayrollBasisBlankWhenPayrollIsUnavailable()
    {
        // Dossier sans module paie : le montant est saisi à la main et l'assiette est inconnue.
        // Une case vide se complète au stylo ; le chiffre d'affaires imprimé là serait indétectable.
        var values = MonthlyDeclarationFormBinder.Bind(Declaration(d =>
        {
            d.Tfp = 20m;
            d.Foprolos = 10m;
            d.SalesTaxableBase = 94_308.300m;
        }));

        Assert.Null(values.GetValueOrDefault("Tfp.Other.Base"));
        Assert.Null(values.GetValueOrDefault("Tfp.Manufacturing.Base"));
        Assert.Null(values.GetValueOrDefault("Foprolos.Base"));
        // Le montant, lui, reste bien reporté.
        Assert.Equal("20,000", values["Tfp.Other.Amount"]);
        Assert.Equal("10,000", values["Foprolos.Amount"]);
    }

    [Fact]
    public void Bind_PlacesWithholdingBreakdownOnOfficialLines()
    {
        var lines = new Dictionary<string, decimal>
        {
            ["Line1.Amount"] = 120.500m,
            ["Line6.Amount"] = 30.000m
        };

        var values = MonthlyDeclarationFormBinder.Bind(
            Declaration(d => d.WithholdingTax = 150.500m), lines);

        Assert.Equal("120,500", values["Withholding.Line1.Amount"]);
        Assert.Equal("30,000", values["Withholding.Line6.Amount"]);
        // Le total reste systématiquement reporté : il fait foi.
        Assert.Equal("150,500", values["Withholding.Total"]);
    }

    [Fact]
    public void Bind_PlacesPayrollIrppAndCssOnOfficialLinesOneAndThree()
    {
        // Cas ste nour 08/2026 : net imposable / IRPP sur l'article 1, même assiette / CSS sur l'article 3.
        var lines = new Dictionary<string, decimal>
        {
            ["Line1.Base"] = 1_185.201m,
            ["Line1.Amount"] = 150.467m,
            ["Line3.Base"] = 1_185.201m,
            ["Line3.Amount"] = 5.926m
        };

        var values = MonthlyDeclarationFormBinder.Bind(
            Declaration(d => d.WithholdingTax = 166.693m), lines);

        Assert.Equal("1 185,201", values["Withholding.Line1.Base"]);
        Assert.Equal("150,467", values["Withholding.Line1.Amount"]);
        Assert.Equal("1 185,201", values["Withholding.Line3.Base"]);
        Assert.Equal("5,926", values["Withholding.Line3.Amount"]);
        Assert.Equal("166,693", values["Withholding.Total"]);
        Assert.Null(values.GetValueOrDefault("Withholding.Line4Individuals.Amount"));
    }

    [Fact]
    public void Bind_PlacesRentWithholdingOnOfficialLineFourIndividuals()
    {
        // Cas ste nour 08/2026 : loyers journal 613 → article 4 personnes physiques 10 %.
        var lines = new Dictionary<string, decimal>
        {
            ["Line1.Base"] = 1_185.201m,
            ["Line1.Amount"] = 150.467m,
            ["Line3.Base"] = 1_185.201m,
            ["Line3.Amount"] = 5.926m,
            ["Line4Individuals.Base"] = 1_350m,
            ["Line4Individuals.Amount"] = 135m
        };

        var values = MonthlyDeclarationFormBinder.Bind(
            Declaration(d => d.WithholdingTax = 291.393m), lines);

        Assert.Equal("1 350,000", values["Withholding.Line4Individuals.Base"]);
        Assert.Equal("135,000", values["Withholding.Line4Individuals.Amount"]);
        Assert.Equal("291,393", values["Withholding.Total"]);
    }
}

/// <summary>
/// Ventilation de la retenue à la source sur les lignes numérotées du formulaire.
/// </summary>
public sealed class WithholdingFormLineMapperTests
{
    private static WithholdingReportByCategoryDto Category(
        WithholdingCategory category, decimal ht, decimal withheld)
        => new(category, category.ToString(), ht, withheld, 1);

    [Fact]
    public void Map_RoutesCategoriesToTheirOfficialLine()
    {
        var report = new List<WithholdingReportByCategoryDto>
        {
            Category(WithholdingCategory.Salaires, 10_000m, 800m),
            Category(WithholdingCategory.Dividendes, 1_000m, 100m)
        };

        var lines = WithholdingFormLineMapper.Map(report, 900m);

        Assert.Equal(800m, lines["Line1.Amount"]);
        Assert.Equal(10_000m, lines["Line1.Base"]);
        Assert.Equal(100m, lines["Line12.Amount"]);
    }

    [Theory]
    [InlineData(3.0, "Line6")]   // personnes morales / régime réel
    [InlineData(10.0, "Line5")]  // personnes physiques hors régime réel
    public void Map_DisambiguatesFeesByEffectiveRate(double ratePercent, string expectedLine)
    {
        var ht = 1_000m;
        var withheld = ht * (decimal)ratePercent / 100m;

        var lines = WithholdingFormLineMapper.Map(
            new List<WithholdingReportByCategoryDto> { Category(WithholdingCategory.Honoraires, ht, withheld) },
            withheld);

        Assert.True(lines.ContainsKey($"{expectedLine}.Amount"));
    }

    [Fact]
    public void Map_AggregatesCategoriesSharingTheSameLine()
    {
        // Loyers et commissions relèvent tous deux de l'article 4.
        var report = new List<WithholdingReportByCategoryDto>
        {
            Category(WithholdingCategory.Loyers, 1_000m, 100m),
            Category(WithholdingCategory.Commissions, 2_000m, 200m)
        };

        var lines = WithholdingFormLineMapper.Map(report, 300m);

        Assert.Equal(300m, lines["Line4Entities.Amount"]);
        Assert.Equal(3_000m, lines["Line4Entities.Base"]);
    }

    [Fact]
    public void Map_AbandonsBreakdownWhenItExceedsDeclaredTotal()
    {
        // Incohérence de données : mieux vaut ne rien détailler que déclarer faux.
        var report = new List<WithholdingReportByCategoryDto>
        {
            Category(WithholdingCategory.Salaires, 10_000m, 800m)
        };

        Assert.Empty(WithholdingFormLineMapper.Map(report, 500m));
    }

    [Fact]
    public void Map_KeepsUnmappedCategoriesInTheAggregateOnly()
    {
        // « Jeux » n'a pas de ligne calibrée : son montant reste porté par le total page 4.
        var report = new List<WithholdingReportByCategoryDto>
        {
            Category(WithholdingCategory.Jeux, 1_000m, 250m)
        };

        Assert.Empty(WithholdingFormLineMapper.Map(report, 250m));
    }

    [Fact]
    public void Map_ReturnsEmptyWhenNoBreakdownAvailable()
    {
        Assert.Empty(WithholdingFormLineMapper.Map(null, 100m));
        Assert.Empty(WithholdingFormLineMapper.Map(new List<WithholdingReportByCategoryDto>(), 100m));
    }
}

/// <summary>
/// Fusion IRPP (article 1) / CSS (article 3) sur le formulaire officiel, à partir du net imposable.
/// </summary>
public sealed class PayrollWithholdingFormLinesTests
{
    [Fact]
    public void Merge_SteNour_MapsNetTaxableIrppAndCssToLinesOneAndThree()
    {
        var lines = PayrollWithholdingFormLines.Merge(
            invoiceLines: null,
            declaredTotal: 156.393m,
            netTaxable: 1_185.201m,
            irpp: 150.467m,
            css: 5.926m);

        Assert.Equal(1_185.201m, lines["Line1.Base"]);
        Assert.Equal(150.467m, lines["Line1.Amount"]);
        Assert.Equal(1_185.201m, lines["Line3.Base"]);
        Assert.Equal(5.926m, lines["Line3.Amount"]);
        Assert.False(lines.ContainsKey("Line4Individuals.Amount"));
    }

    [Fact]
    public void Merge_DoesNotUseGrossSalaryAsWithholdingBase()
    {
        var lines = PayrollWithholdingFormLines.Merge(
            null, 156.393m, netTaxable: 1_185.201m, irpp: 150.467m, css: 5.926m);

        Assert.DoesNotContain(1_450.000m, lines.Values);
        Assert.Equal(1_185.201m, lines["Line1.Base"]);
    }

    [Fact]
    public void Merge_AggregatesPayrollIrppOntoExistingInvoiceSalaryLine()
    {
        var invoices = WithholdingFormLineMapper.Accumulate(
            new List<WithholdingReportByCategoryDto>
            {
                new(WithholdingCategory.Salaires, "Salaires", 2_000m, 100m, 1)
            });

        var lines = PayrollWithholdingFormLines.Merge(
            invoices, declaredTotal: 256.393m, netTaxable: 1_185.201m, irpp: 150.467m, css: 5.926m);

        Assert.Equal(2_000m + 1_185.201m, lines["Line1.Base"]);
        Assert.Equal(250.467m, lines["Line1.Amount"]);
        Assert.Equal(1_185.201m, lines["Line3.Base"]);
        Assert.Equal(5.926m, lines["Line3.Amount"]);
    }

    [Fact]
    public void Merge_OmitsLine3WhenCssIsZero()
    {
        var lines = PayrollWithholdingFormLines.Merge(
            null, declaredTotal: 150.467m, netTaxable: 1_185.201m, irpp: 150.467m, css: 0m);

        Assert.Equal(150.467m, lines["Line1.Amount"]);
        Assert.Equal(1_185.201m, lines["Line1.Base"]);
        Assert.False(lines.ContainsKey("Line3.Amount"));
        Assert.False(lines.ContainsKey("Line3.Base"));
    }

    [Fact]
    public void Merge_OmitsLine1WhenIrppIsZero()
    {
        var lines = PayrollWithholdingFormLines.Merge(
            null, declaredTotal: 5.926m, netTaxable: 1_185.201m, irpp: 0m, css: 5.926m);

        Assert.False(lines.ContainsKey("Line1.Amount"));
        Assert.Equal(5.926m, lines["Line3.Amount"]);
        Assert.Equal(1_185.201m, lines["Line3.Base"]);
    }

    [Fact]
    public void Merge_AbandonsBreakdownWhenVentilatedTotalExceedsDeclared()
    {
        var invoices = WithholdingFormLineMapper.Accumulate(
            new List<WithholdingReportByCategoryDto>
            {
                new(WithholdingCategory.Honoraires, "Honoraires", 1_000m, 30m, 1)
            });

        // IRPP + CSS + honoraires = 186,393 > 150 déclaré.
        Assert.Empty(PayrollWithholdingFormLines.Merge(
            invoices, declaredTotal: 150m, netTaxable: 1_185.201m, irpp: 150.467m, css: 5.926m));
    }

    [Fact]
    public void Merge_ReturnsEmptyWhenDeclaredTotalIsZero()
    {
        Assert.Empty(PayrollWithholdingFormLines.Merge(
            null, declaredTotal: 0m, netTaxable: 1_185.201m, irpp: 150.467m, css: 5.926m));
    }
}

/// <summary>
/// Fusion RS loyers journal 613 (article 4 — personnes physiques 10 %) sur le formulaire officiel.
/// </summary>
public sealed class RentWithholdingFormLinesTests
{
    [Fact]
    public void Merge_SteNour_MapsAccount613ToLineFourIndividuals()
    {
        var payrollLines = PayrollWithholdingFormLines.Merge(
            invoiceLines: null,
            declaredTotal: 291.393m,
            netTaxable: 1_185.201m,
            irpp: 150.467m,
            css: 5.926m);

        var lines = RentWithholdingFormLines.Merge(
            payrollLines,
            declaredTotal: 291.393m,
            rentBase: 1_350m,
            rentWithheld: 135m);

        Assert.Equal(1_350m, lines["Line4Individuals.Base"]);
        Assert.Equal(135m, lines["Line4Individuals.Amount"]);
        Assert.Equal(1_185.201m, lines["Line1.Base"]);
        Assert.Equal(150.467m, lines["Line1.Amount"]);
    }

    [Fact]
    public void Merge_OmitsLineWhenRentWithheldIsZero()
    {
        var lines = RentWithholdingFormLines.Merge(null, declaredTotal: 100m, rentBase: 0m, rentWithheld: 0m);

        Assert.Empty(lines);
    }

    [Fact]
    public void Merge_AbandonsBreakdownWhenVentilatedTotalExceedsDeclared()
    {
        var payrollLines = PayrollWithholdingFormLines.Merge(
            null, declaredTotal: 291.393m, netTaxable: 1_185.201m, irpp: 150.467m, css: 5.926m);

        Assert.Empty(RentWithholdingFormLines.Merge(
            payrollLines, declaredTotal: 200m, rentBase: 1_350m, rentWithheld: 135m));
    }

    [Fact]
    public void ComputeAmount_RoundsToThreeDecimals()
    {
        Assert.Equal(135m, RentWithholdingFormLines.ComputeAmount(1_350m));
    }
}
