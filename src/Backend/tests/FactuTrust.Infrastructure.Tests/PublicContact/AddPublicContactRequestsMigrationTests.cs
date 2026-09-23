using FactuTrust.Domain.Entities.PublicContact;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — TC2 : verrouille le contrat de la migration Master créant <c>PublicContactRequests</c>
/// et son jumeau SQL (même MigrationId, mêmes colonnes, index gardés). Assertions sur le TEXTE
/// SOURCE (aucun serveur SQL requis) + mapping du modèle EF (InMemory).
/// </summary>
public sealed class AddPublicContactRequestsMigrationTests
{
    private const string MigrationId = "20260923120000_AddPublicContactRequests_Master";

    private static readonly string[] IndexNames =
    {
        "IX_PublicContactRequests_PublicReference",
        "IX_PublicContactRequests_CreatedAtUtc",
        "IX_PublicContactRequests_Status",
        "IX_PublicContactRequests_RetentionUntilUtc",
        "IX_PublicContactRequests_Email_Subject_CreatedAtUtc"
    };

    private static readonly string[] ColumnDefinitions =
    {
        "[Id] uniqueidentifier NOT NULL",
        "[PublicReference] nvarchar(16) NOT NULL",
        "[Subject] int NOT NULL",
        "[FullName] nvarchar(120) NOT NULL",
        "[Organization] nvarchar(120) NOT NULL",
        "[Email] nvarchar(254) NOT NULL",
        "[Phone] nvarchar(32) NOT NULL",
        "[Size] nvarchar(32) NULL",
        "[Message] nvarchar(2000) NOT NULL",
        "[Locale] nvarchar(5) NOT NULL",
        "[Consent] bit NOT NULL",
        "[ConsentTextVersion] nvarchar(32) NOT NULL",
        "[CreatedAtUtc] datetime2 NOT NULL",
        "[ClientIpHash] nvarchar(64) NULL",
        "[UserAgent] nvarchar(500) NULL",
        "[CaptchaVerified] bit NOT NULL",
        "[Status] int NOT NULL",
        "[ProcessedAtUtc] datetime2 NULL",
        "[NotificationEnqueued] bit NOT NULL",
        "[RetentionUntilUtc] datetime2 NOT NULL",
        "CONSTRAINT [PK_PublicContactRequests] PRIMARY KEY ([Id])"
    };

    /// <summary>Chemin absolu depuis la racine du dépôt (bin/Release/net8.0 ⇒ 7 niveaux au-dessus).</summary>
    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static string MigrationSource()
    {
        var path = RepoRelativePath("src", "Backend", "FactuTrust.Infrastructure", "Migrations", $"{MigrationId}.cs");
        Assert.True(File.Exists(path), $"Migration source not found: {path}");
        return File.ReadAllText(path);
    }

    private static string SqlTwin()
    {
        var path = RepoRelativePath("docs", "runbooks", "sql", "AddPublicContactRequests_Master.idempotent.sql");
        Assert.True(File.Exists(path), $"Script SQL not found: {path}");
        return File.ReadAllText(path);
    }

    [Fact]
    public void Migration_creates_the_table_behind_an_existence_guard_with_the_frozen_columns()
    {
        var source = MigrationSource();

        Assert.Contains($"[Migration(\"{MigrationId}\")]", source);
        Assert.Contains("[DbContext(typeof(MasterDbContext))]", source);
        Assert.Contains("IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NULL", source);
        Assert.Contains("CREATE TABLE [PublicContactRequests]", source);
        foreach (var column in ColumnDefinitions)
        {
            Assert.Contains(column, source);
        }
    }

    [Fact]
    public void Migration_creates_each_index_in_its_own_guarded_statement()
    {
        var source = MigrationSource();

        foreach (var index in IndexNames)
        {
            Assert.Contains($"WHERE name = N'{index}'", source);
            Assert.Contains($"INDEX [{index}]", source);
        }

        Assert.Contains("CREATE UNIQUE INDEX [IX_PublicContactRequests_PublicReference]", source);
        Assert.Contains("ON [PublicContactRequests] ([Email], [Subject], [CreatedAtUtc])", source);
        // Table + 5 index = 6 commandes séparées dans Up (résolution différée des noms).
        Assert.Equal(7, CountOccurrences(source, "migrationBuilder.Sql("));
    }

    [Fact]
    public void Migration_down_drops_the_table_behind_a_guard()
    {
        var source = MigrationSource();

        Assert.Contains("IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL", source);
        Assert.Contains("DROP TABLE [PublicContactRequests];", source);
    }

    [Fact]
    public void Migration_has_no_designer_file()
    {
        var designer = RepoRelativePath("src", "Backend", "FactuTrust.Infrastructure", "Migrations", $"{MigrationId}.Designer.cs");
        Assert.False(File.Exists(designer), "Hand-written idempotent migrations must not ship a Designer file.");
    }

    [Fact]
    public void Idempotent_script_matches_the_migration_and_registers_the_history_row()
    {
        var script = SqlTwin();

        Assert.Contains("IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NULL", script);
        foreach (var column in ColumnDefinitions)
        {
            Assert.Contains(column, script);
        }

        foreach (var index in IndexNames)
        {
            Assert.Contains($"WHERE name = N'{index}'", script);
        }

        Assert.Contains($"WHERE [MigrationId] = N'{MigrationId}'", script);
        Assert.Contains($"VALUES (N'{MigrationId}', N'8.0.1')", script);
    }

