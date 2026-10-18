using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Matricule fiscal (MF) sur les comptes auxiliaires Client/Fournisseur (plan « Matricule fiscal
    /// sur les comptes auxiliaires et rattachement à l'import de facture », §5.2) : deux colonnes sur
    /// <c>ChartOfAccounts</c> et un index unique filtré.
    ///
    /// <list type="bullet">
    ///   <item><c>FiscalId</c> nvarchar(20) NULL — forme canonique affichée (ex.
    ///   <c>1525071P/B/M/000</c>), posée par <c>ChartOfAccount.SetFiscalId</c>.</item>
    ///   <item><c>FiscalIdNormalized</c> nvarchar(20) NULL — lettres+chiffres majuscules, sert à
    ///   l'unicité et au rapprochement par matricule fiscal à l'import de factures.</item>
    ///   <item><c>IX_ChartOfAccounts_AccountType_FiscalIdNormalized</c> UNIQUE filtré
    ///   <c>WHERE [FiscalIdNormalized] IS NOT NULL AND [IsAuxiliary] = 1</c> sur
    ///   (<c>AccountType</c>, <c>FiscalIdNormalized</c>) — un même matricule ne peut désigner deux
    ///   comptes auxiliaires du même type (Client ou Fournisseur), qu'ils soient actifs ou inactifs
    ///   (réactiver un compte via <c>ToggleAccountActiveCommand</c> ne doit jamais créer de doublon
    ///   avec un compte déjà actif sur le même matricule).</item>
    /// </list>
    ///
    /// <para>
    /// Aucun backfill : les comptes existants gardent <c>FiscalId</c>/<c>FiscalIdNormalized</c> NULL
    /// (aucune source fiable pour les déduire rétroactivement des comptes auxiliaires déjà créés).
    /// </para>
    ///
    /// <para>
    /// L'index est créé via <c>sys.sp_executesql</c> parce que la colonne qu'il porte
    /// (<c>FiscalIdNormalized</c>) est ajoutée dans le même lot : un <c>CREATE INDEX</c> statique
    /// échouerait à la compilation avec « Invalid column name 'FiscalIdNormalized' ». Avant de le
    /// poser, la migration vérifie l'absence de doublon existant
    /// (<c>GROUP BY ... HAVING COUNT(*) &gt; 1</c>, impossible ici puisque la colonne vient d'être
    /// ajoutée et est entièrement NULL, mais le garde-fou est conservé par cohérence avec les autres
    /// migrations qui posent un index unique) ; en cas de doublon la migration se contente d'un
    /// <c>PRINT</c> et NE POSE PAS l'index — elle ne doit jamais faire échouer le démarrage d'un
    /// tenant via <c>TenantMigrationGuard</c> (503 <c>TENANT_MIGRATION_FAILED</c>).
    /// </para>
    ///
    /// <para>
    /// <c>WITH (ONLINE = ON)</c> uniquement sur les éditions qui le permettent (Enterprise / Azure
    /// SQL : <c>SERVERPROPERTY('EngineEdition')</c> ∈ 3, 5, 8), repli hors ligne sinon (la clause
    /// ferait échouer la migration sur Standard/Express).
    /// </para>
    ///
    /// <para>
    /// Additif pur, écrit à la main (le snapshot du contexte tenant est désynchronisé, cf.
    /// <c>docs/backend-tenant-migrations.md</c>), idempotent, jumeau SQL :
    /// <c>docs/runbooks/sql/AddChartOfAccountFiscalId_Tenant.idempotent.sql</c>.
    /// </para>
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20261018100000_AddChartOfAccountFiscalId_Tenant")]
    public partial class AddChartOfAccountFiscalId_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.ChartOfAccounts', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalId') IS NULL
    ALTER TABLE [dbo].[ChartOfAccounts] ADD [FiscalId] nvarchar(20) NULL;

