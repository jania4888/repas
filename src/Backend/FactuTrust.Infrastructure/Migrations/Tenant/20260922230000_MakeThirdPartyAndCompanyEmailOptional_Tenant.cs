using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant;

/// <summary>
/// Email de contact facultatif pour les clients, fournisseurs et la société émettrice
/// (dossier cabinet sans email). Les valeurs existantes ne sont pas réécrites.
/// </summary>
[DbContext(typeof(TenantDbContext))]
[Migration("20260922230000_MakeThirdPartyAndCompanyEmailOptional_Tenant")]
public partial class MakeThirdPartyAndCompanyEmailOptional_Tenant : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        AlterEmail(migrationBuilder, "Clients", nullable: true);
        AlterEmail(migrationBuilder, "Suppliers", nullable: true);
        AlterEmail(migrationBuilder, "Companies", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        AlterEmail(migrationBuilder, "Clients", nullable: false);
        AlterEmail(migrationBuilder, "Suppliers", nullable: false);
        AlterEmail(migrationBuilder, "Companies", nullable: false);
    }

    private static void AlterEmail(MigrationBuilder migrationBuilder, string table, bool nullable)
    {
        migrationBuilder.AlterColumn<string>(
            name: "Email",
            table: table,
            type: "nvarchar(256)",
            maxLength: 256,
            nullable: nullable,
            oldClrType: typeof(string),
            oldType: "nvarchar(256)",
            oldMaxLength: 256,
            oldNullable: !nullable);
    }
}
