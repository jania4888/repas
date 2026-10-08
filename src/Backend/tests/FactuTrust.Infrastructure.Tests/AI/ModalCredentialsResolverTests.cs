using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class ModalCredentialsResolverTests
{
    [Fact]
    public async Task ResolveAsync_NullTenantId_ReturnsPlatform()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        await using var db = new MasterDbContext(options);

        var protection = new EphemeralDataProtectionProvider();
        var modal = Options.Create(new ModalSettings
        {
            DefaultBaseUrl = "https://platform--ep-kimi.modal.direct/v1",
            DefaultModelId = "moonshotai/Kimi-K3"
        });
        var platform = new PlatformAiSettingsService(
            db,
            new MemoryCache(new MemoryCacheOptions()),
            protection,
            Options.Create(new OpenRouterSettings { DefaultBaseUrl = "https://openrouter.ai/api/v1" }),
            modal,
            Options.Create(new DocStrangeSettings()),
            NullLogger<PlatformAiSettingsService>.Instance);
        await platform.SetModalConfigAsync(
            true,
            "Platform",
            "https://platform--ep-kimi.modal.direct/v1",
            "wk-platform.ws-secret99",
            Guid.NewGuid());

        var resolver = new ModalCredentialsResolver(
            db,
            platform,
            protection,
            modal,
            NullLogger<ModalCredentialsResolver>.Instance);

        var creds = await resolver.ResolveAsync(null);

        Assert.Equal(ModalCredentialSource.Platform, creds.Source);
        Assert.True(creds.IsEnabled);
        Assert.Equal("wk-platform.ws-secret99", creds.ApiKey);
        Assert.Equal("https://platform--ep-kimi.modal.direct/v1", creds.BaseUrl);
    }
}
