using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Crée <c>VatDeclarationLines</c> : le détail par rubrique d'une déclaration mensuelle déposée.
    ///
    /// <para>
    /// Le code de rubrique, le libellé, la famille et le code rapport y sont <b>dénormalisés</b> :
    /// une rubrique renommée, ou dont le taux change, ne doit pas modifier d'un caractère un
    /// document déjà déposé. <c>RubricId</c> est conservé à titre de référence, <b>sans contrainte
    /// d'intégrité</b> vers <c>MonthlyDeclarationRubrics</c> — supprimer une rubrique de la
    /// configuration ne doit ni emporter ni bloquer les déclarations qu'elle a servi à produire.
    /// </para>
    ///
    /// <para>
    /// La table reste vide tant qu'aucun dossier n'est passé au calcul paramétré : une déclaration
    /// produite par le calcul historique n'a pas de rubrique à consigner.
    /// </para>
    ///
    /// Écrite à la main (le snapshot du contexte tenant est désynchronisé, cf.
    /// <c>docs/backend-tenant-migrations.md</c>), idempotente, jumeau SQL :
    /// <c>docs/runbooks/sql/AddVatDeclarationLines_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20260916120000_AddVatDeclarationLines_Tenant")]
    public partial class AddVatDeclarationLines_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[VatDeclarationLines]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[VatDeclarationLines] (
        [Id] uniqueidentifier NOT NULL,
        [VatDeclarationId] uniqueidentifier NOT NULL,
        [RubricId] uniqueidentifier NULL,
        [RubricCode] nvarchar(20) NOT NULL,
        [Label] nvarchar(200) NULL,
        [Family] int NOT NULL,
        [ReportCode] nvarchar(16) NULL,
        [GrossAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_GrossAmount] DEFAULT (0),
        [WithheldAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_WithheldAmount] DEFAULT (0),
        [RatePercentApplied] decimal(9,4) NOT NULL CONSTRAINT [DF_VatDeclarationLines_RatePercentApplied] DEFAULT (0),
        [ComputedGrossAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_ComputedGrossAmount] DEFAULT (0),
        [ComputedWithheldAmount] decimal(18,3) NOT NULL CONSTRAINT [DF_VatDeclarationLines_ComputedWithheldAmount] DEFAULT (0),
        [Origin] int NOT NULL CONSTRAINT [DF_VatDeclarationLines_Origin] DEFAULT (0),
        [DisplayOrder] int NOT NULL CONSTRAINT [DF_VatDeclarationLines_DisplayOrder] DEFAULT (0),
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_VatDeclarationLines] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_VatDeclarationLines_VatDeclarations] FOREIGN KEY ([VatDeclarationId])
            REFERENCES [dbo].[VatDeclarations] ([Id]) ON DELETE CASCADE
    );
END;
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_VatDeclarationLines_VatDeclarationId_RubricCode' AND [object_id] = OBJECT_ID(N'[dbo].[VatDeclarationLines]'))
    CREATE UNIQUE INDEX [IX_VatDeclarationLines_VatDeclarationId_RubricCode]
        ON [dbo].[VatDeclarationLines] ([VatDeclarationId], [RubricCode]);
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[VatDeclarationLines];");
        }
    }
}
