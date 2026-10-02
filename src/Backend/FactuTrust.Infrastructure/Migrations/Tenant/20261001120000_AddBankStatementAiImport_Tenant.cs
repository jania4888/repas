using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Import IA de relevés bancaires vers le journal de banque.
    ///
    /// <para>
    /// Uniquement ADDITIVE : trois tables nouvelles (<c>BankStatementImportSessions</c>,
    /// <c>BankPostingRules</c>, <c>BankLabelClassifications</c>) et un index unique filtré nommé
    /// <c>IX_JournalEntries_BankStatementLineSource</c> sur des colonnes existantes de
    /// <c>JournalEntries</c>. Aucune colonne existante n'est modifiée ; l'index unique filtré de la
    /// paie (<c>IX_JournalEntries_SourceEntityType_SourceEntityId</c>) n'est pas touché.
    /// </para>
    ///
    /// <para>
    /// L'index d'idempotence ne porte que sur le type de source <c>BankStatementLine</c>, introduit
    /// par cette fonctionnalité : aucune écriture existante ne peut le violer. Il est néanmoins
    /// garde-foué — en cas de doublon (impossible à ce jour), il n'est pas créé plutôt que de
    /// bloquer le tenant au démarrage ; le contrôle applicatif reste en place.
    /// </para>
    ///
    /// Écrite à la main (le snapshot du contexte tenant est désynchronisé, cf.
    /// <c>docs/backend-tenant-migrations.md</c>), idempotente, jumeau SQL :
    /// <c>docs/runbooks/sql/AddBankStatementAiImport_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20261001120000_AddBankStatementAiImport_Tenant")]
    public partial class AddBankStatementAiImport_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.BankStatementImportSessions', N'U') IS NULL
CREATE TABLE [BankStatementImportSessions] (
    [Id] uniqueidentifier NOT NULL,
    [BankAccountId] uniqueidentifier NOT NULL,
    [JournalCode] nvarchar(10) NOT NULL,
    [FileName] nvarchar(255) NOT NULL,
    [FileHash] nvarchar(64) NOT NULL,
    [FileSize] bigint NOT NULL,
    [ContentType] nvarchar(100) NOT NULL,
    [StoragePath] nvarchar(400) NULL,
    [PageCount] int NOT NULL,
    [Status] int NOT NULL,
    [ProgressPercent] int NOT NULL,
    [ExtractionMethod] nvarchar(20) NULL,
    [ProfileId] nvarchar(50) NULL,
    [AiProviderKind] nvarchar(20) NULL,
    [ResultJson] nvarchar(max) NULL,
    [ErrorCode] nvarchar(100) NULL,
    [StatementId] uniqueidentifier NULL,
    [ExpiresAt] datetime2 NOT NULL,
    [RowVersion] rowversion NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    [CreatedBy] nvarchar(256) NULL,
    [UpdatedAt] datetime2 NULL,
    [UpdatedBy] nvarchar(256) NULL,
    CONSTRAINT [PK_BankStatementImportSessions] PRIMARY KEY ([Id])
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankStatementImportSessions_BankAccountId_FileHash'
               AND [object_id] = OBJECT_ID(N'dbo.BankStatementImportSessions'))
    CREATE INDEX [IX_BankStatementImportSessions_BankAccountId_FileHash]
        ON [BankStatementImportSessions] ([BankAccountId], [FileHash]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankStatementImportSessions_Status_ExpiresAt'
               AND [object_id] = OBJECT_ID(N'dbo.BankStatementImportSessions'))
    CREATE INDEX [IX_BankStatementImportSessions_Status_ExpiresAt]
        ON [BankStatementImportSessions] ([Status], [ExpiresAt]);

