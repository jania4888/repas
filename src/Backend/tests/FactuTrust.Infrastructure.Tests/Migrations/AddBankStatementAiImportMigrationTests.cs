using FactuTrust.Infrastructure.Migrations.Tenant;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migrations;

/// <summary>
/// Verrouille le contrat de la migration de l'import IA de relevés bancaires.
///
/// <list type="number">
///   <item>Strictement additive : aucune table ni colonne existante modifiée, l'index paie de
///   <c>JournalEntries</c> intact.</item>
///   <item>Ne bloque jamais un tenant au démarrage : l'index d'idempotence est créé seulement
///   s'il ne peut pas échouer (aucun doublon) — jamais de <c>THROW</c>.</item>
///   <item>Rejouable : migration et script runbook passent deux fois de suite sur SQL Server.</item>
///   <item>Le runbook force <c>QUOTED_IDENTIFIER ON</c> (sinon Msg 1934 sous sqlcmd sur un index filtré).</item>
/// </list>
/// </summary>
public sealed class AddBankStatementAiImportMigrationTests : IDisposable
{
    private const string MigrationId = "20261001120000_AddBankStatementAiImport_Tenant";

    private readonly SqlTestDatabase _database = new(nameof(AddBankStatementAiImportMigrationTests));

    public void Dispose() => _database.Dispose();

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static string IdempotentScript()
    {
        var path = RepoRelativePath("docs", "runbooks", "sql", "AddBankStatementAiImport_Tenant.idempotent.sql");
        Assert.True(File.Exists(path), $"Fichier introuvable : {path}");
        return File.ReadAllText(path);
    }

    private static string UpSql() =>
        new AddBankStatementAiImport_Tenant().UpOperations.OfType<SqlOperation>().Single().Sql;

    private static string DownSql() =>
        new AddBankStatementAiImport_Tenant().DownOperations.OfType<SqlOperation>().Single().Sql;

    [Fact]
    public void Migration_carries_the_expected_identity()
    {
        var attribute = typeof(AddBankStatementAiImport_Tenant)
            .GetCustomAttributes(typeof(Microsoft.EntityFrameworkCore.Migrations.MigrationAttribute), false)
            .Cast<Microsoft.EntityFrameworkCore.Migrations.MigrationAttribute>()
            .Single();
        Assert.Equal(MigrationId, attribute.Id);
    }

    [Fact]
    public void Up_is_strictly_additive()
    {
        var up = UpSql();
        Assert.DoesNotContain("ALTER TABLE", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DROP ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("THROW", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("IX_JournalEntries_SourceEntityType_SourceEntityId", up, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE ", up, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Idempotency_index_is_filtered_on_the_new_source_type_only_and_guarded()
    {
        var up = UpSql();
        Assert.Contains("IX_JournalEntries_BankStatementLineSource", up, StringComparison.Ordinal);
        Assert.Contains("WHERE [IsReversed] = 0 AND [SourceEntityType] = N''BankStatementLine''", up, StringComparison.Ordinal);
        Assert.Contains("HAVING COUNT(*) > 1", up, StringComparison.Ordinal);
    }

    [Fact]
    public void Runbook_forces_quoted_identifier_and_records_the_history()
    {
        var script = IdempotentScript();
        Assert.Contains("SET QUOTED_IDENTIFIER ON;", script, StringComparison.Ordinal);
        Assert.Contains($"N''{MigrationId}''", script, StringComparison.Ordinal);
        // Référence à __EFMigrationsHistory compilée seulement si la table existe.
        Assert.Contains("EXEC(N'IF NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory]", script, StringComparison.Ordinal);
        Assert.Contains("IX_JournalEntries_BankStatementLineSource", script, StringComparison.Ordinal);
        Assert.DoesNotContain("THROW", script, StringComparison.OrdinalIgnoreCase);
    }

    [SkippableFact]
    public void Migration_and_runbook_replay_on_sql_server_and_create_the_expected_objects()
    {
        Skip.IfNot(_database.CanRun, "SQL Server indisponible : test SQL ignoré.");

        // Base créée depuis le modèle EF : on retire les objets de la migration pour la rejouer
        // sur une base « d'avant », deux fois de suite (idempotence), puis le runbook deux fois.
        Execute(DownSql());
        Execute(UpSql());
        Execute(UpSql());
        AssertObjectsExist();

        Execute(DownSql());
        foreach (var batch in SplitBatches(IdempotentScript()))
            Execute(batch);
        foreach (var batch in SplitBatches(IdempotentScript()))
            Execute(batch);
        AssertObjectsExist();
    }

    private void AssertObjectsExist()
    {
        foreach (var table in new[] { "BankStatementImportSessions", "BankPostingRules", "BankLabelClassifications" })
            Assert.Equal(1, Scalar($"SELECT COUNT(*) FROM sys.tables WHERE name = N'{table}'"));

        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.indexes
            WHERE name = N'IX_JournalEntries_BankStatementLineSource'
              AND is_unique = 1 AND has_filter = 1 AND [object_id] = OBJECT_ID(N'dbo.JournalEntries')
            """));
        // L'index paie existant n'a pas été touché.
        Assert.Equal(1, Scalar("""
            SELECT COUNT(*) FROM sys.indexes
            WHERE name = N'IX_JournalEntries_SourceEntityType_SourceEntityId' AND [object_id] = OBJECT_ID(N'dbo.JournalEntries')
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
