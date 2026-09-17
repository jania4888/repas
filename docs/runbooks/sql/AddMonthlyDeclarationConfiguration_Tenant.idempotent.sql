-- Idempotent tenant migration: AddMonthlyDeclarationConfiguration_Tenant
-- MigrationId: 20260916100000_AddMonthlyDeclarationConfiguration_Tenant
--
-- Socle de la declaration mensuelle parametrable : MonthlyDeclarationSettings (regime du dossier),
-- MonthlyDeclarationFamilySettings (inclusion d'une famille), MonthlyDeclarationRubrics (regle de
-- calcul d'une ligne) et MonthlyDeclarationRubricAccounts (comptes selectionnes par colonne).
--
-- Strictement additif et sans donnees : aucune ligne n'est inseree. Le catalogue standard des
-- rubriques est amorce par l'application (MonthlyDeclarationRubricInitializer) depuis une ressource
-- JSON versionnee. Tant qu'aucun dossier n'a quitte le mode Legacy, ces tables sont inertes et le
-- calcul de la declaration mensuelle est inchange.
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Rejouable : chaque bloc est garde, l'executer deux fois est sans effet.

IF OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[MonthlyDeclarationSettings] (
        [Id] uniqueidentifier NOT NULL,
        [Mode] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_Mode] DEFAULT (0),
        [ConfiguredSince] datetime2 NULL,
        [LastParityPeriodKey] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_LastParityPeriodKey] DEFAULT (0),
        [LastParityRunAt] datetime2 NULL,
        [LastParityMaxGapMillimes] bigint NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_LastParityMaxGapMillimes] DEFAULT (0),
        [ParityCleanStreak] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_ParityCleanStreak] DEFAULT (0),
        [ParityOverrideBy] nvarchar(256) NULL,
        [ParityOverrideReason] nvarchar(500) NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_MonthlyDeclarationSettings] PRIMARY KEY ([Id])
    );
END;
GO

IF OBJECT_ID(N'[dbo].[MonthlyDeclarationFamilySettings]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[MonthlyDeclarationFamilySettings] (
        [Id] uniqueidentifier NOT NULL,
        [Family] int NOT NULL,
        [IsIncluded] bit NOT NULL CONSTRAINT [DF_MonthlyDeclarationFamilySettings_IsIncluded] DEFAULT (0),
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_MonthlyDeclarationFamilySettings] PRIMARY KEY ([Id])
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_MonthlyDeclarationFamilySettings_Family' AND [object_id] = OBJECT_ID(N'[dbo].[MonthlyDeclarationFamilySettings]'))
    CREATE UNIQUE INDEX [IX_MonthlyDeclarationFamilySettings_Family]
        ON [dbo].[MonthlyDeclarationFamilySettings] ([Family]);
GO

IF OBJECT_ID(N'[dbo].[MonthlyDeclarationRubricSeedLogs]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[MonthlyDeclarationRubricSeedLogs] (
        [Id] uniqueidentifier NOT NULL,
        [CatalogVersion] nvarchar(32) NOT NULL,
        [AppliedAt] datetime2 NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_MonthlyDeclarationRubricSeedLogs] PRIMARY KEY ([Id])
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_MonthlyDeclarationRubricSeedLogs_CatalogVersion' AND [object_id] = OBJECT_ID(N'[dbo].[MonthlyDeclarationRubricSeedLogs]'))
    CREATE UNIQUE INDEX [IX_MonthlyDeclarationRubricSeedLogs_CatalogVersion]
        ON [dbo].[MonthlyDeclarationRubricSeedLogs] ([CatalogVersion]);
GO

IF OBJECT_ID(N'[dbo].[MonthlyDeclarationRubrics]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[MonthlyDeclarationRubrics] (
        [Id] uniqueidentifier NOT NULL,
        [Version] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_Version] DEFAULT (1),
        [Family] int NOT NULL,
        [Code] nvarchar(20) NOT NULL,
        [Label] nvarchar(200) NOT NULL,
        [ReportCode] nvarchar(16) NOT NULL,
        [GrossKind] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_GrossKind] DEFAULT (0),
        [WithheldKind] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_WithheldKind] DEFAULT (0),
        [GrossSide] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_GrossSide] DEFAULT (0),
        [WithheldSide] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_WithheldSide] DEFAULT (0),
        [RatePercent] decimal(9,4) NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_RatePercent] DEFAULT (0),
        [FixedGrossAmount] decimal(18,3) NULL,
        [FixedWithheldAmount] decimal(18,3) NULL,
        [PayrollComponent] int NULL,
        [WithheldPayrollComponent] int NULL,
        [EffectiveFrom] datetime2 NULL,
        [EffectiveTo] datetime2 NULL,
        [IsActive] bit NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_IsActive] DEFAULT (1),
        [DisplayOrder] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubrics_DisplayOrder] DEFAULT (0),
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_MonthlyDeclarationRubrics] PRIMARY KEY ([Id])
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_MonthlyDeclarationRubrics_Code' AND [object_id] = OBJECT_ID(N'[dbo].[MonthlyDeclarationRubrics]'))
    CREATE UNIQUE INDEX [IX_MonthlyDeclarationRubrics_Code]
        ON [dbo].[MonthlyDeclarationRubrics] ([Code]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_MonthlyDeclarationRubrics_Family_DisplayOrder' AND [object_id] = OBJECT_ID(N'[dbo].[MonthlyDeclarationRubrics]'))
    CREATE INDEX [IX_MonthlyDeclarationRubrics_Family_DisplayOrder]
        ON [dbo].[MonthlyDeclarationRubrics] ([Family], [DisplayOrder]);
GO

IF OBJECT_ID(N'[dbo].[MonthlyDeclarationRubricAccounts]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[MonthlyDeclarationRubricAccounts] (
        [Id] uniqueidentifier NOT NULL,
        [RubricId] uniqueidentifier NOT NULL,
        [Role] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubricAccounts_Role] DEFAULT (0),
        [AccountNumber] nvarchar(32) NOT NULL,
        [MatchMode] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationRubricAccounts_MatchMode] DEFAULT (0),
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_MonthlyDeclarationRubricAccounts] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_MonthlyDeclarationRubricAccounts_MonthlyDeclarationRubrics] FOREIGN KEY ([RubricId])
            REFERENCES [dbo].[MonthlyDeclarationRubrics] ([Id]) ON DELETE CASCADE
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_MonthlyDeclarationRubricAccounts_RubricId_Role_AccountNumber' AND [object_id] = OBJECT_ID(N'[dbo].[MonthlyDeclarationRubricAccounts]'))
    CREATE UNIQUE INDEX [IX_MonthlyDeclarationRubricAccounts_RubricId_Role_AccountNumber]
        ON [dbo].[MonthlyDeclarationRubricAccounts] ([RubricId], [Role], [AccountNumber]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_MonthlyDeclarationRubricAccounts_AccountNumber' AND [object_id] = OBJECT_ID(N'[dbo].[MonthlyDeclarationRubricAccounts]'))
    CREATE INDEX [IX_MonthlyDeclarationRubricAccounts_AccountNumber]
        ON [dbo].[MonthlyDeclarationRubricAccounts] ([AccountNumber]);
GO
