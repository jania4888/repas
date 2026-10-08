using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class PlatformAiSettingsSerializationTests
{
    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    private static PlatformOpenRouterSettingsDto EmptyOpenRouter =>
        new(false, null, null, "https://openrouter.ai/api/v1", false, null);

    private static PlatformCursorSettingsDto EmptyCursor =>
        new(false, null, false, null);

    private static PlatformModalSettingsDto EmptyModal =>
        new(false, null, null, "", "moonshotai/Kimi-K3", false, null);

    private static PlatformDocStrangeSettingsDto EmptyDocStrange =>
        new(false, null, null, "https://extraction-api.nanonets.com", false, null);

    [Fact]
    public void InferenceDevice_serializes_as_pascal_case_string()
    {
        var dto = new PlatformAiSettingsDto(
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            OllamaInferenceDevice.CpuOnly,
            true,
            Array.Empty<UnifiedAiModelInfo>(),
            null,
            EmptyOpenRouter,
            EmptyCursor,
            EmptyModal,
            EmptyDocStrange);

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);

        Assert.Contains("\"inferenceDevice\":\"CpuOnly\"", json);
        Assert.Contains("\"studioAiModelRef\":null", json);
        Assert.Contains("\"studioAiAdvancedModelRef\":null", json);
        Assert.Contains("\"openRouter\"", json);
        Assert.Contains("\"cursor\"", json);
        Assert.Contains("\"modal\"", json);
        Assert.Contains("\"docStrange\"", json);
        Assert.DoesNotContain("sk-", json);
        Assert.DoesNotContain("cursor_", json);
        Assert.DoesNotContain("wk-", json);
    }

    [Fact]
    public void InferenceDevice_deserializes_from_pascal_case_string()
    {
        const string json = """
            {
              "configuredModelRef": null,
              "invoiceImportModelRef": null,
              "studioAiModelRef": "ollama:qwen2.5:7b-instruct",
              "studioAiAdvancedModelRef": "openrouter:qwen/qwen-2.5-72b-instruct",
              "serverInvoiceImportVisionModel": null,
              "inferenceDevice": "Gpu",
              "isOllamaAssistantConfigured": true,
              "availableModels": [],
              "recommendation": null,
              "openRouter": {
                "isEnabled": true,
                "displayName": "OpenRouter",
                "baseUrl": null,
                "defaultBaseUrl": "https://openrouter.ai/api/v1",
                "isApiKeyConfigured": true,
                "apiKeyLast4": "ab12"
              }
            }
            """;

        var dto = JsonSerializer.Deserialize<PlatformAiSettingsDto>(json, ApiJsonOptions);

        Assert.NotNull(dto);
        Assert.Equal(OllamaInferenceDevice.Gpu, dto!.InferenceDevice);
        Assert.Equal("ollama:qwen2.5:7b-instruct", dto.StudioAiModelRef);
        Assert.Equal("openrouter:qwen/qwen-2.5-72b-instruct", dto.StudioAiAdvancedModelRef);
        Assert.True(dto.OpenRouter.IsEnabled);
        Assert.Equal("ab12", dto.OpenRouter.ApiKeyLast4);
    }

    [Fact]
    public void Cursor_deserializes_and_does_not_leak_api_key()
    {
        const string json = """
            {
              "configuredModelRef": "cursor:composer-2.5",
              "invoiceImportModelRef": null,
              "studioAiModelRef": null,
              "serverInvoiceImportVisionModel": null,
              "inferenceDevice": "Gpu",
              "isOllamaAssistantConfigured": false,
              "availableModels": [],
              "recommendation": null,
              "openRouter": {
                "isEnabled": false,
                "displayName": null,
                "baseUrl": null,
                "defaultBaseUrl": "https://openrouter.ai/api/v1",
                "isApiKeyConfigured": false,
                "apiKeyLast4": null
              },
              "cursor": {
                "isEnabled": true,
                "displayName": "Cursor",
                "isApiKeyConfigured": true,
                "apiKeyLast4": "xy89"
              }
            }
            """;

        var dto = JsonSerializer.Deserialize<PlatformAiSettingsDto>(json, ApiJsonOptions);

        Assert.NotNull(dto);
        Assert.NotNull(dto!.Cursor);
        // Payload antérieur à la PR « modèle Studio avancé » : le champ absent reste null.
        Assert.Null(dto.StudioAiAdvancedModelRef);
        Assert.True(dto.Cursor.IsEnabled);
        Assert.Equal("xy89", dto.Cursor.ApiKeyLast4);
        Assert.DoesNotContain("sk-", json);
        Assert.DoesNotContain("cursor_", json);
    }

    [Fact]
    public void Modal_deserializes_and_does_not_leak_api_key()
    {
        const string json = """
            {
              "configuredModelRef": "modal:moonshotai/Kimi-K3",
              "invoiceImportModelRef": null,
              "studioAiModelRef": null,
              "serverInvoiceImportVisionModel": null,
              "inferenceDevice": "Gpu",
              "isOllamaAssistantConfigured": false,
              "availableModels": [],
              "recommendation": null,
              "openRouter": {
                "isEnabled": false,
                "displayName": null,
                "baseUrl": null,
                "defaultBaseUrl": "https://openrouter.ai/api/v1",
                "isApiKeyConfigured": false,
                "apiKeyLast4": null
              },
              "cursor": {
                "isEnabled": false,
                "displayName": null,
                "isApiKeyConfigured": false,
                "apiKeyLast4": null
              },
              "modal": {
                "isEnabled": true,
                "displayName": "Kimi 3",
                "baseUrl": "https://example--ep-kimi-k3-server.us-west.modal.direct/v1",
                "defaultBaseUrl": "",
                "defaultModelId": "moonshotai/Kimi-K3",
                "isApiKeyConfigured": true,
                "apiKeyLast4": "cret"
              }
            }
            """;

        var dto = JsonSerializer.Deserialize<PlatformAiSettingsDto>(json, ApiJsonOptions);

        Assert.NotNull(dto);
        Assert.NotNull(dto!.Modal);
        Assert.True(dto.Modal.IsEnabled);
        Assert.Equal("cret", dto.Modal.ApiKeyLast4);
        Assert.Equal("moonshotai/Kimi-K3", dto.Modal.DefaultModelId);
        Assert.DoesNotContain("wk-", json);
        Assert.DoesNotContain("ws-", json);
    }

    [Fact]
    public void TenantModalSettings_serializes_without_leaking_tokens()
    {
        var dto = new TenantModalSettingsDto(
            HasOverride: true,
            IsEnabled: true,
            DisplayName: "Kimi 3",
            BaseUrl: "https://example--ep-kimi-k3-server.us-west.modal.direct/v1",
            DefaultBaseUrl: "",
            DefaultModelId: "moonshotai/Kimi-K3",
            IsApiKeyConfigured: true,
            ApiKeyLast4: "cret",
            PlatformConfiguredModelRef: "modal:moonshotai/Kimi-K3",
            Platform: new TenantModalPlatformSnapshotDto(true, "modal", null, true, "ht2t"));

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);

        Assert.Contains("\"hasOverride\":true", json);
        Assert.Contains("\"apiKeyLast4\":\"cret\"", json);
        Assert.Contains("\"platform\"", json);
        Assert.DoesNotContain("wk-", json);
        Assert.DoesNotContain("ws-", json);
        Assert.DoesNotContain("TOKEN_SECRET", json);
    }

    [Fact]
    public void DocStrange_settings_expose_no_field_able_to_carry_the_api_key()
    {
        // La cle Docstrange est une chaine hexadecimale SANS prefixe : un Assert.DoesNotContain
        // sur un prefixe ne prouverait rien. On verifie donc le contrat de forme : le DTO masque
        // ne publie que l'indicateur et les 4 derniers caracteres.
        const string fullKey = "7ed2ae00112233445566778899aabbccddeeffb11b";

        var dto = new PlatformDocStrangeSettingsDto(
            IsEnabled: true,
            DisplayName: "Docstrange",
            BaseUrl: "https://extraction-api.nanonets.com",
            DefaultBaseUrl: "https://extraction-api.nanonets.com",
            IsApiKeyConfigured: true,
            ApiKeyLast4: fullKey[^4..]);

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);

        Assert.DoesNotContain(fullKey, json);
        Assert.Contains("\"isApiKeyConfigured\":true", json);
        Assert.Contains("\"apiKeyLast4\":\"b11b\"", json);

        // Aucune propriete dont le nom suggere un secret, hors les deux champs masques attendus.
        using var parsed = JsonDocument.Parse(json);
        var names = parsed.RootElement.EnumerateObject().Select(x => x.Name).ToArray();
        Assert.Equal(
            new[] { "isEnabled", "displayName", "baseUrl", "defaultBaseUrl", "isApiKeyConfigured", "apiKeyLast4" },
            names);
    }

    [Fact]
    public void DocStrange_deserializes_from_a_payload_without_the_section()
    {
        // Charge utile anterieure a Docstrange : la section absente ne doit pas faire echouer
        // la deserialisation (meme tolerance que pour studioAiAdvancedModelRef et cursor).
        const string json = """
            {
              "configuredModelRef": null,
              "invoiceImportModelRef": null,
              "inferenceDevice": "Gpu",
              "isOllamaAssistantConfigured": true,
              "availableModels": [],
              "recommendation": null
            }
            """;

        var dto = JsonSerializer.Deserialize<PlatformAiSettingsDto>(json, ApiJsonOptions);

        Assert.NotNull(dto);
        Assert.Null(dto!.DocStrange);
    }
}
