using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Identity;

public sealed class ImpersonationSnapshotResolverTests
{
    private static readonly Guid TenantId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid OtherTenantId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");
    private static readonly Guid UserId = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000001");
    private const string Origin = "studio-workflow:0123456789abcdef0123456789abcdef";

    private static readonly IReadOnlySet<string> Permissions =
        new HashSet<string>(StringComparer.Ordinal) { "studio:design_entities", "invoices:read" };

    private readonly Mock<IEffectivePermissionService> _effective = new(MockBehavior.Strict);

    private static MasterDbContext BuildMaster() =>
        new(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static ApplicationUser User(Guid tenantId, bool isActive = true) => new()
    {
        Id = UserId,
        TenantId = tenantId,
        FirstName = "Amina",
        LastName = "Trabelsi",
        UserName = "amina.trabelsi@instafact.tn",
        Email = "amina.trabelsi@instafact.tn",
        IsActive = isActive
    };

    private static void GrantRole(MasterDbContext master, string roleName)
    {
        var roleId = Guid.NewGuid();
        master.Roles.Add(new ApplicationRole { Id = roleId, Name = roleName, NormalizedName = roleName.ToUpperInvariant() });
        master.UserRoles.Add(new IdentityUserRole<Guid> { UserId = UserId, RoleId = roleId });
    }

    private ImpersonationSnapshotResolver Resolver(MasterDbContext master) =>
        new(master, _effective.Object, NullLogger<ImpersonationSnapshotResolver>.Instance);

    private void ExpectAccess() =>
        _effective.Setup(e => e.GetUserAccessSnapshotAsync(UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserAccessSnapshot(Permissions, Array.Empty<AppModule>(), IsModulePermissionScoped: false));

    [Fact]
    public async Task Returns_snapshot_with_role_permissions_and_origin()
    {
        await using var master = BuildMaster();
        master.Users.Add(User(TenantId));
        GrantRole(master, UserRole.Accountant.ToString());
        await master.SaveChangesAsync();
        ExpectAccess();

        var snapshot = await Resolver(master).ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);

        Assert.NotNull(snapshot);
        Assert.Equal(UserId, snapshot.UserId);
        Assert.Equal(TenantId, snapshot.TenantId);
        Assert.Equal("amina.trabelsi@instafact.tn", snapshot.Email);
        Assert.Equal(UserRole.Accountant, snapshot.Role);
        Assert.Same(Permissions, snapshot.Permissions);
        Assert.Equal(Origin, snapshot.Origin);
        _effective.VerifyAll();
    }

    [Fact]
    public async Task Returns_null_when_user_is_missing()
    {
        await using var master = BuildMaster();

        var snapshot = await Resolver(master).ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);

        Assert.Null(snapshot);
        _effective.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Returns_null_when_user_is_inactive()
    {
        await using var master = BuildMaster();
        master.Users.Add(User(TenantId, isActive: false));
        GrantRole(master, UserRole.Administrator.ToString());
        await master.SaveChangesAsync();

        var snapshot = await Resolver(master).ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);

        Assert.Null(snapshot);
        _effective.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Returns_null_when_user_belongs_to_another_tenant()
    {
        await using var master = BuildMaster();
        master.Users.Add(User(OtherTenantId));
        GrantRole(master, UserRole.Administrator.ToString());
        await master.SaveChangesAsync();

        var snapshot = await Resolver(master).ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);

        Assert.Null(snapshot);
        _effective.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Returns_null_when_user_has_platform_admin_role()
    {
        await using var master = BuildMaster();
        master.Users.Add(User(TenantId));
        // Même accompagné d'un rôle applicatif valide : le rôle plateforme suffit au refus.
        GrantRole(master, UserRole.Administrator.ToString());
        GrantRole(master, PlatformRoles.PlatformAdmin);
        await master.SaveChangesAsync();

        var snapshot = await Resolver(master).ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);

        Assert.Null(snapshot);
        _effective.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Returns_null_when_user_has_any_platform_role()
    {
        await using var master = BuildMaster();
        master.Users.Add(User(TenantId));
        // Chaque rôle plateforme connu refuse, pas seulement PlatformAdmin (revue 4.2a).
        GrantRole(master, UserRole.Administrator.ToString());
        GrantRole(master, PlatformRoles.SupportAgent);
        await master.SaveChangesAsync();

        var snapshot = await Resolver(master).ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);

        Assert.Null(snapshot);
        _effective.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Returns_null_when_application_role_is_ambiguous()
    {
        await using var master = BuildMaster();
        master.Users.Add(User(TenantId));
        // Deux rôles applicatifs : le cliché ne peut pas garantir rôle et permissions cohérents ⇒ refus.
        GrantRole(master, UserRole.Administrator.ToString());
        GrantRole(master, UserRole.SalesRep.ToString());
        await master.SaveChangesAsync();

        var snapshot = await Resolver(master).ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);

        Assert.Null(snapshot);
        _effective.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Returns_null_for_empty_identifiers()
    {
        await using var master = BuildMaster();
        var resolver = Resolver(master);

        Assert.Null(await resolver.ResolveAsync(Guid.Empty, UserId, Origin, CancellationToken.None));
        Assert.Null(await resolver.ResolveAsync(TenantId, Guid.Empty, Origin, CancellationToken.None));
        _effective.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Returns_null_when_no_role_is_parsable_and_reflects_deactivation_on_next_call()
    {
        await using var master = BuildMaster();
        var user = User(TenantId);
        master.Users.Add(user);
        // Rôle inconnu seulement : il ne se convertit pas en UserRole ⇒ refus (pas de repli Accountant).
        GrantRole(master, "Gestionnaire");
        await master.SaveChangesAsync();

        var resolver = Resolver(master);
        Assert.Null(await resolver.ResolveAsync(TenantId, UserId, Origin, CancellationToken.None));
        _effective.VerifyNoOtherCalls();

        // Un rôle applicatif est ajouté ⇒ accepté ; puis l'utilisateur est désactivé ⇒ refusé au 3ᵉ appel :
        // chaque résolution relit la base maître (aucun cache).
        GrantRole(master, UserRole.Auditor.ToString());
        await master.SaveChangesAsync();
        ExpectAccess();

        var accepted = await resolver.ResolveAsync(TenantId, UserId, Origin, CancellationToken.None);
        Assert.NotNull(accepted);
        Assert.Equal(UserRole.Auditor, accepted.Role);

        user.IsActive = false;
        await master.SaveChangesAsync();

        Assert.Null(await resolver.ResolveAsync(TenantId, UserId, Origin, CancellationToken.None));
        _effective.Verify(e => e.GetUserAccessSnapshotAsync(UserId, It.IsAny<CancellationToken>()), Times.Once);
    }
}
