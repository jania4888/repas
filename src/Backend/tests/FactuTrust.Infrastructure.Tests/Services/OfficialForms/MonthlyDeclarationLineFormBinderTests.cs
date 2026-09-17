using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.OfficialForms;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.OfficialForms;

/// <summary>
/// Projection du détail par rubrique sur les cases du formulaire officiel, et contrôle croisé des
/// deux cartes du millésime.
/// </summary>
public sealed class MonthlyDeclarationLineFormBinderTests
{
    private static MonthlyDeclarationLineDto Line(
        MonthlyDeclarationFamily family, string reportCode, decimal gross, decimal withheld,
        string code = "FX") => new()
        {
            Code = code,
            Label = code,
            Family = (int)family,
            ReportCode = reportCode,
            Gross = gross,
            Withheld = withheld,
            RatePercentApplied = 0m
        };

    private static IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> Totals(
        params (MonthlyDeclarationFamily Family, decimal Total)[] totals) =>
        totals.ToDictionary(t => t.Family, t => t.Total);

    private static IReadOnlyDictionary<string, decimal> Project(
        IReadOnlyList<MonthlyDeclarationLineDto> lines,
        IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> totals) =>
        MonthlyDeclarationLineFormBinder.Project(
            lines, totals, MonthlyDeclarationFormBinder.FormVersion);

    // ── Contrôle croisé des cartes du millésime ───────────────────────────────

    /// <summary>
    /// Toute case citée par la carte des codes rapport doit exister dans la carte géométrique. Une
    /// coquille casse ainsi la suite de tests, et non le tamponnage d'une déclaration réelle.
    /// </summary>
    [Fact]
    public void Chaque_case_citee_par_les_codes_rapport_existe_dans_la_carte_geometrique()
    {
        var geometry = OfficialFormFieldMap.Load(MonthlyDeclarationFormBinder.FormVersion);
        var geometryKeys = geometry.Fields.Select(f => f.Key).ToHashSet(StringComparer.Ordinal);

        var mapped = MonthlyDeclarationReportCodeMap.AllBoxKeys(MonthlyDeclarationFormBinder.FormVersion);

        Assert.NotEmpty(mapped);
        var missing = mapped.Where(k => !geometryKeys.Contains(k)).ToList();
        Assert.True(missing.Count == 0, $"Cases absentes du gabarit : {string.Join(", ", missing)}");
    }

    [Theory]
    [InlineData(MonthlyDeclarationFamily.Withholding, "4.1", "Withholding.Line4Individuals.Amount")]
    [InlineData(MonthlyDeclarationFamily.Withholding, "17.2", "Withholding.Line17Rate05.Amount")]
    [InlineData(MonthlyDeclarationFamily.Tfp, "2", "Tfp.Other.Amount")]
    [InlineData(MonthlyDeclarationFamily.Vat, "1.3", "Vat.Rate19.Due")]
    [InlineData(MonthlyDeclarationFamily.Vat, "2.4", "Vat.Purchase.OtherLocal.Deductible")]
    [InlineData(MonthlyDeclarationFamily.OtherTurnoverTaxes, "1", "Fodec.Amount")]
    public void Le_code_rapport_resout_la_case_attendue(
        MonthlyDeclarationFamily family, string reportCode, string expectedAmountKey)
    {
        var target = MonthlyDeclarationReportCodeMap.Resolve(
            MonthlyDeclarationFormBinder.FormVersion, family, reportCode);

        Assert.NotNull(target);
        Assert.Equal(expectedAmountKey, target!.AmountKey);
    }

    /// <summary>
    /// Les familles sans case de détail dans ce millésime tombent sur leur repli : le montant ne
    /// rejoint que la ligne du récapitulatif, ce qui est exact plutôt que muet.
    /// </summary>
    [Theory]
    [InlineData(MonthlyDeclarationFamily.Tcl, "3.1", "Tcl")]
    [InlineData(MonthlyDeclarationFamily.LicenceFee, "1", "LicenceFee")]
    [InlineData(MonthlyDeclarationFamily.HotelTax, "1", "HotelTax")]
    [InlineData(MonthlyDeclarationFamily.ConsumptionDuty, "2", "ConsumptionDuty")]
    public void Une_famille_sans_case_de_detail_tombe_sur_son_repli(
        MonthlyDeclarationFamily family, string reportCode, string expectedRecap)
    {
        var target = MonthlyDeclarationReportCodeMap.Resolve(
            MonthlyDeclarationFormBinder.FormVersion, family, reportCode);

        Assert.NotNull(target);
        Assert.Null(target!.BaseKey);
        Assert.Null(target.AmountKey);
        Assert.Equal(expectedRecap, target.RecapFamilyKey);
    }

