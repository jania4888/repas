using System.Text.RegularExpressions;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Verrouille le contrat de la migration tenant
/// <c>20261013100000_DropMonthlyDeclarationSettings_Tenant</c>, qui supprime la table du régime de
/// calcul de la déclaration mensuelle.
/// </summary>
/// <remarks>
/// C'est la seule opération <b>destructive</b> du retrait du calcul câblé. Ce qui est vérifié ici :
/// qu'elle est rejouable, qu'elle se défait (<c>Down</c> recrée la table à l'identique, pour que
/// l'image précédente redémarre), et que ses deux jumeaux SQL disent la même chose — l'un pose, et
/// l'autre défait, y compris la ligne d'historique.
/// </remarks>
public sealed class DropMonthlyDeclarationSettingsMigrationTests
{
    private const string MigrationId = "20261013100000_DropMonthlyDeclarationSettings_Tenant";

    /// <summary>Migration qui précède immédiatement celle-ci.</summary>
    private const string PreviousMigrationId = "20261012100000_AddLetteringIntegrityIndexes_Tenant";

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "..", }
            .Concat(segments)
            .ToArray()));

    private static string MigrationSourcePath() => RepoRelativePath(
        "src", "Backend", "FactuTrust.Infrastructure", "Migrations", "Tenant", $"{MigrationId}.cs");

    private static string TwinScriptPath() => RepoRelativePath(
        "docs", "runbooks", "sql", "DropMonthlyDeclarationSettings_Tenant.idempotent.sql");

    private static string RollbackScriptPath() => RepoRelativePath(
        "docs", "runbooks", "sql", "DropMonthlyDeclarationSettings_Tenant.rollback.sql");

    // ── Le texte de la migration ──────────────────────────────────────────────

    [Fact]
    public void La_suppression_est_gardee_et_se_defait_a_l_identique()
    {
        var source = File.ReadAllText(MigrationSourcePath());

        Assert.Contains($"[Migration(\"{MigrationId}\")]", source);
        Assert.Contains("[DbContext(typeof(TenantDbContext))]", source);

        var up = source[source.IndexOf("protected override void Up(", StringComparison.Ordinal)
                        ..source.IndexOf("protected override void Down(", StringComparison.Ordinal)];
        var down = source[source.IndexOf("protected override void Down(", StringComparison.Ordinal)..];

        // Rejouable : la suppression ne s'exécute que si la table est là.
        Assert.Contains("IF OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NOT NULL", up);
        Assert.Contains("DROP TABLE [dbo].[MonthlyDeclarationSettings]", up);

        // Le retour arrière recrée la table VIDE, colonne par colonne : c'est ce qui permet à
        // l'image précédente — qui la lit encore — de redémarrer.
        Assert.Contains("IF OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NULL", down);
        Assert.Contains("CREATE TABLE [dbo].[MonthlyDeclarationSettings]", down);
        foreach (var column in new[]
                 {
                     "[Mode] int NOT NULL",
                     "[ConfiguredSince] datetime2 NULL",
                     "[LastParityPeriodKey] int NOT NULL",
                     "[LastParityRunAt] datetime2 NULL",
                     "[LastParityMaxGapMillimes] bigint NOT NULL",
                     "[ParityCleanStreak] int NOT NULL",
                     "[ParityOverrideBy] nvarchar(256) NULL",
                     "[ParityOverrideReason] nvarchar(500) NULL",
                     "CONSTRAINT [PK_MonthlyDeclarationSettings] PRIMARY KEY ([Id])"
                 })
        {
            Assert.Contains(column, down);
        }
    }

    /// <summary>
    /// L'ordre compte : le rétro-remplissage de <c>CalculationOrigin</c> lit cette table, et doit
    /// donc passer avant sa suppression sur une base neuve.
    /// </summary>
    [Fact]
    public void L_identifiant_est_ordonne_apres_la_migration_precedente()
    {
        Assert.True(
            string.CompareOrdinal(MigrationId, PreviousMigrationId) > 0,
            $"{MigrationId} doit être ordonnée après {PreviousMigrationId}.");
        Assert.True(
            string.CompareOrdinal(MigrationId, "20260925100000_AddMonthlyDeclarationDocumentSources_Tenant") > 0,
            "La suppression doit suivre le rétro-remplissage de CalculationOrigin, qui lit cette table.");
    }

    // ── Les deux jumeaux SQL ──────────────────────────────────────────────────

    [Fact]
    public void Le_jumeau_supprime_la_table_et_enregistre_la_ligne_d_historique()
    {
        var script = File.ReadAllText(TwinScriptPath());

        Assert.Contains("IF OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NOT NULL", script);
        Assert.Contains("DROP TABLE [dbo].[MonthlyDeclarationSettings]", script);
        Assert.Contains($"WHERE [MigrationId] = N'{MigrationId}'", script);
        Assert.Contains($"VALUES (N'{MigrationId}', N'8.0.1')", script);
    }

    /// <summary>
    /// Le retour arrière recrée la table et <b>retire</b> la ligne d'historique : sans cela, l'image
    /// précédente tiendrait la migration pour appliquée, et la suivante ne la rejouerait jamais.
    /// </summary>
    [Fact]
    public void Le_jumeau_de_retour_arriere_recree_la_table_et_retire_la_ligne_d_historique()
    {
        var script = File.ReadAllText(RollbackScriptPath());

        Assert.Contains("CREATE TABLE [dbo].[MonthlyDeclarationSettings]", script);
        Assert.Contains("DELETE FROM [__EFMigrationsHistory]", script);
        Assert.Contains($"WHERE [MigrationId] = N'{MigrationId}'", script);
        Assert.DoesNotContain("INSERT INTO [__EFMigrationsHistory]", script);
    }

    // ── Contre un vrai SQL Server ─────────────────────────────────────────────

    /// <summary>
    /// Opt-in SQL Server réel (<c>FACTUTRUST_TEST_SQL_CONNECTION</c> ou LocalDB) : la table a bien
    /// disparu après migration, le jumeau rejoué reste inerte, et le retour arrière la ramène —
    /// vide, mais lisible par l'image précédente.
    /// </summary>
    [SkippableFact]
    public async Task La_table_disparait_puis_revient_par_le_retour_arriere()
    {
        using var db = new SqlTestDatabase(nameof(DropMonthlyDeclarationSettingsMigrationTests));
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

        Assert.Equal(0, await TableCountAsync(connection));

        // Le jumeau rejoué sur une base déjà migrée : ses gardes le rendent inerte.
        await RunScriptAsync(connection, await File.ReadAllTextAsync(TwinScriptPath()));
        Assert.Equal(0, await TableCountAsync(connection));
        Assert.Equal(1, await HistoryCountAsync(connection));

        // Retour arrière : la table revient, et la migration redevient à appliquer.
        await RunScriptAsync(connection, await File.ReadAllTextAsync(RollbackScriptPath()));
        Assert.Equal(1, await TableCountAsync(connection));
        Assert.Equal(0, await HistoryCountAsync(connection));
    }

    private static async Task RunScriptAsync(SqlConnection connection, string script)
    {
        foreach (var batch in Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(batch))
                continue;
            await using var command = new SqlCommand(batch, connection);
            await command.ExecuteNonQueryAsync();
        }
    }

    private static async Task<int> TableCountAsync(SqlConnection connection)
    {
        await using var command = new SqlCommand(
            "SELECT COUNT(*) FROM sys.tables WHERE name = N'MonthlyDeclarationSettings';", connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private static async Task<int> HistoryCountAsync(SqlConnection connection)
    {
        await using var command = new SqlCommand(
            $"SELECT COUNT(*) FROM [__EFMigrationsHistory] WHERE [MigrationId] = N'{MigrationId}';", connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }
}
