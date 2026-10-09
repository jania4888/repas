using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Projection plan comptable → trésorerie : RIB et IBAN nullable, unicité filtrée
    /// (CompanyId, Iban) et (CompanyId, ChartOfAccountNumber). Idempotente.
    /// Jumeau SQL : docs/runbooks/sql/AllowBankAccountProjectionWithoutRib_Tenant.idempotent.sql.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20261009120000_AllowBankAccountProjectionWithoutRib_Tenant")]
    public partial class AllowBankAccountProjectionWithoutRib_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
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
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.BankAccounts', N'U') IS NULL
    RETURN;

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BankAccounts_CompanyId_ChartOfAccountNumber' AND object_id = OBJECT_ID(N'dbo.BankAccounts'))
    DROP INDEX [IX_BankAccounts_CompanyId_ChartOfAccountNumber] ON [dbo].[BankAccounts];

UPDATE [dbo].[BankAccounts] SET [Rib] = N'' WHERE [Rib] IS NULL;
UPDATE [dbo].[BankAccounts] SET [Iban] = N'' WHERE [Iban] IS NULL;

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BankAccounts_CompanyId_Iban' AND object_id = OBJECT_ID(N'dbo.BankAccounts'))
    DROP INDEX [IX_BankAccounts_CompanyId_Iban] ON [dbo].[BankAccounts];

ALTER TABLE [dbo].[BankAccounts] ALTER COLUMN [Rib] nvarchar(20) NOT NULL;
ALTER TABLE [dbo].[BankAccounts] ALTER COLUMN [Iban] nvarchar(34) NOT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BankAccounts_CompanyId_Iban' AND object_id = OBJECT_ID(N'dbo.BankAccounts'))
    CREATE UNIQUE INDEX [IX_BankAccounts_CompanyId_Iban]
        ON [dbo].[BankAccounts] ([CompanyId], [Iban]);
""");
        }
    }
}
