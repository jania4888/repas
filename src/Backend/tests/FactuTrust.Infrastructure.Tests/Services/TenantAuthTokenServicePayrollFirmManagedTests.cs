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

public sealed class TenantAuthTokenServicePayrollFirmManagedTests
{
    private static readonly Guid CompanyId = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid CompanyUserId = Guid.Parse("77777777-7777-7777-7777-777777777777");

    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    private static async Task SeedCompanyAsync(MasterDbContext db)
    {
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var company = Tenant.Create(
            "Société Test",
            NIF.Create("3456789/A/B/C/000").Value,
            address,
            Email.Create("company@example.com").Value,
            PhoneNumber.Create("75123456").Value,
            TaxRegime.RealRegime).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(company, CompanyId);
        db.Tenants.Add(company);
        await db.SaveChangesAsync();
    }

    private static ApplicationUser BuildCompanyUser() => new()
    {
        Id = CompanyUserId,
        Email = "admin@company.com",
        UserName = "admin@company.com",
        FirstName = "Admin",
        LastName = "Société",
        TenantId = CompanyId
    };

    private static TenantAuthTokenService BuildService(
        MasterDbContext db,
        ApplicationUser user,
        IFirmAssignmentService firmAssignmentService,
        bool firmExclusiveOperations = true)
    {
        var store = new Mock<IUserStore<ApplicationUser>>();
        var userManager = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        userManager.Setup(m => m.FindByIdAsync(CompanyUserId.ToString())).ReturnsAsync(user);
        userManager.Setup(m => m.GetRolesAsync(user))
            .ReturnsAsync(new List<string> { UserRole.Administrator.ToString() });
        userManager.Setup(m => m.UpdateAsync(It.IsAny<ApplicationUser>()))
            .ReturnsAsync(IdentityResult.Success);

        var allPayrollPermissions = new HashSet<string>
        {
            Permissions.Payroll.Read,
            Permissions.Payroll.ManageEmployees,
            Permissions.Payroll.RunPayroll,
            Permissions.Payroll.Validate,
            Permissions.Payroll.Declare,
            Permissions.Payroll.Export,
            Permissions.Payroll.Pay,
            Permissions.Payroll.Settings
        };

        var permissions = new Mock<IEffectivePermissionService>();
        permissions
            .Setup(p => p.GetUserAccessSnapshotAsync(user.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new UserAccessSnapshot(
                allPayrollPermissions,
                new[] { AppModule.Payroll },
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

        var accountingFirmsOptions =
            Microsoft.Extensions.Options.Options.Create(new AccountingFirmsOptions { Enabled = true });

        return new TenantAuthTokenService(
            userManager.Object,
            permissions.Object,
            firmAssignmentService,
            new FirmDelegatedAccessProjector(db, accountingFirmsOptions),
            db,
            config,
            accountingFirmsOptions,
            Microsoft.Extensions.Options.Options.Create(new PayrollOptions { FirmExclusiveOperations = firmExclusiveOperations }),
            Microsoft.Extensions.Options.Options.Create(new AccountingSettings { MultiCurrencyEnabled = true }),
            Microsoft.Extensions.Options.Options.Create(new FirmGovernanceOptions { Enabled = true }),
            Mock.Of<ILogger<TenantAuthTokenService>>());
    }

    [Fact]
    public async Task GenerateTokens_company_without_firm_assignment_keeps_payroll_run_permission()
    {
        await using var db = BuildMaster();
        await SeedCompanyAsync(db);
        var user = BuildCompanyUser();

        var firmAssignment = new Mock<IFirmAssignmentService>();
        firmAssignment
            .Setup(s => s.GetCompanyCurrentAssignmentAsync(CompanyId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((FirmClientAssignmentDto?)null);

        var service = BuildService(db, user, firmAssignment.Object);
        var response = await service.GenerateTokensAsync(CompanyUserId, CompanyId);

        Assert.Contains(Permissions.Payroll.RunPayroll, response.User.EffectivePermissions);
        Assert.Contains(Permissions.Payroll.Settings, response.User.EffectivePermissions);
        Assert.False(response.User.IsPayrollFirmManaged);
        Assert.Null(DecodeClaims(response.AccessToken)
            .FirstOrDefault(c => c.Type == AuthClaimTypes.PayrollFirmManaged));
    }

    [Fact]
    public async Task GenerateTokens_company_with_firm_assignment_strips_exclusive_permissions_and_sets_flag()
    {
        await using var db = BuildMaster();
        await SeedCompanyAsync(db);
        var user = BuildCompanyUser();

        var firmAssignment = new Mock<IFirmAssignmentService>();
        firmAssignment
            .Setup(s => s.GetCompanyCurrentAssignmentAsync(CompanyId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new FirmClientAssignmentDto
            {
                Id = Guid.NewGuid(),
                CompanyTenantId = CompanyId,
                FirmTenantId = Guid.NewGuid(),
                Status = FirmAssignmentStatus.Active
            });

        var service = BuildService(db, user, firmAssignment.Object);
        var response = await service.GenerateTokensAsync(CompanyUserId, CompanyId);

        Assert.True(response.User.IsPayrollFirmManaged);
        Assert.Contains(Permissions.Payroll.Read, response.User.EffectivePermissions);
        Assert.Contains(Permissions.Payroll.ManageEmployees, response.User.EffectivePermissions);
        Assert.Contains(Permissions.Payroll.Export, response.User.EffectivePermissions);
        Assert.DoesNotContain(Permissions.Payroll.RunPayroll, response.User.EffectivePermissions);
        Assert.DoesNotContain(Permissions.Payroll.Validate, response.User.EffectivePermissions);
        Assert.DoesNotContain(Permissions.Payroll.Settings, response.User.EffectivePermissions);
        Assert.DoesNotContain(Permissions.Payroll.Declare, response.User.EffectivePermissions);
        Assert.DoesNotContain(Permissions.Payroll.Pay, response.User.EffectivePermissions);

        var claim = DecodeClaims(response.AccessToken)
            .FirstOrDefault(c => c.Type == AuthClaimTypes.PayrollFirmManaged);
        Assert.NotNull(claim);
        Assert.Equal("true", claim!.Value);
    }

    [Fact]
    public async Task GenerateTokens_company_with_firm_assignment_feature_disabled_keeps_permissions()
    {
        await using var db = BuildMaster();
        await SeedCompanyAsync(db);
        var user = BuildCompanyUser();

        var firmAssignment = new Mock<IFirmAssignmentService>();
        firmAssignment
            .Setup(s => s.GetCompanyCurrentAssignmentAsync(CompanyId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new FirmClientAssignmentDto
            {
                Id = Guid.NewGuid(),
                CompanyTenantId = CompanyId,
                FirmTenantId = Guid.NewGuid(),
                Status = FirmAssignmentStatus.Active
            });

        var service = BuildService(db, user, firmAssignment.Object, firmExclusiveOperations: false);
        var response = await service.GenerateTokensAsync(CompanyUserId, CompanyId);

        Assert.Contains(Permissions.Payroll.RunPayroll, response.User.EffectivePermissions);
        Assert.False(response.User.IsPayrollFirmManaged);
    }

    private static IReadOnlyList<Claim> DecodeClaims(string accessToken)
    {
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(accessToken);
        return jwt.Claims.ToList();
    }
}
