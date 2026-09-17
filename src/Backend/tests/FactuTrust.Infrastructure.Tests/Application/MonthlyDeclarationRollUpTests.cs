using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Articulation entre le calcul historique et le moteur paramétré : ce qui est vérifié ici n'est
/// pas une somme, c'est la frontière. Tant qu'un dossier n'a pas basculé, la déclaration doit
/// sortir <b>identique à l'octet</b> — et le coût de la fonctionnalité doit être nul.
/// </summary>
public sealed class MonthlyDeclarationRollUpTests
{
    private static GetVatDeclarationQueryHandler.TaxAmounts Legacy() => new()
    {
        CollectedVat19 = 1_900m,
        CollectedVat13 = 130m,
        CollectedVat7 = 70m,
        DeductibleVatGoods = 500m,
        DeductibleVatAssets = 120m,
        PreviousCredit = 0m,
        VatDue = 1_480m,
        CreditToCarry = 0m,
        Fodec = 10m,
        DroitTimbre = 12m,
        Tcl = 6.511m,
        Tfp = 120.500m,
        Foprolos = 60.250m,
        WithholdingTax = 1_050.750m,
        WithholdingFromInvoices = 40m,
        WithholdingFromSalaries = 1_000.750m,
        WithholdingFromRentJournal = 10m,
        Acomptes = 0m
    };

    private static RubricEvaluation Line(
        MonthlyDeclarationFamily family, string code, decimal gross, decimal withheld) => new()
        {
            Code = code,
            Label = code,
            Family = family,
            ReportCode = "1",
            Gross = gross,
            Withheld = withheld,
            RatePercentApplied = 0m
        };

    private static ComposedDeclarationLines Composed(
        MonthlyDeclarationMode mode, params RubricEvaluation[] lines) => new()
        {
            Mode = mode,
            Lines = lines,
            ActiveFamilies = lines.Select(l => l.Family).ToHashSet()
        };

    // ── Non-régression ────────────────────────────────────────────────────────

    /// <summary>
    /// Aucune famille active : la remontée rend le jeu historique <b>tel quel</b>. C'est la
    /// propriété qui autorise à livrer le chantier sans toucher au calcul existant.
    /// </summary>
    [Fact]
    public void Sans_famille_active_la_remontee_rend_le_calcul_historique_inchange()
    {
        var legacy = Legacy();

        var rolled = GetVatDeclarationQueryHandler.ApplyRollUp(
            legacy, Composed(MonthlyDeclarationMode.Configured));

        Assert.Equal(legacy, rolled);
    }

    /// <summary>
    /// Les trois familles ajoutées par le chantier valent zéro sur un dossier non paramétré : le
    /// total à payer est donc, en valeur, celui d'avant.
    /// </summary>
    [Fact]
    public void Les_trois_familles_ajoutees_valent_zero_sur_un_dossier_non_parametre()
    {
        var legacy = Legacy();

        Assert.Equal(0m, legacy.ConsumptionDuty);
        Assert.Equal(0m, legacy.HotelTax);
        Assert.Equal(0m, legacy.LicenceFee);
        Assert.Equal(0m, legacy.WithholdingFromRubrics);
    }

    // ── Remontée par famille ──────────────────────────────────────────────────

    /// <summary>
    /// Le remplacement est cloisonné par famille : une famille paramétrée prend le total de ses
    /// rubriques, les autres gardent leur valeur historique. Un paramétrage partiel ne fabrique
    /// donc jamais un montant hybride dont plus personne ne saurait dire d'où il vient.
    /// </summary>
    [Fact]
    public void Seule_la_famille_parametree_voit_son_scalaire_remplace()
    {
        var legacy = Legacy();

        var rolled = GetVatDeclarationQueryHandler.ApplyRollUp(legacy, Composed(
            MonthlyDeclarationMode.Configured,
            Line(MonthlyDeclarationFamily.Tcl, "F9_3_1", 3_255m, 6.510m)));

        Assert.Equal(6.510m, rolled.Tcl);
        Assert.Equal(legacy.Fodec, rolled.Fodec);
        Assert.Equal(legacy.Tfp, rolled.Tfp);
        Assert.Equal(legacy.WithholdingTax, rolled.WithholdingTax);
    }

