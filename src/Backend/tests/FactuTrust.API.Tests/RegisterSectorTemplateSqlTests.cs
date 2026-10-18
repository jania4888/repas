using System.Net;
using System.Net.Http.Json;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.SectorRules;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Application des modèles de données sectoriels à la provision d'un tenant (plan §WP-B6) —
/// facts SQL-dépendants, même stratégie « skip cleanly without SQL » que
/// <see cref="RegisterSectorConfigurationSqlTests"/>. Set <c>RUN_SECTOR_TEMPLATE_SQL_TESTS=1</c>
/// pour exécuter ; absent (défaut du bac à sable), chaque fait retourne immédiatement.
/// </summary>
[Collection("SqlServerIntegration")]
public sealed class RegisterSectorTemplateSqlTests : IClassFixture<ChannelsDisabledWebApplicationFactory>
{
    private static bool ShouldRun => Environment.GetEnvironmentVariable("RUN_SECTOR_TEMPLATE_SQL_TESTS") == "1";

    private readonly ChannelsDisabledWebApplicationFactory _factory;

    public RegisterSectorTemplateSqlTests(ChannelsDisabledWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private sealed class ThrowingSectorDataTemplateApplier : ISectorDataTemplateApplier
    {
        public Task<SectorTemplateApplyResult> ApplyAsync(
            Guid tenantId, string connectionString, string? segmentCode, string? domainCode, bool dryRun, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("Simulated template applier failure.");
    }

    private static RegisterDto BuildDto(string unique)
    {
        var nifDigits = (Convert.ToUInt64(unique, 16) % 10_000_000_000UL).ToString("D10");
        return new RegisterDto
        {
            Email = $"sector-tpl-{unique}@example.com",
            Password = "SecurePass123!",
            ConfirmPassword = "SecurePass123!",
            FirstName = "Sector",
            LastName = "Template",
            CompanyName = $"Société Template {unique}",
            Nif = $"{nifDigits[..7]}/A/B/C/{nifDigits[7..]}",
            TaxRegime = TaxRegime.RealRegime,
            Street = "1 rue Test",
            City = "Tunis",
            PostalCode = "1000",
            Governorate = "Tunis",
            CompanyEmail = $"contact-sector-tpl-{unique}@example.com",
            Phone = "71123456"
        };
    }

    private WebApplicationFactory<Program> WithDbRulesEnabled() =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Features:RegistrationSector:UseDbRules"] = "true"
                });
            });
        });

    [Fact]
    public async Task Register_with_db_rules_and_matching_template_seeds_tenant_data_once()
    {
        if (!ShouldRun) return;

        using var dbRulesFactory = WithDbRulesEnabled();
        var accountNumber = "8" + Guid.NewGuid().ToString("N")[..3];
        var templateCode = "sql-test-" + Guid.NewGuid().ToString("N")[..8];

        using (var scope = dbRulesFactory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
            var template = SectorDataTemplate.Create(templateCode, null, null, "Modèle test SQL", null, version: 1, sortOrder: 0);
            db.SectorDataTemplates.Add(template);
            db.SectorDataTemplateItems.Add(SectorDataTemplateItem.Create(
                template.Id,
                "chart-account",
                $$"""{"accountNumber":"{{accountNumber}}","label":"Compte test SQL","accountClass":4,"natureType":"Debit"}""",
                sortOrder: 0));
            await db.SaveChangesAsync();
        }

        var client = ChannelsDisabledWebApplicationFactory.WithClientTimeout(
            dbRulesFactory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }));
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique);

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);

        var tenantId = body!.Data!.User.TenantId;

        using var scope2 = dbRulesFactory.Services.CreateScope();
        var tenantService = scope2.ServiceProvider.GetRequiredService<ITenantService>();
        var connectionString = await tenantService.GetConnectionStringAsync(tenantId)
            ?? throw new InvalidOperationException($"No connection string resolvable for tenant {tenantId}");

        var options = new DbContextOptionsBuilder<TenantDbContext>().UseSqlServer(connectionString).Options;
        await using var tenantContext = new TenantDbContext(options);

        Assert.True(await tenantContext.ChartOfAccounts.AnyAsync(a => a.AccountNumber == accountNumber));
        Assert.True(await tenantContext.AppliedSectorTemplates.AnyAsync(t => t.TemplateCode == templateCode && t.Version == 1));

        // Re-provisioning is not exercised by /register, but the (TemplateCode, Version) unique
        // index guarantees a second ApplyAsync call for this tenant would skip, not duplicate.
        Assert.Equal(1, await tenantContext.AppliedSectorTemplates.CountAsync(t => t.TemplateCode == templateCode));
    }

    [Fact]
    public async Task Register_succeeds_even_when_template_apply_throws()
    {
        if (!ShouldRun) return;

        using var dbRulesFactory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Features:RegistrationSector:UseDbRules"] = "true"
                });
            });
            builder.ConfigureTestServices(services =>
            {
                services.AddScoped<ISectorDataTemplateApplier, ThrowingSectorDataTemplateApplier>();
            });
        });

        var client = ChannelsDisabledWebApplicationFactory.WithClientTimeout(
            dbRulesFactory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }));
        var unique = Guid.NewGuid().ToString("N")[..12];
        var dto = BuildDto(unique);

        var response = await client.PostAsJsonAsync("/api/auth/register", dto, TenantUsersTestSupport.ApiJsonOptions);
        var body = await response.Content.ReadFromJsonAsync<ApiResponse<AuthResponseDto>>(TenantUsersTestSupport.ApiJsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(body?.Data);
    }
}
