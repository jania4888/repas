using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Ajoute à <c>VatDeclarations</c> les trois familles que le formulaire officiel connaît depuis
    /// toujours mais que le domaine ne portait pas, faute d'une source de calcul :
    /// <c>ConsumptionDuty</c> (droit de consommation), <c>HotelTax</c> (taxe hôtelière) et
    /// <c>LicenceFee</c> (droit de licence).
    ///
    /// <para>
    /// Strictement additif, défaut 0. Un dossier resté en calcul historique ne les alimente jamais :
    /// le total à payer d'une déclaration existante est donc inchangé, au millime près. Seul le
    /// moteur paramétré, une fois le dossier basculé, y écrit quelque chose.
    /// </para>
    ///
    /// Écrite à la main (le snapshot du contexte tenant est désynchronisé, cf.
    /// <c>docs/backend-tenant-migrations.md</c>), idempotente, jumeau SQL :
    /// <c>docs/runbooks/sql/AddMonthlyDeclarationFamilyTaxes_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20260916110000_AddMonthlyDeclarationFamilyTaxes_Tenant")]
    public partial class AddMonthlyDeclarationFamilyTaxes_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[VatDeclarations]', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.VatDeclarations', N'ConsumptionDuty') IS NULL
        ALTER TABLE [dbo].[VatDeclarations]
            ADD [ConsumptionDuty] decimal(18,3) NOT NULL
            CONSTRAINT [DF_VatDeclarations_ConsumptionDuty] DEFAULT (0);

    IF COL_LENGTH(N'dbo.VatDeclarations', N'HotelTax') IS NULL
        ALTER TABLE [dbo].[VatDeclarations]
            ADD [HotelTax] decimal(18,3) NOT NULL
            CONSTRAINT [DF_VatDeclarations_HotelTax] DEFAULT (0);

    IF COL_LENGTH(N'dbo.VatDeclarations', N'LicenceFee') IS NULL
        ALTER TABLE [dbo].[VatDeclarations]
            ADD [LicenceFee] decimal(18,3) NOT NULL
            CONSTRAINT [DF_VatDeclarations_LicenceFee] DEFAULT (0);
END;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.VatDeclarations', N'LicenceFee') IS NOT NULL
    ALTER TABLE [dbo].[VatDeclarations] DROP CONSTRAINT [DF_VatDeclarations_LicenceFee],
        COLUMN [LicenceFee];
IF COL_LENGTH(N'dbo.VatDeclarations', N'HotelTax') IS NOT NULL
    ALTER TABLE [dbo].[VatDeclarations] DROP CONSTRAINT [DF_VatDeclarations_HotelTax],
        COLUMN [HotelTax];
IF COL_LENGTH(N'dbo.VatDeclarations', N'ConsumptionDuty') IS NOT NULL
    ALTER TABLE [dbo].[VatDeclarations] DROP CONSTRAINT [DF_VatDeclarations_ConsumptionDuty],
        COLUMN [ConsumptionDuty];
""");
        }
    }
}
