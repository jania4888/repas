using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Origine « documents » des rubriques, TFP ventilée par activité et contrôle anti-double lecture :
/// ce qu'il faut au moteur pour reproduire le calcul historique sans le câbler.
/// </summary>
public sealed class MonthlyDeclarationDocumentSourcesTests
{
    // ── Partition du rapport de retenue à la source ──────────────────────────

    private static WithholdingReportByCategoryDto Row(WithholdingCategory category, decimal ht, decimal withheld) =>
        new(category, category.ToString(), ht, withheld, 1);

    private static WithholdingMonthlyReportDto Report(decimal grandHt, decimal grandWithheld, params WithholdingReportByCategoryDto[] rows) =>
        new(2026, 9, rows.ToList(), grandHt, grandWithheld, rows.Length);

    private static DeclarationDocumentContribution Documents(WithholdingMonthlyReportDto? report) =>
        DeclarationDocumentContribution.From(10_000m, 11_900m, 0m, 100m, 1m, report);

    /// <summary>
    /// Le rapport regroupe par préfixe de type : une même catégorie peut occuper plusieurs lignes.
    /// Elles se cumulent dans leur compartiment, exactement comme la ventilation du formulaire.
    /// </summary>
    [Fact]
    public void Plusieurs_lignes_d_une_meme_categorie_se_cumulent()
    {
        var docs = Documents(Report(
            4_000m, 350m,
            Row(WithholdingCategory.Honoraires, 1_000m, 30m),
            Row(WithholdingCategory.Honoraires, 2_000m, 60m),
            Row(WithholdingCategory.Honoraires, 1_000m, 100m),
            Row(WithholdingCategory.Commissions, 0m, 160m)));

        Assert.Equal(3_000m, docs.ValueOf(DeclarationDocumentSource.WithholdingFeesRealRegimeBase));
        Assert.Equal(90m, docs.ValueOf(DeclarationDocumentSource.WithholdingFeesRealRegimeAmount));
        Assert.Equal(100m, docs.ValueOf(DeclarationDocumentSource.WithholdingFeesOtherAmount));
        // Assiette nulle : le montant compte, l'assiette non — la règle de la ventilation.
        Assert.Equal(0m, docs.ValueOf(DeclarationDocumentSource.WithholdingCommissionsAndRentsBase));
        Assert.Equal(160m, docs.ValueOf(DeclarationDocumentSource.WithholdingCommissionsAndRentsAmount));
        Assert.Equal(0m, docs.ValueOf(DeclarationDocumentSource.WithholdingRemainderAmount));
    }

    /// <summary>
    /// La ventilation saute les lignes à retenue négative (avoirs) et les catégories sans case ; le
    /// total, lui, les compte. Le reliquat les absorbe : la somme des compartiments égale le total.
    /// </summary>
    [Fact]
    public void Les_lignes_negatives_et_sans_case_tombent_dans_le_reliquat()
    {
        var docs = Documents(Report(
            3_100m, 115m,
            Row(WithholdingCategory.Honoraires, 1_000m, 30m),
            Row(WithholdingCategory.Honoraires, 500m, -15m),
            Row(WithholdingCategory.Jeux, 1_000m, 250m),
            Row(WithholdingCategory.Achats, 600m, -150m)));

        Assert.Equal(30m, docs.ValueOf(DeclarationDocumentSource.WithholdingFeesRealRegimeAmount));
        Assert.Equal(85m, docs.ValueOf(DeclarationDocumentSource.WithholdingRemainderAmount));
        Assert.Equal(2_100m, docs.ValueOf(DeclarationDocumentSource.WithholdingRemainderBase));
        Assert.Equal(115m, SumOfWithholdingAmounts(docs));
    }

    /// <summary>Rapport incohérent — lignes vides, total 40 : le total reste intégralement déclaré.</summary>
    [Fact]
    public void Un_rapport_sans_ligne_mais_avec_total_reste_integralement_declare()
    {
        var docs = Documents(Report(400m, 40m));

        Assert.Equal(40m, docs.ValueOf(DeclarationDocumentSource.WithholdingRemainderAmount));
        Assert.Equal(40m, SumOfWithholdingAmounts(docs));
    }

