using System.Text.RegularExpressions;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Verrouille le contrat de la migration tenant
/// <c>20261012100000_AddLetteringIntegrityIndexes_Tenant</c> (refonte de l'écran de lettrage, plan
/// §6 item 5 / §15, Annexe A §4.1) : cinq index posés derrière des gardes idempotentes, ET — pour
/// les deux index UNIQUE — derrière une garde de doublons supplémentaire qui ne doit JAMAIS faire
/// échouer la migration ni bloquer <c>TenantMigrationGuard</c> au démarrage d'un tenant non assaini.
/// Assertions sur le TEXTE SOURCE (aucun serveur SQL requis) + un contrôle du modèle EF en mémoire +
/// des faits opt-in contre SQL Server réel (motif <c>AddAuditLogsEntityHistoryIndexMigrationTests</c>),
/// dont un scénario de doublons qui doit laisser la base sans exception et sans index unique posé.
/// </summary>
public sealed class AddLetteringIntegrityIndexesMigrationTests
{
    private const string MigrationId = "20261012100000_AddLetteringIntegrityIndexes_Tenant";

    /// <summary>Migration qui précède immédiatement celle-ci.</summary>
    private const string PreviousMigrationId = "20261009120000_AllowBankAccountProjectionWithoutRib_Tenant";

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "..", }
            .Concat(segments)
            .ToArray()));

    private static string MigrationSourcePath() => RepoRelativePath(
        "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", $"{MigrationId}.cs");

    private static string TwinScriptPath() => RepoRelativePath(
        "docs", "runbooks", "sql", "AddLetteringIntegrityIndexes_Tenant.idempotent.sql");

    [Fact]
    public void Migration_guards_both_unique_indexes_behind_a_duplicate_check_before_creating_them()
    {
        var sourcePath = MigrationSourcePath();
        Assert.True(File.Exists(sourcePath), $"Migration source not found: {sourcePath}");
        var source = File.ReadAllText(sourcePath);

        Assert.Contains($"[Migration(\"{MigrationId}\")]", source);
        Assert.Contains("[DbContext(typeof(TenantDbContext))]", source);

        // IX_LetteringGroups_Code : la détection de doublons de Code précède la création de l'index
        // unique — sinon une base avec des doublons préexistants ferait planter la migration.
        var codeDuplicateCheckIndex = source.IndexOf(
            "SELECT 1 FROM [dbo].[LetteringGroups] GROUP BY [Code] HAVING COUNT(*) > 1", StringComparison.Ordinal);
        var codeCreateIndex = source.IndexOf(
            "CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroups_Code]", StringComparison.Ordinal);
        Assert.True(codeDuplicateCheckIndex >= 0, "Duplicate-Code guard not found.");
        Assert.True(codeCreateIndex > codeDuplicateCheckIndex,
            "The duplicate-Code guard must precede the CREATE UNIQUE INDEX statement.");

        // IX_LetteringGroupMembers_JournalEntryLineId : même garde, ET le DROP de l'index non-unique
        // existant doit être dans la même branche ELSE que le CREATE — jamais drop-then-fail-to-create.
        var memberDuplicateCheckIndex = source.IndexOf(
            "SELECT 1 FROM [dbo].[LetteringGroupMembers] GROUP BY [JournalEntryLineId] HAVING COUNT(*) > 1",
            StringComparison.Ordinal);
        var memberDropIndex = source.IndexOf(
            "DROP INDEX [IX_LetteringGroupMembers_JournalEntryLineId] ON [dbo].[LetteringGroupMembers];",
            StringComparison.Ordinal);
        var memberCreateIndex = source.IndexOf(
            "CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroupMembers_JournalEntryLineId]", StringComparison.Ordinal);
        Assert.True(memberDuplicateCheckIndex >= 0, "Duplicate-JournalEntryLineId guard not found.");
        Assert.True(memberDropIndex > memberDuplicateCheckIndex,
            "The duplicate-JournalEntryLineId guard must precede the DROP INDEX statement.");
        Assert.True(memberCreateIndex > memberDropIndex,
            "The CREATE UNIQUE INDEX statement must follow the DROP INDEX statement.");

        // Les deux messages PRINT existent (visibilité en PRODUCTION — pas de silence absolu).
        Assert.Contains("PRINT 'AddLetteringIntegrityIndexes_Tenant : des doublons de Code existent", source);
        Assert.Contains(
            "PRINT 'AddLetteringIntegrityIndexes_Tenant : des lignes d''écriture appartiennent déjà",
            source);

        // Les 3 index non-unique restent inconditionnels (pas de garde de doublons nécessaire).
        Assert.Contains("CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_AccountNumber_LetteringCode]", source);
        Assert.Contains("CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId]", source);
        Assert.Contains("CREATE NONCLUSTERED INDEX [IX_JournalEntries_EntryDate]", source);

        // Additif pur : aucune écriture de données, aucune autre instruction DDL destructrice.
        Assert.DoesNotContain("UPDATE ", source);
        Assert.DoesNotContain("DELETE ", source);
        Assert.DoesNotContain("ALTER TABLE", source);
        Assert.DoesNotContain("CREATE TABLE", source);

        // Down reste complet et inconditionnel (un rollback restaure toujours l'état précédent).
        Assert.Contains("protected override void Down(MigrationBuilder migrationBuilder)", source);
        var downIndex = source.IndexOf("protected override void Down", StringComparison.Ordinal);
        var downBody = source[downIndex..];
        Assert.Contains("DROP INDEX [IX_LetteringGroups_Code] ON [dbo].[LetteringGroups];", downBody);
        Assert.Contains(
            "CREATE NONCLUSTERED INDEX [IX_LetteringGroupMembers_JournalEntryLineId]\n        ON [dbo].[LetteringGroupMembers] ([JournalEntryLineId]);",
            downBody);
    }

    [Fact]
    public void Migration_id_is_present_and_ordered_after_its_predecessor()
    {
        var folder = RepoRelativePath("src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant");
        var ids = Directory.EnumerateFiles(folder, "2026*_Tenant.cs")
            .Select(Path.GetFileNameWithoutExtension)
            .Where(n => n is not null && !n.EndsWith(".Designer", StringComparison.Ordinal))
            .Select(n => n!)
            .ToList();

        Assert.Contains(MigrationId, ids);
        Assert.Contains(PreviousMigrationId, ids);
        Assert.True(string.CompareOrdinal(MigrationId, PreviousMigrationId) > 0,
            $"{MigrationId} doit être ordonnée après {PreviousMigrationId}.");
    }

    [Fact]
    public void Idempotent_script_mirrors_the_duplicate_guards_and_registers_the_history_row()
    {
        var scriptPath = TwinScriptPath();
        Assert.True(File.Exists(scriptPath), $"Script SQL not found: {scriptPath}");
        var script = File.ReadAllText(scriptPath);

        Assert.Contains("SELECT 1 FROM [dbo].[LetteringGroups] GROUP BY [Code] HAVING COUNT(*) > 1", script);
        Assert.Contains(
            "SELECT 1 FROM [dbo].[LetteringGroupMembers] GROUP BY [JournalEntryLineId] HAVING COUNT(*) > 1",
            script);
        Assert.Contains("CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroups_Code]", script);
        Assert.Contains("CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroupMembers_JournalEntryLineId]", script);

        Assert.Contains($"WHERE [MigrationId] = N'{MigrationId}'", script);
        Assert.Contains($"VALUES (N'{MigrationId}', N'8.0.1')", script);
    }

    [Fact]
    public void Model_snapshot_declares_the_two_unique_indexes_and_the_three_other_lettering_indexes()
    {
        var snapshotPath = RepoRelativePath(
            "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", "TenantDbContextModelSnapshot.cs");
        Assert.True(File.Exists(snapshotPath), $"Snapshot not found: {snapshotPath}");
        var snapshot = File.ReadAllText(snapshotPath);

        AssertEntityBlockContains(snapshot, "FactuTrust.Domain.Entities.LetteringGroup",
            "b.HasIndex(\"Code\")", ".IsUnique();");
        AssertEntityBlockContains(snapshot, "FactuTrust.Domain.Entities.LetteringGroupMember",
            "b.HasIndex(\"JournalEntryLineId\")", ".IsUnique();");
        AssertEntityBlockContains(snapshot, "FactuTrust.Domain.Entities.JournalEntryLine",
            "b.HasIndex(\"AccountNumber\", \"LetteringCode\")",
            ".HasDatabaseName(\"IX_JournalEntryLines_AccountNumber_LetteringCode\");");
        AssertEntityBlockContains(snapshot, "FactuTrust.Domain.Entities.JournalEntryLine",
            "b.HasIndex(\"ThirdPartyKind\", \"ThirdPartyId\")",
            ".HasDatabaseName(\"IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId\");");
        AssertEntityBlockContains(snapshot, "FactuTrust.Domain.Entities.JournalEntry",
            "b.HasIndex(\"EntryDate\")", ".HasDatabaseName(\"IX_JournalEntries_EntryDate\");");
    }

    private static void AssertEntityBlockContains(string snapshot, string entityName, params string[] fragments)
    {
        var entityStart = snapshot.IndexOf($"modelBuilder.Entity(\"{entityName}\"", StringComparison.Ordinal);
        Assert.True(entityStart >= 0, $"{entityName} entity block not found in the snapshot.");
        var entityEnd = snapshot.IndexOf("modelBuilder.Entity(", entityStart + 1, StringComparison.Ordinal);
        Assert.True(entityEnd > entityStart, $"{entityName} block boundary not found.");
        var block = snapshot[entityStart..entityEnd];
        foreach (var fragment in fragments)
            Assert.Contains(fragment, block);
    }

    [Fact]
    public void Runtime_model_maps_both_unique_indexes()
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase($"lettering-integrity-index-model-{Guid.NewGuid():N}")
            .Options;
        using var context = new TenantDbContext(options);

        var groupType = context.Model.FindEntityType(typeof(LetteringGroup));
        Assert.NotNull(groupType);
        var codeIndex = groupType!.GetIndexes().SingleOrDefault(i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { nameof(LetteringGroup.Code) }));
        Assert.NotNull(codeIndex);
        Assert.True(codeIndex!.IsUnique);

        var memberType = context.Model.FindEntityType(typeof(LetteringGroupMember));
        Assert.NotNull(memberType);
        var lineIdIndex = memberType!.GetIndexes().SingleOrDefault(i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { nameof(LetteringGroupMember.JournalEntryLineId) }));
        Assert.NotNull(lineIdIndex);
        Assert.True(lineIdIndex!.IsUnique);
    }

    /// <summary>
    /// Opt-in SQL Server réel (<c>FACTUTRUST_TEST_SQL_CONNECTION</c> ou LocalDB) : applique toutes les
    /// migrations deux fois (le second passage est un no-op EF), puis rejoue le jumeau SQL — ses gardes
    /// doivent le rendre inerte — et vérifie que les deux index unique existent avec is_unique = 1.
    /// </summary>
    [SkippableFact]
    public async Task Migration_applies_twice_on_sql_server_and_both_unique_indexes_exist()
    {
        using var db = new SqlTestDatabase(nameof(AddLetteringIntegrityIndexesMigrationTests) + "_Clean");
        Skip.If(!db.CanRun, "SQL Server/LocalDB indisponible dans ce bac à sable.");

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(db.ConnectionString!)
            .Options;

        await using (var context = new TenantDbContext(options))
        {
            await context.Database.EnsureDeletedAsync();
            await context.Database.MigrateAsync();
            await context.Database.MigrateAsync();
        }

        await using var connection = new SqlConnection(db.ConnectionString);
        await connection.OpenAsync();

        var script = await File.ReadAllTextAsync(TwinScriptPath());
        foreach (var batch in Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(batch))
                continue;
            await using var command = new SqlCommand(batch, connection);
            await command.ExecuteNonQueryAsync();
        }

        await using (var groupsIndex = new SqlCommand("""
SELECT COUNT(*) FROM sys.indexes
WHERE object_id = OBJECT_ID(N'[dbo].[LetteringGroups]') AND name = N'IX_LetteringGroups_Code' AND is_unique = 1;
""", connection))
        {
            Assert.Equal(1, Convert.ToInt32(await groupsIndex.ExecuteScalarAsync()));
        }

        await using (var membersIndex = new SqlCommand("""
SELECT COUNT(*) FROM sys.indexes
WHERE object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]') AND name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND is_unique = 1;
""", connection))
        {
            Assert.Equal(1, Convert.ToInt32(await membersIndex.ExecuteScalarAsync()));
        }

        await using (var historyCount = new SqlCommand(
            $"SELECT COUNT(*) FROM [__EFMigrationsHistory] WHERE [MigrationId] = N'{MigrationId}';",
            connection))
        {
            Assert.Equal(1, Convert.ToInt32(await historyCount.ExecuteScalarAsync()));
        }
    }

    /// <summary>
    /// Opt-in SQL Server réel : scénario de doublons PRÉEXISTANTS (plan §6 item 5) — un tenant qui a
    /// déjà deux groupes de lettrage avec le même <c>Code</c> et deux lignes qui appartiennent déjà au
    /// même <c>JournalEntryLineId</c> (contournement du bug corrigé par <c>LetteringService</c>,
    /// simulé ici en désactivant temporairement l'intégrité applicative pour insérer l'état invalide).
    /// La migration NE DOIT PAS lever d'exception et NE DOIT PAS poser les index unique ; l'index
    /// non-unique préexistant sur <c>JournalEntryLineId</c> doit rester en place.
    /// </summary>
    [SkippableFact]
    public async Task Migration_with_preexisting_duplicates_does_not_throw_and_skips_the_unique_indexes()
    {
        using var db = new SqlTestDatabase(nameof(AddLetteringIntegrityIndexesMigrationTests) + "_Duplicates");
        Skip.If(!db.CanRun, "SQL Server/LocalDB indisponible dans ce bac à sable.");

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(db.ConnectionString!)
            .Options;

        // Migre jusqu'à (et y compris) la migration précédente seulement, pour pouvoir insérer les
        // doublons AVANT que cette migration-ci ne pose ses gardes.
        await using (var context = new TenantDbContext(options))
        {
            await context.Database.EnsureDeletedAsync();
            var migrator = ((IInfrastructure<IServiceProvider>)context).Instance.GetRequiredService<IMigrator>();
            await migrator!.MigrateAsync(PreviousMigrationId);
        }

        var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
        var entry = JournalEntry.Create(
            1, "JOD", new DateTime(2026, 8, 1), "Test doublons intégrité",
            period.Id, false, "Manual", Guid.NewGuid(),
            new[]
            {
                new JournalLineInput("401", "Fournisseur A", 50m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("401", "Fournisseur B", 50m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("512", "Banque", 0m, 100m, null, ThirdPartyKind.None),
            }).Value;
        entry.SetAuditInfo("test", false);

        await using (var seed = new TenantDbContext(options))
        {
            seed.AccountingPeriods.Add(period);
            seed.JournalEntries.Add(entry);
            await seed.SaveChangesAsync();
        }

        var lineIds = entry.Lines.Where(l => l.AccountNumber == "401").Select(l => l.Id).ToArray();
        var bankLineId = entry.Lines.Single(l => l.AccountNumber == "512").Id;

        // Doublons posés via les méthodes du domaine, pas de l'intégrité DB (aucun index unique
        // n'existe encore à ce stade) : deux LetteringGroups avec le même Code N00001, et le MÊME
        // JournalEntryLineId (lineIds[0]) membre de deux groupes distincts — l'état historique que
        // cette migration doit tolérer sans jamais lever.
        var group1 = LetteringGroup.Create("N00001", "401", Money.Create(100m), new[] { lineIds[0], bankLineId }).Value;
        var group2 = LetteringGroup.Create("N00001", "401", Money.Create(100m), new[] { lineIds[0], lineIds[1] }).Value;

        await using (var seed = new TenantDbContext(options))
        {
            seed.LetteringGroups.AddRange(group1, group2);
            await seed.SaveChangesAsync();
        }

        // La migration ne doit PAS lever — c'est le cœur du test.
        await using (var context = new TenantDbContext(options))
        {
            var migrator = ((IInfrastructure<IServiceProvider>)context).Instance.GetRequiredService<IMigrator>();
            var exception = await Record.ExceptionAsync(() => migrator!.MigrateAsync(MigrationId));
            Assert.Null(exception);
        }

        await using var connection = new SqlConnection(db.ConnectionString);
        await connection.OpenAsync();

        await using (var groupsUniqueIndex = new SqlCommand("""
SELECT COUNT(*) FROM sys.indexes
WHERE object_id = OBJECT_ID(N'[dbo].[LetteringGroups]') AND name = N'IX_LetteringGroups_Code';
""", connection))
        {
            Assert.Equal(0, Convert.ToInt32(await groupsUniqueIndex.ExecuteScalarAsync()));
        }

        await using (var membersIndex = new SqlCommand("""
SELECT is_unique FROM sys.indexes
WHERE object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]') AND name = N'IX_LetteringGroupMembers_JournalEntryLineId';
""", connection))
        {
            var isUnique = await membersIndex.ExecuteScalarAsync();
            Assert.NotNull(isUnique);
            Assert.Equal(0, Convert.ToInt32(isUnique));
        }
    }
}
