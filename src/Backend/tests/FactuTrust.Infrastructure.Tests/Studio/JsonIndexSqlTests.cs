using FactuTrust.Application.Features.Studio.Common;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class JsonIndexSqlTests
{
    [Fact]
    public void Names_use_jx_and_index_prefixes()
    {
        Assert.Equal("jx_status", JsonIndexSql.ColumnName("status"));
        Assert.Equal("IX_CustomRecords_jx_status", JsonIndexSql.IndexName("status"));
    }

    [Fact]
    public void Cast_length_bounds_index_key()
    {
        Assert.Equal(450, JsonIndexSql.ValueMaxLength);
    }

    [Fact]
    public void AddColumn_is_idempotent_nonpersisted_cast()
    {
        var sql = JsonIndexSql.AddColumnSql("email");
        Assert.Contains("IF NOT EXISTS", sql);
        Assert.Contains("sys.columns", sql);
        Assert.Contains("ALTER TABLE [dbo].[CustomRecords] ADD [jx_email]", sql);
        Assert.Contains("CAST(JSON_VALUE([DataJson], '$.email') AS nvarchar(450))", sql);
        Assert.DoesNotContain("PERSISTED", sql); // non-persisted by design
    }

    [Fact]
    public void CreateIndex_is_idempotent_filtered_and_bracketed()
    {
        var sql = JsonIndexSql.CreateIndexSql("code");
        Assert.Contains("IF NOT EXISTS", sql);
        Assert.Contains("sys.indexes", sql);
        Assert.Contains("CREATE NONCLUSTERED INDEX [IX_CustomRecords_jx_code]", sql);
        Assert.Contains("ON [dbo].[CustomRecords] ([TenantId], [EntityDefinitionId], [jx_code])", sql);
        Assert.Contains("WHERE [IsDeleted] = 0", sql);
    }

    [Fact]
    public void ColumnExists_targets_sys_columns()
    {
        var sql = JsonIndexSql.ColumnExistsSql("ref_no");
        Assert.Contains("sys.columns", sql);
        Assert.Contains("N'jx_ref_no'", sql);
    }

    // --- CWE-89 hardening: keys are interpolated into raw SQL identifiers/literals, so every
    // entry point must reject a key that does not match StudioKey.IsValidShape before building SQL. ---

    [Theory]
    [InlineData("email'; DROP TABLE CustomRecords; --")]
    [InlineData("email]")]
    [InlineData("Email")] // uppercase not allowed by StudioKey shape
    [InlineData("1email")] // must start with a letter
    [InlineData("")]
    [InlineData(" ")]
    public void AddColumnSql_rejects_invalid_key_shape(string key)
    {
        Assert.Throws<ArgumentException>(() => JsonIndexSql.AddColumnSql(key));
    }

    [Theory]
    [InlineData("email'; DROP TABLE CustomRecords; --")]
    [InlineData("email]")]
    [InlineData("Email")]
    public void CreateIndexSql_rejects_invalid_key_shape(string key)
    {
        Assert.Throws<ArgumentException>(() => JsonIndexSql.CreateIndexSql(key));
    }

    [Theory]
    [InlineData("email'; DROP TABLE CustomRecords; --")]
    [InlineData("email]")]
    [InlineData("Email")]
    public void ColumnExistsSql_rejects_invalid_key_shape(string key)
    {
        Assert.Throws<ArgumentException>(() => JsonIndexSql.ColumnExistsSql(key));
    }

    [Fact]
    public void Valid_keys_still_produce_expected_sql()
    {
        Assert.NotNull(JsonIndexSql.AddColumnSql("valid_key_1"));
        Assert.NotNull(JsonIndexSql.CreateIndexSql("valid_key_1"));
        Assert.NotNull(JsonIndexSql.ColumnExistsSql("valid_key_1"));
    }

    // ---- PR 3.1 : suppression (changement de type de champ) ----

    [Fact]
    public void DropIndex_is_idempotent_and_targets_the_same_index_name()
    {
        var sql = JsonIndexSql.DropIndexSql("statut");
        Assert.Contains("IF EXISTS", sql);
        Assert.Contains("sys.indexes", sql);
        Assert.Contains("DROP INDEX [IX_CustomRecords_jx_statut] ON [dbo].[CustomRecords]", sql);
    }

    [Fact]
    public void DropColumn_is_idempotent_and_targets_the_same_column_name()
    {
        var sql = JsonIndexSql.DropColumnSql("statut");
        Assert.Contains("IF EXISTS", sql);
        Assert.Contains("sys.columns", sql);
        Assert.Contains("ALTER TABLE [dbo].[CustomRecords] DROP COLUMN [jx_statut]", sql);
    }

    [Theory]
    [InlineData("email'; DROP TABLE CustomRecords; --")]
    [InlineData("email]")]
    [InlineData("Email")]
    public void DropIndexSql_rejects_invalid_key_shape(string key)
    {
        Assert.Throws<ArgumentException>(() => JsonIndexSql.DropIndexSql(key));
    }

    [Theory]
    [InlineData("email'; DROP TABLE CustomRecords; --")]
    [InlineData("email]")]
    [InlineData("Email")]
    public void DropColumnSql_rejects_invalid_key_shape(string key)
    {
        Assert.Throws<ArgumentException>(() => JsonIndexSql.DropColumnSql(key));
    }
}