    [Fact]
    public void Sans_rapport_toutes_les_valeurs_de_retenue_valent_zero()
    {
        Assert.Equal(0m, SumOfWithholdingAmounts(Documents(null)));
    }

    /// <summary>Même partition que le formulaire : les deux chemins ne peuvent pas diverger.</summary>
    [Theory]
    [InlineData(WithholdingCategory.Salaires, 1_000, 100, "Line1")]
    [InlineData(WithholdingCategory.Honoraires, 1_000, 30, "Line6")]
    [InlineData(WithholdingCategory.Honoraires, 1_000, 100, "Line5")]
    [InlineData(WithholdingCategory.Loyers, 1_000, 100, "Line4Entities")]
    [InlineData(WithholdingCategory.Achats, 1_000, 5, "Line17Rate05")]
    [InlineData(WithholdingCategory.TVA, 1_000, 1_000, "Line19")]
    [InlineData(WithholdingCategory.TVA, 1_000, 250, "Line18")]
    public void La_partition_est_celle_du_formulaire_officiel(
        WithholdingCategory category, int ht, int withheld, string expectedLine)
    {
        var bucket = WithholdingReportPartition.Bucket(Row(category, ht, withheld));

        Assert.Equal(expectedLine, WithholdingReportPartition.FormLine(bucket));
    }

    [Fact]
    public void L_assiette_fodec_reprend_le_chiffre_d_affaires_a_defaut_d_assiette_propre()
    {
        var withBase = DeclarationDocumentContribution.From(10_000m, 11_900m, 8_000m, 80m, 1m, null);
        var withoutBase = DeclarationDocumentContribution.From(10_000m, 11_900m, 0m, 80m, 1m, null);

        Assert.Equal(8_000m, withBase.ValueOf(DeclarationDocumentSource.FodecFormBase));
        Assert.Equal(10_000m, withoutBase.ValueOf(DeclarationDocumentSource.FodecFormBase));
        Assert.Equal(11_900m, withoutBase.ValueOf(DeclarationDocumentSource.SalesGrossBase));
    }

    private static decimal SumOfWithholdingAmounts(DeclarationDocumentContribution docs) =>
        Enum.GetValues<DeclarationDocumentSource>()
            .Where(s => (int)s >= 200 && !DeclarationDocumentSources.IsBase(s))
            .Sum(docs.ValueOf);

    // ── Moteur : origine « documents » et TFP par activité ────────────────────

    private static MonthlyDeclarationRubric Rubric(
        string code,
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        decimal rate = 0m,
        PayrollContributionComponent? payroll = null,
        PayrollContributionComponent? withheldPayroll = null,
        DeclarationDocumentSource? grossDocument = null,
        DeclarationDocumentSource? withheldDocument = null,
        MonthlyDeclarationFamily family = MonthlyDeclarationFamily.Withholding,
        DateTime? from = null,
        DateTime? to = null)
    {
        var result = MonthlyDeclarationRubric.Create(
            family, code, code, "*", grossKind, withheldKind,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit, rate, null, null,
            payroll, withheldPayroll, from, to, accounts: null, displayOrder: 0,
            grossDocument, withheldDocument);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        return result.Value;
    }

    private static RubricPeriodData Period(decimal tfpRatePercent = 1m, DeclarationDocumentContribution? documents = null) => new()
    {
        Year = 2026,
        Month = 9,
        MovementsByAccount = new Dictionary<string, FactuTrust.Domain.ValueObjects.AccountPeriodMovement>(),
        KnownAccounts = new HashSet<string>(),
        Documents = documents ?? DeclarationDocumentContribution.None,
        Payroll = new PayrollMonthlyContribution
        {
            RunExists = true,
            Status = PayrollRunStatus.Validated,
            IsUsable = true,
            TaxBase = 10_000m,
            Tfp = 10_000m * tfpRatePercent / 100m,
            TfpRatePercent = tfpRatePercent
        }
    };

