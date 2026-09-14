using System.Data;
using System.Data.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio;

/// <summary>
/// Creates non-persisted computed-column indexes on the tenant <c>CustomRecords</c> table for unique
/// fields (idempotent DDL via the tenant connection, the same ADO.NET pattern as SqlSchemaProvider).
/// Everything is best-effort: the index only speeds up lookups; a DDL failure never breaks a save.
/// EF never sees these columns (unmapped), so there is no model/snapshot conflict.
/// </summary>
public sealed class JsonIndexManager : IJsonIndexManager
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<JsonIndexManager> _logger;

    public JsonIndexManager(ITenantDbContextFactory contextFactory, IMemoryCache cache, ILogger<JsonIndexManager> logger)
    {
        _contextFactory = contextFactory;
        _cache = cache;
        _logger = logger;
    }

    public Task EnsureUniqueFieldIndexAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default)
        => EnsureFieldIndexAsync(tenantId, fieldKey, cancellationToken);

    /// <summary>
    /// R10 : same DDL as the unique-field path — the filtered index created by
    /// <see cref="JsonIndexSql.CreateIndexSql"/> is already NON-unique (uniqueness is enforced in
    /// application code, never by SQL), so both entry points share one idempotent implementation.
    /// </summary>
    public async Task EnsureFieldIndexAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default)
    {
        if (!StudioKey.IsValidShape(fieldKey))
            return;

        try
        {
            await using var ctx = _contextFactory.CreateContext();
            var conn = ctx.Database.GetDbConnection();
            await EnsureOpenAsync(conn, cancellationToken);

            await ExecuteAsync(conn, JsonIndexSql.AddColumnSql(fieldKey), cancellationToken);
            await ExecuteAsync(conn, JsonIndexSql.CreateIndexSql(fieldKey), cancellationToken);

            _cache.Set(CacheKey(tenantId, fieldKey), true, CacheTtl);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Studio JSON index could not be ensured for field key {Key} (tenant {Tenant}); queries fall back to JSON_VALUE scan.",
                fieldKey, tenantId);
        }
    }

    public async Task<bool> IndexedColumnExistsAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default)
    {
        if (!StudioKey.IsValidShape(fieldKey))
            return false;

        var cacheKey = CacheKey(tenantId, fieldKey);
        if (_cache.TryGetValue(cacheKey, out bool cached))
            return cached;

        var exists = false;
        try
        {
            await using var ctx = _contextFactory.CreateContext();
            var conn = ctx.Database.GetDbConnection();
            await EnsureOpenAsync(conn, cancellationToken);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = JsonIndexSql.ColumnExistsSql(fieldKey);
            var result = await cmd.ExecuteScalarAsync(cancellationToken);
            exists = result is not null && result != DBNull.Value;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Studio JSON index existence check failed for field key {Key}.", fieldKey);
            exists = false;
        }

        _cache.Set(cacheKey, exists, CacheTtl);
        return exists;
    }

    /// <summary>
    /// PR 3.1 : DROP INDEX puis DROP COLUMN (idempotents), dans cet ordre (l'index dépend de la
    /// colonne). Best-effort : une colonne calculée orpheline (ancien type) ne bloque jamais le
    /// changement de type — elle ralentit seulement de futures requêtes tant qu'elle n'est pas
    /// recréée par <see cref="EnsureFieldIndexAsync"/>.
    /// </summary>
    public async Task DropFieldIndexAsync(Guid tenantId, string fieldKey, CancellationToken cancellationToken = default)
    {
        if (!StudioKey.IsValidShape(fieldKey))
            return;

        try
        {
            await using var ctx = _contextFactory.CreateContext();
            var conn = ctx.Database.GetDbConnection();
            await EnsureOpenAsync(conn, cancellationToken);

            await ExecuteAsync(conn, JsonIndexSql.DropIndexSql(fieldKey), cancellationToken);
            await ExecuteAsync(conn, JsonIndexSql.DropColumnSql(fieldKey), cancellationToken);

            _cache.Remove(CacheKey(tenantId, fieldKey));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Studio JSON index could not be dropped for field key {Key} (tenant {Tenant}); a stale computed column may remain.",
                fieldKey, tenantId);
        }
    }

    private static async Task ExecuteAsync(DbConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task EnsureOpenAsync(DbConnection conn, CancellationToken ct)
    {
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);
    }

    private static string CacheKey(Guid tenantId, string fieldKey) => $"studio:jx:{tenantId}:{fieldKey}";
}
