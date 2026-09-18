using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    [DbContext(typeof(TenantDbContext))]
    [Migration("20260916190000_RemoveProjectIsBillable_Tenant")]
    public partial class RemoveProjectIsBillable_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.Projects', N'IsBillable') IS NOT NULL
    ALTER TABLE [Projects] DROP CONSTRAINT [DF_Projects_IsBillable];
IF COL_LENGTH(N'dbo.Projects', N'IsBillable') IS NOT NULL
    ALTER TABLE [Projects] DROP COLUMN [IsBillable];
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.Projects', N'IsBillable') IS NULL
    ALTER TABLE [Projects] ADD [IsBillable] bit NOT NULL CONSTRAINT [DF_Projects_IsBillable] DEFAULT (1);
""");
        }
    }
}
