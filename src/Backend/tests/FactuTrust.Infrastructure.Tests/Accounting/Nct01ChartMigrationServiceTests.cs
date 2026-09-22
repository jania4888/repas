using System.Data;
using FactuTrust.Application.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// Migration PCG hybride → NCT 01 sur un mini-jeu de seed historique.
/// SQL Server / LocalDB requis : le service exécute du SQL brut (tampon d'unicité, table de log).
/// </summary>
public sealed class Nct01ChartMigrationServiceTests : IDisposable
{
    private readonly SqlTestDatabase _sqlDb = new(nameof(Nct01ChartMigrationServiceTests));
    private readonly string? _connectionString;
    private readonly bool _canRun;

    public Nct01ChartMigrationServiceTests()
    {
        _connectionString = _sqlDb.ConnectionString;
        _canRun = _sqlDb.CanRun;
    }

    [Fact]
    public async Task EnsureMigrated_OldSeedMiniSet_FollowsBalances_AndSecondRunIsNoOp()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            SeedOldChartAndJournal(db);
            await db.SaveChangesAsync();
        }

        await using (var db = CreateContext())
            await Nct01ChartMigrationService.EnsureMigratedAsync(db, ChartMigrationMode.Authorized);

        await using (var db = CreateContext())
        {
            var lines = await db.JournalEntryLines.AsNoTracking().ToListAsync();
            Assert.Equal(5000m, SumDebit(lines, "221"));
            Assert.Equal(300m, SumDebit(lines, "413"));
            Assert.Equal(150m, SumDebit(lines, "421"));
            Assert.Equal(100m, SumCredit(lines, "117"));
            Assert.Equal(50m, SumCredit(lines, "43652"));
            Assert.Equal(2000m, SumCredit(lines, "425"));
            Assert.Equal(190m, SumCredit(lines, "436711"));
            Assert.DoesNotContain(lines, l => l.AccountNumber == "4477");
            Assert.DoesNotContain(lines, l => l.AccountNumber == "211");
            Assert.DoesNotContain(lines, l => l.AccountNumber == "412");

            var fodec = await db.ChartOfAccounts.AsNoTracking()
                .SingleAsync(a => a.AccountNumber == "43652");
            Assert.True(fodec.IsSystem);
            Assert.True(fodec.IsActive);
            Assert.Equal("4365", fodec.ParentAccountNumber);

            var numbers = await db.ChartOfAccounts.AsNoTracking()
                .Select(a => a.AccountNumber)
                .ToListAsync();
            Assert.DoesNotContain("4477", numbers);
            Assert.Contains("425", numbers);
            Assert.Contains("421", numbers);
            Assert.True(numbers.Count >= 600, $"Catalogue incomplet après UPSERT : {numbers.Count}");
            Assert.Equal(1, await LogCountAsync(db));
        }

        await using (var db = CreateContext())
            await Nct01ChartMigrationService.EnsureMigratedAsync(db, ChartMigrationMode.Authorized);

        await using (var db = CreateContext())
        {
            Assert.Equal(1, await LogCountAsync(db));
            var lines = await db.JournalEntryLines.AsNoTracking().ToListAsync();
            Assert.Equal(2000m, SumCredit(lines, "425"));
            Assert.Equal(150m, SumDebit(lines, "421"));
            Assert.Equal(50m, SumCredit(lines, "43652"));
        }
    }

    /// <summary>
    /// Mode automatique (provisionnement, premier appel HTTP) sur un dossier qui a déjà des
    /// écritures : le remap doit être <b>différé</b>, sans toucher au plan ni aux écritures. Il
    /// réécrirait sinon l'historique comptable — périodes clôturées comprises — au premier appel qui
    /// passe, sans sauvegarde ni décision humaine.
    /// </summary>
    [Fact]
    public async Task EnsureMigrated_AutoSafe_DefersWhenTheDossierAlreadyHasEntries()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            SeedOldChartAndJournal(db);
            await db.SaveChangesAsync();
        }

        TenantRuntimeCatalogReport report;
        await using (var db = CreateContext())
            report = await Nct01ChartMigrationService.EnsureMigratedAsync(db);

        Assert.Equal(ChartCatalogOutcome.DeferredHasAccountingData, report.ChartOutcome);
        Assert.Equal("deferred", report.Verdict);

        await using (var db = CreateContext())
        {
            // Plan inchangé : ni renumérotation, ni UPSERT du catalogue, ni estampille.
            var numbers = await db.ChartOfAccounts.AsNoTracking()
                .Select(a => a.AccountNumber)
                .ToListAsync();

            Assert.Contains("4477", numbers);
            Assert.Contains("412", numbers);
            Assert.DoesNotContain("43652", numbers);
            Assert.True(numbers.Count < 100, $"Le catalogue a été appliqué malgré le mode sûr : {numbers.Count}");
            Assert.Equal(0, await LogCountAsync(db));

            var lines = await db.JournalEntryLines.AsNoTracking().ToListAsync();
            Assert.Equal(50m, SumCredit(lines, "4477"));
            Assert.Equal(2000m, SumCredit(lines, "421"));
        }

        // La même base, bascule autorisée : le remap s'applique normalement.
        await using (var db = CreateContext())
        {
            var authorized = await Nct01ChartMigrationService.EnsureMigratedAsync(
                db, ChartMigrationMode.Authorized);
            Assert.Equal(ChartCatalogOutcome.Applied, authorized.ChartOutcome);
            Assert.Equal("nct01", authorized.Verdict);
        }

        await using (var db = CreateContext())
        {
            var lines = await db.JournalEntryLines.AsNoTracking().ToListAsync();
            Assert.DoesNotContain(lines, l => l.AccountNumber == "4477");
            Assert.Equal(1, await LogCountAsync(db));
        }
    }

    /// <summary>
    /// Un dossier vierge — cas d'un dossier tout juste provisionné — bascule <b>sans</b> autorisation
    /// explicite : c'est ce qui garantit qu'un nouveau dossier naît en NCT 01.
    /// </summary>
    [Fact]
    public async Task EnsureMigrated_AutoSafe_AppliesOnAFreshDossier()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            db.ChartOfAccounts.AddRange(
                Acc("10", "Capital et réserves assimilées", null, AccountNatureType.Credit),
                Acc("101", "Capital social", "10", AccountNatureType.Credit));
            await db.SaveChangesAsync();
        }

        TenantRuntimeCatalogReport report;
        await using (var db = CreateContext())
            report = await Nct01ChartMigrationService.EnsureMigratedAsync(db);

        Assert.Equal(ChartCatalogOutcome.Applied, report.ChartOutcome);
        Assert.Equal("nct01", report.Verdict);
        Assert.True(report.AccountCount >= 600, $"Catalogue incomplet : {report.AccountCount}");

        await using (var db = CreateContext())
        {
            var capital = await db.ChartOfAccounts.AsNoTracking()
                .SingleAsync(a => a.AccountNumber == "10");

            // Le libellé hérité est remplacé par celui du catalogue : c'est la signature visible
            // d'un plan réellement migré.
            Assert.Equal("Capital", capital.Label);
        }
    }

    /// <summary>
    /// Deuxième passage avec une empreinte de catalogue déjà à jour : aucun travail, et surtout
    /// aucun second remap (les cycles 421↔425 et 231↔232 le rendraient destructeur).
    /// </summary>
    [Fact]
    public async Task EnsureMigrated_SecondRun_IsAlreadyApplied()
    {
        if (!_canRun) return;

        await using (var db = CreateContext())
        {
            db.ChartOfAccounts.Add(Acc("10", "Capital", null, AccountNatureType.Credit));
            await db.SaveChangesAsync();
        }

        await using (var db = CreateContext())
            await Nct01ChartMigrationService.EnsureMigratedAsync(db);

        await using (var db = CreateContext())
        {
            var second = await Nct01ChartMigrationService.EnsureMigratedAsync(db);
            Assert.Equal(ChartCatalogOutcome.AlreadyApplied, second.ChartOutcome);
            Assert.Equal(SceChartCatalog.CatalogHash, second.AppliedCatalogHash);
            Assert.Equal(1, await LogCountAsync(db));
        }
    }

    private static void SeedOldChartAndJournal(TenantDbContext db)
    {
        db.ChartOfAccounts.AddRange(
            Acc("10", "Capital", null, AccountNatureType.Credit),
            Acc("101", "Capital social", "10", AccountNatureType.Credit),
            Acc("105", "Primes d'émission", "10", AccountNatureType.Credit),
            Acc("21", "Immobilisations corporelles", null, AccountNatureType.Debit),
            Acc("211", "Terrains", "21", AccountNatureType.Debit),
            Acc("41", "Clients", null, AccountNatureType.Debit),
            Acc("412", "Clients - effets à recevoir", "41", AccountNatureType.Debit),
            Acc("42", "Personnel", null, AccountNatureType.Credit),
            Acc("421", "Personnel - rémunérations dues", "42", AccountNatureType.Credit),
            Acc("425", "Personnel - avances", "42", AccountNatureType.Debit),
            Acc("44", "État", null, AccountNatureType.Credit),
            Acc("447", "État - autres", "44", AccountNatureType.Credit),
            Acc("4477", "FODEC à payer", "447", AccountNatureType.Credit),
            Acc("43671", "TVA collectée", null, AccountNatureType.Credit),
            Acc("436711", "TVA collectée sur débits", "43671", AccountNatureType.Credit));

        var period = AccountingPeriod.Create(2025, 12, new DateTime(2025, 12, 1), new DateTime(2025, 12, 31));
        db.AccountingPeriods.Add(period);

        var lines = new List<JournalLineInput>
        {
            new("211", "Terrains", 5000m, 0m, null, ThirdPartyKind.None),
            new("412", "Effets clients", 300m, 0m, null, ThirdPartyKind.None),
            new("425", "Avances personnel", 150m, 0m, null, ThirdPartyKind.None),
            new("105", "Primes", 0m, 100m, null, ThirdPartyKind.None),
            new("4477", "FODEC", 0m, 50m, null, ThirdPartyKind.None),
            new("421", "Net à payer", 0m, 2000m, null, ThirdPartyKind.None),
            new("436711", "TVA collectée", 0m, 190m, null, ThirdPartyKind.None),
            new("101", "Capital (équilibrage)", 0m, 3110m, null, ThirdPartyKind.None)
        };

        var entry = JournalEntry.Create(
            1, "JOD", new DateTime(2025, 12, 31), "Mini-jeu PCG historique",
            period.Id, true, "Test", Guid.NewGuid(), lines).Value;
        entry.SetAuditInfo("nct01-test");
        db.JournalEntries.Add(entry);
    }

    private static ChartOfAccount Acc(
        string number, string label, string? parent, AccountNatureType nature)
    {
        var created = ChartOfAccount.Create(
            number, label, number[0] - '0', parent, nature, isSystem: true);
        if (created.IsFailure)
            throw new InvalidOperationException($"{number}: {created.Error.Description}");
        created.Value.SetAuditInfo("nct01-test");
        return created.Value;
    }

    private static decimal SumDebit(IEnumerable<JournalEntryLine> lines, string account) =>
        lines.Where(l => l.AccountNumber == account).Sum(l => l.DebitAmount.Amount);

    private static decimal SumCredit(IEnumerable<JournalEntryLine> lines, string account) =>
        lines.Where(l => l.AccountNumber == account).Sum(l => l.CreditAmount.Amount);

    private static async Task<int> LogCountAsync(TenantDbContext db)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await db.Database.OpenConnectionAsync();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(1) FROM [dbo].[ChartOfAccountRemapLogs] WHERE [MapVersion] = N'nct01-v1'";
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private TenantDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(_connectionString)
            .Options);

    public void Dispose() => _sqlDb.Dispose();
}
