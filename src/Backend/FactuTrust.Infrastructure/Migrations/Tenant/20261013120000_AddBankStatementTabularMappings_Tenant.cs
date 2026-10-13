using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Mappage de colonnes CSV/XLSX mémorisé par compte bancaire pour l'import tabulaire de relevés
    /// (import de relevé → écritures, §3.7).
    ///
    /// <para>
    /// Uniquement ADDITIVE : une seule table nouvelle, <c>BankStatementTabularMappings</c>, avec un
    /// index unique sur <c>BankAccountId</c> (un mappage mémorisé par compte). Aucune table ni
    /// colonne existante n'est modifiée.
    /// </para>
    ///
    /// Écrite à la main (le snapshot du contexte tenant est désynchronisé, cf.
    /// <c>docs/backend-tenant-migrations.md</c>), idempotente, jumeau SQL :
    /// <c>docs/runbooks/sql/AddBankStatementTabularMappings_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20261013120000_AddBankStatementTabularMappings_Tenant")]
    public partial class AddBankStatementTabularMappings_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.BankStatementTabularMappings', N'U') IS NULL
CREATE TABLE [BankStatementTabularMappings] (
    [Id] uniqueidentifier NOT NULL,
    [BankAccountId] uniqueidentifier NOT NULL,
    [Format] nvarchar(10) NOT NULL,
    [MappingJson] nvarchar(4000) NOT NULL,
    [CreatedAt] datetime2 NOT NULL,
    [CreatedBy] nvarchar(256) NULL,
    [UpdatedAt] datetime2 NULL,
    [UpdatedBy] nvarchar(256) NULL,
    CONSTRAINT [PK_BankStatementTabularMappings] PRIMARY KEY ([Id])
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_BankStatementTabularMappings_BankAccountId'
               AND [object_id] = OBJECT_ID(N'dbo.BankStatementTabularMappings'))
    CREATE UNIQUE INDEX [IX_BankStatementTabularMappings_BankAccountId]
        ON [BankStatementTabularMappings] ([BankAccountId]);
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.BankStatementTabularMappings', N'U') IS NOT NULL
    DROP TABLE [dbo].[BankStatementTabularMappings];
""");
        }
    }
}
