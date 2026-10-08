-- Master DB : credentials Docstrange (Nanonets) sur PlatformAiSettings.
-- Jumeau de la migration EF 20261008000000_AddDocStrangeSettings_Master.
-- Idempotent : peut être rejoué sans erreur si les colonnes ou l'entrée d'historique existent déjà.
--
-- Pourquoi : Docstrange est un service d'EXTRACTION DOCUMENTAIRE externe, pas un LLM
-- conversationnel. Il n'apparaît donc ni dans LlmProviderKind ni dans ModelRef : on ne le
-- choisit pas comme un modèle. Ces colonnes ne portent que son activation et sa clé.
--
-- La clé est chiffrée par ASP.NET Core Data Protection (purpose « PlatformDocStrangeSecrets »)
-- avant d'arriver ici : la colonne ne contient JAMAIS la clé en clair. DocStrangeApiKeyLast4
-- porte les 4 derniers caractères en clair, pour l'affichage masqué du back-office.
--
-- Cutover ops (après cette migration) :
-- 1. Back-office plateforme > Configuration IA > section Docstrange : saisir la clé, activer, Enregistrer.
-- 2. Vérifier que GET /api/platform/ai-settings ne renvoie AUCUNE clé (seulement isApiKeyConfigured + last4).
-- 3. L'activation de la carte n'envoie encore rien : les relevés exigent en plus le drapeau
--    Accounting:BankStatementImport:DocStrangeEnabled, éteint par défaut.
-- 4. Retour arrière : désactiver la carte dans le back-office suffit ; les colonnes peuvent rester.

BEGIN TRANSACTION;
GO

IF COL_LENGTH('PlatformAiSettings', 'DocStrangeIsEnabled') IS NULL
BEGIN
    ALTER TABLE [PlatformAiSettings]
        ADD [DocStrangeIsEnabled] bit NOT NULL
            CONSTRAINT [DF_PlatformAiSettings_DocStrangeIsEnabled] DEFAULT 0;
END;
GO

IF COL_LENGTH('PlatformAiSettings', 'DocStrangeDisplayName') IS NULL
BEGIN
    ALTER TABLE [PlatformAiSettings] ADD [DocStrangeDisplayName] nvarchar(200) NULL;
END;
GO

IF COL_LENGTH('PlatformAiSettings', 'DocStrangeBaseUrl') IS NULL
BEGIN
    ALTER TABLE [PlatformAiSettings] ADD [DocStrangeBaseUrl] nvarchar(500) NULL;
END;
GO

IF COL_LENGTH('PlatformAiSettings', 'DocStrangeEncryptedApiKey') IS NULL
BEGIN
    ALTER TABLE [PlatformAiSettings] ADD [DocStrangeEncryptedApiKey] nvarchar(4000) NULL;
END;
GO

IF COL_LENGTH('PlatformAiSettings', 'DocStrangeApiKeyLast4') IS NULL
BEGIN
    ALTER TABLE [PlatformAiSettings] ADD [DocStrangeApiKeyLast4] nvarchar(4) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261008000000_AddDocStrangeSettings_Master'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261008000000_AddDocStrangeSettings_Master', N'8.0.1');
END;
GO

COMMIT;
GO
