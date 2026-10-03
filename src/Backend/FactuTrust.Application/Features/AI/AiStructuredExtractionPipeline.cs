using System.Diagnostics;
using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Domain.Common;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.AI;

/// <summary>
/// Demande d'extraction structurée : un fichier + un prompt système décrivant le JSON attendu.
/// Le pipeline ne connaît pas le schéma — il rend le texte brut du LLM, à charge de l'appelant
/// de le désérialiser.
/// </summary>
public sealed record AiStructuredExtractionRequest
{
    public required Stream FileStream { get; init; }
    public required string FileName { get; init; }
    public required string ContentType { get; init; }

    /// <summary>Prompt système décrivant le schéma JSON attendu.</summary>
    public required string SystemPrompt { get; init; }

    /// <summary>Modèle explicite (<c>ollama:…</c> / <c>openrouter:…</c>), sinon résolution par configuration.</summary>
    public string? ModelOverride { get; init; }

    /// <summary>
    /// Code porté par les <see cref="Error.Validation(string, string)"/> renvoyées et préfixe des logs.
    /// L'import de facture du wizard passe « InvoiceImport » afin de conserver ses messages à l'identique.
    /// </summary>
    public string ErrorCode { get; init; } = "AiExtraction";

    public int MaxTextChars { get; init; } = 60_000;

    public int MaxImages { get; init; } = 10;

    /// <summary>Force le chemin vision (repli après échec de parsing JSON sur une image).</summary>
    public bool ForceVision { get; init; }

    /// <summary>Modèle vision explicite (sinon <see cref="IAiStructuredExtractionPipeline.ResolveVisionModelId"/>).</summary>
    public string? VisionModelOverride { get; init; }

    /// <summary>Échec si la vision n'a pas pu être utilisée (pas de repli silencieux vers le modèle texte).</summary>
    public bool RequireVision { get; init; }

    /// <summary>Inclure le texte extrait dans le message utilisateur lorsqu'une image est jointe.</summary>
    public bool IncludeExtractedTextWithImages { get; init; } = true;

    public int? MaxOutputTokens { get; init; }

    public int? LlmTimeoutSeconds { get; init; }

    public int? RenderDpi { get; init; }

    /// <summary>
    /// Schéma JSON contraignant le décodage côté Ollama (clé <c>format</c>). Null = mode
    /// <c>"json"</c> historique. Sans effet sur OpenRouter, et automatiquement abandonné si le
    /// serveur Ollama le rejette. Voir <see cref="Json.LlmOutputSchemas"/>.
    /// </summary>
    public JsonElement? OutputSchema { get; init; }

    /// <summary>
    /// Consigne remplaçant « extrais les données commerciales au format JSON demandé. » dans le
    /// message utilisateur. Null (défaut) : message strictement identique à l'historique.
    /// </summary>
    public string? UserInstruction { get; init; }
}

/// <summary>Résultat brut d'un appel d'extraction structurée, avant désérialisation.</summary>
public sealed record AiStructuredExtractionOutcome(
    string RawContent,
    AiDocumentExtractionResult Extraction,
    bool TextTruncated,
    string? ModelUsed,
    bool VisionUsed,
    int StreamChunkCount,
    long? FirstTokenMs);

/// <summary>
/// Mécanique commune à toutes les extractions documentaires pilotées par un LLM :
/// extraction texte/OCR → décision de repli vision → contrôle de disponibilité du fournisseur →
/// appel one-shot → texte brut.
///
/// Volontairement agnostique du domaine : l'import de facture du wizard de facturation et
/// l'import de pièce comptable partagent ce pipeline et ne diffèrent que par leur prompt et
/// leur désérialisation.
/// </summary>
public interface IAiStructuredExtractionPipeline
{
    Task<Result<AiStructuredExtractionOutcome>> RunAsync(
        AiStructuredExtractionRequest request,
        CancellationToken cancellationToken);

