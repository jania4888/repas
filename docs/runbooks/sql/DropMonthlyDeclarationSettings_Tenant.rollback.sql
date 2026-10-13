-- Retour arriere: DropMonthlyDeclarationSettings_Tenant
-- MigrationId: 20261013100000_DropMonthlyDeclarationSettings_Tenant
--
-- A passer sur CHAQUE base tenant AVEC le retour a l'image precedente, celle qui lit encore la
-- table MonthlyDeclarationSettings. Sans lui, cette image echoue sur « Invalid object name ».
--
-- La table est recreee VIDE : son contenu d'origine n'est pas restaurable par ce script. Un dossier
-- sans reglage vaut calcul historique (Mode = 0), ce qui est le comportement attendu de l'image
-- precedente et reste coherent avec les periodes anterieures. Pour retrouver les reglages eux-memes,
-- il faut restaurer la sauvegarde prise par deploy.sh avant la bascule.
--
-- La ligne d'historique EF est retiree pour que l'image precedente ne considere pas la migration
-- comme appliquee -- et que l'image suivante puisse la rejouer.
--
-- Rejouable : chaque etape est gardee.

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

DELETE FROM [__EFMigrationsHistory]
WHERE [MigrationId] = N'20261013100000_DropMonthlyDeclarationSettings_Tenant';
GO
