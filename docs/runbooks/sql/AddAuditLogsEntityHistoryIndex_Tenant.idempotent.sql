-- Studio IA 4.7 « v1.1 » — D5 (historique des enregistrements).
-- Jumeau idempotent de la migration tenant 20260918100000_AddAuditLogsEntityHistoryIndex_Tenant.
-- Couvre : WHERE EntityType = … AND EntityId = … ORDER BY CreatedAt DESC
-- (GET api/studio/records/{entityKey}/{id}/history). Additif pur, rejouable.
-- 4.7★2 (U7 / R37) : inscrit aussi la ligne __EFMigrationsHistory (gardée) pour que MigrateAsync
-- ne rejoue pas la migration après une application manuelle de ce script.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLogs_EntityHistory' AND object_id = OBJECT_ID(N'[dbo].[AuditLogs]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AuditLogs_EntityHistory]
        ON [dbo].[AuditLogs] ([EntityType], [EntityId], [CreatedAt]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260918100000_AddAuditLogsEntityHistoryIndex_Tenant'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260918100000_AddAuditLogsEntityHistoryIndex_Tenant', N'8.0.1');
END;
GO
