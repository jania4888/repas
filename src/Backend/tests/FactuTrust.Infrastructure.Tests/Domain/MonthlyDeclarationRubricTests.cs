using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

/// <summary>
/// Invariants d'une rubrique paramétrable de la déclaration mensuelle. Ce sont eux qui garantissent
/// qu'une configuration saisie à l'écran ne peut pas produire un montant faux sans qu'on le sache.
/// </summary>
public sealed class MonthlyDeclarationRubricTests
{
    private static Result<MonthlyDeclarationRubric> Build(
        MonthlyDeclarationFamily family = MonthlyDeclarationFamily.Tcl,
        string code = "F9_3_1",
        string label = "Le chiffre d'affaires brut local",
        string reportCode = "3.1",
        RubricGrossKind grossKind = RubricGrossKind.Account,
        RubricWithheldKind withheldKind = RubricWithheldKind.GrossTimesRate,
        AccountBalanceSide grossSide = AccountBalanceSide.Credit,
        AccountBalanceSide withheldSide = AccountBalanceSide.Credit,
        decimal ratePercent = 0.2m,
        decimal? fixedGross = null,
        decimal? fixedWithheld = null,
        PayrollContributionComponent? payrollComponent = null,
        DateTime? effectiveFrom = null,
        DateTime? effectiveTo = null,
        PayrollContributionComponent? withheldPayrollComponent = null,
        IReadOnlyList<RubricAccountInput>? accounts = null)
        => MonthlyDeclarationRubric.Create(
            family, code, label, reportCode, grossKind, withheldKind, grossSide, withheldSide,
            ratePercent, fixedGross, fixedWithheld, payrollComponent, withheldPayrollComponent,
            effectiveFrom, effectiveTo,
            accounts ?? new[] { new RubricAccountInput(RubricAccountRole.Gross, "707", RubricAccountMatchMode.Prefix) });

    [Fact]
    public void Create_avec_une_configuration_valide_normalise_le_code()
    {
        var result = Build(code: " f9_3_1 ");

        Assert.True(result.IsSuccess);
        Assert.Equal("F9_3_1", result.Value.Code);
        Assert.True(result.Value.IsActive);
        Assert.Single(result.Value.AccountsFor(RubricAccountRole.Gross));
    }

    [Theory]
    [InlineData("")]
    [InlineData("F9-3-1")]
    [InlineData("F9 3 1")]
    [InlineData("CODE_BEAUCOUP_TROP_LONG_POUR_LA_COLONNE")]
    public void Create_refuse_un_code_hors_charte(string code)
    {
        Assert.True(Build(code: code).IsFailure);
    }

    [Theory]
    [InlineData("")]
    [InlineData("17,2")]
    [InlineData("A")]
    [InlineData("17.")]
    public void Create_refuse_un_code_rapport_hors_charte(string reportCode)
    {
        Assert.True(Build(reportCode: reportCode).IsFailure);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("4.1")]
    [InlineData("17.2")]
    [InlineData("*")]
    public void Create_accepte_les_codes_rapport_du_formulaire(string reportCode)
    {
        Assert.True(Build(reportCode: reportCode).IsSuccess);
    }

    [Theory]
    [InlineData(-0.001)]
    [InlineData(100.001)]
    public void Create_refuse_un_taux_hors_bornes(decimal rate)
    {
        Assert.True(Build(ratePercent: rate).IsFailure);
    }

    [Fact]
    public void Create_accepte_un_taux_de_100_pour_la_retenue_de_TVA_des_non_residents()
    {
        Assert.True(Build(ratePercent: 100m).IsSuccess);
    }

    /// <summary>
    /// Le brut déduit de la retenue et la retenue déduite du brut forment un cycle. Il est refusé à
    /// l'écriture, ce qui dispense le moteur de tout détecteur de cycle à l'exécution.
    /// </summary>
    [Fact]
    public void Create_refuse_le_cycle_entre_les_deux_colonnes()
    {
        var result = Build(
            grossKind: RubricGrossKind.WithheldOverRate,
            withheldKind: RubricWithheldKind.GrossTimesRate,
            ratePercent: 10m);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.GrossKind", result.Error.Code);
    }

    [Fact]
    public void Create_exige_un_taux_positif_quand_le_brut_est_deduit_de_la_retenue()
    {
        var result = Build(
            grossKind: RubricGrossKind.WithheldOverRate,
            withheldKind: RubricWithheldKind.Account,
            ratePercent: 0m,
            accounts: new[] { new RubricAccountInput(RubricAccountRole.Withheld, "43260000", RubricAccountMatchMode.Exact) });

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.RatePercent", result.Error.Code);
    }

