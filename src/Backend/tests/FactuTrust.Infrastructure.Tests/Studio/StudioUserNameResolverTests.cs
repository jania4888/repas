using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Studio;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// 4.5a1 — résolveur de noms « Prénom Nom » en lot pour les DTO workflow (StartedByName) :
/// filtré par tenant, sans repli email, utilisateurs désactivés conservés.
/// </summary>
public sealed class StudioUserNameResolverTests
{
    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    private static ApplicationUser User(Guid tenantId, string first, string last, bool active = true, string? email = null)
        => new()
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            FirstName = first,
            LastName = last,
            IsActive = active,
            UserName = email ?? $"{first}.{last}@test.tn".ToLowerInvariant(),
            Email = email ?? $"{first}.{last}@test.tn".ToLowerInvariant()
        };

    [Fact]
    public async Task GetDisplayNames_returns_first_and_last_name_for_users_of_the_tenant_only()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var amine = User(tenantA, "Amine", "Zorgati");
        var sonia = User(tenantA, "Sonia", "Ben Ali", active: false);
        var karim = User(tenantB, "Karim", "Client");
        await using var db = BuildMaster();
        db.Users.AddRange(amine, sonia, karim);
        await db.SaveChangesAsync();
        var resolver = new StudioUserNameResolver(db);

        var names = await resolver.GetDisplayNamesAsync(tenantA, new[] { amine.Id, sonia.Id, karim.Id });

        Assert.Equal(2, names.Count);
        Assert.Equal("Amine Zorgati", names[amine.Id]);
        Assert.Equal("Sonia Ben Ali", names[sonia.Id]); // désactivée : conservée (acteur historique)
        Assert.DoesNotContain(karim.Id, names.Keys);   // autre tenant : jamais résolu
    }

    [Fact]
    public async Task GetDisplayNames_omits_unknown_ids_and_nameless_users_without_falling_back_to_email()
    {
        var tenantId = Guid.NewGuid();
        var sansNom = User(tenantId, "", "", email: "compta@cabinet.tn");
        await using var db = BuildMaster();
        db.Users.Add(sansNom);
        await db.SaveChangesAsync();
        var resolver = new StudioUserNameResolver(db);

        var names = await resolver.GetDisplayNamesAsync(tenantId, new[] { sansNom.Id, Guid.NewGuid() });

        Assert.Empty(names);
        Assert.DoesNotContain(names.Values, v => v.Contains('@'));
    }

    [Fact]
    public async Task GetDisplayNames_returns_an_empty_dictionary_for_an_empty_id_list()
    {
        await using var db = BuildMaster();
        var resolver = new StudioUserNameResolver(db);

        var names = await resolver.GetDisplayNamesAsync(Guid.NewGuid(), Array.Empty<Guid>());

        Assert.Empty(names);
    }
}
