using System.Security.Claims;
using System.Text.Json;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Commands;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Queries;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using FactuTrust.Infrastructure.Services.AI;

namespace FactuTrust.API.Controllers;

[Route("api/ai")]
[ApiController]
[Authorize(Policy = PermissionPolicies.AiChat)]
public class AiChatController : ControllerBase
{
    private static readonly JsonSerializerOptions SseJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly IMediator _mediator;
    private readonly SendChatMessageHandler _chatHandler;
    private readonly IOllamaClient _ollamaClient;
    private readonly IAiModelVisionProbe _visionProbe;
    private readonly IOpenAiChatCompletionsClient _openAiClient;
    private readonly ICursorAgentClient _cursorAgentClient;
    private readonly IPlatformAiSettingsService _platformAiSettings;
    private readonly IModalCredentialsResolver _modalCredentials;
    private readonly ITenantContext _tenantContext;
    private readonly IOllamaInferenceProfileResolver _inferenceProfileResolver;
    private readonly IAiModelRecommender _modelRecommender;
    private readonly ILogger<AiChatController> _logger;
    private readonly IHostEnvironment _environment;
    private readonly OllamaSettings _ollamaSettings;
    private readonly CursorSdkSettings _cursorSdkSettings;
    private readonly ModalSettings _modalSettings;
    private readonly IAiDocumentTextExtractor _documentTextExtractor;

    public AiChatController(
        IMediator mediator,
        SendChatMessageHandler chatHandler,
        IOllamaClient ollamaClient,
        IAiModelVisionProbe visionProbe,
        IOpenAiChatCompletionsClient openAiClient,
        ICursorAgentClient cursorAgentClient,
        IPlatformAiSettingsService platformAiSettings,
        IModalCredentialsResolver modalCredentials,
        ITenantContext tenantContext,
        IOllamaInferenceProfileResolver inferenceProfileResolver,
        IAiModelRecommender modelRecommender,
        IAiDocumentTextExtractor documentTextExtractor,
        ILogger<AiChatController> logger,
        IHostEnvironment environment,
        IOptions<OllamaSettings> ollamaSettings,
        IOptions<CursorSdkSettings> cursorSdkSettings,
        IOptions<ModalSettings> modalSettings)
    {
        _mediator = mediator;
        _chatHandler = chatHandler;
        _ollamaClient = ollamaClient;
        _visionProbe = visionProbe;
        _openAiClient = openAiClient;
        _cursorAgentClient = cursorAgentClient;
        _platformAiSettings = platformAiSettings;
        _modalCredentials = modalCredentials;
        _tenantContext = tenantContext;
        _inferenceProfileResolver = inferenceProfileResolver;
        _modelRecommender = modelRecommender;
        _documentTextExtractor = documentTextExtractor;
        _logger = logger;
        _environment = environment;
        _ollamaSettings = ollamaSettings.Value;
        _cursorSdkSettings = cursorSdkSettings.Value;
        _modalSettings = modalSettings.Value;
    }

    private Guid GetUserId() => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    /// <summary>
    /// Send a chat message and receive a streaming SSE response.
    /// </summary>
    [HttpPost("chat")]
    [EnableRateLimiting("ai")]
    public async Task Chat([FromBody] AiChatHttpRequestDto request, CancellationToken cancellationToken)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";
        Response.Headers.Append("X-Trace-Id", HttpContext.TraceIdentifier);

        var command = new SendChatMessageCommand(
            request.ConversationId,
            request.Message,
            request.Model,
            request.UiContext,
            request.Options,
            request.Attachments);

        var userId = GetUserId();
        var correlationId = HttpContext.TraceIdentifier;

        using var heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var writeLock = new SemaphoreSlim(1, 1);
        var heartbeatSeconds = Math.Clamp(_ollamaSettings.SseHeartbeatIntervalSeconds, 0, 120);

        Task? heartbeatTask = null;
        if (heartbeatSeconds > 0)
        {
            heartbeatTask = Task.Run(
                () => HeartbeatLoopAsync(heartbeatSeconds, writeLock, heartbeatCts.Token),
                CancellationToken.None);
        }

