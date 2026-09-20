using System.Text.RegularExpressions;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Studio IA 4.7★2 (S14 / U7) : verrouille le contrat de la migration tenant
/// <c>20260918100000_AddAuditLogsEntityHistoryIndex_Tenant</c> (PR #171, 4.7h2) — index non unique
/// <c>IX_AuditLogs_EntityHistory (EntityType, EntityId, CreatedAt)</c> derrière des gardes idempotentes,
/// jumeau SQL équivalent qui inscrit la ligne <c>__EFMigrationsHistory</c> (convention des jumeaux, R37),
/// snapshot et modèle EF à jour. Assertions sur le TEXTE SOURCE (aucun serveur SQL requis) + un contrôle
/// du modèle EF en mémoire + un fait opt-in contre SQL Server réel (motif <c>AddStudioWorkflowsMigrationTests</c>).
/// </summary>
public sealed class AddAuditLogsEntityHistoryIndexMigrationTests
{
    private const string MigrationId = "20260918100000_AddAuditLogsEntityHistoryIndex_Tenant";

    /// <summary>Migration qui précède immédiatement celle-ci (PR 4.1, 4.5c1).</summary>
    private const string PreviousMigrationId = "20260912150000_AddStudioWorkflows_Tenant";

    private const string IndexName = "IX_AuditLogs_EntityHistory";

    private const string ExistsGuard =
        "(SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLogs_EntityHistory' AND object_id = OBJECT_ID(N'[dbo].[AuditLogs]'))";

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static string MigrationSourcePath() => RepoRelativePath(
        "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", $"{MigrationId}.cs");

    private static string TwinScriptPath() => RepoRelativePath(
        "docs", "runbooks", "sql", "AddAuditLogsEntityHistoryIndex_Tenant.idempotent.sql");

    [Fact]
    public void Migration_creates_the_index_behind_an_existence_guard_and_drops_it_behind_another()
    {
        var sourcePath = MigrationSourcePath();
        Assert.True(File.Exists(sourcePath), $"Migration source not found: {sourcePath}");
        var source = File.ReadAllText(sourcePath);

        Assert.Contains($"[Migration(\"{MigrationId}\")]", source);
        Assert.Contains("[DbContext(typeof(TenantDbContext))]", source);

        // Up : garde IF NOT EXISTS puis CREATE NONCLUSTERED INDEX sur les 3 colonnes, dans cet ordre.
        Assert.Contains($"IF NOT EXISTS {ExistsGuard}", source);
        Assert.Contains($"CREATE NONCLUSTERED INDEX [{IndexName}]", source);
        Assert.Contains("ON [dbo].[AuditLogs] ([EntityType], [EntityId], [CreatedAt]);", source);
        Assert.DoesNotContain("CREATE UNIQUE", source);

        // Down : garde IF EXISTS puis DROP INDEX (un rollback rejoué ne doit pas échouer).
        Assert.Contains($"IF EXISTS {ExistsGuard}", source);
        Assert.Contains($"DROP INDEX [{IndexName}] ON [dbo].[AuditLogs];", source);

        // Additif pur : aucune écriture de données, aucune autre instruction DDL.
        Assert.DoesNotContain("UPDATE ", source);
        Assert.DoesNotContain("DELETE ", source);
        Assert.DoesNotContain("ALTER TABLE", source);
        Assert.DoesNotContain("CREATE TABLE", source);
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
        // Pas d'assertion « la plus récente » : le programme peut ajouter d'autres migrations tenant.
    }

    [Fact]
    public void Idempotent_script_matches_the_migration_and_registers_the_history_row()
    {
        var scriptPath = TwinScriptPath();
        Assert.True(File.Exists(scriptPath), $"Script SQL not found: {scriptPath}");
        var script = File.ReadAllText(scriptPath);

        // Même garde et même DDL que la migration (jumeau ≡ Up).
        Assert.Contains($"IF NOT EXISTS {ExistsGuard}", script);
        Assert.Contains($"CREATE NONCLUSTERED INDEX [{IndexName}]", script);
        Assert.Contains("ON [dbo].[AuditLogs] ([EntityType], [EntityId], [CreatedAt]);", script);
        Assert.DoesNotContain("DROP INDEX", script);

        // Convention des jumeaux (R37 / U7) : la ligne d'historique EF est inscrite, gardée, pour que
        // MigrateAsync ne rejoue pas la migration après une application manuelle du script.
        Assert.Contains($"WHERE [MigrationId] = N'{MigrationId}'", script);
        Assert.Contains($"VALUES (N'{MigrationId}', N'8.0.1')", script);
        Assert.True(
            script.IndexOf("CREATE NONCLUSTERED INDEX", StringComparison.Ordinal)
                < script.IndexOf("INSERT INTO [__EFMigrationsHistory]", StringComparison.Ordinal),
            "l'index doit être créé avant l'inscription de la ligne d'historique");
    }

