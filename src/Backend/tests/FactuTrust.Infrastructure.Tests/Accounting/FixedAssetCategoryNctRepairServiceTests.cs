using System.Data;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// Corrective startup step converging DepreciationRateCategories default accounts (French-style, seeded by
/// the two immutable "AddFixedAssetsModule_Tenant" / "SeedDecree2008_492RateCategories_Tenant" migrations,
/// after the nct01-v1 remap log so they are never rewritten by it) onto canonical NCT targets.
/// SQL Server required : the service executes raw SQL (sp_getapplock, log table).
/// </summary>
[Collection(SqlServerSerialCollection.Name)]
public sealed class FixedAssetCategoryNctRepairServiceTests : IDisposable
{
    private readonly SqlTestDatabase _sqlDb = new(nameof(FixedAssetCategoryNctRepairServiceTests));
    private readonly string? _connectionString;
    private readonly bool _canRun;

    public FixedAssetCategoryNctRepairServiceTests()
    {
        _connectionString = _sqlDb.ConnectionString;
        _canRun = _sqlDb.CanRun;
    }

    [Fact]
    public async Task EnsureApplied_OldFrenchSeededCategories_ConvergesToCanonical_AndSecondRunIsNoOp()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            SeedFrenchStyleCategories(db);
            await db.SaveChangesAsync();
        }

        await using (var db = CreateContext())
            await FixedAssetCategoryNctRepairService.EnsureAppliedAsync(db);

        await using (var db = CreateContext())
        {
            await AssertCanonicalStateAsync(db);
            Assert.Equal(1, await LogCountAsync(db));
        }

        // Second run: idempotent, no additional log row, values unchanged.
        await using (var db = CreateContext())
            await FixedAssetCategoryNctRepairService.EnsureAppliedAsync(db);

        await using (var db = CreateContext())
        {
            await AssertCanonicalStateAsync(db);
            Assert.Equal(1, await LogCountAsync(db));
        }
    }

    [Fact]
    public async Task EnsureApplied_AfterNct01Remap_NewTenant_ProducesSameCanonicalValues()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            SeedFrenchStyleCategories(db);
            await db.SaveChangesAsync();
        }

        // Simulate the ordering that happens for a fresh tenant: NCT01 remap runs first (categories were
        // seeded after the nct01-v1 log row, so it does not touch them), then the corrective step.
        await using (var db = CreateContext())
            await Nct01ChartMigrationService.EnsureMigratedAsync(db, ChartMigrationMode.Authorized);

        await using (var db = CreateContext())
            await FixedAssetCategoryNctRepairService.EnsureAppliedAsync(db);

        await using (var db = CreateContext())
            await AssertCanonicalStateAsync(db);
    }

    [Fact]
    public async Task EnsureApplied_ConcurrentExecution_SingleEffectiveApplication_BothCallsSucceed()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            SeedFrenchStyleCategories(db);
            await db.SaveChangesAsync();
        }

        await using var dbA = CreateContext();
        await using var dbB = CreateContext();

        var taskA = FixedAssetCategoryNctRepairService.EnsureAppliedAsync(dbA);
        var taskB = FixedAssetCategoryNctRepairService.EnsureAppliedAsync(dbB);

        // Both calls must complete without throwing — the applock + unique-violation fallback ensures a
        // single effective application even under a race.
        await Task.WhenAll(taskA, taskB);

        await using (var db = CreateContext())
        {
            await AssertCanonicalStateAsync(db);
            Assert.Equal(1, await LogCountAsync(db));
        }
    }

    [Fact]
    public async Task EnsureApplied_DoesNotModifyExistingFixedAssets()
    {
        if (!_canRun) return;

        Guid vehPassCategoryId;
        await using (var db = CreateContext())
        {
            SeedFrenchStyleCategories(db);
            await db.SaveChangesAsync();
            vehPassCategoryId = await db.DepreciationRateCategories
                .Where(c => c.Code == "VEH_PASS")
                .Select(c => c.Id)
                .SingleAsync();
        }

        await using (var db = CreateContext())
        {
            var asset = FixedAsset.Create(
                "IMMO-2026-0001",
                "Voiture de tourisme existante",
                vehPassCategoryId,
                3.33m,
                30m,
                "218",
                "2818",
                "6818",
                40000m,
                0m,
                0m,
                new DateTime(2026, 1, 15)).Value;
            db.FixedAssets.Add(asset);
            await db.SaveChangesAsync();
        }

        await using (var db = CreateContext())
            await FixedAssetCategoryNctRepairService.EnsureAppliedAsync(db);

        await using (var db = CreateContext())
        {
            var asset = await db.FixedAssets.AsNoTracking().SingleAsync(a => a.InventoryNumber == "IMMO-2026-0001");
            Assert.Equal("218", asset.AssetAccountNumber);
            Assert.Equal("2818", asset.DepreciationAccountNumber);
            Assert.Equal("6818", asset.ExpenseAccountNumber);
            Assert.Equal(3.33m, asset.DepreciationRatePercent);

            // The category itself was converged (future creations only).
            var category = await db.DepreciationRateCategories.AsNoTracking().SingleAsync(c => c.Id == vehPassCategoryId);
            Assert.Equal("2244", category.DefaultAssetAccount);
            Assert.Equal("2824", category.DefaultDepreciationAccount);
            Assert.Equal("68112", category.DefaultExpenseAccount);
            Assert.Equal(20m, category.LegalRatePercent);
        }
    }

    [Fact]
    public async Task EnsureApplied_MissingAccounts_CreatedIfAbsent_NotDuplicatedIfPresent()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            SeedFrenchStyleCategories(db);
            // Pre-seed one of the three missing accounts to verify no duplication / no crash on existing row.
            var created = ChartOfAccount.Create("2824", "Amortissements du matériel de transport (pré-existant)", 2, "282",
                FactuTrust.Domain.Enums.AccountNatureType.Credit, isSystem: true);
            db.ChartOfAccounts.Add(created.Value);
            await db.SaveChangesAsync();
        }

        await using (var db = CreateContext())
            await FixedAssetCategoryNctRepairService.EnsureAppliedAsync(db);

        await using (var db = CreateContext())
        {
            var numbers = await db.ChartOfAccounts.AsNoTracking()
                .Where(a => a.AccountNumber == "2824" || a.AccountNumber == "2812" || a.AccountNumber == "2818")
                .ToListAsync();
            Assert.Equal(3, numbers.Count);
            Assert.All(numbers, a => Assert.True(a.IsSystem));
            Assert.Equal("Amortissements du matériel de transport (pré-existant)",
                numbers.Single(a => a.AccountNumber == "2824").Label);
        }
    }

    private static async Task AssertCanonicalStateAsync(TenantDbContext db)
    {
        var categories = await db.DepreciationRateCategories.AsNoTracking()
            .ToDictionaryAsync(c => c.Code, c => c);

        AssertTargets(categories, "LAND", "221", "2821", "68112");
        AssertTargets(categories, "PRELIM", "218", "2818", "68111");
        AssertTargets(categories, "PATENT", "212", "2812", "68111");
        foreach (var code in new[] { "BLDG_PERM", "BLDG_LIGHT", "BLDG_TEMP", "BLDG_BRIDGE", "BLDG_DUR" })
            AssertTargets(categories, code, "222", "2822", "68112");
        foreach (var code in new[]
                 {
                     "TECH_INST", "MACH_GEN", "MACH_AGRI", "MAJOR_REP_3", "MAJOR_REP_4", "MAJOR_REP_6", "MAJOR_REP_8",
                     "UTIL_GAS", "AGRI_IRR", "AGRI_TRACT", "AGRI_WELL", "AGRI_IRRIG",
                 })
            AssertTargets(categories, code, "223", "2823", "68112");
        foreach (var code in new[] { "AGRI_TREE", "AGRI_OLIVE_30", "AGRI_OLIVE_20", "AGRI_VINE", "AGRI_CITRUS" })
            AssertTargets(categories, code, "221", "2821", "68112");
        foreach (var code in new[]
                 {
                     "IT_EQUIP", "OFF_FURN", "SHELVING", "CONTAINER", "TANK", "HOTEL_KITCH", "HOTEL_DISH",
                     "HOTEL_LINEN", "PUB_WORKS", "OTHER",
                 })
            AssertTargets(categories, code, "228", "2828", "68112");
        AssertTargets(categories, "VEH_UTIL", "2241", "2824", "68112");
        AssertTargets(categories, "VEH_PASS", "2244", "2824", "68112");
        foreach (var code in new[] { "ROAD_TRANS", "RAIL_15", "RAIL_20", "RAIL_30", "AIR_TRANS", "SEA_TRANS" })
            AssertTargets(categories, code, "224", "2824", "68112");

        Assert.Equal(20m, categories["VEH_PASS"].LegalRatePercent);

        var accounts = await db.ChartOfAccounts.AsNoTracking()
            .Where(a => a.AccountNumber == "2824" || a.AccountNumber == "2812" || a.AccountNumber == "2818")
            .ToListAsync();
        Assert.Equal(3, accounts.Count);
        Assert.All(accounts, a => Assert.True(a.IsSystem));
    }

    private static void AssertTargets(
        IReadOnlyDictionary<string, DepreciationRateCategory> categories,
        string code,
        string asset,
        string depreciation,
        string expense)
    {
        Assert.True(categories.ContainsKey(code), $"Catégorie manquante : {code}");
        var category = categories[code];
        Assert.Equal(asset, category.DefaultAssetAccount);
        Assert.Equal(depreciation, category.DefaultDepreciationAccount);
        Assert.Equal(expense, category.DefaultExpenseAccount);
    }

    /// <summary>
    /// Mirrors the 43 category rows seeded by the two immutable migrations, in their original
    /// French-style accounts (before this corrective step exists).
    /// </summary>
    private static void SeedFrenchStyleCategories(TenantDbContext db)
    {
        void Cat(string code, string label, decimal rate, string asset, string amort, string expense, bool nonDep, int sort) =>
            db.DepreciationRateCategories.Add(DepreciationRateCategory.Create(code, label, rate, asset, amort, expense, nonDep, sort));

        Cat("LAND", "Terrains", 0m, "211", "2811", "6811", true, 1);
        Cat("PRELIM", "Frais préliminaires et charges à répartir", 100m, "20", "280", "681", false, 2);
        Cat("PATENT", "Brevets, licences, marques, logiciels", 20m, "20", "280", "681", false, 3);
        Cat("BLDG_PERM", "Constructions permanentes", 5m, "212", "2812", "6812", false, 10);
        Cat("BLDG_LIGHT", "Constructions légères et installations", 10m, "212", "2812", "6812", false, 11);
        Cat("BLDG_TEMP", "Constructions temporaires", 25m, "212", "2812", "6812", false, 12);
        Cat("TECH_INST", "Installations techniques, matériel industriel", 15m, "213", "2813", "6813", false, 20);
        Cat("MACH_GEN", "Machines et équipements généraux", 15m, "213", "2813", "6813", false, 21);
        Cat("MACH_AGRI", "Matériel agricole", 20m, "213", "2813", "6813", false, 22);
        Cat("IT_EQUIP", "Matériel informatique", 33.33m, "218", "2818", "6818", false, 30);
        Cat("OFF_FURN", "Mobilier de bureau", 20m, "218", "2818", "6818", false, 31);
        Cat("VEH_UTIL", "Véhicules de transport utilitaires", 20m, "218", "2818", "6818", false, 32);
        Cat("VEH_PASS", "Véhicules de tourisme", 3.33m, "218", "2818", "6818", false, 33);
        Cat("AGRI_TREE", "Plantations et arbres fruitiers", 3.33m, "211", "2811", "6811", false, 40);
        Cat("AGRI_IRR", "Équipements d'irrigation", 20m, "213", "2813", "6813", false, 41);
        Cat("OTHER", "Autres immobilisations corporelles", 15m, "218", "2818", "6818", false, 99);

        Cat("BLDG_BRIDGE", "Ponts et ouvrages d'art", 2.5m, "212", "2812", "6812", false, 13);
        Cat("BLDG_DUR", "Constructions durables", 5m, "212", "2812", "6812", false, 14);
        Cat("MAJOR_REP_3", "Grosses reparations - duree <= 3 ans", 33.33m, "213", "2813", "6813", false, 23);
        Cat("MAJOR_REP_4", "Grosses reparations - duree 4 ans", 25m, "213", "2813", "6813", false, 24);
        Cat("MAJOR_REP_6", "Grosses reparations - duree 6 ans", 15m, "213", "2813", "6813", false, 25);
        Cat("MAJOR_REP_8", "Grosses reparations - duree 8 ans", 12.5m, "213", "2813", "6813", false, 26);
        Cat("SHELVING", "Rayonnages et etageres industrielles", 15m, "218", "2818", "6818", false, 34);
        Cat("CONTAINER", "Conteneurs et emballages reutilisables", 10m, "218", "2818", "6818", false, 35);
        Cat("TANK", "Citernes et reservoirs", 20m, "218", "2818", "6818", false, 36);
        Cat("RAIL_20", "Materiel ferroviaire - duree 20 ans", 5m, "218", "2818", "6818", false, 50);
        Cat("RAIL_30", "Materiel ferroviaire - duree 30 ans", 3.33m, "218", "2818", "6818", false, 51);
        Cat("RAIL_15", "Materiel ferroviaire - duree 15 ans", 6.67m, "218", "2818", "6818", false, 52);
        Cat("AIR_TRANS", "Materiel de transport aerien", 5.56m, "218", "2818", "6818", false, 53);
        Cat("SEA_TRANS", "Materiel de transport maritime", 6.25m, "218", "2818", "6818", false, 54);
        Cat("ROAD_TRANS", "Materiel de transport terrestre", 20m, "218", "2818", "6818", false, 55);
        Cat("PUB_WORKS", "Materiel de travaux publics", 20m, "218", "2818", "6818", false, 56);
        Cat("UTIL_GAS", "Installations electricite et gaz", 5m, "213", "2813", "6813", false, 60);
        Cat("HOTEL_KITCH", "Materiel de cuisine (hotellerie)", 20m, "218", "2818", "6818", false, 70);
        Cat("HOTEL_DISH", "Vaisselle et petit materiel (hotellerie)", 100m, "218", "2818", "6818", false, 71);
        Cat("HOTEL_LINEN", "Linge et literie (hotellerie)", 33.33m, "218", "2818", "6818", false, 72);
        Cat("AGRI_TRACT", "Tracteurs et materiel de traction", 20m, "213", "2813", "6813", false, 42);
        Cat("AGRI_OLIVE_30", "Oliviers - duree 30 ans", 3.33m, "211", "2811", "6811", false, 43);
        Cat("AGRI_OLIVE_20", "Oliviers - duree 20 ans", 5m, "211", "2811", "6811", false, 44);
        Cat("AGRI_VINE", "Vignes", 3.33m, "211", "2811", "6811", false, 45);
        Cat("AGRI_CITRUS", "Agrumes et amandiers", 5m, "211", "2811", "6811", false, 46);
        Cat("AGRI_WELL", "Puits et forages", 10m, "213", "2813", "6813", false, 47);
        Cat("AGRI_IRRIG", "Installations d'arrosage", 20m, "213", "2813", "6813", false, 48);
    }

    private static async Task<int> LogCountAsync(TenantDbContext db)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await db.Database.OpenConnectionAsync();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(1) FROM [dbo].[ChartOfAccountRemapLogs] WHERE [MapVersion] = N'fixedassets-nct-v2'";
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private TenantDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(_connectionString)
            .Options);

    public void Dispose() => _sqlDb.Dispose();
}
