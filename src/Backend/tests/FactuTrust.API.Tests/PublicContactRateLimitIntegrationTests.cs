using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Lot C — TC9 (reliquat) : le pipeline HTTP de limitation de
/// <c>POST /api/public/contact-requests</c> est vérifié de bout en bout. Le 101ᵉ envoi dans la
/// fenêtre d'une heure (plafond développement = 100) doit répondre 429 avec l'en-tête
/// <c>Retry-After</c> posé par <c>OnRejected</c> — ce callback s'applique à TOUTES les politiques
/// (login, register, public-street-write…), d'où un test d'intégration dédié.
/// La fonctionnalité reste désactivée (503) : la limitation s'applique en amont du contrôleur,
/// aucune écriture en base n'a lieu.
/// </summary>
/// <summary>
/// Force l'environnement Development : le plafond de la politique « public-contact » vaut 100/h
/// en développement contre 5/h en production (Program.cs) — le test doit être déterministe.
/// </summary>
public sealed class PublicContactRateLimitWebApplicationFactory : ChannelsDisabledWebApplicationFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseEnvironment("Development");
    }
}

[Collection("SqlServerIntegration")]
public sealed class PublicContactRateLimitIntegrationTests : IClassFixture<PublicContactRateLimitWebApplicationFactory>
{
    private const string Url = "/api/public/contact-requests";

    private readonly HttpClient _client;

    public PublicContactRateLimitIntegrationTests(PublicContactRateLimitWebApplicationFactory factory)
    {
        _client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    [Fact]
    public async Task Submit_returns_429_with_RetryAfter_once_the_hourly_cap_is_reached()
    {
        var payload = new
        {
            subject = "autre",
            fullName = "Test Limite",
            organization = "Org Test",
            email = "limite@example.com",
            phone = "71123456",
            message = "Test du plafond horaire de la politique public-contact.",
            consent = true,
            locale = "fr",
            honeypot = "",
            elapsedMs = 8000
        };

        // Plafond développement : 100 envois / heure / IP (Program.cs, politique « public-contact »).
        for (var i = 0; i < 100; i += 1)
        {
            using var accepted = await _client.PostAsJsonAsync(Url, payload);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, accepted.StatusCode); // Enabled=false
        }

        using var rejected = await _client.PostAsJsonAsync(Url, payload);

        Assert.Equal((HttpStatusCode)429, rejected.StatusCode);
        Assert.True(
            rejected.Headers.TryGetValues("Retry-After", out var values),
            "L'en-tête Retry-After doit être posé par OnRejected.");
        var seconds = int.Parse(values!.Single(), System.Globalization.CultureInfo.InvariantCulture);
        Assert.InRange(seconds, 1, 3600);

        var body = await rejected.Content.ReadAsStringAsync();
        Assert.Contains("\"success\":false", body, StringComparison.Ordinal);
    }
}
