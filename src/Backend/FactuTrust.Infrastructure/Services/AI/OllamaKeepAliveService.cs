using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Background service that periodically pings Ollama with a minimal chat request to keep the
/// default model loaded in GPU/RAM, preventing costly cold-start delays on user requests.
/// </summary>
public sealed class OllamaKeepAliveService : BackgroundService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly OllamaSettings _settings;
    private readonly ILogger<OllamaKeepAliveService> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    public OllamaKeepAliveService(
        IHttpClientFactory httpClientFactory,
        IServiceScopeFactory scopeFactory,
        IOptions<OllamaSettings> settings,
        ILogger<OllamaKeepAliveService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _scopeFactory = scopeFactory;
        _settings = settings.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_settings.KeepAliveEnabled)
        {
            _logger.LogInformation("Ollama keep-alive service is disabled via configuration");
            return;
        }

        var interval = TimeSpan.FromMinutes(Math.Clamp(_settings.KeepAliveIntervalMinutes, 1, 30));
        var keepAlive = $"{Math.Clamp(_settings.KeepAliveMinutes, 1, 1440)}m";

        _logger.LogInformation(
            "Ollama keep-alive service started: interval={IntervalMin}m keep_alive={KeepAlive}",
            interval.TotalMinutes, keepAlive);

        // Brief initial delay to let Ollama finish starting up.
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var model = await ResolveKeepAliveModelNameAsync(stoppingToken);
                if (string.IsNullOrWhiteSpace(model))
                {
                    _logger.LogDebug("Ollama keep-alive: aucun modèle configuré, cycle ignoré");
                }
                else
                {
                    // Mêmes options de chargement que le chat (num_ctx + num_batch) → Ollama réutilise
                    // l'instance chargée (aucun rechargement au 1ᵉʳ message après un ping).
                    var inferenceProfile = await ResolveInferenceProfileAsync(stoppingToken);
                    var chatNumCtx = OllamaChatNumCtxResolver.ResolveForModelLoad(_settings, inferenceProfile);
                    await PingOllamaAsync(model, keepAlive, chatNumCtx, inferenceProfile, stoppingToken);

                    // Le modèle vision (llava) n'est gardé chaud que si explicitement demandé : sinon ~4–5 Go
                    // de RAM gaspillés en continu. Il se charge à la demande lors d'un import photo.
                    if (_settings.KeepVisionModelWarm)
                    {
                        using var importScope = _scopeFactory.CreateScope();
                        var importResolver = importScope.ServiceProvider.GetRequiredService<IImportAiModelResolutionService>();
                        var vision = await importResolver.ResolveEffectiveVisionModelIdAsync(
                            null, forBankStatement: false, stoppingToken);
                        if (!string.IsNullOrWhiteSpace(vision)
                            && !string.Equals(vision, model, StringComparison.OrdinalIgnoreCase))
                        {
                            await PingOllamaAsync(vision, keepAlive, null, inferenceProfile, stoppingToken);
                        }
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Ollama keep-alive ping failed (will retry in {IntervalMin}m)", interval.TotalMinutes);
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("Ollama keep-alive service stopped");
    }

    private async Task PingOllamaAsync(
        string model,
        string keepAlive,
        int? numCtx,
        OllamaInferenceProfile inferenceProfile,
        CancellationToken ct)
    {
        using var client = _httpClientFactory.CreateClient("OllamaKeepAlive");

        // Inclure les mêmes options de chargement que le chat (num_ctx + num_batch + num_gpu + num_thread)
        // garantit qu'Ollama réutilise EXACTEMENT l'instance que le chat utilisera.
        var options = new Dictionary<string, object> { ["num_predict"] = 1 };
        if (numCtx is > 0)
            options["num_ctx"] = numCtx.Value;
        if (inferenceProfile.NumBatch is > 0)
            options["num_batch"] = inferenceProfile.NumBatch.Value;
        if (inferenceProfile.NumGpu is not null)
            options["num_gpu"] = inferenceProfile.NumGpu.Value;
        if (inferenceProfile.NumThread is > 0)
            options["num_thread"] = inferenceProfile.NumThread.Value;

        var payload = new
        {
            model,
            messages = new[] { new { role = "user", content = "ping" } },
            stream = false,
            keep_alive = keepAlive,
            options
        };

        var json = JsonSerializer.Serialize(payload, JsonOptions);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/chat", content, ct);

        _logger.LogDebug("Ollama keep-alive ping: model={Model} status={Status}", model, (int)response.StatusCode);
    }

    /// <summary>
    /// On garde chaud le modèle de CHAT (chemin interactif, sensible à la latence), et non le modèle d'import
    /// (qui se préchauffe lui-même à la demande) — cela évite aussi de maintenir un 2ᵉ modèle résident.
    /// Priorité : modèle de chat plateforme → DefaultModel config. Renvoie null si le modèle de chat est cloud
    /// (OpenRouter) : aucun modèle local à garder chaud.
    /// </summary>
    private async Task<OllamaInferenceProfile> ResolveInferenceProfileAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IOllamaInferenceProfileResolver>();
        return await resolver.ResolveForPlatformAsync(cancellationToken);
    }

    private async Task<string?> ResolveKeepAliveModelNameAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var platform = scope.ServiceProvider.GetRequiredService<IPlatformAiSettingsService>();
        var platformChat = await platform.GetDefaultModelRefAsync(cancellationToken);
        var chatRef =
            !string.IsNullOrWhiteSpace(platformChat) ? platformChat
            : !string.IsNullOrWhiteSpace(_settings.DefaultModel) ? _settings.DefaultModel.Trim()
            : null;
        if (string.IsNullOrWhiteSpace(chatRef))
            return null;

        var parsed = ModelRef.Parse(chatRef);
        return parsed.Kind == LlmProviderKind.Ollama && !string.IsNullOrWhiteSpace(parsed.ProviderModelId)
            ? parsed.ProviderModelId
            : null;
    }

    private static string? ExtractOllamaModelId(string modelRef)
    {
        var parsed = ModelRef.Parse(modelRef);
        return string.IsNullOrWhiteSpace(parsed.ProviderModelId) ? modelRef.Trim() : parsed.ProviderModelId;
    }
}
