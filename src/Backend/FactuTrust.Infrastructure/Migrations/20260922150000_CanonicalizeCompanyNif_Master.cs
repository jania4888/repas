using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Forme carte du matricule fiscal (<c>1772793W/A/M/000</c>).
/// Réécrit uniquement l'écriture historique stricte sur les colonnes d'identité vivante.
/// Les pièces déjà émises (honoraires, audits, snapshots JSON) ne sont pas touchées.
/// Avant l'UPDATE, deux tenants actifs dont les matricules distincts se rabattent sur la
/// même forme font échouer la migration : aucune fusion, aucune suppression.
/// <c>NifCanonical</c> est une colonne calculée persistée : l'index unique filtré refuse
/// ensuite les deux écritures du même matricule, y compris si un ancien processus insère
/// encore la forme historique.
/// </summary>
[DbContext(typeof(MasterDbContext))]
[Migration("20260922150000_CanonicalizeCompanyNif_Master")]
public partial class CanonicalizeCompanyNif_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql($"""
{NifCanonicalSql.ThrowOnDistinctSpellingCollision(
    "[dbo].[Tenants]",
    "[NIF]",
    "[IsActive] = 1",
    "NIF canonical collision among active tenants")}

UPDATE [dbo].[Tenants]
SET [NIF] = {NifCanonicalSql.RewriteLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.LegacyPredicate("[NIF]")};

UPDATE [dbo].[PermanentFiles]
SET [Nif] = {NifCanonicalSql.RewriteLegacyAssignment("[Nif]")}
WHERE {NifCanonicalSql.LegacyPredicate("[Nif]")};

UPDATE [dbo].[PlatformFiscalSettings]
SET [Nif] = {NifCanonicalSql.RewriteLegacyAssignment("[Nif]")}
WHERE {NifCanonicalSql.LegacyPredicate("[Nif]")};

IF COL_LENGTH(N'dbo.Tenants', N'NifCanonical') IS NULL
    ALTER TABLE [dbo].[Tenants] ADD [NifCanonical] AS ({NifCanonicalSql.CanonExpression("[NIF]")}) PERSISTED;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_Tenants_NifCanonical' AND object_id = OBJECT_ID(N'dbo.Tenants'))
    CREATE UNIQUE INDEX [IX_Tenants_NifCanonical]
        ON [dbo].[Tenants] ([NifCanonical])
        WHERE [NIF] IS NOT NULL AND [IsActive] = 1;
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql($"""
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_Tenants_NifCanonical' AND object_id = OBJECT_ID(N'dbo.Tenants'))
    DROP INDEX [IX_Tenants_NifCanonical] ON [dbo].[Tenants];

IF COL_LENGTH(N'dbo.Tenants', N'NifCanonical') IS NOT NULL
    ALTER TABLE [dbo].[Tenants] DROP COLUMN [NifCanonical];

UPDATE [dbo].[Tenants]
SET [NIF] = {NifCanonicalSql.RewriteOfficialToLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.OfficialPredicate("[NIF]")};

UPDATE [dbo].[PermanentFiles]
SET [Nif] = {NifCanonicalSql.RewriteOfficialToLegacyAssignment("[Nif]")}
WHERE {NifCanonicalSql.OfficialPredicate("[Nif]")};

UPDATE [dbo].[PlatformFiscalSettings]
SET [Nif] = {NifCanonicalSql.RewriteOfficialToLegacyAssignment("[Nif]")}
WHERE {NifCanonicalSql.OfficialPredicate("[Nif]")};
""");
    }
}
