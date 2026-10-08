using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Entities.AI;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Reads / writes the platform-wide AI model setting. The table
/// <c>PlatformAiSettings</c> holds a single row, created on first use.
/// </summary>
public sealed class PlatformAiSettingsService : IPlatformAiSettingsService
{
    public const string DataProtectionPurpose = "PlatformAiProviderSecrets";
    public const string CursorDataProtectionPurpose = "PlatformCursorSecrets";
    public const string ModalDataProtectionPurpose = "PlatformModalSecrets";
    public const string DocStrangeDataProtectionPurpose = "PlatformDocStrangeSecrets";

    private const string CacheKeyDefaultModel = "platform:ai:default-model";
    private const string CacheKeyImportModel = "platform:ai:import-model";
    private const string CacheKeyStudioModel = "platform:ai:studio-model";
    private const string CacheKeyStudioAdvancedModel = "platform:ai:studio-advanced-model";
    private const string CacheKeyInferenceDevice = "platform:ai:inference-device";
    private const string CacheKeyOpenRouter = "platform:ai:openrouter";
    private const string CacheKeyCursor = "platform:ai:cursor";
    private const string CacheKeyModal = "platform:ai:modal";
    private const string CacheKeyDocStrange = "platform:ai:docstrange";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);

    private readonly MasterDbContext _db;
    private readonly IMemoryCache _cache;
    private readonly IDataProtector _protector;
    private readonly IDataProtector _cursorProtector;
    private readonly IDataProtector _modalProtector;
    private readonly IDataProtector _docStrangeProtector;
    private readonly OpenRouterSettings _openRouterDefaults;
    private readonly ModalSettings _modalDefaults;
    private readonly DocStrangeSettings _docStrangeDefaults;
    private readonly ILogger<PlatformAiSettingsService> _logger;

    public PlatformAiSettingsService(
        MasterDbContext db,
        IMemoryCache cache,
        IDataProtectionProvider dataProtectionProvider,
        IOptions<OpenRouterSettings> openRouterSettings,
        IOptions<ModalSettings> modalSettings,
        IOptions<DocStrangeSettings> docStrangeSettings,
        ILogger<PlatformAiSettingsService> logger)
    {
        _db = db;
        _cache = cache;
        _protector = dataProtectionProvider.CreateProtector(DataProtectionPurpose);
        _cursorProtector = dataProtectionProvider.CreateProtector(CursorDataProtectionPurpose);
        _modalProtector = dataProtectionProvider.CreateProtector(ModalDataProtectionPurpose);
        _docStrangeProtector = dataProtectionProvider.CreateProtector(DocStrangeDataProtectionPurpose);
        _openRouterDefaults = openRouterSettings.Value;
        _modalDefaults = modalSettings.Value;
        _docStrangeDefaults = docStrangeSettings.Value;
        _logger = logger;
    }

    public Task<string?> GetDefaultModelRefAsync(CancellationToken cancellationToken = default) =>
        _cache.GetOrCreateAsync(CacheKeyDefaultModel, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            return await _db.PlatformAiSettings
                .AsNoTracking()
                .Select(s => s.DefaultModelRef)
                .FirstOrDefaultAsync(cancellationToken);
        });

    public async Task<string?> SetDefaultModelRefAsync(
        string? modelRef,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var normalized = string.IsNullOrWhiteSpace(modelRef)
            ? null
            : ModelRef.NormalizeStored(modelRef);

        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);
        current.SetDefaultModel(normalized);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return current.DefaultModelRef;
    }

    public Task<string?> GetInvoiceImportModelRefAsync(CancellationToken cancellationToken = default) =>
        _cache.GetOrCreateAsync(CacheKeyImportModel, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                return await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => s.InvoiceImportModelRef)
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire InvoiceImportModelRef depuis PlatformAiSettings ; fallback configuration serveur.");
                return null;
            }
        });

    public async Task<string?> SetInvoiceImportModelRefAsync(
        string? modelRef,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var normalized = string.IsNullOrWhiteSpace(modelRef)
            ? null
            : ModelRef.NormalizeStored(modelRef);

        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);
        current.SetInvoiceImportModel(normalized);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return current.InvoiceImportModelRef;
    }

    public Task<string?> GetStudioAiModelRefAsync(CancellationToken cancellationToken = default) =>
        _cache.GetOrCreateAsync(CacheKeyStudioModel, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                return await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => s.StudioAiModelRef)
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire StudioAiModelRef depuis PlatformAiSettings ; fallback modèle Assistant.");
                return null;
            }
        });

    public async Task<string?> SetStudioAiModelRefAsync(
        string? modelRef,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var normalized = string.IsNullOrWhiteSpace(modelRef)
            ? null
            : ModelRef.NormalizeStored(modelRef);

        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);
        current.SetStudioAiModel(normalized);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return current.StudioAiModelRef;
    }

    public Task<string?> GetStudioAiAdvancedModelRefAsync(CancellationToken cancellationToken = default) =>
        _cache.GetOrCreateAsync(CacheKeyStudioAdvancedModel, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                return await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => s.StudioAiAdvancedModelRef)
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire StudioAiAdvancedModelRef depuis PlatformAiSettings ; aucun modèle Studio avancé exposé.");
                return null;
            }
        });

    public async Task<string?> SetStudioAiAdvancedModelRefAsync(
        string? modelRef,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var normalized = string.IsNullOrWhiteSpace(modelRef)
            ? null
            : ModelRef.NormalizeStored(modelRef);

        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);
        current.SetStudioAiAdvancedModel(normalized);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return current.StudioAiAdvancedModelRef;
    }

    public Task<OllamaInferenceDevice> GetInferenceDeviceAsync(CancellationToken cancellationToken = default) =>
        _cache.GetOrCreateAsync(CacheKeyInferenceDevice, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                var device = await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => (OllamaInferenceDevice?)s.InferenceDevice)
                    .FirstOrDefaultAsync(cancellationToken);

                return device ?? OllamaInferenceDevice.Gpu;
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire InferenceDevice depuis PlatformAiSettings ; fallback GPU.");
                return OllamaInferenceDevice.Gpu;
            }
        });

    public async Task<OllamaInferenceDevice> SetInferenceDeviceAsync(
        OllamaInferenceDevice device,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(device))
            throw new ArgumentOutOfRangeException(nameof(device), device, "Valeur InferenceDevice invalide.");

        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);
        current.SetInferenceDevice(device);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return current.InferenceDevice;
    }

    public async Task<PlatformOpenRouterSettingsDto> GetOpenRouterSettingsAsync(
        CancellationToken cancellationToken = default)
    {
        var cached = await _cache.GetOrCreateAsync(CacheKeyOpenRouter, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                return await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => new OpenRouterCacheRow(
                        s.OpenRouterIsEnabled,
                        s.OpenRouterDisplayName,
                        s.OpenRouterBaseUrl,
                        s.OpenRouterEncryptedApiKey,
                        s.OpenRouterApiKeyLast4))
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire les credentials OpenRouter depuis PlatformAiSettings.");
                return null;
            }
        });

        return MapOpenRouterDto(cached);
    }

    public async Task<(bool Success, string? Error)> SetOpenRouterConfigAsync(
        bool isEnabled,
        string? displayName,
        string? baseUrl,
        string? apiKey,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);

        string? encrypted = null;
        string? last4 = null;
        var hasNewKey = !string.IsNullOrWhiteSpace(apiKey);
        if (hasNewKey)
        {
            var plain = apiKey!.Trim();
            encrypted = _protector.Protect(plain);
            last4 = plain.Length >= 4 ? plain[^4..] : plain;
        }
        else if (isEnabled && !current.HasOpenRouterApiKey)
        {
            return (false, "Une clé API est requise pour activer OpenRouter.");
        }

        current.SetOpenRouterConfig(
            isEnabled,
            displayName,
            baseUrl,
            hasNewKey ? encrypted : null,
            hasNewKey ? last4 : null);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return (true, null);
    }

    public async Task<PlatformOpenRouterCredentials> GetOpenRouterCredentialsAsync(
        CancellationToken cancellationToken = default)
    {
        var defaultBase = (_openRouterDefaults.DefaultBaseUrl ?? "https://openrouter.ai/api/v1").TrimEnd('/');

        OpenRouterCacheRow? row;
        try
        {
            row = await _db.PlatformAiSettings
                .AsNoTracking()
                .Select(s => new OpenRouterCacheRow(
                    s.OpenRouterIsEnabled,
                    s.OpenRouterDisplayName,
                    s.OpenRouterBaseUrl,
                    s.OpenRouterEncryptedApiKey,
                    s.OpenRouterApiKeyLast4))
                .FirstOrDefaultAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Impossible de déchiffrer les credentials OpenRouter plateforme.");
            return new PlatformOpenRouterCredentials(false, null, defaultBase);
        }

        var baseUrl = !string.IsNullOrWhiteSpace(row?.BaseUrl)
            ? row!.BaseUrl!.TrimEnd('/')
            : defaultBase;

        if (row is null || !row.IsEnabled || string.IsNullOrWhiteSpace(row.EncryptedApiKey))
            return new PlatformOpenRouterCredentials(row?.IsEnabled ?? false, null, baseUrl);

        try
        {
            var plain = _protector.Unprotect(row.EncryptedApiKey);
            if (string.IsNullOrWhiteSpace(plain))
                return new PlatformOpenRouterCredentials(true, null, baseUrl);
            return new PlatformOpenRouterCredentials(true, plain, baseUrl);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Échec du déchiffrement de la clé OpenRouter plateforme.");
            return new PlatformOpenRouterCredentials(true, null, baseUrl);
        }
    }

    public async Task<PlatformCursorSettingsDto> GetCursorSettingsAsync(
        CancellationToken cancellationToken = default)
    {
        var cached = await _cache.GetOrCreateAsync(CacheKeyCursor, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                return await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => new CursorCacheRow(
                        s.CursorIsEnabled,
                        s.CursorDisplayName,
                        s.CursorEncryptedApiKey,
                        s.CursorApiKeyLast4))
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire les credentials Cursor depuis PlatformAiSettings.");
                return null;
            }
        });

        return MapCursorDto(cached);
    }

    public async Task<(bool Success, string? Error)> SetCursorConfigAsync(
        bool isEnabled,
        string? displayName,
        string? apiKey,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);

        string? encrypted = null;
        string? last4 = null;
        var hasNewKey = !string.IsNullOrWhiteSpace(apiKey);
        if (hasNewKey)
        {
            var plain = apiKey!.Trim();
            encrypted = _cursorProtector.Protect(plain);
            last4 = plain.Length >= 4 ? plain[^4..] : plain;
        }
        else if (isEnabled && !current.HasCursorApiKey)
        {
            return (false, "Une clé API est requise pour activer Cursor.");
        }

        current.SetCursorConfig(
            isEnabled,
            displayName,
            hasNewKey ? encrypted : null,
            hasNewKey ? last4 : null);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return (true, null);
    }

    public async Task<PlatformCursorCredentials> GetCursorCredentialsAsync(
        CancellationToken cancellationToken = default)
    {
        CursorCacheRow? row;
        try
        {
            row = await _db.PlatformAiSettings
                .AsNoTracking()
                .Select(s => new CursorCacheRow(
                    s.CursorIsEnabled,
                    s.CursorDisplayName,
                    s.CursorEncryptedApiKey,
                    s.CursorApiKeyLast4))
                .FirstOrDefaultAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Impossible de déchiffrer les credentials Cursor plateforme.");
            return new PlatformCursorCredentials(false, null);
        }

        if (row is null || !row.IsEnabled || string.IsNullOrWhiteSpace(row.EncryptedApiKey))
            return new PlatformCursorCredentials(row?.IsEnabled ?? false, null);

        try
        {
            var plain = _cursorProtector.Unprotect(row.EncryptedApiKey);
            if (string.IsNullOrWhiteSpace(plain))
                return new PlatformCursorCredentials(true, null);
            return new PlatformCursorCredentials(true, plain);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Échec du déchiffrement de la clé Cursor plateforme.");
            return new PlatformCursorCredentials(true, null);
        }
    }

    public async Task<PlatformModalSettingsDto> GetModalSettingsAsync(
        CancellationToken cancellationToken = default)
    {
        var cached = await _cache.GetOrCreateAsync(CacheKeyModal, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                return await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => new ModalCacheRow(
                        s.ModalIsEnabled,
                        s.ModalDisplayName,
                        s.ModalBaseUrl,
                        s.ModalEncryptedApiKey,
                        s.ModalApiKeyLast4))
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire les credentials Modal depuis PlatformAiSettings.");
                return null;
            }
        });

        return MapModalDto(cached);
    }

    public async Task<(bool Success, string? Error)> SetModalConfigAsync(
        bool isEnabled,
        string? displayName,
        string? baseUrl,
        string? apiKey,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        string? normalizedUrl = null;
        if (!string.IsNullOrWhiteSpace(baseUrl))
        {
            if (!ModalEndpointUrl.TryNormalize(baseUrl, out normalizedUrl, out var urlError))
                return (false, urlError ?? "URL Modal invalide.");
        }

        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);
        var urlToStore = normalizedUrl ?? current.ModalBaseUrl;

        if (isEnabled)
        {
            var effectiveUrl = urlToStore ?? _modalDefaults.DefaultBaseUrl;
            if (!ModalEndpointUrl.TryNormalize(effectiveUrl, out var checkedUrl, out var enableUrlError)
                || string.IsNullOrWhiteSpace(checkedUrl))
            {
                return (false, enableUrlError ?? "Une URL de base HTTPS (se terminant par /v1) est requise pour activer Modal.");
            }

            urlToStore = checkedUrl;
        }

        string? encrypted = null;
        string? last4 = null;
        var hasNewKey = !string.IsNullOrWhiteSpace(apiKey);
        if (hasNewKey)
        {
            var plain = apiKey!.Trim();
            encrypted = _modalProtector.Protect(plain);
            last4 = plain.Length >= 4 ? plain[^4..] : plain;
        }
        else if (isEnabled && !current.HasModalApiKey)
        {
            return (false, "Une clé API (TOKEN_ID.TOKEN_SECRET) est requise pour activer Modal.");
        }

        current.SetModalConfig(
            isEnabled,
            displayName,
            urlToStore,
            hasNewKey ? encrypted : null,
            hasNewKey ? last4 : null);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();
        return (true, null);
    }

    public async Task<PlatformModalCredentials> GetModalCredentialsAsync(
        CancellationToken cancellationToken = default)
    {
        var defaultBase = ResolveModalDefaultBaseUrl();

        ModalCacheRow? row;
        try
        {
            row = await _db.PlatformAiSettings
                .AsNoTracking()
                .Select(s => new ModalCacheRow(
                    s.ModalIsEnabled,
                    s.ModalDisplayName,
                    s.ModalBaseUrl,
                    s.ModalEncryptedApiKey,
                    s.ModalApiKeyLast4))
                .FirstOrDefaultAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Impossible de déchiffrer les credentials Modal plateforme.");
            return new PlatformModalCredentials(false, null, defaultBase);
        }

        var baseUrl = defaultBase;
        if (!string.IsNullOrWhiteSpace(row?.BaseUrl)
            && ModalEndpointUrl.TryNormalize(row.BaseUrl, out var stored, out _)
            && !string.IsNullOrWhiteSpace(stored))
        {
            baseUrl = stored;
        }

        if (row is null || !row.IsEnabled || string.IsNullOrWhiteSpace(row.EncryptedApiKey))
            return new PlatformModalCredentials(row?.IsEnabled ?? false, null, baseUrl);

        try
        {
            var plain = _modalProtector.Unprotect(row.EncryptedApiKey);
            if (string.IsNullOrWhiteSpace(plain))
                return new PlatformModalCredentials(true, null, baseUrl);
            return new PlatformModalCredentials(true, plain, baseUrl);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Échec du déchiffrement de la clé Modal plateforme.");
            return new PlatformModalCredentials(true, null, baseUrl);
        }
    }

    private PlatformModalSettingsDto MapModalDto(ModalCacheRow? row)
    {
        var defaultBase = ResolveModalDefaultBaseUrl();
        var defaultModel = string.IsNullOrWhiteSpace(_modalDefaults.DefaultModelId)
            ? "moonshotai/Kimi-K3"
            : _modalDefaults.DefaultModelId.Trim();
        var configured = row is not null
            && !string.IsNullOrWhiteSpace(row.EncryptedApiKey)
            && !string.IsNullOrWhiteSpace(row.ApiKeyLast4);

        return new PlatformModalSettingsDto(
            row?.IsEnabled ?? false,
            row?.DisplayName,
            row?.BaseUrl,
            defaultBase,
            defaultModel,
            configured,
            configured ? row!.ApiKeyLast4 : null);
    }

    private string ResolveModalDefaultBaseUrl()
    {
        if (ModalEndpointUrl.TryNormalize(_modalDefaults.DefaultBaseUrl, out var normalized, out _)
            && !string.IsNullOrWhiteSpace(normalized))
        {
            return normalized;
        }

        return string.Empty;
    }

    private static PlatformCursorSettingsDto MapCursorDto(CursorCacheRow? row)
    {
        var configured = row is not null
            && !string.IsNullOrWhiteSpace(row.EncryptedApiKey)
            && !string.IsNullOrWhiteSpace(row.ApiKeyLast4);

        return new PlatformCursorSettingsDto(
            row?.IsEnabled ?? false,
            row?.DisplayName,
            configured,
            configured ? row!.ApiKeyLast4 : null);
    }

    private PlatformOpenRouterSettingsDto MapOpenRouterDto(OpenRouterCacheRow? row)
    {
        var defaultBase = (_openRouterDefaults.DefaultBaseUrl ?? "https://openrouter.ai/api/v1").TrimEnd('/');
        var configured = row is not null
            && !string.IsNullOrWhiteSpace(row.EncryptedApiKey)
            && !string.IsNullOrWhiteSpace(row.ApiKeyLast4);

        return new PlatformOpenRouterSettingsDto(
            row?.IsEnabled ?? false,
            row?.DisplayName,
            row?.BaseUrl,
            defaultBase,
            configured,
            configured ? row!.ApiKeyLast4 : null);
    }

    private async Task<PlatformAiSettings> GetOrCreateRowAsync(
        Guid actorUserId,
        CancellationToken cancellationToken)
    {
        var current = await _db.PlatformAiSettings.FirstOrDefaultAsync(cancellationToken);
        if (current is not null)
            return current;

        current = PlatformAiSettings.CreateDefaults();
        current.SetAuditInfo(actorUserId.ToString());
        _db.PlatformAiSettings.Add(current);
        return current;
    }

    // ---- Docstrange (Nanonets) -----------------------------------------------------------
    // Même dualité que les trois autres fournisseurs : Get*SettingsAsync est masqué et caché,
    // Get*CredentialsAsync déchiffre et n'est JAMAIS caché.

    public async Task<PlatformDocStrangeSettingsDto> GetDocStrangeSettingsAsync(
        CancellationToken cancellationToken = default)
    {
        var cached = await _cache.GetOrCreateAsync(CacheKeyDocStrange, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            try
            {
                return await _db.PlatformAiSettings
                    .AsNoTracking()
                    .Select(s => new DocStrangeCacheRow(
                        s.DocStrangeIsEnabled,
                        s.DocStrangeDisplayName,
                        s.DocStrangeBaseUrl,
                        s.DocStrangeEncryptedApiKey,
                        s.DocStrangeApiKeyLast4))
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
            {
                _logger.LogWarning(ex,
                    "Impossible de lire les credentials Docstrange depuis PlatformAiSettings.");
                return null;
            }
        });

        return MapDocStrangeDto(cached);
    }

    public async Task<(bool Success, string? Error)> SetDocStrangeConfigAsync(
        bool isEnabled,
        string? displayName,
        string? baseUrl,
        string? apiKey,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var current = await GetOrCreateRowAsync(actorUserId, cancellationToken);

        string? encrypted = null;
        string? last4 = null;
        var hasNewKey = !string.IsNullOrWhiteSpace(apiKey);
        if (hasNewKey)
        {
            var plain = apiKey!.Trim();
            encrypted = _docStrangeProtector.Protect(plain);
            last4 = plain.Length >= 4 ? plain[^4..] : plain;
        }
        else if (isEnabled && !current.HasDocStrangeApiKey)
        {
            return (false, "Une clé API est requise pour activer Docstrange.");
        }

        current.SetDocStrangeConfig(
            isEnabled,
            displayName,
            baseUrl,
            hasNewKey ? encrypted : null,
            hasNewKey ? last4 : null);
        current.SetAuditInfo(actorUserId.ToString(), isUpdate: true);

        await _db.SaveChangesAsync(cancellationToken);
        InvalidateReadCache();

        // Jamais la clé ni ses quatre derniers caractères dans le journal.
        _logger.LogInformation(
            "Configuration Docstrange mise à jour par {ActorId} (activé={IsEnabled}, nouvelle clé={HasNewKey}).",
            actorUserId, isEnabled, hasNewKey);
        return (true, null);
    }

    public async Task<PlatformDocStrangeCredentials> GetDocStrangeCredentialsAsync(
        CancellationToken cancellationToken = default)
    {
        var defaultBase = ResolveDocStrangeDefaultBaseUrl();

        DocStrangeCacheRow? row;
        try
        {
            row = await _db.PlatformAiSettings
                .AsNoTracking()
                .Select(s => new DocStrangeCacheRow(
                    s.DocStrangeIsEnabled,
                    s.DocStrangeDisplayName,
                    s.DocStrangeBaseUrl,
                    s.DocStrangeEncryptedApiKey,
                    s.DocStrangeApiKeyLast4))
                .FirstOrDefaultAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException or DbUpdateException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Impossible de lire les credentials Docstrange plateforme.");
            return new PlatformDocStrangeCredentials(false, null, defaultBase);
        }

        var baseUrl = !string.IsNullOrWhiteSpace(row?.BaseUrl) ? row!.BaseUrl!.TrimEnd('/') : defaultBase;

        if (row is null || !row.IsEnabled || string.IsNullOrWhiteSpace(row.EncryptedApiKey))
            return new PlatformDocStrangeCredentials(row?.IsEnabled ?? false, null, baseUrl);

        try
        {
            var plain = _docStrangeProtector.Unprotect(row.EncryptedApiKey);
            return new PlatformDocStrangeCredentials(true, string.IsNullOrWhiteSpace(plain) ? null : plain, baseUrl);
        }
        catch (Exception ex)
        {
            // Trousseau différent ou clé corrompue : on dégrade, on ne lève jamais vers l'appelant.
            _logger.LogWarning(ex, "Échec du déchiffrement de la clé Docstrange plateforme.");
            return new PlatformDocStrangeCredentials(true, null, baseUrl);
        }
    }

    private PlatformDocStrangeSettingsDto MapDocStrangeDto(DocStrangeCacheRow? row)
    {
        var defaultBase = ResolveDocStrangeDefaultBaseUrl();
        var configured = row is not null
            && !string.IsNullOrWhiteSpace(row.EncryptedApiKey)
            && !string.IsNullOrWhiteSpace(row.ApiKeyLast4);

        return new PlatformDocStrangeSettingsDto(
            row?.IsEnabled ?? false,
            row?.DisplayName,
            row?.BaseUrl,
            defaultBase,
            configured,
            configured ? row!.ApiKeyLast4 : null);
    }

    private string ResolveDocStrangeDefaultBaseUrl() =>
        string.IsNullOrWhiteSpace(_docStrangeDefaults.DefaultBaseUrl)
            ? string.Empty
            : _docStrangeDefaults.DefaultBaseUrl.Trim().TrimEnd('/');

    private void InvalidateReadCache()
    {
        _cache.Remove(CacheKeyDefaultModel);
        _cache.Remove(CacheKeyImportModel);
        _cache.Remove(CacheKeyStudioModel);
        _cache.Remove(CacheKeyStudioAdvancedModel);
        _cache.Remove(CacheKeyInferenceDevice);
        _cache.Remove(CacheKeyOpenRouter);
        _cache.Remove(CacheKeyCursor);
        _cache.Remove(CacheKeyModal);
        _cache.Remove(CacheKeyDocStrange);
    }

    private sealed record OpenRouterCacheRow(
        bool IsEnabled,
        string? DisplayName,
        string? BaseUrl,
        string? EncryptedApiKey,
        string? ApiKeyLast4);

    private sealed record CursorCacheRow(
        bool IsEnabled,
        string? DisplayName,
        string? EncryptedApiKey,
        string? ApiKeyLast4);

    private sealed record ModalCacheRow(
        bool IsEnabled,
        string? DisplayName,
        string? BaseUrl,
        string? EncryptedApiKey,
        string? ApiKeyLast4);

    private sealed record DocStrangeCacheRow(
        bool IsEnabled,
        string? DisplayName,
        string? BaseUrl,
        string? EncryptedApiKey,
        string? ApiKeyLast4);
}
