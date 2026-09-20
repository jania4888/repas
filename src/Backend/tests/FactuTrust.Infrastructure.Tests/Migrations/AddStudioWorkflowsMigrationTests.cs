using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Studio IA — PR 4.1 : verrouille le modèle EF des quatre tables de workflows Studio
/// (<c>StudioWorkflowDefinitions</c>, <c>StudioWorkflowInstances</c>, <c>StudioWorkflowStepRuns</c>,
/// <c>StudioWorkflowApprovals</c>) : noms de tables, enums stockés en int, jetons de concurrence,
/// filtre de suppression logique + clé unique filtrée sur les définitions, les 9 index aux noms
/// figés (annexe A-41 §0.4) et l'absence totale de clé étrangère (tables autonomes).
/// Assertions sur le modèle EF en mémoire (aucun serveur SQL requis), complétées en 4.1b2 par les
/// assertions sur le TEXTE SOURCE de la migration manuelle
/// <c>20260912150000_AddStudioWorkflows_Tenant</c>, du snapshot et du jumeau SQL idempotent, plus un
/// double <c>MigrateAsync</c> contre SQL Server réel (opt-in via <c>FACTUTRUST_TEST_SQL_CONNECTION</c>).
/// </summary>
public sealed class AddStudioWorkflowsMigrationTests
{
    private const string MigrationId = "20260912150000_AddStudioWorkflows_Tenant";

    /// <summary>Migration qui précède immédiatement celle-ci (PR 2.3).</summary>
    private const string PreviousMigrationId = "20260912140000_AddStudioRecordViews_Tenant";

    private static readonly string[] WorkflowTableNames =
    {
        "StudioWorkflowDefinitions",
        "StudioWorkflowInstances",
        "StudioWorkflowStepRuns",
        "StudioWorkflowApprovals",
    };

    /// <summary>Noms d'index figés par l'annexe A-41 §0.4 — toute modification est un acte délibéré.</summary>
    private static readonly string[] FrozenIndexNames =
    {
        "UX_StudioWorkflowDefinitions_Tenant_Entity_Key",
        "IX_StudioWorkflowDefinitions_Tenant_Entity_Trigger_Active",
        "IX_StudioWorkflowInstances_Tenant_Status_DueAt",
        "IX_StudioWorkflowInstances_Tenant_Record_StartedAt",
        "IX_StudioWorkflowInstances_Tenant_Definition_StartedAt",
        "IX_StudioWorkflowStepRuns_Tenant_Instance_Step",
        "IX_StudioWorkflowApprovals_Tenant_AssigneeUser_Status",
        "IX_StudioWorkflowApprovals_Tenant_AssigneeRole_Status",
        "IX_StudioWorkflowApprovals_Tenant_Instance",
    };

    private static readonly Type[] WorkflowEntityTypes =
    {
        typeof(StudioWorkflowDefinition),
        typeof(StudioWorkflowInstance),
        typeof(StudioWorkflowStepRun),
        typeof(StudioWorkflowApproval),
    };

