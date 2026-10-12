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
        // Deux tables internes : PolicyMap (AddPolicy avec délégué, AddFixedWindowLimiter…) et
        // UnactivatedPolicyMap (AddPolicy<TKey, TPolicy> par classe). Une table absente (nom changé
        // par une version de .NET) fait échouer le test : jamais un faux succès.
        var registered = new HashSet<string>(StringComparer.Ordinal);
        foreach (var mapName in new[] { "PolicyMap", "UnactivatedPolicyMap" })
        {
            var map = typeof(RateLimiterOptions)
                .GetProperty(mapName, BindingFlags.Instance | BindingFlags.NonPublic)?
                .GetValue(options) as System.Collections.IDictionary;
            Assert.True(map is not null, $"Table interne introuvable : RateLimiterOptions.{mapName}");
            foreach (var key in map!.Keys)
                registered.Add((string)key);
        }

        var used = typeof(AccountingController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t))
            .SelectMany(t => t.GetMethods().Cast<MemberInfo>().Append(t))
            .Select(m => m.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName)
            .Where(n => n is not null)
            .Distinct()
            .ToList();

        Assert.Contains("accounting-suggestions", used);
        Assert.Contains("accounting-bulk", used);
        Assert.All(used, name => Assert.True(registered.Contains(name!), $"Politique de débit non enregistrée : {name}"));
    }
}