    [Fact]
    public void Model_snapshot_declares_the_three_column_index_with_its_database_name()
    {
        var snapshotPath = RepoRelativePath(
            "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", "TenantDbContextModelSnapshot.cs");
        Assert.True(File.Exists(snapshotPath), $"Snapshot not found: {snapshotPath}");
        var snapshot = File.ReadAllText(snapshotPath);

        var entityStart = snapshot.IndexOf(
            "modelBuilder.Entity(\"FactuTrust.Domain.Entities.AuditLog\"", StringComparison.Ordinal);
        Assert.True(entityStart >= 0, "AuditLog entity block not found in the snapshot.");
        var entityEnd = snapshot.IndexOf("modelBuilder.Entity(", entityStart + 1, StringComparison.Ordinal);
        Assert.True(entityEnd > entityStart, "AuditLog block boundary not found.");
        var block = snapshot[entityStart..entityEnd];

        Assert.Contains("b.HasIndex(\"EntityType\", \"EntityId\", \"CreatedAt\")", block);
        Assert.Contains($".HasDatabaseName(\"{IndexName}\")", block);
        Assert.Contains("b.ToTable(\"AuditLogs\"", block);
    }

    [Fact]
    public void Runtime_model_maps_the_non_unique_index_on_the_three_columns()
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase($"audit-history-index-model-{Guid.NewGuid():N}")
            .Options;
        using var context = new TenantDbContext(options);

        var entityType = context.Model.FindEntityType(typeof(AuditLog));
        Assert.NotNull(entityType);
        Assert.Equal("AuditLogs", entityType!.GetTableName());

        var index = entityType.GetIndexes().SingleOrDefault(i => i.GetDatabaseName() == IndexName);
        Assert.NotNull(index);
        Assert.False(index!.IsUnique);
        Assert.Equal(
            new[] { nameof(AuditLog.EntityType), nameof(AuditLog.EntityId), nameof(AuditLog.CreatedAt) },
            index.Properties.Select(p => p.Name).ToArray());
    }

    /// <summary>
    /// Opt-in SQL Server réel (<c>FACTUTRUST_TEST_SQL_CONNECTION</c> ou LocalDB) : applique toutes les
    /// migrations deux fois (le second passage est un no-op EF), puis rejoue le jumeau SQL sur la base
    /// migrée — ses gardes doivent le rendre inerte (index déjà là, ligne d'historique déjà là) — et
    /// vérifie qu'il n'existe qu'un index et qu'une ligne d'historique.
    /// </summary>
    [SkippableFact]
    public async Task Migration_applies_twice_on_sql_server_and_the_sql_twin_is_inert_afterwards()
    {
        using var db = new SqlTestDatabase(nameof(AddAuditLogsEntityHistoryIndexMigrationTests));
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

        // Le jumeau, batch par batch (séparateur GO), contre une base déjà migrée : aucune erreur.
        var script = await File.ReadAllTextAsync(TwinScriptPath());
        foreach (var batch in Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(batch))
                continue;
            await using var command = new SqlCommand(batch, connection);
            await command.ExecuteNonQueryAsync();
        }

        await using (var indexCount = new SqlCommand($"""
SELECT COUNT(*) FROM sys.indexes
WHERE object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND name = N'{IndexName}' AND is_unique = 0;
""", connection))
        {
            Assert.Equal(1, Convert.ToInt32(await indexCount.ExecuteScalarAsync()));
        }

        await using (var columns = new SqlCommand($"""
SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND i.name = N'{IndexName}' AND ic.is_included_column = 0;
""", connection))
        {
            Assert.Equal("EntityType,EntityId,CreatedAt", (string)(await columns.ExecuteScalarAsync())!);
        }

        await using (var historyCount = new SqlCommand(
            $"SELECT COUNT(*) FROM [__EFMigrationsHistory] WHERE [MigrationId] = N'{MigrationId}';",
            connection))
        {
            Assert.Equal(1, Convert.ToInt32(await historyCount.ExecuteScalarAsync()));
        }
    }
}