    [Fact]
    public void Une_famille_parametree_somme_toutes_ses_rubriques()
    {
        var rolled = GetVatDeclarationQueryHandler.ApplyRollUp(Legacy(), Composed(
            MonthlyDeclarationMode.Configured,
            Line(MonthlyDeclarationFamily.Withholding, "F1_1", 11_500m, 990.750m),
            Line(MonthlyDeclarationFamily.Withholding, "F1_3", 11_500m, 60.000m),
            Line(MonthlyDeclarationFamily.Withholding, "F1_4_1", 2_500m, 250.000m)));

        Assert.Equal(1_300.750m, rolled.WithholdingTax);
    }

    /// <summary>
    /// Dès que les rubriques produisent la retenue, la ventilation historique (factures / salaires /
    /// loyers) est remise à zéro : la laisser renseignée afficherait une décomposition qui ne
    /// totalise pas le montant déclaré.
    /// </summary>
    [Fact]
    public void La_ventilation_historique_de_la_retenue_est_remplacee_et_non_cumulee()
    {
        var rolled = GetVatDeclarationQueryHandler.ApplyRollUp(Legacy(), Composed(
            MonthlyDeclarationMode.Configured,
            Line(MonthlyDeclarationFamily.Withholding, "F1_1", 11_500m, 800m)));

        Assert.Equal(800m, rolled.WithholdingTax);
        Assert.Equal(0m, rolled.WithholdingFromInvoices);
        Assert.Equal(0m, rolled.WithholdingFromSalaries);
        Assert.Equal(0m, rolled.WithholdingFromRentJournal);
        Assert.Equal(800m, rolled.WithholdingFromRubrics);
    }

    [Theory]
    [InlineData(MonthlyDeclarationFamily.ConsumptionDuty)]
    [InlineData(MonthlyDeclarationFamily.HotelTax)]
    [InlineData(MonthlyDeclarationFamily.LicenceFee)]
    public void Les_familles_sans_equivalent_historique_sont_alimentees_par_les_rubriques(
        MonthlyDeclarationFamily family)
    {
        var rolled = GetVatDeclarationQueryHandler.ApplyRollUp(Legacy(), Composed(
            MonthlyDeclarationMode.Configured, Line(family, "FX", 1_000m, 42.500m)));

        var value = family switch
        {
            MonthlyDeclarationFamily.ConsumptionDuty => rolled.ConsumptionDuty,
            MonthlyDeclarationFamily.HotelTax => rolled.HotelTax,
            _ => rolled.LicenceFee
        };

        Assert.Equal(42.500m, value);
    }

    /// <summary>
    /// La T.V.A est délibérément hors du périmètre : ses montants viennent des documents de facture,
    /// l'enregistrement les redérive systématiquement, et le solde est chaîné d'un mois sur l'autre.
    /// Une rubrique de famille TVA reste donc visible à l'écran sans déplacer un seul scalaire.
    /// </summary>
    [Fact]
    public void Une_rubrique_de_famille_TVA_ne_deplace_aucun_scalaire_de_TVA()
    {
        var legacy = Legacy();

        var rolled = GetVatDeclarationQueryHandler.ApplyRollUp(legacy, Composed(
            MonthlyDeclarationMode.Configured,
            Line(MonthlyDeclarationFamily.Vat, "F5_1_3", 12_500m, 2_375m)));

        Assert.Equal(legacy.CollectedVat19, rolled.CollectedVat19);
        Assert.Equal(legacy.CollectedVat13, rolled.CollectedVat13);
        Assert.Equal(legacy.CollectedVat7, rolled.CollectedVat7);
        Assert.Equal(legacy.DeductibleVatGoods, rolled.DeductibleVatGoods);
        Assert.Equal(legacy.DeductibleVatAssets, rolled.DeductibleVatAssets);
        Assert.Equal(legacy.VatDue, rolled.VatDue);
        Assert.Equal(legacy.CreditToCarry, rolled.CreditToCarry);
    }

