using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Moteur d'évaluation des rubriques paramétrées. Fonction pure : chaque combinaison de types de
/// calcul est vérifiable sans base de données, ce qui est précisément l'intérêt de l'avoir isolée.
/// </summary>
public sealed class MonthlyDeclarationRubricEvaluatorTests
{
    private const string SalesAccount = "707";
    private const string WithholdingAccount = "43260000";

    private static PayrollMonthlyContribution UsablePayroll() => new()
    {
        RunExists = true,
        Status = PayrollRunStatus.Validated,
        IsUsable = true,
        Tfp = 120.500m,
        Foprolos = 60.250m,
        TaxBase = 12_050.000m,
        TfpRatePercent = 1m,
        FoprolosRatePercent = 0.5m,
        WithholdingIrpp = 990.750m,
        WithholdingCss = 60.000m,
        SalariesGrossBase = 13_000.000m,
        SalariesNetTaxableBase = 11_500.000m
    };

    private static RubricPeriodData Data(
        IReadOnlyDictionary<string, AccountPeriodMovement>? movements = null,
        PayrollMonthlyContribution? payroll = null,
        IReadOnlySet<string>? knownAccounts = null)
    {
        var moves = movements ?? new Dictionary<string, AccountPeriodMovement>(StringComparer.Ordinal)
        {
            [SalesAccount] = new(Debit: 1_000.000m, Credit: 10_000.000m),
            [WithholdingAccount] = new(Debit: 0m, Credit: 250.000m)
        };

        return new RubricPeriodData
        {
            Year = 2026,
            Month = 9,
            MovementsByAccount = moves,
            Payroll = payroll ?? UsablePayroll(),
            KnownAccounts = knownAccounts
                ?? new HashSet<string>(moves.Keys, StringComparer.Ordinal)
        };
    }

    private static MonthlyDeclarationRubric Rubric(
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        decimal rate = 10m,
        decimal? fixedGross = null,
        decimal? fixedWithheld = null,
        PayrollContributionComponent? payrollComponent = null,
        PayrollContributionComponent? withheldPayrollComponent = null,
        AccountBalanceSide grossSide = AccountBalanceSide.Credit,
        AccountBalanceSide withheldSide = AccountBalanceSide.Credit,
        IReadOnlyList<RubricAccountInput>? accounts = null,
        MonthlyDeclarationFamily family = MonthlyDeclarationFamily.Withholding,
        string code = "F1_4_1")
    {
        accounts ??= new[]
        {
            new RubricAccountInput(RubricAccountRole.Gross, SalesAccount, RubricAccountMatchMode.Exact),
            new RubricAccountInput(RubricAccountRole.Withheld, WithholdingAccount, RubricAccountMatchMode.Exact)
        };

        var result = MonthlyDeclarationRubric.Create(
            family, code, "Rubrique de test", "4.1", grossKind, withheldKind,
            grossSide, withheldSide, rate, fixedGross, fixedWithheld, payrollComponent,
            withheldPayrollComponent, null, null, accounts);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        return result.Value;
    }

    // ── Colonne « Montant brut » ──────────────────────────────────────────────

    [Fact]
    public void Brut_fixe_reprend_la_constante_enregistree()
    {
        var rubric = Rubric(RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            fixedGross: 3_255.000m, fixedWithheld: 32.550m);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(3_255.000m, line.Gross);
        Assert.Equal(32.550m, line.Withheld);
        Assert.False(line.RequiresManualInput);
    }

    /// <summary>
    /// Une constante absente ne vaut pas zéro : elle signifie « à saisir ». Le montant rendu est
    /// bien 0, mais la ligne se déclare en attente de saisie — sans quoi l'écran ne pourrait pas
    /// distinguer une ligne à remplir d'une ligne réellement nulle.
    /// </summary>
    [Fact]
    public void Brut_fixe_sans_constante_signale_une_saisie_attendue()
    {
        var rubric = Rubric(RubricGrossKind.Fixed, RubricWithheldKind.Fixed);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(0m, line.Gross);
        Assert.True(line.RequiresManualInput);
    }

