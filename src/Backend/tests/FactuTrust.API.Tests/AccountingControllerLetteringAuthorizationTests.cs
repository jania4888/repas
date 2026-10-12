using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using Microsoft.AspNetCore.Authorization;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Plan de refonte du lettrage §6 / §11 (porte de tests Phase 1) : vérifie par réflexion que les
/// nouveaux points d'entrée de lettrage portent exactement la policy attendue — <c>Unletter</c>
/// exige la permission dédiée <see cref="PermissionPolicies.AccountingUnletter"/>, tandis que
/// <c>Letter</c>/<c>CompletePartialLettering</c>/<c>SettleExchangeDifference</c> restent sur
/// <see cref="PermissionPolicies.AccountingCreate"/> (lettrage/complétion restent permis au
/// comptable entreprise, seul le délettrage lui est retiré) et les nouveaux GET sur
/// <see cref="PermissionPolicies.AccountingRead"/>.
/// </summary>
public sealed class AccountingControllerLetteringAuthorizationTests
{
    [Theory]
    [InlineData(nameof(AccountingController.Letter), PermissionPolicies.AccountingCreate)]
    [InlineData(nameof(AccountingController.CompletePartialLettering), PermissionPolicies.AccountingCreate)]
    [InlineData(nameof(AccountingController.SettleExchangeDifference), PermissionPolicies.AccountingCreate)]
    [InlineData(nameof(AccountingController.GetLetteringLines), PermissionPolicies.AccountingRead)]
    [InlineData(nameof(AccountingController.GetLetteringGroup), PermissionPolicies.AccountingRead)]
    [InlineData(nameof(AccountingController.Unletter), PermissionPolicies.AccountingUnletter)]
    public void LetteringEndpoint_RequiresExpectedPolicy(string methodName, string expectedPolicy)
    {
        var method = typeof(AccountingController).GetMethod(methodName);
        Assert.NotNull(method);

        var attribute = (AuthorizeAttribute?)Attribute.GetCustomAttribute(method!, typeof(AuthorizeAttribute));
        Assert.NotNull(attribute);
        Assert.Equal(expectedPolicy, attribute!.Policy);
    }

    [Fact]
    public void Unletter_DoesNotShare_AccountingCreatePolicy()
    {
        // Garde contre régression : si quelqu'un revert la permission dédiée, ce test échoue
        // explicitement plutôt que de laisser Unletter retomber silencieusement sur Create.
        var method = typeof(AccountingController).GetMethod(nameof(AccountingController.Unletter));
        var attribute = (AuthorizeAttribute?)Attribute.GetCustomAttribute(method!, typeof(AuthorizeAttribute));
        Assert.NotEqual(PermissionPolicies.AccountingCreate, attribute!.Policy);
    }
}
