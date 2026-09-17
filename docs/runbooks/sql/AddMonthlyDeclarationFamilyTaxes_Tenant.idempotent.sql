-- Idempotent tenant migration: AddMonthlyDeclarationFamilyTaxes_Tenant
-- MigrationId: 20260916110000_AddMonthlyDeclarationFamilyTaxes_Tenant
--
-- Ajoute a VatDeclarations les trois familles que le formulaire officiel connait depuis toujours
-- mais que le domaine ne portait pas : ConsumptionDuty (droit de consommation), HotelTax (taxe
-- hoteliere) et LicenceFee (droit de licence).
--
-- Strictement additif, defaut 0. Un dossier reste en calcul historique ne les alimente jamais : le
-- total a payer d'une declaration existante est donc inchange, au millime pres.
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Rejouable : chaque colonne est gardee par un test d'existence.

IF OBJECT_ID(N'[dbo].[VatDeclarations]', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.VatDeclarations', N'ConsumptionDuty') IS NULL
        ALTER TABLE [dbo].[VatDeclarations]
            ADD [ConsumptionDuty] decimal(18,3) NOT NULL
            CONSTRAINT [DF_VatDeclarations_ConsumptionDuty] DEFAULT (0);

    IF COL_LENGTH(N'dbo.VatDeclarations', N'HotelTax') IS NULL
        ALTER TABLE [dbo].[VatDeclarations]
            ADD [HotelTax] decimal(18,3) NOT NULL
            CONSTRAINT [DF_VatDeclarations_HotelTax] DEFAULT (0);

    IF COL_LENGTH(N'dbo.VatDeclarations', N'LicenceFee') IS NULL
        ALTER TABLE [dbo].[VatDeclarations]
            ADD [LicenceFee] decimal(18,3) NOT NULL
            CONSTRAINT [DF_VatDeclarations_LicenceFee] DEFAULT (0);
END;
GO
