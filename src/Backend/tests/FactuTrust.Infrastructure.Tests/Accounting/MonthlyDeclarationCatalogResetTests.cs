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
/// Pose du catalogue de rubriques sur un dossier. Ce qui est vérifié ici, c'est qu'elle n'a lieu
/// qu'une fois, qu'elle ne laisse jamais une configuration à moitié posée, et que ce qu'elle
/// remplace reste lisible.
/// </summary>
public sealed class MonthlyDeclarationCatalogResetTests
{
    private static readonly MonthlyDeclarationCatalogOptions Options = new(TclRatePercent: 0.2m);

    private static TenantDbContext NewContext(string name) =>
        new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);

    private static async Task<MonthlyDeclarationCatalogResetReport> ResetAsync(
        string name, MonthlyDeclarationCatalogOptions? options = null)
    {
        await using var context = NewContext(name);
        return await MonthlyDeclarationCatalogReset.EnsureAppliedAsync(context, options ?? Options);
    }

    private static string NewDossier() => $"DmReset_{Guid.NewGuid()}";

    // ── La pose ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Un_dossier_neuf_recoit_le_catalogue_et_ses_onze_familles_cochees()
    {
        var name = NewDossier();

        var report = await ResetAsync(name);

        Assert.Equal(MonthlyDeclarationCatalogResetOutcome.Applied, report.Outcome);
        Assert.Equal(MonthlyDeclarationCatalogs.V2.Rubrics.Count, report.RubricCount);

        await using var check = NewContext(name);
        Assert.Equal(
            MonthlyDeclarationCatalogs.V2.Rubrics.Count,
            await check.MonthlyDeclarationRubrics.CountAsync());
        Assert.Equal(
            Enum.GetValues<MonthlyDeclarationFamily>().Length,
            await check.MonthlyDeclarationFamilySettings.CountAsync(f => f.IsIncluded));

        var versions = await check.MonthlyDeclarationRubricSeedLogs.Select(l => l.CatalogVersion).ToListAsync();
        Assert.Contains(MonthlyDeclarationCatalogs.V2Version, versions);
        Assert.Contains(MonthlyDeclarationCatalogReset.ResetVersion, versions);
    }

    /// <summary>
    /// La pose est une opération de bascule, pas un entretien : la rejouer effacerait le travail du
    /// comptable à chaque requête.
    /// </summary>
    [Fact]
    public async Task La_pose_n_a_lieu_qu_une_fois()
    {
        var name = NewDossier();
        await ResetAsync(name);

        await using (var context = NewContext(name))
        {
            var rubric = await context.MonthlyDeclarationRubrics.FirstAsync(r => r.Code == "F1_8");
            rubric.ToggleActive();
            await context.SaveChangesAsync();
        }

        var again = await ResetAsync(name);

        Assert.Equal(MonthlyDeclarationCatalogResetOutcome.AlreadyApplied, again.Outcome);
        await using var check = NewContext(name);
        Assert.False(await check.MonthlyDeclarationRubrics.Where(r => r.Code == "F1_8").Select(r => r.IsActive).SingleAsync());
        Assert.Single(await check.AuditLogs
            .Where(a => a.Action == AuditActions.Accounting.MonthlyDeclarationCatalogReset)
            .ToListAsync());
    }

    // ── Ce qu'elle remplace ───────────────────────────────────────────────────

    /// <summary>
    /// La configuration antérieure est remplacée — c'est le but — mais elle part dans l'audit au
    /// format du Modèle d'intégration : relisible, et réimportable si un dossier devait retrouver
    /// une rubrique qu'il avait taillée à la main.
    /// </summary>
    [Fact]
    public async Task La_configuration_remplacee_part_dans_l_audit_et_reste_relisible()
    {
        var name = NewDossier();
        await using (var context = NewContext(name))
        {
            var maison = MonthlyDeclarationRubric.Create(
                MonthlyDeclarationFamily.HotelTax, "MAISON_1", "Taxe de séjour du dossier", "1",
                RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
                AccountBalanceSide.Credit, AccountBalanceSide.Credit,
                ratePercent: 0m, fixedGrossAmount: 500m, fixedWithheldAmount: 7m,
                payrollComponent: null, withheldPayrollComponent: null,
                effectiveFrom: null, effectiveTo: null, accounts: null).Value;
            maison.SetAuditInfo("comptable@cabinet.tn");
            context.MonthlyDeclarationRubrics.Add(maison);
            context.MonthlyDeclarationFamilySettings.Add(
                MonthlyDeclarationFamilySetting.Create(MonthlyDeclarationFamily.HotelTax, isIncluded: true).Value);
            await context.SaveChangesAsync();
        }

        await ResetAsync(name);

        await using var check = NewContext(name);
        Assert.Empty(await check.MonthlyDeclarationRubrics.Where(r => r.Code == "MAISON_1").ToListAsync());

        var entry = await check.AuditLogs.SingleAsync(
            a => a.Action == AuditActions.Accounting.MonthlyDeclarationCatalogReset);
        Assert.NotNull(entry.OldValues);

        var restored = MonthlyDeclarationModel.Parse(entry.OldValues!);
        Assert.True(restored.IsSuccess, restored.IsFailure ? restored.Error.Description : null);
        var kept = Assert.Single(restored.Value.Rubrics);
        Assert.Equal("MAISON_1", kept.Code);
        Assert.Equal(7m, kept.FixedWithheldAmount);
    }

    /// <summary>Un dossier vierge n'a rien à sauvegarder : l'entrée d'audit ne ment pas.</summary>
    [Fact]
    public async Task Un_dossier_vierge_n_a_pas_de_configuration_anterieure()
    {
        var name = NewDossier();

        await ResetAsync(name);

        await using var check = NewContext(name);
        var entry = await check.AuditLogs.SingleAsync(
            a => a.Action == AuditActions.Accounting.MonthlyDeclarationCatalogReset);
        Assert.Null(entry.OldValues);
        Assert.NotNull(entry.NewValues);
    }

    /// <summary>
    /// L'entrée s'enchaîne à la chaîne de hachage de l'audit, comme toute autre : une pose qui la
    /// romprait ferait échouer le contrôle d'intégrité du dossier.
    /// </summary>
    [Fact]
    public async Task L_entree_d_audit_s_enchaine_a_la_chaine_de_hachage()
    {
        var name = NewDossier();
        string previousHash;
        await using (var context = NewContext(name))
        {
            var first = AuditLog.Create(
                null, null, "comptable@cabinet.tn", AuditActions.Accounting.MonthlyDeclarationRubricCreated,
                nameof(MonthlyDeclarationRubric), null, null, null, "127.0.0.1", null, "GENESIS");
            context.AuditLogs.Add(first);
            await context.SaveChangesAsync();
            previousHash = first.Hash;
        }

        await ResetAsync(name);

        await using var check = NewContext(name);
        var entry = await check.AuditLogs.SingleAsync(
            a => a.Action == AuditActions.Accounting.MonthlyDeclarationCatalogReset);
        Assert.Equal(previousHash, entry.PreviousHash);
        Assert.Equal("system", entry.UserEmail);
    }

    // ── Garde-fous du catalogue posé ──────────────────────────────────────────

    /// <summary>
    /// Deux rubriques qui liraient la même source déclareraient le montant deux fois. Le catalogue
    /// posé ne doit jamais être dans ce cas.
    /// </summary>
    [Fact]
    public async Task Le_catalogue_pose_ne_lit_aucune_source_deux_fois()
    {
        var name = NewDossier();
        await ResetAsync(name);

        await using var check = NewContext(name);
        var rubrics = await check.MonthlyDeclarationRubrics.Include(r => r.Accounts).ToListAsync();

        Assert.Empty(MonthlyDeclarationSourceOverlap.AllConflicts(rubrics));
    }

    /// <summary>
    /// Taux de TCL éteint sur la plateforme : le calcul historique valait 0. La rubrique assise sur
    /// ce taux est posée — pour qu'un dossier puisse la rallumer — mais inactive, faute de quoi elle
    /// inventerait une TCL que le dossier n'a jamais déclarée. Le domaine refusant un « brut × taux »
    /// à taux nul, c'est la seule façon d'obtenir le même montant.
    /// </summary>
    [Fact]
    public async Task Taux_de_TCL_nul_la_rubrique_est_posee_mais_inactive()
    {
        var name = NewDossier();

        await ResetAsync(name, new MonthlyDeclarationCatalogOptions(TclRatePercent: 0m));

        await using var check = NewContext(name);
        var tcl = await check.MonthlyDeclarationRubrics.SingleAsync(
            r => r.Code == MonthlyDeclarationCatalogV2.TclRubricCode);
        Assert.False(tcl.IsActive);
        Assert.True(await check.MonthlyDeclarationRubrics.AnyAsync(r => r.Code == "F9_3_2" && r.IsActive));
    }

    /// <summary>
    /// Faute de réglages — outillage EF, amorçage d'une base modèle — le taux légal est retenu, et
    /// jamais zéro : la pose n'ayant lieu qu'une fois, un zéro accidentel y figerait une TCL éteinte.
    /// </summary>
    [Fact]
    public void Sans_reglages_le_taux_de_TCL_est_le_taux_legal() =>
        Assert.Equal(0.2m, MonthlyDeclarationCatalogOptionsFactory.From(null).TclRatePercent);

    // ── Le catalogue lui-même ─────────────────────────────────────────────────

    [Fact]
    public void Le_catalogue_couvre_les_onze_familles() =>
        Assert.Equal(
            Enum.GetValues<MonthlyDeclarationFamily>().OrderBy(f => f),
            MonthlyDeclarationCatalogs.V2.Rubrics.Select(r => r.Family).Distinct().OrderBy(f => f));

    [Fact]
    public void Les_codes_du_catalogue_sont_uniques()
    {
        var codes = MonthlyDeclarationCatalogs.V2.Rubrics.Select(r => r.Code).ToList();
        Assert.Equal(codes.Count, codes.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// Articles 1 et 3 : même assiette (le net imposable), mais deux retenues distinctes. Les lire
    /// sur un compte commun les compterait deux fois.
    /// </summary>
    [Fact]
    public void L_IRPP_et_la_CSS_derivent_de_deux_valeurs_de_paie_distinctes()
    {
        var irpp = MonthlyDeclarationCatalogs.V2.Rubrics.Single(r => r.Code == "F1_1");
        var css = MonthlyDeclarationCatalogs.V2.Rubrics.Single(r => r.Code == "F1_3");

        Assert.Equal(PayrollContributionComponent.SalariesNetTaxableBase, irpp.PayrollComponent);
        Assert.Equal(PayrollContributionComponent.SalariesNetTaxableBase, css.PayrollComponent);
        Assert.Equal(PayrollContributionComponent.WithholdingIrpp, irpp.WithheldPayrollComponent);
        Assert.Equal(PayrollContributionComponent.WithholdingCss, css.WithheldPayrollComponent);
    }

    /// <summary>
    /// Le catalogue cite quatre comptes. Aucun ne doit être renuméroté par le passage au plan
    /// NCT 01, qui s'exécute avant la pose : sinon les rubriques posées désigneraient des comptes
    /// que le dossier n'a plus, et liraient zéro mouvement sans que rien ne le dise.
    /// </summary>
    [Fact]
    public void Aucun_compte_du_catalogue_n_est_renumerote_par_le_remap_NCT()
    {
        var remap = SceChartCatalog.LoadRemap();
        var accounts = MonthlyDeclarationCatalogs.V2.Rubrics
            .SelectMany(r => r.Accounts ?? [])
            .Select(a => a.AccountNumber)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        Assert.NotEmpty(accounts);
        Assert.All(accounts, number => Assert.Equal(number, remap.Rewrite(number)));
    }
}
