using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Lot C — crée <c>PublicContactRequests</c> : les demandes de contact / démo déposées anonymement
/// depuis la landing publique (<c>POST /api/public/contact-requests</c>).
///
/// <para>
/// Strictement additive — une nouvelle table, aucune colonne existante touchée, aucune reprise de
/// données. Rien ne lit cette table tant que <c>Features:PublicContact:Enabled</c> est à <c>false</c>.
/// </para>
///
/// <para>
/// SQL idempotent écrit à la main, sans fichier Designer, sur le même patron que
/// <c>AddPlatformActionAudit_Master</c>. Jumeau SQL : <c>docs/runbooks/sql/AddPublicContactRequests_Master.idempotent.sql</c>.
/// Table et index sont émis en commandes <b>séparées</b> (résolution différée des noms dans un lot).
/// </para>
/// </summary>
[DbContext(typeof(MasterDbContext))]
[Migration("20260923120000_AddPublicContactRequests_Master")]
public partial class AddPublicContactRequests_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NULL
BEGIN
    CREATE TABLE [PublicContactRequests] (
        [Id] uniqueidentifier NOT NULL,
        [PublicReference] nvarchar(16) NOT NULL,
        [Subject] int NOT NULL,
        [FullName] nvarchar(120) NOT NULL,
        [Organization] nvarchar(120) NOT NULL,
        [Email] nvarchar(254) NOT NULL,
        [Phone] nvarchar(32) NOT NULL,
        [Size] nvarchar(32) NULL,
        [Message] nvarchar(2000) NOT NULL,
        [Locale] nvarchar(5) NOT NULL,
        [Consent] bit NOT NULL,
        [ConsentTextVersion] nvarchar(32) NOT NULL,
        [CreatedAtUtc] datetime2 NOT NULL,
        [ClientIpHash] nvarchar(64) NULL,
        [UserAgent] nvarchar(500) NULL,
        [CaptchaVerified] bit NOT NULL,
        [Status] int NOT NULL,
        [ProcessedAtUtc] datetime2 NULL,
        [NotificationEnqueued] bit NOT NULL,
        [RetentionUntilUtc] datetime2 NOT NULL,
        CONSTRAINT [PK_PublicContactRequests] PRIMARY KEY ([Id])
    );
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_PublicReference'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE UNIQUE INDEX [IX_PublicContactRequests_PublicReference]
        ON [PublicContactRequests] ([PublicReference]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_CreatedAtUtc'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_CreatedAtUtc]
        ON [PublicContactRequests] ([CreatedAtUtc]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_Status'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_Status]
        ON [PublicContactRequests] ([Status]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_RetentionUntilUtc'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_RetentionUntilUtc]
        ON [PublicContactRequests] ([RetentionUntilUtc]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_Email_Subject_CreatedAtUtc'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_Email_Subject_CreatedAtUtc]
        ON [PublicContactRequests] ([Email], [Subject], [CreatedAtUtc]);
END
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
BEGIN
    DROP TABLE [PublicContactRequests];
END
""");
    }
}
