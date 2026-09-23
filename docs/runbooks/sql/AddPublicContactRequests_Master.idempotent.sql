-- Master DB : table PublicContactRequests (demandes de contact / démo de la landing publique, Lot C).
-- Jumeau de la migration EF 20260923120000_AddPublicContactRequests_Master.
-- Idempotent : peut être rejoué sans erreur si la table, les index ou l'entrée d'historique existent déjà.
--
-- Strictement additif : aucune table existante n'est touchée. La table reste vide tant que le flag
-- Features:PublicContact:Enabled est à false (l'endpoint répond 503).
-- Runbook : docs/runbooks/public-contact-requests.md

BEGIN TRANSACTION;
GO

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
END;
GO

IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_PublicReference'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE UNIQUE INDEX [IX_PublicContactRequests_PublicReference]
        ON [PublicContactRequests] ([PublicReference]);
END;
GO

IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_CreatedAtUtc'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_CreatedAtUtc]
        ON [PublicContactRequests] ([CreatedAtUtc]);
END;
GO

IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_Status'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_Status]
        ON [PublicContactRequests] ([Status]);
END;
GO

IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_RetentionUntilUtc'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_RetentionUntilUtc]
        ON [PublicContactRequests] ([RetentionUntilUtc]);
END;
GO

IF OBJECT_ID(N'dbo.PublicContactRequests', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_PublicContactRequests_Email_Subject_CreatedAtUtc'
         AND object_id = OBJECT_ID(N'dbo.PublicContactRequests'))
BEGIN
    CREATE INDEX [IX_PublicContactRequests_Email_Subject_CreatedAtUtc]
        ON [PublicContactRequests] ([Email], [Subject], [CreatedAtUtc]);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260923120000_AddPublicContactRequests_Master'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260923120000_AddPublicContactRequests_Master', N'8.0.1');
END;
GO

COMMIT;
GO
