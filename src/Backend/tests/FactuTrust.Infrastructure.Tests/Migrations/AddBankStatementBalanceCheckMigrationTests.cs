using FactuTrust.Infrastructure.Migrations.Tenant;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Verrouille le contrat de la migration de traçabilité du contrôle de solde (D4).
///
/// <list type="number">
///   <item>Strictement additive : deux colonnes ajoutées à <c>BankStatements</c> (nullable / avec
///   défaut), aucune colonne existante modifiée ou supprimée, aucune donnée réécrite, aucun index.</item>
///   <item>Ne bloque jamais un tenant au démarrage : colonnes gardées par <c>COL_LENGTH</c>, jamais
///   de <c>THROW</c>.</item>
///   <item>Rejouable : migration et script runbook passent deux fois de suite sur SQL Server.</item>
///   <item>Le runbook force <c>QUOTED_IDENTIFIER ON</c> et enregistre l'historique EF.</item>
/// </list>
/// </summary>
public sealed class AddBankStatementBalanceCheckMigrationTests : IDisposable
{
    private const string MigrationId = "20261005120000_AddBankStatementBalanceCheck_Tenant";

    private readonly SqlTestDatabase _database = new(nameof(AddBankStatementBalanceCheckMigrationTests));

    public void Dispose() => _database.Dispose();

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static string IdempotentScript()
    {
        var path = RepoRelativePath("docs", "runbooks", "sql", "AddBankStatementBalanceCheck_Tenant.idempotent.sql");
        Assert.True(File.Exists(path), $"Fichier introuvable : {path}");
        return File.ReadAllText(path);
    }

    private static string UpSql() =>
        new AddBankStatementBalanceCheck_Tenant().UpOperations.OfType<SqlOperation>().Single().Sql;

    private static string DownSql() =>
        new AddBankStatementBalanceCheck_Tenant().DownOperations.OfType<SqlOperation>().Single().Sql;

    [Fact]
    public void Migration_carries_the_expected_identity()
    {
        var attribute = typeof(AddBankStatementBalanceCheck_Tenant)
            .GetCustomAttributes(typeof(Microsoft.EntityFrameworkCore.Migrations.MigrationAttribute), false)
            .Cast<Microsoft.EntityFrameworkCore.Migrations.MigrationAttribute>()
            .Single();
        Assert.Equal(MigrationId, attribute.Id);
    }

