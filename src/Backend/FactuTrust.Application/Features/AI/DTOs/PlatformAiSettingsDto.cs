using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.AI.DTOs;

/// <summary>
/// Platform-wide AI settings for the back-office: the configured default model plus the
/// data needed to choose one (available Ollama models + hardware recommendation),
/// and shared OpenRouter credentials (masked).
/// Returned by GET /api/platform/ai-settings.
/// </summary>
public sealed record PlatformAiSettingsDto(
    string? ConfiguredModelRef,
    string? InvoiceImportModelRef,
    /// <summary>Modèle dédié à l'Assistant Studio (IA) ; null = modèle Assistant / serveur.</summary>
    string? StudioAiModelRef,
    /// <summary>
    /// Modèle Studio « avancé » (GPU distant / cloud) proposé derrière la bascule « Modèle avancé »
    /// du Studio ; null = aucun modèle avancé configuré. Doit différer de <c>StudioAiModelRef</c>.
    /// </summary>
    string? StudioAiAdvancedModelRef,
    /// <summary>Modèle vision serveur (obsolète ; null si HonorLegacyImportVisionModels=false).</summary>
    string? ServerInvoiceImportVisionModel,
    /// <summary>Modèle d'import effectif (plateforme prioritaire sur appsettings).</summary>
    string? EffectiveImportModelRef,
    /// <summary>True si le modèle d'import effectif supporte la vision.</summary>
    bool EffectiveImportVisionCapable,
    OllamaInferenceDevice InferenceDevice,
    bool IsOllamaAssistantConfigured,
    IReadOnlyList<UnifiedAiModelInfo> AvailableModels,
    AiModelRecommendationDto? Recommendation,
    PlatformOpenRouterSettingsDto OpenRouter,
    PlatformCursorSettingsDto Cursor,
    PlatformModalSettingsDto Modal);

/// <summary>Masked OpenRouter credentials for the platform back-office.</summary>
public sealed record PlatformOpenRouterSettingsDto(
    bool IsEnabled,
    string? DisplayName,
    string? BaseUrl,
    string DefaultBaseUrl,
    bool IsApiKeyConfigured,
    string? ApiKeyLast4);

/// <summary>Request body for PUT /api/platform/ai-settings.</summary>
public sealed class UpdatePlatformAiSettingsRequest
{
    public string? ModelRef { get; init; }

    /// <summary>Modèle dédié à l'import de factures (ex. ollama:qwen2.5:7b-instruct).</summary>
    public string? InvoiceImportModelRef { get; init; }

    /// <summary>Modèle dédié à l'Assistant Studio (ex. ollama:qwen2.5:7b-instruct).</summary>
    public string? StudioAiModelRef { get; init; }

    /// <summary>
    /// Modèle Studio avancé (GPU distant / cloud, ex. openrouter:qwen/qwen-2.5-72b-instruct).
    /// Doit différer du modèle Studio standard. Chaîne vide = effacer le réglage.
    /// </summary>
    public string? StudioAiAdvancedModelRef { get; init; }

    /// <summary>Moteur d'inférence Ollama (GPU auto ou CPU uniquement).</summary>
    public OllamaInferenceDevice? InferenceDevice { get; init; }

    /// <summary>When set, updates shared OpenRouter credentials. Empty ApiKey keeps the existing secret.</summary>
    public UpdatePlatformOpenRouterRequest? OpenRouter { get; init; }

    /// <summary>When set, updates shared Cursor SDK credentials. Empty ApiKey keeps the existing secret.</summary>
    public UpdatePlatformCursorRequest? Cursor { get; init; }

    /// <summary>When set, updates shared Modal (Kimi) credentials. Empty ApiKey keeps the existing secret.</summary>
    public UpdatePlatformModalRequest? Modal { get; init; }
}

/// <summary>OpenRouter credential update payload (nested under UpdatePlatformAiSettingsRequest).</summary>
public sealed class UpdatePlatformOpenRouterRequest
{
    public bool IsEnabled { get; init; }
    public string? DisplayName { get; init; }
    public string? BaseUrl { get; init; }
    /// <summary>Plaintext API key. Null/empty = keep existing encrypted key.</summary>
    public string? ApiKey { get; init; }
}

