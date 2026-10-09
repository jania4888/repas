-- Projection plan comptable 5321/5324 vers BankAccounts sans RIB/IBAN.
-- Idempotent. Jumeau de 20261009120000_AllowBankAccountProjectionWithoutRib_Tenant.
IF OBJECT_ID(N'dbo.BankAccounts', N'U') IS NULL
    RETURN;

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BankAccounts_CompanyId_Iban' AND object_id = OBJECT_ID(N'dbo.BankAccounts'))
    DROP INDEX [IX_BankAccounts_CompanyId_Iban] ON [dbo].[BankAccounts];

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BankAccounts') AND name = N'Rib' AND is_nullable = 0)
    ALTER TABLE [dbo].[BankAccounts] ALTER COLUMN [Rib] nvarchar(20) NULL;

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BankAccounts') AND name = N'Iban' AND is_nullable = 0)
    ALTER TABLE [dbo].[BankAccounts] ALTER COLUMN [Iban] nvarchar(34) NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BankAccounts_CompanyId_Iban' AND object_id = OBJECT_ID(N'dbo.BankAccounts'))
    CREATE UNIQUE INDEX [IX_BankAccounts_CompanyId_Iban]
        ON [dbo].[BankAccounts] ([CompanyId], [Iban])
        WHERE [Iban] IS NOT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BankAccounts_CompanyId_ChartOfAccountNumber' AND object_id = OBJECT_ID(N'dbo.BankAccounts'))
    CREATE UNIQUE INDEX [IX_BankAccounts_CompanyId_ChartOfAccountNumber]
        ON [dbo].[BankAccounts] ([CompanyId], [ChartOfAccountNumber])
        WHERE [ChartOfAccountNumber] IS NOT NULL;

IF NOT EXISTS (
    SELECT 1 FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261009120000_AllowBankAccountProjectionWithoutRib_Tenant')
    INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261009120000_AllowBankAccountProjectionWithoutRib_Tenant', N'8.0.0');
