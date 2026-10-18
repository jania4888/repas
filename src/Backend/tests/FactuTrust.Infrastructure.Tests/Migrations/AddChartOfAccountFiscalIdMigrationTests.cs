using FactuTrust.Infrastructure.Migrations.Tenant;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Verrouille le contrat de la migration du matricule fiscal sur les comptes auxiliaires
/// (plan « Matricule fiscal sur les comptes auxiliaires et rattachement à l'import de facture »).
///
/// <list type="number">
///   <item>Strictement additive : deux colonnes nullable sur <c>ChartOfAccounts</c>, aucune colonne
///   existante modifiée ou supprimée, aucune donnée réécrite.</item>
///   <item>Un index unique filtré sur (AccountType, FiscalIdNormalized), limité aux comptes
///   auxiliaires (WHERE FiscalIdNormalized IS NOT NULL AND IsAuxiliary = 1).</item>
///   <item>Ne bloque jamais un tenant au démarrage : colonnes gardées par <c>COL_LENGTH</c>, jamais
///   de <c>THROW</c>.</item>
///   <item>Rejouable : migration et script runbook passent deux fois de suite sur SQL Server.</item>
///   <item><c>Down</c> supprime l'index AVANT les colonnes (dépendance du filtre sur IsAuxiliary/
///   FiscalIdNormalized), sinon SQL Server refuse l'ALTER avec l'erreur 5074.</item>
/// </list>
/// </summary>
public sealed class AddChartOfAccountFiscalIdMigrationTests : IDisposable
{
    private const string MigrationId = "20261018100000_AddChartOfAccountFiscalId_Tenant";

    private readonly SqlTestDatabase _database = new(nameof(AddChartOfAccountFiscalIdMigrationTests));

    public void Dispose() => _database.Dispose();

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static string IdempotentScript()
    {
        var path = RepoRelativePath("docs", "runbooks", "sql", "AddChartOfAccountFiscalId_Tenant.idempotent.sql");
        Assert.True(File.Exists(path), $"Fichier introuvable : {path}");
        return File.ReadAllText(path);
    }

    private static string UpSql() =>
        new AddChartOfAccountFiscalId_Tenant().UpOperations.OfType<SqlOperation>().Single().Sql;

    private static string DownSql() =>
        new AddChartOfAccountFiscalId_Tenant().DownOperations.OfType<SqlOperation>().Single().Sql;

    [Fact]
    public void Migration_carries_the_expected_identity()
    {
        var attribute = typeof(AddChartOfAccountFiscalId_Tenant)
            .GetCustomAttributes(typeof(Microsoft.EntityFrameworkCore.Migrations.MigrationAttribute), false)
            .Cast<Microsoft.EntityFrameworkCore.Migrations.MigrationAttribute>()
            .Single();
        Assert.Equal(MigrationId, attribute.Id);
    }

