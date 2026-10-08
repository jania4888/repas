using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.AI;

/// <summary>
/// Platform-wide AI preferences (singleton row in the master database).
/// Holds the default LLM model used by the assistant for every tenant,
/// plus shared OpenRouter credentials; configured from the platform back-office.
/// </summary>
public sealed class PlatformAiSettings : Entity
{
    /// <summary>Canonical model reference (e.g. "ollama:qwen2.5-coder:7b"); null = server default.</summary>
    public string? DefaultModelRef { get; private set; }

    /// <summary>Modèle dédié à l'import de factures ; null = configuration serveur (Ollama:InvoiceImportModel).</summary>
    public string? InvoiceImportModelRef { get; private set; }

    /// <summary>Modèle dédié à l'Assistant Studio (IA) ; null = modèle Assistant plateforme puis Ollama:DefaultModel.</summary>
    public string? StudioAiModelRef { get; private set; }

    /// <summary>
    /// Modèle Studio « avancé » (GPU distant ou cloud) utilisé quand l'utilisateur active
    /// « Modèle avancé » dans le Studio ; null = aucun modèle avancé proposé.
    /// </summary>
    public string? StudioAiAdvancedModelRef { get; private set; }

    /// <summary>Moteur d'inférence Ollama (GPU auto ou CPU uniquement).</summary>
    public OllamaInferenceDevice InferenceDevice { get; private set; } = OllamaInferenceDevice.Gpu;

    /// <summary>Whether the shared OpenRouter credential is enabled for cloud models.</summary>
    public bool OpenRouterIsEnabled { get; private set; }

    /// <summary>Display name for OpenRouter in the back-office.</summary>
    public string? OpenRouterDisplayName { get; private set; }

    /// <summary>Optional OpenRouter base URL override (no trailing slash); null = appsettings default.</summary>
    public string? OpenRouterBaseUrl { get; private set; }

    /// <summary>Data-Protection encrypted OpenRouter API key; empty when not configured.</summary>
    public string? OpenRouterEncryptedApiKey { get; private set; }

    /// <summary>Last 4 characters of the plaintext API key for masked UI display.</summary>
    public string? OpenRouterApiKeyLast4 { get; private set; }

    public bool CursorIsEnabled { get; private set; }

    public string? CursorDisplayName { get; private set; }

    public string? CursorEncryptedApiKey { get; private set; }

    public string? CursorApiKeyLast4 { get; private set; }

    public bool ModalIsEnabled { get; private set; }

    public string? ModalDisplayName { get; private set; }

    /// <summary>Optional Modal base URL override (no trailing slash, includes /v1); null = appsettings default.</summary>
    public string? ModalBaseUrl { get; private set; }

    public string? ModalEncryptedApiKey { get; private set; }

    public string? ModalApiKeyLast4 { get; private set; }

    // ---- Docstrange (Nanonets) : extraction documentaire, PAS un LLM conversationnel.
    // Volontairement absent de LlmProviderKind et de ModelRef : ce service ne se choisit pas
    // comme un modele, il se branche au-dessus du pipeline. Voir IDocumentExtractionProvider.

    public bool DocStrangeIsEnabled { get; private set; }

    public string? DocStrangeDisplayName { get; private set; }

    /// <summary>Optional Docstrange base URL override (no trailing slash); null = appsettings default.</summary>
    public string? DocStrangeBaseUrl { get; private set; }

    public string? DocStrangeEncryptedApiKey { get; private set; }

    public string? DocStrangeApiKeyLast4 { get; private set; }

    private PlatformAiSettings() { }

    public static PlatformAiSettings CreateDefaults() => new() { DefaultModelRef = null };

    public void SetDefaultModel(string? modelRef)
        => DefaultModelRef = string.IsNullOrWhiteSpace(modelRef) ? null : modelRef.Trim();

    public void SetInvoiceImportModel(string? modelRef)
        => InvoiceImportModelRef = string.IsNullOrWhiteSpace(modelRef) ? null : modelRef.Trim();

    public void SetStudioAiModel(string? modelRef)
        => StudioAiModelRef = string.IsNullOrWhiteSpace(modelRef) ? null : modelRef.Trim();

    public void SetStudioAiAdvancedModel(string? modelRef)
        => StudioAiAdvancedModelRef = string.IsNullOrWhiteSpace(modelRef) ? null : modelRef.Trim();

    public void SetInferenceDevice(OllamaInferenceDevice device)
    {
        if (!Enum.IsDefined(device))
            throw new ArgumentOutOfRangeException(nameof(device), device, "Valeur InferenceDevice invalide.");
        InferenceDevice = device;
    }