IF OBJECT_ID(N'dbo.ChartOfAccounts', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalIdNormalized') IS NULL
    ALTER TABLE [dbo].[ChartOfAccounts] ADD [FiscalIdNormalized] nvarchar(20) NULL;

-- ONLINE = ON : réservé aux éditions Enterprise / Azure SQL (EngineEdition 3, 5, 8) ; sur
-- Standard/Express la clause ferait échouer la migration — repli sur une création hors ligne.
DECLARE @withOnline nvarchar(40) =
    CASE WHEN CAST(SERVERPROPERTY('EngineEdition') AS int) IN (3, 5, 8) THEN N' WITH (ONLINE = ON)' ELSE N'' END;
-- sp_executesql n'accepte pas d'expression : le CREATE est assemblé dans @sql puis exécuté. Requis
-- ici de toute façon car FiscalIdNormalized vient d'être ajoutée dans ce même lot (« Invalid column
-- name » à la compilation sur un CREATE INDEX statique).
DECLARE @sql nvarchar(max);

-- Garde-fou de cohérence avec les autres migrations qui posent un index unique : la colonne venant
-- d'être ajoutée et étant entièrement NULL ci-dessus, aucun doublon n'est possible en pratique, mais
-- on ne pose JAMAIS un index unique sans l'avoir vérifié — un tenant dans un état inattendu ne doit
-- jamais voir sa migration échouer ni son démarrage bloqué par TenantMigrationGuard.
-- Le contrôle de doublon passe LUI AUSSI par sp_executesql : il référence [FiscalIdNormalized],
-- colonne ajoutée dans ce même lot — une référence statique (même dans une branche jamais exécutée)
-- fait échouer la COMPILATION du lot avec l'erreur 207 « Invalid column name 'FiscalIdNormalized' »,
-- avant même l'exécution des ALTER TABLE ci-dessus.
IF OBJECT_ID(N'dbo.ChartOfAccounts', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChartOfAccounts_AccountType_FiscalIdNormalized' AND object_id = OBJECT_ID(N'[dbo].[ChartOfAccounts]'))
BEGIN
    DECLARE @hasDuplicates int;
    EXEC sys.sp_executesql
        N'SELECT @hasDuplicatesOut = CASE WHEN EXISTS (
            SELECT 1 FROM [dbo].[ChartOfAccounts]
            WHERE [FiscalIdNormalized] IS NOT NULL AND [IsAuxiliary] = 1
            GROUP BY [AccountType], [FiscalIdNormalized]
            HAVING COUNT(*) > 1) THEN 1 ELSE 0 END',
        N'@hasDuplicatesOut int OUTPUT',
        @hasDuplicatesOut = @hasDuplicates OUTPUT;

    IF @hasDuplicates = 1
    BEGIN
        PRINT 'AddChartOfAccountFiscalId_Tenant : des comptes auxiliaires partagent déjà un même matricule fiscal pour le même type, IX_ChartOfAccounts_AccountType_FiscalIdNormalized (UNIQUE) n''est PAS posé. Réparer les doublons puis rejouer la migration.';
    END
    ELSE
    BEGIN
        SET @sql = N'CREATE UNIQUE NONCLUSTERED INDEX [IX_ChartOfAccounts_AccountType_FiscalIdNormalized]
            ON [dbo].[ChartOfAccounts] ([AccountType], [FiscalIdNormalized])
            WHERE [FiscalIdNormalized] IS NOT NULL AND [IsAuxiliary] = 1' + @withOnline + N';';
        EXEC sys.sp_executesql @sql;
    END
END;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // L'index filtré dépend de FiscalIdNormalized (et porte sur IsAuxiliary) : il doit être
            // supprimé AVANT les colonnes, sinon SQL Server refuse l'ALTER avec l'erreur 5074
            // « The index is dependent on column » (cf. docs/backend-tenant-migrations.md, section
            // « Élargir une colonne portée par un index FILTRÉ »).
            migrationBuilder.Sql("""
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ChartOfAccounts_AccountType_FiscalIdNormalized' AND object_id = OBJECT_ID(N'[dbo].[ChartOfAccounts]'))
BEGIN
    DROP INDEX [IX_ChartOfAccounts_AccountType_FiscalIdNormalized] ON [dbo].[ChartOfAccounts];
END;

IF COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalIdNormalized') IS NOT NULL
    ALTER TABLE [dbo].[ChartOfAccounts] DROP COLUMN [FiscalIdNormalized];

IF COL_LENGTH(N'dbo.ChartOfAccounts', N'FiscalId') IS NOT NULL
    ALTER TABLE [dbo].[ChartOfAccounts] DROP COLUMN [FiscalId];
""");
        }
    }
}
