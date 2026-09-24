using System.Security.Claims;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class CompanySupportAuthorizationTests
{
    [Fact]
    public async Task Company_endpoint_rejects_delegated_access()
    {
        var support = new Mock<ICompanySupportService>();
        var controller = CompanyController(support, Claims(
            role: nameof(UserRole.Administrator),
            tenantKind: "company",
            accessMode: "delegated"));

        var result = await controller.Bootstrap(CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, status.StatusCode);
        support.Verify(s => s.BootstrapForCompanyAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Company_endpoint_rejects_an_accounting_firm()
    {
        var support = new Mock<ICompanySupportService>();
        var controller = CompanyController(support, Claims(
            role: nameof(UserRole.Administrator),
            tenantKind: "accountingFirm"));

        var result = await controller.UnreadCount(CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, status.StatusCode);
    }

    [Theory]
    [InlineData(PlatformRoles.BillingAdmin)]
    [InlineData(PlatformRoles.MigrationOperator)]
    public void Those_platform_roles_cannot_read_company_support(string role)
    {
        Assert.DoesNotContain(
            PlatformPermissions.CompanySupportRead,
            RolePermissionMatrix.ComputeEffectivePermissions(new[] { role }));
        Assert.DoesNotContain(
            PlatformPermissions.CompanySupportWrite,
            RolePermissionMatrix.ComputeEffectivePermissions(new[] { role }));
    }

    [Fact]
    public void Support_agent_can_read_and_write_auditor_is_read_only()
    {
        var agent = RolePermissionMatrix.ComputeEffectivePermissions(new[] { PlatformRoles.SupportAgent });
        Assert.Contains(PlatformPermissions.CompanySupportRead, agent);
        Assert.Contains(PlatformPermissions.CompanySupportWrite, agent);

        var auditor = RolePermissionMatrix.ComputeEffectivePermissions(new[] { PlatformRoles.ReadOnlyAuditor });
        Assert.Contains(PlatformPermissions.CompanySupportRead, auditor);
        Assert.DoesNotContain(PlatformPermissions.CompanySupportWrite, auditor);
    }

    [Fact]
    public async Task Platform_reply_rejects_a_company_jwt()
    {
        var support = new Mock<ICompanySupportService>();
        var controller = PlatformController(support,
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim("tenant_id", Guid.NewGuid().ToString()),
            new Claim(AuthClaimTypes.Permission, PlatformPermissions.CompanySupportWrite));
        controller.ControllerContext.HttpContext.Request.ContentType = "multipart/form-data";

        var result = await controller.Reply(Guid.NewGuid(), CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, status.StatusCode);
        support.Verify(s => s.PostPlatformReplyAsync(
            It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<string?>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<CompanySupportUpload>>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Platform_reply_rejects_a_read_only_auditor()
    {
        var support = new Mock<ICompanySupportService>();
        var controller = PlatformController(support,
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim("tenant_id", Guid.Empty.ToString()),
            new Claim(ClaimTypes.Role, PlatformRoles.ReadOnlyAuditor),
            new Claim(AuthClaimTypes.Permission, PlatformPermissions.CompanySupportRead));

        var result = await controller.Reply(Guid.NewGuid(), CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, status.StatusCode);
    }

    [Fact]
    public async Task Platform_read_accepts_an_auditor()
    {
        var support = new Mock<ICompanySupportService>();
        support.Setup(s => s.GetForPlatformAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new CompanySupportBootstrapDto(null, Array.Empty<CompanySupportMessageDto>(), null, 0)));
        var controller = PlatformController(support,
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim("tenant_id", Guid.Empty.ToString()),
            new Claim(AuthClaimTypes.Permission, PlatformPermissions.CompanySupportRead));

        var result = await controller.Get(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    private static CompanySupportController CompanyController(Mock<ICompanySupportService> support, Claim[] claims)
    {
        var controller = new CompanySupportController(support.Object);
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
            }
        };
        return controller;
    }

    private static PlatformCompanySupportController PlatformController(Mock<ICompanySupportService> support, params Claim[] claims)
    {
        var controller = new PlatformCompanySupportController(support.Object);
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
            }
        };
        return controller;
    }

    private static Claim[] Claims(string role, string tenantKind, string accessMode = "native") =>
    [
        new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
        new Claim(ClaimTypes.Role, role),
        new Claim("tenant_id", Guid.NewGuid().ToString()),
        new Claim(AuthClaimTypes.TenantKind, tenantKind),
        new Claim(AuthClaimTypes.AccessMode, accessMode)
    ];
}