    [Theory]
    [InlineData(PayrollContributionComponent.PayrollTaxBase, 12_050.000)]
    [InlineData(PayrollContributionComponent.SalariesNetTaxableBase, 11_500.000)]
    [InlineData(PayrollContributionComponent.SalariesGrossBase, 13_000.000)]
    [InlineData(PayrollContributionComponent.WithholdingIrpp, 990.750)]
    [InlineData(PayrollContributionComponent.WithholdingCss, 60.000)]
    [InlineData(PayrollContributionComponent.WithholdingTotal, 1_050.750)]
    [InlineData(PayrollContributionComponent.Tfp, 120.500)]
    [InlineData(PayrollContributionComponent.Foprolos, 60.250)]
    public void Brut_paie_projette_la_valeur_designee_du_cycle(
        PayrollContributionComponent component, decimal expected)
    {
        var rubric = Rubric(RubricGrossKind.Payroll, RubricWithheldKind.Fixed,
            payrollComponent: component, fixedWithheld: 0m,
            accounts: Array.Empty<RubricAccountInput>());

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(expected, line.Gross);
    }

    /// <summary>
    /// Un cycle non arrêté rend zéro et le signale. Le chemin de calcul historique refuse déjà une
    /// paie en brouillon : une rubrique paramétrée ne doit pas servir de porte dérobée.
    /// </summary>
    [Fact]
    public void Brut_paie_sur_un_cycle_non_arrete_rend_zero_et_le_signale()
    {
        var rubric = Rubric(RubricGrossKind.Payroll, RubricWithheldKind.Fixed,
            payrollComponent: PayrollContributionComponent.PayrollTaxBase, fixedWithheld: 0m,
            accounts: Array.Empty<RubricAccountInput>());

        var data = Data(payroll: PayrollMonthlyContribution.NotUsable(PayrollRunStatus.Calculated));
        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, data);