    [Fact]
    public void Un_code_rapport_inconnu_ne_resout_rien_et_ne_leve_pas()
    {
        var target = MonthlyDeclarationReportCodeMap.Resolve(
            MonthlyDeclarationFormBinder.FormVersion, MonthlyDeclarationFamily.Withholding, "99.9");

        Assert.Null(target);
    }

    // ── Projection ────────────────────────────────────────────────────────────

    [Fact]
    public void La_projection_remplit_les_deux_colonnes_de_la_case()
    {
        var boxes = Project(
            new[] { Line(MonthlyDeclarationFamily.Withholding, "4.1", 2_500m, 250m) },
            Totals((MonthlyDeclarationFamily.Withholding, 250m)));

        Assert.Equal(2_500m, boxes["Withholding.Line4Individuals.Base"]);
        Assert.Equal(250m, boxes["Withholding.Line4Individuals.Amount"]);
    }

    /// <summary>
    /// Plusieurs rubriques peuvent viser une même ligne réglementaire — commissions et loyers
    /// relèvent tous deux de l'article 4 : elles se cumulent, elles ne s'écrasent pas.
    /// </summary>
    [Fact]
    public void Deux_rubriques_visant_la_meme_case_se_cumulent()
    {
        var boxes = Project(
            new[]
            {
                Line(MonthlyDeclarationFamily.Withholding, "4.2", 1_000m, 100m, "F1_4_2a"),
                Line(MonthlyDeclarationFamily.Withholding, "4.2", 3_000m, 300m, "F1_4_2b")
            },
            Totals((MonthlyDeclarationFamily.Withholding, 400m)));

        Assert.Equal(4_000m, boxes["Withholding.Line4Entities.Base"]);
        Assert.Equal(400m, boxes["Withholding.Line4Entities.Amount"]);
    }

    /// <summary>
    /// Le total déclaré fait foi, le détail n'est qu'informatif : une ventilation qui le dépasse est
    /// abandonnée en entier plutôt que reportée.
    /// </summary>
    [Fact]
    public void Une_famille_dont_le_detail_depasse_le_total_declare_est_abandonnee()
    {
        var boxes = Project(
            new[]
            {
                Line(MonthlyDeclarationFamily.Withholding, "1", 11_500m, 900m),
                Line(MonthlyDeclarationFamily.Withholding, "3", 11_500m, 400m)
            },
            Totals((MonthlyDeclarationFamily.Withholding, 1_000m)));

        Assert.Empty(boxes);
    }

    [Fact]
    public void Un_ecart_d_un_millime_reste_tolere()
    {
        var boxes = Project(
            new[] { Line(MonthlyDeclarationFamily.Withholding, "1", 11_500m, 1_000.001m) },
            Totals((MonthlyDeclarationFamily.Withholding, 1_000.000m)));

        Assert.Equal(1_000.001m, boxes["Withholding.Line1.Amount"]);
    }

    /// <summary>
    /// Le cloisonnement par famille est délibéré : un dépassement sur la retenue à la source ne doit
    /// pas emporter la TFP, qui n'y est pour rien.
    /// </summary>
    [Fact]
    public void Un_depassement_sur_une_famille_n_emporte_pas_les_autres()
    {
        var boxes = Project(
            new[]
            {
                Line(MonthlyDeclarationFamily.Withholding, "1", 11_500m, 5_000m),
                Line(MonthlyDeclarationFamily.Tfp, "2", 12_050m, 241m)
            },
            Totals(
                (MonthlyDeclarationFamily.Withholding, 1_000m),
                (MonthlyDeclarationFamily.Tfp, 241m)));

        Assert.False(boxes.ContainsKey("Withholding.Line1.Amount"));
        Assert.Equal(241m, boxes["Tfp.Other.Amount"]);
    }

    /// <summary>
    /// « Autres informations » est déclarative : aucun montant à payer, aucune case calibrée.
    /// </summary>
    [Fact]
    public void La_famille_autres_informations_ne_produit_aucune_case()
    {
        var boxes = Project(
            new[] { Line(MonthlyDeclarationFamily.OtherInformation, "3", 5_000m, 0m) },
            Totals((MonthlyDeclarationFamily.OtherInformation, 0m)));

        Assert.Empty(boxes);
    }

