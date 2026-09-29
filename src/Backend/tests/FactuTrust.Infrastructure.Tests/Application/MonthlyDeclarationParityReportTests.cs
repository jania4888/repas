using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Rapport de parité : la preuve, avant le retrait du calcul historique, que le calcul paramétré
/// le reproduit. Ce qui est vérifié ici, c'est que le rapport ne se trompe jamais en faveur du
/// retrait — un arrondi n'est admis que prouvé — et qu'il ne touche à rien.
/// </summary>
public sealed class MonthlyDeclarationParityReportTests
{
    // ── Comparaison d'une famille ─────────────────────────────────────────────

    private static RubricEvaluation Line(decimal unrounded) => new()
    {
        Code = "FX",
        Label = "FX",
        Family = MonthlyDeclarationFamily.Tcl,
        ReportCode = "*",
        Gross = 0m,
        Withheld = Math.Round(unrounded, 3, MidpointRounding.AwayFromZero),
        WithheldUnrounded = unrounded,
        RatePercentApplied = 0.2m
    };

    [Fact]
    public void Deux_montants_egaux_sont_identiques()
    {
        Assert.Equal(ParityVerdict.Exact,
            MonthlyDeclarationParityComparer.CompareFamily(2.38m, 2.38m, [Line(2.38m)]));
    }

    /// <summary>
    /// 1 002,25 × 0,2 % = 2,0045 : l'historique arrondit vers le pair (2,004), le moteur s'écarte de
    /// zéro (2,005). C'est le seul écart que le rapport accepte, et seulement prouvé ainsi.
    /// </summary>
    [Fact]
    public void Un_demi_millime_arrondi_differemment_est_un_arrondi_prouve()
    {
        Assert.Equal(ParityVerdict.Rounding,
            MonthlyDeclarationParityComparer.CompareFamily(2.004m, 2.005m, [Line(2.0045m)]));
    }

    [Fact]
    public void Un_ecart_qu_aucun_arrondi_n_explique_reste_un_ecart()
    {
        // Même millime d'écart, mais sur une autre valeur brute : taux ou assiette différents.
        Assert.Equal(ParityVerdict.Gap,
            MonthlyDeclarationParityComparer.CompareFamily(2.003m, 2.005m, [Line(2.0045m)]));
        Assert.Equal(ParityVerdict.Gap,
            MonthlyDeclarationParityComparer.CompareFamily(2.38m, 0m, []));
    }

    /// <summary>
    /// Deux lignes à 1,0004 : arrondies ligne à ligne, 2,000 ; arrondies sur le total, 2,001. Ce
    /// n'est pas la règle du demi-millime mais une autre granularité d'arrondi : le rapport ne
    /// l'excuse pas.
    /// </summary>
    [Fact]
    public void Un_ecart_d_arrondi_sur_le_total_plutot_que_par_ligne_n_est_pas_excuse()
    {
        Assert.Equal(ParityVerdict.Gap,
            MonthlyDeclarationParityComparer.CompareFamily(2.001m, 2.000m, [Line(1.0004m), Line(1.0004m)]));
    }

    // ── Comparaison des cases du formulaire ───────────────────────────────────

    private static IReadOnlyDictionary<string, string?> Boxes(params (string Key, string? Value)[] boxes) =>
        boxes.ToDictionary(b => b.Key, b => b.Value, StringComparer.Ordinal);

    [Fact]
    public void Les_cases_identiques_ne_sont_pas_listees()
    {
        var boxes = MonthlyDeclarationParityComparer.CompareBoxes(
            Boxes(("Header.Year", "2026"), ("Tcl.Amount", "2,380")),
            Boxes(("Header.Year", "2026"), ("Tcl.Amount", "2,380")),
            []);

        Assert.Empty(boxes);
    }

