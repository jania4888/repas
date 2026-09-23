using FactuTrust.Infrastructure.Migrations;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant;

/// <summary>
/// Même canonisation que la migration master, limitée aux matricules d'identité du tenant
/// (société, clients, fournisseurs). Les factures d'honoraires ne sont pas dans cette base.
/// Deux valeurs brutes distinctes qui se rabattent sur le même matricule font échouer
/// la migration sans rien modifier.
/// </summary>
[DbContext(typeof(TenantDbContext))]
[Migration("20260922150000_CanonicalizeCompanyNif_Tenant")]
public partial class CanonicalizeCompanyNif_Tenant : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql($"""
{NifCanonicalSql.ThrowOnDistinctSpellingCollision("[dbo].[Companies]", "[NIF]", null, "NIF canonical collision in Companies")}
{NifCanonicalSql.ThrowOnDistinctSpellingCollision("[dbo].[Clients]", "[NIF]", null, "NIF canonical collision in Clients")}
{NifCanonicalSql.ThrowOnDistinctSpellingCollision("[dbo].[Suppliers]", "[NIF]", null, "NIF canonical collision in Suppliers")}

UPDATE [dbo].[Companies]
SET [NIF] = {NifCanonicalSql.RewriteLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.LegacyPredicate("[NIF]")};

UPDATE [dbo].[Clients]
SET [NIF] = {NifCanonicalSql.RewriteLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.LegacyPredicate("[NIF]")};

UPDATE [dbo].[Suppliers]
SET [NIF] = {NifCanonicalSql.RewriteLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.LegacyPredicate("[NIF]")};
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql($"""
UPDATE [dbo].[Companies]
SET [NIF] = {NifCanonicalSql.RewriteOfficialToLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.OfficialPredicate("[NIF]")};

UPDATE [dbo].[Clients]
SET [NIF] = {NifCanonicalSql.RewriteOfficialToLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.OfficialPredicate("[NIF]")};

UPDATE [dbo].[Suppliers]
SET [NIF] = {NifCanonicalSql.RewriteOfficialToLegacyAssignment("[NIF]")}
WHERE {NifCanonicalSql.OfficialPredicate("[NIF]")};
""");
    }
}
