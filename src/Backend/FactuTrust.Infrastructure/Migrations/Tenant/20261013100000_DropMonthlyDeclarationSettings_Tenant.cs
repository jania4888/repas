using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using FactuTrust.Infrastructure.Persistence;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Supprime <c>MonthlyDeclarationSettings</c>, la table du régime de calcul de la déclaration
    /// mensuelle.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Le calcul câblé a été retiré : il n'y a plus de régime à choisir, plus de rampe de contrôles
    /// de parité à suivre, plus de dérogation à consigner. La table n'est plus lue ni écrite par
    /// aucun code depuis le lot précédent ; elle n'est supprimée qu'ici, pour qu'un retour d'image
    /// intermédiaire reste possible.
    /// </para>
    /// <para>
    /// <b>Opération destructive.</b> Son contenu — régime, date d'effet, série de contrôles,
    /// dérogations avec leur auteur et leur motif — disparaît. Ce qui comptait pour la suite a été
    /// repris ailleurs : <c>VatDeclarations.CalculationOrigin</c> dit quel calcul a produit chaque
    /// dépôt (rétro-rempli depuis cette table par la migration <c>20260925100000</c>), et les
    /// changements de régime restent lisibles dans l'audit sous
    /// <c>Accounting.MonthlyDeclarationModeChanged</c>.
    /// </para>
    /// <para>
    /// <c>Down</c> recrée la table <b>vide</b>, à l'identique de sa création d'origine
    /// (<c>20260916100000</c>) : c'est ce qui permet à l'image précédente de redémarrer. Elle y
    /// retrouve un dossier sans réglage, donc en calcul historique — cohérent avec les périodes
    /// antérieures.
    /// </para>
    /// <para>
    /// Écrite à la main (pas de <c>dotnet ef migrations add</c> : le snapshot du contexte tenant est
    /// désynchronisé, cf. <c>docs/backend-tenant-migrations.md</c>), idempotente, jumeaux SQL :
    /// <c>docs/runbooks/sql/DropMonthlyDeclarationSettings_Tenant.idempotent.sql</c> et son
    /// <c>.rollback.sql</c>.
    /// </para>
    /// </remarks>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20261013100000_DropMonthlyDeclarationSettings_Tenant")]
    public partial class DropMonthlyDeclarationSettings_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NOT NULL
    DROP TABLE [dbo].[MonthlyDeclarationSettings];
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[MonthlyDeclarationSettings]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[MonthlyDeclarationSettings] (
        [Id] uniqueidentifier NOT NULL,
        [Mode] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_Mode] DEFAULT (0),
        [ConfiguredSince] datetime2 NULL,
        [LastParityPeriodKey] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_LastParityPeriodKey] DEFAULT (0),
        [LastParityRunAt] datetime2 NULL,
        [LastParityMaxGapMillimes] bigint NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_LastParityMaxGapMillimes] DEFAULT (0),
        [ParityCleanStreak] int NOT NULL CONSTRAINT [DF_MonthlyDeclarationSettings_ParityCleanStreak] DEFAULT (0),
        [ParityOverrideBy] nvarchar(256) NULL,
        [ParityOverrideReason] nvarchar(500) NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_MonthlyDeclarationSettings] PRIMARY KEY ([Id])
    );
END;
""");
        }
    }
}
