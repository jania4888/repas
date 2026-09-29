using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// Montée des dossiers vers le catalogue de rubriques v2. Ce qui est vérifié ici, c'est qu'elle ne
/// touche jamais à un choix du comptable : une famille retouchée est laissée entière, une rubrique
/// supprimée n'est pas recréée, un dossier déjà en calcul paramétré garde ses inclusions.
/// </summary>
public sealed class MonthlyDeclarationCatalogUpgradeTests
{
    private static readonly MonthlyDeclarationCatalogOptions On = new(Enabled: true, TclRatePercent: 0.2m);

    private static TenantDbContext NewContext(string name) =>
        new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);

    /// <summary>Dossier amorcé en v1 par l'initialiseur réel, comme en production.</summary>
    private static async Task<string> SeededV1Async()
    {
        var name = $"DmUpgrade_{Guid.NewGuid()}";
        await using var context = NewContext(name);
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);
        return name;
    }

    private static async Task<MonthlyDeclarationCatalogUpgradeReport?> UpgradeAsync(
        string name, MonthlyDeclarationCatalogOptions? options = null)
    {
        await using var context = NewContext(name);
        return await MonthlyDeclarationCatalogUpgrade.EnsureAppliedAsync(context, options ?? On);
    }

    private static async Task<MonthlyDeclarationRubric> RubricAsync(string name, string code)
    {
        await using var context = NewContext(name);
        return await context.MonthlyDeclarationRubrics.Include(r => r.Accounts).SingleAsync(r => r.Code == code);
    }

    [Fact]
    public async Task Un_dossier_intact_est_monte_et_reproduit_le_calcul_historique()
    {
        var name = await SeededV1Async();

        var report = await UpgradeAsync(name);

        Assert.NotNull(report);
        Assert.Empty(report!.SkippedFamilies);
        Assert.Equal(
            new[]
            {
                MonthlyDeclarationFamily.Withholding, MonthlyDeclarationFamily.Tfp, MonthlyDeclarationFamily.Foprolos,
                MonthlyDeclarationFamily.OtherTurnoverTaxes, MonthlyDeclarationFamily.StampDuty, MonthlyDeclarationFamily.Tcl
            }.OrderBy(f => f),
            report.UpgradedFamilies.OrderBy(f => f));

        var fodec = await RubricAsync(name, "F6_1");
        Assert.Equal(RubricWithheldKind.Document, fodec.WithheldKind);
        Assert.Equal(DeclarationDocumentSource.FodecAmount, fodec.WithheldDocumentSource);
        Assert.Empty(fodec.Accounts);

        var tfp = await RubricAsync(name, "F2_1");
        Assert.Equal(PayrollContributionComponent.TfpManufacturing, tfp.WithheldPayrollComponent);

        var tcl = await RubricAsync(name, "F9_3_1");
        Assert.Equal(DeclarationDocumentSource.SalesGrossBase, tcl.GrossDocumentSource);
        Assert.Equal(0.2m, tcl.RatePercent);

        Assert.Equal(DeclarationDocumentSource.WithholdingRemainderAmount,
            (await RubricAsync(name, "F1_RS_AUTRES")).WithheldDocumentSource);
        Assert.Equal(DeclarationDocumentSource.WithholdingSalariesAmount,
            (await RubricAsync(name, "F1_1_RS")).WithheldDocumentSource);

        // Rubrique déjà conforme en v1 : laissée telle quelle.
        var rent = await RubricAsync(name, "F1_4_1");
        Assert.Equal(RubricWithheldKind.GrossTimesRate, rent.WithheldKind);

        await using var context = NewContext(name);
        Assert.All(await context.MonthlyDeclarationFamilySettings.ToListAsync(), f => Assert.True(f.IsIncluded));
        Assert.Contains(MonthlyDeclarationCatalogs.V2Version,
            await context.MonthlyDeclarationRubricSeedLogs.Select(l => l.CatalogVersion).ToListAsync());

        var audit = await context.AuditLogs.SingleAsync(a => a.Action == AuditActions.Accounting.MonthlyDeclarationCatalogUpgraded);
        Assert.Equal("system", audit.UserEmail);
        Assert.Contains("Withholding", audit.NewValues);
    }

    /// <summary>Le catalogue monté ne lit aucune source deux fois : c'est la garantie de la v2.</summary>
    [Fact]
    public async Task Le_catalogue_monte_ne_lit_aucune_source_deux_fois()
    {
        var name = await SeededV1Async();
        await UpgradeAsync(name);

        await using var context = NewContext(name);
        var rubrics = await context.MonthlyDeclarationRubrics.Include(r => r.Accounts).ToListAsync();

        Assert.Empty(MonthlyDeclarationSourceOverlap.AllConflicts(rubrics));
        Assert.Empty(MonthlyDeclarationSourceOverlap.SharedBaseWarnings(rubrics)
            .Where(w => w.Family == MonthlyDeclarationFamily.Tfp));
    }

    [Fact]
    public async Task La_montee_n_a_lieu_qu_une_fois()
    {
        var name = await SeededV1Async();
        await UpgradeAsync(name);

        Assert.Null(await UpgradeAsync(name));

        await using var context = NewContext(name);
        Assert.Equal(1, await context.AuditLogs.CountAsync(a => a.Action == AuditActions.Accounting.MonthlyDeclarationCatalogUpgraded));
    }

    /// <summary>
    /// Tout ou rien par famille : monter la TFP à 1 % sans celle à 2 % compterait la TFP deux fois.
    /// Une rubrique retouchée laisse donc sa famille entière en v1.
    /// </summary>
    [Fact]
    public async Task Une_famille_retouchee_est_laissee_entiere()
    {
        var name = await SeededV1Async();
        await using (var context = NewContext(name))
        {
            var f21 = await context.MonthlyDeclarationRubrics.Include(r => r.Accounts).SingleAsync(r => r.Code == "F2_1");
            Assert.True(f21.Update(
                f21.Label, f21.ReportCode, f21.GrossKind, f21.WithheldKind, f21.GrossSide, f21.WithheldSide,
                1.5m, f21.FixedGrossAmount, f21.FixedWithheldAmount, f21.PayrollComponent, f21.WithheldPayrollComponent,
                null, null, [], f21.DisplayOrder).IsSuccess);
            await context.SaveChangesAsync();
        }

        var report = await UpgradeAsync(name);

        var skipped = Assert.Single(report!.SkippedFamilies);
        Assert.Equal(MonthlyDeclarationFamily.Tfp, skipped.Family);
        Assert.Contains("F2_1", skipped.Reason);
        Assert.Equal(1.5m, (await RubricAsync(name, "F2_1")).RatePercent);
        Assert.Equal(RubricWithheldKind.GrossTimesRate, (await RubricAsync(name, "F2_2")).WithheldKind);
        Assert.Contains(MonthlyDeclarationFamily.Withholding, report.UpgradedFamilies);
    }

    [Fact]
    public async Task Une_rubrique_supprimee_n_est_pas_recreee_et_laisse_sa_famille()
    {
        var name = await SeededV1Async();
        await using (var context = NewContext(name))
        {
            context.MonthlyDeclarationRubrics.Remove(await context.MonthlyDeclarationRubrics.SingleAsync(r => r.Code == "F1_5"));
            await context.SaveChangesAsync();
        }

        var report = await UpgradeAsync(name);

        Assert.Contains(report!.SkippedFamilies, s => s.Family == MonthlyDeclarationFamily.Withholding && s.Reason.Contains("F1_5"));
        await using var check = NewContext(name);
        Assert.False(await check.MonthlyDeclarationRubrics.AnyAsync(r => r.Code == "F1_5" || r.Code == "F1_RS_AUTRES"));
    }

    [Fact]
    public async Task Une_rubrique_ajoutee_par_le_dossier_laisse_sa_famille()
    {
        var name = await SeededV1Async();
        await using (var context = NewContext(name))
        {
            context.MonthlyDeclarationRubrics.Add(MonthlyDeclarationRubric.Create(
                MonthlyDeclarationFamily.StampDuty, "F7_DOSSIER", "Timbre du dossier", "*",
                RubricGrossKind.Fixed, RubricWithheldKind.Fixed, AccountBalanceSide.Credit, AccountBalanceSide.Credit,
                0m, 0m, 5m, null, null, null, null, [], 99).Value);
            await context.SaveChangesAsync();
        }

        var report = await UpgradeAsync(name);

        Assert.Contains(report!.SkippedFamilies, s => s.Family == MonthlyDeclarationFamily.StampDuty && s.Reason.Contains("F7_DOSSIER"));
        Assert.Equal(RubricWithheldKind.Account, (await RubricAsync(name, "F7_1")).WithheldKind);
    }

    /// <summary>
    /// La migration NCT 01 passe avant l'amorçage et renumérote les comptes des rubriques : un compte
    /// v1 reconnu sous son image reste intact, tout autre numéro ne l'est pas.
    /// </summary>
    [Fact]
    public void Un_compte_renumerote_par_la_migration_NCT_reste_intact()
    {
        var v1 = MonthlyDeclarationCatalogs.V1;
        var reference = v1.Rubrics.Single(r => r.Code == "F6_1");
        Func<string, string> rewrite = n => n == "43652" ? "4365200" : n;

        MonthlyDeclarationRubric WithAccount(string number) => MonthlyDeclarationRubric.Create(
            reference.Family, reference.Code, reference.Label, reference.ReportCode,
            reference.GrossKind, reference.WithheldKind, reference.GrossSide, reference.WithheldSide,
            reference.RatePercent, reference.FixedGrossAmount, reference.FixedWithheldAmount,
            reference.PayrollComponent, reference.WithheldPayrollComponent, null, null,
            [new RubricAccountInput(RubricAccountRole.Withheld, number, RubricAccountMatchMode.Exact)],
            reference.DisplayOrder).Value;

        Assert.True(MonthlyDeclarationCatalogV2.Decide(
            MonthlyDeclarationFamily.OtherTurnoverTaxes, [WithAccount("4365200")], v1, MonthlyDeclarationCatalogs.V2, rewrite, 0.2m).IsApplied);
        Assert.False(MonthlyDeclarationCatalogV2.Decide(
            MonthlyDeclarationFamily.OtherTurnoverTaxes, [WithAccount("43653")], v1, MonthlyDeclarationCatalogs.V2, rewrite, 0.2m).IsApplied);
    }

    /// <summary>
    /// Un dossier déjà en calcul paramétré verrait ses montants changer si l'on cochait ses familles :
    /// on ne les touche pas, on le signale pour revue.
    /// </summary>
    [Fact]
    public async Task Un_dossier_en_calcul_parametre_garde_ses_inclusions_et_est_signale()
    {
        var name = await SeededV1Async();
        await using (var context = NewContext(name))
        {
            var settings = MonthlyDeclarationSettings.CreateDefault();
            settings.SwitchToParity();
            settings.SwitchToConfigured(new DateTime(2026, 7, 1), "comptable@cabinet.tn", "test");
            context.MonthlyDeclarationSettings.Add(settings);
            await context.SaveChangesAsync();
        }

        var report = await UpgradeAsync(name);

        Assert.True(report!.ConfiguredDossierNeedsReview);
        Assert.Empty(report.InclusionsChanged);
        await using var check = NewContext(name);
        Assert.All(await check.MonthlyDeclarationFamilySettings.ToListAsync(), f => Assert.False(f.IsIncluded));
    }

    [Fact]
    public async Task Sans_taux_de_TCL_la_famille_TCL_n_est_pas_montee()
    {
        var name = await SeededV1Async();

        var report = await UpgradeAsync(name, new MonthlyDeclarationCatalogOptions(true, 0m));

        Assert.Contains(report!.SkippedFamilies, s => s.Family == MonthlyDeclarationFamily.Tcl);
        Assert.Equal(RubricGrossKind.Fixed, (await RubricAsync(name, "F9_3_1")).GrossKind);
    }

    [Fact]
    public async Task Interrupteur_eteint_rien_ne_bouge()
    {
        var name = await SeededV1Async();

        Assert.Null(await UpgradeAsync(name, MonthlyDeclarationCatalogOptions.Disabled));

        await using var context = NewContext(name);
        Assert.DoesNotContain(MonthlyDeclarationCatalogs.V2Version,
            await context.MonthlyDeclarationRubricSeedLogs.Select(l => l.CatalogVersion).ToListAsync());
        Assert.Equal(RubricWithheldKind.Account, (await RubricAsync(name, "F6_1")).WithheldKind);
    }

    /// <summary>
    /// Une rubrique du dossier, dans une famille que la v2 ne touche pas, lit déjà le FODEC des
    /// factures : monter F6_1 le ferait déclarer deux fois. Toute la montée est abandonnée, sans
    /// rien écrire, et le dossier reste en v1.
    /// </summary>
    [Fact]
    public async Task Un_conflit_de_source_abandonne_toute_la_montee()
    {
        var name = await SeededV1Async();
        await using (var context = NewContext(name))
        {
            context.MonthlyDeclarationRubrics.Add(MonthlyDeclarationRubric.Create(
                MonthlyDeclarationFamily.HotelTax, "F8_FODEC", "FODEC lu par erreur", "*",
                RubricGrossKind.Fixed, RubricWithheldKind.Document, AccountBalanceSide.Credit, AccountBalanceSide.Credit,
                0m, 0m, null, null, null, null, null, [], 99,
                withheldDocumentSource: DeclarationDocumentSource.FodecAmount).Value);
            await context.SaveChangesAsync();
        }

        Assert.Null(await UpgradeAsync(name));

        await using var check = NewContext(name);
        Assert.DoesNotContain(MonthlyDeclarationCatalogs.V2Version,
            await check.MonthlyDeclarationRubricSeedLogs.Select(l => l.CatalogVersion).ToListAsync());
        Assert.Equal(RubricWithheldKind.Account, (await RubricAsync(name, "F6_1")).WithheldKind);
        Assert.False(await check.MonthlyDeclarationRubrics.AnyAsync(r => r.Code == "F1_RS_AUTRES"));
    }
}
