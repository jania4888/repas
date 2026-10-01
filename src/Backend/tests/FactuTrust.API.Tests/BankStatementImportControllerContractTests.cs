using System.Reflection;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Contrat de sécurité du contrôleur d'import IA de relevés bancaires : chaque action porte une
/// politique de permission EXISTANTE (aucune nouvelle permission), les actions qui sollicitent
/// l'IA passent par la limite de débit « ai », l'upload est borné, et aucune action n'accepte
/// de paramètre de modèle IA venant du client.
/// </summary>
public sealed class BankStatementImportControllerContractTests
{
    private static readonly Type Controller = typeof(BankStatementImportController);

    private static IEnumerable<MethodInfo> Actions =>
        Controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    private static MethodInfo Action(string name) => Controller.GetMethod(name, BindingFlags.Public | BindingFlags.Instance)!;

    [Fact]
    public void Controller_is_routed_under_accounting_so_delegated_firms_keep_write_access()
    {
        Assert.Equal("api/accounting/bank-statement-import", Controller.GetCustomAttribute<RouteAttribute>()!.Template);
        Assert.NotNull(Controller.GetCustomAttribute<AuthorizeAttribute>());
    }

    [Fact]
    public void Every_action_carries_an_existing_accounting_policy()
    {
        var unprotected = Actions
            .Where(a => a.GetCustomAttributes<AuthorizeAttribute>()
                .All(attr => attr.Policy != PermissionPolicies.AccountingRead && attr.Policy != PermissionPolicies.AccountingCreate))
            .Select(a => a.Name)
            .ToList();

        Assert.Empty(unprotected);
    }

    [Theory]
    [InlineData("Start")]
    [InlineData("Cancel")]
    [InlineData("Confirm")]
    [InlineData("ClassifyWithAi")]
    [InlineData("Generate")]
    public void Writing_actions_require_accounting_create(string action) =>
        Assert.Contains(Action(action).GetCustomAttributes<AuthorizeAttribute>(), a => a.Policy == PermissionPolicies.AccountingCreate);

    [Theory]
    [InlineData("Start")]
    [InlineData("ClassifyWithAi")]
    public void Ai_actions_are_rate_limited(string action) =>
        Assert.Equal("ai", Action(action).GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);

    [Fact]
    public void Upload_size_is_bounded_to_about_ten_megabytes()
    {
        var limit = Action("Start").GetCustomAttribute<RequestSizeLimitAttribute>();
        Assert.NotNull(limit);
        var bytes = (long)typeof(RequestSizeLimitAttribute)
            .GetField("_bytes", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(limit)!;
        Assert.InRange(bytes, 10 * 1024 * 1024, 11 * 1024 * 1024);
    }

    [Fact]
    public void Source_file_is_served_by_identifier_only_never_by_path()
    {
        var action = Action("GetSourceFile");
        Assert.Equal("statements/{statementId:guid}/source-file", action.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.Contains(action.GetCustomAttributes<AuthorizeAttribute>(), a => a.Policy == PermissionPolicies.AccountingRead);
        Assert.Equal(new[] { typeof(Guid), typeof(CancellationToken) }, action.GetParameters().Select(p => p.ParameterType));
    }

    [Fact]
    public void No_action_lets_the_client_choose_the_ai_model()
    {
        var modelParameters = Actions
            .SelectMany(a => a.GetParameters())
            .Where(p => p.Name is not null && p.Name.Contains("model", StringComparison.OrdinalIgnoreCase))
            .Select(p => p.Name)
            .ToList();

        Assert.Empty(modelParameters);
    }
}
