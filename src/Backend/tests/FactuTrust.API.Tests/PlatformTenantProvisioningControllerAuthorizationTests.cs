using System.Reflection;
using System.Security.Claims;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Garde-fous d'autorisation de <see cref="PlatformTenantProvisioningController"/>.
///
/// <para>
/// Volontairement par <b>réflexion d'attributs</b> plutôt que par <c>WebApplicationFactory</c> :
/// les tests d'intégration HTTP de ce projet échouent déjà en masse sur ce poste faute de SQL
/// Server réel, ce qui rendrait ces gardes illisibles. Ici, un attribut supprimé casse le test
/// immédiatement et sans dépendance externe.
/// </para>
/// </summary>
public sealed class PlatformTenantProvisioningControllerAuthorizationTests
{
    private static readonly Type ControllerType = typeof(PlatformTenantProvisioningController);

    [Fact]
    public void Controller_requires_the_platform_entry_policy()
    {
        var policies = ControllerType
            .GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Select(a => a.Policy)
            .ToList();

        Assert.Contains(PlatformPolicies.PlatformAdmin, policies);
    }

    [Theory]
    [InlineData(nameof(PlatformTenantProvisioningController.CreateCompany))]
    [InlineData(nameof(PlatformTenantProvisioningController.CreateAccountingFirm))]
    [InlineData(nameof(PlatformTenantProvisioningController.RetryProvisioning))]
    public void Write_actions_require_the_tenants_write_permission(string methodName)
    {
        var policies = GetMethod(methodName)
            .GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Select(a => a.Policy)
            .ToList();

        Assert.Contains("perm:" + PlatformPermissions.TenantsWrite, policies);
    }

    [Theory]
    [InlineData(nameof(PlatformTenantProvisioningController.CreateCompany), "platform-tenant-create")]
    [InlineData(nameof(PlatformTenantProvisioningController.CreateAccountingFirm), "platform-tenant-create")]
    [InlineData(nameof(PlatformTenantProvisioningController.RetryProvisioning), "platform-tenant-retry")]
    public void Write_actions_declare_their_rate_limit_policy(string methodName, string expectedPolicy)
    {
        var attribute = GetMethod(methodName).GetCustomAttribute<EnableRateLimitingAttribute>(inherit: true);

        Assert.NotNull(attribute);
        Assert.Equal(expectedPolicy, attribute!.PolicyName);
    }

    /// <summary>
    /// Seul le super-admin plateforme peut provisionner. Si un rôle intermédiaire obtenait
    /// <c>platform.tenants:write</c>, ce test le rendrait visible immédiatement.
    /// </summary>
    [Fact]
    public void Only_the_platform_admin_role_grants_tenants_write()
    {
        Assert.Contains(
            PlatformPermissions.TenantsWrite,
            RolePermissionMatrix.ComputeEffectivePermissions(new[] { PlatformRoles.PlatformAdmin }));

        var otherRoles = new[]
        {
            PlatformRoles.BillingAdmin,
            PlatformRoles.SupportAgent,
            PlatformRoles.MigrationOperator,
            PlatformRoles.ReadOnlyAuditor
        };

        foreach (var role in otherRoles)
        {
            Assert.DoesNotContain(
                PlatformPermissions.TenantsWrite,
                RolePermissionMatrix.ComputeEffectivePermissions(new[] { role }));
        }
    }

    /// <summary>
    /// Défense en profondeur : un jeton de tenant, même porteur de la bonne permission, ne doit
    /// jamais atteindre le provisionnement plateforme.
    /// </summary>
    [Fact]
    public async Task CreateCompany_rejects_a_principal_carrying_a_tenant_id()
    {
        var registration = new Mock<ICompanyRegistrationService>();
        var controller = BuildController(
            registration,
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim("tenant_id", Guid.NewGuid().ToString()));

        var result = await controller.CreateCompany(new PlatformCreateCompanyRequestDto(), CancellationToken.None);

        Assert.IsType<ForbidResult>(result);
        registration.Verify(
            s => s.RegisterAsync(
                It.IsAny<RegisterDto>(),
                It.IsAny<CompanyRegistrationContext>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
    }

    /// <summary>
    /// Les opérateurs plateforme portent <c>TenantId = Guid.Empty</c> : la garde ne doit pas les
    /// confondre avec un utilisateur de tenant.
    /// </summary>
    [Fact]
    public async Task CreateCompany_accepts_an_empty_guid_tenant_claim()
    {
        var registration = new Mock<ICompanyRegistrationService>();
        // Sans ce doublon, `await` sur la tache nulle du mock masquerait le resultat reel.
        registration
            .Setup(s => s.RegisterAsync(
                It.IsAny<RegisterDto>(),
                It.IsAny<CompanyRegistrationContext>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(CompanyRegistrationResult.ValidationFailure("stop"));

        var controller = BuildController(
            registration,
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim("tenant_id", Guid.Empty.ToString()));

        var result = await controller.CreateCompany(new PlatformCreateCompanyRequestDto(), CancellationToken.None);

        Assert.IsNotType<ForbidResult>(result);
        registration.Verify(
            s => s.RegisterAsync(
                It.IsAny<RegisterDto>(),
                It.IsAny<CompanyRegistrationContext>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task CreateCompany_rejects_a_principal_without_a_user_identifier()
    {
        var registration = new Mock<ICompanyRegistrationService>();
        var controller = BuildController(registration);

        var result = await controller.CreateCompany(new PlatformCreateCompanyRequestDto(), CancellationToken.None);

        Assert.IsType<ForbidResult>(result);
    }

    private static MethodInfo GetMethod(string name) =>
        ControllerType.GetMethod(name)
        ?? throw new InvalidOperationException($"Action {name} introuvable sur le contrôleur.");

    private static PlatformTenantProvisioningController BuildController(
        Mock<ICompanyRegistrationService> registration,
        params Claim[] claims)
    {
        var controller = new PlatformTenantProvisioningController(
            registration.Object,
            Mock.Of<IAccountingFirmRegistrationService>(),
            Mock.Of<IAccountingFirmsFeature>(),
            Mock.Of<ITenantProvisioningRetryService>(),
            Mock.Of<IPlatformActionAuditWriter>(),
            NullLogger<PlatformTenantProvisioningController>.Instance);

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
            }
        };

        return controller;
    }
}