        try
        {
            await foreach (var chunk in _chatHandler.HandleAsync(command, userId, correlationId, cancellationToken))
            {
                await writeLock.WaitAsync(cancellationToken);
                try
                {
                    var json = JsonSerializer.Serialize(chunk, SseJsonOptions);
                    await Response.WriteAsync($"data: {json}\n\n", cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);
                }
                finally
                {
                    writeLock.Release();
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Déconnexion réelle du client (navigation, fermeture d'onglet, bouton « Stop ») : rien à émettre.
        }
        catch (Exception ex)
        {
            // Inclut les OperationCanceledException qui NE proviennent PAS d'une déconnexion client
            // (ex. délai HttpClient atteint en attendant un Ollama saturé). On les signale explicitement
            // au client au lieu de les avaler : sinon le flux se ferme sans évènement terminal et le
            // client affiche « Génération interrompue » de façon trompeuse.
            LogChatException(ex);
            var errorEvent = ChatStreamEvent.ErrorEvent(ResolveChatErrorMessageForClient(ex));
            var errorJson = JsonSerializer.Serialize(errorEvent, SseJsonOptions);
            try
            {
                await writeLock.WaitAsync(cancellationToken);
                try
                {
                    await Response.WriteAsync($"data: {errorJson}\n\n", cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);
                }
                finally
                {
                    writeLock.Release();
                }
            }
            catch (OperationCanceledException)
            {
                // Response no longer writable
            }
        }
        finally
        {
            await heartbeatCts.CancelAsync();
            if (heartbeatTask is not null)
            {
                try
                {
                    await heartbeatTask;
                }
                catch (OperationCanceledException)
                {
                    // ignored
                }
            }
        }
    }

    private async Task HeartbeatLoopAsync(int intervalSeconds, SemaphoreSlim writeLock, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(intervalSeconds), cancellationToken);
                await writeLock.WaitAsync(cancellationToken);
                try
                {
                    var json = JsonSerializer.Serialize(ChatStreamEvent.Heartbeat(), SseJsonOptions);
                    await Response.WriteAsync($"data: {json}\n\n", cancellationToken);
                    await Response.Body.FlushAsync(cancellationToken);
                }
                finally
                {
                    writeLock.Release();
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown when the chat stream ends or the client disconnects.
        }
    }

    private void LogChatException(Exception ex)
    {
        var traceId = HttpContext.TraceIdentifier;
        if (ex is DbUpdateException dbEx)
        {
            _logger.LogError(dbEx,
                "Échec de persistance assistant IA (DbUpdateException). TraceId={TraceId}. Inner={Inner}",
                traceId,
                dbEx.InnerException?.Message);
            return;
        }

        if (ex is OllamaRequestException ore)
        {
            _logger.LogWarning("Erreur appel Ollama (assistant IA). TraceId={TraceId} Status={Status} Detail={Detail}",
                traceId,
                ore.HttpStatusCode,
                ore.Message);
            return;
        }

        if (ex is OpenAiCompatibleRequestException oa)
        {
            _logger.LogWarning("Erreur appel fournisseur OpenAI-compatible (assistant IA). TraceId={TraceId} Status={Status}",
                traceId,
                oa.HttpStatusCode);
            return;
        }

        _logger.LogError(ex, "Erreur flux assistant IA. TraceId={TraceId}", traceId);
    }

    private string ResolveChatErrorMessageForClient(Exception ex)
    {
        if (ex is OllamaRequestException ore)
            return ore.UserMessage;

        if (ex is OpenAiCompatibleRequestException oa)
            return oa.UserMessage;

        if (ex is OperationCanceledException or TimeoutException)
            return "Le service IA est momentanément saturé ou a mis trop de temps à répondre. Réessayez dans un instant.";

        if (ex is DbUpdateException dxe)
        {
            return _environment.IsDevelopment()
                ? $"{dxe.Message} ({dxe.InnerException?.Message})"
                : "Impossible d'enregistrer la conversation. Réessayez dans un instant. Si le problème persiste, contactez l'administrateur.";
        }

        if (_environment.IsDevelopment())
            return ex.Message;

        return "Une erreur inattendue s'est produite avec l'assistant IA. Réessayez dans un instant.";
    }

    /// <summary>
    /// List conversations for the current user, filtered by module expert scope
    /// (0 = assistant global — default, backward compatible).
    /// </summary>
    [HttpGet("conversations")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ConversationDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetConversations([FromQuery] int scope = 0, CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(typeof(AssistantAgentScope), scope))
            return BadRequest(ApiResponse<object>.Fail("Scope d'assistant invalide."));

        var userId = GetUserId();
        var result = await _mediator.Send(new GetConversationsQuery(userId, scope), cancellationToken);

        return result.IsSuccess
            ? Ok(ApiResponse<IReadOnlyList<ConversationDto>>.Ok(result.Value))
            : BadRequest(ApiResponse<object>.Fail(result.Error.Description));
    }

    /// <summary>
    /// Get a single conversation with all messages.
    /// </summary>
    [HttpGet("conversations/{id:guid}")]
    [ProducesResponseType(typeof(ApiResponse<ConversationDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetConversation(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetConversationQuery(id), cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<ConversationDetailDto>.Ok(result.Value));
    }

    /// <summary>
    /// Delete a conversation.
    /// </summary>
    [HttpDelete("conversations/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteConversation(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new DeleteConversationCommand(id), cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<object>.Fail(result.Error.Description));

        return NoContent();
    }

    /// <summary>
    /// List available models (Ollama + configured cloud providers).
    /// </summary>
    [HttpGet("models")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<UnifiedAiModelInfo>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetModels(CancellationToken cancellationToken)
    {
        var unified = new List<UnifiedAiModelInfo>();

        var ollamaModels = await _ollamaClient.ListModelsAsync(cancellationToken);
        foreach (var m in ollamaModels)
        {
            var modelRef = $"{ModelRef.OllamaPrefix}{m.Name}";
            // Capacité publiée par le moteur ; le nom ne sert que s'il ne la déclare pas.
            var declaredVision = await _visionProbe.TryDetectVisionAsync(
                ModelRef.Parse(modelRef), cancellationToken);

            unified.Add(new UnifiedAiModelInfo(
                modelRef,
                "ollama",
                m.Name,
                m.Size,
                m.ModifiedAt,
                SupportsVision: AiModelCapabilityDetector.ResolveVisionSupport(declaredVision, m.Name),
                SupportsChat: AiModelCapabilityDetector.DetectChatCapable(m.Name)));
        }

        var openRouter = await _platformAiSettings.GetOpenRouterCredentialsAsync(cancellationToken);
        if (!string.IsNullOrEmpty(openRouter.ApiKey))
        {
            try
            {
                var remote = await _openAiClient.ListModelsAsync(openRouter.BaseUrl, openRouter.ApiKey, cancellationToken);
                foreach (var r in remote)
                {
                    unified.Add(new UnifiedAiModelInfo(
                        $"{ModelRef.OpenRouterPrefix}{r.Id}",
                        "openrouter",
                        string.IsNullOrEmpty(r.Name) ? r.Id : r.Name!,
                        null,
                        null,
                        SupportsVision: AiModelCapabilityDetector.DetectVisionSupport(r.Id),
                        SupportsChat: AiModelCapabilityDetector.DetectChatCapable(r.Id)));
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to list OpenRouter models; returning Ollama models only.");
            }
        }

        if (_cursorSdkSettings.Enabled)
        {
            try
            {
                var cursorCreds = await _platformAiSettings.GetCursorCredentialsAsync(cancellationToken);
                if (!string.IsNullOrEmpty(cursorCreds.ApiKey))
                {
                    var cursorModels = await _cursorAgentClient.ListModelsAsync(cursorCreds.ApiKey, cancellationToken);
                    unified.AddRange(CursorModelCatalog.ToUnifiedModels(cursorModels));
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to list Cursor models; returning other providers only.");
            }
        }

        try
        {
            var modal = await _modalCredentials.ResolveAsync(_tenantContext.TenantId, cancellationToken);
            if (!string.IsNullOrEmpty(modal.ApiKey) && !string.IsNullOrWhiteSpace(modal.BaseUrl))
            {
                try
                {
                    var remote = await _openAiClient.ListModelsAsync(
                        modal.BaseUrl,
                        modal.ApiKey,
                        cancellationToken,
                        OpenAiCompatibleCallOptions.ForModal(_modalSettings, sessionId: null));
                    if (remote.Count == 0)
                    {
                        unified.Add(ModalModelCatalog.ToUnified(_modalSettings.DefaultModelId));
                    }
                    else
                    {
                        foreach (var r in remote)
                            unified.Add(ModalModelCatalog.ToUnified(r.Id, r.Name));
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to list Modal models; injecting static catalogue.");
                    unified.Add(ModalModelCatalog.ToUnified(_modalSettings.DefaultModelId));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to resolve Modal credentials; returning other providers only.");
        }

        return Ok(ApiResponse<IReadOnlyList<UnifiedAiModelInfo>>.Ok(unified));
    }

    /// <summary>
    /// Pre-loads an Ollama model into memory to reduce perceived latency on the next chat request.
    /// </summary>
    [HttpPost("warm-up")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> WarmUp([FromBody] AiWarmUpRequest? request, CancellationToken cancellationToken)
    {
        // Le modèle est résolu côté serveur depuis la configuration globale de la plateforme
        // (back-office) ; le corps de requête éventuel est ignoré.
        _ = request;
        var configuredModel = await _platformAiSettings.GetDefaultModelRefAsync(cancellationToken);
        var requestedModel = string.IsNullOrWhiteSpace(configuredModel)
            ? _ollamaSettings.DefaultModel
            : configuredModel;

        var modelRef = ModelRef.Parse(requestedModel);
        if (modelRef.Kind != LlmProviderKind.Ollama || string.IsNullOrWhiteSpace(modelRef.ProviderModelId))
            return Ok(new { warmed = false });

        if (!await _ollamaClient.IsAvailableAsync(cancellationToken))
            return Ok(new { warmed = false });

        if (!await _ollamaClient.IsModelInstalledAsync(modelRef.ProviderModelId, cancellationToken))
            return Ok(new { warmed = false });

        var keepAlive = $"{Math.Clamp(_ollamaSettings.KeepAliveMinutes, 1, 1440)}m";
        // Précharger avec les MÊMES options de chargement que le chat (num_ctx fixe + num_batch) → l'instance
        // préchargée est exactement celle réutilisée à la 1ʳᵉ question (sinon rechargement coûteux).
        var inferenceProfile = await _inferenceProfileResolver.ResolveForPlatformAsync(cancellationToken);
        var warmNumCtx = OllamaChatNumCtxResolver.ResolveForModelLoad(_ollamaSettings, inferenceProfile);
        var warmed = await _ollamaClient.WarmUpModelAsync(
            modelRef.ProviderModelId,
            keepAlive,
            cancellationToken,
            warmNumCtx,
            inferenceProfile.NumBatch,
            inferenceProfile);
        if (warmed)
        {
            _logger.LogDebug("AI warm-up completed for model={Model}", modelRef.ProviderModelId);
        }

        return Ok(new { warmed });
    }

    /// <summary>
    /// Aggregated CRM / receivables snapshot for the assistant welcome panel (no LLM).
    /// </summary>
    [HttpGet("daily-briefing")]
    [ProducesResponseType(typeof(ApiResponse<DailyAiBriefingDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetDailyBriefing(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var result = await _mediator.Send(new DailyAiBriefingQuery(userId), cancellationToken);
        return result.IsSuccess
            ? Ok(ApiResponse<DailyAiBriefingDto>.Ok(result.Value))
            : BadRequest(ApiResponse<object>.Fail(result.Error.Description));
    }

    public const long DocumentExtractMaxBytes = 10 * 1024 * 1024;

    /// <summary>
    /// Extract plain text from a small text or PDF file for pasting into the AI chat (read-only).
    /// </summary>
    [HttpPost("document-extract")]
    [RequestSizeLimit(DocumentExtractMaxBytes + 256_000)]
    [ProducesResponseType(typeof(ApiResponse<AiDocumentExtractResponseDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> ExtractDocument(
        IFormFile file,
        [FromQuery] bool renderImages = false,
        CancellationToken cancellationToken = default)
    {
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.Fail("Fichier requis."));

        if (file.Length > DocumentExtractMaxBytes)
            return BadRequest(ApiResponse<object>.Fail("Fichier trop volumineux (maximum 10 Mo)."));

        var options = new AiDocumentExtractOptions { RenderPagesAsImages = renderImages };

        await using var stream = file.OpenReadStream();
        var extraction = await _documentTextExtractor.ExtractAsync(
            stream, file.FileName, file.ContentType, options, cancellationToken);
        if (!extraction.Success)
            return BadRequest(ApiResponse<object>.Fail(extraction.ErrorMessage ?? "Extraction impossible."));

        var dto = new AiDocumentExtractResponseDto
        {
            Text = extraction.Text,
            Truncated = extraction.Truncated,
            FileName = file.FileName,
            Format = extraction.Format,
            OcrApplied = extraction.OcrApplied,
            PageCount = extraction.PageCount,
            SizeBytes = file.Length,
            Pages = extraction.Pages.Select(p => new AiDocumentExtractPageDto
            {
                PageIndex = p.PageIndex,
                Text = p.Text,
                ImageBase64 = p.ImageBase64,
                Width = p.Width,
                Height = p.Height,
                OcrApplied = p.OcrApplied
            }).ToList(),
            Warnings = extraction.Warnings.ToList()
        };
        return Ok(ApiResponse<AiDocumentExtractResponseDto>.Ok(dto));
    }

    /// <summary>
    /// Recommends the best locally-installed Ollama model based on the server's hardware
    /// profile (RAM, CPU, GPU/VRAM) and model characteristics.
    /// </summary>
    [HttpGet("recommendation")]
    [EnableRateLimiting("ai")]
    [ProducesResponseType(typeof(ApiResponse<AiModelRecommendationDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetRecommendation(CancellationToken cancellationToken)
    {
        var result = await _modelRecommender.RecommendBestLocalModelAsync(cancellationToken);
        return Ok(ApiResponse<AiModelRecommendationDto?>.Ok(result));
    }

    /// <summary>
    /// Returns whether any AI provider is properly configured
    /// (Ollama available and/or platform OpenRouter or Cursor with valid API key).
    /// </summary>
    [HttpGet("configured-status")]
    [EnableRateLimiting("ai")]
    [ProducesResponseType(typeof(ApiResponse<AiConfiguredStatusDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetConfiguredStatus(CancellationToken cancellationToken)
    {
        var state = await ResolveHealthStateAsync(useTenantModal: true, cancellationToken);
        var dto = new AiConfiguredStatusDto(
            HasOllamaModels: state.OllamaOk,
            HasCloudProvider: state.HasCloudProvider,
            IsFullyConfigured: state.Available);

        return Ok(ApiResponse<AiConfiguredStatusDto>.Ok(dto));
    }

    /// <summary>
    /// Returns the AI model effectively used for the current tenant — configured by an
    /// administrator in the back-office, or the server default fallback.
    /// </summary>
    [HttpGet("active-model")]
    [ProducesResponseType(typeof(ApiResponse<AiActiveModelDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetActiveModel(CancellationToken cancellationToken)
    {
        var configured = await _platformAiSettings.GetDefaultModelRefAsync(cancellationToken);

        var fallback = string.IsNullOrWhiteSpace(_ollamaSettings.DefaultModel)
            ? "mistral"
            : _ollamaSettings.DefaultModel.Trim();
        var rawModel = string.IsNullOrWhiteSpace(configured)
            ? $"{ModelRef.OllamaPrefix}{fallback}"
            : configured;

        var parsed = ModelRef.Parse(rawModel);
        var supportsVision = AiModelCapabilityDetector.DetectVisionSupport(parsed);
        var dto = new AiActiveModelDto(parsed.CanonicalModelRef, parsed.ProviderModelId, supportsVision);

        return Ok(ApiResponse<AiActiveModelDto>.Ok(dto));
    }

    /// <summary>
    /// Check if at least one AI backend is available (Ollama or configured cloud, including Cursor).
    /// </summary>
    [HttpGet("health")]
    [AllowAnonymous]
    public async Task<IActionResult> Health(CancellationToken cancellationToken)
    {
        var state = await ResolveHealthStateAsync(useTenantModal: false, cancellationToken);
        return Ok(new { available = state.Available });
    }

    private sealed record AiHealthState(bool Available, bool OllamaOk, bool HasCloudProvider);

    private async Task<AiHealthState> ResolveHealthStateAsync(bool useTenantModal, CancellationToken cancellationToken)
    {
        var ollamaOk = await _ollamaClient.IsAvailableAsync(cancellationToken);
        var openRouter = await _platformAiSettings.GetOpenRouterCredentialsAsync(cancellationToken);
        var cursor = await _platformAiSettings.GetCursorCredentialsAsync(cancellationToken);
        var modal = useTenantModal
            ? await _modalCredentials.ResolveAsync(_tenantContext.TenantId, cancellationToken)
            : ResolvedModalCredentials.FromPlatform(
                await _platformAiSettings.GetModalCredentialsAsync(cancellationToken));
        var hasCloudProvider = AiAssistantAvailabilityResolver.HasCloudProviderConfigured(
            openRouter.IsEnabled,
            openRouter.ApiKey,
            _cursorSdkSettings.Enabled,
            cursor.IsEnabled,
            cursor.ApiKey,
            modal.IsEnabled,
            modal.ApiKey);

        var configured = await _platformAiSettings.GetDefaultModelRefAsync(cancellationToken);
        var fallback = string.IsNullOrWhiteSpace(_ollamaSettings.DefaultModel)
            ? "mistral"
            : _ollamaSettings.DefaultModel.Trim();
        var rawModel = string.IsNullOrWhiteSpace(configured)
            ? $"{ModelRef.OllamaPrefix}{fallback}"
            : configured;
        var activeModel = ModelRef.Parse(rawModel);

        var available = await AiAssistantAvailabilityResolver.IsHealthAvailableAsync(
            ollamaOk,
            hasCloudProvider,
            activeModel,
            _cursorAgentClient.IsAvailableAsync,
            cancellationToken);

        return new AiHealthState(available, ollamaOk, hasCloudProvider);
    }
}
