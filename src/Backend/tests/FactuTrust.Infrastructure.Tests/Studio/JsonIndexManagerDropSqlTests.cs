using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Studio;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 3.1 — <see cref="JsonIndexManager.DropFieldIndexAsync"/> contre un SQL Server RÉEL : la
/// colonne calculée <c>jx_&lt;clé&gt;</c> et son index sont bien supprimés (idempotent, deux appels),
/// le cache de <see cref="IJsonIndexManager.IndexedColumnExistsAsync"/> reflète l'absence, et un
/// <c>Ensure*FieldIndexAsync</c> ultérieur recrée les deux (nécessaire quand un champ change de type :
/// la colonne recréée est typée par la nouvelle valeur JSON). <c>Skipped</c> explicite sans SQL.
/// </summary>
public sealed class JsonIndexManagerDropSqlTests : IClassFixture<JsonIndexManagerDropSqlTests.SqlFixture>
{
    private static readonly Guid Tid = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private readonly SqlFixture _sql;

    public JsonIndexManagerDropSqlTests(SqlFixture sql) => _sql = sql;

    [SkippableFact]
    public async Task Drop_is_idempotent_and_removes_the_column_and_index()
    {
        Skip.If(!_sql.CanRun, "SQL Server/LocalDB indisponible dans ce bac à sable.");

        var manager = new JsonIndexManager(_sql.Factory, new MemoryCache(new MemoryCacheOptions()), NullLogger<JsonIndexManager>.Instance);

        await manager.EnsureFieldIndexAsync(Tid, "statut");
        Assert.True(await manager.IndexedColumnExistsAsync(Tid, "statut"));
        Assert.True(await _sql.ColumnExistsAsync("jx_statut"));
        Assert.True(await _sql.IndexExistsAsync("IX_CustomRecords_jx_statut"));

        // Premier DROP : la colonne et l'index disparaissent, le cache est invalidé.
        await manager.DropFieldIndexAsync(Tid, "statut");
        Assert.False(await _sql.ColumnExistsAsync("jx_statut"));
        Assert.False(await _sql.IndexExistsAsync("IX_CustomRecords_jx_statut"));
        Assert.False(await manager.IndexedColumnExistsAsync(Tid, "statut"));

        // Second DROP (idempotent) : ne lève jamais, rien à supprimer.
        await manager.DropFieldIndexAsync(Tid, "statut");
        Assert.False(await _sql.ColumnExistsAsync("jx_statut"));

        // Ensure après Drop : recrée la colonne/l'index (nécessaire après un changement de type).
        await manager.EnsureFieldIndexAsync(Tid, "statut");
        Assert.True(await _sql.ColumnExistsAsync("jx_statut"));
        Assert.True(await _sql.IndexExistsAsync("IX_CustomRecords_jx_statut"));
    }

    [SkippableFact]
    public async Task Drop_never_throws_for_a_field_key_never_indexed()
    {
        Skip.If(!_sql.CanRun, "SQL Server/LocalDB indisponible dans ce bac à sable.");

        var manager = new JsonIndexManager(_sql.Factory, new MemoryCache(new MemoryCacheOptions()), NullLogger<JsonIndexManager>.Instance);

        // Jamais indexé au préalable : DROP IF EXISTS ne trouve rien, aucune exception.
        await manager.DropFieldIndexAsync(Tid, "jamais_indexe");
        Assert.False(await _sql.ColumnExistsAsync("jx_jamais_indexe"));
    }

    // ---- fixture ----

    public sealed class SqlFixture : IDisposable
    {
        private readonly SqlTestDatabase _db = new(nameof(JsonIndexManagerDropSqlTests));

        public SqlFixture()
        {
            if (!_db.CanRun)
                return;

            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseSqlServer(_db.ConnectionString!)
                .Options;
            Factory = new SingleConnectionTenantDbContextFactory(options);
        }

        public bool CanRun => _db.CanRun;
        public ITenantDbContextFactory Factory { get; } = null!;

        public async Task<bool> ColumnExistsAsync(string columnName)
        {
            await using var ctx = Factory.CreateContext();
            var conn = ctx.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[dbo].[CustomRecords]') AND [name] = @n";
            var p = cmd.CreateParameter();
            p.ParameterName = "@n";
            p.Value = columnName;
            cmd.Parameters.Add(p);
            var result = await cmd.ExecuteScalarAsync();
            return result is not null && result != DBNull.Value;
        }

        public async Task<bool> IndexExistsAsync(string indexName)
        {
            await using var ctx = Factory.CreateContext();
            var conn = ctx.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "SELECT 1 FROM sys.indexes WHERE [name] = @n AND [object_id] = OBJECT_ID(N'[dbo].[CustomRecords]')";
            var p = cmd.CreateParameter();
            p.ParameterName = "@n";
            p.Value = indexName;
            cmd.Parameters.Add(p);
            var result = await cmd.ExecuteScalarAsync();
            return result is not null && result != DBNull.Value;
        }

        public void Dispose() => _db.Dispose();

        private sealed class SingleConnectionTenantDbContextFactory : ITenantDbContextFactory
        {
            private readonly DbContextOptions<TenantDbContext> _options;
            public SingleConnectionTenantDbContextFactory(DbContextOptions<TenantDbContext> options) => _options = options;
            public TenantDbContext CreateContext() => new(_options);
        }
    }
}