    [Fact]
    public void Une_famille_sans_case_de_detail_ne_bloque_pas_les_autres()
    {
        var boxes = Project(
            new[]
            {
                Line(MonthlyDeclarationFamily.Tcl, "3.1", 3_255m, 6.510m),
                Line(MonthlyDeclarationFamily.OtherTurnoverTaxes, "1", 1_000m, 10m)
            },
            Totals(
                (MonthlyDeclarationFamily.Tcl, 6.510m),
                (MonthlyDeclarationFamily.OtherTurnoverTaxes, 10m)));

        Assert.DoesNotContain(boxes.Keys, k => k.StartsWith("Tcl.", StringComparison.Ordinal));
        Assert.Equal(10m, boxes["Fodec.Amount"]);
    }

    [Fact]
    public void Un_detail_vide_ne_produit_aucune_case()
    {
        Assert.Empty(Project(Array.Empty<MonthlyDeclarationLineDto>(), Totals()));
    }

    // ── Fusion dans le binder principal ───────────────────────────────────────

    /// <summary>
    /// Sans détail configuré, le binder se comporte exactement comme avant : c'est ce qui permet à
    /// la suite de tests historique de passer sans y toucher une ligne.
    /// </summary>
    [Fact]
    public void Sans_detail_configure_le_binder_ne_change_pas_de_comportement()
    {
        var dto = new VatDeclarationDto { Year = 2026, Month = 9, Currency = "TND", WithholdingTax = 250m };

        var withOmitted = MonthlyDeclarationFormBinder.Bind(dto);
        var withNull = MonthlyDeclarationFormBinder.Bind(dto, null, null);

        Assert.Equal(withOmitted.Count, withNull.Count);
        Assert.Equal(withOmitted["Withholding.Total"], withNull["Withholding.Total"]);
    }

    [Fact]
    public void Le_detail_configure_est_fusionne_dans_les_cases()
    {
        var dto = new VatDeclarationDto { Year = 2026, Month = 9, Currency = "TND", WithholdingTax = 250m };
        var configured = new Dictionary<string, decimal>(StringComparer.Ordinal)
        {
            ["Withholding.Line4Individuals.Amount"] = 250m
        };

        var values = MonthlyDeclarationFormBinder.Bind(dto, null, configured);

        Assert.Equal("250,000", values["Withholding.Line4Individuals.Amount"]);
    }

    /// <summary>
    /// La règle transverse tient aussi pour les cases configurées : un montant nul laisse la case
    /// vierge, il n'y inscrit pas « 0,000 ».
    /// </summary>
    [Fact]
    public void Une_case_configuree_a_zero_reste_vierge()
    {
        var dto = new VatDeclarationDto { Year = 2026, Month = 9, Currency = "TND" };
        var configured = new Dictionary<string, decimal>(StringComparer.Ordinal)
        {
            ["Withholding.Line1.Amount"] = 0m
        };

        var values = MonthlyDeclarationFormBinder.Bind(dto, null, configured);

        Assert.Null(values["Withholding.Line1.Amount"]);
    }

    /// <summary>
    /// Les trois familles ajoutées par le chantier alimentent leur case « X » et leur ligne de
    /// récapitulatif, et restent muettes sur un dossier en calcul historique.
    /// </summary>
    [Fact]
    public void Les_trois_familles_ajoutees_alimentent_case_et_recapitulatif()
    {
        var sansFamilles = MonthlyDeclarationFormBinder.Bind(
            new VatDeclarationDto { Year = 2026, Month = 9, Currency = "TND" });
        Assert.False(sansFamilles.ContainsKey("Check.HotelTax"));
        Assert.False(sansFamilles.ContainsKey("Recap.HotelTax.Principal"));

        var avecFamilles = MonthlyDeclarationFormBinder.Bind(new VatDeclarationDto
        {
            Year = 2026,
            Month = 9,
            Currency = "TND",
            ConsumptionDuty = 120m,
            HotelTax = 45.500m,
            LicenceFee = 30m
        });

        Assert.Equal("X", avecFamilles["Check.HotelTax"]);
        Assert.Equal("45,500", avecFamilles["Recap.HotelTax.Principal"]);
        Assert.Equal("195,500", avecFamilles["Recap.Total.Principal"]);
    }
}