    private static TenantDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase($"studio-workflows-model-{Guid.NewGuid():N}")
            .Options;
        return new TenantDbContext(options);
    }

    [Fact]
    public void Runtime_model_maps_the_four_workflow_tables_with_expected_names()
    {
        using var context = CreateInMemoryContext();

        var definition = context.Model.FindEntityType(typeof(StudioWorkflowDefinition));
        var instance = context.Model.FindEntityType(typeof(StudioWorkflowInstance));
        var stepRun = context.Model.FindEntityType(typeof(StudioWorkflowStepRun));
        var approval = context.Model.FindEntityType(typeof(StudioWorkflowApproval));

        Assert.NotNull(definition);
        Assert.NotNull(instance);
        Assert.NotNull(stepRun);
        Assert.NotNull(approval);
        Assert.Equal("StudioWorkflowDefinitions", definition!.GetTableName());
        Assert.Equal("StudioWorkflowInstances", instance!.GetTableName());
        Assert.Equal("StudioWorkflowStepRuns", stepRun!.GetTableName());
        Assert.Equal("StudioWorkflowApprovals", approval!.GetTableName());
    }

    [Fact]
    public void Definition_has_soft_delete_filter_and_filtered_unique_key()
    {
        using var context = CreateInMemoryContext();

        var entityType = context.Model.FindEntityType(typeof(StudioWorkflowDefinition));
        Assert.NotNull(entityType);

        // Filtre global IsDeleted : aucune requête n'expose une définition supprimée.
        Assert.NotNull(entityType!.GetQueryFilter());

        // Index unique filtré (TenantId, EntityDefinitionId, Key) parmi les non supprimées.
        var tenantId = entityType.FindProperty(nameof(StudioWorkflowDefinition.TenantId))!;
        var entityDefId = entityType.FindProperty(nameof(StudioWorkflowDefinition.EntityDefinitionId))!;
        var key = entityType.FindProperty(nameof(StudioWorkflowDefinition.Key))!;
        var uniqueIndex = entityType.GetIndexes().Single(ix =>
            ix.IsUnique
            && ix.Properties.Count == 3
            && ix.Properties[0] == tenantId
            && ix.Properties[1] == entityDefId
            && ix.Properties[2] == key);

        Assert.Equal("[IsDeleted] = 0", uniqueIndex.GetFilter());
        Assert.Equal("UX_StudioWorkflowDefinitions_Tenant_Entity_Key", uniqueIndex.GetDatabaseName());
    }

    [Fact]
    public void Enums_are_stored_as_int()
    {
        using var context = CreateInMemoryContext();

        Assert.Equal(typeof(int), ProviderClrType<StudioWorkflowDefinition>(context, nameof(StudioWorkflowDefinition.Trigger)));
        Assert.Equal(typeof(int), ProviderClrType<StudioWorkflowInstance>(context, nameof(StudioWorkflowInstance.TriggerKind)));
        Assert.Equal(typeof(int), ProviderClrType<StudioWorkflowInstance>(context, nameof(StudioWorkflowInstance.Status)));
        Assert.Equal(typeof(int), ProviderClrType<StudioWorkflowStepRun>(context, nameof(StudioWorkflowStepRun.Status)));
        Assert.Equal(typeof(int), ProviderClrType<StudioWorkflowApproval>(context, nameof(StudioWorkflowApproval.Status)));
    }

    [Fact]
    public void Row_versions_are_concurrency_tokens()
    {
        using var context = CreateInMemoryContext();

        // La table des exécutions d'étapes est append-only : pas de RowVersion.
        AssertRowVersionIsConcurrencyToken<StudioWorkflowDefinition>(context);
        AssertRowVersionIsConcurrencyToken<StudioWorkflowInstance>(context);
        AssertRowVersionIsConcurrencyToken<StudioWorkflowApproval>(context);
    }

    [Fact]
    public void Nine_indexes_carry_the_frozen_names()
    {
        using var context = CreateInMemoryContext();

        var actual = WorkflowEntityTypes
            .SelectMany(t => context.Model.FindEntityType(t)!.GetIndexes())
            .Select(ix => ix.GetDatabaseName())
            .ToList();

        Assert.Equal(FrozenIndexNames.Length, actual.Count);
        Assert.Equal(
            FrozenIndexNames.OrderBy(n => n, StringComparer.Ordinal),
            actual.OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void No_foreign_key_is_declared()
    {
        using var context = CreateInMemoryContext();

        foreach (var entityType in WorkflowEntityTypes)
        {
            Assert.Empty(context.Model.FindEntityType(entityType)!.GetForeignKeys());
        }
    }

    // ---- 4.1b2 : migration manuelle, snapshot, jumeau SQL ----

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var index = 0;
        while ((index = haystack.IndexOf(needle, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += needle.Length;
        }

        return count;
    }

    [Fact]
    public void Migration_creates_the_four_tables_and_nine_indexes_behind_existence_guards()
    {
        var sourcePath = RepoRelativePath(
            "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", $"{MigrationId}.cs");

        Assert.True(File.Exists(sourcePath), $"Migration source not found: {sourcePath}");

        var source = File.ReadAllText(sourcePath);

        Assert.Contains($"[Migration(\"{MigrationId}\")]", source);
        Assert.Contains("[DbContext(typeof(TenantDbContext))]", source);

        // 4 tables, chacune derrière sa garde d'existence.
        foreach (var table in WorkflowTableNames)
        {
            Assert.Contains($"IF OBJECT_ID(N'[dbo].[{table}]', N'U') IS NULL", source);
            Assert.Contains($"CREATE TABLE [dbo].[{table}]", source);
            Assert.Contains($"CONSTRAINT [PK_{table}] PRIMARY KEY ([Id])", source);
        }

        // 9 index aux noms figés, chacun derrière sa garde sys.indexes.
        foreach (var indexName in FrozenIndexNames)
        {
            Assert.Contains(
                $"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'{indexName}'",
                source);
        }

        Assert.Contains(
            "CREATE UNIQUE INDEX [UX_StudioWorkflowDefinitions_Tenant_Entity_Key]",
            source);
        Assert.Contains("WHERE [IsDeleted] = 0", source);

        // Pré-requis S3 (job de reprise 4.2) : échéance, bail, rappel et jetons de concurrence.
        Assert.Contains("[DueAt] datetime2 NULL", source);
        Assert.Contains("[LeasedAt] datetime2 NULL", source);
        Assert.Contains("[LastRemindedAt] datetime2 NULL", source);
        Assert.Equal(3, CountOccurrences(source, "[RowVersion] rowversion NOT NULL"));

        // Tables autonomes : aucune relation déclarée, aucune modification de table existante.
        Assert.DoesNotContain("FOREIGN KEY", source);
        Assert.DoesNotContain("ALTER TABLE", source);

        // Down gardé : un rollback rejoué ne doit pas échouer (ordre inverse de la création).
        Assert.Equal(4, CountOccurrences(source, "DROP TABLE IF EXISTS [dbo].[StudioWorkflow"));
        Assert.Contains("DROP TABLE IF EXISTS [dbo].[StudioWorkflowApprovals]", source);
        Assert.Contains("DROP TABLE IF EXISTS [dbo].[StudioWorkflowStepRuns]", source);
        Assert.Contains("DROP TABLE IF EXISTS [dbo].[StudioWorkflowInstances]", source);
        Assert.Contains("DROP TABLE IF EXISTS [dbo].[StudioWorkflowDefinitions]", source);
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
        // EF applique les migrations par ordre lexicographique de l'id : la nôtre suit strictement
        // celle de la PR 2.3. PAS d'assertion « la plus récente » : la pile 4.2 en ajoutera d'autres.
        Assert.True(string.CompareOrdinal(MigrationId, PreviousMigrationId) > 0,
            $"{MigrationId} doit être ordonnée après {PreviousMigrationId}.");
    }

    [Fact]
    public void Idempotent_script_matches_the_migration_and_registers_the_history_row()
    {
        var scriptPath = RepoRelativePath(
            "docs", "runbooks", "sql", "AddStudioWorkflows_Tenant.idempotent.sql");

        Assert.True(File.Exists(scriptPath), $"Script SQL not found: {scriptPath}");

        var script = File.ReadAllText(scriptPath);

        Assert.Equal(4, CountOccurrences(script, "CREATE TABLE [dbo].[StudioWorkflow"));
        foreach (var table in WorkflowTableNames)
        {
            Assert.Contains($"IF OBJECT_ID(N'[dbo].[{table}]', N'U') IS NULL", script);
        }

        foreach (var indexName in FrozenIndexNames)
        {
            Assert.Contains(indexName, script);
        }

        Assert.Contains($"WHERE [MigrationId] = N'{MigrationId}'", script);
        Assert.Contains($"VALUES (N'{MigrationId}', N'8.0.1')", script);

        // Chaque bloc gardé est isolé dans son propre lot (garde + 4 tables + 9 index + historique).
        var goCount = script.Split('\n').Count(line => line.TrimEnd('\r') == "GO");
        Assert.True(goCount >= 5, $"Le jumeau doit comporter au moins 5 lots GO (trouvé : {goCount}).");
    }

    [Fact]
    public void Model_snapshot_declares_the_four_entities_and_their_indexes()
    {
        var snapshotPath = RepoRelativePath(
            "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", "TenantDbContextModelSnapshot.cs");

        Assert.True(File.Exists(snapshotPath), $"Snapshot not found: {snapshotPath}");

        var snapshot = File.ReadAllText(snapshotPath);

        var blockStart = snapshot.IndexOf(
            "modelBuilder.Entity(\"FactuTrust.Domain.Entities.Studio.Workflows.StudioWorkflowApproval\"",
            StringComparison.Ordinal);
        Assert.True(blockStart >= 0, "StudioWorkflowApproval entity block not found in the snapshot.");

        var blockEnd = snapshot.IndexOf(
            "modelBuilder.Entity(\"FactuTrust.Domain.Entities.Supplier\"",
            StringComparison.Ordinal);
        Assert.True(blockEnd > blockStart, "Workflow entity blocks boundary not found.");
        var block = snapshot[blockStart..blockEnd];

        Assert.Equal(4, CountOccurrences(block, "modelBuilder.Entity(\"FactuTrust.Domain.Entities.Studio.Workflows."));
        Assert.Contains("modelBuilder.Entity(\"FactuTrust.Domain.Entities.Studio.Workflows.StudioWorkflowDefinition\"", block);
        Assert.Contains("modelBuilder.Entity(\"FactuTrust.Domain.Entities.Studio.Workflows.StudioWorkflowInstance\"", block);
        Assert.Contains("modelBuilder.Entity(\"FactuTrust.Domain.Entities.Studio.Workflows.StudioWorkflowStepRun\"", block);

        foreach (var indexName in FrozenIndexNames)
        {
            Assert.Contains($"HasDatabaseName(\"{indexName}\")", block);
        }

        Assert.Contains(".HasFilter(\"[IsDeleted] = 0\")", block);

        // Jetons de concurrence : définitions, instances et approbations (StepRuns est append-only).
        Assert.Equal(3, CountOccurrences(block, "HasColumnType(\"rowversion\")"));

        // Pré-requis S3 (job de reprise 4.2) figé dans le snapshot.
        Assert.Contains("b.Property<DateTime?>(\"DueAt\")", block);
        Assert.Contains("b.Property<DateTime?>(\"LeasedAt\")", block);
        Assert.Contains("b.Property<DateTime?>(\"LastRemindedAt\")", block);
    }

    /// <summary>
    /// Exige un vrai SQL Server (<c>FACTUTRUST_TEST_SQL_CONNECTION</c> ; repli LocalDB) : applique
    /// la migration deux fois via le migrateur EF — le second appel est un no-op EF documenté (rien
    /// de pendant), ce qui prouve que le SQL gardé ne rejoue jamais contre une base déjà migrée —
    /// puis vérifie les 9 index et l'unicité de la ligne d'historique.
    /// </summary>
    [SkippableFact]
    public async Task Migration_applies_twice_on_sql_server()
    {
        using var db = new SqlTestDatabase(nameof(AddStudioWorkflowsMigrationTests));
        Skip.If(!db.CanRun, "SQL Server/LocalDB indisponible dans ce bac à sable.");

        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(db.ConnectionString!)
            .Options;

        await using (var context = new TenantDbContext(options))
        {
            // SqlTestDatabase a provisionné la base via EnsureCreated (schéma du modèle courant, sans
            // historique EF) : on repart d'une base vide pour passer par le VRAI chemin des migrations,
            // comme le provisionnement de production (TenantDatabaseProvisioner → MigrateAsync).
            await context.Database.EnsureDeletedAsync();
            await context.Database.MigrateAsync();
            await context.Database.MigrateAsync();
        }

        await using var connection = new SqlConnection(db.ConnectionString);
        await connection.OpenAsync();

        await using (var indexCount = new SqlCommand("""
SELECT COUNT(*) FROM sys.indexes
WHERE object_id IN (
    OBJECT_ID(N'[dbo].[StudioWorkflowDefinitions]'),
    OBJECT_ID(N'[dbo].[StudioWorkflowInstances]'),
    OBJECT_ID(N'[dbo].[StudioWorkflowStepRuns]'),
    OBJECT_ID(N'[dbo].[StudioWorkflowApprovals]'))
  AND (name LIKE N'IX_StudioWorkflow%' OR name LIKE N'UX_StudioWorkflow%');
""", connection))
        {
            Assert.Equal(9, Convert.ToInt32(await indexCount.ExecuteScalarAsync()));
        }

        await using (var historyCount = new SqlCommand(
            $"SELECT COUNT(*) FROM [__EFMigrationsHistory] WHERE [MigrationId] = N'{MigrationId}';",
            connection))
        {
            Assert.Equal(1, Convert.ToInt32(await historyCount.ExecuteScalarAsync()));
        }
    }

    private static Type? ProviderClrType<TEntity>(TenantDbContext context, string propertyName)
    {
        var entityType = context.Model.FindEntityType(typeof(TEntity));
        Assert.NotNull(entityType);
        var property = entityType!.FindProperty(propertyName);
        Assert.NotNull(property);
        return property!.GetProviderClrType();
    }

    private static void AssertRowVersionIsConcurrencyToken<TEntity>(TenantDbContext context)
    {
        var entityType = context.Model.FindEntityType(typeof(TEntity));
        Assert.NotNull(entityType);
        var property = entityType!.FindProperty(nameof(StudioWorkflowDefinition.RowVersion));
        Assert.NotNull(property);
        Assert.True(
            property!.IsConcurrencyToken,
            $"{typeof(TEntity).Name}.RowVersion doit être un jeton de concurrence.");
    }
}
