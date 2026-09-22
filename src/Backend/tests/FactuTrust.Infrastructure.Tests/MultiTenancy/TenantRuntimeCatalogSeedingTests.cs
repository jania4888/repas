using FactuTrust.Application.Common;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.MultiTenancy;

/// <summary>
/// Verrou de non-régression du défaut de production « 211 comptes » : un dossier neuf doit recevoir
/// le catalogue NCT 01 à la fin de son provisionnement, et le garde de migration ne doit être
/// court-circuité que si ce plan est réellement en place.
/// </summary>
/// <remarks>
/// Aucune base SQL Server requise : les tests du remap lui-même (<c>Nct01ChartMigrationServiceTests</c>)
/// se taisent quand SQL Server est injoignable, ce qui laissait ce câblage sans filet.
/// </remarks>
public sealed class TenantRuntimeCatalogSeedingTests
{
    private static MasterDbContext NewDb() =>
        new(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static TenantService NewService(
        MasterDbContext db, IMemoryCache cache, RecordingCatalogSeeder seeder) =>
        new(
            db,
            new EphemeralDataProtectionProvider(),
            new ConfigurationBuilder().Build(),
            cache,
            NullLogger<TenantService>.Instance,
            new TenantDatabaseProvisioner(
                Options.Create(new TenantProvisioningOptions()),
                NullLogger<TenantDatabaseProvisioner>.Instance),
            seeder);

    private static bool GuardMarked(IMemoryCache cache, Guid tenantId) =>
        cache.TryGetValue($"{TenantMigrationGuard.CacheKeyPrefix}{tenantId}", out bool applied) && applied;

    [Fact]
    public async Task Provisioning_SeedsRuntimeCatalogs_OnTheNewTenantDatabase()
    {
        await using var db = NewDb();
        var cache = new MemoryCache(new MemoryCacheOptions());
        var seeder = new RecordingCatalogSeeder();
        var service = NewService(db, cache, seeder);
        const string connectionString = "Server=test;Database=FactuTrust_Tenant_ABCD1234";

        var seeded = await service.TrySeedRuntimeCatalogsAsync(Guid.NewGuid(), connectionString, default);

        Assert.True(seeded);
        Assert.Equal([connectionString], seeder.EnsureConnectionStrings);
    }

    [Fact]
    public async Task Provisioning_NeverAuthorizesTheDestructiveRemap()
    {
        await using var db = NewDb();
        var seeder = new RecordingCatalogSeeder();
        var service = NewService(db, new MemoryCache(new MemoryCacheOptions()), seeder);

        await service.TrySeedRuntimeCatalogsAsync(Guid.NewGuid(), "Server=test;Database=T", default);

        // Le chemin automatique ne doit jamais réécrire l'historique comptable d'un dossier :
        // seule la bascule déclenchée par un administrateur plateforme le peut.
        Assert.Equal([false], seeder.EnsureAuthorizeFlags);
    }

    [Fact]
    public async Task SeederFailure_IsSwallowed_SoTheDossierCreationSurvives()
    {
        await using var db = NewDb();
        var seeder = new RecordingCatalogSeeder(failure: new InvalidOperationException("SQL indisponible"));
        var service = NewService(db, new MemoryCache(new MemoryCacheOptions()), seeder);

        var seeded = await service.TrySeedRuntimeCatalogsAsync(Guid.NewGuid(), "Server=test;Database=T", default);

        Assert.False(seeded);
    }

    [Fact]
    public void GuardIsMarkedApplied_OnlyWhenTheChartIsReallyOnNct01()
    {
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = NewService(NewDb(), cache, new RecordingCatalogSeeder());

        var complete = Guid.NewGuid();
        var incomplete = Guid.NewGuid();

        service.MarkAppliedIfComplete(complete, catalogsSeeded: true);
        service.MarkAppliedIfComplete(incomplete, catalogsSeeded: false);

        Assert.True(GuardMarked(cache, complete));

        // C'est le cœur du défaut corrigé : marquer systématiquement neutralisait pendant une heure
        // le seul rattrapage capable de poser le plan comptable NCT 01.
        Assert.False(GuardMarked(cache, incomplete));
    }

    [Fact]
    public async Task LegacyChart_IsNotConsideredComplete()
    {
        await using var db = NewDb();
        var service = NewService(db, new MemoryCache(new MemoryCacheOptions()), new RecordingCatalogSeeder("legacy"));

        Assert.False(await service.TrySeedRuntimeCatalogsAsync(Guid.NewGuid(), "Server=test;Database=T", default));
    }

    [Fact]
    public async Task DeferredChart_IsNotConsideredComplete()
    {
        await using var db = NewDb();
        var service = NewService(db, new MemoryCache(new MemoryCacheOptions()), new RecordingCatalogSeeder("deferred"));

        Assert.False(await service.TrySeedRuntimeCatalogsAsync(Guid.NewGuid(), "Server=test;Database=T", default));
    }
}

/// <summary>
/// Le verdict d'exploitation se déduit des <b>faits</b> (estampilles, volumétrie), pas de l'action
/// tentée : c'est lui que lit le diagnostic plateforme.
/// </summary>
public sealed class TenantRuntimeCatalogReportTests
{
    private static TenantRuntimeCatalogReport Report(
        ChartCatalogOutcome outcome,
        bool hasChart = true,
        string? mapVersion = "nct01-v1",
        string? appliedHash = "hash-a",
        string currentHash = "hash-a") =>
        new()
        {
            ChartOutcome = outcome,
            HasChart = hasChart,
            AccountCount = 1,
            AccountingLineCount = 0,
            AppliedMapVersion = mapVersion,
            AppliedCatalogHash = appliedHash,
            CurrentCatalogHash = currentHash
        };

    [Fact]
    public void NoChartTable_IsNoChart() =>
        Assert.Equal("no-chart", Report(ChartCatalogOutcome.Skipped, hasChart: false).Verdict);

    [Fact]
    public void RemapNeverApplied_IsLegacy() =>
        Assert.Equal("legacy", Report(ChartCatalogOutcome.NotApplied, mapVersion: null, appliedHash: null).Verdict);

    [Fact]
    public void AccountingDataWithoutRemap_IsDeferred() =>
        Assert.Equal(
            "deferred",
            Report(ChartCatalogOutcome.DeferredHasAccountingData, mapVersion: null, appliedHash: null).Verdict);

    [Fact]
    public void RemapAppliedWithAnOlderCatalog_IsCatalogDrift() =>
        Assert.Equal(
            "catalog-drift",
            Report(ChartCatalogOutcome.AlreadyApplied, appliedHash: "hash-old", currentHash: "hash-a").Verdict);

    [Fact]
    public void RemapAppliedAndCatalogUpToDate_IsNct01() =>
        Assert.Equal("nct01", Report(ChartCatalogOutcome.AlreadyApplied).Verdict);

    [Fact]
    public void FreshlyApplied_IsNct01() =>
        Assert.Equal("nct01", Report(ChartCatalogOutcome.Applied).Verdict);
}