    [Fact]
    public void Create_exige_une_valeur_de_paie_quand_le_brut_vient_de_la_paie()
    {
        var sansComposant = Build(
            grossKind: RubricGrossKind.Payroll,
            withheldKind: RubricWithheldKind.GrossTimesRate,
            ratePercent: 2m,
            payrollComponent: null,
            accounts: Array.Empty<RubricAccountInput>());

        Assert.True(sansComposant.IsFailure);
        Assert.Equal("Validation.PayrollComponent", sansComposant.Error.Code);

        var avecComposant = Build(
            grossKind: RubricGrossKind.Payroll,
            withheldKind: RubricWithheldKind.GrossTimesRate,
            ratePercent: 2m,
            payrollComponent: PayrollContributionComponent.PayrollTaxBase,
            accounts: Array.Empty<RubricAccountInput>());

        Assert.True(avecComposant.IsSuccess);
        Assert.Equal(PayrollContributionComponent.PayrollTaxBase, avecComposant.Value.PayrollComponent);
    }

    /// <summary>
    /// La valeur de paie n'est conservée que si elle sert : sur une rubrique dont le brut n'est pas
    /// de type paie, elle serait un vestige que rien ne mettrait à jour.
    /// </summary>
    [Fact]
    public void Create_efface_la_valeur_de_paie_quand_le_brut_ne_vient_pas_de_la_paie()
    {
        var result = Build(payrollComponent: PayrollContributionComponent.WithholdingIrpp);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.PayrollComponent);
    }

    [Fact]
    public void Create_exige_au_moins_un_compte_quand_la_colonne_est_calculee_sur_comptes()
    {
        var result = Build(accounts: Array.Empty<RubricAccountInput>());

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.GrossAccounts", result.Error.Code);
    }

    [Fact]
    public void Create_refuse_un_compte_en_doublon_sur_la_meme_colonne()
    {
        var result = Build(accounts: new[]
        {
            new RubricAccountInput(RubricAccountRole.Gross, "707", RubricAccountMatchMode.Prefix),
            new RubricAccountInput(RubricAccountRole.Gross, "707", RubricAccountMatchMode.Prefix)
        });

        Assert.True(result.IsFailure);
    }

    /// <summary>
    /// Le piège vraiment coûteux : « 70 » en racine et « 707 » en compte exact sur la même colonne
    /// additionneraient 707 deux fois, sans que le montant produit n'ait l'air faux.
    /// </summary>
    [Fact]
    public void Create_refuse_un_recouvrement_entre_une_racine_et_un_compte_de_la_meme_colonne()
    {
        var result = Build(accounts: new[]
        {
            new RubricAccountInput(RubricAccountRole.Gross, "70", RubricAccountMatchMode.Prefix),
            new RubricAccountInput(RubricAccountRole.Gross, "707", RubricAccountMatchMode.Exact)
        });

        Assert.True(result.IsFailure);
        Assert.Contains("deux fois", result.Error.Description);
    }

    /// <summary>
    /// Le recouvrement n'est refusé qu'à l'intérieur d'une colonne : une rubrique peut légitimement
    /// lire le même compte en brut et en retenue.
    /// </summary>
    [Fact]
    public void Create_admet_le_meme_compte_sur_les_deux_colonnes()
    {
        var result = Build(
            grossKind: RubricGrossKind.Account,
            withheldKind: RubricWithheldKind.Account,
            accounts: new[]
            {
                new RubricAccountInput(RubricAccountRole.Gross, "613", RubricAccountMatchMode.Prefix),
                new RubricAccountInput(RubricAccountRole.Withheld, "613", RubricAccountMatchMode.Prefix)
            });

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void Create_refuse_un_numero_de_compte_hors_norme_SCE()
    {
        var result = Build(accounts: new[]
        {
            new RubricAccountInput(RubricAccountRole.Gross, "907", RubricAccountMatchMode.Exact)
        });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Create_refuse_une_racine_non_numerique()
    {
        var result = Build(accounts: new[]
        {
            new RubricAccountInput(RubricAccountRole.Gross, "421.1", RubricAccountMatchMode.Prefix)
        });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Create_refuse_plus_de_comptes_que_le_plafond_par_colonne()
    {
        var accounts = Enumerable.Range(1, MonthlyDeclarationRubric.MaxAccountsPerRole + 1)
            .Select(i => new RubricAccountInput(
                RubricAccountRole.Gross, $"7{i:D5}", RubricAccountMatchMode.Exact))
            .ToList();

        Assert.True(Build(accounts: accounts).IsFailure);
    }

    [Fact]
    public void Create_refuse_une_fenetre_d_application_inversee()
    {
        var result = Build(
            effectiveFrom: new DateTime(2026, 6, 1),
            effectiveTo: new DateTime(2026, 5, 31));

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.EffectiveTo", result.Error.Code);
    }

    // ── Fenêtre d'application ─────────────────────────────────────────────────

    [Fact]
    public void Une_rubrique_sans_fenetre_s_applique_a_toute_periode()
    {
        var rubric = Build().Value;

        Assert.True(rubric.IsApplicableTo(2020, 1));
        Assert.True(rubric.IsApplicableTo(2026, 9));
        Assert.True(rubric.IsApplicableTo(2030, 12));
    }

    /// <summary>
    /// La date maximale tombe le 15 juin : la rubrique s'applique à <b>tout</b> juin, et plus du
    /// tout en juillet. Le choix est assumé — la déclaration a une maille mensuelle, proratiser un
    /// mois inventerait une règle dont le formulaire n'a pas la case.
    /// </summary>
    [Fact]
    public void Une_date_maximale_en_milieu_de_mois_couvre_le_mois_entier()
    {
        var rubric = Build(effectiveTo: new DateTime(2026, 6, 15)).Value;

        Assert.True(rubric.IsApplicableTo(2026, 5));
        Assert.True(rubric.IsApplicableTo(2026, 6));
        Assert.False(rubric.IsApplicableTo(2026, 7));
    }

    [Fact]
    public void Une_date_de_debut_en_milieu_de_mois_couvre_le_mois_entier()
    {
        var rubric = Build(effectiveFrom: new DateTime(2026, 6, 15)).Value;

        Assert.False(rubric.IsApplicableTo(2026, 5));
        Assert.True(rubric.IsApplicableTo(2026, 6));
        Assert.True(rubric.IsApplicableTo(2026, 7));
    }

    [Fact]
    public void Une_rubrique_desactivee_ne_s_applique_a_aucune_periode()
    {
        var rubric = Build().Value;
        rubric.ToggleActive();

        Assert.False(rubric.IsActive);
        Assert.False(rubric.IsApplicableTo(2026, 9));
    }

    // ── Mise à jour ───────────────────────────────────────────────────────────

    /// <summary>
    /// Le code relie la rubrique aux lignes déjà déposées : il ne bouge pas, et la famille non plus
    /// — la déplacer reviendrait à changer d'impôt sous le même identifiant.
    /// </summary>
    [Fact]
    public void Update_ne_touche_ni_au_code_ni_a_la_famille()
    {
        var rubric = Build().Value;

        var result = rubric.Update(
            "Nouveau libellé", "3.2",
            RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0.1m, null, null, null, null, null, null,
            new[] { new RubricAccountInput(RubricAccountRole.Gross, "706", RubricAccountMatchMode.Prefix) },
            5);

        Assert.True(result.IsSuccess);
        Assert.Equal("F9_3_1", rubric.Code);
        Assert.Equal(MonthlyDeclarationFamily.Tcl, rubric.Family);
        Assert.Equal("Nouveau libellé", rubric.Label);
        Assert.Equal("3.2", rubric.ReportCode);
        Assert.Equal(0.1m, rubric.RatePercent);
    }

    [Fact]
    public void Update_remplace_integralement_la_selection_de_comptes()
    {
        var rubric = Build().Value;

        rubric.Update(
            rubric.Label, rubric.ReportCode,
            RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0.2m, null, null, null, null, null, null,
            new[]
            {
                new RubricAccountInput(RubricAccountRole.Gross, "705", RubricAccountMatchMode.Prefix),
                new RubricAccountInput(RubricAccountRole.Gross, "706", RubricAccountMatchMode.Prefix)
            },
            0);

        var gross = rubric.AccountsFor(RubricAccountRole.Gross);
        Assert.Equal(2, gross.Count);
        Assert.DoesNotContain(gross, a => a.AccountNumber == "707");
        Assert.All(gross, a => Assert.Equal(rubric.Id, a.RubricId));
    }

    /// <summary>
    /// Une mise à jour refusée ne doit rien laisser derrière elle : si la validation échoue après
    /// que les comptes ont été construits, l'ancienne sélection reste en place.
    /// </summary>
    [Fact]
    public void Update_refuse_ne_modifie_rien()
    {
        var rubric = Build().Value;
        var before = rubric.AccountsFor(RubricAccountRole.Gross).Single().AccountNumber;

        var result = rubric.Update(
            rubric.Label, "code-invalide",
            RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0.2m, null, null, null, null, null, null,
            new[] { new RubricAccountInput(RubricAccountRole.Gross, "706", RubricAccountMatchMode.Prefix) },
            0);

        Assert.True(result.IsFailure);
        Assert.Equal(before, rubric.AccountsFor(RubricAccountRole.Gross).Single().AccountNumber);
    }
}
