using System.Reflection;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Plan v2, Phase 3 (p3-10) : contrat de <c>GET api/accounting/lettering/suggestions</c>. Verbe et
/// route, lecture comptable seulement, limite de débit dédiée, et existence de cette limite au
/// démarrage (un nom de politique inconnu ferait échouer chaque requête en 500).
/// </summary>
public sealed class LetteringSuggestionsAuthorizationTests
{
    private static MethodInfo Action =>
        typeof(AccountingController).GetMethod(nameof(AccountingController.GetLetteringSuggestions))!;

    [Fact]
    public void Endpoint_IsAGet_OnLetteringSuggestions()
    {
        var get = Action.GetCustomAttribute<HttpGetAttribute>();
        Assert.NotNull(get);
        Assert.Equal("lettering/suggestions", get!.Template);
        Assert.Null(Action.GetCustomAttribute<HttpPostAttribute>());
    }

    [Fact]
    public void Endpoint_RequiresAccountingRead()
    {
        var authorize = Action.GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Equal(PermissionPolicies.AccountingRead, authorize!.Policy);
        Assert.Null(Action.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    [Fact]
    public void Endpoint_UsesTheAccountingSuggestionsRateLimit()
    {
        var limiter = Action.GetCustomAttribute<EnableRateLimitingAttribute>();
        Assert.NotNull(limiter);
        Assert.Equal("accounting-suggestions", limiter!.PolicyName);
    }
}