    [Fact]
    public void Une_rubrique_documents_lit_ses_deux_colonnes_sur_les_documents()
    {
        var rubric = Rubric(
            "F6_1", RubricGrossKind.Document, RubricWithheldKind.Document,
            grossDocument: DeclarationDocumentSource.FodecFormBase,
            withheldDocument: DeclarationDocumentSource.FodecAmount,
            family: MonthlyDeclarationFamily.OtherTurnoverTaxes);

        var line = Assert.Single(MonthlyDeclarationRubricEvaluator.Evaluate(
            new[] { rubric },
            Period(documents: DeclarationDocumentContribution.From(10_000m, 11_900m, 8_000m, 80m, 1m, null))));

        Assert.Equal(8_000m, line.Gross);
        Assert.Equal(80m, line.Withheld);
    }

    /// <summary>
    /// Deux rubriques, une par ligne du formulaire : seule celle de l'activité réelle porte la TFP,
    /// et leur somme égale toujours la TFP du cycle — jamais 3 %.
    /// </summary>
    [Theory]
    [InlineData(1, 100, 0)]
    [InlineData(2, 0, 200)]
    public void La_tfp_par_activite_n_est_portee_que_par_la_ligne_de_l_activite(
        int ratePercent, int expectedManufacturing, int expectedOther)
    {
        var manufacturing = Rubric(
            "F2_1", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBaseManufacturing,
            withheldPayroll: PayrollContributionComponent.TfpManufacturing,
            family: MonthlyDeclarationFamily.Tfp);
        var other = Rubric(
            "F2_2", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBaseOtherActivities,
            withheldPayroll: PayrollContributionComponent.TfpOtherActivities,
            family: MonthlyDeclarationFamily.Tfp);

        var lines = MonthlyDeclarationRubricEvaluator.Evaluate(new[] { manufacturing, other }, Period(ratePercent));

        Assert.Equal(expectedManufacturing, lines.Single(l => l.Code == "F2_1").Withheld);
        Assert.Equal(expectedOther, lines.Single(l => l.Code == "F2_2").Withheld);
        Assert.Equal(10_000m * ratePercent / 100m, lines.Sum(l => l.Withheld));
        Assert.Equal(10_000m, lines.Sum(l => l.Gross));
    }

    [Theory]
    [InlineData(1, "Tfp.Manufacturing")]
    [InlineData(2, "Tfp.Other")]
    public void Formulaire_et_moteur_partagent_la_meme_regle_d_activite(int ratePercent, string expectedPrefix)
    {
        var isManufacturing = TfpActivity.IsManufacturing(ratePercent, 10_000m * ratePercent / 100m, 10_000m);

        Assert.Equal(expectedPrefix == "Tfp.Manufacturing", isManufacturing);
    }

    // ── Validation du domaine ─────────────────────────────────────────────────

