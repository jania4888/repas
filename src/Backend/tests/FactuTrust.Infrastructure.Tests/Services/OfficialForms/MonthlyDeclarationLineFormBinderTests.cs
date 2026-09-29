using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
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

    // ── Garde-fous de la projection ───────────────────────────────────────────

    /// <summary>
    /// Règle de la ventilation historique : un IRPP nul ne reporte ni l'assiette ni le montant. Sans
    /// elle, la case de l'assiette serait remplie seule, et une rubrique à zéro effacerait par un
    /// <c>null</c> la case posée par le binder principal.
    /// </summary>
    [Fact]
    public void Une_ligne_a_retenue_nulle_ne_produit_aucune_case()
    {
        var boxes = Project(
            new[]
            {
                Line(MonthlyDeclarationFamily.Withholding, "1", 11_500m, 0m, "F1_1"),
                Line(MonthlyDeclarationFamily.Withholding, "3", 11_500m, 50m, "F1_3")
            },
            Totals((MonthlyDeclarationFamily.Withholding, 50m)));

        Assert.False(boxes.ContainsKey("Withholding.Line1.Base"));
        Assert.False(boxes.ContainsKey("Withholding.Line1.Amount"));
        Assert.Equal(50m, boxes["Withholding.Line3.Amount"]);
    }

    /// <summary>
    /// Le moteur rend des montants signés (période d'extourne) ; le formulaire, lui, n'imprime jamais
    /// un négatif — le binder principal non plus.
    /// </summary>
    [Fact]
    public void Une_ligne_negative_n_est_pas_imprimee()
    {
        var boxes = Project(
            new[] { Line(MonthlyDeclarationFamily.OtherTurnoverTaxes, "1", -1_000m, -10m) },
            Totals((MonthlyDeclarationFamily.OtherTurnoverTaxes, 0m)));

        Assert.Empty(boxes);
    }

    [Fact]
    public void Une_famille_au_total_declare_nul_n_imprime_aucun_detail()
    {
        var boxes = Project(
            new[] { Line(MonthlyDeclarationFamily.Withholding, "5", 1_000m, 100m) },
            Totals((MonthlyDeclarationFamily.Withholding, 0m)));

        Assert.Empty(boxes);
    }

    /// <summary>
    /// Les totaux restent modifiables à la main. Une TFP corrigée à 300 alors que la ligne calcule
    /// 241 : projeter 241 dans la case de détail, sous un total et un récapitulatif à 300, ferait se
    /// contredire le formulaire. Le binder principal, qui lit le total déclaré, garde la main.
    /// </summary>
    [Theory]
    [InlineData(MonthlyDeclarationFamily.Tfp, "2", "Tfp.Other.Amount")]
    [InlineData(MonthlyDeclarationFamily.Foprolos, "1", "Foprolos.Amount")]
    [InlineData(MonthlyDeclarationFamily.OtherTurnoverTaxes, "1", "Fodec.Amount")]
    public void Une_famille_a_case_unique_corrigee_a_la_main_n_est_pas_projetee(
        MonthlyDeclarationFamily family, string reportCode, string amountKey)
    {
        var corrected = Project(
            new[] { Line(family, reportCode, 12_050m, 241m) },
            Totals((family, 300m)));
        var matching = Project(
            new[] { Line(family, reportCode, 12_050m, 241m) },
            Totals((family, 241m)));

        Assert.False(corrected.ContainsKey(amountKey));
        Assert.Equal(241m, matching[amountKey]);
    }

    /// <summary>
    /// La retenue à la source se ventile : un détail inférieur au total (reliquat sans case, total
    /// relevé à la main) reste imprimé. Seul le dépassement l'écarte.
    /// </summary>
    [Fact]
    public void Le_detail_de_la_retenue_peut_etre_inferieur_au_total()
    {
        var boxes = Project(
            new[] { Line(MonthlyDeclarationFamily.Withholding, "5", 1_000m, 100m) },
            Totals((MonthlyDeclarationFamily.Withholding, 180m)));

        Assert.Equal(100m, boxes["Withholding.Line5.Amount"]);
    }

    /// <summary>
    /// La T.V.A est hors du moteur : ses cases viennent toujours du module TVA. Une rubrique TVA
    /// « à saisir » (zéro) ou mal réglée ne doit jamais toucher une case TVA.
    /// </summary>
    [Fact]
    public void La_famille_tva_n_est_jamais_projetee()
    {
        var boxes = Project(
            new[]
            {
                Line(MonthlyDeclarationFamily.Vat, "1.3", 1_000m, 190m),
                Line(MonthlyDeclarationFamily.Vat, "1.1", 0m, 0m)
            },
            Totals((MonthlyDeclarationFamily.Vat, 1_000m)));

        Assert.Empty(boxes);
    }

    [Fact]
    public void Une_assiette_nulle_n_ecrit_que_le_montant()
    {
        var boxes = Project(
            new[] { Line(MonthlyDeclarationFamily.Withholding, "5", 0m, 100m) },
            Totals((MonthlyDeclarationFamily.Withholding, 100m)));

        Assert.False(boxes.ContainsKey("Withholding.Line5.Base"));
        Assert.Equal(100m, boxes["Withholding.Line5.Amount"]);
    }

    // ── Signalements : même décision que la projection ────────────────────────

    private static IReadOnlyList<MonthlyDeclarationLineDto> Annotate(
        IReadOnlyList<MonthlyDeclarationLineDto> lines,
        IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> totals) =>
        MonthlyDeclarationLineFormBinder.Annotate(lines, totals, MonthlyDeclarationFormBinder.FormVersion);

    private static IEnumerable<int> Kinds(MonthlyDeclarationLineDto line) => line.Diagnostics.Select(d => d.Kind);

    [Fact]
    public void Un_code_rapport_sans_case_est_signale_mais_pas_le_repli_etoile()
    {
        var annotated = Annotate(
            new[]
            {
                Line(MonthlyDeclarationFamily.Withholding, "99.9", 1_000m, 10m, "FX1"),
                Line(MonthlyDeclarationFamily.Withholding, "*", 1_000m, 10m, "FX2"),
                Line(MonthlyDeclarationFamily.Tcl, "3.1", 3_255m, 6.51m, "FX3")
            },
            Totals((MonthlyDeclarationFamily.Withholding, 20m), (MonthlyDeclarationFamily.Tcl, 6.51m)));

        Assert.Contains((int)RubricDiagnosticKind.UnmappedReportCode, Kinds(annotated[0]));
        Assert.Empty(annotated[1].Diagnostics);
        Assert.Empty(annotated[2].Diagnostics);
    }

    [Fact]
    public void Une_famille_ecartee_du_formulaire_le_dit_sur_chaque_ligne_imprimable()
    {
        var annotated = Annotate(
            new[] { Line(MonthlyDeclarationFamily.Tfp, "2", 12_050m, 241m) },
            Totals((MonthlyDeclarationFamily.Tfp, 300m)));

        var diagnostic = Assert.Single(annotated[0].Diagnostics);
        Assert.Equal((int)RubricDiagnosticKind.SuppressedFromForm, diagnostic.Kind);
        Assert.Contains("300.000", diagnostic.Detail);
    }

    [Fact]
    public void Les_lignes_tva_ne_sont_pas_signalees()
    {
        var annotated = Annotate(
            new[] { Line(MonthlyDeclarationFamily.Vat, "9.9", 1_000m, 190m) },
            Totals((MonthlyDeclarationFamily.Vat, 0m)));

        Assert.Empty(annotated[0].Diagnostics);
    }

    [Fact]
    public void Une_famille_imprimee_n_est_pas_signalee()
    {
        var lines = new[] { Line(MonthlyDeclarationFamily.Withholding, "5", 1_000m, 100m) };

        var annotated = Annotate(lines, Totals((MonthlyDeclarationFamily.Withholding, 100m)));

        Assert.Same(lines[0], annotated[0]);
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
