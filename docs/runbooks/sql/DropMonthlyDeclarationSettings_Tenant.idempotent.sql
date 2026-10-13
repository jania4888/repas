-- Idempotent tenant migration: DropMonthlyDeclarationSettings_Tenant
-- MigrationId: 20261013100000_DropMonthlyDeclarationSettings_Tenant
--
-- Supprime MonthlyDeclarationSettings, la table du regime de calcul de la declaration mensuelle.
--
-- Le calcul cable a ete retire : il n'y a plus de regime a choisir, plus de rampe de controles de
-- parite a suivre, plus de derogation a consigner. Aucun code ne lit ni n'ecrit cette table depuis
-- la livraison precedente.
--
-- OPERATION DESTRUCTIVE. Son contenu -- regime, date d'effet, serie de controles, derogations avec
-- leur auteur et leur motif -- disparait. Ce qui comptait pour la suite a ete repris ailleurs :
--   * VatDeclarations.CalculationOrigin dit quel calcul a produit chaque depot (retro-rempli depuis
--     cette table par la migration 20260925100000, qui doit donc etre passee AVANT) ;
--   * les changements de regime restent lisibles dans l'audit, sous
--     Accounting.MonthlyDeclarationModeChanged.
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Rejouable : la suppression est gardee par un test d'existence.
--
-- Retour arriere : DropMonthlyDeclarationSettings_Tenant.rollback.sql (recree la table VIDE et
-- retire la ligne d'historique), a passer avec le retour d'image.

IF OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NOT NULL
    DROP TABLE [dbo].[MonthlyDeclarationSettings];
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261013100000_DropMonthlyDeclarationSettings_Tenant'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261013100000_DropMonthlyDeclarationSettings_Tenant', N'8.0.1');
END;
GO
