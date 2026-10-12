-- =============================================================================
-- Balayage de l'intégrité du lettrage (LetteringGroups / LetteringGroupMembers /
-- JournalEntryLines.LetteringCode) sur toutes les bases tenant d'une instance
-- SQL Server.
--
-- LECTURE SEULE — ne modifie aucune donnée.
--
-- Contexte : avant de déployer la migration ajoutant les index UNIQUE
-- (LetteringGroups.Code, LetteringGroupMembers.JournalEntryLineId), ce balayage
-- doit être exécuté sur TOUTES les bases tenant : une migration unique appliquée
-- sur une base contenant des anomalies échouerait au boot du tenant et le
-- bloquerait via TenantMigrationGuard.
--
-- Chemin privilégié : endpoint plateforme (PlatformAdmin)
--   GET /api/platform/migrations/tenants/lettering-integrity
-- Ce script est l'équivalent DBA quand l'API n'est pas disponible.
--
-- Anomalies détectées, par tenant :
--   1. codes de groupe en double (LetteringGroups.Code) ;
--   2. lignes membres de plusieurs groupes (LetteringGroupMembers.JournalEntryLineId) ;
--   3. membres orphelins (ligne d'écriture supprimée) ;
--   4. lignes dont LetteringCode ne correspond à aucun groupe ;
--   5. groupes dont une ligne membre porte un autre code (ou aucun) ;
--   6. présence ou absence des deux index UNIQUE.
--
-- Adapter @Pattern si la convention de nommage des bases tenant diffère.
-- Réparation : voir docs/runbooks/lettering-integrity.md.
-- =============================================================================

SET NOCOUNT ON;

DECLARE @Pattern sysname = N'FactuTrust[_]Tenant[_]%';

DECLARE @db sysname, @sql nvarchar(max);

DECLARE @results TABLE (
    DbName sysname PRIMARY KEY,
    LetteringGroupCount int NOT NULL,
    LetteredLineCount int NOT NULL,
    DuplicateCodeCount int NOT NULL,
    MultiGroupLineCount int NOT NULL,
    OrphanMemberCount int NOT NULL,
    DanglingCodeLineCount int NOT NULL,
    MismatchedCodeCount int NOT NULL,
    HasUniqueGroupCodeIndex bit NOT NULL,
    HasUniqueMemberLineIndex bit NOT NULL
);
DECLARE @duplicateCodes TABLE (DbName sysname, Code nvarchar(16), GroupCount int);
DECLARE @multiGroupLines TABLE (DbName sysname, JournalEntryLineId uniqueidentifier, GroupCode nvarchar(16));
DECLARE @orphanMembers TABLE (DbName sysname, JournalEntryLineId uniqueidentifier, GroupCode nvarchar(16));
DECLARE @danglingLines TABLE (DbName sysname, JournalEntryLineId uniqueidentifier, LetteringCode nvarchar(16));
DECLARE @mismatchedCodes TABLE (DbName sysname, JournalEntryLineId uniqueidentifier, GroupCode nvarchar(16), LineLetteringCode nvarchar(16));
DECLARE @skipped TABLE (DbName sysname, Reason nvarchar(400));

DECLARE db_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.databases
    WHERE name LIKE @Pattern
      AND state_desc = 'ONLINE'
    ORDER BY name;

OPEN db_cursor;
FETCH NEXT FROM db_cursor INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    BEGIN TRY
        IF OBJECT_ID(QUOTENAME(@db) + N'.dbo.LetteringGroups', N'U') IS NULL
        BEGIN
            INSERT INTO @skipped VALUES (@db, N'Pas de table LetteringGroups');
        END
        ELSE
        BEGIN
            DECLARE @groupCount int, @letteredLineCount int, @hasGroupIdx bit, @hasMemberIdx bit;
            DECLARE @t TABLE (GroupCount int, LetteredLineCount int, HasGroupIdx bit, HasMemberIdx bit);
            DELETE FROM @t;

            SET @sql = N'
                SELECT
                    (SELECT COUNT(*) FROM ' + QUOTENAME(@db) + N'.dbo.LetteringGroups),
                    (SELECT COUNT(*) FROM ' + QUOTENAME(@db) + N'.dbo.JournalEntryLines WHERE LetteringCode IS NOT NULL),
                    (SELECT CASE WHEN EXISTS (
                        SELECT 1 FROM ' + QUOTENAME(@db) + N'.sys.indexes ix
                        INNER JOIN ' + QUOTENAME(@db) + N'.sys.index_columns ic
                            ON ic.object_id = ix.object_id AND ic.index_id = ix.index_id AND ic.key_ordinal = 1
                        INNER JOIN ' + QUOTENAME(@db) + N'.sys.columns c
                            ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                        WHERE ix.object_id = OBJECT_ID(N''' + QUOTENAME(@db) + N'.dbo.LetteringGroups'')
                          AND ix.is_unique = 1 AND c.name = N''Code'') THEN 1 ELSE 0 END),
                    (SELECT CASE WHEN EXISTS (
                        SELECT 1 FROM ' + QUOTENAME(@db) + N'.sys.indexes ix
                        INNER JOIN ' + QUOTENAME(@db) + N'.sys.index_columns ic
                            ON ic.object_id = ix.object_id AND ic.index_id = ix.index_id AND ic.key_ordinal = 1
                        INNER JOIN ' + QUOTENAME(@db) + N'.sys.columns c
                            ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                        WHERE ix.object_id = OBJECT_ID(N''' + QUOTENAME(@db) + N'.dbo.LetteringGroupMembers'')
                          AND ix.is_unique = 1 AND c.name = N''JournalEntryLineId'') THEN 1 ELSE 0 END);';
            INSERT INTO @t EXEC sp_executesql @sql;
            SELECT @groupCount = GroupCount, @letteredLineCount = LetteredLineCount,
                   @hasGroupIdx = HasGroupIdx, @hasMemberIdx = HasMemberIdx FROM @t;

            -- 1. Codes de groupe en double.
            SET @sql = N'
                SELECT ''' + @db + N''', [Code], COUNT(*) FROM ' + QUOTENAME(@db) + N'.dbo.LetteringGroups
                GROUP BY [Code] HAVING COUNT(*) > 1;';
            INSERT INTO @duplicateCodes EXEC sp_executesql @sql;

            -- 2. Lignes membres de plusieurs groupes.
            SET @sql = N'
                SELECT ''' + @db + N''', m.JournalEntryLineId, g.Code
                FROM ' + QUOTENAME(@db) + N'.dbo.LetteringGroupMembers m
                INNER JOIN ' + QUOTENAME(@db) + N'.dbo.LetteringGroups g ON g.Id = m.LetteringGroupId
                WHERE m.JournalEntryLineId IN (
                    SELECT JournalEntryLineId FROM ' + QUOTENAME(@db) + N'.dbo.LetteringGroupMembers
                    GROUP BY JournalEntryLineId HAVING COUNT(*) > 1);';
            INSERT INTO @multiGroupLines EXEC sp_executesql @sql;

            -- 3. Membres orphelins (ligne supprimée).
            SET @sql = N'
                SELECT ''' + @db + N''', m.JournalEntryLineId, g.Code
                FROM ' + QUOTENAME(@db) + N'.dbo.LetteringGroupMembers m
                INNER JOIN ' + QUOTENAME(@db) + N'.dbo.LetteringGroups g ON g.Id = m.LetteringGroupId
                LEFT JOIN ' + QUOTENAME(@db) + N'.dbo.JournalEntryLines l ON l.Id = m.JournalEntryLineId
                WHERE l.Id IS NULL;';
            INSERT INTO @orphanMembers EXEC sp_executesql @sql;

            -- 4. LetteringCode sans groupe correspondant.
            SET @sql = N'
                SELECT ''' + @db + N''', l.Id, l.LetteringCode
                FROM ' + QUOTENAME(@db) + N'.dbo.JournalEntryLines l
                LEFT JOIN ' + QUOTENAME(@db) + N'.dbo.LetteringGroups g ON g.Code = l.LetteringCode
                WHERE l.LetteringCode IS NOT NULL AND g.Id IS NULL;';
            INSERT INTO @danglingLines EXEC sp_executesql @sql;

            -- 5. Groupe/ligne incohérents.
            SET @sql = N'
                SELECT ''' + @db + N''', m.JournalEntryLineId, g.Code, l.LetteringCode
                FROM ' + QUOTENAME(@db) + N'.dbo.LetteringGroupMembers m
                INNER JOIN ' + QUOTENAME(@db) + N'.dbo.LetteringGroups g ON g.Id = m.LetteringGroupId
                INNER JOIN ' + QUOTENAME(@db) + N'.dbo.JournalEntryLines l ON l.Id = m.JournalEntryLineId
                WHERE l.LetteringCode IS NULL OR l.LetteringCode <> g.Code;';
            INSERT INTO @mismatchedCodes EXEC sp_executesql @sql;

            INSERT INTO @results
            SELECT @db, @groupCount, @letteredLineCount,
                   (SELECT COUNT(*) FROM @duplicateCodes WHERE DbName = @db),
                   (SELECT COUNT(*) FROM @multiGroupLines WHERE DbName = @db),
                   (SELECT COUNT(*) FROM @orphanMembers WHERE DbName = @db),
                   (SELECT COUNT(*) FROM @danglingLines WHERE DbName = @db),
                   (SELECT COUNT(*) FROM @mismatchedCodes WHERE DbName = @db),
                   ISNULL(@hasGroupIdx, 0), ISNULL(@hasMemberIdx, 0);
        END
    END TRY
    BEGIN CATCH
        INSERT INTO @skipped VALUES (@db, LEFT(ERROR_MESSAGE(), 400));
    END CATCH
    FETCH NEXT FROM db_cursor INTO @db;
END
CLOSE db_cursor;
DEALLOCATE db_cursor;

-- Synthèse : les index uniques ne sont déployables partout que si BasesAvecAnomalies = 0
-- ET BasesIgnorees = 0 (fail-closed : une base injoignable n'est pas "propre").
SELECT
    COUNT(*) AS BasesScannees,
    ISNULL(SUM(LetteringGroupCount), 0) AS TotalGroupes,
    ISNULL(SUM(LetteredLineCount), 0) AS TotalLignesLettrees,
    SUM(CASE WHEN DuplicateCodeCount + MultiGroupLineCount + OrphanMemberCount
             + DanglingCodeLineCount + MismatchedCodeCount > 0 THEN 1 ELSE 0 END) AS BasesAvecAnomalies,
    SUM(CASE WHEN HasUniqueGroupCodeIndex = 0 THEN 1 ELSE 0 END) AS BasesSansIndexCode,
    SUM(CASE WHEN HasUniqueMemberLineIndex = 0 THEN 1 ELSE 0 END) AS BasesSansIndexMembre,
    (SELECT COUNT(*) FROM @skipped) AS BasesIgnorees
FROM @results;

-- Bases avec anomalies (arbitrage requis avant toute migration d'index unique)
SELECT * FROM @results
WHERE DuplicateCodeCount + MultiGroupLineCount + OrphanMemberCount
      + DanglingCodeLineCount + MismatchedCodeCount > 0
   OR HasUniqueGroupCodeIndex = 0 OR HasUniqueMemberLineIndex = 0
ORDER BY DbName;

-- Détail par catégorie d'anomalie.
SELECT * FROM @duplicateCodes ORDER BY DbName, Code;
SELECT * FROM @multiGroupLines ORDER BY DbName, JournalEntryLineId;
SELECT * FROM @orphanMembers ORDER BY DbName, GroupCode, JournalEntryLineId;
SELECT * FROM @danglingLines ORDER BY DbName, LetteringCode, JournalEntryLineId;
SELECT * FROM @mismatchedCodes ORDER BY DbName, GroupCode, JournalEntryLineId;

-- Bases ignorées ou en erreur
SELECT * FROM @skipped ORDER BY DbName;
