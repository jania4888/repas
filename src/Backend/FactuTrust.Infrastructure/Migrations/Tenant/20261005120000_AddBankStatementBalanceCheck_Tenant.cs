using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Traçabilité du contrôle de solde d'un relevé bancaire enregistré par l'import IA (D4) :
    /// deux colonnes sur <c>BankStatements</c>.
    ///
    /// <list type="bullet">
    ///   <item><c>BalanceDifference</c> decimal(18,3) NULL — écart signé recalculé côté serveur à la
    ///   confirmation ; <c>NULL</c> = contrôle non évalué ou non tracé (relevés antérieurs),
    ///   <c>0</c> = équilibré, autre = import confirmé avec écart.</item>
    ///   <item><c>BalanceAcknowledged</c> bit NOT NULL DEFAULT 0 — l'utilisateur a explicitement
    ///   accusé l'écart (relevé lu entièrement par l'IA).</item>
    /// </list>
    ///
    /// Uniquement ADDITIVE (colonnes nullable / avec défaut, aucune donnée réécrite, aucun index),
    /// idempotente et sans retour arrière de schéma nécessaire. Écrite à la main (le snapshot du
    /// contexte tenant est désynchronisé, cf. <c>docs/backend-tenant-migrations.md</c>), jumeau SQL :
    /// <c>docs/runbooks/sql/AddBankStatementBalanceCheck_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20261005120000_AddBankStatementBalanceCheck_Tenant")]
    public partial class AddBankStatementBalanceCheck_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.BankStatements', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.BankStatements', N'BalanceDifference') IS NULL
    ALTER TABLE [dbo].[BankStatements] ADD [BalanceDifference] decimal(18,3) NULL;

IF OBJECT_ID(N'dbo.BankStatements', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.BankStatements', N'BalanceAcknowledged') IS NULL
    ALTER TABLE [dbo].[BankStatements] ADD [BalanceAcknowledged] bit NOT NULL
        CONSTRAINT [DF_BankStatements_BalanceAcknowledged] DEFAULT 0;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // La contrainte par défaut est retrouvée par la colonne (nom explicite de cette migration
            // ou nom généré par EF sur une base créée depuis le modèle) : un rollback rejoué n'échoue pas.
            migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.BankStatements', N'BalanceAcknowledged') IS NOT NULL
BEGIN
    DECLARE @df sysname = (
        SELECT dc.[name]
        FROM sys.default_constraints dc
        JOIN sys.columns c ON c.[object_id] = dc.parent_object_id AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID(N'dbo.BankStatements') AND c.[name] = N'BalanceAcknowledged');
    IF @df IS NOT NULL
        EXEC(N'ALTER TABLE [dbo].[BankStatements] DROP CONSTRAINT [' + @df + N'];');
    ALTER TABLE [dbo].[BankStatements] DROP COLUMN [BalanceAcknowledged];
END;

IF COL_LENGTH(N'dbo.BankStatements', N'BalanceDifference') IS NOT NULL
    ALTER TABLE [dbo].[BankStatements] DROP COLUMN [BalanceDifference];
""");
        }
    }
}
