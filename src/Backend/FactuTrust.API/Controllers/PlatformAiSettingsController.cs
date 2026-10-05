using System.Security.Claims;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Platform-wide AI model configuration. A single model is shared by every tenant
/// (Ollama runs on the shared platform server). OpenRouter credentials are also
/// configured here and shared by every tenant.
/// </summary>
[ApiController]
[Route("api/platform/ai-settings")]
[Authorize(Policy = PlatformPolicies.PlatformAdmin)]
public sealed class PlatformAiSettingsController : ControllerBase
{
    private const string ChatModelRequiredMessage =
        "Le modèle doit supporter le chat (modèle instruct). "
        + "Les modèles d'embedding (ex. nomic-embed-text) ne conviennent pas.";

    private const string ImportChatModelRequiredMessage =
        "Le modèle d'import doit supporter le chat (modèle instruct). "
        + "Les modèles d'embedding (ex. nomic-embed-text) ne conviennent pas.";

    private const string StudioAdvancedModelMustDifferMessage =
        "Le modèle Studio avancé doit être différent du modèle Studio standard. "
        + "Choisissez un modèle plus puissant (GPU distant ou cloud), ou laissez « Aucun » "
        + "pour désactiver la bascule « Modèle avancé ».";

    private readonly IPlatformAiSettingsService _settings;
    private readonly IOllamaClient _ollamaClient;
    private readonly IOpenAiChatCompletionsClient _openAiClient;
    private readonly ICursorAgentClient _cursorAgentClient;
    private readonly IAiModelRecommender _modelRecommender;
    private readonly IImportAiModelResolutionService _importModelResolver;
    private readonly OllamaSettings _ollamaSettings;
    private readonly CursorSdkSettings _cursorSdkSettings;
    private readonly ModalSettings _modalSettings;
    private readonly ILogger<PlatformAiSettingsController> _logger;

    public PlatformAiSettingsController(
        IPlatformAiSettingsService settings,
        IOllamaClient ollamaClient,
        IOpenAiChatCompletionsClient openAiClient,
        ICursorAgentClient cursorAgentClient,
        IAiModelRecommender modelRecommender,
        IImportAiModelResolutionService importModelResolver,
        IOptions<OllamaSettings> ollamaSettings,
        IOptions<CursorSdkSettings> cursorSdkSettings,
        IOptions<ModalSettings> modalSettings,
        ILogger<PlatformAiSettingsController> logger)
    {
        _settings = settings;
        _ollamaClient = ollamaClient;
        _openAiClient = openAiClient;
        _cursorAgentClient = cursorAgentClient;
        _modelRecommender = modelRecommender;
        _importModelResolver = importModelResolver;
        _ollamaSettings = ollamaSettings.Value;
        _cursorSdkSettings = cursorSdkSettings.Value;
        _modalSettings = modalSettings.Value;
        _logger = logger;
    }