    private static MonthlyDeclarationRubric? TryCreate(
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        DeclarationDocumentSource? grossDocument = null,
        DeclarationDocumentSource? withheldDocument = null,
        AccountBalanceSide grossSide = AccountBalanceSide.Credit)
    {
        var result = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Withholding, "FX", "FX", "*", grossKind, withheldKind,
            grossSide, AccountBalanceSide.Credit, 10m, 0m, null, null, null, null, null, null, 0,
            grossDocument, withheldDocument);
        return result.IsSuccess ? result.Value : null;
    }

    [Fact]
    public void Une_colonne_documents_doit_designer_sa_valeur()
    {
        Assert.Null(TryCreate(RubricGrossKind.Fixed, RubricWithheldKind.Document));
        Assert.Null(TryCreate(RubricGrossKind.Document, RubricWithheldKind.GrossTimesRate));
    }

    /// <summary>Lire le chiffre d'affaires comme une retenue produirait un impôt égal au CA.</summary>
    [Fact]
    public void Une_assiette_ne_peut_pas_alimenter_la_retenue_ni_un_montant_le_brut()
    {
        Assert.Null(TryCreate(RubricGrossKind.Fixed, RubricWithheldKind.Document,
            withheldDocument: DeclarationDocumentSource.SalesTaxableBase));
        Assert.Null(TryCreate(RubricGrossKind.Document, RubricWithheldKind.GrossTimesRate,
            grossDocument: DeclarationDocumentSource.FodecAmount));
        Assert.NotNull(TryCreate(RubricGrossKind.Document, RubricWithheldKind.Document,
            DeclarationDocumentSource.WithholdingDividendsBase, DeclarationDocumentSource.WithholdingDividendsAmount));
    }

    /// <summary>« 42 » transmis par l'API ou par un fichier ne doit jamais devenir une rubrique.</summary>
    [Fact]
    public void Une_enumeration_hors_liste_est_refusee_par_le_domaine()
    {
        Assert.Null(TryCreate((RubricGrossKind)42, RubricWithheldKind.GrossTimesRate));
        Assert.Null(TryCreate(RubricGrossKind.Fixed, (RubricWithheldKind)42));
        Assert.Null(TryCreate(RubricGrossKind.Fixed, RubricWithheldKind.GrossTimesRate, grossSide: (AccountBalanceSide)7));
        Assert.Null(TryCreate(RubricGrossKind.Fixed, RubricWithheldKind.Document,
            withheldDocument: (DeclarationDocumentSource)999));
    }

    [Fact]
    public void La_source_documentaire_n_est_conservee_que_pour_une_colonne_documents()
    {
        var rubric = TryCreate(RubricGrossKind.Fixed, RubricWithheldKind.GrossTimesRate,
            grossDocument: DeclarationDocumentSource.SalesGrossBase);

        Assert.NotNull(rubric);
        Assert.Null(rubric!.GrossDocumentSource);
    }

    // ── Contrôle anti-double lecture ──────────────────────────────────────────

    private static MonthlyDeclarationRubric Irpp(string code, DateTime? from = null, DateTime? to = null,
        PayrollContributionComponent component = PayrollContributionComponent.WithholdingIrpp) =>
        Rubric(code, RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.SalariesNetTaxableBase, withheldPayroll: component,
            from: from, to: to);

    [Fact]
    public void Deux_rubriques_qui_reprennent_l_irpp_sont_en_conflit()
    {
        var conflict = Assert.Single(MonthlyDeclarationSourceOverlap.AllConflicts(new[] { Irpp("F1_1"), Irpp("F1_1B") }));

        Assert.Equal("F1_1", conflict.Code);
        Assert.Equal("F1_1B", conflict.OtherCode);
        Assert.Contains("déclaré deux fois", MonthlyDeclarationSourceOverlap.Refusal(conflict).Description);
    }

    /// <summary>L'IRPP + CSS recouvre l'IRPP seul : la comparaison se fait par atomes.</summary>
    [Fact]
    public void Un_total_irpp_css_recouvre_l_irpp_seul()
    {
        Assert.NotEmpty(MonthlyDeclarationSourceOverlap.AllConflicts(new[]
        {
            Irpp("F1_1"),
            Irpp("F1_TOT", component: PayrollContributionComponent.WithholdingTotal)
        }));
    }

    [Fact]
    public void La_tfp_du_cycle_recouvre_la_tfp_par_activite_mais_pas_les_deux_activites_entre_elles()
    {
        var total = Rubric("F2_0", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBase, withheldPayroll: PayrollContributionComponent.Tfp,
            family: MonthlyDeclarationFamily.Tfp);
        var manufacturing = Rubric("F2_1", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBaseManufacturing,
            withheldPayroll: PayrollContributionComponent.TfpManufacturing, family: MonthlyDeclarationFamily.Tfp);
        var other = Rubric("F2_2", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBaseOtherActivities,
            withheldPayroll: PayrollContributionComponent.TfpOtherActivities, family: MonthlyDeclarationFamily.Tfp);

        Assert.Empty(MonthlyDeclarationSourceOverlap.AllConflicts(new[] { manufacturing, other }));
        Assert.Equal(2, MonthlyDeclarationSourceOverlap.AllConflicts(new[] { total, manufacturing, other }).Count);
    }

    /// <summary>
    /// Maille du mois : une rubrique close le 15 juin et une autre ouverte le 16 s'appliquent
    /// toutes deux à juin. Deux périodes disjointes au mois près, en revanche, ne se gênent pas.
    /// </summary>
    [Fact]
    public void Les_periodes_se_comparent_au_mois()
    {
        var closed = Irpp("F1_1", to: new DateTime(2026, 6, 15));
        var sameMonth = Irpp("F1_1B", from: new DateTime(2026, 6, 16));
        var nextMonth = Irpp("F1_1C", from: new DateTime(2026, 7, 1));

        Assert.NotEmpty(MonthlyDeclarationSourceOverlap.ConflictsOf(closed, new[] { sameMonth }));
        Assert.Empty(MonthlyDeclarationSourceOverlap.ConflictsOf(closed, new[] { nextMonth }));
    }

    [Fact]
    public void Une_rubrique_inactive_n_entre_en_conflit_avec_personne()
    {
        var inactive = Irpp("F1_1B");
        inactive.ToggleActive();

        Assert.Empty(MonthlyDeclarationSourceOverlap.ConflictsOf(Irpp("F1_1"), new[] { inactive }));
        Assert.Empty(MonthlyDeclarationSourceOverlap.ConflictsOf(inactive, new[] { Irpp("F1_1") }));
    }

    [Fact]
    public void Deux_compartiments_de_retenue_differents_ne_sont_pas_en_conflit()
    {
        var fees = Rubric("F1_6", RubricGrossKind.Document, RubricWithheldKind.Document,
            grossDocument: DeclarationDocumentSource.WithholdingFeesRealRegimeBase,
            withheldDocument: DeclarationDocumentSource.WithholdingFeesRealRegimeAmount);
        var feesAgain = Rubric("F1_6B", RubricGrossKind.Fixed, RubricWithheldKind.Document,
            withheldDocument: DeclarationDocumentSource.WithholdingFeesRealRegimeAmount);
        var dividends = Rubric("F1_12", RubricGrossKind.Fixed, RubricWithheldKind.Document,
            withheldDocument: DeclarationDocumentSource.WithholdingDividendsAmount);

        Assert.Empty(MonthlyDeclarationSourceOverlap.ConflictsOf(fees, new[] { dividends }));
        Assert.NotEmpty(MonthlyDeclarationSourceOverlap.ConflictsOf(fees, new[] { feesAgain }));
    }

    /// <summary>Le piège du catalogue v1 : TFP à 1 % et à 2 % sur la même assiette, soit 3 %.</summary>
    [Fact]
    public void Deux_taux_sur_la_meme_assiette_d_une_famille_sont_signales()
    {
        var at1 = Rubric("F2_1", RubricGrossKind.Payroll, RubricWithheldKind.GrossTimesRate, rate: 1m,
            payroll: PayrollContributionComponent.PayrollTaxBase, family: MonthlyDeclarationFamily.Tfp);
        var at2 = Rubric("F2_2", RubricGrossKind.Payroll, RubricWithheldKind.GrossTimesRate, rate: 2m,
            payroll: PayrollContributionComponent.PayrollTaxBase, family: MonthlyDeclarationFamily.Tfp);
        var foprolos = Rubric("F3_1", RubricGrossKind.Payroll, RubricWithheldKind.GrossTimesRate, rate: 1m,
            payroll: PayrollContributionComponent.PayrollTaxBase, family: MonthlyDeclarationFamily.Foprolos);

        var warning = Assert.Single(MonthlyDeclarationSourceOverlap.SharedBaseWarnings(new[] { at1, at2, foprolos }));

        Assert.Equal(MonthlyDeclarationFamily.Tfp, warning.Family);
        // Avertissement seulement : la configuration reste enregistrable.
        Assert.Empty(MonthlyDeclarationSourceOverlap.AllConflicts(new[] { at1, at2, foprolos }));
    }
}
