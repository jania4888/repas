-- Refonte de l'écran de lettrage « v2 » (plan de refonte, §6/§15, Annexe A §4.1).
-- Jumeau idempotent de la migration tenant 20261012100000_AddLetteringIntegrityIndexes_Tenant.
-- Additif pur (aucune donnée touchée), rejouable.
-- Inscrit aussi la ligne __EFMigrationsHistory (gardée) pour que MigrateAsync ne rejoue pas la
-- migration après une application manuelle de ce script (cf. AddAuditLogsEntityHistoryIndex_Tenant).
--
-- ONLINE = ON : réservé aux éditions Enterprise / Azure SQL (EngineEdition 3, 5, 8, détecté via
-- SERVERPROPERTY) ; sur Standard/Express la clause ferait échouer le script — repli hors ligne.
-- Les CREATE passent par sys.sp_executesql (une clause WITH ne se paramètre pas en T-SQL statique ;
-- EXEC n'accepte pas d'expression — l'instruction est assemblée dans @sql puis exécutée).
-- Les variables @withOnline et @sql sont redéclarées dans CHAQUE batch (GO réinitialise les variables).

-- 1) IX_LetteringGroups_Code UNIQUE : compteur partagé L/P garanti unique en base (D7/D8),
--    défense ultime derrière la transaction Serializable de LetteringService.
--    Posé SEULEMENT si aucun doublon de Code n'existe (plan §6 item 5) : un tenant non assaini par
--    le pré-scan (runbook docs/runbooks/lettering-integrity.md) ne doit jamais être bloqué.
DECLARE @withOnline nvarchar(40) =
    CASE WHEN CAST(SERVERPROPERTY('EngineEdition') AS int) IN (3, 5, 8) THEN N' WITH (ONLINE = ON)' ELSE N'' END;
DECLARE @sql nvarchar(max);

IF EXISTS (SELECT 1 FROM [dbo].[LetteringGroups] GROUP BY [Code] HAVING COUNT(*) > 1)
BEGIN
    PRINT 'AddLetteringIntegrityIndexes_Tenant : des doublons de Code existent dans LetteringGroups, IX_LetteringGroups_Code (UNIQUE) n''est PAS posé. Réparer via le runbook docs/runbooks/lettering-integrity.md puis rejouer ce script.';
END
ELSE IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroups_Code' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroups]'))
BEGIN
    SET @sql = N'CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroups_Code]
        ON [dbo].[LetteringGroups] ([Code])' + @withOnline + N';';
    EXEC sys.sp_executesql @sql;
END;
GO

-- 2) IX_LetteringGroupMembers_JournalEntryLineId UNIQUE : remplace l'index non-unique posé par
--    AddAccountingModule_Tenant — une ligne d'écriture ne peut appartenir qu'à un seul groupe de
--    lettrage à la fois. Posé SEULEMENT si aucun doublon de JournalEntryLineId n'existe (plan §6
--    item 5) ; sinon l'index non-unique existant est explicitement conservé (ni DROP ni CREATE).
DECLARE @withOnline nvarchar(40) =
    CASE WHEN CAST(SERVERPROPERTY('EngineEdition') AS int) IN (3, 5, 8) THEN N' WITH (ONLINE = ON)' ELSE N'' END;
DECLARE @sql nvarchar(max);

IF EXISTS (SELECT 1 FROM [dbo].[LetteringGroupMembers] GROUP BY [JournalEntryLineId] HAVING COUNT(*) > 1)
BEGIN
    PRINT 'AddLetteringIntegrityIndexes_Tenant : des lignes d''écriture appartiennent déjà à plusieurs groupes de lettrage, IX_LetteringGroupMembers_JournalEntryLineId (UNIQUE) n''est PAS posé — l''index non-unique existant est conservé. Réparer via le runbook docs/runbooks/lettering-integrity.md puis rejouer ce script.';
END
ELSE
BEGIN
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]') AND is_unique = 0)
    BEGIN
        DROP INDEX [IX_LetteringGroupMembers_JournalEntryLineId] ON [dbo].[LetteringGroupMembers];
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]'))
    BEGIN
        SET @sql = N'CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroupMembers_JournalEntryLineId]
            ON [dbo].[LetteringGroupMembers] ([JournalEntryLineId])' + @withOnline + N';';
    EXEC sys.sp_executesql @sql;
    END;
END;
GO

-- 3) IX_JournalEntryLines_AccountNumber_LetteringCode INCLUDE (JournalEntryId, DebitAmount,
--    CreditAmount, ThirdPartyId, ThirdPartyKind) : remplace IX_JournalEntryLines_AccountNumber —
--    requête principale de l'écran de lettrage, agrégats, contrôles de pré-clôture.
DECLARE @withOnline nvarchar(40) =
    CASE WHEN CAST(SERVERPROPERTY('EngineEdition') AS int) IN (3, 5, 8) THEN N' WITH (ONLINE = ON)' ELSE N'' END;
DECLARE @sql nvarchar(max);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    DROP INDEX [IX_JournalEntryLines_AccountNumber] ON [dbo].[JournalEntryLines];
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber_LetteringCode' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    SET @sql = N'CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_AccountNumber_LetteringCode]
        ON [dbo].[JournalEntryLines] ([AccountNumber], [LetteringCode])
        INCLUDE ([JournalEntryId], [DebitAmount], [CreditAmount], [ThirdPartyId], [ThirdPartyKind])' + @withOnline + N';';
    EXEC sys.sp_executesql @sql;
END;
GO

-- 4) IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId filtré WHERE [ThirdPartyId] IS NOT NULL :
--    filtre tiers de l'écran de lettrage, lettrage auto des paiements.
DECLARE @withOnline nvarchar(40) =
    CASE WHEN CAST(SERVERPROPERTY('EngineEdition') AS int) IN (3, 5, 8) THEN N' WITH (ONLINE = ON)' ELSE N'' END;
DECLARE @sql nvarchar(max);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    SET @sql = N'CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId]
        ON [dbo].[JournalEntryLines] ([ThirdPartyKind], [ThirdPartyId])
        WHERE [ThirdPartyId] IS NOT NULL' + @withOnline + N';';
    EXEC sys.sp_executesql @sql;
END;
GO

-- 5) IX_JournalEntries_EntryDate INCLUDE (Status, JournalCode, EntryNumber, AccountingPeriodId) :
--    filtre de dates de l'écran de lettrage, aujourd'hui absent.
DECLARE @withOnline nvarchar(40) =
    CASE WHEN CAST(SERVERPROPERTY('EngineEdition') AS int) IN (3, 5, 8) THEN N' WITH (ONLINE = ON)' ELSE N'' END;
DECLARE @sql nvarchar(max);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntries_EntryDate' AND object_id = OBJECT_ID(N'[dbo].[JournalEntries]'))
BEGIN
    SET @sql = N'CREATE NONCLUSTERED INDEX [IX_JournalEntries_EntryDate]
        ON [dbo].[JournalEntries] ([EntryDate])
        INCLUDE ([Status], [JournalCode], [EntryNumber], [AccountingPeriodId])' + @withOnline + N';';
    EXEC sys.sp_executesql @sql;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012100000_AddLetteringIntegrityIndexes_Tenant'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261012100000_AddLetteringIntegrityIndexes_Tenant', N'8.0.1');
END;
GO