IF OBJECT_ID(N'dbo.BankPostingRules', N'U') IS NULL
CREATE TABLE [BankPostingRules] (
    [Id] uniqueidentifier NOT NULL,
    [BankAccountId] uniqueidentifier NULL,
    [Direction] int NOT NULL,
    [MatchKind] int NOT NULL,
    [Pattern] nvarchar(200) NOT NULL,
    [AccountNumber] nvarchar(20) NOT NULL,
    [ThirdPartyId] uniqueidentifier NULL,
    [ThirdPartyKind] int NOT NULL,
    [SplitEmbeddedVat] bit NOT NULL,
    [VatAccountNumber] nvarchar(20) NULL,
    [Priority] int NOT NULL,
    [IsActive] bit NOT NULL,
    [UsageCount] int NOT NULL,
    [LastUsedAt] datetime2 NULL,
    [CreatedAt] datetime2 NOT NULL,
    [CreatedBy] nvarchar(256) NULL,
    [UpdatedAt] datetime2 NULL,
    [UpdatedBy] nvarchar(256) NULL,
    CONSTRAINT [PK_BankPostingRules] PRIMARY KEY ([Id])
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankPostingRules_Scope_Pattern'
               AND [object_id] = OBJECT_ID(N'dbo.BankPostingRules'))
    CREATE UNIQUE INDEX [IX_BankPostingRules_Scope_Pattern]
        ON [BankPostingRules] ([BankAccountId], [Direction], [MatchKind], [Pattern]);

IF OBJECT_ID(N'dbo.BankLabelClassifications', N'U') IS NULL
CREATE TABLE [BankLabelClassifications] (
    [Id] uniqueidentifier NOT NULL,
    [LabelHash] nvarchar(64) NOT NULL,
    [NormalizedLabel] nvarchar(300) NOT NULL,
    [IsDebit] bit NOT NULL,
    [AccountNumber] nvarchar(20) NULL,
    [ModelRef] nvarchar(200) NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    [CreatedBy] nvarchar(256) NULL,
    [UpdatedAt] datetime2 NULL,
    [UpdatedBy] nvarchar(256) NULL,
    CONSTRAINT [PK_BankLabelClassifications] PRIMARY KEY ([Id])
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankLabelClassifications_LabelHash'
               AND [object_id] = OBJECT_ID(N'dbo.BankLabelClassifications'))
    CREATE UNIQUE INDEX [IX_BankLabelClassifications_LabelHash]
        ON [BankLabelClassifications] ([LabelHash]);

-- Idempotence des écritures générées depuis une ligne de relevé : jamais deux écritures non
-- extournées pour la même ligne. Garde : si (par impossible) des doublons existaient, l'index
-- n'est PAS créé — le tenant ne doit jamais être bloqué au démarrage par cette migration.
IF OBJECT_ID(N'dbo.JournalEntries', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntries_BankStatementLineSource'
                   AND [object_id] = OBJECT_ID(N'dbo.JournalEntries'))
   AND NOT EXISTS (
       SELECT [SourceEntityId]
       FROM [dbo].[JournalEntries]
       WHERE [IsReversed] = 0 AND [SourceEntityType] = N'BankStatementLine'
       GROUP BY [SourceEntityType], [SourceEntityId]
       HAVING COUNT(*) > 1)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_JournalEntries_BankStatementLineSource]
        ON [dbo].[JournalEntries] ([SourceEntityType], [SourceEntityId])
        WHERE [IsReversed] = 0 AND [SourceEntityType] = N''BankStatementLine'';');
END;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntries_BankStatementLineSource'
           AND [object_id] = OBJECT_ID(N'dbo.JournalEntries'))
    DROP INDEX [IX_JournalEntries_BankStatementLineSource] ON [dbo].[JournalEntries];

IF OBJECT_ID(N'dbo.BankLabelClassifications', N'U') IS NOT NULL
    DROP TABLE [dbo].[BankLabelClassifications];

IF OBJECT_ID(N'dbo.BankPostingRules', N'U') IS NOT NULL
    DROP TABLE [dbo].[BankPostingRules];

IF OBJECT_ID(N'dbo.BankStatementImportSessions', N'U') IS NOT NULL
    DROP TABLE [dbo].[BankStatementImportSessions];
""");
        }
    }
}