    /// <summary>
    /// Updates OpenRouter settings. Pass <paramref name="encryptedApiKey"/> / <paramref name="apiKeyLast4"/>
    /// as null to keep the existing secret.
    /// </summary>
    public void SetOpenRouterConfig(
        bool isEnabled,
        string? displayName,
        string? baseUrl,
        string? encryptedApiKey,
        string? apiKeyLast4)
    {
        OpenRouterIsEnabled = isEnabled;
        OpenRouterDisplayName = string.IsNullOrWhiteSpace(displayName)
            ? (string.IsNullOrWhiteSpace(OpenRouterDisplayName) ? "OpenRouter" : OpenRouterDisplayName)
            : displayName.Trim();
        OpenRouterBaseUrl = string.IsNullOrWhiteSpace(baseUrl) ? null : baseUrl.Trim().TrimEnd('/');

        if (encryptedApiKey is not null)
        {
            OpenRouterEncryptedApiKey = string.IsNullOrWhiteSpace(encryptedApiKey) ? null : encryptedApiKey;
            OpenRouterApiKeyLast4 = string.IsNullOrWhiteSpace(apiKeyLast4) ? null : apiKeyLast4.Trim();
        }
    }

    public bool HasOpenRouterApiKey => !string.IsNullOrWhiteSpace(OpenRouterEncryptedApiKey);

    public void SetCursorConfig(
        bool isEnabled,
        string? displayName,
        string? encryptedApiKey,
        string? apiKeyLast4)
    {
        CursorIsEnabled = isEnabled;
        CursorDisplayName = string.IsNullOrWhiteSpace(displayName)
            ? (string.IsNullOrWhiteSpace(CursorDisplayName) ? "Cursor" : CursorDisplayName)
            : displayName.Trim();

        if (encryptedApiKey is not null)
        {
            CursorEncryptedApiKey = string.IsNullOrWhiteSpace(encryptedApiKey) ? null : encryptedApiKey;
            CursorApiKeyLast4 = string.IsNullOrWhiteSpace(apiKeyLast4) ? null : apiKeyLast4.Trim();
        }
    }

    public bool HasCursorApiKey => !string.IsNullOrWhiteSpace(CursorEncryptedApiKey);

    public void SetModalConfig(
        bool isEnabled,
        string? displayName,
        string? baseUrl,
        string? encryptedApiKey,
        string? apiKeyLast4)
    {
        ModalIsEnabled = isEnabled;
        ModalDisplayName = string.IsNullOrWhiteSpace(displayName)
            ? (string.IsNullOrWhiteSpace(ModalDisplayName) ? "Modal (Kimi)" : ModalDisplayName)
            : displayName.Trim();
        ModalBaseUrl = string.IsNullOrWhiteSpace(baseUrl) ? null : baseUrl.Trim().TrimEnd('/');

        if (encryptedApiKey is not null)
        {
            ModalEncryptedApiKey = string.IsNullOrWhiteSpace(encryptedApiKey) ? null : encryptedApiKey;
            ModalApiKeyLast4 = string.IsNullOrWhiteSpace(apiKeyLast4) ? null : apiKeyLast4.Trim();
        }
    }

    public bool HasModalApiKey => !string.IsNullOrWhiteSpace(ModalEncryptedApiKey);

    public void SetDocStrangeConfig(
        bool isEnabled,
        string? displayName,
        string? baseUrl,
        string? encryptedApiKey,
        string? apiKeyLast4)
    {
        DocStrangeIsEnabled = isEnabled;
        DocStrangeDisplayName = string.IsNullOrWhiteSpace(displayName)
            ? (string.IsNullOrWhiteSpace(DocStrangeDisplayName) ? "Docstrange" : DocStrangeDisplayName)
            : displayName.Trim();
        DocStrangeBaseUrl = string.IsNullOrWhiteSpace(baseUrl) ? null : baseUrl.Trim().TrimEnd('/');

        // null = conserver le secret existant (meme semantique que les trois autres fournisseurs) :
        // c'est ce qui permet de re-enregistrer la page sans resaisir la cle.
        if (encryptedApiKey is not null)
        {
            DocStrangeEncryptedApiKey = string.IsNullOrWhiteSpace(encryptedApiKey) ? null : encryptedApiKey;
            DocStrangeApiKeyLast4 = string.IsNullOrWhiteSpace(apiKeyLast4) ? null : apiKeyLast4.Trim();
        }
    }

    public bool HasDocStrangeApiKey => !string.IsNullOrWhiteSpace(DocStrangeEncryptedApiKey);
}
