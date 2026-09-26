using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

[DbContext(typeof(MasterDbContext))]
[Migration("20260925120000_AddUserPreferredLanguage_Master")]
public partial class AddUserPreferredLanguage_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.Users', N'PreferredLanguage') IS NULL
BEGIN
    ALTER TABLE [Users] ADD [PreferredLanguage] nvarchar(5) NULL;
END
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.Users', N'PreferredLanguage') IS NOT NULL
BEGIN
    ALTER TABLE [Users] DROP COLUMN [PreferredLanguage];
END
""");
    }
}
