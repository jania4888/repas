using System.Net;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Import de relevés bancaires par GLM-OCR (plan v1 §4.5, §5, §7.2) : le contrôle de santé
/// « ollama-bank-statement-vision » porte le seul tag <c>ai</c>. Il est donc exclu de
/// <c>/health/ready</c> (healthcheck Docker de l'API : un moteur IA arrêté ne doit jamais faire
/// redémarrer l'API) et n'est exposé que par <c>/api/platform/ops/health</c>, réservé aux
/// administrateurs plateforme (401 sans jeton). Le contrôle de démarrage est un service hébergé
/// non bloquant. Nécessite SQL (construction de l'hôte), comme les autres tests de la collection.
/// </summary>
[Collection("SqlServerIntegration")]
public sealed class BankStatementVisionHealthCheckRegistrationTests : IClassFixture<ChannelsDisabledWebApplicationFactory>
{
    private readonly ChannelsDisabledWebApplicationFactory _factory;

    public BankStatementVisionHealthCheckRegistrationTests(ChannelsDisabledWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public void Vision_health_check_is_registered_with_tag_ai_only()
    {
        var registrations = _factory.Services.GetRequiredService<IOptions<HealthCheckServiceOptions>>().Value.Registrations;

        var vision = Assert.Single(registrations, r => r.Name == OllamaVisionModelHealthCheck.Name);
        Assert.Contains(OllamaVisionModelHealthCheck.Tag, vision.Tags);
        Assert.DoesNotContain("ready", vision.Tags);
        Assert.Equal(OllamaVisionModelHealthCheck.Timeout, vision.Timeout);

        var masterDb = Assert.Single(registrations, r => r.Name == "master-db");
        Assert.Contains("ready", masterDb.Tags);
    }

    [Fact]
    public void Vision_startup_check_is_a_registered_hosted_service()
    {
        var hostedServices = _factory.Services.GetServices<IHostedService>();

        Assert.Contains(hostedServices, s => s is OllamaVisionModelStartupCheckHostedService);
    }

    [Fact]
    public async Task Health_ready_never_reports_the_vision_check()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.GetAsync("/health/ready");
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(
            response.StatusCode is HttpStatusCode.OK or HttpStatusCode.ServiceUnavailable,
            $"Unexpected status {(int)response.StatusCode}: {body}");
        Assert.DoesNotContain(OllamaVisionModelHealthCheck.Name, body);
        Assert.Contains("master-db", body);
    }

    [Fact]
    public async Task Ops_health_requires_authentication()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.GetAsync("/api/platform/ops/health");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
