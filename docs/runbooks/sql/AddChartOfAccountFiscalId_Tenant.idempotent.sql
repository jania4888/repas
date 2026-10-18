-- Matricule fiscal (MF) sur les comptes auxiliaires Client/Fournisseur (migration 20261018100000).
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Idempotent : rejouable sans effet de bord.
--
-- Additif : deux colonnes nullable sur ChartOfAccounts (FiscalId, FiscalIdNormalized) et un index
-- unique filtre sur (AccountType, FiscalIdNormalized), limite aux comptes auxiliaires actifs ou
-- inactifs (WHERE FiscalIdNormalized IS NOT NULL AND IsAuxiliary = 1). Aucun backfill : les comptes
-- existants restent a NULL. Aucune donnee reecrite.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Forme canonique affichee du matricule (ex. 1525071P/B/M/000).
IF OBJECT_ID(N'dbo.ChartOfAccounts', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalId') IS NULL
    ALTER TABLE [dbo].[ChartOfAccounts] ADD [FiscalId] nvarchar(20) NULL;
GO

-- Forme normalisee (lettres+chiffres majuscules) : unicite et rapprochement a l'import.
IF OBJECT_ID(N'dbo.ChartOfAccounts', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalIdNormalized') IS NULL
    ALTER TABLE [dbo].[ChartOfAccounts] ADD [FiscalIdNormalized] nvarchar(20) NULL;
GO

-- Index unique filtre. ONLINE = ON reserve aux editions Enterprise / Azure SQL ; repli hors ligne
-- sinon (la clause ferait echouer la creation sur Standard/Express). Si des doublons existent deja
-- (ne devrait pas arriver puisque la colonne vient d'etre ajoutee), l'index n'est PAS pose et un
-- message explicite est affiche -- ce script ne doit jamais faire echouer son execution.
DECLARE @withOnline nvarchar(40) =
    CASE WHEN CAST(SERVERPROPERTY('EngineEdition') AS int) IN (3, 5, 8) THEN N' WITH (ONLINE = ON)' ELSE N'' END;
DECLARE @sql nvarchar(max);

IF EXISTS (
    SELECT 1 FROM [dbo].[ChartOfAccounts]
    WHERE [FiscalIdNormalized] IS NOT NULL AND [IsAuxiliary] = 1
    GROUP BY [AccountType], [FiscalIdNormalized]
    HAVING COUNT(*) > 1)
BEGIN
    PRINT 'AddChartOfAccountFiscalId_Tenant : des comptes auxiliaires partagent deja un meme matricule fiscal pour le meme type, IX_ChartOfAccounts_AccountType_FiscalIdNormalized (UNIQUE) n''est PAS pose. Reparer les doublons puis rejouer ce script.';
END
ELSE IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChartOfAccounts_AccountType_FiscalIdNormalized' AND object_id = OBJECT_ID(N'[dbo].[ChartOfAccounts]'))
BEGIN
    SET @sql = N'CREATE UNIQUE NONCLUSTERED INDEX [IX_ChartOfAccounts_AccountType_FiscalIdNormalized]
        ON [dbo].[ChartOfAccounts] ([AccountType], [FiscalIdNormalized])
        WHERE [FiscalIdNormalized] IS NOT NULL AND [IsAuxiliary] = 1' + @withOnline + N';';
    EXEC sys.sp_executesql @sql;
END;
GO

-- Historique EF (si le script est passe a la main a la place de la migration).
-- EXEC : sans lui, la reference a __EFMigrationsHistory est compilee avant la garde et le lot
-- echoue sur une base qui n'a pas cette table.
IF OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U') IS NOT NULL
    EXEC(N'IF NOT EXISTS (SELECT 1 FROM [dbo].[__EFMigrationsHistory]
                          WHERE [MigrationId] = N''20261018100000_AddChartOfAccountFiscalId_Tenant'')
               INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
               VALUES (N''20261018100000_AddChartOfAccountFiscalId_Tenant'', N''8.0.1'');');
GO
