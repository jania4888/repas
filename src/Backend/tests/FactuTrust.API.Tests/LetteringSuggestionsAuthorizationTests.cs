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

/// <summary>
/// Garde transverse : chaque nom de politique de <c>[EnableRateLimiting]</c> porté par un contrôleur est
/// enregistré dans <c>Program.cs</c>. Le limiteur s'exécute après l'autorisation : un appel anonyme ne
/// le révèle donc pas ; seule la configuration réelle de l'hôte le prouve.
/// </summary>
public sealed class RateLimitPolicyRegistrationTests : IClassFixture<ChannelsDisabledWebApplicationFactory>
{
    private readonly ChannelsDisabledWebApplicationFactory _factory;

    public RateLimitPolicyRegistrationTests(ChannelsDisabledWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public void EveryControllerRateLimitPolicy_IsRegistered()
    {
        var options = _factory.Services.GetRequiredService<IOptions<RateLimiterOptions>>().Value;
        var policyMap = typeof(RateLimiterOptions)
            .GetProperty("PolicyMap", BindingFlags.Instance | BindingFlags.NonPublic)?
            .GetValue(options) as System.Collections.IDictionary;
        Assert.NotNull(policyMap);

        var used = typeof(AccountingController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t))
            .SelectMany(t => t.GetMethods().Cast<MemberInfo>().Append(t))
            .Select(m => m.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName)
            .Where(n => n is not null)
            .Distinct()
            .ToList();

        Assert.Contains("accounting-suggestions", used);
        Assert.All(used, name => Assert.True(policyMap!.Contains(name!), $"Politique de débit non enregistrée : {name}"));
    }
}
