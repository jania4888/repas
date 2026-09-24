using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Fiche annuaire cabinet : domaines, segments, langues, taille, distanciel, expérience, site public.
/// Colonnes nullables. Les cabinets déjà inscrits restent listés sans reprise de données.
/// </summary>
[DbContext(typeof(MasterDbContext))]
[Migration("20260924190000_AddAccountingFirmDirectoryProfile_Master")]
public partial class AddAccountingFirmDirectoryProfile_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'PracticeAreasJson') IS NULL
    ALTER TABLE [AccountingFirmProfiles] ADD [PracticeAreasJson] nvarchar(400) NULL;
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'ClientSegmentsJson') IS NULL
    ALTER TABLE [AccountingFirmProfiles] ADD [ClientSegmentsJson] nvarchar(200) NULL;
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'LanguagesJson') IS NULL
    ALTER TABLE [AccountingFirmProfiles] ADD [LanguagesJson] nvarchar(80) NULL;
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'TeamSizeBand') IS NULL
    ALTER TABLE [AccountingFirmProfiles] ADD [TeamSizeBand] nvarchar(20) NULL;
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'AcceptsRemote') IS NULL
    ALTER TABLE [AccountingFirmProfiles] ADD [AcceptsRemote] bit NULL;
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'YearsOfExperience') IS NULL
    ALTER TABLE [AccountingFirmProfiles] ADD [YearsOfExperience] int NULL;
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'PublicWebsite') IS NULL
    ALTER TABLE [AccountingFirmProfiles] ADD [PublicWebsite] nvarchar(200) NULL;
""");
        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.AccountingFirmProfiles', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_AccountingFirmProfiles_IsPublicInDirectory_Governorate'
         AND object_id = OBJECT_ID(N'dbo.AccountingFirmProfiles'))
BEGIN
    CREATE INDEX [IX_AccountingFirmProfiles_IsPublicInDirectory_Governorate]
        ON [AccountingFirmProfiles] ([IsPublicInDirectory], [Governorate]);
END
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccountingFirmProfiles_IsPublicInDirectory_Governorate'
      AND object_id = OBJECT_ID(N'dbo.AccountingFirmProfiles'))
    DROP INDEX [IX_AccountingFirmProfiles_IsPublicInDirectory_Governorate] ON [AccountingFirmProfiles];
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'PublicWebsite') IS NOT NULL
    ALTER TABLE [AccountingFirmProfiles] DROP COLUMN [PublicWebsite];
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'YearsOfExperience') IS NOT NULL
    ALTER TABLE [AccountingFirmProfiles] DROP COLUMN [YearsOfExperience];
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'AcceptsRemote') IS NOT NULL
    ALTER TABLE [AccountingFirmProfiles] DROP COLUMN [AcceptsRemote];
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'TeamSizeBand') IS NOT NULL
    ALTER TABLE [AccountingFirmProfiles] DROP COLUMN [TeamSizeBand];
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'LanguagesJson') IS NOT NULL
    ALTER TABLE [AccountingFirmProfiles] DROP COLUMN [LanguagesJson];
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'ClientSegmentsJson') IS NOT NULL
    ALTER TABLE [AccountingFirmProfiles] DROP COLUMN [ClientSegmentsJson];
""");
        migrationBuilder.Sql("""
IF COL_LENGTH(N'dbo.AccountingFirmProfiles', N'PracticeAreasJson') IS NOT NULL
    ALTER TABLE [AccountingFirmProfiles] DROP COLUMN [PracticeAreasJson];
""");
    }
}