    /// <summary>Résout le modèle d'extraction retenu (utile pour les diagnostics/capacités).</summary>
    Task<ParsedModelRef> ResolveModelRefAsync(string? explicitModel, CancellationToken cancellationToken);

    /// <summary>Identifiant du modèle vision d'import, ou null si aucun n'est configuré.</summary>
    string? ResolveVisionModelId();

    /// <summary>Préchauffage best-effort du modèle d'extraction (et du modèle vision si présent).</summary>
    Task<InvoiceImportWarmUpResult> WarmUpAsync(CancellationToken cancellationToken);
}

/// <inheritdoc cref="IAiStructuredExtractionPipeline"/>
public sealed class AiStructuredExtractionPipeline : IAiStructuredExtractionPipeline
{
    private const int DefaultImportMaxOutputTokens = 1536;

    private readonly IOllamaClient _ollamaClient;
    private readonly IOpenAiChatCompletionsClient _openAiClient;
    private readonly ICursorAgentClient? _cursorAgentClient;
    private readonly IAiDocumentTextExtractor _documentTextExtractor;
    private readonly IOllamaModelReadinessChecker _readinessChecker;
    private readonly IPlatformAiSettingsService _platformAiSettings;
    private readonly IModalCredentialsResolver _modalCredentials;
    private readonly ITenantContext _tenantContext;
    private readonly IOllamaInferenceProfileResolver _inferenceProfileResolver;
    private readonly ILogger<AiStructuredExtractionPipeline> _logger;
    private readonly OllamaSettings _ollamaSettings;
    private readonly CursorSdkSettings _cursorSdkSettings;

    public AiStructuredExtractionPipeline(
        IOllamaClient ollamaClient,
        IOpenAiChatCompletionsClient openAiClient,
        IAiDocumentTextExtractor documentTextExtractor,
        IOllamaModelReadinessChecker readinessChecker,
        IPlatformAiSettingsService platformAiSettings,
        IOllamaInferenceProfileResolver inferenceProfileResolver,
        ILogger<AiStructuredExtractionPipeline> logger,
        IOptions<OllamaSettings> ollamaSettings,
        IModalCredentialsResolver modalCredentials,
        ITenantContext tenantContext,
        ICursorAgentClient? cursorAgentClient = null,
        IOptions<CursorSdkSettings>? cursorSdkSettings = null)
    {
        _ollamaClient = ollamaClient;
        _openAiClient = openAiClient;
        _cursorAgentClient = cursorAgentClient;
        _documentTextExtractor = documentTextExtractor;
        _readinessChecker = readinessChecker;
        _platformAiSettings = platformAiSettings;
        _inferenceProfileResolver = inferenceProfileResolver;
        _logger = logger;
        _ollamaSettings = ollamaSettings.Value;
        _modalCredentials = modalCredentials;
        _tenantContext = tenantContext;
        _cursorSdkSettings = cursorSdkSettings?.Value ?? new CursorSdkSettings();
    }

    public async Task<Result<AiStructuredExtractionOutcome>> RunAsync(
        AiStructuredExtractionRequest request,
        CancellationToken cancellationToken)
    {
        var code = request.ErrorCode;

        // 1. Résolution du modèle texte (JSON structuré).
        var modelRef = await ResolveModelRefAsync(request.ModelOverride, cancellationToken);
        var visionModelId = !string.IsNullOrWhiteSpace(request.VisionModelOverride)
            ? request.VisionModelOverride.Trim()
            : ResolveVisionModelId();
        var wantPrimaryVision = AiModelCapabilityDetector.DetectVisionSupport(modelRef);

        // 2. Extraction du texte (+ image base64 pour fallback vision sur photos et scans).
        var hasVisionModel = !string.IsNullOrWhiteSpace(visionModelId);
        var renderDpi = request.RenderDpi is > 0
            ? Math.Clamp(request.RenderDpi.Value, 72, 300)
            : 200;
        var extractionSw = Stopwatch.StartNew();
        var extraction = await _documentTextExtractor.ExtractAsync(
            request.FileStream,
            request.FileName,
            request.ContentType,
            new AiDocumentExtractOptions
            {
                // Rendu complet des pages : modèle principal multimodal, ou 2ᵉ passe explicitement
                // forcée après une réponse inexploitable.
                RenderPagesAsImages = wantPrimaryVision || (request.ForceVision && hasVisionModel),
                RenderDpi = renderDpi,

                // Récupération gratuite des pages scannées que l'OCR a déjà dû rasteriser : sans
                // cela un PDF scanné n'expose aucune image et ne peut jamais basculer en vision.
                KeepOcrRenderedImages = hasVisionModel
            },
            cancellationToken);

        if (!extraction.Success)
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(
                code, extraction.ErrorMessage ?? "Le fichier n'a pas pu être lu."));