    // ── Écart de parité ───────────────────────────────────────────────────────

    [Fact]
    public void L_ecart_de_parite_mesure_la_difference_maximale_en_millimes()
    {
        var gap = GetVatDeclarationQueryHandler.MaxGapMillimes(Legacy(), Composed(
            MonthlyDeclarationMode.Parity,
            Line(MonthlyDeclarationFamily.Tcl, "F9_3_1", 3_255m, 6.514m)));

        // 6,514 contre 6,511 → 3 millimes.
        Assert.Equal(3, gap);
    }

    [Fact]
    public void Un_calcul_parametre_conforme_donne_un_ecart_nul()
    {
        var gap = GetVatDeclarationQueryHandler.MaxGapMillimes(Legacy(), Composed(
            MonthlyDeclarationMode.Parity,
            Line(MonthlyDeclarationFamily.Tcl, "F9_3_1", 3_255m, 6.511m)));

        Assert.Equal(0, gap);
    }

    /// <summary>
    /// Une fois le dossier basculé, le montant paramétré <i>est</i> le montant : il n'y a plus rien
    /// à comparer, et publier un écart laisserait croire à une divergence inexistante.
    /// </summary>
    [Fact]
    public void L_ecart_n_est_mesure_qu_en_controle_de_parite()
    {
        var gap = GetVatDeclarationQueryHandler.MaxGapMillimes(Legacy(), Composed(
            MonthlyDeclarationMode.Configured,
            Line(MonthlyDeclarationFamily.Tcl, "F9_3_1", 3_255m, 999m)));

        Assert.Equal(0, gap);
    }

    // ── Inertie du composeur ──────────────────────────────────────────────────

    /// <summary>
    /// Drapeau éteint, le composeur ne doit pas émettre une seule requête : c'est ce qui garantit
    /// qu'un dossier non concerné ne paie rien pour l'existence de la fonctionnalité.
    /// </summary>
    [Fact]
    public async Task Drapeau_eteint_le_composeur_n_interroge_aucun_depot()
    {
        var config = new Mock<IMonthlyDeclarationConfigRepository>(MockBehavior.Strict);
        var journals = new Mock<IJournalEntryRepository>(MockBehavior.Strict);
        var chart = new Mock<IChartOfAccountRepository>(MockBehavior.Strict);
        var settings = Options.Create(new AccountingSettings { MonthlyDeclarationV2Enabled = true });

        var composer = new MonthlyDeclarationLineComposer(
            config.Object, journals.Object, chart.Object, settings);

        var composed = await composer.ComposeAsync(2026, 9, PayrollMonthlyContribution.None);

        Assert.Equal(MonthlyDeclarationMode.Legacy, composed.Mode);
        Assert.Empty(composed.Lines);
        config.VerifyNoOtherCalls();
        journals.VerifyNoOtherCalls();
        chart.VerifyNoOtherCalls();
    }

    /// <summary>
    /// Drapeau allumé mais dossier en calcul historique : même inertie. Allumer le drapeau ne change
    /// donc rien tant qu'aucun dossier n'a explicitement quitté ce régime.
    /// </summary>
    [Fact]
    public async Task Dossier_en_calcul_historique_le_composeur_s_arrete_apres_la_lecture_des_reglages()
    {
        var config = new Mock<IMonthlyDeclarationConfigRepository>(MockBehavior.Strict);
        config.Setup(c => c.GetSettingsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(MonthlyDeclarationSettings.CreateDefault());

        var journals = new Mock<IJournalEntryRepository>(MockBehavior.Strict);
        var chart = new Mock<IChartOfAccountRepository>(MockBehavior.Strict);
        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = true,
            MonthlyDeclarationConfigurableLinesEnabled = true
        });

        var composer = new MonthlyDeclarationLineComposer(
            config.Object, journals.Object, chart.Object, settings);

        var composed = await composer.ComposeAsync(2026, 9, PayrollMonthlyContribution.None);

        Assert.Equal(MonthlyDeclarationMode.Legacy, composed.Mode);
        journals.VerifyNoOtherCalls();
        chart.VerifyNoOtherCalls();
    }
}
