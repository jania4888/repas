using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Master DB : ajoute <c>Users.RefreshContextTenantId</c> (uniqueidentifier, NULLABLE), le dossier
/// client sur lequel une session de cabinet était positionnée au moment de l'émission du refresh
/// token.
///
/// Sans elle, <c>POST /api/auth/refresh</c> ne pouvait pas retrouver le contexte délégué et
/// ré-émettait un jeton <c>native</c> sur le tenant du cabinet ; l'intercepteur front rejouant la
/// requête en silence, un collaborateur consultant un dossier basculait au bout de 15 minutes sur la
/// base DU CABINET sans aucun signe visible.
///
/// Purement additive : NULL = session native, comportement inchangé. La colonne ne confère aucun
/// droit — l'affectation cabinet ↔ dossier est revalidée à chaque rafraîchissement. SQL idempotent
/// écrit à la main, sans fichier Designer (même patron que
/// <c>AddStudioAiAdvancedModelRef_Master</c>).
///
/// Jumeau SQL applicable hors EF :
/// <c>docs/runbooks/sql/AddRefreshContextTenantId_Master.idempotent.sql</c>.
/// </summary>
[DbContext(typeof(MasterDbContext))]
[Migration("20260922130000_AddRefreshContextTenantId_Master")]
public partial class AddRefreshContextTenantId_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.Users', N'RefreshContextTenantId') IS NULL
BEGIN
    ALTER TABLE [Users] ADD [RefreshContextTenantId] uniqueidentifier NULL;
END
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.Users', N'RefreshContextTenantId') IS NOT NULL
BEGIN
    ALTER TABLE [Users] DROP COLUMN [RefreshContextTenantId];
END
""");
    }
}
