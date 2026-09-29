using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Prépare le retrait du calcul historique de la déclaration mensuelle.
    ///
    /// <para>
    /// <c>MonthlyDeclarationRubrics.GrossDocumentSource</c> / <c>WithheldDocumentSource</c> : la
    /// valeur documentaire (factures, rapport de retenue à la source) qu'une rubrique d'origine
    /// « documents » consomme. Nullables : aucune rubrique existante ne les utilise, et une image
    /// plus ancienne les ignore.
    /// </para>
    ///
    /// <para>
    /// <c>VatDeclarations.CalculationOrigin</c> : le calcul qui a produit une déclaration enregistrée
    /// (0 = historique, 1 = paramétré). Défaut SQL 0 — toute déclaration existante vient du calcul
    /// historique, et une image plus ancienne qui n'écrit pas la colonne insère sans erreur.
    /// Rétro-remplie à 1 pour les périodes d'un dossier déjà basculé (<c>Mode = 2</c>, mois ≥
    /// <c>ConfiguredSince</c>) : c'est la règle même de <c>ResolveModeFor</c>. La présence de lignes
    /// ne suffit pas : un dépôt en contrôle de parité en porte, avec des montants historiques.
    /// </para>
    ///
    /// Écrite à la main (le snapshot du contexte tenant est désynchronisé, cf.
    /// <c>docs/backend-tenant-migrations.md</c>), idempotente, jumeau SQL :
    /// <c>docs/runbooks/sql/AddMonthlyDeclarationDocumentSources_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20260925100000_AddMonthlyDeclarationDocumentSources_Tenant")]
    public partial class AddMonthlyDeclarationDocumentSources_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[MonthlyDeclarationRubrics]', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.MonthlyDeclarationRubrics', N'GrossDocumentSource') IS NULL
        ALTER TABLE [dbo].[MonthlyDeclarationRubrics] ADD [GrossDocumentSource] int NULL;

    IF COL_LENGTH(N'dbo.MonthlyDeclarationRubrics', N'WithheldDocumentSource') IS NULL
        ALTER TABLE [dbo].[MonthlyDeclarationRubrics] ADD [WithheldDocumentSource] int NULL;
END;

IF OBJECT_ID(N'[dbo].[VatDeclarations]', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.VatDeclarations', N'CalculationOrigin') IS NULL
BEGIN
    ALTER TABLE [dbo].[VatDeclarations]
        ADD [CalculationOrigin] int NOT NULL
        CONSTRAINT [DF_VatDeclarations_CalculationOrigin] DEFAULT (0);
END;

-- Rétro-remplissage : ne passe qu'à 1, jamais à 0 — rejouable sans rien défaire.
-- EXEC : une colonne ajoutée dans le même lot n'est pas encore connue à la compilation.
IF COL_LENGTH(N'dbo.VatDeclarations', N'CalculationOrigin') IS NOT NULL
   AND OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NOT NULL
BEGIN
    EXEC(N'
UPDATE v
SET v.[CalculationOrigin] = 1
FROM [dbo].[VatDeclarations] AS v
CROSS JOIN (SELECT TOP (1) [Mode], [ConfiguredSince] FROM [dbo].[MonthlyDeclarationSettings]) AS s
WHERE s.[Mode] = 2
  AND s.[ConfiguredSince] IS NOT NULL
  AND DATEFROMPARTS(v.[Year], v.[Month], 1) >= CAST(s.[ConfiguredSince] AS date)
  AND v.[CalculationOrigin] = 0;');
END;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.VatDeclarations', N'CalculationOrigin') IS NOT NULL
    ALTER TABLE [dbo].[VatDeclarations] DROP CONSTRAINT [DF_VatDeclarations_CalculationOrigin],
        COLUMN [CalculationOrigin];
IF COL_LENGTH(N'dbo.MonthlyDeclarationRubrics', N'WithheldDocumentSource') IS NOT NULL
    ALTER TABLE [dbo].[MonthlyDeclarationRubrics] DROP COLUMN [WithheldDocumentSource];
IF COL_LENGTH(N'dbo.MonthlyDeclarationRubrics', N'GrossDocumentSource') IS NOT NULL
    ALTER TABLE [dbo].[MonthlyDeclarationRubrics] DROP COLUMN [GrossDocumentSource];
""");
        }
    }
}