    /// <summary>Configured platform model + installed Ollama models + hardware recommendation + OpenRouter.</summary>
    [HttpGet]
    [Authorize(Policy = "perm:" + PlatformPermissions.AiManage)]
    [ProducesResponseType(typeof(ApiResponse<PlatformAiSettingsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var configured = await _settings.GetDefaultModelRefAsync(cancellationToken);
        var importModel = await _settings.GetInvoiceImportModelRefAsync(cancellationToken);
        var studioModel = await _settings.GetStudioAiModelRefAsync(cancellationToken);
        var studioAdvancedModel = await _settings.GetStudioAiAdvancedModelRefAsync(cancellationToken);
        var inferenceDevice = await _settings.GetInferenceDeviceAsync(cancellationToken);
        var openRouter = await _settings.GetOpenRouterSettingsAsync(cancellationToken);
        var cursor = await _settings.GetCursorSettingsAsync(cancellationToken);
        var modal = await _settings.GetModalSettingsAsync(cancellationToken);

        var models = new List<UnifiedAiModelInfo>();
        try
        {
            var ollamaModels = await _ollamaClient.ListModelsAsync(cancellationToken);
            foreach (var m in ollamaModels)
            {
                models.Add(new UnifiedAiModelInfo(
                    $"{ModelRef.OllamaPrefix}{m.Name}",
                    "ollama",
                    m.Name,
                    m.Size,
                    m.ModifiedAt,
                    SupportsVision: AiModelCapabilityDetector.DetectVisionSupport(m.Name),
                    SupportsChat: AiModelCapabilityDetector.DetectChatCapable(m.Name)));
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to list Ollama models for platform AI settings.");
        }

        try
        {
            var openRouterCreds = await _settings.GetOpenRouterCredentialsAsync(cancellationToken);
            if (!string.IsNullOrEmpty(openRouterCreds.ApiKey))
            {
                var remote = await _openAiClient.ListModelsAsync(
                    openRouterCreds.BaseUrl, openRouterCreds.ApiKey, cancellationToken);
                foreach (var r in remote)
                {
                    models.Add(new UnifiedAiModelInfo(
                        $"{ModelRef.OpenRouterPrefix}{r.Id}",
                        "openrouter",
                        string.IsNullOrEmpty(r.Name) ? r.Id : r.Name!,
                        null,
                        null,
                        SupportsVision: AiModelCapabilityDetector.DetectVisionSupport(r.Id),
                        SupportsChat: AiModelCapabilityDetector.DetectChatCapable(r.Id)));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to list OpenRouter models for platform AI settings.");
        }

        try
        {
            if (_cursorSdkSettings.Enabled)
            {
                var cursorCreds = await _settings.GetCursorCredentialsAsync(cancellationToken);
                if (!string.IsNullOrEmpty(cursorCreds.ApiKey))
                {
                    var cursorModels = await _cursorAgentClient.ListModelsAsync(cursorCreds.ApiKey, cancellationToken);
                    models.AddRange(CursorModelCatalog.ToUnifiedModels(cursorModels));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to list Cursor models for platform AI settings.");
        }

        try
        {
            var modalCreds = await _settings.GetModalCredentialsAsync(cancellationToken);
            if (!string.IsNullOrEmpty(modalCreds.ApiKey) && !string.IsNullOrWhiteSpace(modalCreds.BaseUrl))
            {
                try
                {
                    var remote = await _openAiClient.ListModelsAsync(
                        modalCreds.BaseUrl,
                        modalCreds.ApiKey,
                        cancellationToken,
                        OpenAiCompatibleCallOptions.ForModal(_modalSettings, sessionId: null));
                    if (remote.Count == 0)
                    {
                        models.Add(ModalModelCatalog.ToUnified(_modalSettings.DefaultModelId));
                    }
                    else
                    {
                        foreach (var r in remote)
                            models.Add(ModalModelCatalog.ToUnified(r.Id, r.Name));
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to list Modal models for platform AI settings.");
                    models.Add(ModalModelCatalog.ToUnified(_modalSettings.DefaultModelId));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to resolve Modal credentials for platform AI settings.");
        }

        AiModelRecommendationDto? recommendation = null;
        try
        {
            recommendation = await _modelRecommender.RecommendBestLocalModelAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to compute the model recommendation for platform AI settings.");
        }

        var importResolution = await _importModelResolver.ResolveAsync(null, cancellationToken);
        var visionServer = _ollamaSettings.HonorLegacyImportVisionModels
            ? ImportAiModelResolver.ResolveLegacyInvoiceVisionModelId(_ollamaSettings)
            : null;
        var effectiveAssistantModel = string.IsNullOrWhiteSpace(configured)
            ? _ollamaSettings.DefaultModel
            : configured;
        var isOllamaAssistant = ModelRef.Parse(effectiveAssistantModel).Kind == LlmProviderKind.Ollama;

        var dto = new PlatformAiSettingsDto(
            configured,
            importModel,
            studioModel,
            studioAdvancedModel,
            visionServer,
            importResolution.Model.CanonicalModelRef,
            importResolution.IsVisionCapable,
            inferenceDevice,
            isOllamaAssistant,
            models,
            recommendation,
            openRouter,
            cursor,
            modal);
        return Ok(ApiResponse<PlatformAiSettingsDto>.Ok(dto));
    }

    /// <summary>Set the platform default model and/or OpenRouter credentials.</summary>
    [HttpPut]
    [Authorize(Policy = "perm:" + PlatformPermissions.AiManage)]
    [ProducesResponseType(typeof(ApiResponse<PlatformAiSettingsDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Update(
        [FromBody] UpdatePlatformAiSettingsRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var actorId))
            return Unauthorized(ApiResponse<object>.Fail("Non authentifié."));

        // Credentials d'abord : le même PUT peut activer Cursor/OpenRouter et sélectionner un modèle.
        if (request.OpenRouter is { } openRouter)
        {
            var (success, error) = await _settings.SetOpenRouterConfigAsync(
                openRouter.IsEnabled,
                openRouter.DisplayName,
                openRouter.BaseUrl,
                openRouter.ApiKey,
                actorId,
                cancellationToken);
            if (!success)
                return BadRequest(ApiResponse<object>.Fail(error ?? "Configuration OpenRouter invalide."));

            _logger.LogInformation(
                "Platform admin {ActorId} updated OpenRouter settings (enabled={Enabled})",
                actorId,
                openRouter.IsEnabled);
        }

        if (request.Cursor is { } cursorUpdate)
        {
            if (cursorUpdate.IsEnabled && !_cursorSdkSettings.Enabled)
                return BadRequest(ApiResponse<object>.Fail(
                    "Cursor SDK est désactivé sur le serveur (CursorSdk:Enabled). Activez-le dans la configuration avant d'enregistrer une clé."));

            var (success, error) = await _settings.SetCursorConfigAsync(
                cursorUpdate.IsEnabled,
                cursorUpdate.DisplayName,
                cursorUpdate.ApiKey,
                actorId,
                cancellationToken);
            if (!success)
                return BadRequest(ApiResponse<object>.Fail(error ?? "Configuration Cursor invalide."));

            _logger.LogInformation(
                "Platform admin {ActorId} updated Cursor settings (enabled={Enabled})",
                actorId,
                cursorUpdate.IsEnabled);
        }

        if (request.Modal is { } modalUpdate)
        {
            var (success, error) = await _settings.SetModalConfigAsync(
                modalUpdate.IsEnabled,
                modalUpdate.DisplayName,
                modalUpdate.BaseUrl,
                modalUpdate.ApiKey,
                actorId,
                cancellationToken);
            if (!success)
                return BadRequest(ApiResponse<object>.Fail(error ?? "Configuration Modal invalide."));

            _logger.LogInformation(
                "Platform admin {ActorId} updated Modal settings (enabled={Enabled})",
                actorId,
                modalUpdate.IsEnabled);
        }

        if (!string.IsNullOrWhiteSpace(request.ModelRef))
        {
            var parsed = ModelRef.Parse(request.ModelRef);
            if (string.IsNullOrEmpty(parsed.CanonicalModelRef))
                return BadRequest(ApiResponse<object>.Fail("Référence de modèle invalide."));
            if (!AiModelCapabilityDetector.DetectChatCapable(parsed))
                return BadRequest(ApiResponse<object>.Fail(ChatModelRequiredMessage));
            if (!CursorModelSelection.TryValidate(parsed, out var cursorError))
                return BadRequest(ApiResponse<object>.Fail(cursorError ?? "Référence de modèle Cursor invalide."));

            var allowed = await EnsureCursorAllowedAsync(parsed, cancellationToken);
            if (allowed is not null)
                return allowed;

            var modalAllowed = await EnsureModalAllowedAsync(parsed, cancellationToken);
            if (modalAllowed is not null)
                return modalAllowed;

            var installed = await EnsureModelInstalledAsync(parsed, "assistant", cancellationToken);
            if (installed is not null)
                return installed;
        }

        if (request.ModelRef is not null)
        {
            await _settings.SetDefaultModelRefAsync(request.ModelRef, actorId, cancellationToken);
            _logger.LogInformation("Platform admin {ActorId} updated the default AI model", actorId);
        }

        if (request.InvoiceImportModelRef is not null)
        {
            if (!string.IsNullOrWhiteSpace(request.InvoiceImportModelRef))
            {
                var parsedImport = ModelRef.Parse(request.InvoiceImportModelRef);
                if (string.IsNullOrEmpty(parsedImport.CanonicalModelRef))
                    return BadRequest(ApiResponse<object>.Fail("Référence de modèle d'import invalide."));
                if (!AiModelCapabilityDetector.DetectChatCapable(parsedImport))
                    return BadRequest(ApiResponse<object>.Fail(ImportChatModelRequiredMessage));
                if (!CursorModelSelection.TryValidate(parsedImport, out var cursorImportError))
                    return BadRequest(ApiResponse<object>.Fail(cursorImportError ?? "Référence de modèle Cursor invalide."));

                var allowedImport = await EnsureCursorAllowedAsync(parsedImport, cancellationToken);
                if (allowedImport is not null)
                    return allowedImport;

                var modalImport = await EnsureModalAllowedAsync(parsedImport, cancellationToken);
                if (modalImport is not null)
                    return modalImport;

                var installed = await EnsureModelInstalledAsync(parsedImport, "d'import de factures", cancellationToken);
                if (installed is not null)
                    return installed;
            }

            await _settings.SetInvoiceImportModelRefAsync(request.InvoiceImportModelRef, actorId, cancellationToken);
            _logger.LogInformation("Platform admin {ActorId} updated the invoice import AI model", actorId);
        }

        if (request.StudioAiModelRef is not null)
        {
            var invalidStudio = await ValidateStudioModelAsync(
                request.StudioAiModelRef, "Studio", cancellationToken);
            if (invalidStudio is not null)
                return invalidStudio;

            await _settings.SetStudioAiModelRefAsync(request.StudioAiModelRef, actorId, cancellationToken);
            _logger.LogInformation("Platform admin {ActorId} updated the Studio AI model", actorId);
        }

        if (request.StudioAiAdvancedModelRef is not null)
        {
            var invalidAdvanced = await ValidateStudioModelAsync(
                request.StudioAiAdvancedModelRef, "Studio avancé", cancellationToken);
            if (invalidAdvanced is not null)
                return invalidAdvanced;

            if (!string.IsNullOrWhiteSpace(request.StudioAiAdvancedModelRef))
            {
                // Le même PUT peut modifier le modèle standard : comparer à la valeur qui sera
                // effective, sinon un envoi simultané des deux champs échapperait au contrôle.
                var effectiveStandard = request.StudioAiModelRef
                    ?? await _settings.GetStudioAiModelRefAsync(cancellationToken);

                if (IsSameModelRef(request.StudioAiAdvancedModelRef, effectiveStandard))
                    return BadRequest(ApiResponse<object>.Fail(StudioAdvancedModelMustDifferMessage));
            }

            await _settings.SetStudioAiAdvancedModelRefAsync(
                request.StudioAiAdvancedModelRef, actorId, cancellationToken);
            _logger.LogInformation("Platform admin {ActorId} updated the advanced Studio AI model", actorId);
        }

        if (request.InferenceDevice is { } device)
        {
            if (!Enum.IsDefined(device))
                return BadRequest(ApiResponse<object>.Fail("Moteur d'inférence invalide."));

            await _settings.SetInferenceDeviceAsync(device, actorId, cancellationToken);
            _modelRecommender.InvalidateCache();
            _logger.LogInformation(
                "Platform admin {ActorId} updated the Ollama inference device to {Device}",
                actorId,
                device);
        }

        return await Get(cancellationToken);
    }

    /// <summary>
    /// Contrôles communs aux deux modèles Studio (standard et avancé) : référence analysable,
    /// capacité chat, sélection Cursor valide, fournisseur cloud réellement configuré et — pour un
    /// modèle Ollama — présence effective dans le catalogue du moteur IA.
    ///
    /// <para>Une valeur vide (effacement du réglage) est toujours acceptée.</para>
    /// </summary>
    /// <param name="label">
    /// Libellé français inséré dans les messages d'erreur (« Studio », « Studio avancé »).
    /// </param>
    /// <returns><c>null</c> si l'enregistrement peut se poursuivre, sinon la réponse d'erreur.</returns>
    private async Task<IActionResult?> ValidateStudioModelAsync(
        string? rawModelRef, string label, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rawModelRef))
            return null;

        var parsed = ModelRef.Parse(rawModelRef);
        if (string.IsNullOrEmpty(parsed.CanonicalModelRef))
            return BadRequest(ApiResponse<object>.Fail($"Référence de modèle {label} invalide."));
        if (!AiModelCapabilityDetector.DetectChatCapable(parsed))
            return BadRequest(ApiResponse<object>.Fail(ChatModelRequiredMessage));
        if (!CursorModelSelection.TryValidate(parsed, out var cursorError))
            return BadRequest(ApiResponse<object>.Fail(cursorError ?? "Référence de modèle Cursor invalide."));

        var cursorAllowed = await EnsureCursorAllowedAsync(parsed, cancellationToken);
        if (cursorAllowed is not null)
            return cursorAllowed;

        var modalAllowed = await EnsureModalAllowedAsync(parsed, cancellationToken);
        if (modalAllowed is not null)
            return modalAllowed;

        return await EnsureModelInstalledAsync(parsed, label, cancellationToken);
    }

    /// <summary>
    /// Compare deux références de modèle sur leur forme canonique (« ollama:Qwen2.5:7B » et
    /// « qwen2.5:7b » désignent le même modèle) : évite qu'un modèle « avancé » identique au
    /// standard ne soit enregistré et ne promette des tours d'outils supplémentaires pour rien.
    /// </summary>
    private static bool IsSameModelRef(string? left, string? right)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
            return false;

        return string.Equals(
            ModelRef.NormalizeStored(left),
            ModelRef.NormalizeStored(right),
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Refuse d'enregistrer un modèle Ollama qui n'est pas réellement installé.
    ///
    /// <para>Sans ce contrôle, l'écran acceptait sans broncher un modèle inexistant (le back-office
    /// le propose même explicitement en « (non installé) »). L'anomalie ne se révélait qu'à la
    /// première utilisation, sous la forme d'un 404 déguisé en « préchauffage lent ».</para>
    ///
    /// <para><b>Fail-open délibéré</b> : si la liste des modèles revient vide, c'est qu'Ollama est
    /// injoignable, pas que le modèle est absent. On laisse alors passer, pour ne pas bloquer
    /// l'administrateur sur une panne transitoire.</para>
    /// </summary>
    /// <returns><c>null</c> si l'enregistrement peut se poursuivre, sinon la réponse d'erreur.</returns>
    private async Task<IActionResult?> EnsureModelInstalledAsync(
        ParsedModelRef parsed, string usage, CancellationToken cancellationToken)
    {
        // Un modèle cloud (OpenRouter / Cursor) n'est pas installé localement : rien à vérifier ici.
        if (parsed.Kind != LlmProviderKind.Ollama || string.IsNullOrWhiteSpace(parsed.ProviderModelId))
            return null;

        List<OllamaModelInfo> models;
        try
        {
            models = (await _ollamaClient.ListModelsAsync(cancellationToken)).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Impossible de lister les modèles Ollama pour valider « {Model} » ; enregistrement autorisé.",
                parsed.ProviderModelId);
            return null;
        }

        if (models.Count == 0)
            return null;

        if (models.Any(m => OllamaModelName.Matches(parsed.ProviderModelId, m.Name)))
            return null;

        var available = string.Join(", ", models.Select(m => m.Name).Order().Take(12));
        _logger.LogWarning(
            "Refus d'enregistrer le modèle {Usage} « {Model} » : absent du moteur IA.",
            usage, parsed.ProviderModelId);

        return BadRequest(ApiResponse<object>.Fail(
            $"Le modèle {usage} « {parsed.ProviderModelId} » n'est pas installé sur le moteur IA. "
            + $"Installez-le (ollama pull {parsed.ProviderModelId}) ou choisissez-en un parmi : {available}."));
    }

    private async Task<IActionResult?> EnsureCursorAllowedAsync(
        ParsedModelRef parsed, CancellationToken cancellationToken)
    {
        if (parsed.Kind != LlmProviderKind.Cursor)
            return null;

        if (!_cursorSdkSettings.Enabled)
            return BadRequest(ApiResponse<object>.Fail(
                "Cursor SDK est désactivé sur le serveur (CursorSdk:Enabled=false)."));

        var creds = await _settings.GetCursorCredentialsAsync(cancellationToken);
        if (string.IsNullOrEmpty(creds.ApiKey))
            return BadRequest(ApiResponse<object>.Fail(
                "Aucune clé API Cursor configurée. Activez Cursor et saisissez la clé dans Configuration IA."));

        try
        {
            var catalog = await _cursorAgentClient.ListModelsAsync(creds.ApiKey, cancellationToken);
            if (catalog.Count == 0)
                return null;

            if (catalog.Any(m => string.Equals(m.Id, parsed.ProviderModelId, StringComparison.OrdinalIgnoreCase)))
                return null;

            var available = string.Join(", ", catalog.Select(m => m.Id).Distinct().Take(12));
            return BadRequest(ApiResponse<object>.Fail(
                $"Le modèle Cursor « {parsed.ProviderModelId} » n'est pas dans le catalogue de cette clé. Disponibles : {available}."));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Impossible de valider le modèle Cursor {Model} ; enregistrement autorisé.", parsed.ProviderModelId);
            return null;
        }
    }

    private async Task<IActionResult?> EnsureModalAllowedAsync(
        ParsedModelRef parsed, CancellationToken cancellationToken)
    {
        if (parsed.Kind != LlmProviderKind.Modal)
            return null;

        var creds = await _settings.GetModalCredentialsAsync(cancellationToken);
        if (string.IsNullOrEmpty(creds.ApiKey))
            return BadRequest(ApiResponse<object>.Fail(
                "Aucune clé API Modal configurée. Activez Modal et saisissez le token dans Configuration IA."));

        if (string.IsNullOrWhiteSpace(creds.BaseUrl))
            return BadRequest(ApiResponse<object>.Fail(
                "Aucune URL Modal configurée. Renseignez l'URL HTTPS (…/v1) dans Configuration IA."));

        if (string.Equals(parsed.ProviderModelId, _modalSettings.DefaultModelId, StringComparison.OrdinalIgnoreCase))
            return null;

        try
        {
            var catalog = await _openAiClient.ListModelsAsync(
                creds.BaseUrl,
                creds.ApiKey,
                cancellationToken,
                OpenAiCompatibleCallOptions.ForModal(_modalSettings, sessionId: null));
            if (catalog.Count == 0)
                return null;

            if (catalog.Any(m => string.Equals(m.Id, parsed.ProviderModelId, StringComparison.OrdinalIgnoreCase)))
                return null;

            var available = string.Join(", ", catalog.Select(m => m.Id).Distinct().Take(12));
            return BadRequest(ApiResponse<object>.Fail(
                $"Le modèle Modal « {parsed.ProviderModelId} » n'est pas dans le catalogue de cet endpoint. Disponibles : {available}."));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Impossible de valider le modèle Modal {Model} ; enregistrement autorisé.", parsed.ProviderModelId);
            return null;
        }
    }
}
