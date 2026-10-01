-- Import IA de releves bancaires vers le journal de banque (migration 20261001120000).
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Idempotent : rejouable sans effet de bord.
--
-- Uniquement ADDITIF : trois tables nouvelles et un index unique filtre nomme sur
-- JournalEntries. Aucune colonne existante n'est modifiee ; l'index unique filtre de la paie
-- (IX_JournalEntries_SourceEntityType_SourceEntityId) n'est pas touche.
--
-- ATTENTION (sqlcmd) : un index FILTRE exige QUOTED_IDENTIFIER ON, que sqlcmd n'active pas par
-- defaut (Msg 1934). Les SET ci-dessous sont donc obligatoires.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

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
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankStatementImportSessions_BankAccountId_FileHash'
               AND [object_id] = OBJECT_ID(N'dbo.BankStatementImportSessions'))
    CREATE INDEX [IX_BankStatementImportSessions_BankAccountId_FileHash]
        ON [BankStatementImportSessions] ([BankAccountId], [FileHash]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankStatementImportSessions_Status_ExpiresAt'
               AND [object_id] = OBJECT_ID(N'dbo.BankStatementImportSessions'))
    CREATE INDEX [IX_BankStatementImportSessions_Status_ExpiresAt]
        ON [BankStatementImportSessions] ([Status], [ExpiresAt]);
GO

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
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankPostingRules_Scope_Pattern'
               AND [object_id] = OBJECT_ID(N'dbo.BankPostingRules'))
    CREATE UNIQUE INDEX [IX_BankPostingRules_Scope_Pattern]
        ON [BankPostingRules] ([BankAccountId], [Direction], [MatchKind], [Pattern]);
GO

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
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankLabelClassifications_LabelHash'
               AND [object_id] = OBJECT_ID(N'dbo.BankLabelClassifications'))
    CREATE UNIQUE INDEX [IX_BankLabelClassifications_LabelHash]
        ON [BankLabelClassifications] ([LabelHash]);
GO

-- Idempotence des ecritures generees depuis une ligne de releve. Garde : jamais de blocage si
-- (par impossible) des doublons existaient deja.
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
GO

-- Historique EF (si le script est passe a la main a la place de la migration).
-- EXEC : sans lui, la reference a __EFMigrationsHistory est compilee avant la garde et le lot
-- echoue sur une base qui n'a pas cette table (verifie sur SQL Server).
IF OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U') IS NOT NULL
    EXEC(N'IF NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory]
                          WHERE [MigrationId] = N''20261001120000_AddBankStatementAiImport_Tenant'')
               INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
               VALUES (N''20261001120000_AddBankStatementAiImport_Tenant'', N''8.0.1'');');
GO
