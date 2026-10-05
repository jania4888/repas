using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Téléphone de contact facultatif sur le tenant (dossier cabinet créé sans numéro).
/// L'inscription société et l'inscription cabinet continuent d'exiger un téléphone en application.
/// Les valeurs existantes ne sont pas réécrites.
/// </summary>
[DbContext(typeof(MasterDbContext))]
[Migration("20261004170000_MakeTenantPhoneOptional_Master")]
public partial class MakeTenantPhoneOptional_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AlterColumn<string>(
            name: "Phone",
            table: "Tenants",
            type: "nvarchar(20)",
            maxLength: 20,
            nullable: true,
            oldClrType: typeof(string),
            oldType: "nvarchar(20)",
            oldMaxLength: 20,
            oldNullable: false);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AlterColumn<string>(
            name: "Phone",
            table: "Tenants",
            type: "nvarchar(20)",
            maxLength: 20,
            nullable: false,
            oldClrType: typeof(string),
            oldType: "nvarchar(20)",
            oldMaxLength: 20,
            oldNullable: true);
    }
}
