-- Idempotent tenant migration: AddMonthlyDeclarationDocumentSources_Tenant
-- MigrationId: 20260925100000_AddMonthlyDeclarationDocumentSources_Tenant
--
-- Prepare le retrait du calcul historique de la declaration mensuelle.
--
-- MonthlyDeclarationRubrics.GrossDocumentSource / WithheldDocumentSource : valeur documentaire
-- (factures, rapport de retenue a la source) qu'une rubrique d'origine "documents" consomme.
-- Nullables : aucune rubrique existante ne les utilise.
--
-- VatDeclarations.CalculationOrigin : calcul qui a produit une declaration enregistree
-- (0 = historique, 1 = parametre). Defaut 0. Retro-rempli a 1 pour les periodes d'un dossier deja
-- bascule (Mode = 2, mois >= ConfiguredSince), la regle meme de ResolveModeFor.
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Rejouable : chaque colonne est gardee par un test d'existence ; le retro-remplissage ne passe
-- qu'a 1, jamais a 0.

IF OBJECT_ID(N'[dbo].[MonthlyDeclarationRubrics]', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.MonthlyDeclarationRubrics', N'GrossDocumentSource') IS NULL
        ALTER TABLE [dbo].[MonthlyDeclarationRubrics] ADD [GrossDocumentSource] int NULL;

    IF COL_LENGTH(N'dbo.MonthlyDeclarationRubrics', N'WithheldDocumentSource') IS NULL
        ALTER TABLE [dbo].[MonthlyDeclarationRubrics] ADD [WithheldDocumentSource] int NULL;
END;
GO

IF OBJECT_ID(N'[dbo].[VatDeclarations]', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.VatDeclarations', N'CalculationOrigin') IS NULL
BEGIN
    ALTER TABLE [dbo].[VatDeclarations]
        ADD [CalculationOrigin] int NOT NULL
        CONSTRAINT [DF_VatDeclarations_CalculationOrigin] DEFAULT (0);
END;
GO

IF COL_LENGTH(N'dbo.VatDeclarations', N'CalculationOrigin') IS NOT NULL
   AND OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NOT NULL
BEGIN
    UPDATE v
    SET v.[CalculationOrigin] = 1
    FROM [dbo].[VatDeclarations] AS v
    CROSS JOIN (SELECT TOP (1) [Mode], [ConfiguredSince] FROM [dbo].[MonthlyDeclarationSettings]) AS s
    WHERE s.[Mode] = 2
      AND s.[ConfiguredSince] IS NOT NULL
      AND DATEFROMPARTS(v.[Year], v.[Month], 1) >= CAST(s.[ConfiguredSince] AS date)
      AND v.[CalculationOrigin] = 0;
END;
GO