    [Fact]
    public void Up_only_adds_guarded_nullable_or_defaulted_columns()
    {
        var up = UpSql();

        // Seules des additions de colonnes : chaque ALTER TABLE est un ADD, aucune suppression ni réécriture.
        var alters = System.Text.RegularExpressions.Regex.Matches(up, @"ALTER TABLE \[dbo\]\.\[BankStatements\] (\w+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        Assert.Equal(2, alters.Count);
        Assert.All(alters, m => Assert.Equal("ADD", m.Groups[1].Value, StringComparer.OrdinalIgnoreCase));
        Assert.DoesNotContain("DROP ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ALTER COLUMN", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("CREATE INDEX", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("THROW", up, StringComparison.OrdinalIgnoreCase);

        // Colonnes gardées (rejouables) et jamais bloquantes pour les relevés existants.
        Assert.Contains("COL_LENGTH(N'dbo.BankStatements', N'BalanceDifference') IS NULL", up, StringComparison.Ordinal);
        Assert.Contains("ADD [BalanceDifference] decimal(18,3) NULL", up, StringComparison.Ordinal);
        Assert.Contains("COL_LENGTH(N'dbo.BankStatements', N'BalanceAcknowledged') IS NULL", up, StringComparison.Ordinal);
        Assert.Contains("ADD [BalanceAcknowledged] bit NOT NULL", up, StringComparison.Ordinal);
        Assert.Contains("DEFAULT 0", up, StringComparison.Ordinal);
    }

    [Fact]
    public void Runbook_is_the_twin_of_the_migration_and_records_the_history()
    {
        var script = IdempotentScript();
        Assert.Contains("SET QUOTED_IDENTIFIER ON;", script, StringComparison.Ordinal);
        Assert.Contains($"N''{MigrationId}''", script, StringComparison.Ordinal);
        // Référence à __EFMigrationsHistory compilée seulement si la table existe.
        Assert.Contains("EXEC(N'IF NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory]", script, StringComparison.Ordinal);
        Assert.Contains("ADD [BalanceDifference] decimal(18,3) NULL", script, StringComparison.Ordinal);
        Assert.Contains("ADD [BalanceAcknowledged] bit NOT NULL", script, StringComparison.Ordinal);
        Assert.Contains("[DF_BankStatements_BalanceAcknowledged] DEFAULT 0", script, StringComparison.Ordinal);
        Assert.DoesNotContain("DROP ", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("THROW", script, StringComparison.OrdinalIgnoreCase);
    }

    [SkippableFact]
    public void Migration_and_runbook_replay_on_sql_server_and_create_the_expected_columns()
    {
        Skip.IfNot(_database.CanRun, "SQL Server indisponible : test SQL ignoré.");

        // Base créée depuis le modèle EF : on retire les colonnes pour rejouer la migration sur une
        // base « d'avant », deux fois de suite (idempotence), puis le runbook deux fois.
        Execute(DownSql());
        Execute(DownSql());
        AssertColumnsAbsent();
        Execute(UpSql());
        Execute(UpSql());
        AssertColumnsExist();

        // Base « EnsureCreated » sans table d'historique : le runbook doit passer (référence compilée
        // derrière la garde), puis, une fois la table présente, n'inscrire la migration qu'une fois.
        Execute(DownSql());
        foreach (var batch in SplitBatches(IdempotentScript()))
            Execute(batch);
        AssertColumnsExist();

        Execute(DownSql());
        Execute("""
            IF OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U') IS NULL
                CREATE TABLE [dbo].[__EFMigrationsHistory] (
                    [MigrationId] nvarchar(150) NOT NULL CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY,
                    [ProductVersion] nvarchar(32) NOT NULL);
            """);
        foreach (var batch in SplitBatches(IdempotentScript()))
            Execute(batch);
        foreach (var batch in SplitBatches(IdempotentScript()))
            Execute(batch);
        AssertColumnsExist();
        Assert.Equal(1, Scalar($"SELECT COUNT(*) FROM [dbo].[__EFMigrationsHistory] WHERE [MigrationId] = N'{MigrationId}'"));
    }

    private void AssertColumnsAbsent()
    {
        Assert.Equal(0, Scalar("""
            SELECT COUNT(*) FROM sys.columns
            WHERE [object_id] = OBJECT_ID(N'dbo.BankStatements') AND [name] IN (N'BalanceDifference', N'BalanceAcknowledged')
            """));
    }

    private void AssertColumnsExist()
    {
        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.columns c
            JOIN sys.types t ON t.user_type_id = c.user_type_id
            WHERE c.[object_id] = OBJECT_ID(N'dbo.BankStatements') AND c.[name] = N'BalanceDifference'
              AND t.[name] = N'decimal' AND c.[precision] = 18 AND c.[scale] = 3 AND c.is_nullable = 1
            """));
        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.columns c
            JOIN sys.types t ON t.user_type_id = c.user_type_id
            WHERE c.[object_id] = OBJECT_ID(N'dbo.BankStatements') AND c.[name] = N'BalanceAcknowledged'
              AND t.[name] = N'bit' AND c.is_nullable = 0
            """));
        // Une seule contrainte par défaut sur la colonne (rejeu sans doublon).
        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.default_constraints dc
            JOIN sys.columns c ON c.[object_id] = dc.parent_object_id AND c.column_id = dc.parent_column_id
            WHERE dc.parent_object_id = OBJECT_ID(N'dbo.BankStatements') AND c.[name] = N'BalanceAcknowledged'
            """));
    }

    private void Execute(string sql)
    {
        using var connection = new SqlConnection(_database.ConnectionString);
        connection.Open();
        using var command = new SqlCommand(sql, connection);
        command.ExecuteNonQuery();
    }

    private int Scalar(string sql)
    {
        using var connection = new SqlConnection(_database.ConnectionString);
        connection.Open();
        using var command = new SqlCommand(sql, connection);
        return Convert.ToInt32(command.ExecuteScalar());
    }

    private static IEnumerable<string> SplitBatches(string script) =>
        System.Text.RegularExpressions.Regex.Split(script, @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline)
            .Select(b => b.Trim())
            .Where(b => b.Length > 0);
}
