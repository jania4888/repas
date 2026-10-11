-- Refonte de l'écran de lettrage « v2 » (plan de refonte, §6/§15, Annexe A §4.1).
-- Jumeau idempotent de la migration tenant 20261012100000_AddLetteringIntegrityIndexes_Tenant.
-- Additif pur (aucune donnée touchée), rejouable.
-- Inscrit aussi la ligne __EFMigrationsHistory (gardée) pour que MigrateAsync ne rejoue pas la
-- migration après une application manuelle de ce script (cf. AddAuditLogsEntityHistoryIndex_Tenant).

-- 1) IX_LetteringGroups_Code UNIQUE : compteur partagé L/P garanti unique en base (D7/D8),
--    défense ultime derrière la transaction Serializable de LetteringService.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroups_Code' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroups]'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroups_Code]
        ON [dbo].[LetteringGroups] ([Code]);
END;
GO

-- 2) IX_LetteringGroupMembers_JournalEntryLineId UNIQUE : remplace l'index non-unique posé par
--    AddAccountingModule_Tenant — une ligne d'écriture ne peut appartenir qu'à un seul groupe de
--    lettrage à la fois.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]') AND is_unique = 0)
BEGIN
    DROP INDEX [IX_LetteringGroupMembers_JournalEntryLineId] ON [dbo].[LetteringGroupMembers];
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroupMembers_JournalEntryLineId]
        ON [dbo].[LetteringGroupMembers] ([JournalEntryLineId]);
END;
GO

-- 3) IX_JournalEntryLines_AccountNumber_LetteringCode INCLUDE (JournalEntryId, DebitAmount,
--    CreditAmount, ThirdPartyId, ThirdPartyKind) : remplace IX_JournalEntryLines_AccountNumber —
--    requête principale de l'écran de lettrage, agrégats, contrôles de pré-clôture.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    DROP INDEX [IX_JournalEntryLines_AccountNumber] ON [dbo].[JournalEntryLines];
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber_LetteringCode' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_AccountNumber_LetteringCode]
        ON [dbo].[JournalEntryLines] ([AccountNumber], [LetteringCode])
        INCLUDE ([JournalEntryId], [DebitAmount], [CreditAmount], [ThirdPartyId], [ThirdPartyKind]);
END;
GO

-- 4) IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId filtré WHERE [ThirdPartyId] IS NOT NULL :
--    filtre tiers de l'écran de lettrage, lettrage auto des paiements.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId]
        ON [dbo].[JournalEntryLines] ([ThirdPartyKind], [ThirdPartyId])
        WHERE [ThirdPartyId] IS NOT NULL;
END;
GO

-- 5) IX_JournalEntries_EntryDate INCLUDE (Status, JournalCode, EntryNumber, AccountingPeriodId) :
--    filtre de dates de l'écran de lettrage, aujourd'hui absent.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntries_EntryDate' AND object_id = OBJECT_ID(N'[dbo].[JournalEntries]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_JournalEntries_EntryDate]
        ON [dbo].[JournalEntries] ([EntryDate])
        INCLUDE ([Status], [JournalCode], [EntryNumber], [AccountingPeriodId]);
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
