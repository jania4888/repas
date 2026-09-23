using FactuTrust.Domain.Entities.PublicContact;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Background;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — purge job. The "nothing to delete" branch runs on EF InMemory (never reaches
/// <c>ExecuteDeleteAsync</c>); the real deletion (spam 30 j / normal 365 j, cap per run) needs
/// SQL Server and is gated on <c>FACTUTRUST_TEST_MASTER_CONNECTION</c>.
/// </summary>
public sealed class PublicContactRequestsPurgeJobTests
{
    private static readonly DateTime Now = new(2026, 9, 23, 12, 0, 0, DateTimeKind.Utc);

    private static PublicContactRequest NewRequest(string reference, DateTime createdAt, bool spam = false)
        => PublicContactRequest.Create(reference, PublicContactSubject.DemoCabinet, "Amina Ben Salah", "Cabinet",
            $"{reference.ToLowerInvariant()}@cabinet.tn", "+21671123456", null, "Nous souhaitons une démo.", "fr",
            "2026-09-v1", null, null, false, createdAt, 365, spam, 30);

    [Fact]
    public async Task Nothing_expired_deletes_nothing()
    {
        await using var db = new MasterDbContext(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.PublicContactRequests.AddRange(
            NewRequest("CR-KEEP01", Now.AddDays(-364)),
            NewRequest("CR-KEEP02", Now.AddDays(-29), spam: true));
        await db.SaveChangesAsync();

        var job = new PublicContactRequestsPurgeJob(db, NullLogger<PublicContactRequestsPurgeJob>.Instance);

        Assert.Equal(0, await job.ExecuteAsync(Now, CancellationToken.None));
        Assert.Equal(2, await db.PublicContactRequests.CountAsync());
    }

    [Fact]
    public void Cap_per_run_is_bounded()
        => Assert.InRange(PublicContactRequestsPurgeJob.MaxRowsPerRun, 1_000, 50_000);

    [SkippableFact]
    public async Task Sql_purge_removes_only_expired_rows()
    {
        var server = Environment.GetEnvironmentVariable("FACTUTRUST_TEST_MASTER_CONNECTION");
        Skip.If(string.IsNullOrWhiteSpace(server), "FACTUTRUST_TEST_MASTER_CONNECTION non définie : SQL Server indisponible dans ce bac à sable.");

        var builder = new SqlConnectionStringBuilder(server) { InitialCatalog = $"FT_PublicContactPurge_{Guid.NewGuid():N}" };
        var options = new DbContextOptionsBuilder<MasterDbContext>().UseSqlServer(builder.ConnectionString).Options;

        await using var db = new MasterDbContext(options);
        try
        {
            await db.Database.MigrateAsync();
            db.PublicContactRequests.AddRange(
                NewRequest("CR-EXPIR1", Now.AddDays(-366)),
                NewRequest("CR-EXPIR2", Now.AddDays(-31), spam: true),
                NewRequest("CR-KEEP03", Now.AddDays(-364)),
                NewRequest("CR-KEEP04", Now.AddDays(-29), spam: true));
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();

            var job = new PublicContactRequestsPurgeJob(db, NullLogger<PublicContactRequestsPurgeJob>.Instance);

            Assert.Equal(2, await job.ExecuteAsync(Now, CancellationToken.None));
            var remaining = await db.PublicContactRequests.Select(r => r.PublicReference).OrderBy(r => r).ToListAsync();
            Assert.Equal(new[] { "CR-KEEP03", "CR-KEEP04" }, remaining);

            Assert.Equal(0, await job.ExecuteAsync(Now, CancellationToken.None));
        }
        finally
        {
            await db.Database.EnsureDeletedAsync();
        }
    }
}
