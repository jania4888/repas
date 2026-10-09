using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Authorization;

/// <summary>
/// Filet de caractérisation de l'extraction : la projection déléguée partagée entre l'émission du
/// JWT et <c>GET /api/auth/me</c> doit produire EXACTEMENT ce que le service de jetons calculait
/// seul auparavant. Les valeurs attendues sont écrites en dur à dessein.
/// </summary>
public sealed class FirmDelegatedAccessTests
{
    [Fact]
    public void Firm_managed_dossier_opens_the_accounting_payroll_set()
    {
        Assert.Equal(
            new[]
            {
                (int)AppModule.Accounting,
                (int)AppModule.Fiscal,
                (int)AppModule.Reports,
                (int)AppModule.Payroll,
                (int)AppModule.AI
            },
            FirmDelegatedAccess.BuildDelegatedModuleIds(isFirmManaged: true));
    }

    [Fact]
    public void Platform_client_dossier_opens_the_commercial_set_too()
    {
        Assert.Equal(
            new[]
            {
                (int)AppModule.Accounting,
                (int)AppModule.Fiscal,
                (int)AppModule.Sales,
                (int)AppModule.Treasury,
                (int)AppModule.Reports,
                (int)AppModule.Purchases,
                (int)AppModule.Payroll,
                (int)AppModule.AI
            },
            FirmDelegatedAccess.BuildDelegatedModuleIds(isFirmManaged: false));
    }

    [Theory]
    [InlineData(UserRole.FirmManager)]
    [InlineData(UserRole.FirmAccountant)]
    public void Delegated_permissions_come_from_the_delegated_catalog(UserRole role)
    {
        Assert.Equal(
            DelegatedPermissionCatalog.GetDelegatedPermissions(role).ToList(),
            FirmDelegatedAccess.BuildDelegatedPermissions(role));
    }

    [Theory]
    [InlineData(UserRole.FirmManager, true)]
    [InlineData(UserRole.FirmManager, false)]
    [InlineData(UserRole.FirmAccountant, true)]
    [InlineData(UserRole.FirmAccountant, false)]
    public void Ai_flag_off_removes_both_the_permission_and_the_module(UserRole role, bool isFirmManaged)
    {
        var permissions = FirmDelegatedAccess.BuildDelegatedPermissions(role);
        var moduleIds = FirmDelegatedAccess.BuildDelegatedModuleIds(isFirmManaged);

        var enabled = FirmDelegatedAccess.ApplyAiAccountingFlag(permissions, moduleIds, aiAccountingEnabled: true);
        Assert.Contains(Permissions.AI.Chat, enabled.Permissions);
        Assert.Contains((int)AppModule.AI, enabled.ModuleIds);

        var disabled = FirmDelegatedAccess.ApplyAiAccountingFlag(permissions, moduleIds, aiAccountingEnabled: false);
        Assert.DoesNotContain(Permissions.AI.Chat, disabled.Permissions);
        Assert.DoesNotContain((int)AppModule.AI, disabled.ModuleIds);

        // Rien d'autre ne bouge.
        Assert.Equal(
            permissions.Where(p => p != Permissions.AI.Chat).ToList(),
            disabled.Permissions);
        Assert.Equal(
            moduleIds.Where(m => m != (int)AppModule.AI).ToList(),
            disabled.ModuleIds);
    }
}
