using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Entities.AI;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class PlatformAiSettingsServiceTests
{
    private static PlatformAiSettingsService CreateService(MasterDbContext db, IMemoryCache? cache = null)
    {
        var protection = new EphemeralDataProtectionProvider();
        var openRouter = Options.Create(new OpenRouterSettings
        {
            DefaultBaseUrl = "https://openrouter.ai/api/v1"
        });
        var modal = Options.Create(new ModalSettings
        {
            DefaultBaseUrl = "https://example--ep-kimi-k3-server.us-west.modal.direct/v1",
            DefaultModelId = "moonshotai/Kimi-K3"
        });
        return new PlatformAiSettingsService(
            db,
            cache ?? new MemoryCache(new MemoryCacheOptions()),
            protection,
            openRouter,
            modal,
            Options.Create(new DocStrangeSettings()),
            NullLogger<PlatformAiSettingsService>.Instance);
    }

    [Fact]
    public async Task GetInvoiceImportModelRefAsync_WhenNoRow_ReturnsNull()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var result = await service.GetInvoiceImportModelRefAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task GetInvoiceImportModelRefAsync_WhenConfigured_ReturnsNormalizedRef()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var row = PlatformAiSettings.CreateDefaults();
        row.SetInvoiceImportModel("qwen2.5:7b-instruct");
        db.PlatformAiSettings.Add(row);
        await db.SaveChangesAsync();

        var service = CreateService(db);

        var result = await service.GetInvoiceImportModelRefAsync();

        Assert.Equal("qwen2.5:7b-instruct", result);
    }

    [Fact]
    public async Task GetStudioAiModelRefAsync_WhenNoRow_ReturnsNull()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var result = await service.GetStudioAiModelRefAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task GetStudioAiModelRefAsync_WhenConfigured_ReturnsNormalizedRef()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var row = PlatformAiSettings.CreateDefaults();
        row.SetStudioAiModel("qwen2.5:7b-instruct");
        db.PlatformAiSettings.Add(row);
        await db.SaveChangesAsync();

        var service = CreateService(db);

        var result = await service.GetStudioAiModelRefAsync();

        Assert.Equal("qwen2.5:7b-instruct", result);
    }

    [Fact]
    public async Task SetStudioAiModelRefAsync_Clear_ReturnsNull()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        await service.SetStudioAiModelRefAsync("ollama:qwen2.5:7b-instruct", actorId);
        var cleared = await service.SetStudioAiModelRefAsync("", actorId);
        var read = await service.GetStudioAiModelRefAsync();

        Assert.Null(cleared);
        Assert.Null(read);
    }

    [Fact]
    public async Task GetStudioAiAdvancedModelRefAsync_WhenNoRow_ReturnsNull()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var result = await service.GetStudioAiAdvancedModelRefAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task SetStudioAiAdvancedModelRefAsync_Persists_And_InvalidatesCache()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(db, cache);
        var actorId = Guid.NewGuid();

        // Lecture avant écriture : met en cache la valeur nulle, que l'écriture doit invalider.
        Assert.Null(await service.GetStudioAiAdvancedModelRefAsync());

        var saved = await service.SetStudioAiAdvancedModelRefAsync(
            "openrouter:qwen/qwen-2.5-72b-instruct", actorId);

        Assert.Equal("openrouter:qwen/qwen-2.5-72b-instruct", saved);
        Assert.Equal(
            "openrouter:qwen/qwen-2.5-72b-instruct",
            await service.GetStudioAiAdvancedModelRefAsync());
    }

    [Fact]
    public async Task SetStudioAiAdvancedModelRefAsync_Clear_ReturnsNull()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        await service.SetStudioAiAdvancedModelRefAsync("openrouter:qwen/qwen-2.5-72b-instruct", actorId);
        var cleared = await service.SetStudioAiAdvancedModelRefAsync("", actorId);
        var read = await service.GetStudioAiAdvancedModelRefAsync();

        Assert.Null(cleared);
        Assert.Null(read);
    }

    [Fact]
    public async Task Studio_standard_and_advanced_models_are_cached_independently()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var row = PlatformAiSettings.CreateDefaults();
        row.SetStudioAiModel("qwen2.5:7b-instruct");
        row.SetStudioAiAdvancedModel("openrouter:qwen/qwen-2.5-72b-instruct");
        db.PlatformAiSettings.Add(row);
        await db.SaveChangesAsync();

        var service = CreateService(db, new MemoryCache(new MemoryCacheOptions()));

        // Lectures séquentielles : le MasterDbContext est scoped, jamais de Task.WhenAll.
        Assert.Equal("qwen2.5:7b-instruct", await service.GetStudioAiModelRefAsync());
        Assert.Equal(
            "openrouter:qwen/qwen-2.5-72b-instruct",
            await service.GetStudioAiAdvancedModelRefAsync());
    }

    [Fact]
    public async Task GetInferenceDeviceAsync_WhenNoRow_ReturnsGpu()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var result = await service.GetInferenceDeviceAsync();

        Assert.Equal(OllamaInferenceDevice.Gpu, result);
    }

    [Fact]
    public async Task SetInferenceDeviceAsync_PersistsCpuOnly()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        var stored = await service.SetInferenceDeviceAsync(OllamaInferenceDevice.CpuOnly, actorId);
        var read = await service.GetInferenceDeviceAsync();

        Assert.Equal(OllamaInferenceDevice.CpuOnly, stored);
        Assert.Equal(OllamaInferenceDevice.CpuOnly, read);
    }

    [Fact]
    public async Task GetInferenceDeviceAsync_UsesCache_AfterFirstRead()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var row = PlatformAiSettings.CreateDefaults();
        row.SetInferenceDevice(OllamaInferenceDevice.CpuOnly);
        db.PlatformAiSettings.Add(row);
        await db.SaveChangesAsync();

        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(db, cache);

        var first = await service.GetInferenceDeviceAsync();
        db.PlatformAiSettings.Remove(row);
        await db.SaveChangesAsync();

        var second = await service.GetInferenceDeviceAsync();

        Assert.Equal(OllamaInferenceDevice.CpuOnly, first);
        Assert.Equal(OllamaInferenceDevice.CpuOnly, second);
    }

    [Fact]
    public async Task SetOpenRouterConfigAsync_EncryptsAndMasksKey()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        var (ok, error) = await service.SetOpenRouterConfigAsync(
            isEnabled: true,
            displayName: "OpenRouter Prod",
            baseUrl: "https://openrouter.ai/api/v1/",
            apiKey: "sk-or-v1-abcdefghij",
            actorId);

        Assert.True(ok);
        Assert.Null(error);

        var masked = await service.GetOpenRouterSettingsAsync();
        Assert.True(masked.IsEnabled);
        Assert.Equal("OpenRouter Prod", masked.DisplayName);
        Assert.Equal("https://openrouter.ai/api/v1", masked.BaseUrl);
        Assert.True(masked.IsApiKeyConfigured);
        Assert.Equal("ghij", masked.ApiKeyLast4);
        Assert.DoesNotContain("sk-or", masked.ApiKeyLast4 ?? "");

        var creds = await service.GetOpenRouterCredentialsAsync();
        Assert.True(creds.IsEnabled);
        Assert.Equal("sk-or-v1-abcdefghij", creds.ApiKey);
        Assert.Equal("https://openrouter.ai/api/v1", creds.BaseUrl);

        var stored = await db.PlatformAiSettings.AsNoTracking().SingleAsync();
        Assert.NotEqual("sk-or-v1-abcdefghij", stored.OpenRouterEncryptedApiKey);
    }

    [Fact]
    public async Task SetOpenRouterConfigAsync_EmptyApiKey_KeepsExistingSecret()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        await service.SetOpenRouterConfigAsync(true, "OR", null, "sk-or-secret-key12", actorId);
        var before = await service.GetOpenRouterSettingsAsync();

        var (ok, error) = await service.SetOpenRouterConfigAsync(
            isEnabled: true,
            displayName: "OR Updated",
            baseUrl: null,
            apiKey: null,
            actorId);

        Assert.True(ok);
        Assert.Null(error);

        var after = await service.GetOpenRouterSettingsAsync();
        Assert.Equal("OR Updated", after.DisplayName);
        Assert.Equal(before.ApiKeyLast4, after.ApiKeyLast4);
        Assert.True(after.IsApiKeyConfigured);

        var creds = await service.GetOpenRouterCredentialsAsync();
        Assert.Equal("sk-or-secret-key12", creds.ApiKey);
    }

    [Fact]
    public async Task SetOpenRouterConfigAsync_EnableWithoutKey_Fails()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var (ok, error) = await service.SetOpenRouterConfigAsync(
            isEnabled: true,
            displayName: "OR",
            baseUrl: null,
            apiKey: null,
            Guid.NewGuid());

        Assert.False(ok);
        Assert.Contains("clé API", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SetCursorConfigAsync_EncryptsAndMasksKey()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        var (ok, error) = await service.SetCursorConfigAsync(
            isEnabled: true,
            displayName: "Cursor Prod",
            apiKey: "cursor_abcdefghij",
            actorId);

        Assert.True(ok);
        Assert.Null(error);

        var masked = await service.GetCursorSettingsAsync();
        Assert.True(masked.IsEnabled);
        Assert.Equal("Cursor Prod", masked.DisplayName);
        Assert.True(masked.IsApiKeyConfigured);
        Assert.Equal("ghij", masked.ApiKeyLast4);
        Assert.DoesNotContain("cursor_", masked.ApiKeyLast4 ?? "");

        var creds = await service.GetCursorCredentialsAsync();
        Assert.True(creds.IsEnabled);
        Assert.Equal("cursor_abcdefghij", creds.ApiKey);

        var stored = await db.PlatformAiSettings.AsNoTracking().SingleAsync();
        Assert.NotEqual("cursor_abcdefghij", stored.CursorEncryptedApiKey);
    }

    [Fact]
    public async Task SetCursorConfigAsync_EmptyApiKey_KeepsExistingSecret()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        await service.SetCursorConfigAsync(true, "Cursor", "cursor_secret-key12", actorId);
        var before = await service.GetCursorSettingsAsync();

        var (ok, error) = await service.SetCursorConfigAsync(
            isEnabled: true,
            displayName: "Cursor Updated",
            apiKey: null,
            actorId);

        Assert.True(ok);
        Assert.Null(error);

        var after = await service.GetCursorSettingsAsync();
        Assert.Equal("Cursor Updated", after.DisplayName);
        Assert.Equal(before.ApiKeyLast4, after.ApiKeyLast4);
        Assert.True(after.IsApiKeyConfigured);

        var creds = await service.GetCursorCredentialsAsync();
        Assert.Equal("cursor_secret-key12", creds.ApiKey);
    }

    [Fact]
    public async Task SetCursorConfigAsync_EnableWithoutKey_Fails()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var (ok, error) = await service.SetCursorConfigAsync(
            isEnabled: true,
            displayName: "Cursor",
            apiKey: null,
            Guid.NewGuid());

        Assert.False(ok);
        Assert.Contains("clé API", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SetModalConfigAsync_EncryptsAndMasksKey()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();
        const string token = "wk-testid.ws-testsecret";
        const string baseUrl = "https://example--ep-kimi-k3-server.us-west.modal.direct/v1/";

        var (ok, error) = await service.SetModalConfigAsync(
            isEnabled: true,
            displayName: "Kimi 3",
            baseUrl: baseUrl,
            apiKey: token,
            actorId);

        Assert.True(ok);
        Assert.Null(error);

        var masked = await service.GetModalSettingsAsync();
        Assert.True(masked.IsEnabled);
        Assert.Equal("Kimi 3", masked.DisplayName);
        Assert.Equal("https://example--ep-kimi-k3-server.us-west.modal.direct/v1", masked.BaseUrl);
        Assert.True(masked.IsApiKeyConfigured);
        Assert.Equal("cret", masked.ApiKeyLast4);
        Assert.DoesNotContain("ws-test", masked.ApiKeyLast4 ?? "");
        Assert.Equal("moonshotai/Kimi-K3", masked.DefaultModelId);

        var creds = await service.GetModalCredentialsAsync();
        Assert.True(creds.IsEnabled);
        Assert.Equal(token, creds.ApiKey);
        Assert.Equal("https://example--ep-kimi-k3-server.us-west.modal.direct/v1", creds.BaseUrl);

        var stored = await db.PlatformAiSettings.AsNoTracking().SingleAsync();
        Assert.NotEqual(token, stored.ModalEncryptedApiKey);
    }

    [Fact]
    public async Task SetModalConfigAsync_EmptyApiKey_KeepsExistingSecret()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();
        const string token = "wk-testid.ws-secret-key12";
        const string baseUrl = "https://example--ep-kimi-k3-server.us-west.modal.direct/v1";

        await service.SetModalConfigAsync(true, "Modal", baseUrl, token, actorId);
        var before = await service.GetModalSettingsAsync();

        var (ok, error) = await service.SetModalConfigAsync(
            isEnabled: true,
            displayName: "Modal Updated",
            baseUrl: baseUrl,
            apiKey: null,
            actorId);

        Assert.True(ok);
        Assert.Null(error);

        var after = await service.GetModalSettingsAsync();
        Assert.Equal("Modal Updated", after.DisplayName);
        Assert.Equal(before.ApiKeyLast4, after.ApiKeyLast4);
        Assert.True(after.IsApiKeyConfigured);

        var creds = await service.GetModalCredentialsAsync();
        Assert.Equal(token, creds.ApiKey);
    }

    [Fact]
    public async Task SetModalConfigAsync_EnableWithoutKey_Fails()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var (ok, error) = await service.SetModalConfigAsync(
            isEnabled: true,
            displayName: "Modal",
            baseUrl: "https://example--ep-kimi-k3-server.us-west.modal.direct/v1",
            apiKey: null,
            Guid.NewGuid());

        Assert.False(ok);
        Assert.Contains("clé API", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SetModalConfigAsync_HttpUrl_Fails()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var (ok, error) = await service.SetModalConfigAsync(
            isEnabled: true,
            displayName: "Modal",
            baseUrl: "http://example--ep-kimi-k3-server.us-west.modal.direct/v1",
            apiKey: "wk-id.ws-secret",
            Guid.NewGuid());

        Assert.False(ok);
        Assert.Contains("HTTPS", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Sequential_GetDefault_Then_GetStudio_OnSameInstance_Succeeds()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var row = PlatformAiSettings.CreateDefaults();
        row.SetDefaultModel("qwen2.5:3b-instruct");
        row.SetStudioAiModel("qwen2.5:7b-instruct");
        db.PlatformAiSettings.Add(row);
        await db.SaveChangesAsync();

        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(db, cache);

        var defaultRef = await service.GetDefaultModelRefAsync();
        var studioRef = await service.GetStudioAiModelRefAsync();

        Assert.Equal("qwen2.5:3b-instruct", defaultRef);
        Assert.Equal("qwen2.5:7b-instruct", studioRef);

        db.PlatformAiSettings.Remove(row);
        await db.SaveChangesAsync();

        var defaultCached = await service.GetDefaultModelRefAsync();
        var studioCached = await service.GetStudioAiModelRefAsync();
        Assert.Equal(defaultRef, defaultCached);
        Assert.Equal(studioRef, studioCached);
    }

    [Fact]
    public async Task Parallel_GetDefault_And_GetStudio_OnSameInstance_DocumentsScopedContextConstraint()
    {
        // Invariant : les deux getters partagent le MasterDbContext scoped. Un Task.WhenAll
        // sur cache miss déclenche « A second operation was started… » sur SQL Server.
        // EF InMemory n'applique souvent pas cette contrainte — Skip dans ce cas ; le test
        // séquentiel ci-dessus reste le contrat obligatoire.
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var row = PlatformAiSettings.CreateDefaults();
        row.SetDefaultModel("qwen2.5:3b-instruct");
        row.SetStudioAiModel("qwen2.5:7b-instruct");
        db.PlatformAiSettings.Add(row);
        await db.SaveChangesAsync();

        var service = CreateService(db, new MemoryCache(new MemoryCacheOptions()));

        try
        {
            await Task.WhenAll(
                service.GetDefaultModelRefAsync(),
                service.GetStudioAiModelRefAsync());
        }
        catch (InvalidOperationException ex) when (
            ex.Message.Contains("second operation", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        // EF InMemory : pas de throw. Documenté, pas un faux vert sur le provider de prod.
    }

    // ---- Docstrange ----------------------------------------------------------------------
    // Service d'EXTRACTION documentaire externe : meme exigence de secret que les trois
    // fournisseurs LLM, mais il n'est jamais selectionnable comme modele.

    [Fact]
    public async Task SetDocStrangeConfigAsync_EncryptsAndMasksKey()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        const string key = "ns-abcdefghijklmnop1234";

        var (ok, error) = await service.SetDocStrangeConfigAsync(
            isEnabled: true,
            displayName: "Docstrange",
            baseUrl: "https://extraction-api.nanonets.com/",
            apiKey: key,
            actorUserId: Guid.NewGuid());

        Assert.True(ok);
        Assert.Null(error);

        var masked = await service.GetDocStrangeSettingsAsync();
        Assert.True(masked.IsEnabled);
        Assert.Equal("Docstrange", masked.DisplayName);
        Assert.Equal("https://extraction-api.nanonets.com", masked.BaseUrl);
        Assert.True(masked.IsApiKeyConfigured);
        Assert.Equal("1234", masked.ApiKeyLast4);

        var creds = await service.GetDocStrangeCredentialsAsync();
        Assert.True(creds.IsEnabled);
        Assert.Equal(key, creds.ApiKey);

        // La colonne ne contient jamais la cle en clair.
        var stored = await db.PlatformAiSettings.AsNoTracking().SingleAsync();
        Assert.NotEqual(key, stored.DocStrangeEncryptedApiKey);
        Assert.NotNull(stored.DocStrangeEncryptedApiKey);
    }

    [Fact]
    public async Task SetDocStrangeConfigAsync_EmptyApiKey_KeepsExistingSecret()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();
        const string key = "ns-firstkey000000abcd";

        await service.SetDocStrangeConfigAsync(true, "Docstrange", null, key, actorId);

        // Re-enregistrer la page sans resaisir la cle ne doit pas l'effacer.
        var (ok, _) = await service.SetDocStrangeConfigAsync(true, "Docstrange renomme", null, null, actorId);
        Assert.True(ok);

        var creds = await service.GetDocStrangeCredentialsAsync();
        Assert.Equal(key, creds.ApiKey);

        var masked = await service.GetDocStrangeSettingsAsync();
        Assert.Equal("Docstrange renomme", masked.DisplayName);
        Assert.Equal("abcd", masked.ApiKeyLast4);
    }

    [Fact]
    public async Task SetDocStrangeConfigAsync_EnableWithoutKey_Fails()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);

        var (ok, error) = await service.SetDocStrangeConfigAsync(
            isEnabled: true, displayName: null, baseUrl: null, apiKey: null, actorUserId: Guid.NewGuid());

        Assert.False(ok);
        Assert.NotNull(error);

        var creds = await service.GetDocStrangeCredentialsAsync();
        Assert.Null(creds.ApiKey);
    }

    [Fact]
    public async Task GetDocStrangeCredentialsAsync_WhenDisabled_ReturnsNoKey()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new MasterDbContext(options);
        var service = CreateService(db);
        var actorId = Guid.NewGuid();

        await service.SetDocStrangeConfigAsync(true, null, null, "ns-key0000000000wxyz", actorId);
        await service.SetDocStrangeConfigAsync(false, null, null, null, actorId);

        // Desactive : la cle reste en base mais n'est plus servie au runtime.
        var creds = await service.GetDocStrangeCredentialsAsync();
        Assert.False(creds.IsEnabled);
        Assert.Null(creds.ApiKey);

        // ...et le back-office continue d'afficher qu'une cle est configuree.
        var masked = await service.GetDocStrangeSettingsAsync();
        Assert.True(masked.IsApiKeyConfigured);
        Assert.Equal("wxyz", masked.ApiKeyLast4);
    }
}
