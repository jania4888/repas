-- Idempotent tenant migration: AddVatDeclarationLines_Tenant
-- MigrationId: 20260916120000_AddVatDeclarationLines_Tenant
--
-- Cree VatDeclarationLines : le detail par rubrique d'une declaration mensuelle deposee.
-- Code, libelle, famille et code rapport y sont denormalises (le depot fait foi, y compris sur les
-- intitules) ; RubricId est une reference SANS contrainte vers MonthlyDeclarationRubrics.
--
-- La table reste vide tant qu'aucun dossier n'est passe au calcul parametre.
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Rejouable : chaque bloc est garde.

IF OBJECT_ID(N'[dbo].[VatDeclarationLines]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[VatDeclarationLines] (
        [Id] uniqueidentifier NOT NULL,
        [VatDeclarationId] uniqueidentifier NOT NULL,
        [RubricId] uniqueidentifier NULL,
        [RubricCode] nvarchar(20) NOT NULL,
        [Label] nvarchar(200) NULL,
        [Family] int NOT NULL,
        [ReportCode] nvarchar(16) NULL,
        [GrossAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_GrossAmount] DEFAULT (0),
        [WithheldAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_WithheldAmount] DEFAULT (0),
        [RatePercentApplied] decimal(9,4) NOT NULL CONSTRAINT [DF_VatDeclarationLines_RatePercentApplied] DEFAULT (0),
        [ComputedGrossAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_ComputedGrossAmount] DEFAULT (0),
        [ComputedWithheldAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_ComputedWithheldAmount] DEFAULT (0),
        [Origin] int NOT NULL CONSTRAINT [DF_VatDeclarationLines_Origin] DEFAULT (0),
        [DisplayOrder] int NOT NULL CONSTRAINT [DF_VatDeclarationLines_DisplayOrder] DEFAULT (0),
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_VatDeclarationLines] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_VatDeclarationLines_VatDeclarations] FOREIGN KEY ([VatDeclarationId])
            REFERENCES [dbo].[VatDeclarations] ([Id]) ON DELETE CASCADE
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_VatDeclarationLines_VatDeclarationId_RubricCode' AND [object_id] = OBJECT_ID(N'[dbo].[VatDeclarationLines]'))
    CREATE UNIQUE INDEX [IX_VatDeclarationLines_VatDeclarationId_RubricCode]
        ON [dbo].[VatDeclarationLines] ([VatDeclarationId], [RubricCode]);
GO