    [Fact]
    public void Up_only_adds_guarded_nullable_columns_and_a_filtered_unique_index()
    {
        var up = UpSql();

        Assert.Contains("COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalId') IS NULL", up, StringComparison.Ordinal);
        Assert.Contains("ADD [FiscalId] nvarchar(20) NULL", up, StringComparison.Ordinal);
        Assert.Contains("COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalIdNormalized') IS NULL", up, StringComparison.Ordinal);
        Assert.Contains("ADD [FiscalIdNormalized] nvarchar(20) NULL", up, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE NONCLUSTERED INDEX [IX_ChartOfAccounts_AccountType_FiscalIdNormalized]", up, StringComparison.Ordinal);
        Assert.Contains("WHERE [FiscalIdNormalized] IS NOT NULL AND [IsAuxiliary] = 1", up, StringComparison.Ordinal);

        Assert.DoesNotContain("DROP ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ALTER COLUMN", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("THROW", up, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Down_drops_the_index_before_the_columns_it_depends_on()
    {
        var down = DownSql();

        var indexDropPosition = down.IndexOf(
            "DROP INDEX [IX_ChartOfAccounts_AccountType_FiscalIdNormalized]", StringComparison.Ordinal);
        var normalizedDropPosition = down.IndexOf(
            "DROP COLUMN [FiscalIdNormalized]", StringComparison.Ordinal);
        var fiscalIdDropPosition = down.IndexOf(
            "DROP COLUMN [FiscalId]", StringComparison.Ordinal);

        Assert.True(indexDropPosition >= 0, "L'index doit être supprimé dans Down().");
        Assert.True(indexDropPosition < normalizedDropPosition,
            "L'index (filtré sur FiscalIdNormalized) doit être supprimé avant la colonne, sinon SQL Server renvoie l'erreur 5074.");
        Assert.True(normalizedDropPosition < fiscalIdDropPosition || fiscalIdDropPosition < normalizedDropPosition,
            "Les deux colonnes doivent être supprimées.");
        Assert.True(fiscalIdDropPosition >= 0);
    }

    [Fact]
    public void Runbook_is_the_twin_of_the_migration_and_records_the_history()
    {
        var script = IdempotentScript();
        Assert.Contains("SET QUOTED_IDENTIFIER ON;", script, StringComparison.Ordinal);
        Assert.Contains($"N''{MigrationId}''", script, StringComparison.Ordinal);
        Assert.Contains("EXEC(N'IF NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory]", script, StringComparison.Ordinal);
        Assert.Contains("ADD [FiscalId] nvarchar(20) NULL", script, StringComparison.Ordinal);
        Assert.Contains("ADD [FiscalIdNormalized] nvarchar(20) NULL", script, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE NONCLUSTERED INDEX [IX_ChartOfAccounts_AccountType_FiscalIdNormalized]", script, StringComparison.Ordinal);
        Assert.DoesNotContain("THROW", script, StringComparison.OrdinalIgnoreCase);
    }

    [SkippableFact]
    public void Migration_and_runbook_replay_on_sql_server_and_create_the_expected_columns_and_index()
    {
        Skip.IfNot(_database.CanRun, "SQL Server indisponible : test SQL ignoré.");

        Execute(DownSql());
        Execute(DownSql());
        AssertColumnsAndIndexAbsent();
        Execute(UpSql());
        Execute(UpSql());
        AssertColumnsAndIndexExist();

        Execute(DownSql());
        foreach (var batch in SplitBatches(IdempotentScript()))
            Execute(batch);
        AssertColumnsAndIndexExist();

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
        AssertColumnsAndIndexExist();
        Assert.Equal(1, Scalar($"SELECT COUNT(*) FROM [dbo].[__EFMigrationsHistory] WHERE [MigrationId] = N'{MigrationId}'"));
    }

    private void AssertColumnsAndIndexAbsent()
    {
        Assert.Equal(0, Scalar("""
            SELECT COUNT(*) FROM sys.columns
            WHERE [object_id] = OBJECT_ID(N'dbo.ChartOfAccounts') AND [name] IN (N'FiscalId', N'FiscalIdNormalized')
            """));
        Assert.Equal(0, Scalar("""
            SELECT COUNT(*) FROM sys.indexes
            WHERE name = N'IX_ChartOfAccounts_AccountType_FiscalIdNormalized' AND object_id = OBJECT_ID(N'dbo.ChartOfAccounts')
            """));
    }

    private void AssertColumnsAndIndexExist()
    {
        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.columns c
            JOIN sys.types t ON t.user_type_id = c.user_type_id
            WHERE c.[object_id] = OBJECT_ID(N'dbo.ChartOfAccounts') AND c.[name] = N'FiscalId'
              AND t.[name] = N'nvarchar' AND c.max_length = 40 AND c.is_nullable = 1
            """));
        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.columns c
            JOIN sys.types t ON t.user_type_id = c.user_type_id
            WHERE c.[object_id] = OBJECT_ID(N'dbo.ChartOfAccounts') AND c.[name] = N'FiscalIdNormalized'
              AND t.[name] = N'nvarchar' AND c.max_length = 40 AND c.is_nullable = 1
            """));
        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.indexes
            WHERE name = N'IX_ChartOfAccounts_AccountType_FiscalIdNormalized'
              AND object_id = OBJECT_ID(N'dbo.ChartOfAccounts') AND is_unique = 1 AND has_filter = 1
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
