using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Tableau de bord comptable du dossier délégué (plan §5) : le nouveau GET exige la lecture
/// comptable ET le contexte délégué du cabinet, sans toucher au dashboard historique.
/// </summary>
public sealed class AccountingControllerOverviewAuthorizationTests
{
    private static string[] PoliciesOf(string methodName)
    {
        var method = typeof(AccountingController).GetMethod(methodName);
        Assert.NotNull(method);
        return Attribute.GetCustomAttributes(method!, typeof(AuthorizeAttribute))
            .Cast<AuthorizeAttribute>()
            .Select(a => a.Policy!)
            .ToArray();
    }

    [Fact]
    public void GetDashboardOverview_RequiresAccountingRead_AndFirmDelegatedContext()
    {
        var policies = PoliciesOf(nameof(AccountingController.GetDashboardOverview));

        Assert.Contains(PermissionPolicies.AccountingRead, policies);
        Assert.Contains(PermissionPolicies.FirmDelegatedContext, policies);
        Assert.Equal(2, policies.Length);
    }

    [Fact]
    public void GetDashboardOverview_IsGet_OnDashboardOverviewRoute()
    {
        var method = typeof(AccountingController).GetMethod(nameof(AccountingController.GetDashboardOverview));
        var http = (HttpGetAttribute?)Attribute.GetCustomAttribute(method!, typeof(HttpGetAttribute));

        Assert.NotNull(http);
        Assert.Equal("dashboard/overview", http!.Template);
    }

    [Fact]
    public void GetDashboard_Legacy_KeepsOnlyAccountingRead()
    {
        // Non-régression : le dashboard entreprise (AiToolExecutor + Angular getDashboard) ne
        // doit pas hériter du contexte délégué.
        var policies = PoliciesOf(nameof(AccountingController.GetDashboard));

        Assert.Equal(new[] { PermissionPolicies.AccountingRead }, policies);
    }
}
