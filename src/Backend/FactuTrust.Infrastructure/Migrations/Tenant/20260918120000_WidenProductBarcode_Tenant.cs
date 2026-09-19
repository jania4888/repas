using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Élargit <c>Products.Barcode</c> de <c>nvarchar(13)</c> à <c>nvarchar(48)</c>.
    ///
    /// <para>
    /// La colonne n'acceptait que de l'EAN-8 / EAN-13. Le catalogue doit aussi pouvoir porter
    /// un UPC-A (12 chiffres), un GTIN-14 de colis, et un Code128 alphanumérique — typiquement
    /// une référence fournisseur imprimée en code-barres. 48 caractères laissent de la marge
    /// tout en gardant la clé d'index à 96 octets, très en-deçà de la limite de 1700.
    /// </para>
    ///
    /// <para>
    /// ⚠️ <b>L'index filtré doit être supprimé avant l'ALTER.</b> <c>IX_Products_Barcode</c>
    /// porte le prédicat <c>[Barcode] IS NOT NULL</c> : la colonne est référencée par la
    /// définition de l'index, ce qui crée une dépendance de schéma et fait échouer
    /// <c>ALTER COLUMN</c> (erreur 5074). Une migration qui se contenterait de l'ALTER
    /// bloquerait le tenant au démarrage via <c>TenantMigrationGuard</c> (503
    /// <c>TENANT_MIGRATION_FAILED</c>). On supprime, on élargit, on recrée à l'identique.
    /// </para>
    ///
    /// <para>
    /// L'index reste délibérément <b>NON UNIQUE</b>. L'unicité par tenant ne sera livrée
    /// qu'après un balayage des doublons sur l'ensemble du parc — voir
    /// <c>docs/runbooks/invoice-number-uniqueness.md</c> et
    /// <c>docs/runbooks/barcode-cutover.md</c>. En attendant, c'est un contrôle applicatif
    /// (<c>Error.Conflict</c> à la création et à la mise à jour) qui arrête la production de
    /// nouveaux doublons.
    /// </para>
    ///
    /// <para>
    /// Seule migration non strictement additive du chantier, mais sûre en déploiement roulant :
    /// élargir un <c>nvarchar</c> est une opération de métadonnées seules, et une instance
    /// d'API non encore déployée continue de lire et d'écrire des valeurs de 13 caractères ou
    /// moins sur une colonne qui en accepte 48.
    /// </para>
    ///
    /// Écrite à la main (le snapshot du contexte tenant est désynchronisé, cf.
    /// <c>docs/backend-tenant-migrations.md</c>), idempotente, jumeau SQL :
    /// <c>docs/runbooks/sql/WidenProductBarcode_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20260918120000_WidenProductBarcode_Tenant")]
    public partial class WidenProductBarcode_Tenant : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // nvarchar(48) => max_length = 96 octets. La garde rend le rejeu inoffensif.
            migrationBuilder.Sql("""
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.Products')
      AND [name] = N'Barcode'
      AND [max_length] < 96
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE [name] = N'IX_Products_Barcode' AND [object_id] = OBJECT_ID(N'dbo.Products')
    )
        DROP INDEX [IX_Products_Barcode] ON [dbo].[Products];

    ALTER TABLE [dbo].[Products] ALTER COLUMN [Barcode] nvarchar(48) NULL;
END;
""");

            // Instruction séparée, gardée indépendamment : si un Up précédent s'est interrompu
            // entre le DROP et le CREATE, ce rejeu rétablit l'index sans toucher à la colonne.
            migrationBuilder.Sql("""
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE [name] = N'IX_Products_Barcode' AND [object_id] = OBJECT_ID(N'dbo.Products')
)
    CREATE INDEX [IX_Products_Barcode]
        ON [dbo].[Products] ([Barcode])
        WHERE [Barcode] IS NOT NULL;
""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Le retour arrière ne tronque JAMAIS : si un code-barres dépasse déjà 13
            // caractères, on laisse la colonne large plutôt que de perdre la donnée.
            migrationBuilder.Sql("""
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[Products]
    WHERE [Barcode] IS NOT NULL AND LEN([Barcode]) > 13
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE [name] = N'IX_Products_Barcode' AND [object_id] = OBJECT_ID(N'dbo.Products')
    )
        DROP INDEX [IX_Products_Barcode] ON [dbo].[Products];

    ALTER TABLE [dbo].[Products] ALTER COLUMN [Barcode] nvarchar(13) NULL;
END;
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE [name] = N'IX_Products_Barcode' AND [object_id] = OBJECT_ID(N'dbo.Products')
)
    CREATE INDEX [IX_Products_Barcode]
        ON [dbo].[Products] ([Barcode])
        WHERE [Barcode] IS NOT NULL;
""");
        }
    }
}
