namespace FactuTrust.Application.Features.Studio.Common;

/// <summary>
/// Pure SQL builders for indexing a custom JSON field via a NON-persisted computed column + filtered
/// index on the shared <c>CustomRecords</c> table. All identifiers derive from a sanitized field key
/// (<see cref="StudioKey.IsValidShape"/>) and are bracket-quoted; the JSON path is a safe literal.
/// Statements are idempotent (<c>IF [NOT] EXISTS</c>). The <c>Add*</c>/<c>Create*</c> builders never
/// destroy data ; the <c>Drop*</c> builders (PR 3.1, changement de type de champ) only ever touch the
/// NON-persisted computed column/index — jamais <c>DataJson</c> — donc aucune donnée utilisateur n'est
/// perdue.
/// </summary>
public static class JsonIndexSql
{
    /// <summary>Computed column CAST length: bounds the index key (≤900 bytes &lt; 1700) so inserts never fail.</summary>
    public const int ValueMaxLength = 450;

    public static string ColumnName(string key) => "jx_" + key;
    public static string IndexName(string key) => "IX_CustomRecords_jx_" + key;

    /// <summary>Idempotent ALTER ADD of a non-persisted computed column. Caller MUST have validated the key.</summary>
    public static string AddColumnSql(string key)
    {
        if (!StudioKey.IsValidShape(key))
            throw new ArgumentException($"Invalid Studio key shape: '{key}'.", nameof(key));

        var col = SqlSchemaGuard.Quote(ColumnName(key));
        return
            $"IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[dbo].[CustomRecords]') AND [name] = N'{ColumnName(key)}') " +
            $"ALTER TABLE [dbo].[CustomRecords] ADD {col} AS CAST(JSON_VALUE([DataJson], '$.{key}') AS nvarchar({ValueMaxLength}));";
    }

    /// <summary>Idempotent filtered nonclustered index on the computed column. Caller MUST have validated the key.</summary>
    public static string CreateIndexSql(string key)
    {
        if (!StudioKey.IsValidShape(key))
            throw new ArgumentException($"Invalid Studio key shape: '{key}'.", nameof(key));

        var idx = SqlSchemaGuard.Quote(IndexName(key));
        var col = SqlSchemaGuard.Quote(ColumnName(key));
        return
            $"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'{IndexName(key)}' AND [object_id] = OBJECT_ID(N'[dbo].[CustomRecords]')) " +
            $"CREATE NONCLUSTERED INDEX {idx} ON [dbo].[CustomRecords] ([TenantId], [EntityDefinitionId], {col}) WHERE [IsDeleted] = 0;";
    }

    public static string ColumnExistsSql(string key)
    {
        if (!StudioKey.IsValidShape(key))
            throw new ArgumentException($"Invalid Studio key shape: '{key}'.", nameof(key));

        return $"SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[dbo].[CustomRecords]') AND [name] = N'{ColumnName(key)}'";
    }

    /// <summary>
    /// PR 3.1 : suppression idempotente de l'index filtré (avant la colonne, car l'index en dépend).
    /// Caller MUST have validated the key.
    /// </summary>
    public static string DropIndexSql(string key)
    {
        if (!StudioKey.IsValidShape(key))
            throw new ArgumentException($"Invalid Studio key shape: '{key}'.", nameof(key));

        var idx = SqlSchemaGuard.Quote(IndexName(key));
        return
            $"IF EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'{IndexName(key)}' AND [object_id] = OBJECT_ID(N'[dbo].[CustomRecords]')) " +
            $"DROP INDEX {idx} ON [dbo].[CustomRecords];";
    }

    /// <summary>
    /// PR 3.1 : suppression idempotente de la colonne calculée (appeler après <see cref="DropIndexSql"/>).
    /// Caller MUST have validated the key.
    /// </summary>
    public static string DropColumnSql(string key)
    {
        if (!StudioKey.IsValidShape(key))
            throw new ArgumentException($"Invalid Studio key shape: '{key}'.", nameof(key));

        var col = SqlSchemaGuard.Quote(ColumnName(key));
        return
            $"IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[dbo].[CustomRecords]') AND [name] = N'{ColumnName(key)}') " +
            $"ALTER TABLE [dbo].[CustomRecords] DROP COLUMN {col};";
    }
}