    [Fact]
    public void Snapshot_contains_the_entity_with_the_unique_reference_index()
    {
        var snapshot = File.ReadAllText(RepoRelativePath("src", "Backend", "FactuTrust.Infrastructure", "Migrations", "MasterDbContextModelSnapshot.cs"));

        Assert.Contains("modelBuilder.Entity(\"FactuTrust.Domain.Entities.PublicContact.PublicContactRequest\"", snapshot);
        Assert.Contains("b.ToTable(\"PublicContactRequests\", (string)null);", snapshot);
        Assert.Contains("b.HasIndex(\"PublicReference\")\n                        .IsUnique();", snapshot.Replace("\r\n", "\n", StringComparison.Ordinal));
    }

    [Fact]
    public void MasterDbContext_maps_PublicContactRequest_with_frozen_lengths_and_indexes()
    {
        using var db = new MasterDbContext(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

        var entityType = db.Model.FindEntityType(typeof(PublicContactRequest));
        Assert.NotNull(entityType);
        Assert.Equal("PublicContactRequests", entityType!.GetTableName());

        Assert.Equal(16, entityType.FindProperty(nameof(PublicContactRequest.PublicReference))!.GetMaxLength());
        Assert.Equal(120, entityType.FindProperty(nameof(PublicContactRequest.FullName))!.GetMaxLength());
        Assert.Equal(120, entityType.FindProperty(nameof(PublicContactRequest.Organization))!.GetMaxLength());
        Assert.Equal(254, entityType.FindProperty(nameof(PublicContactRequest.Email))!.GetMaxLength());
        Assert.Equal(32, entityType.FindProperty(nameof(PublicContactRequest.Phone))!.GetMaxLength());
        Assert.Equal(32, entityType.FindProperty(nameof(PublicContactRequest.Size))!.GetMaxLength());
        Assert.Equal(2000, entityType.FindProperty(nameof(PublicContactRequest.Message))!.GetMaxLength());
        Assert.Equal(5, entityType.FindProperty(nameof(PublicContactRequest.Locale))!.GetMaxLength());
        Assert.Equal(32, entityType.FindProperty(nameof(PublicContactRequest.ConsentTextVersion))!.GetMaxLength());
        Assert.Equal(64, entityType.FindProperty(nameof(PublicContactRequest.ClientIpHash))!.GetMaxLength());
        Assert.Equal(500, entityType.FindProperty(nameof(PublicContactRequest.UserAgent))!.GetMaxLength());
        Assert.True(entityType.FindProperty(nameof(PublicContactRequest.Size))!.IsNullable);
        Assert.False(entityType.FindProperty(nameof(PublicContactRequest.Message))!.IsNullable);
        Assert.Equal(typeof(int), entityType.FindProperty(nameof(PublicContactRequest.Subject))!.GetProviderClrType());
        Assert.Equal(typeof(int), entityType.FindProperty(nameof(PublicContactRequest.Status))!.GetProviderClrType());

        var referenceIndex = entityType.GetIndexes().Single(i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { "PublicReference" }));
        Assert.True(referenceIndex.IsUnique);
        Assert.Contains(entityType.GetIndexes(), i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { "Email", "Subject", "CreatedAtUtc" }));
        Assert.Contains(entityType.GetIndexes(), i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { "RetentionUntilUtc" }));
        Assert.Equal(5, entityType.GetIndexes().Count());
    }

    [Fact]
    public async Task InMemory_round_trip_persists_and_reads_back_the_entity()
    {
        var dbName = Guid.NewGuid().ToString();
        var options = new DbContextOptionsBuilder<MasterDbContext>().UseInMemoryDatabase(dbName).Options;
        var now = new DateTime(2026, 9, 23, 12, 0, 0, DateTimeKind.Utc);
        var entity = PublicContactRequest.Create("CR-7F3K9Q", PublicContactSubject.DemoCabinet, "Amina", "Cabinet", "a@b.tn",
            "+21671123456", "dossiers:6-20", "Nous souhaitons une démo.", "fr", "2026-09-v1", null, "UA", false, now, 365, false, 30);

        await using (var db = new MasterDbContext(options))
        {
            db.PublicContactRequests.Add(entity);
            await db.SaveChangesAsync();
        }

        await using (var db = new MasterDbContext(options))
        {
            var loaded = await db.PublicContactRequests.SingleAsync(r => r.PublicReference == "CR-7F3K9Q");
            Assert.Equal(entity.Id, loaded.Id);
            Assert.Equal(PublicContactSubject.DemoCabinet, loaded.Subject);
            Assert.Equal(PublicContactRequestStatus.New, loaded.Status);
            Assert.Equal(now.AddDays(365), loaded.RetentionUntilUtc);
        }
    }

    private static int CountOccurrences(string text, string token)
    {
        var count = 0;
        var index = 0;
        while ((index = text.IndexOf(token, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += token.Length;
        }

        return count;
    }
}
