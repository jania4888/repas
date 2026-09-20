using System.Data;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using FactuTrust.Infrastructure.Repositories;

namespace FactuTrust.Infrastructure.Repositories.Studio;

public sealed class CustomRecordRepository : ICustomRecordRepository
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IJsonIndexManager _jsonIndex;

    public CustomRecordRepository(ITenantDbContextFactory contextFactory, IJsonIndexManager jsonIndex)
    {
        _contextFactory = contextFactory;
        _jsonIndex = jsonIndex;
    }

    public async Task<CustomRecord?> GetAsync(Guid tenantId, Guid entityDefinitionId, Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.CustomRecords
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.EntityDefinitionId == entityDefinitionId && r.Id == id, cancellationToken);
    }

    public async Task<(IReadOnlyList<CustomRecord> Items, int TotalCount)> ListAsync(
        Guid tenantId, Guid entityDefinitionId, string? search, int page, int pageSize,
        string? filterField = null, string? filterValue = null, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        IQueryable<CustomRecord> query = context.CustomRecords;

        if (!string.IsNullOrWhiteSpace(filterField))
        {
            // Defensive re-check (the handler validates against the entity's active fields): a key that is
            // not a sanitized Studio key is NEVER embedded in SQL — the filter yields an empty page rather
            // than silently degrading to an unfiltered scan.
            if (!StudioKey.IsValidShape(filterField))
                return (Array.Empty<CustomRecord>(), 0);

            var value = filterValue ?? string.Empty;
            var useIndex = value.Length <= JsonIndexSql.ValueMaxLength
                && await _jsonIndex.IndexedColumnExistsAsync(tenantId, filterField, cancellationToken);

            // Raw base query: the JSON path is a validated literal, the value is ALWAYS a DbParameter ({0}).
            // Composed LINQ (tenant/entity/search/order/page) is appended by EF as an outer query, and the
            // soft-delete global filter still applies. The string is built by concatenation on purpose
            // (no interpolation → no EF1002 false positive).
            query = context.CustomRecords.FromSqlRaw(
                "SELECT * FROM [dbo].[CustomRecords] WHERE " + BuildFieldPredicate(filterField, useIndex, "{0}"),
                value);
        }

        query = query.Where(r => r.TenantId == tenantId && r.EntityDefinitionId == entityDefinitionId);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            // MVP full-text-ish search over the JSON document; replaced by indexed columns in the hardening phase.
            query = query.Where(r => EF.Functions.Like(r.DataJson, $"%{term}%"));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, total);
    }

    public async Task<int> CountAsync(Guid tenantId, Guid entityDefinitionId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.CustomRecords
            .CountAsync(r => r.TenantId == tenantId && r.EntityDefinitionId == entityDefinitionId, cancellationToken);
    }

    public async Task<IReadOnlyList<CustomRecord>> GetAllForReportAsync(Guid tenantId, Guid entityDefinitionId, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.CustomRecords
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.EntityDefinitionId == entityDefinitionId)
            .OrderByDescending(r => r.CreatedAt)
            .Take(max)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> ExistsWithFieldValueAsync(
        Guid tenantId, Guid entityDefinitionId, string fieldKey, string value, Guid? excludeId, CancellationToken cancellationToken = default)
    {
        // fieldKey is sanitized (^[a-z][a-z0-9_]{1,63}$); validate again before embedding it in the JSON path.
        if (!StudioKey.IsValidShape(fieldKey))
            return false;

        await using var context = _contextFactory.CreateContext();
        var conn = context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        var exclude = excludeId.HasValue ? " AND Id <> @x" : string.Empty;

        // When the computed-column index exists AND the value fits the indexed length, seek the index
        // ([jx_<key>] = @v) and verify exactly with JSON_VALUE (guards against the rare CAST truncation
        // collision). Otherwise fall back to the always-correct JSON_VALUE scan.
        var useIndex = value.Length <= JsonIndexSql.ValueMaxLength
            && await _jsonIndex.IndexedColumnExistsAsync(tenantId, fieldKey, cancellationToken);
        var predicate = BuildFieldPredicate(fieldKey, useIndex, "@v");

        cmd.CommandText =
            "SELECT TOP 1 1 FROM [dbo].[CustomRecords] " +
            "WHERE TenantId = @t AND EntityDefinitionId = @e AND IsDeleted = 0 " +
            $"AND {predicate}{exclude}";

        AddParam(cmd, "@t", tenantId);
        AddParam(cmd, "@e", entityDefinitionId);
        AddParam(cmd, "@v", value);
        if (excludeId.HasValue) AddParam(cmd, "@x", excludeId.Value);

        var result = await cmd.ExecuteScalarAsync(cancellationToken);
        return result is not null && result != DBNull.Value;
    }

    public async Task<bool> ExistsWithFieldPairAsync(
        Guid tenantId, Guid entityDefinitionId, string fieldKeyA, string valueA, string fieldKeyB, string valueB,
        Guid? excludeId, CancellationToken cancellationToken = default)
    {
        // Same guard as ExistsWithFieldValueAsync: both keys are re-validated before touching SQL.
        if (!StudioKey.IsValidShape(fieldKeyA) || !StudioKey.IsValidShape(fieldKeyB)
            || string.Equals(fieldKeyA, fieldKeyB, StringComparison.Ordinal))
            return false;

        await using var context = _contextFactory.CreateContext();
        var conn = context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        var exclude = excludeId.HasValue ? " AND Id <> @x" : string.Empty;

        var useIndexA = valueA.Length <= JsonIndexSql.ValueMaxLength
            && await _jsonIndex.IndexedColumnExistsAsync(tenantId, fieldKeyA, cancellationToken);
        var useIndexB = valueB.Length <= JsonIndexSql.ValueMaxLength
            && await _jsonIndex.IndexedColumnExistsAsync(tenantId, fieldKeyB, cancellationToken);

        cmd.CommandText =
            "SELECT TOP 1 1 FROM [dbo].[CustomRecords] " +
            "WHERE TenantId = @t AND EntityDefinitionId = @e AND IsDeleted = 0 " +
            $"AND {BuildFieldPredicate(fieldKeyA, useIndexA, "@a")} " +
            $"AND {BuildFieldPredicate(fieldKeyB, useIndexB, "@b")}{exclude}";

        AddParam(cmd, "@t", tenantId);
        AddParam(cmd, "@e", entityDefinitionId);
        AddParam(cmd, "@a", valueA);
        AddParam(cmd, "@b", valueB);
        if (excludeId.HasValue) AddParam(cmd, "@x", excludeId.Value);

        var result = await cmd.ExecuteScalarAsync(cancellationToken);
        return result is not null && result != DBNull.Value;
    }

    /// <summary>
    /// <c>JSON_VALUE(DataJson, '$.&lt;key&gt;') = &lt;param&gt;</c>, prefixed by an index seek on the
    /// computed column <c>[jx_&lt;key&gt;] = &lt;param&gt;</c> when it exists. The key MUST already be
    /// validated by <see cref="StudioKey.IsValidShape"/>; the parameter placeholder is never a value.
    /// </summary>
    private static string BuildFieldPredicate(string fieldKey, bool useIndex, string parameter)
    {
        var jsonPredicate = "JSON_VALUE(DataJson, '$." + fieldKey + "') = " + parameter;
        return useIndex
            ? SqlSchemaGuard.Quote(JsonIndexSql.ColumnName(fieldKey)) + " = " + parameter + " AND " + jsonPredicate
            : jsonPredicate;
    }

    private static void AddParam(System.Data.Common.DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value ?? DBNull.Value;
        cmd.Parameters.Add(p);
    }

    /// <summary>
    /// Exécute le SQL paramétré de <see cref="RecordQuerySql"/> (PR 2.3 — vues enregistrées) :
    /// page OFFSET/FETCH + <c>COUNT(*) OVER()</c>, matérialisation <c>AsNoTracking</c> en
    /// <see cref="CustomRecord"/>. Aucune valeur utilisateur n'est concaténée (paramètres typés) ;
    /// les clés ont été revalidées par <c>RecordQuerySql.Build</c>.
    /// </summary>
    public async Task<(IReadOnlyList<CustomRecord> Items, int Total)> QueryAsync(
        RecordQuerySpec spec, IReadOnlyDictionary<string, CustomFieldType> fieldTypes, CancellationToken cancellationToken = default)
    {
        // Résout les colonnes jx_<clé> réellement présentes (égalité uniquement) et complète le spec
        // avant de construire le SQL — best-effort, jamais bloquant.
        var resolved = spec;
        if (resolved.Filters.Any(f => string.Equals(f.Op, "eq", StringComparison.OrdinalIgnoreCase)))
        {
            var indexed = new HashSet<string>(resolved.IndexedFieldKeys, StringComparer.Ordinal);
            foreach (var key in resolved.Filters
                .Where(f => string.Equals(f.Op, "eq", StringComparison.OrdinalIgnoreCase))
                .Select(f => f.FieldKey)
                .Distinct(StringComparer.Ordinal))
            {
                if (!indexed.Contains(key) && StudioKey.IsValidShape(key)
                    && await _jsonIndex.IndexedColumnExistsAsync(spec.TenantId, key, cancellationToken))
                    indexed.Add(key);
            }
            resolved = resolved with { IndexedFieldKeys = indexed };
        }

        var built = RecordQuerySql.Build(resolved, fieldTypes);
        var skip = Math.Max(0, resolved.Skip);
        var take = Math.Max(1, resolved.Take);

        var sql =
            "SELECT r.*, COUNT(*) OVER() AS [__total] FROM [dbo].[CustomRecords] r WHERE "
            + built.WhereSql
            + " ORDER BY " + built.OrderBySql
            + $" OFFSET {skip} ROWS FETCH NEXT {take} ROWS ONLY;";

        await using var context = _contextFactory.CreateContext();
        var conn = context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value, type) in built.Parameters)
        {
            // Paramètre SQL typé (SqlDbType) : la valeur n'est jamais concaténée au texte SQL.
            var p = new Microsoft.Data.SqlClient.SqlParameter(name, type) { Value = value ?? DBNull.Value };
            if (type == SqlDbType.Decimal) { p.Precision = 18; p.Scale = 6; }
            cmd.Parameters.Add(p);
        }

        var items = new List<CustomRecord>();
        var total = 0;
        await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                total = reader.GetInt32(reader.GetOrdinal("__total"));
                items.Add(ReadRecord(reader));
            }
        }

        // Page hors plage : COUNT(*) OVER() est porté par chaque ligne — zéro ligne ne peut pas le
        // ramener. On exécute alors un COUNT(*) séparé (mêmes WHERE et paramètres) pour que « total »
        // reste exact (cas banal : page demandée au-delà de la dernière après des suppressions).
        if (items.Count == 0 && skip > 0)
        {
            var countSql = "SELECT COUNT(*) FROM [dbo].[CustomRecords] r WHERE " + built.WhereSql + ";";
            await using var countCmd = conn.CreateCommand();
            countCmd.CommandText = countSql;
            foreach (var (name, value, type) in built.Parameters)
            {
                var p = new Microsoft.Data.SqlClient.SqlParameter(name, type) { Value = value ?? DBNull.Value };
                if (type == SqlDbType.Decimal) { p.Precision = 18; p.Scale = 6; }
                countCmd.Parameters.Add(p);
            }
            var counted = await countCmd.ExecuteScalarAsync(cancellationToken);
            total = counted is int n ? n : Convert.ToInt32(counted);
        }
        return (items, total);
    }

    /// <summary>Matérialise une ligne <c>SELECT r.*</c> en <see cref="CustomRecord"/> via sa fabrique interne.</summary>
    private static CustomRecord ReadRecord(System.Data.Common.DbDataReader reader)
    {
        var record = CustomRecord.Create(
            reader.GetGuid(reader.GetOrdinal("TenantId")),
            reader.GetGuid(reader.GetOrdinal("EntityDefinitionId")),
            reader.GetString(reader.GetOrdinal("DataJson")),
            null);
        // Create() génère Id/dates : on réécrit les valeurs persistantes via le change tracker — ici on
        // préfère une réflexion minimale et bornée aux propriétés lues (entité sealed à setters privés).
        SetPrivate(record, nameof(CustomRecord.Id), reader.GetGuid(reader.GetOrdinal("Id")));
        SetPrivate(record, nameof(CustomRecord.CreatedAt), reader.GetDateTime(reader.GetOrdinal("CreatedAt")));
        SetPrivate(record, nameof(CustomRecord.UpdatedAt), reader.GetDateTime(reader.GetOrdinal("UpdatedAt")));
        SetPrivate(record, nameof(CustomRecord.IsDeleted), reader.GetBoolean(reader.GetOrdinal("IsDeleted")));
        if (!reader.IsDBNull(reader.GetOrdinal("DeletedAt")))
            SetPrivate(record, nameof(CustomRecord.DeletedAt), reader.GetDateTime(reader.GetOrdinal("DeletedAt")));
        if (!reader.IsDBNull(reader.GetOrdinal("CreatedBy")))
            SetPrivate(record, nameof(CustomRecord.CreatedBy), reader.GetGuid(reader.GetOrdinal("CreatedBy")));
        if (!reader.IsDBNull(reader.GetOrdinal("UpdatedBy")))
            SetPrivate(record, nameof(CustomRecord.UpdatedBy), reader.GetGuid(reader.GetOrdinal("UpdatedBy")));
        SetPrivate(record, nameof(CustomRecord.RowVersion), (byte[])reader.GetValue(reader.GetOrdinal("RowVersion")));
        return record;
    }

    private static void SetPrivate<T>(CustomRecord record, string propertyName, T value)
    {
        var property = typeof(CustomRecord).GetProperty(propertyName)
            ?? throw new InvalidOperationException($"CustomRecord.{propertyName} introuvable.");
        property.SetValue(record, value);
    }

    public async Task AddAsync(CustomRecord record, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.CustomRecords.Add(record);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdateAsync(CustomRecord record, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.CustomRecords.Update(record);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdateWithConcurrencyAsync(CustomRecord record, byte[]? expectedRowVersion, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.CustomRecords.Update(record);
        if (expectedRowVersion is { Length: > 0 })
        {
            // Use the client's RowVersion as the concurrency token → EF throws DbUpdateConcurrencyException
            // if the row changed since the client loaded it (mapped to HTTP 409 by the middleware).
            context.Entry(record).Property(r => r.RowVersion).OriginalValue = expectedRowVersion;
        }
        await context.SaveChangesAsync(cancellationToken);
    }
}