        var sourceImages = extraction.Pages
            .Select(p => p.ImageBase64)
            .Where(b => !string.IsNullOrWhiteSpace(b))
            .Select(b => b!)
            .Take(request.MaxImages)
            .ToList();

        var extractedText = (extraction.Text ?? string.Empty).Trim();
        var ocrQuality = InvoiceImportOcrQuality.Score(extractedText);
        var useVisionFallback = InvoiceImportVisionPolicy.ShouldUseVisionFallback(
            _ollamaSettings,
            request.ForceVision,
            extraction,
            extractedText,
            sourceImages.Count,
            visionModelId);

        if (extractedText.Length == 0 && sourceImages.Count == 0)
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(
                code, "Aucun contenu exploitable n'a été trouvé dans le fichier."));

        if (extractedText.Length == 0 && !useVisionFallback)
        {
            if (request.RequireVision)
            {
                return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                    "La lecture vision est requise mais aucune image exploitable n'a été produite."));
            }

            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                "Photo illisible : OCR vide et aucun modèle vision d'import configuré (clé InvoiceImportVisionModel, ex. gemma3:4b). "
                + "Exécutez scripts/install-tessdata.ps1 ou contactez l'administrateur plateforme."));
        }

        if (request.RequireVision && !useVisionFallback)
        {
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                "La lecture vision est requise mais le modèle vision n'a pas pu être utilisé."));
        }

        var textTruncated = extraction.Truncated;
        if (extractedText.Length > request.MaxTextChars)
        {
            extractedText = extractedText[..request.MaxTextChars];
            textTruncated = true;
        }

        extractionSw.Stop();
        _logger.LogInformation(
            "[{Scope}] Extraction terminée en {ElapsedMs} ms : format={Format} ocr={Ocr} caractères={Chars} "
            + "ocrQuality={OcrQuality:F2} sourceImages={ImageCount} visionFallback={VisionFallback}",
            code, extractionSw.ElapsedMilliseconds, extraction.Format, extraction.OcrApplied, extractedText.Length,
            ocrQuality, sourceImages.Count, useVisionFallback);

        // 3. Disponibilité du fournisseur IA (modèle texte ou vision selon le chemin).
        var activeModelRef = modelRef;
        var llmImages = wantPrimaryVision ? sourceImages : new List<string>();

        if (useVisionFallback)
        {
            activeModelRef = NormalizeModelRef(visionModelId!);
            llmImages = sourceImages;
        }

        var providerError = await EnsureProviderAvailableAsync(activeModelRef, code, useVisionFallback, cancellationToken);
        if (providerError is not null)
            return providerError;

        // 4. Appel LLM one-shot (texte seul ou vision hybride).
        // Le schéma de sortie ne concerne qu'Ollama et n'est tenté que si l'appelant en fournit un.
        var useSchema = request.OutputSchema is not null
            && activeModelRef.Kind == LlmProviderKind.Ollama
            && _ollamaSettings.UseStructuredOutputSchema;

        var llmSw = Stopwatch.StartNew();
        string raw;
        int chunkCount;
        long? firstTokenMs;

        try
        {
            var promptText = useVisionFallback && !request.IncludeExtractedTextWithImages ? string.Empty : extractedText;
            (raw, chunkCount, firstTokenMs) = await CallLlmAsync(
                activeModelRef, request.SystemPrompt, promptText, llmImages, code,
                useSchema ? request.OutputSchema : null, cancellationToken, request.UserInstruction,
                request.MaxOutputTokens, request.LlmTimeoutSeconds);
        }
        catch (OllamaRequestException ex) when (useSchema && IsSchemaRejection(ex))
        {
            // Ollama < 0.5 (ou un moteur compatible) ne connaît pas les schémas : on retombe sur
            // le mode "json" historique plutôt que de faire échouer l'import.
            _logger.LogWarning(
                "[{Scope}] Le moteur IA a rejeté le schéma de sortie structurée (status={Status}) ; "
                + "repli sur format=\"json\". Désactivez « UseStructuredOutputSchema » pour éviter cet aller-retour.",
                code, ex.HttpStatusCode);

            var promptText = useVisionFallback && !request.IncludeExtractedTextWithImages ? string.Empty : extractedText;
            (raw, chunkCount, firstTokenMs) = await CallLlmAsync(
                activeModelRef, request.SystemPrompt, promptText, llmImages, code,
                outputSchema: null, cancellationToken, request.UserInstruction,
                request.MaxOutputTokens, request.LlmTimeoutSeconds);
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code, ex.Message));
        }

        llmSw.Stop();

        if (string.IsNullOrWhiteSpace(raw))
        {
            _logger.LogWarning(
                "[{Scope}] Appel LLM sans contenu en {ElapsedMs} ms : modèle={Model} chunks={Chunks} firstTokenMs={FirstTokenMs}",
                code, llmSw.ElapsedMilliseconds, modelRef.ProviderModelId, chunkCount, firstTokenMs);
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                "L'IA n'a renvoyé aucune donnée (modèle surchargé ou mémoire insuffisante). "
                + "Réessayez ou configurez un modèle d'import plus léger dans les paramètres plateforme."));
        }

        _logger.LogInformation(
            "[{Scope}] Appel LLM terminé en {ElapsedMs} ms : modèle={Model} usedVision={UsedVision} caractères={Chars} "
            + "chunks={Chunks} firstTokenMs={FirstTokenMs}",
            code, llmSw.ElapsedMilliseconds, activeModelRef.ProviderModelId, useVisionFallback, raw.Length,
            chunkCount, firstTokenMs);

        return Result.Success(new AiStructuredExtractionOutcome(
            raw,
            extraction,
            textTruncated,
            activeModelRef.ProviderModelId,
            useVisionFallback,
            chunkCount,
            firstTokenMs));
    }

    // ========================================================================
    // Préchauffage & résolution du modèle
    // ========================================================================

    public async Task<InvoiceImportWarmUpResult> WarmUpAsync(CancellationToken cancellationToken)
    {
        var modelRef = await ResolveModelRefAsync(null, cancellationToken);
        if (modelRef.Kind != LlmProviderKind.Ollama || string.IsNullOrWhiteSpace(modelRef.ProviderModelId))
        {
            return new InvoiceImportWarmUpResult(true, true, modelRef.ProviderModelId, null, null, null);
        }

        var modelName = modelRef.ProviderModelId;
        var readiness = await _readinessChecker.CheckAsync(modelName, cancellationToken);
        if (!readiness.IsReady)
        {
            return new InvoiceImportWarmUpResult(
                true,
                false,
                modelName,
                readiness.UserMessage,
                readiness.RequiredGiB,
                readiness.AvailableGiB);
        }

        try
        {
            var keepAlive = $"{Math.Clamp(_ollamaSettings.KeepAliveMinutes, 1, 1440)}m";
            var inferenceProfile = await _inferenceProfileResolver.ResolveForPlatformAsync(cancellationToken);
            var ok = await _ollamaClient.WarmUpModelAsync(
                modelName,
                keepAlive,
                cancellationToken,
                inferenceProfile: inferenceProfile);
            if (!ok)
            {
                return new InvoiceImportWarmUpResult(
                    true,
                    false,
                    modelName,
                    "Le préchauffage du modèle IA a échoué. L'import peut être plus long.",
                    readiness.RequiredGiB,
                    readiness.AvailableGiB);
            }

            await WarmUpVisionModelBestEffortAsync(keepAlive, inferenceProfile, cancellationToken);
            return new InvoiceImportWarmUpResult(true, true, modelName, null, readiness.RequiredGiB, readiness.AvailableGiB);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Import IA : préchauffage du modèle échoué pour {Model}", modelName);
            return new InvoiceImportWarmUpResult(
                true,
                false,
                modelName,
                "Le préchauffage du modèle IA a échoué. L'import peut être plus long.",
                readiness.RequiredGiB,
                readiness.AvailableGiB);
        }
    }

    private async Task WarmUpVisionModelBestEffortAsync(
        string keepAlive,
        OllamaInferenceProfile inferenceProfile,
        CancellationToken cancellationToken)
    {
        var visionId = ResolveVisionModelId();
        if (string.IsNullOrWhiteSpace(visionId))
            return;

        try
        {
            var readiness = await _readinessChecker.CheckAsync(visionId, cancellationToken);
            if (readiness.IsReady)
            {
                await _ollamaClient.WarmUpModelAsync(
                    visionId,
                    keepAlive,
                    cancellationToken,
                    inferenceProfile: inferenceProfile);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Import IA : préchauffage modèle vision {Model} ignoré", visionId);
        }
    }

    /// <summary>
    /// Résout le modèle à utiliser : modèle explicite de la commande, sinon le modèle d'import
    /// configuré au niveau plateforme, sinon <see cref="OllamaSettings.InvoiceImportModel"/>,
    /// sinon <see cref="OllamaSettings.DefaultModel"/>.
    /// </summary>
    public async Task<ParsedModelRef> ResolveModelRefAsync(string? explicitModel, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(explicitModel))
            return NormalizeModelRef(explicitModel.Trim());

        try
        {
            var platformImport = await _platformAiSettings.GetInvoiceImportModelRefAsync(cancellationToken);
            if (ImportAiModelResolver.TryResolvePlatformImportModel(platformImport, _logger, out var platformModel))
                return platformModel;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Import IA : lecture du modèle d'import plateforme impossible ; utilisation de la configuration serveur.");
        }

        return ImportAiModelResolver.ResolveServerImportModel(_ollamaSettings);
    }

    public string? ResolveVisionModelId()
    {
        var model = _ollamaSettings.InvoiceImportVisionModel?.Trim();
        return string.IsNullOrWhiteSpace(model) ? null : model;
    }

    private static ParsedModelRef NormalizeModelRef(string model)
    {
        var modelRef = ModelRef.Parse(model);
        if (string.IsNullOrEmpty(modelRef.CanonicalModelRef))
            modelRef = ModelRef.Parse($"{ModelRef.OllamaPrefix}{model}");
        return modelRef;
    }

    private int ResolveImportMaxOutputTokens(int? overrideTokens)
    {
        if (overrideTokens is > 0)
        {
            var maxCtxHalf = _ollamaSettings.NumCtx > 0 ? _ollamaSettings.NumCtx / 2 : 8192;
            return Math.Clamp(overrideTokens.Value, 256, Math.Min(8192, maxCtxHalf));
        }

        return Math.Clamp(
            _ollamaSettings.ImportMaxOutputTokens > 0
                ? _ollamaSettings.ImportMaxOutputTokens
                : DefaultImportMaxOutputTokens,
            256,
            3072);
    }

    private TimeSpan ResolveImportLlmTimeout(int? overrideSeconds) =>
        TimeSpan.FromSeconds(Math.Clamp(
            overrideSeconds ?? _ollamaSettings.ImportLlmTimeoutSeconds,
            30,
            600));

    // ========================================================================
    // Appel LLM
    // ========================================================================

    private async Task<Result<AiStructuredExtractionOutcome>?> EnsureProviderAvailableAsync(
        ParsedModelRef modelRef,
        string code,
        bool isVisionFallback,
        CancellationToken cancellationToken)
    {
        switch (modelRef.Kind)
        {
            case LlmProviderKind.Ollama:
                if (!await _ollamaClient.IsAvailableAsync(cancellationToken))
                    return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                        "Le moteur IA InstaFact est indisponible. Vérifiez que le service est démarré sur le serveur."));

                var readiness = await _readinessChecker.CheckAsync(modelRef.ProviderModelId!, cancellationToken);
                if (!readiness.IsReady)
                    return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                        readiness.UserMessage ?? (isVisionFallback
                            ? "Le modèle vision d'import IA n'est pas prêt."
                            : "Le modèle d'import IA n'est pas prêt.")));
                return null;

            case LlmProviderKind.OpenRouter:
            {
                var credentials = await _platformAiSettings.GetOpenRouterCredentialsAsync(cancellationToken);
                if (string.IsNullOrEmpty(credentials.ApiKey))
                    return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                        "Aucune clé API OpenRouter configurée. Configurez-la dans le back-office plateforme > Configuration IA (OpenRouter)."));
                return null;
            }

            case LlmProviderKind.Modal:
            {
                var credentials = await _modalCredentials.ResolveAsync(_tenantContext.TenantId, cancellationToken);
                if (string.IsNullOrEmpty(credentials.ApiKey) || string.IsNullOrWhiteSpace(credentials.BaseUrl))
                    return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                        ModalCredentialMessages.Unavailable(credentials)));
                return null;
            }

            case LlmProviderKind.Cursor:
                if (!_cursorSdkSettings.Enabled)
                    return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                        "Cursor SDK est désactivé sur le serveur (CursorSdk:Enabled=false)."));
                var cursorCreds = await _platformAiSettings.GetCursorCredentialsAsync(cancellationToken);
                if (string.IsNullOrEmpty(cursorCreds.ApiKey))
                    return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                        "Aucune clé API Cursor configurée. Configurez-la dans le back-office plateforme > Configuration IA (Cursor)."));
                if (_cursorAgentClient is null || !await _cursorAgentClient.IsAvailableAsync(cancellationToken))
                    return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                        "Le pont Cursor SDK est indisponible. Vérifiez Node 22.13+ et `npm ci` dans CursorSdkBridge."));
                return null;

            default:
                return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation(code,
                    $"Fournisseur LLM non géré : {modelRef.Kind}."));
        }
    }

    /// <summary>
    /// Vrai quand l'erreur Ollama traduit un schéma de sortie non supporté (moteur antérieur à 0.5)
    /// plutôt qu'une panne réelle : seul ce cas justifie de retenter sans schéma.
    /// </summary>
    private static bool IsSchemaRejection(OllamaRequestException ex) =>
        ex.HttpStatusCode is 400 or 422 or 500;

    private async Task<(string Raw, int ChunkCount, long? FirstTokenMs)> CallLlmAsync(
        ParsedModelRef modelRef,
        string systemPrompt,
        string text,
        List<string> images,
        string scope,
        JsonElement? outputSchema,
        CancellationToken cancellationToken,
        string? userInstruction = null,
        int? maxOutputTokens = null,
        int? llmTimeoutSeconds = null)
    {
        var sb = new StringBuilder();
        var userPrompt = BuildUserPrompt(text, images.Count > 0, userInstruction);
        var outputCap = Math.Min(Math.Max(1, _ollamaSettings.MaxTokens), ResolveImportMaxOutputTokens(maxOutputTokens));
        var streamTimeout = ResolveImportLlmTimeout(llmTimeoutSeconds);
        var chunkCount = 0;
        long? firstTokenMs = null;
        var llmSw = Stopwatch.StartNew();

        switch (modelRef.Kind)
        {
        case LlmProviderKind.Ollama:
        {
            var messages = new List<OllamaChatMessage>
            {
                new() { Role = "system", Content = systemPrompt },
                new()
                {
                    Role = "user",
                    Content = userPrompt,
                    Images = images.Count > 0 ? images : null
                }
            };

            var numCtx = InvoiceImportParsing.ResolveImportNumCtx(
                _ollamaSettings.NumCtx,
                systemPrompt.Length + userPrompt.Length,
                outputCap,
                images.Count > 0);
            var inferenceProfile = await _inferenceProfileResolver.ResolveForPlatformAsync(cancellationToken);
            var options = inferenceProfile.ApplyTo(new OllamaOptions
            {
                Temperature = 0,
                NumPredict = outputCap,
                NumCtx = numCtx
            });

            var request = new OllamaChatRequest
            {
                Model = modelRef.ProviderModelId,
                Messages = messages,
                Stream = true,
                // Schéma quand l'appelant en fournit un (contraint les TYPES), sinon le mode "json"
                // historique (ne contraint que la syntaxe).
                Format = outputSchema.HasValue ? outputSchema.Value : LlmOutputSchemas.PlainJson,
                KeepAlive = $"{Math.Clamp(_ollamaSettings.KeepAliveMinutes, 1, 1440)}m",
                Options = options
            };

            _logger.LogInformation(
                "[{Scope}] Appel LLM Ollama : modèle={Model} numCtx={NumCtx} numPredict={NumPredict} images={ImageCount} timeoutSec={TimeoutSec} inference_device={InferenceDevice} num_gpu_effective={NumGpuEffective} schémaStructuré={StructuredSchema}",
                scope,
                modelRef.ProviderModelId,
                numCtx,
                outputCap,
                images.Count,
                (int)streamTimeout.TotalSeconds,
                inferenceProfile.Device,
                inferenceProfile.NumGpu,
                outputSchema.HasValue);

            await foreach (var chunk in _ollamaClient.StreamChatAsync(request, cancellationToken, streamTimeout))
            {
                chunkCount++;
                if (!string.IsNullOrEmpty(chunk.Message?.Content))
                {
                    firstTokenMs ??= llmSw.ElapsedMilliseconds;
                    sb.Append(chunk.Message.Content);
                }
            }

            break;
        }
        case LlmProviderKind.OpenRouter:
        case LlmProviderKind.Modal:
        {
            string baseUrl;
            string apiKey;
            OpenAiCompatibleCallOptions? options = null;
            if (modelRef.Kind == LlmProviderKind.Modal)
            {
                var modal = await _modalCredentials.ResolveAsync(_tenantContext.TenantId, cancellationToken);
                baseUrl = modal.BaseUrl;
                apiKey = modal.ApiKey!;
                options = OpenAiCompatibleCallOptions.ForModal(new ModalSettings(), sessionId: null);
            }
            else
            {
                var openRouter = await _platformAiSettings.GetOpenRouterCredentialsAsync(cancellationToken);
                baseUrl = openRouter.BaseUrl;
                apiKey = openRouter.ApiKey!;
            }

            var messages = new List<OpenAiChatMessagePayload>
            {
                new() { Role = "system", Content = systemPrompt },
                BuildOpenAiUserMessage(text, images, userInstruction)
            };

            _logger.LogInformation(
                "[{Scope}] Appel LLM {Provider} : modèle={Model} maxTokens={MaxTokens} images={ImageCount}",
                scope,
                modelRef.Kind,
                modelRef.ProviderModelId,
                outputCap,
                images.Count);

            await foreach (var chunk in _openAiClient.StreamChatAsOllamaCompatibleAsync(
                               baseUrl,
                               apiKey,
                               modelRef.ProviderModelId,
                               messages,
                               Array.Empty<OllamaToolDefinition>(),
                               0d,
                               outputCap,
                               cancellationToken,
                               seed: null,
                               options))
            {
                chunkCount++;
                if (!string.IsNullOrEmpty(chunk.Message?.Content))
                {
                    firstTokenMs ??= llmSw.ElapsedMilliseconds;
                    sb.Append(chunk.Message.Content);
                }
            }

            break;
        }
        case LlmProviderKind.Cursor:
        {
            if (_cursorAgentClient is null)
                throw new InvalidOperationException("Le pont Cursor SDK n'est pas configuré.");

            var cursorCreds = await _platformAiSettings.GetCursorCredentialsAsync(cancellationToken);
            if (string.IsNullOrEmpty(cursorCreds.ApiKey))
                throw new InvalidOperationException(
                    "Aucune clé API Cursor configurée. Configurez-la dans le back-office plateforme > Configuration IA (Cursor).");

            var scratch = Path.Combine(AppContext.BaseDirectory, "App_Data", "cursor-scratch", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(scratch);
            try
            {
                _logger.LogInformation(
                    "[{Scope}] Appel LLM Cursor : modèle={Model} images={ImageCount}",
                    scope, modelRef.ProviderModelId, images.Count);

                var extracted = await _cursorAgentClient.ExtractAsync(
                    new CursorExtractRequest(
                        cursorCreds.ApiKey,
                        modelRef,
                        systemPrompt,
                        userPrompt,
                        CursorToolSpecMapper.FromBase64List(images),
                        scratch),
                    cancellationToken);
                if (!string.IsNullOrEmpty(extracted))
                {
                    firstTokenMs ??= llmSw.ElapsedMilliseconds;
                    sb.Append(extracted);
                    chunkCount = 1;
                }
            }
            finally
            {
                try
                {
                    if (Directory.Exists(scratch))
                        Directory.Delete(scratch, recursive: true);
                }
                catch
                {
                    // best-effort
                }
            }

            break;
        }
        default:
            throw new InvalidOperationException($"Fournisseur LLM non géré : {modelRef.Kind}.");
        }

        return (sb.ToString(), chunkCount, firstTokenMs);
    }

    internal static string BuildUserPrompt(string text, bool hasImages, string? userInstruction = null)
    {
        var intro = hasImages
            ? "Analyse le document (image jointe"
            : "Analyse le document suivant";
        if (hasImages && !string.IsNullOrWhiteSpace(text))
            intro += " et texte OCR ci-dessous";
        else if (hasImages)
            intro += " uniquement";
        intro += string.IsNullOrWhiteSpace(userInstruction)
            ? ") et extrais les données commerciales au format JSON demandé.\n\n"
            : ") et " + userInstruction.Trim() + "\n\n";

        if (string.IsNullOrWhiteSpace(text))
            return intro;

        return intro
            + "--- DÉBUT DU CONTENU OCR ---\n"
            + text
            + "\n--- FIN DU CONTENU OCR ---";
    }

    private static OpenAiChatMessagePayload BuildOpenAiUserMessage(string text, List<string> images, string? userInstruction = null)
    {
        var prompt = BuildUserPrompt(text, images.Count > 0, userInstruction);
        if (images.Count == 0)
            return new OpenAiChatMessagePayload { Role = "user", Content = prompt };

        var parts = new List<OpenAiContentPart> { new() { Type = "text", Text = prompt } };
        foreach (var b64 in images)
        {
            parts.Add(new OpenAiContentPart
            {
                Type = "image_url",
                ImageUrl = new OpenAiImageUrl { Url = "data:image/png;base64," + b64 }
            });
        }
        return new OpenAiChatMessagePayload { Role = "user", Content = parts };
    }
}
