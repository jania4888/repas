-- Mappage de colonnes CSV/XLSX memorise par compte bancaire (migration 20261013120000).
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Idempotent : rejouable sans effet de bord.
--
-- Uniquement ADDITIF : une seule table nouvelle, BankStatementTabularMappings, avec un index
-- unique sur BankAccountId. Aucune table ni colonne existante n'est modifiee.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID(N'dbo.BankStatementTabularMappings', N'U') IS NULL
CREATE TABLE [BankStatementTabularMappings] (
    [Id] uniqueidentifier NOT NULL,
    [BankAccountId] uniqueidentifier NOT NULL,
    [Format] nvarchar(10) NOT NULL,
    [MappingJson] nvarchar(4000) NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    [CreatedBy] nvarchar(256) NULL,
    [UpdatedAt] datetime2 NULL,
    [UpdatedBy] nvarchar(256) NULL,
    CONSTRAINT [PK_BankStatementTabularMappings] PRIMARY KEY ([Id])
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankStatementTabularMappings_BankAccountId'
               AND [object_id] = OBJECT_ID(N'dbo.BankStatementTabularMappings'))
    CREATE UNIQUE INDEX [IX_BankStatementTabularMappings_BankAccountId]
        ON [BankStatementTabularMappings] ([BankAccountId]);
GO

-- Historique EF (si le script est passe a la main a la place de la migration).
IF OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U') IS NOT NULL
    EXEC(N'IF NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory]
                          WHERE [MigrationId] = N''20261013120000_AddBankStatementTabularMappings_Tenant'')
               INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
               VALUES (N''20261013120000_AddBankStatementTabularMappings_Tenant'', N''8.0.1'');');
GO
