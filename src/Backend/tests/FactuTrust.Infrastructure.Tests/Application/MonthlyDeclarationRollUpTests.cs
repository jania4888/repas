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
/// Remontée des lignes vers les montants déclarés, et ce que le composeur signale au passage.
/// </summary>
/// <remarks>
/// La configuration est la seule source des montants : une famille que le dossier ne déclare pas
/// vaut 0, sans repli ni rattrapage. Ce qui est vérifié ici, c'est que ce 0 n'est jamais silencieux.
/// </remarks>
public sealed class MonthlyDeclarationRollUpTests
{
    private static readonly GetVatDeclarationQueryHandler.TaxAmounts Vat = new()
    {
        CollectedVat19 = 190m,
        DeductibleVatGoods = 57m,
        VatDue = 133m,
        CreditToCarry = 0m
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

    private static ComposedDeclarationLines Composed(params RubricEvaluation[] lines) => new()
    {
        IsActive = true,
        Lines = lines,
        IncludedFamilies = lines.Select(l => l.Family).ToHashSet(),
        ActiveFamilies = lines.Select(l => l.Family).ToHashSet()
    };

    // ── Remontée ──────────────────────────────────────────────────────────────

    /// <summary>Le montant d'une famille est la somme des retenues de ses lignes.</summary>
    [Fact]
    public void Une_famille_vaut_la_somme_des_retenues_de_ses_lignes()
    {
        var composed = Composed(
            Line(MonthlyDeclarationFamily.Withholding, "F1_1", 150m, 25.5m),
            Line(MonthlyDeclarationFamily.Withholding, "F1_3", 150m, 4.5m),
            Line(MonthlyDeclarationFamily.Tcl, "F9_3_1", 1190m, 2.38m));

        var result = GetVatDeclarationQueryHandler.RollUp(Vat, composed);

        Assert.Equal(30m, result.WithholdingTax);
        Assert.Equal(2.38m, result.Tcl);
    }

    /// <summary>
    /// Une famille que le dossier ne déclare pas vaut 0. C'est tout le sens de la case d'inclusion :
    /// un dossier non assujetti ne déclare pas une taxe parce qu'une rubrique existe.
    /// </summary>
    [Fact]
    public void Une_famille_non_declaree_vaut_zero()
    {
        var result = GetVatDeclarationQueryHandler.RollUp(
            Vat, Composed(Line(MonthlyDeclarationFamily.Tfp, "F2_1", 168m, 1.68m)));

        Assert.Equal(1.68m, result.Tfp);
        Assert.Equal(0m, result.Foprolos);
        Assert.Equal(0m, result.Fodec);
        Assert.Equal(0m, result.DroitTimbre);
        Assert.Equal(0m, result.WithholdingTax);
        Assert.Equal(0m, result.ConsumptionDuty);
        Assert.Equal(0m, result.HotelTax);
        Assert.Equal(0m, result.LicenceFee);
    }

    /// <summary>
    /// La T.V.A ne vient jamais des rubriques : ses montants sont ceux du module T.V.A, et son
    /// crédit se chaîne d'un mois sur l'autre. Les rubriques de cette famille sont informatives.
    /// </summary>
    [Fact]
    public void La_TVA_n_est_jamais_deplacee_par_les_rubriques()
    {
        var result = GetVatDeclarationQueryHandler.RollUp(
            Vat, Composed(Line(MonthlyDeclarationFamily.Vat, "F5_1_3", 1000m, 999m)));

        Assert.Equal(Vat.CollectedVat19, result.CollectedVat19);
        Assert.Equal(Vat.DeductibleVatGoods, result.DeductibleVatGoods);
        Assert.Equal(Vat.VatDue, result.VatDue);
        Assert.Equal(Vat.CreditToCarry, result.CreditToCarry);
    }

    // ── Ce que le composeur signale ───────────────────────────────────────────

    private static IOptions<AccountingSettings> Settings(bool v2 = true) =>
        Options.Create(new AccountingSettings { MonthlyDeclarationV2Enabled = v2 });

    private static MonthlyDeclarationRubric Fixed(
        MonthlyDeclarationFamily family, string code, decimal withheld) =>
        MonthlyDeclarationTestComposer.FixedRubric(family, code, "1", gross: 0m, withheld: withheld);

    private static Task<ComposedDeclarationLines> ComposeAsync(
        IReadOnlyList<MonthlyDeclarationRubric> rubrics,
        bool catalogApplied = true,
        params MonthlyDeclarationFamily[] included)
    {
        var config = new Mock<IMonthlyDeclarationConfigRepository>();
        config.Setup(c => c.IsCatalogAppliedAsync(It.IsAny<CancellationToken>())).ReturnsAsync(catalogApplied);
        config.Setup(c => c.GetFamilySettingsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(included
                .Select(f => MonthlyDeclarationFamilySetting.Create(f, isIncluded: true).Value)
                .ToList());
        config.Setup(c => c.GetRubricsAsync(false, It.IsAny<CancellationToken>())).ReturnsAsync(rubrics);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(j => j.SumMovementsByAccountsAsync(
                It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<IReadOnlyCollection<string>>(),
                It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, AccountPeriodMovement>(StringComparer.Ordinal));

        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(c => c.GetAllActiveAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<ChartOfAccount>());

        return new MonthlyDeclarationLineComposer(config.Object, journals.Object, chart.Object, Settings())
            .ComposeAsync(2026, 7, PayrollMonthlyContribution.None);
    }

    /// <summary>
    /// Une famille décochée dont les rubriques auraient produit un montant : le dossier a choisi de
    /// ne pas la déclarer, le montant vaut donc 0 — mais ce 0 doit se voir.
    /// </summary>
    [Fact]
    public async Task Une_famille_decochee_qui_aurait_produit_un_montant_est_signalee()
    {
        var composed = await ComposeAsync(
            new[]
            {
                Fixed(MonthlyDeclarationFamily.Tfp, "F2_1", 1.68m),
                Fixed(MonthlyDeclarationFamily.Tcl, "F9_3_1", 2.38m)
            },
            included: MonthlyDeclarationFamily.Tcl);

        Assert.Equal("F9_3_1", Assert.Single(composed.Lines).Code);
        var warning = Assert.Single(
            composed.Diagnostics.Where(d => d.Kind == RubricDiagnosticKind.ExcludedFamilyWithAmount));
        Assert.Equal(nameof(MonthlyDeclarationFamily.Tfp), warning.Detail);
    }

    /// <summary>Une famille décochée qui n'aurait rien produit n'encombre pas l'écran.</summary>
    [Fact]
    public async Task Une_famille_decochee_a_zero_n_est_pas_signalee()
    {
        var composed = await ComposeAsync(
            new[] { Fixed(MonthlyDeclarationFamily.Tfp, "F2_1", 0m) },
            included: MonthlyDeclarationFamily.Tcl);

        Assert.DoesNotContain(
            composed.Diagnostics, d => d.Kind == RubricDiagnosticKind.ExcludedFamilyWithAmount);
    }

    /// <summary>
    /// La T.V.A et les « autres informations » ne déplacent aucun montant déclaré : les décocher
    /// n'est pas un renoncement, et les cocher sans rubrique ne doit pas bloquer l'enregistrement de
    /// toute la déclaration.
    /// </summary>
    [Fact]
    public async Task Les_familles_hors_montants_ne_produisent_ni_avertissement_ni_blocage()
    {
        var composed = await ComposeAsync(
            new[] { Fixed(MonthlyDeclarationFamily.Vat, "F5_1_3", 999m) },
            included: MonthlyDeclarationFamily.OtherInformation);

        Assert.DoesNotContain(
            composed.Diagnostics, d => d.Kind == RubricDiagnosticKind.ExcludedFamilyWithAmount);
        Assert.DoesNotContain(
            composed.Diagnostics, d => d.Kind == RubricDiagnosticKind.MissingRubricForFamily);
        Assert.Empty(composed.FamiliesWithoutRubric);
    }

    /// <summary>
    /// Une famille cochée sans rubrique applicable produirait un zéro qu'aucun contrôle ne
    /// rattraperait : elle est signalée, et l'enregistrement la refuse.
    /// </summary>
    [Fact]
    public async Task Une_famille_cochee_sans_rubrique_est_signalee()
    {
        var composed = await ComposeAsync(
            Array.Empty<MonthlyDeclarationRubric>(), included: MonthlyDeclarationFamily.Tfp);

        Assert.Equal(MonthlyDeclarationFamily.Tfp, Assert.Single(composed.FamiliesWithoutRubric));
        Assert.Contains(
            composed.Diagnostics, d => d.Kind == RubricDiagnosticKind.MissingRubricForFamily);
    }

    /// <summary>
    /// Catalogue non posé : la configuration du dossier ne reproduit pas ce qu'il déclarait. Les
    /// montants restent affichés — l'écran doit montrer ce qu'il y a — mais le signalement bloquant
    /// interdit de les déposer.
    /// </summary>
    [Fact]
    public async Task Un_catalogue_non_pose_est_signale_comme_bloquant()
    {
        var composed = await ComposeAsync(
            new[] { Fixed(MonthlyDeclarationFamily.Tcl, "F9_3_1", 2.38m) },
            catalogApplied: false,
            included: MonthlyDeclarationFamily.Tcl);

        Assert.Equal(RubricDiagnosticKind.ConfigurationNotInitialized, composed.Diagnostics[0].Kind);
    }

    /// <summary>
    /// Déclaration mensuelle unique éteinte : un test booléen, et pas une requête. Les dépôts sont
    /// en mode strict — qu'aucun appel ne leur soit fait est la démonstration recherchée.
    /// </summary>
    [Fact]
    public async Task Declaration_unique_eteinte_le_composeur_n_emet_aucune_requete()
    {
        var config = new Mock<IMonthlyDeclarationConfigRepository>(MockBehavior.Strict);
        var journals = new Mock<IJournalEntryRepository>(MockBehavior.Strict);
        var chart = new Mock<IChartOfAccountRepository>(MockBehavior.Strict);
        var composer = new MonthlyDeclarationLineComposer(
            config.Object, journals.Object, chart.Object, Settings(v2: false));

        var composed = await composer.ComposeAsync(2026, 7, PayrollMonthlyContribution.None);

        Assert.False(composed.IsActive);
        Assert.Empty(composed.Lines);
        config.VerifyNoOtherCalls();
        journals.VerifyNoOtherCalls();
        chart.VerifyNoOtherCalls();
    }
}
