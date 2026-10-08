using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.AI;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class TenantModalSettingsServiceTests
{
    private const string PlatformUrl = "https://platform--ep-kimi.modal.direct/v1";
    private const string TenantUrl = "https://tenant-a--ep-kimi.modal.direct/v1";
    private const string PlatformToken = "wk-platform.ws-platsecret";
    private const string TenantToken = "wk-tenantid.ws-tenantsecret12";

    [Fact]
    public async Task GetAsync_WhenNoOverride_InheritsPlatformAndHasOverrideFalse()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (service, _, platform) = CreateServices(db);
        await SeedPlatformModalAsync(platform);

        var result = await service.GetAsync(tenant.Id);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.HasOverride);
        Assert.False(result.Value.IsEnabled);
        Assert.False(result.Value.IsApiKeyConfigured);
        Assert.True(result.Value.Platform.IsEnabled);
        Assert.Equal("cret", result.Value.Platform.ApiKeyLast4);
        Assert.DoesNotContain("wk-", result.Value.Platform.ApiKeyLast4 ?? "");
        Assert.DoesNotContain(TenantToken, System.Text.Json.JsonSerializer.Serialize(result.Value));
    }

    [Fact]
    public async Task SetAsync_Enabled_EncryptsAndResolvesDedicatedCredentials()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (service, resolver, platform) = CreateServices(db);
        await SeedPlatformModalAsync(platform);
        var actor = Guid.NewGuid();

        var set = await service.SetAsync(tenant.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = true,
            DisplayName = "Kimi tenant",
            BaseUrl = TenantUrl + "/",
            ApiKey = TenantToken
        }, actor);

        Assert.True(set.IsSuccess);
        Assert.True(set.Value.HasOverride);
        Assert.True(set.Value.IsEnabled);
        Assert.Equal("Kimi tenant", set.Value.DisplayName);
        Assert.Equal(TenantUrl, set.Value.BaseUrl);
        Assert.True(set.Value.IsApiKeyConfigured);
        Assert.Equal("et12", set.Value.ApiKeyLast4);
        Assert.DoesNotContain("ws-tenant", set.Value.ApiKeyLast4 ?? "");

        var creds = await resolver.ResolveAsync(tenant.Id);
        Assert.Equal(ModalCredentialSource.TenantOverride, creds.Source);
        Assert.True(creds.IsEnabled);
        Assert.Equal(TenantToken, creds.ApiKey);
        Assert.Equal(TenantUrl, creds.BaseUrl);

        var stored = await db.TenantModalSettings.AsNoTracking().SingleAsync();
        Assert.NotEqual(TenantToken, stored.EncryptedApiKey);
    }

    [Fact]
    public async Task SetAsync_Disabled_DoesNotFallBackToPlatform()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (service, resolver, platform) = CreateServices(db);
        await SeedPlatformModalAsync(platform);

        var set = await service.SetAsync(tenant.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = false,
            DisplayName = "Off",
            BaseUrl = TenantUrl,
            ApiKey = TenantToken
        }, Guid.NewGuid());

        Assert.True(set.IsSuccess);
        Assert.True(set.Value.HasOverride);
        Assert.False(set.Value.IsEnabled);

        var creds = await resolver.ResolveAsync(tenant.Id);
        Assert.Equal(ModalCredentialSource.Disabled, creds.Source);
        Assert.False(creds.IsEnabled);
        Assert.Null(creds.ApiKey);
        Assert.NotEqual(PlatformUrl, creds.BaseUrl);
    }

    [Fact]
    public async Task SetAsync_EmptyApiKey_KeepsExistingSecret()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (service, resolver, platform) = CreateServices(db);

        await service.SetAsync(tenant.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = true,
            DisplayName = "Modal",
            BaseUrl = TenantUrl,
            ApiKey = TenantToken
        }, Guid.NewGuid());

        var before = await service.GetAsync(tenant.Id);

        var update = await service.SetAsync(tenant.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = true,
            DisplayName = "Modal Updated",
            BaseUrl = TenantUrl,
            ApiKey = null
        }, Guid.NewGuid());

        Assert.True(update.IsSuccess);
        Assert.Equal("Modal Updated", update.Value.DisplayName);
        Assert.Equal(before.Value.ApiKeyLast4, update.Value.ApiKeyLast4);
        Assert.True(update.Value.IsApiKeyConfigured);

        var creds = await resolver.ResolveAsync(tenant.Id);
        Assert.Equal(TenantToken, creds.ApiKey);
    }

    [Fact]
    public async Task SetAsync_EnableWithoutKey_Fails()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (service, _, _) = CreateServices(db);

        var result = await service.SetAsync(tenant.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = true,
            DisplayName = "Modal",
            BaseUrl = TenantUrl,
            ApiKey = null
        }, Guid.NewGuid());

        Assert.True(result.IsFailure);
        Assert.Contains("clé API", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SetAsync_HttpUrl_Fails()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (service, _, _) = CreateServices(db);

        var result = await service.SetAsync(tenant.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = true,
            DisplayName = "Modal",
            BaseUrl = "http://example--ep-kimi.modal.direct/v1",
            ApiKey = TenantToken
        }, Guid.NewGuid());

        Assert.True(result.IsFailure);
        Assert.Contains("HTTPS", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ResolveAsync_IsolatesTenantAFromTenantBInherit()
    {
        await using var db = CreateDb();
        var tenantA = await SeedTenantAsync(db, "Alpha");
        var tenantB = await SeedTenantAsync(db, "Beta");
        var (service, resolver, platform) = CreateServices(db);
        await SeedPlatformModalAsync(platform);

        await service.SetAsync(tenantA.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = true,
            DisplayName = "A",
            BaseUrl = TenantUrl,
            ApiKey = TenantToken
        }, Guid.NewGuid());

        var credsA = await resolver.ResolveAsync(tenantA.Id);
        var credsB = await resolver.ResolveAsync(tenantB.Id);

        Assert.Equal(ModalCredentialSource.TenantOverride, credsA.Source);
        Assert.Equal(TenantToken, credsA.ApiKey);
        Assert.Equal(TenantUrl, credsA.BaseUrl);

        Assert.Equal(ModalCredentialSource.Platform, credsB.Source);
        Assert.Equal(PlatformToken, credsB.ApiKey);
        Assert.Equal(PlatformUrl, credsB.BaseUrl);
    }

    [Fact]
    public async Task ResolveAsync_DecryptFailure_ReturnsEnabledWithNullKey()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (_, resolver, _) = CreateServices(db);

        var row = TenantModalSettings.Create(tenant.Id);
        row.SetModalConfig(
            isEnabled: true,
            displayName: "Broken",
            baseUrl: TenantUrl,
            encryptedApiKey: "not-a-valid-protector-payload",
            apiKeyLast4: "xxxx");
        db.TenantModalSettings.Add(row);
        await db.SaveChangesAsync();

        var creds = await resolver.ResolveAsync(tenant.Id);

        Assert.Equal(ModalCredentialSource.TenantOverride, creds.Source);
        Assert.True(creds.IsEnabled);
        Assert.Null(creds.ApiKey);
        Assert.Equal(TenantUrl, creds.BaseUrl);
    }

    [Fact]
    public async Task GetAsync_UnknownTenant_ReturnsNotFound()
    {
        await using var db = CreateDb();
        var (service, _, _) = CreateServices(db);

        var result = await service.GetAsync(Guid.NewGuid());

        Assert.True(result.IsFailure);
        Assert.Contains("NotFound", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DeleteAsync_RemovesOverrideAndFallsBackToPlatform()
    {
        await using var db = CreateDb();
        var tenant = await SeedTenantAsync(db, "Alpha");
        var (service, resolver, platform) = CreateServices(db);
        await SeedPlatformModalAsync(platform);

        await service.SetAsync(tenant.Id, new UpdateTenantModalSettingsRequest
        {
            IsEnabled = true,
            DisplayName = "A",
            BaseUrl = TenantUrl,
            ApiKey = TenantToken
        }, Guid.NewGuid());

        var deleted = await service.DeleteAsync(tenant.Id, Guid.NewGuid());
        Assert.True(deleted.IsSuccess);
        Assert.False(deleted.Value.HasOverride);

        var creds = await resolver.ResolveAsync(tenant.Id);
        Assert.Equal(ModalCredentialSource.Platform, creds.Source);
        Assert.Equal(PlatformToken, creds.ApiKey);
    }

    private static MasterDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    private static (TenantModalSettingsService Service, ModalCredentialsResolver Resolver, PlatformAiSettingsService Platform) CreateServices(
        MasterDbContext db)
    {
        var protection = new EphemeralDataProtectionProvider();
        var modal = Options.Create(new ModalSettings
        {
            DefaultBaseUrl = "https://example--ep-kimi-k3-server.us-west.modal.direct/v1",
            DefaultModelId = "moonshotai/Kimi-K3"
        });
        var openRouter = Options.Create(new OpenRouterSettings
        {
            DefaultBaseUrl = "https://openrouter.ai/api/v1"
        });
        var platform = new PlatformAiSettingsService(
            db,
            new MemoryCache(new MemoryCacheOptions()),
            protection,
            openRouter,
            modal,
            Options.Create(new DocStrangeSettings()),
            NullLogger<PlatformAiSettingsService>.Instance);
        var tenantService = new TenantModalSettingsService(
            db,
            platform,
            protection,
            modal,
            NullLogger<TenantModalSettingsService>.Instance);
        var resolver = new ModalCredentialsResolver(
            db,
            platform,
            protection,
            modal,
            NullLogger<ModalCredentialsResolver>.Instance);
        return (tenantService, resolver, platform);
    }

    private static async Task SeedPlatformModalAsync(PlatformAiSettingsService platform)
    {
        var (ok, error) = await platform.SetModalConfigAsync(
            true, "Platform Kimi", PlatformUrl, PlatformToken, Guid.NewGuid());
        Assert.True(ok, error);
    }

    private static async Task<Tenant> SeedTenantAsync(MasterDbContext db, string name)
    {
        var n = Random.Shared.Next(1000000, 9999999);
        var office = Random.Shared.Next(0, 999).ToString("000");
        var tenant = Tenant.Create(
            $"{name}-{n}",
            NIF.Create($"{n}/A/B/C/{office}").Value,
            Address.Create("1 rue Test", "Tunis", "Tunis").Value,
            Email.Create($"{name.ToLowerInvariant()}-{n}@example.com").Value,
            PhoneNumber.Create("20123456").Value,
            TaxRegime.RealRegime).Value;
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return tenant;
    }
}