        Assert.Equal(0m, line.Gross);
        Assert.Contains(line.Diagnostics, d => d.Kind == RubricDiagnosticKind.PayrollRunNotUsable);
    }

    [Theory]
    [InlineData(AccountBalanceSide.Credit, 10_000.000)]
    [InlineData(AccountBalanceSide.Debit, 1_000.000)]
    public void Brut_compte_lit_le_sens_demande_sans_compenser(
        AccountBalanceSide side, decimal expected)
    {
        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.Fixed,
            grossSide: side, fixedWithheld: 0m);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(expected, line.Gross);
    }

    [Fact]
    public void Brut_compte_cumule_une_racine_sur_toute_sa_descendance()
    {
        var movements = new Dictionary<string, AccountPeriodMovement>(StringComparer.Ordinal)
        {
            ["7071"] = new(0m, 4_000.000m),
            ["7072"] = new(0m, 6_000.000m),
            ["706"] = new(0m, 999.000m)
        };

        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.Fixed, fixedWithheld: 0m,
            accounts: new[]
            {
                new RubricAccountInput(RubricAccountRole.Gross, "707", RubricAccountMatchMode.Prefix)
            });

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data(movements));

        Assert.Equal(10_000.000m, line.Gross);
    }

    /// <summary>
    /// Le brut déduit de la retenue : la retenue est calculée d'abord, l'ordre étant résolu
    /// statiquement puisqu'une rubrique ne référence jamais une autre rubrique.
    /// </summary>
    [Fact]
    public void Brut_deduit_de_la_retenue_inverse_l_ordre_de_calcul()
    {
        var rubric = Rubric(RubricGrossKind.WithheldOverRate, RubricWithheldKind.Account, rate: 10m);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(250.000m, line.Withheld);
        Assert.Equal(2_500.000m, line.Gross);
    }

    // ── Colonne « Retenue » ───────────────────────────────────────────────────

    [Fact]
    public void Retenue_brut_fois_taux_applique_le_taux_au_brut_calcule()
    {
        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate, rate: 10m);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(10_000.000m, line.Gross);
        Assert.Equal(1_000.000m, line.Withheld);
        Assert.Equal(10m, line.RatePercentApplied);
    }

    [Fact]
    public void Retenue_compte_lit_les_comptes_de_sa_propre_colonne()
    {
        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.Account);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(10_000.000m, line.Gross);
        Assert.Equal(250.000m, line.Withheld);
    }

    /// <summary>
    /// « Retenu/taux » sur l'axe retenue n'a pas de lecture fiscale univoque : le moteur rend zéro
    /// et le dit, plutôt que d'inventer une formule dont le résultat aurait l'air plausible.
    /// </summary>
    [Fact]
    public void Retenue_deduite_d_elle_meme_n_est_pas_calculee_et_le_signale()
    {
        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.WithheldOverRate, rate: 10m);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(0m, line.Withheld);
        Assert.Contains(line.Diagnostics, d => d.Kind == RubricDiagnosticKind.UnsupportedCombination);
    }

    // ── Arrondi, taux, comptes absents ────────────────────────────────────────

    /// <summary>
    /// L'arrondi au millime n'intervient qu'en sortie de colonne. Sur 10 000,005 × 0,2 %, arrondir
    /// l'assiette d'abord donnerait un résultat différent du produit arrondi.
    /// </summary>
    [Fact]
    public void L_arrondi_au_millime_n_intervient_qu_en_sortie_de_colonne()
    {
        var movements = new Dictionary<string, AccountPeriodMovement>(StringComparer.Ordinal)
        {
            [SalesAccount] = new(0m, 3_255.5555m)
        };

        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate, rate: 0.2m);
        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data(movements));

        Assert.Equal(3_255.556m, line.Gross);
        // 3 255,5555 × 0,2 % = 6,511111 → 6,511 ; et non 3 255,556 arrondi puis multiplié.
        Assert.Equal(6.511m, line.Withheld);
    }

    [Fact]
    public void Un_taux_nul_sur_un_calcul_qui_en_depend_rend_zero_et_le_signale()
    {
        var rubric = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Withholding, "F1_X", "Taux nul", "1",
            RubricGrossKind.Account, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0m, null, 0m, null, null, null, null,
            new[] { new RubricAccountInput(RubricAccountRole.Gross, SalesAccount, RubricAccountMatchMode.Exact) }).Value;

        // La configuration est valide (aucune colonne ne dépend du taux) : le moteur n'a rien à
        // signaler, il n'y a pas de division par zéro possible.
        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(10_000.000m, line.Gross);
        Assert.DoesNotContain(line.Diagnostics, d => d.Kind == RubricDiagnosticKind.RateRequired);
    }

    /// <summary>
    /// Un compte disparu du plan contribue zéro — mais jamais en silence : ce zéro est exactement le
    /// symptôme d'une renumérotation de plan mal propagée.
    /// </summary>
    [Fact]
    public void Un_compte_absent_du_plan_contribue_zero_et_est_signale()
    {
        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.Fixed, fixedWithheld: 0m,
            accounts: new[]
            {
                new RubricAccountInput(RubricAccountRole.Gross, "705", RubricAccountMatchMode.Exact)
            });

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(0m, line.Gross);
        var diagnostic = Assert.Single(line.Diagnostics);
        Assert.Equal(RubricDiagnosticKind.UnknownAccount, diagnostic.Kind);
        Assert.Equal("705", diagnostic.Detail);
    }

    [Fact]
    public void Un_compte_connu_mais_sans_mouvement_ne_produit_aucun_signalement()
    {
        var known = new HashSet<string>(StringComparer.Ordinal) { SalesAccount, "705", WithholdingAccount };
        var rubric = Rubric(RubricGrossKind.Account, RubricWithheldKind.Fixed, fixedWithheld: 0m,
            accounts: new[]
            {
                new RubricAccountInput(RubricAccountRole.Gross, "705", RubricAccountMatchMode.Exact)
            });

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data(knownAccounts: known));

        Assert.Equal(0m, line.Gross);
        Assert.Empty(line.Diagnostics);
    }

    /// <summary>
    /// Les montants restent signés. Écrêter ici casserait ce que les mouvements signés ont été
    /// introduits pour réparer : une période où une extourne domine.
    /// </summary>
    [Fact]
    public void Les_montants_negatifs_ne_sont_pas_ecretes_par_le_moteur()
    {
        var rubric = Rubric(RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            fixedGross: -500.000m, fixedWithheld: -50.000m);

        var line = MonthlyDeclarationRubricEvaluator.EvaluateOne(rubric, Data());

        Assert.Equal(-500.000m, line.Gross);
        Assert.Equal(-50.000m, line.Withheld);
    }

    // ── Garde-fou de total de famille ─────────────────────────────────────────

    private static RubricEvaluation Line(
        MonthlyDeclarationFamily family, string code, decimal withheld) => new()
        {
            Code = code,
            Label = code,
            Family = family,
            ReportCode = "1",
            Gross = withheld * 10m,
            Withheld = withheld,
            RatePercentApplied = 10m
        };

    [Fact]
    public void Le_garde_fou_laisse_passer_une_ventilation_coherente()
    {
        var lines = new[]
        {
            Line(MonthlyDeclarationFamily.Withholding, "F1_1", 600m),
            Line(MonthlyDeclarationFamily.Withholding, "F1_3", 400m)
        };

        var guarded = MonthlyDeclarationLineGuard.EnsureWithinFamilyTotal(
            lines, MonthlyDeclarationFamily.Withholding, 1_000m);

        Assert.All(guarded, l => Assert.False(MonthlyDeclarationLineGuard.IsSuppressed(l)));
    }

    [Fact]
    public void Le_garde_fou_tolere_un_ecart_d_un_millime()
    {
        var lines = new[] { Line(MonthlyDeclarationFamily.Withholding, "F1_1", 1_000.001m) };

        var guarded = MonthlyDeclarationLineGuard.EnsureWithinFamilyTotal(
            lines, MonthlyDeclarationFamily.Withholding, 1_000.000m);

        Assert.False(MonthlyDeclarationLineGuard.IsSuppressed(guarded[0]));
    }

    [Fact]
    public void Le_garde_fou_ecarte_toute_la_famille_en_depassement()
    {
        var lines = new[]
        {
            Line(MonthlyDeclarationFamily.Withholding, "F1_1", 900m),
            Line(MonthlyDeclarationFamily.Withholding, "F1_3", 400m)
        };

        var guarded = MonthlyDeclarationLineGuard.EnsureWithinFamilyTotal(
            lines, MonthlyDeclarationFamily.Withholding, 1_000m);

        Assert.All(guarded, l => Assert.True(MonthlyDeclarationLineGuard.IsSuppressed(l)));
    }

    /// <summary>
    /// Le contrôle est cloisonné par famille : c'est la correction même qu'a demandée la ventilation
    /// historique, où un dépassement sur les factures emportait aussi la retenue salariale.
    /// </summary>
    [Fact]
    public void Un_depassement_sur_une_famille_n_emporte_pas_les_autres()
    {
        var lines = new[]
        {
            Line(MonthlyDeclarationFamily.Withholding, "F1_1", 5_000m),
            Line(MonthlyDeclarationFamily.Tfp, "F2_2", 120m)
        };

        var guarded = MonthlyDeclarationLineGuard.EnsureWithinFamilyTotal(
            lines, MonthlyDeclarationFamily.Withholding, 1_000m);

        Assert.True(MonthlyDeclarationLineGuard.IsSuppressed(
            guarded.Single(l => l.Family == MonthlyDeclarationFamily.Withholding)));
        Assert.False(MonthlyDeclarationLineGuard.IsSuppressed(
            guarded.Single(l => l.Family == MonthlyDeclarationFamily.Tfp)));
    }

    [Fact]
    public void Le_garde_fou_sur_une_famille_sans_ligne_ne_change_rien()
    {
        var lines = new[] { Line(MonthlyDeclarationFamily.Tfp, "F2_2", 120m) };

        var guarded = MonthlyDeclarationLineGuard.EnsureWithinFamilyTotal(
            lines, MonthlyDeclarationFamily.Withholding, 0m);

        Assert.Same(lines, guarded);
    }

    // ── Évaluation en lot ─────────────────────────────────────────────────────

    [Fact]
    public void Evaluate_conserve_l_ordre_des_rubriques_fournies()
    {
        var rubrics = new[]
        {
            Rubric(RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate, code: "F1_1"),
            Rubric(RubricGrossKind.Fixed, RubricWithheldKind.Fixed, code: "F1_3",
                fixedGross: 3m, fixedWithheld: 1m, accounts: Array.Empty<RubricAccountInput>())
        };

        var lines = MonthlyDeclarationRubricEvaluator.Evaluate(rubrics, Data());

        Assert.Equal(new[] { "F1_1", "F1_3" }, lines.Select(l => l.Code));
    }
}
