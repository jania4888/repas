using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Studio IA 4.7 « v1.1 » — D5 (historique des enregistrements) : index non clusterisé
    /// <c>IX_AuditLogs_EntityHistory</c> sur <c>AuditLogs (EntityType, EntityId, CreatedAt)</c>,
    /// couvrant la lecture paginée <c>WHERE EntityType = … AND EntityId = … ORDER BY CreatedAt DESC</c>
    /// de <c>GET api/studio/records/{entityKey}/{id}/history</c>. Additif pur (aucune donnée touchée),
    /// écrit à la main (pas de <c>dotnet ef migrations add</c>), idempotent, jumeau SQL :
    /// <c>docs/runbooks/sql/AddAuditLogsEntityHistoryIndex_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20260918100000_AddAuditLogsEntityHistoryIndex_Tenant")]
    public partial class AddAuditLogsEntityHistoryIndex_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLogs_EntityHistory' AND object_id = OBJECT_ID(N'[dbo].[AuditLogs]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AuditLogs_EntityHistory]
        ON [dbo].[AuditLogs] ([EntityType], [EntityId], [CreatedAt]);
END;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLogs_EntityHistory' AND object_id = OBJECT_ID(N'[dbo].[AuditLogs]'))
BEGIN
    DROP INDEX [IX_AuditLogs_EntityHistory] ON [dbo].[AuditLogs];
END;
""");
        }
    }
}
