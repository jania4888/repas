using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Un cabinet comptable et une entreprise cohabitent dans la même table de l'écran « Entreprises ».
/// Tant que <c>Kind</c> n'était pas projeté, un cabinet créé s'y affichait comme une ligne
/// d'entreprise ordinaire : l'opérateur concluait que la création avait échoué.
/// </summary>
public class PlatformTenantQueryServiceKindTests
{
    private static MasterDbContext NewDb() =>
        new(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static Tenant Company(string name, string nif) =>
        Tenant.Create(
            name,
            NIF.Create(nif).Value,
            Address.Create("12 rue de Rome", "Tunis", "Tunis").Value,
            Email.Create($"{name.ToLowerInvariant()}@test.tn").Value,
            PhoneNumber.Create("20123456").Value,
            TaxRegime.RealRegime).Value;

    private static Tenant Firm(string name, string nif) =>
        Tenant.CreateAccountingFirm(
            name,
            NIF.Create(nif).Value,
            Address.Create("5 avenue de Carthage", "Sfax", "Sfax").Value,
            Email.Create($"{name.ToLowerInvariant()}@test.tn").Value,
            PhoneNumber.Create("20123457").Value).Value;

    private static async Task<MasterDbContext> SeededAsync()
    {
        var db = NewDb();
        db.Tenants.AddRange(
            Company("alpha", "1111111/A/B/C/000"),
            Firm("beta", "2222222/A/B/C/000"));
        await db.SaveChangesAsync();
        return db;
    }

    [Fact]
    public async Task ListAsync_projects_the_tenant_kind()
    {
        await using var db = await SeededAsync();
        var service = new PlatformTenantQueryService(db);

        var page = await service.ListAsync(new PlatformTenantListQuery { PageSize = 50 });

        Assert.Equal(2, page.TotalCount);
        Assert.Equal(TenantKind.Company, Assert.Single(page.Items, i => i.CompanyName == "alpha").Kind);
        Assert.Equal(TenantKind.AccountingFirm, Assert.Single(page.Items, i => i.CompanyName == "beta").Kind);
    }

    [Fact]
    public async Task ListAsync_filters_on_accounting_firms()
    {
        await using var db = await SeededAsync();
        var service = new PlatformTenantQueryService(db);

        var page = await service.ListAsync(new PlatformTenantListQuery { Kind = TenantKind.AccountingFirm });

        Assert.Equal(1, page.TotalCount);
        Assert.Equal("beta", Assert.Single(page.Items).CompanyName);
    }

    [Fact]
    public async Task ListAsync_without_kind_filter_returns_every_tenant()
    {
        await using var db = await SeededAsync();
        var service = new PlatformTenantQueryService(db);

        var page = await service.ListAsync(new PlatformTenantListQuery { Kind = null });

        Assert.Equal(2, page.TotalCount);
    }
}