    /// <summary>
    /// Une case qui diffère d'un écart d'arrondi prouvé — ou de la somme de plusieurs, comme le
    /// total à payer — hérite du verdict « arrondi ». Toute autre différence est un écart.
    /// </summary>
    [Fact]
    public void Une_case_ne_differe_par_arrondi_que_d_une_somme_d_ecarts_prouves()
    {
        var boxes = MonthlyDeclarationParityComparer.CompareBoxes(
            Boxes(("Tcl.Amount", "2,004"), ("Recap.Total", "1 250,004"), ("Fodec.Amount", "10,000"),
                ("Header.Name", "Ma Société"), ("Withholding.Line1.Amount", null)),
            Boxes(("Tcl.Amount", "2,005"), ("Recap.Total", "1 250,006"), ("Fodec.Amount", "10,002"),
                ("Header.Name", "Autre"), ("Withholding.Line1.Amount", "0,001")),
            [0.001m, 0.001m]);

        Assert.Equal((int)ParityVerdict.Rounding, boxes.Single(b => b.Key == "Tcl.Amount").Verdict);
        Assert.Equal((int)ParityVerdict.Rounding, boxes.Single(b => b.Key == "Recap.Total").Verdict);
        Assert.Equal((int)ParityVerdict.Rounding, boxes.Single(b => b.Key == "Withholding.Line1.Amount").Verdict);
        Assert.Equal((int)ParityVerdict.Rounding, boxes.Single(b => b.Key == "Fodec.Amount").Verdict);
        Assert.Equal((int)ParityVerdict.Gap, boxes.Single(b => b.Key == "Header.Name").Verdict);
    }

    [Fact]
    public void Sans_ecart_prouve_toute_difference_de_case_est_un_ecart()
    {
        var box = Assert.Single(MonthlyDeclarationParityComparer.CompareBoxes(
            Boxes(("Tcl.Amount", "2,004")), Boxes(("Tcl.Amount", "2,005")), []));

        Assert.Equal((int)ParityVerdict.Gap, box.Verdict);
    }

    // ── Rapport de bout en bout ──────────────────────────────────────────────

