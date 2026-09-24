using FactuTrust.Domain.Entities.PublicContact;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Tests.Common;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — TC2/TC6 : dépôt <see cref="PublicContactRequestRepository"/>. Requêtes (doublon, garde
/// anti-inondation) sur EF InMemory ; détection de la violation d'unicité sur des SqlException
/// forgées ; et, quand <c>FACTUTRUST_TEST_MASTER_CONNECTION</c> pointe vers un SQL Server, la
/// migration réelle appliquée deux fois (idempotence) + collision de référence sur l'index unique.
/// </summary>
public sealed class PublicContactRequestRepositoryTests
{
    private static readonly DateTime Now = new(2026, 9, 23, 12, 0, 0, DateTimeKind.Utc);

    private static MasterDbContext NewInMemoryDb(string? name = null) =>
        new(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(name ?? Guid.NewGuid().ToString())
            .Options);

    private static PublicContactRequest NewRequest(
        string reference,
        string email = "amina@cabinet.tn",
        PublicContactSubject subject = PublicContactSubject.DemoCabinet,
        DateTime? createdAt = null,
        bool spam = false)
        => PublicContactRequest.Create(reference, subject, "Amina Ben Salah", "Cabinet", email, "+21671123456",
            null, "Nous souhaitons une démo.", "fr", "2026-09-v1", null, null, false, createdAt ?? Now, 365, spam, 30);

    [Fact]
    public async Task TryAddAsync_persists_and_returns_true()
    {
        await using var db = NewInMemoryDb();
        var repo = new PublicContactRequestRepository(db);

        var added = await repo.TryAddAsync(NewRequest("CR-AAAAAA"));

        Assert.True(added);
        Assert.Equal(1, await db.PublicContactRequests.CountAsync());
    }

    [Fact]
    public async Task FindRecentReferenceAsync_returns_latest_non_spam_match_in_window()
    {
        await using var db = NewInMemoryDb();
        db.PublicContactRequests.AddRange(
            NewRequest("CR-OLDER2", createdAt: Now.AddMinutes(-30)),
            NewRequest("CR-MATCH2", createdAt: Now.AddMinutes(-5)),
            NewRequest("CR-LATER2", createdAt: Now.AddMinutes(-2), spam: true),
            NewRequest("CR-OTHER2", createdAt: Now.AddMinutes(-1), subject: PublicContactSubject.Autre),
            NewRequest("CR-MAIL22", createdAt: Now.AddMinutes(-1), email: "other@cabinet.tn"));
        await db.SaveChangesAsync();
        var repo = new PublicContactRequestRepository(db);

        var found = await repo.FindRecentReferenceAsync("amina@cabinet.tn", PublicContactSubject.DemoCabinet, Now.AddMinutes(-10));
        var none = await repo.FindRecentReferenceAsync("amina@cabinet.tn", PublicContactSubject.Entreprise, Now.AddMinutes(-10));
        var outsideWindow = await repo.FindRecentReferenceAsync("nobody@cabinet.tn", PublicContactSubject.DemoCabinet, Now.AddMinutes(-10));

        Assert.Equal("CR-MATCH2", found);
        Assert.Null(none);
        Assert.Null(outsideWindow);
    }

    [Fact]
    public async Task FindRecentReferenceAsync_is_case_sensitive_on_the_normalized_email_key()
    {
        await using var db = NewInMemoryDb();
        db.PublicContactRequests.Add(NewRequest("CR-MATCH3", email: "Amina@Cabinet.TN"));
        await db.SaveChangesAsync();
        var repo = new PublicContactRequestRepository(db);

        // Create() lower-cases the e-mail: the lookup key must be normalized the same way.
        Assert.Equal("CR-MATCH3", await repo.FindRecentReferenceAsync("amina@cabinet.tn", PublicContactSubject.DemoCabinet, Now.AddMinutes(-1)));
    }

    [Fact]
    public async Task CountCreatedSinceAsync_counts_every_status()
    {
        await using var db = NewInMemoryDb();
        db.PublicContactRequests.AddRange(
            NewRequest("CR-CNT001", createdAt: Now.AddMinutes(-90)),
            NewRequest("CR-CNT002", createdAt: Now.AddMinutes(-30)),
            NewRequest("CR-CNT003", createdAt: Now.AddMinutes(-10), spam: true));
        await db.SaveChangesAsync();
        var repo = new PublicContactRequestRepository(db);

        Assert.Equal(2, await repo.CountCreatedSinceAsync(Now.AddHours(-1)));
        Assert.Equal(3, await repo.CountCreatedSinceAsync(Now.AddHours(-2)));
    }

    [Theory]
    [InlineData(2601, true)]
    [InlineData(2627, true)]
    [InlineData(547, false)]
    [InlineData(207, false)]
    public void IsUniqueViolation_detects_sql_server_unique_index_errors_only(int number, bool expected)
    {
        var sqlException = SqlExceptionTestFactory.Create(number, "forged");
        var dbUpdate = new DbUpdateException("save failed", sqlException);

        Assert.Equal(expected, PublicContactRequestRepository.IsUniqueViolation(dbUpdate));
    }

    [Fact]
    public void IsUniqueViolation_is_false_without_a_sql_exception()
    {
        Assert.False(PublicContactRequestRepository.IsUniqueViolation(new DbUpdateException("save failed", new InvalidOperationException())));
    }

    /// <summary>
    /// Requires a SQL Server reachable through <c>FACTUTRUST_TEST_MASTER_CONNECTION</c> (server-level
    /// connection string; a dedicated throw-away database is derived). Applies ALL master migrations
    /// twice (second run = EF no-op, and the guarded SQL is safe anyway), then proves the unique index
    /// turns a reference collision into <c>TryAddAsync == false</c> with the entity detached.
    /// </summary>
    [SkippableFact]
    public async Task Sql_migration_is_idempotent_and_reference_collision_returns_false()
    {
        var server = Environment.GetEnvironmentVariable("FACTUTRUST_TEST_MASTER_CONNECTION");
        Skip.If(string.IsNullOrWhiteSpace(server), "FACTUTRUST_TEST_MASTER_CONNECTION non définie : SQL Server indisponible dans ce bac à sable.");

        var builder = new SqlConnectionStringBuilder(server) { InitialCatalog = $"FT_PublicContact_{Guid.NewGuid():N}" };
        var options = new DbContextOptionsBuilder<MasterDbContext>().UseSqlServer(builder.ConnectionString).Options;

        await using var db = new MasterDbContext(options);
        try
        {
            await db.Database.MigrateAsync();
            await db.Database.MigrateAsync();

            var applied = await db.Database.GetAppliedMigrationsAsync();
            Assert.Contains("20260923120000_AddPublicContactRequests_Master", applied);

            // Re-run the hand-written guarded SQL a third time: must be a no-op, not an error.
            var migration = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrationsAssembly>()
                .Migrations.Single(m => m.Key == "20260923120000_AddPublicContactRequests_Master");
            var sqlGenerator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrationsSqlGenerator>();
            var instance = (Microsoft.EntityFrameworkCore.Migrations.Migration)Activator.CreateInstance(migration.Value)!;
            foreach (var command in sqlGenerator.Generate(instance.UpOperations, db.Model))
            {
                await db.Database.ExecuteSqlRawAsync(command.CommandText);
            }

            var repo = new PublicContactRequestRepository(db);
            Assert.True(await repo.TryAddAsync(NewRequest("CR-UNIQ01")));

            var duplicate = NewRequest("CR-UNIQ01", email: "other@cabinet.tn");
            Assert.False(await repo.TryAddAsync(duplicate));
            Assert.Equal(EntityState.Detached, db.Entry(duplicate).State);

            Assert.True(await repo.TryAddAsync(NewRequest("CR-UNIQ02", email: "other@cabinet.tn")));
            Assert.Equal(2, await db.PublicContactRequests.CountAsync());
            Assert.Equal("CR-UNIQ01", await repo.FindRecentReferenceAsync("amina@cabinet.tn", PublicContactSubject.DemoCabinet, Now.AddMinutes(-10)));
        }
        finally
        {
            await db.Database.EnsureDeletedAsync();
        }
    }
}
