using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Crée <c>PlatformActionAuditEntries</c> : le journal d'audit des actions d'administration
/// plateforme (création d'un dossier client, reprise de provisionnement).
///
/// <para>
/// Strictement additive — une nouvelle table, aucune colonne existante touchée, aucune reprise de
/// données. Rien ne lit cette table tant que l'écran d'audit correspondant n'est pas déployé.
/// </para>
///
/// <para>
/// SQL idempotent écrit à la main, sans fichier Designer, sur le même patron que
/// <c>AddStudioAiAdvancedModelRef_Master</c> et <c>AddTenantRegistrationProfile_Master</c>.
/// </para>
///
/// <para>
/// Table et index sont émis en commandes <b>séparées</b> : dans un lot unique, un
/// <c>CREATE INDEX</c> visant une table créée quelques lignes plus haut dépend de la résolution
/// différée des noms. Séparer supprime la question.
/// </para>
/// </summary>
[DbContext(typeof(MasterDbContext))]
[Migration("20260920120000_AddPlatformActionAudit_Master")]
public partial class AddPlatformActionAudit_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PlatformActionAuditEntries', N'U') IS NULL
BEGIN
    CREATE TABLE [PlatformActionAuditEntries] (
        [Id] uniqueidentifier NOT NULL,
        [ActorUserId] uniqueidentifier NOT NULL,
        [ActorEmail] nvarchar(256) NULL,
        [Action] nvarchar(100) NOT NULL,
        [Outcome] nvarchar(32) NOT NULL,
        [TargetTenantId] uniqueidentifier NULL,
        [CreatedAtUtc] datetime2 NOT NULL,
        [CorrelationId] nvarchar(64) NULL,
        [DetailsJson] nvarchar(max) NOT NULL,
        CONSTRAINT [PK_PlatformActionAuditEntries] PRIMARY KEY ([Id])
    );
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PlatformActionAuditEntries', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PlatformActionAuditEntries_CreatedAtUtc'
         AND object_id = OBJECT_ID(N'dbo.PlatformActionAuditEntries'))
BEGIN
    CREATE INDEX [IX_PlatformActionAuditEntries_CreatedAtUtc]
        ON [PlatformActionAuditEntries] ([CreatedAtUtc]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PlatformActionAuditEntries', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PlatformActionAuditEntries_TargetTenantId'
         AND object_id = OBJECT_ID(N'dbo.PlatformActionAuditEntries'))
BEGIN
    CREATE INDEX [IX_PlatformActionAuditEntries_TargetTenantId]
        ON [PlatformActionAuditEntries] ([TargetTenantId]);
END
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.PlatformActionAuditEntries', N'U') IS NOT NULL
BEGIN
    DROP TABLE [PlatformActionAuditEntries];
END
""");
    }
}
