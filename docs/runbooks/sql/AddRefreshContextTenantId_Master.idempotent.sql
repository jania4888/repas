-- Master DB : contexte dossier conservé sur le refresh token (Users.RefreshContextTenantId).
-- Jumeau de la migration EF 20260922130000_AddRefreshContextTenantId_Master.
-- Idempotent : peut être rejoué sans erreur si la colonne ou l'entrée d'historique existe déjà.
--
-- Colonne NULLABLE et purement additive : NULL = session native (comportement inchangé). Elle est
-- écrite à chaque émission de jeton, en même temps que la rotation du refresh token, et remise à
-- NULL dès qu'un jeton natif est émis.
--
-- Pourquoi : POST /api/auth/refresh ré-émettait un jeton « native » sur le tenant du cabinet, sans
-- context_tenant_id. L'intercepteur front rejouant la requête en silence, un collaborateur qui
-- consultait un dossier client lisait au bout de 15 minutes la base DU CABINET, avec le même écran
-- et sans erreur. Aucun droit n'est conféré par la colonne : l'affectation cabinet <-> dossier est
-- revalidée à chaque rafraîchissement, et une affectation révoquée renvoie la session au cabinet.

BEGIN TRANSACTION;
GO

IF COL_LENGTH('Users', 'RefreshContextTenantId') IS NULL
BEGIN
    ALTER TABLE [Users]
        ADD [RefreshContextTenantId] uniqueidentifier NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260922130000_AddRefreshContextTenantId_Master'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260922130000_AddRefreshContextTenantId_Master', N'8.0.1');
END;
GO

COMMIT;
GO
