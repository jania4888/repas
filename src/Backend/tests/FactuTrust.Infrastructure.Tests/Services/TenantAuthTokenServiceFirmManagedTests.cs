using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Delegated token generation: firm-managed dossiers hide commercial modules;
/// invited platform clients keep Sales/Purchases/Treasury.
/// </summary>
public sealed class TenantAuthTokenServiceFirmManagedTests
{
    private static readonly Guid FirmId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid ManagedClientId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid PlatformClientId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid FirmUserId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    private static async Task SeedAsync(MasterDbContext db)
    {
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;

        var firm = Tenant.CreateAccountingFirm(
            "Cabinet Test",
            NIF.Create("7654321/A/B/C/000").Value,
            address,
            Email.Create("cabinet@example.com").Value,
            PhoneNumber.Create("71123456").Value).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(firm, FirmId);

        var managed = Tenant.CreateFirmManaged(
            FirmId,
            "Client Géré SARL",
            NIF.Create("1234567/A/B/C/000").Value,
            address,
            Email.Create("client@example.com").Value,
            PhoneNumber.Create("73123456").Value,
            TaxRegime.RealRegime).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(managed, ManagedClientId);

        var platform = Tenant.Create(
            "Client Plateforme SA",
            NIF.Create("2345678/A/B/C/000").Value,
            address,
            Email.Create("platform@example.com").Value,
            PhoneNumber.Create("74123456").Value,
            TaxRegime.RealRegime).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(platform, PlatformClientId);

        db.Tenants.AddRange(firm, managed, platform);
        await db.SaveChangesAsync();
    }

    private static ApplicationUser BuildFirmUser() => new()
    {
        Id = FirmUserId,
        Email = "firm@example.com",
        UserName = "firm@example.com",
        FirstName = "Omar",
        LastName = "Gharbi",
        TenantId = FirmId
    };

