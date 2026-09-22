using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Tests.MultiTenancy;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Vérifie le cache mémoire des chaînes de connexion tenant (correctif perf P1 :
/// avant, chaque requête authentifiée relisait la base master + déchiffrait).
/// </summary>
public sealed class TenantServiceConnectionStringCacheTests
{
    private static MasterDbContext NewDb() =>
        new(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static TenantService NewService(MasterDbContext db, IDataProtectionProvider protectionProvider, IMemoryCache cache)
    {
        var provisioner = new TenantDatabaseProvisioner(
            Options.Create(new TenantProvisioningOptions()),
            NullLogger<TenantDatabaseProvisioner>.Instance);
        return new TenantService(
            db,
            protectionProvider,
            new ConfigurationBuilder().Build(),
            cache,
            NullLogger<TenantService>.Instance,
            provisioner,
            new RecordingCatalogSeeder());
    }

    [Fact]
    public async Task GetConnectionString_IsServedFromCache_OnSecondCall()
    {
        await using var db = NewDb();
        var protectionProvider = new EphemeralDataProtectionProvider();
        var cache = new MemoryCache(new MemoryCacheOptions());
        var tenantId = Guid.NewGuid();
        const string plainConnectionString = "Server=test;Database=Tenant_X;Trusted_Connection=True";

        var protector = protectionProvider.CreateProtector("TenantConnectionStrings");
        db.TenantConnectionStrings.Add(new TenantConnectionString
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EncryptedConnectionString = protector.Protect(plainConnectionString),
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var service = NewService(db, protectionProvider, cache);

        var first = await service.GetConnectionStringAsync(tenantId);
        Assert.Equal(plainConnectionString, first);

        // Preuve du cache : la ligne est supprimée de la base, le 2e appel doit
        // quand même répondre (aucune requête master, aucun déchiffrement).
        db.TenantConnectionStrings.RemoveRange(db.TenantConnectionStrings);
        await db.SaveChangesAsync();

        var second = await service.GetConnectionStringAsync(tenantId);
        Assert.Equal(plainConnectionString, second);
    }

    [Fact]
    public async Task GetConnectionString_UnknownTenant_IsNotCached()
    {
        await using var db = NewDb();
        var protectionProvider = new EphemeralDataProtectionProvider();
        var cache = new MemoryCache(new MemoryCacheOptions());
        var tenantId = Guid.NewGuid();
        var service = NewService(db, protectionProvider, cache);

        Assert.Null(await service.GetConnectionStringAsync(tenantId));

        // Un tenant provisionné juste après doit être visible immédiatement
        // (les échecs ne sont pas mis en cache).
        const string plainConnectionString = "Server=test;Database=Tenant_Y;Trusted_Connection=True";
        var protector = protectionProvider.CreateProtector("TenantConnectionStrings");
        db.TenantConnectionStrings.Add(new TenantConnectionString
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EncryptedConnectionString = protector.Protect(plainConnectionString),
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        Assert.Equal(plainConnectionString, await service.GetConnectionStringAsync(tenantId));
    }
}
