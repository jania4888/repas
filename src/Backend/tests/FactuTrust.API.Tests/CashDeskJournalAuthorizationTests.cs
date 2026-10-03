using System.Reflection;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class CashDeskJournalAuthorizationTests
{
    [Theory]
    [InlineData(nameof(CashDeskController.GetJournal))]
    [InlineData(nameof(CashDeskController.ExportJournalPdf))]
    public void JournalEndpoints_RequirePaymentsRead(string methodName)
    {
        var method = typeof(CashDeskController).GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public);
        Assert.NotNull(method);

        var authorize = method!.GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Equal(PermissionPolicies.PaymentsRead, authorize!.Policy);
        Assert.NotNull(method.GetCustomAttribute<HttpGetAttribute>());
    }
}