/// <summary>Masked Cursor SDK credentials for the platform back-office.</summary>
public sealed record PlatformCursorSettingsDto(
    bool IsEnabled,
    string? DisplayName,
    bool IsApiKeyConfigured,
    string? ApiKeyLast4);

/// <summary>Cursor credential update payload.</summary>
public sealed class UpdatePlatformCursorRequest
{
    public bool IsEnabled { get; init; }
    public string? DisplayName { get; init; }
    /// <summary>Plaintext API key. Null/empty = keep existing encrypted key.</summary>
    public string? ApiKey { get; init; }
}

/// <summary>Runtime OpenRouter credentials resolved from platform Master DB.</summary>
public sealed record PlatformOpenRouterCredentials(
    bool IsEnabled,
    string? ApiKey,
    string BaseUrl);

/// <summary>Runtime Cursor credentials. ApiKey is null when disabled or missing/invalid.</summary>
public sealed record PlatformCursorCredentials(
    bool IsEnabled,
    string? ApiKey);

/// <summary>Masked Modal endpoint credentials for the platform back-office.</summary>
public sealed record PlatformModalSettingsDto(
    bool IsEnabled,
    string? DisplayName,
    string? BaseUrl,
    string DefaultBaseUrl,
    string DefaultModelId,
    bool IsApiKeyConfigured,
    string? ApiKeyLast4);

/// <summary>Modal credential update payload. ApiKey is the concatenated proxy token (id.secret).</summary>
public sealed class UpdatePlatformModalRequest
{
    public bool IsEnabled { get; init; }
    public string? DisplayName { get; init; }
    public string? BaseUrl { get; init; }
    /// <summary>Plaintext Bearer token (<c>TOKEN_ID.TOKEN_SECRET</c>). Null/empty = keep existing encrypted key.</summary>
    public string? ApiKey { get; init; }
}

/// <summary>Runtime Modal credentials. ApiKey is null when disabled or missing/invalid.</summary>
public sealed record PlatformModalCredentials(
    bool IsEnabled,
    string? ApiKey,
    string BaseUrl);

/// <summary>Where resolved Modal credentials came from.</summary>
public enum ModalCredentialSource
{
    Platform = 0,
    TenantOverride = 1,
    Disabled = 2
}

/// <summary>Runtime Modal credentials after tenant override resolution.</summary>
public sealed record ResolvedModalCredentials(
    bool IsEnabled,
    string? ApiKey,
    string BaseUrl,
    ModalCredentialSource Source)
{
    public static ResolvedModalCredentials FromPlatform(PlatformModalCredentials platform) =>
        new(platform.IsEnabled, platform.ApiKey, platform.BaseUrl, ModalCredentialSource.Platform);
}

/// <summary>Masked snapshot of the shared platform Modal endpoint (never includes the secret).</summary>
public sealed record TenantModalPlatformSnapshotDto(
    bool IsEnabled,
    string? DisplayName,
    string? BaseUrl,
    bool IsApiKeyConfigured,
    string? ApiKeyLast4);

/// <summary>Per-tenant Modal settings for the platform back-office (masked).</summary>
public sealed record TenantModalSettingsDto(
    bool HasOverride,
    bool IsEnabled,
    string? DisplayName,
    string? BaseUrl,
    string DefaultBaseUrl,
    string DefaultModelId,
    bool IsApiKeyConfigured,
    string? ApiKeyLast4,
    string? PlatformConfiguredModelRef,
    TenantModalPlatformSnapshotDto Platform);

/// <summary>Upsert body for a tenant Modal override. Empty ApiKey keeps the existing secret.</summary>
public sealed class UpdateTenantModalSettingsRequest
{
    public bool IsEnabled { get; init; }
    public string? DisplayName { get; init; }
    public string? BaseUrl { get; init; }
    /// <summary>Plaintext Bearer token (<c>TOKEN_ID.TOKEN_SECRET</c>). Null/empty = keep existing encrypted key.</summary>
    public string? ApiKey { get; init; }
}