    private static TenantAuthTokenService BuildService(
        MasterDbContext db,
        ApplicationUser user,
        bool aiAccountingEnabled = true,
        bool enableInternalPayroll = false)
    {
        var store = new Mock<IUserStore<ApplicationUser>>();
        var userManager = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        userManager.Setup(m => m.FindByIdAsync(FirmUserId.ToString())).ReturnsAsync(user);
        userManager.Setup(m => m.GetRolesAsync(user))
            .ReturnsAsync(new List<string> { UserRole.FirmManager.ToString() });
        userManager.Setup(m => m.UpdateAsync(It.IsAny<ApplicationUser>()))
            .ReturnsAsync(IdentityResult.Success);

        var permissions = new Mock<IEffectivePermissionService>();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:SecretKey"] = "test-secret-key-at-least-32-chars!!",
                ["JwtSettings:Issuer"] = "FactuTrust.Tests",
                ["JwtSettings:Audience"] = "FactuTrust.Tests",
                ["JwtSettings:ExpiryMinutes"] = "15"
            })
            .Build();

        var accountingFirmsOptions = Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions
        {
            Enabled = true,
            AiAccountingEnabled = aiAccountingEnabled
        });

        var payrollOptions = Microsoft.Extensions.Options.Options.Create(new PayrollOptions
        {
            FirmExclusiveOperations = true
        });

        var firmAssignment = new Mock<IFirmAssignmentService>();
        firmAssignment
            .Setup(s => s.GetCompanyCurrentAssignmentAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((FirmClientAssignmentDto?)null);

        return new TenantAuthTokenService(
            userManager.Object,
            permissions.Object,
            firmAssignment.Object,
            new FirmDelegatedAccessProjector(db, accountingFirmsOptions),
            db,
            config,
            accountingFirmsOptions,
            payrollOptions,
            Microsoft.Extensions.Options.Options.Create(new AccountingSettings { MultiCurrencyEnabled = true }),
            Microsoft.Extensions.Options.Options.Create(new FirmGovernanceOptions
            {
                Enabled = true,
                EnableFirmInternalPayroll = enableInternalPayroll
            }),
            Mock.Of<ILogger<TenantAuthTokenService>>());
    }

    private static IReadOnlyList<Claim> DecodeClaims(string accessToken)
    {
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(accessToken);
        return jwt.Claims.ToList();
    }

    [Fact]
    public async Task GenerateTokens_delegated_firm_managed_sets_flag_and_drops_commercial_modules()
    {
        await using var db = BuildMaster();
        await SeedAsync(db);
        var user = BuildFirmUser();
        var service = BuildService(db, user);

        var response = await service.GenerateTokensAsync(
            FirmUserId, FirmId, ManagedClientId, "Client Géré SARL");

        Assert.True(response.User.IsFirmManaged);
        Assert.Equal("delegated", response.User.AccessMode);
        Assert.DoesNotContain((int)AppModule.Sales, response.User.EnabledModuleIds);
        Assert.DoesNotContain((int)AppModule.Purchases, response.User.EnabledModuleIds);
        Assert.DoesNotContain((int)AppModule.Treasury, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.Accounting, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.Fiscal, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.Reports, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.Payroll, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.AI, response.User.EnabledModuleIds);
        Assert.DoesNotContain((int)AppModule.Projects, response.User.EnabledModuleIds);
        Assert.Contains(Permissions.AI.Chat, response.User.EffectivePermissions);

        var claim = DecodeClaims(response.AccessToken)
            .FirstOrDefault(c => c.Type == AuthClaimTypes.IsFirmManaged);
        Assert.NotNull(claim);
        Assert.Equal("true", claim!.Value);
    }

    [Fact]
    public async Task GenerateTokens_delegated_platform_client_keeps_commercial_modules()
    {
        await using var db = BuildMaster();
        await SeedAsync(db);
        var user = BuildFirmUser();
        var service = BuildService(db, user);

        var response = await service.GenerateTokensAsync(
            FirmUserId, FirmId, PlatformClientId, "Client Plateforme SA");

        Assert.False(response.User.IsFirmManaged);
        Assert.Contains((int)AppModule.Sales, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.Purchases, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.Treasury, response.User.EnabledModuleIds);
        Assert.Contains((int)AppModule.AI, response.User.EnabledModuleIds);
        Assert.DoesNotContain((int)AppModule.Projects, response.User.EnabledModuleIds);
        Assert.Contains(Permissions.AI.Chat, response.User.EffectivePermissions);

        var claim = DecodeClaims(response.AccessToken)
            .FirstOrDefault(c => c.Type == AuthClaimTypes.IsFirmManaged);
        Assert.NotNull(claim);
        Assert.Equal("false", claim!.Value);
    }

    [Fact]
    public async Task GenerateTokens_delegated_firm_managed_without_ai_flag_omits_ai()
    {
        await using var db = BuildMaster();
        await SeedAsync(db);
        var user = BuildFirmUser();
        var service = BuildService(db, user, aiAccountingEnabled: false);

        var response = await service.GenerateTokensAsync(
            FirmUserId, FirmId, ManagedClientId, "Client Géré SARL");

        Assert.DoesNotContain((int)AppModule.AI, response.User.EnabledModuleIds);
        Assert.DoesNotContain(Permissions.AI.Chat, response.User.EffectivePermissions);
    }

    [Fact]
    public async Task GenerateTokens_native_firm_IsFirmManaged_false()
    {
        await using var db = BuildMaster();
        await SeedAsync(db);
        var user = BuildFirmUser();

        var store = new Mock<IUserStore<ApplicationUser>>();
        var userManager = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        userManager.Setup(m => m.FindByIdAsync(FirmUserId.ToString())).ReturnsAsync(user);
        userManager.Setup(m => m.GetRolesAsync(user))
            .ReturnsAsync(new List<string> { UserRole.FirmManager.ToString() });
        userManager.Setup(m => m.UpdateAsync(It.IsAny<ApplicationUser>()))
            .ReturnsAsync(IdentityResult.Success);

        var permissions = new Mock<IEffectivePermissionService>();
        permissions
            .Setup(p => p.GetUserAccessSnapshotAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserAccessSnapshot(
                new HashSet<string>(),
                Array.Empty<AppModule>(),
                IsModulePermissionScoped: false));

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:SecretKey"] = "test-secret-key-at-least-32-chars!!",
                ["JwtSettings:Issuer"] = "FactuTrust.Tests",
                ["JwtSettings:Audience"] = "FactuTrust.Tests",
                ["JwtSettings:ExpiryMinutes"] = "15"
            })
            .Build();

        var accountingFirmsOptions = Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions
        {
            Enabled = true,
            AiAccountingEnabled = true
        });

        var payrollOptions = Microsoft.Extensions.Options.Options.Create(new PayrollOptions
        {
            FirmExclusiveOperations = true
        });

        var firmAssignment = new Mock<IFirmAssignmentService>();

        var tokenService = new TenantAuthTokenService(
            userManager.Object,
            permissions.Object,
            firmAssignment.Object,
            new FirmDelegatedAccessProjector(db, accountingFirmsOptions),
            db,
            config,
            accountingFirmsOptions,
            payrollOptions,
            Microsoft.Extensions.Options.Options.Create(new AccountingSettings { MultiCurrencyEnabled = true }),
            Microsoft.Extensions.Options.Options.Create(new FirmGovernanceOptions { Enabled = true }),
            Mock.Of<ILogger<TenantAuthTokenService>>());
        var response = await tokenService.GenerateTokensAsync(FirmUserId, FirmId);

        Assert.False(response.User.IsFirmManaged);
        Assert.Equal("native", response.User.AccessMode);
        Assert.DoesNotContain((int)AppModule.AI, response.User.EnabledModuleIds);
        Assert.DoesNotContain(Permissions.AI.Chat, response.User.EffectivePermissions);
    }

    [Fact]
    public async Task GenerateTokens_native_firm_calls_permission_snapshot_once()
    {
        await using var db = BuildMaster();
        await SeedAsync(db);
        var user = BuildFirmUser();

        var store = new Mock<IUserStore<ApplicationUser>>();
        var userManager = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        userManager.Setup(m => m.FindByIdAsync(FirmUserId.ToString())).ReturnsAsync(user);
        userManager.Setup(m => m.GetRolesAsync(user))
            .ReturnsAsync(new List<string> { UserRole.FirmManager.ToString() });
        userManager.Setup(m => m.UpdateAsync(It.IsAny<ApplicationUser>()))
            .ReturnsAsync(IdentityResult.Success);

        var permissions = new Mock<IEffectivePermissionService>();
        permissions
            .Setup(p => p.GetUserAccessSnapshotAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserAccessSnapshot(
                new HashSet<string> { "admin:read" },
                Array.Empty<AppModule>(),
                IsModulePermissionScoped: true));

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:SecretKey"] = "test-secret-key-at-least-32-chars!!",
                ["JwtSettings:Issuer"] = "FactuTrust.Tests",
                ["JwtSettings:Audience"] = "FactuTrust.Tests",
                ["JwtSettings:ExpiryMinutes"] = "15"
            })
            .Build();

        var accountingFirmsOptions = Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions
        {
            Enabled = true,
            AiAccountingEnabled = true
        });

        var payrollOptions = Microsoft.Extensions.Options.Options.Create(new PayrollOptions
        {
            FirmExclusiveOperations = true
        });

        var firmAssignment = new Mock<IFirmAssignmentService>();

        var tokenService = new TenantAuthTokenService(
            userManager.Object,
            permissions.Object,
            firmAssignment.Object,
            new FirmDelegatedAccessProjector(db, accountingFirmsOptions),
            db,
            config,
            accountingFirmsOptions,
            payrollOptions,
            Microsoft.Extensions.Options.Options.Create(new AccountingSettings { MultiCurrencyEnabled = true }),
            Microsoft.Extensions.Options.Options.Create(new FirmGovernanceOptions { Enabled = true }),
            Mock.Of<ILogger<TenantAuthTokenService>>());

        await tokenService.GenerateTokensAsync(FirmUserId, FirmId);

        permissions.Verify(
            p => p.GetUserAccessSnapshotAsync(user.Id, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GenerateTokens_native_firm_internal_payroll_flag_adds_payroll_module_and_permissions()
    {
        await using var db = BuildMaster();
        await SeedAsync(db);
        var user = BuildFirmUser();

        var permissions = new Mock<IEffectivePermissionService>();
        permissions
            .Setup(p => p.GetUserAccessSnapshotAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserAccessSnapshot(
                DelegatedPermissionCatalog.FirmNativePermissions.ToHashSet(),
                Array.Empty<AppModule>(),
                IsModulePermissionScoped: false));

        var store = new Mock<IUserStore<ApplicationUser>>();
        var userManager = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        userManager.Setup(m => m.FindByIdAsync(FirmUserId.ToString())).ReturnsAsync(user);
        userManager.Setup(m => m.GetRolesAsync(user))
            .ReturnsAsync(new List<string> { UserRole.FirmManager.ToString() });
        userManager.Setup(m => m.UpdateAsync(It.IsAny<ApplicationUser>()))
            .ReturnsAsync(IdentityResult.Success);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:SecretKey"] = "test-secret-key-at-least-32-chars!!",
                ["JwtSettings:Issuer"] = "FactuTrust.Tests",
                ["JwtSettings:Audience"] = "FactuTrust.Tests",
                ["JwtSettings:ExpiryMinutes"] = "15"
            })
            .Build();

        var service = new TenantAuthTokenService(
            userManager.Object,
            permissions.Object,
            Mock.Of<IFirmAssignmentService>(),
            new FirmDelegatedAccessProjector(
                db,
                Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions { Enabled = true })),
            db,
            config,
            Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions { Enabled = true }),
            Microsoft.Extensions.Options.Options.Create(new PayrollOptions { FirmExclusiveOperations = true }),
            Microsoft.Extensions.Options.Options.Create(new AccountingSettings { MultiCurrencyEnabled = true }),
            Microsoft.Extensions.Options.Options.Create(new FirmGovernanceOptions
            {
                Enabled = true,
                EnableFirmInternalPayroll = true
            }),
            Mock.Of<ILogger<TenantAuthTokenService>>());

        var response = await service.GenerateTokensAsync(FirmUserId, FirmId);

        Assert.Contains((int)AppModule.Payroll, response.User.EnabledModuleIds);
        Assert.Contains(Permissions.Payroll.ManageEmployees, response.User.EffectivePermissions);
    }

    [Fact]
    public async Task GenerateTokens_native_firm_internal_payroll_flag_off_omits_payroll_module()
    {
        await using var db = BuildMaster();
        await SeedAsync(db);
        var user = BuildFirmUser();

        var store = new Mock<IUserStore<ApplicationUser>>();
        var userManager = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        userManager.Setup(m => m.FindByIdAsync(FirmUserId.ToString())).ReturnsAsync(user);
        userManager.Setup(m => m.GetRolesAsync(user))
            .ReturnsAsync(new List<string> { UserRole.FirmManager.ToString() });
        userManager.Setup(m => m.UpdateAsync(It.IsAny<ApplicationUser>()))
            .ReturnsAsync(IdentityResult.Success);

        var permissions = new Mock<IEffectivePermissionService>();
        permissions
            .Setup(p => p.GetUserAccessSnapshotAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserAccessSnapshot(
                DelegatedPermissionCatalog.FirmNativePermissions.ToHashSet(),
                Array.Empty<AppModule>(),
                IsModulePermissionScoped: false));

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:SecretKey"] = "test-secret-key-at-least-32-chars!!",
                ["JwtSettings:Issuer"] = "FactuTrust.Tests",
                ["JwtSettings:Audience"] = "FactuTrust.Tests",
                ["JwtSettings:ExpiryMinutes"] = "15"
            })
            .Build();

        var service = new TenantAuthTokenService(
            userManager.Object,
            permissions.Object,
            Mock.Of<IFirmAssignmentService>(),
            new FirmDelegatedAccessProjector(
                db,
                Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions { Enabled = true })),
            db,
            config,
            Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions { Enabled = true }),
            Microsoft.Extensions.Options.Options.Create(new PayrollOptions { FirmExclusiveOperations = true }),
            Microsoft.Extensions.Options.Options.Create(new AccountingSettings { MultiCurrencyEnabled = true }),
            Microsoft.Extensions.Options.Options.Create(new FirmGovernanceOptions
            {
                Enabled = true,
                EnableFirmInternalPayroll = false
            }),
            Mock.Of<ILogger<TenantAuthTokenService>>());

        var response = await service.GenerateTokensAsync(FirmUserId, FirmId);

        Assert.DoesNotContain((int)AppModule.Payroll, response.User.EnabledModuleIds);
    }
}