    private static MonthlyDeclarationRubric Rubric(
        MonthlyDeclarationFamily family,
        string code,
        string reportCode,
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        decimal rate = 0m,
        decimal? fixedGross = null,
        PayrollContributionComponent? payroll = null,
        PayrollContributionComponent? withheldPayroll = null,
        DeclarationDocumentSource? grossDocument = null,
        DeclarationDocumentSource? withheldDocument = null)
    {
        var created = MonthlyDeclarationRubric.Create(
            family, code, code, reportCode, grossKind, withheldKind,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit, rate, fixedGross, null,
            payroll, withheldPayroll, null, null, accounts: null, displayOrder: 0,
            grossDocument, withheldDocument);
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Description : null);
        return created.Value;
    }

    /// <summary>
    /// Configuration qui reproduit la période « pleine » sur toutes les familles sauf la retenue à
    /// la source, où la RS des loyers (135) manque volontairement.
    /// </summary>
    private static IReadOnlyList<MonthlyDeclarationRubric> RubricsWithoutRent() =>
    [
        Rubric(MonthlyDeclarationFamily.OtherTurnoverTaxes, "F6_1", "1", RubricGrossKind.Document, RubricWithheldKind.Document,
            grossDocument: DeclarationDocumentSource.FodecFormBase, withheldDocument: DeclarationDocumentSource.FodecAmount),
        Rubric(MonthlyDeclarationFamily.StampDuty, "F7_1", "*", RubricGrossKind.Fixed, RubricWithheldKind.Document,
            fixedGross: 0m, withheldDocument: DeclarationDocumentSource.FiscalStampAmount),
        Rubric(MonthlyDeclarationFamily.Tcl, "F9_3_1", "*", RubricGrossKind.Document, RubricWithheldKind.GrossTimesRate,
            rate: 0.2m, grossDocument: DeclarationDocumentSource.SalesGrossBase),
        Rubric(MonthlyDeclarationFamily.Tfp, "F2_1", "1", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBaseManufacturing,
            withheldPayroll: PayrollContributionComponent.TfpManufacturing),
        Rubric(MonthlyDeclarationFamily.Tfp, "F2_2", "2", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBaseOtherActivities,
            withheldPayroll: PayrollContributionComponent.TfpOtherActivities),
        Rubric(MonthlyDeclarationFamily.Foprolos, "F3_1", "1", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.PayrollTaxBase, withheldPayroll: PayrollContributionComponent.Foprolos),
        Rubric(MonthlyDeclarationFamily.Withholding, "F1_1", "1", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.SalariesNetTaxableBase, withheldPayroll: PayrollContributionComponent.WithholdingIrpp),
        Rubric(MonthlyDeclarationFamily.Withholding, "F1_3", "3", RubricGrossKind.Payroll, RubricWithheldKind.Payroll,
            payroll: PayrollContributionComponent.SalariesNetTaxableBase, withheldPayroll: PayrollContributionComponent.WithholdingCss),
        Rubric(MonthlyDeclarationFamily.Withholding, "F1_RS", "*", RubricGrossKind.Document, RubricWithheldKind.Document,
            grossDocument: DeclarationDocumentSource.WithholdingRemainderBase,
            withheldDocument: DeclarationDocumentSource.WithholdingRemainderAmount)
    ];

    private static readonly MonthlyDeclarationFamily[] SixFamilies =
    [
        MonthlyDeclarationFamily.OtherTurnoverTaxes, MonthlyDeclarationFamily.StampDuty,
        MonthlyDeclarationFamily.Tcl, MonthlyDeclarationFamily.Tfp,
        MonthlyDeclarationFamily.Foprolos, MonthlyDeclarationFamily.Withholding
    ];

    private static Mock<ICurrentUser> FirmUser(bool delegated = true)
    {
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.IsAccountingFirmDelegatedContext).Returns(delegated);
        user.SetupGet(u => u.Email).Returns("comptable@cabinet.tn");
        return user;
    }

    private sealed record Harness(
        GetMonthlyDeclarationParityReportQueryHandler Handler,
        Mock<IMonthlyDeclarationConfigRepository> Config,
        Mock<IVatDeclarationRepository> Declarations);

    private static Harness Build(
        MonthlyDeclarationFamily[] included,
        IOptions<AccountingSettings>? settings = null,
        Mock<ICurrentUser>? user = null)
    {
        settings ??= GetVatDeclarationV2Tests.RichPeriodSettings();
        var config = new Mock<IMonthlyDeclarationConfigRepository>();
        var declarations = new Mock<IVatDeclarationRepository>();

        var declarationHandler = GetVatDeclarationV2Tests.CreateRichPeriodHandler(
            settings,
            composer: s => MonthlyDeclarationTestComposer.ConfiguredOn(config, s, RubricsWithoutRent(), included),
            vatRepo: declarations);

        return new Harness(
            new GetMonthlyDeclarationParityReportQueryHandler(
                declarationHandler, (user ?? FirmUser()).Object, settings, TimeProvider.System),
            config,
            declarations);
    }

    private static MonthlyDeclarationParityFamilyDto FamilyOf(
        MonthlyDeclarationParityMonthDto month, MonthlyDeclarationFamily family) =>
        month.Families.Single(f => f.Family == (int)family);

    [Fact]
    public async Task Le_rapport_classe_chaque_famille_et_signale_ce_que_la_configuration_ne_reproduit_pas()
    {
        var harness = Build(SixFamilies);

        var result = await harness.Handler.Handle(
            new GetMonthlyDeclarationParityReportQuery(2026, 7, 7), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var report = result.Value;
        var month = Assert.Single(report.Months);

        foreach (var exact in new[]
                 {
                     MonthlyDeclarationFamily.OtherTurnoverTaxes, MonthlyDeclarationFamily.StampDuty,
                     MonthlyDeclarationFamily.Tcl, MonthlyDeclarationFamily.Tfp, MonthlyDeclarationFamily.Foprolos
                 })
        {
            Assert.Equal((int)ParityVerdict.Exact, FamilyOf(month, exact).Verdict);
        }

        // IRPP 25,5 + CSS 4,5 + RS factures 40 = 70, là où l'historique compte aussi les loyers : 205.
        var withholding = FamilyOf(month, MonthlyDeclarationFamily.Withholding);
        Assert.Equal(205m, withholding.Legacy);
        Assert.Equal(70m, withholding.Configured);
        Assert.Equal((int)ParityVerdict.Gap, withholding.Verdict);

        Assert.Equal((int)ParityVerdict.Gap, month.Verdict);
        Assert.Contains(month.BoxDifferences, b => b.Key.StartsWith("Withholding.", StringComparison.Ordinal)
                                                  && b.Verdict == (int)ParityVerdict.Gap);
        Assert.False(report.ReadyForRetirement);
        Assert.Equal(1, report.MonthsWithGap);
        Assert.Equal("comptable@cabinet.tn", report.GeneratedBy);
        Assert.Equal("Ma Société SARL", report.CompanyName);
    }

    /// <summary>
    /// Après le retrait, une famille non cochée vaudra 0. Le rapport le montre dès maintenant,
    /// plutôt que de laisser découvrir le zéro sur la déclaration.
    /// </summary>
    [Fact]
    public async Task Une_famille_non_cochee_vaut_zero_et_est_un_ecart_si_l_historique_la_porte()
    {
        var harness = Build(SixFamilies.Where(f => f != MonthlyDeclarationFamily.Tcl).ToArray());

        var result = await harness.Handler.Handle(
            new GetMonthlyDeclarationParityReportQuery(2026, 7, 7), CancellationToken.None);

        var tcl = FamilyOf(Assert.Single(result.Value.Months), MonthlyDeclarationFamily.Tcl);
        Assert.False(tcl.IsIncluded);
        Assert.Equal(2.38m, tcl.Legacy);
        Assert.Equal(0m, tcl.Configured);
        Assert.Equal((int)ParityVerdict.Gap, tcl.Verdict);

        // Familles que ni l'un ni l'autre ne portent : identiques, même non cochées.
        var hotel = FamilyOf(result.Value.Months[0], MonthlyDeclarationFamily.HotelTax);
        Assert.False(hotel.IsIncluded);
        Assert.Equal((int)ParityVerdict.Exact, hotel.Verdict);
    }

    /// <summary>
    /// Lecture pure : ni le régime du dossier ni sa rampe ne sont lus ou écrits, et aucune
    /// déclaration n'est enregistrée. Relancer le rapport ne change rien.
    /// </summary>
    [Fact]
    public async Task Le_rapport_ne_lit_ni_n_ecrit_le_regime_et_n_enregistre_rien()
    {
        var harness = Build(SixFamilies);

        await harness.Handler.Handle(new GetMonthlyDeclarationParityReportQuery(2026, 7, 7), CancellationToken.None);

        harness.Config.Verify(c => c.GetSettingsAsync(It.IsAny<CancellationToken>()), Times.Never);
        harness.Config.Verify(c => c.SaveSettingsAsync(It.IsAny<MonthlyDeclarationSettings>(), It.IsAny<CancellationToken>()), Times.Never);
        harness.Declarations.Verify(r => r.AddAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
        harness.Declarations.Verify(r => r.UpdateAsync(It.IsAny<VatDeclaration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>
    /// <b>Le test qui compte.</b> Le catalogue v2 tel que la montée le produit réellement — amorçage v1
    /// par l'initialiseur, puis montée — reproduit le calcul historique de la période « pleine » :
    /// montants de chaque famille et cases du formulaire officiel, sans écart non expliqué.
    /// </summary>
    [Fact]
    public async Task Le_catalogue_v2_monte_reproduit_le_calcul_historique_de_la_periode_pleine()
    {
        var name = $"DmV2Parity_{Guid.NewGuid()}";
        await using (var context = NewTenantContext(name))
        {
            await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);
            var upgrade = await MonthlyDeclarationCatalogUpgrade.EnsureAppliedAsync(
                context, new MonthlyDeclarationCatalogOptions(Enabled: true, TclRatePercent: 0.2m));
            Assert.NotNull(upgrade);
            Assert.Empty(upgrade!.SkippedFamilies);
        }

        List<MonthlyDeclarationRubric> rubrics;
        await using (var context = NewTenantContext(name))
            rubrics = await context.MonthlyDeclarationRubrics.Include(r => r.Accounts).Where(r => r.IsActive).ToListAsync();

        // Loyers de la période « pleine » : 1 350 au débit du 613.
        var movements = new Dictionary<string, AccountPeriodMovement>(StringComparer.Ordinal)
        {
            ["613000"] = new(Debit: 1_350m, Credit: 0m)
        };
        var settings = GetVatDeclarationV2Tests.RichPeriodSettings();
        var declarations = GetVatDeclarationV2Tests.CreateRichPeriodHandler(
            settings,
            composer: s => MonthlyDeclarationTestComposer.ConfiguredWithMovements(
                new Mock<IMonthlyDeclarationConfigRepository>(), s, rubrics, movements,
                Enum.GetValues<MonthlyDeclarationFamily>()));
        var handler = new GetMonthlyDeclarationParityReportQueryHandler(
            declarations, FirmUser().Object, settings, TimeProvider.System);

        var result = await handler.Handle(new GetMonthlyDeclarationParityReportQuery(2026, 7, 7), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var month = Assert.Single(result.Value.Months);
        var familyGaps = month.Families
            .Where(f => f.Verdict == (int)ParityVerdict.Gap)
            .Select(f => $"{(MonthlyDeclarationFamily)f.Family} : {f.Legacy} ≠ {f.Configured}");
        var boxGaps = month.BoxDifferences
            .Where(b => b.Verdict == (int)ParityVerdict.Gap)
            .Select(b => $"{b.Key} : {b.Legacy ?? "∅"} ≠ {b.Configured ?? "∅"}");
        Assert.True(result.Value.ReadyForRetirement,
            "Écarts : " + string.Join(" ; ", familyGaps.Concat(boxGaps)));
        Assert.Equal(205m, month.Families.Single(f => f.Family == (int)MonthlyDeclarationFamily.Withholding).Configured);
    }

    private static TenantDbContext NewTenantContext(string name) =>
        new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);

    // ── Gardes ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Le_rapport_est_refuse_hors_du_cabinet_delegue()
    {
        var harness = Build(SixFamilies, user: FirmUser(delegated: false));

        var result = await harness.Handler.Handle(
            new GetMonthlyDeclarationParityReportQuery(2026, 7, 7), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Forbidden", result.Error.Code);
        harness.Config.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(0, 3)]
    [InlineData(1, 13)]
    [InlineData(7, 6)]
    public async Task Une_plage_invalide_est_refusee(int from, int to)
    {
        var result = await Build(SixFamilies).Handler.Handle(
            new GetMonthlyDeclarationParityReportQuery(2026, from, to), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Le_rapport_est_refuse_quand_le_calcul_parametre_est_eteint()
    {
        var off = GetVatDeclarationV2Tests.RichPeriodSettings(configurableLinesEnabled: false);

        var result = await Build(SixFamilies, settings: off).Handler.Handle(
            new GetMonthlyDeclarationParityReportQuery(2026, 7, 7), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Le_rapport_s_arrete_sur_annulation()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Build(SixFamilies).Handler.Handle(
            new GetMonthlyDeclarationParityReportQuery(2026, 1, 12), cancelled.Token));
    }
}
