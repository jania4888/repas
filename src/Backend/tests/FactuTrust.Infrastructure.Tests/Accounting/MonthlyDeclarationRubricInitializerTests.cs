using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// Amorçage du catalogue standard des rubriques. Le contrat vérifié ici est plus strict qu'un
/// simple « insérer si vide » : c'est lui qui empêche l'amorçage de défaire le travail du comptable
/// à chaque requête.
/// </summary>
public sealed class MonthlyDeclarationRubricInitializerTests
{
    private readonly string _databaseName = $"MonthlyDeclarationSeedDb_{Guid.NewGuid()}";

    private TenantDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase(databaseName: _databaseName)
            .Options);

    [Fact]
    public async Task L_amorcage_insere_le_catalogue_et_les_onze_familles()
    {
        await using var context = CreateContext();

        var inserted = await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        Assert.True(inserted > 0);
        Assert.Equal(inserted, await context.MonthlyDeclarationRubrics.CountAsync());
        Assert.Equal(
            Enum.GetValues<MonthlyDeclarationFamily>().Length,
            await context.MonthlyDeclarationFamilySettings.CountAsync());
    }

    /// <summary>
    /// La garantie de non-régression a deux moitiés : le drapeau éteint, et les familles décochées.
    /// C'est la seconde — même drapeau allumé, un dossier qui n'ouvre jamais l'écran calcule
    /// exactement comme avant.
    /// </summary>
    [Fact]
    public async Task Les_familles_sont_amorcees_non_incluses()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var families = await context.MonthlyDeclarationFamilySettings.ToListAsync();
        Assert.All(families, f => Assert.False(f.IsIncluded));
    }

    [Fact]
    public async Task Le_catalogue_couvre_les_onze_familles()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var covered = await context.MonthlyDeclarationRubrics
            .Select(r => r.Family)
            .Distinct()
            .ToListAsync();

        Assert.Equal(Enum.GetValues<MonthlyDeclarationFamily>().Length, covered.Count);
    }

    [Fact]
    public async Task Rejouer_l_amorcage_n_insere_rien()
    {
        await using var context = CreateContext();
        var first = await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var second = await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        Assert.Equal(0, second);
        Assert.Equal(first, await context.MonthlyDeclarationRubrics.CountAsync());
    }

    /// <summary>
    /// Le pire mode de défaillance possible : revenir en douce sur le taux qu'un comptable a
    /// corrigé. L'amorçage n'écrit jamais sur une rubrique existante.
    /// </summary>
    [Fact]
    public async Task Une_rubrique_modifiee_par_le_dossier_n_est_pas_retablie()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var rubric = await context.MonthlyDeclarationRubrics
            .Include(r => r.Accounts)
            .FirstAsync(r => r.Code == "F9_3_1");
        rubric.Update(
            "Libelle retouche par le cabinet", rubric.ReportCode,
            RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0.5m, null, null, null, null, null, null, Array.Empty<RubricAccountInput>(), 0);
        await context.SaveChangesAsync();

        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var reloaded = await context.MonthlyDeclarationRubrics.AsNoTracking()
            .FirstAsync(r => r.Code == "F9_3_1");
        Assert.Equal("Libelle retouche par le cabinet", reloaded.Label);
        Assert.Equal(0.5m, reloaded.RatePercent);
    }

    /// <summary>
    /// Et sa réciproque : une rubrique que le dossier a retirée ne doit pas réapparaître, sinon la
    /// suppression serait à refaire à chaque requête.
    /// </summary>
    [Fact]
    public async Task Une_rubrique_supprimee_par_le_dossier_n_est_pas_ressuscitee()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var rubric = await context.MonthlyDeclarationRubrics.FirstAsync(r => r.Code == "F9_3_2");
        context.MonthlyDeclarationRubrics.Remove(rubric);
        await context.SaveChangesAsync();

        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        Assert.False(await context.MonthlyDeclarationRubrics.AnyAsync(r => r.Code == "F9_3_2"));
    }

    [Fact]
    public async Task Le_journal_de_version_est_ecrit_une_seule_fois()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        Assert.Equal(1, await context.MonthlyDeclarationRubricSeedLogs.CountAsync());
    }

    [Fact]
    public async Task Une_inclusion_de_famille_deja_exprimee_est_preservee()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var tcl = await context.MonthlyDeclarationFamilySettings
            .FirstAsync(f => f.Family == MonthlyDeclarationFamily.Tcl);
        tcl.SetIncluded(true);
        await context.SaveChangesAsync();

        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var reloaded = await context.MonthlyDeclarationFamilySettings.AsNoTracking()
            .FirstAsync(f => f.Family == MonthlyDeclarationFamily.Tcl);
        Assert.True(reloaded.IsIncluded);
    }

    /// <summary>
    /// Les articles 1 et 3 ont la même assiette et deux retenues distinctes : les lire sur un compte
    /// commun les compterait deux fois. Le catalogue les fait donc dériver du cycle de paie.
    /// </summary>
    [Fact]
    public async Task L_IRPP_et_la_CSS_derivent_de_deux_valeurs_de_paie_distinctes()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var irpp = await context.MonthlyDeclarationRubrics.FirstAsync(r => r.Code == "F1_1");
        var css = await context.MonthlyDeclarationRubrics.FirstAsync(r => r.Code == "F1_3");

        Assert.Equal(PayrollContributionComponent.WithholdingIrpp, irpp.WithheldPayrollComponent);
        Assert.Equal(PayrollContributionComponent.WithholdingCss, css.WithheldPayrollComponent);
        Assert.Equal(PayrollContributionComponent.SalariesNetTaxableBase, irpp.PayrollComponent);
        Assert.Equal(PayrollContributionComponent.SalariesNetTaxableBase, css.PayrollComponent);
    }

    [Fact]
    public async Task Les_codes_du_catalogue_sont_uniques()
    {
        await using var context = CreateContext();
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context);

        var codes = await context.MonthlyDeclarationRubrics.Select(r => r.Code).ToListAsync();
        Assert.Equal(codes.Count, codes.Distinct(StringComparer.Ordinal).Count());
    }
}
