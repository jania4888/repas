-- Tracabilite du controle de solde des releves bancaires importes par l'IA (migration 20261005120000).
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Idempotent : rejouable sans effet de bord.
--
-- Uniquement ADDITIF : deux colonnes sur BankStatements (nullable / avec defaut), aucune donnee
-- reecrite, aucun index. Releves existants : BalanceDifference NULL (controle non trace),
-- BalanceAcknowledged 0. Aucun retour arriere de schema necessaire.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Ecart signe (millimes) recalcule cote serveur a la confirmation : NULL = non evalue, 0 = equilibre.
IF OBJECT_ID(N'dbo.BankStatements', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.BankStatements', N'BalanceDifference') IS NULL
    ALTER TABLE [dbo].[BankStatements] ADD [BalanceDifference] decimal(18,3) NULL;
GO

-- Accuse explicite de l'utilisateur quand un avertissement de solde subsistait (releve lu par l'IA).
IF OBJECT_ID(N'dbo.BankStatements', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.BankStatements', N'BalanceAcknowledged') IS NULL
    ALTER TABLE [dbo].[BankStatements] ADD [BalanceAcknowledged] bit NOT NULL
        CONSTRAINT [DF_BankStatements_BalanceAcknowledged] DEFAULT 0;
GO

-- Historique EF (si le script est passe a la main a la place de la migration).
-- EXEC : sans lui, la reference a __EFMigrationsHistory est compilee avant la garde et le lot
-- echoue sur une base qui n'a pas cette table.
IF OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U') IS NOT NULL
    EXEC(N'IF NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory]
                          WHERE [MigrationId] = N''20261005120000_AddBankStatementBalanceCheck_Tenant'')
               INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
               VALUES (N''20261005120000_AddBankStatementBalanceCheck_Tenant'', N''8.0.1'');');
GO
