using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Logging;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common.SqlReport;
using FactuTrust.Domain.Entities.AI;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.AI.Commands;

public sealed record SendChatMessageCommand(
    Guid? ConversationId,
    string Message,
    // Déprécié — ignoré : le modèle est résolu depuis la configuration du tenant (back-office).
    string? Model = null,
    ChatUiContextDto? UiContext = null,
    ChatRequestOptionsDto? Options = null,
    IReadOnlyList<ChatAttachmentInput>? Attachments = null);

public sealed class SendChatMessageHandler
{
    private readonly IOllamaClient _ollamaClient;
    private readonly IOllamaGenerationGate _ollamaGenerationGate;
    private readonly IOpenAiChatCompletionsClient _openAiClient;
    private readonly ICursorAgentClient _cursorAgentClient;
    private readonly ICursorToolRunRegistry _cursorToolRuns;
    private readonly ITenantContext _tenantContext;
    private readonly IPlatformAiSettingsService _platformAiSettings;
    private readonly IModalCredentialsResolver _modalCredentials;
    private readonly IOllamaInferenceProfileResolver _inferenceProfileResolver;
    private readonly IAiToolExecutor _toolExecutor;
    private readonly IAiToolExecutorScopeFactory _toolExecutorScopeFactory;
    private readonly IAiContextBuilder _contextBuilder;
    private readonly AiVolatileContextFormatter _volatileContextFormatter;
    private readonly AiScreenAnalysisEnricher _screenAnalysisEnricher;
    private readonly IConversationRepository _conversationRepository;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<SendChatMessageHandler> _logger;
    private readonly OllamaSettings _ollamaSettings;
    private readonly ScreenAnalysisOptions _screenAnalysisOptions;
    private readonly CursorSdkSettings _cursorSdkSettings;
    private readonly ModalSettings _modalSettings;

    private static readonly JsonSerializerOptions SourcesJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    /// <summary>Raisons de repli du modèle avancé Studio (contrat SSE <c>meta.advancedModelFallbackReason</c>, D3).</summary>
    public const string StudioAdvancedFallbackDisabled = "disabled";
    public const string StudioAdvancedFallbackNotConfigured = "not_configured";
    public const string StudioAdvancedFallbackUnavailable = "unavailable";

    /// <summary>Graine Ollama appliquée en mode StudioBuilder quand aucune graine globale n'est configurée.</summary>
    public const int StudioDefaultSeed = 7;

    private readonly TimeProvider _timeProvider;

    /// <summary>
    /// Consigne accompagnant le raccourci d'état : le résultat est DÉJÀ dans la conversation, le
    /// modèle ne doit ni rappeler d'outil, ni recalculer, ni inventer un chiffre. Aucun nom d'outil
    /// en snake_case (la garde anti-fuite n'a jamais à intervenir).
    /// </summary>
    private const string StudioReportShortcutPromptSuffix =
        "ÉTAT DÉJÀ CALCULÉ : l'état demandé a DÉJÀ été exécuté — son résultat complet est dans la "
        + "conversation, et il est affiché à l'utilisateur sous forme de tableau. "
        + "Présente-le en français en 2 à 4 phrases : ce qui est mesuré, la période retenue, et les "
        + "1 à 3 enseignements les plus nets (la ligne de tête, un écart marquant). "
        + "Reprends les chiffres du résultat SANS EN INVENTER AUCUN et n'appelle AUCUN outil. "
        + "Termine en proposant d'affiner la période ou de l'enregistrer comme état réutilisable.";

    /// <summary>
    /// Filet anti-silence du mode Studio, employé UNIQUEMENT quand la demande ne ressemble pas à une
    /// demande d'état (sinon <c>StudioTextToolCallRecovery.ReformulateReportMessage</c> prend le relais).
    /// </summary>
    private const string StudioBuilderSilenceFallback =
        "Je n'ai pas réussi à créer ce système. Reformulez votre demande en décrivant les tables et "
        + "leurs champs (ex. « table Employés avec nom, poste ; table Congés avec employé, dates, statut »).";

    public SendChatMessageHandler(
        IOllamaClient ollamaClient,
        IOllamaGenerationGate ollamaGenerationGate,
        IOpenAiChatCompletionsClient openAiClient,
        ICursorAgentClient cursorAgentClient,
        ICursorToolRunRegistry cursorToolRuns,
        ITenantContext tenantContext,
        IPlatformAiSettingsService platformAiSettings,
        IModalCredentialsResolver modalCredentials,
        IOllamaInferenceProfileResolver inferenceProfileResolver,
        IAiToolExecutor toolExecutor,
        IAiToolExecutorScopeFactory toolExecutorScopeFactory,
        IAiContextBuilder contextBuilder,
        AiVolatileContextFormatter volatileContextFormatter,
        AiScreenAnalysisEnricher screenAnalysisEnricher,
        IConversationRepository conversationRepository,
        ICurrentUser currentUser,
        ILogger<SendChatMessageHandler> logger,
        IOptions<OllamaSettings> ollamaSettings,
        IOptions<ScreenAnalysisOptions> screenAnalysisOptions,
        IOptions<CursorSdkSettings> cursorSdkSettings,
        // Horloge unique pour la résolution de période du raccourci d'état. Optionnelle pour ne pas
        // casser les constructions existantes ; la DI injecte le TimeProvider enregistré.
        TimeProvider? timeProvider = null,
        IOptions<ModalSettings>? modalSettings = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _ollamaClient = ollamaClient;
        _ollamaGenerationGate = ollamaGenerationGate;
        _openAiClient = openAiClient;
        _cursorAgentClient = cursorAgentClient;
        _cursorToolRuns = cursorToolRuns;
        _tenantContext = tenantContext;
        _platformAiSettings = platformAiSettings;
        _modalCredentials = modalCredentials;
        _inferenceProfileResolver = inferenceProfileResolver;
        _toolExecutor = toolExecutor;
        _toolExecutorScopeFactory = toolExecutorScopeFactory;
        _contextBuilder = contextBuilder;
        _volatileContextFormatter = volatileContextFormatter;
        _screenAnalysisEnricher = screenAnalysisEnricher;
        _conversationRepository = conversationRepository;
        _currentUser = currentUser;
        _logger = logger;
        _ollamaSettings = ollamaSettings.Value;
        _screenAnalysisOptions = screenAnalysisOptions.Value;
        _cursorSdkSettings = cursorSdkSettings.Value;
        _modalSettings = modalSettings?.Value ?? new ModalSettings();
    }

    public async IAsyncEnumerable<ChatStreamEvent> HandleAsync(
        SendChatMessageCommand command,
        Guid userId,
        string? correlationId = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var total = Stopwatch.StartNew();

        void LogPhase(string phase, long elapsedMs) =>
            _logger.LogInformation(
                "AI chat {CorrelationId} phase={Phase} elapsed_ms={ElapsedMs}",
                correlationId ?? "-", phase, elapsedMs);

        var sw = Stopwatch.StartNew();

        var defaultModel = string.IsNullOrWhiteSpace(_ollamaSettings.DefaultModel)
            ? "mistral"
            : _ollamaSettings.DefaultModel.Trim();

        var assistantMode = AssistantModeResolver.Resolve(command);
        var screenId = AiScreenAnalysisModeDetector.ResolveScreenId(command.UiContext);
        // Scope effectif (prompt + catalogue) : uniquement en mode Default et si le kill-switch est actif.
        var agentScope = AssistantModeResolver.ResolveAgentScope(command, assistantMode, _ollamaSettings.EnableAgentScopes);
        // Scope demandé par le client : stampé sur la conversation à sa création (classement par historique),
        // même quand le mode courant (ex. ScreenAnalysis) ignore le scope pour le prompt et les outils.
        var requestedAgentScope = !_ollamaSettings.EnableAgentScopes
            ? AssistantAgentScope.None
            : command.Options?.AgentScope is { } reqScope && Enum.IsDefined(reqScope)
                ? reqScope
                : AssistantAgentScope.None;

        if (_currentUser.IsAccountingFirmDelegatedContext)
        {
            requestedAgentScope = FirmDelegatedAiScopePolicy.ResolveAllowedScope(true, requestedAgentScope);
            agentScope = FirmDelegatedAiScopePolicy.ResolveAllowedScope(true, agentScope);
        }

        // Lectures Master séquentielles : GetDefault + GetStudio partagent le MasterDbContext scoped.
        // Un Task.WhenAll sur cache miss déclenche « A second operation was started on this context… ».
        var isStudioBuilder = assistantMode == AssistantMode.StudioBuilder;
        var assistantConfigured = await _platformAiSettings.GetDefaultModelRefAsync(cancellationToken);
        string? studioConfigured = isStudioBuilder
            ? await _platformAiSettings.GetStudioAiModelRefAsync(cancellationToken)
            : null;

        // Modèle avancé Studio par requête (PR 1.2, décision D3) : lecture Master séquentielle, uniquement
        // si l'atelier le demande ET que le drapeau est actif. Toute impossibilité ⇒ repli SILENCIEUX sur
        // le modèle standard, signalé par l'événement SSE `meta` — jamais une erreur.
        string? studioAdvancedConfigured = null;
        string? advancedFallbackReason = null;
        if (isStudioBuilder && command.Options?.UseAdvancedModel == true)
        {
            if (!_ollamaSettings.EnableStudioAiAdvancedModel)
                advancedFallbackReason = StudioAdvancedFallbackDisabled;
            else
            {
                studioAdvancedConfigured = await _platformAiSettings.GetStudioAiAdvancedModelRefAsync(cancellationToken);
                if (string.IsNullOrWhiteSpace(studioAdvancedConfigured))
                    advancedFallbackReason = StudioAdvancedFallbackNotConfigured;
            }
        }
        var useAdvanced = !string.IsNullOrWhiteSpace(studioAdvancedConfigured);
        if (advancedFallbackReason is not null)
        {
            _logger.LogWarning(
                "AI chat {CorrelationId} Studio advanced model requested but {Reason}; falling back to the standard model",
                correlationId ?? "-", advancedFallbackReason);
        }

        var studioPromptOptions = isStudioBuilder
            ? new StudioPromptOptions(useAdvanced, command.Options?.StudioIntent, _tenantContext.TenantId ?? Guid.Empty, userId.ToString())
            : null;

        // Prompt + historique : factories tenant (contextes distincts) — parallèle sûr.
        var systemPromptTask = _contextBuilder.BuildSystemPromptAsync(assistantMode, screenId, agentScope, studioPromptOptions, cancellationToken);

        Task<Conversation?>? conversationLoadTask = null;
        if (command.ConversationId.HasValue)
        {
            var loadLimit = _ollamaSettings.LoadPartialConversationMessages
                ? Math.Max(1, _ollamaSettings.MaxContextMessages + Math.Max(0, _ollamaSettings.ConversationLoadMessageSlack))
                : 0;
            // Filtre par propriétaire dans la requête (IDOR) : une conversation d'un autre utilisateur
            // retourne null, identique à un identifiant inexistant (même exception ci-dessous).
            conversationLoadTask = loadLimit > 0
                ? _conversationRepository.GetByIdForChatAsync(command.ConversationId.Value, userId, loadLimit, cancellationToken)
                : _conversationRepository.GetByIdForUserAsync(command.ConversationId.Value, userId, cancellationToken);
        }

        await Task.WhenAll(
            systemPromptTask,
            conversationLoadTask ?? Task.FromResult<Conversation?>(null));

        Conversation? existing = conversationLoadTask is not null ? await conversationLoadTask : null;
        if (command.ConversationId.HasValue && existing is null)
            throw new KeyNotFoundException($"Conversation {command.ConversationId} introuvable.");

        // Le modèle est imposé par la configuration globale de la plateforme (back-office) ;
        // le modèle éventuellement transmis par le client et celui de la conversation sont ignorés.
        // StudioBuilder : StudioAiModelRef → Ollama:StudioAiModel → DefaultModelRef → DefaultModel.
        string rawModel;
        if (isStudioBuilder)
        {
            if (!string.IsNullOrWhiteSpace(studioConfigured))
                rawModel = studioConfigured;
            else if (!string.IsNullOrWhiteSpace(_ollamaSettings.StudioAiModel))
                rawModel = _ollamaSettings.StudioAiModel.Trim();
            else
                rawModel = string.IsNullOrWhiteSpace(assistantConfigured) ? defaultModel : assistantConfigured;
        }
        else
        {
            rawModel = string.IsNullOrWhiteSpace(assistantConfigured) ? defaultModel : assistantConfigured;
        }

        // Modèle standard toujours résolu : c'est le modèle du tour, ou celui du repli D3 si le modèle
        // avancé Studio (demandé et configuré) se révèle indisponible ci-dessous.
        var standardModelRef = ParseModelRefOrDefault(rawModel, defaultModel);
        var modelRef = useAdvanced ? ParseModelRefOrDefault(studioAdvancedConfigured!, defaultModel) : standardModelRef;

        // Disponibilité du fournisseur. Boucle à deux tours au plus : si le modèle AVANCÉ Studio est
        // indisponible (moteur arrêté, modèle non installé, clé absente…), on retombe sur le modèle
        // standard et on revérifie — décision D3 : jamais d'erreur pour un repli.
        while (true)
        {
            sw.Restart();
            yield return ChatStreamEvent.PhaseEvent(
                "provider_availability",
                "running",
                detail: modelRef.CanonicalModelRef);

            string? providerError = null;
            switch (modelRef.Kind)
            {
                case LlmProviderKind.Ollama:
                {
                    if (!await _ollamaClient.IsAvailableAsync(cancellationToken))
                    {
                        LogPhase("ollama_availability", sw.ElapsedMilliseconds);
                        providerError = "Le moteur IA InstaFact est indisponible. Vérifiez que le service est démarré sur le serveur, ou choisissez un modèle cloud.";
                        break;
                    }

                    if (string.IsNullOrWhiteSpace(modelRef.ProviderModelId) ||
                        !await _ollamaClient.IsModelInstalledAsync(modelRef.ProviderModelId, cancellationToken))
                    {
                        LogPhase("model_installed_check", sw.ElapsedMilliseconds);
                        providerError = "Le modèle configuré pour l'assistant n'est pas installé sur le moteur IA InstaFact. Contactez l'administrateur plateforme.";
                    }

                    break;
                }
                case LlmProviderKind.OpenRouter:
                {
                    var credentials = await _platformAiSettings.GetOpenRouterCredentialsAsync(cancellationToken);
                    if (string.IsNullOrEmpty(credentials.ApiKey))
                    {
                        LogPhase("openrouter_credentials", sw.ElapsedMilliseconds);
                        providerError = "Aucune clé API OpenRouter configurée. Configurez-la dans le back-office plateforme > Configuration IA (OpenRouter).";
                    }

                    break;
                }
                case LlmProviderKind.Modal:
                {
                    var credentials = await _modalCredentials.ResolveAsync(_tenantContext.TenantId, cancellationToken);
                    if (string.IsNullOrEmpty(credentials.ApiKey) || string.IsNullOrWhiteSpace(credentials.BaseUrl))
                    {
                        LogPhase("modal_credentials", sw.ElapsedMilliseconds);
                        providerError = ModalCredentialMessages.Unavailable(credentials);
                    }

                    break;
                }
                case LlmProviderKind.Cursor:
                {
                    if (!_cursorSdkSettings.Enabled)
                    {
                        providerError = "Cursor SDK est désactivé sur le serveur (CursorSdk:Enabled=false).";
                        break;
                    }

                    var cursorCreds = await _platformAiSettings.GetCursorCredentialsAsync(cancellationToken);
                    if (string.IsNullOrEmpty(cursorCreds.ApiKey))
                    {
                        providerError = "Aucune clé API Cursor configurée. Configurez-la dans le back-office plateforme > Configuration IA (Cursor).";
                        break;
                    }

                    if (!await _cursorAgentClient.IsAvailableAsync(cancellationToken))
                        providerError = "Le pont Cursor SDK est indisponible. Vérifiez Node 22.13+ et `npm ci` dans CursorSdkBridge.";

                    break;
                }
                default:
                    providerError = $"Fournisseur LLM non géré : {modelRef.Kind}.";
                    break;
            }

            if (providerError is null)
                break;

            if (useAdvanced)
            {
                // Repli D3 « unavailable » : le tour continue sur le modèle standard, l'atelier est prévenu via `meta`.
                _logger.LogWarning(
                    "AI chat {CorrelationId} Studio advanced model {Model} unavailable after {ElapsedMs} ms ({Reason}); falling back to the standard model",
                    correlationId ?? "-", modelRef.CanonicalModelRef, sw.ElapsedMilliseconds, providerError);
                useAdvanced = false;
                advancedFallbackReason = StudioAdvancedFallbackUnavailable;
                modelRef = standardModelRef;
                if (studioPromptOptions is not null)
                {
                    // Le prompt a été bâti avec le budget « avancé » : on le rebâtit au budget CPU
                    // (digest en cache 30 s — coût négligeable) pour ne pas alourdir le modèle standard.
                    studioPromptOptions = studioPromptOptions with { UseAdvancedModel = false };
                    systemPromptTask = _contextBuilder.BuildSystemPromptAsync(assistantMode, screenId, agentScope, studioPromptOptions, cancellationToken);
                }
                continue;
            }

            yield return ChatStreamEvent.PhaseEvent(
                "provider_availability",
                "failed",
                sw.ElapsedMilliseconds,
                detail: modelRef.CanonicalModelRef);
            yield return ChatStreamEvent.ErrorEvent(providerError);
            yield break;
        }

        LogPhase("provider_availability", sw.ElapsedMilliseconds);
        yield return ChatStreamEvent.PhaseEvent(
            "provider_availability",
            "completed",
            sw.ElapsedMilliseconds,
            detail: modelRef.CanonicalModelRef);

        if (isStudioBuilder)
        {
            // Métadonnées du tour Studio (PR 1.2) : l'atelier affiche « Modèle standard utilisé » quand le
            // modèle avancé demandé n'a pas pu servir. Émis une seule fois, avant le premier token.
            yield return ChatStreamEvent.StudioMetaEvent(BuildStudioMetaJson(useAdvanced, advancedFallbackReason, modelRef));
        }

        sw.Restart();
        yield return ChatStreamEvent.PhaseEvent(
            "conversation_load_or_create",
            "running",
            detail: existing is not null ? "conversation existante" : "nouvelle conversation");
        var isNewConversation = existing is null;
        var deferUserPersist = _ollamaSettings.DeferUserMessagePersist;
        Conversation conversation;
        if (existing is not null)
        {
            conversation = existing;
            // Le scope stocké fait autorité pour les outils/prompt d'une conversation reprise : les listes UI
            // sont filtrées par scope, un écart n'est atteignable que par appel API forgé.
            var storedScope = Enum.IsDefined(typeof(AssistantAgentScope), existing.AgentScope)
                ? (AssistantAgentScope)existing.AgentScope
                : AssistantAgentScope.None;
            if (assistantMode == AssistantMode.Default && _ollamaSettings.EnableAgentScopes && storedScope != agentScope)
            {
                _logger.LogWarning(
                    "AI chat {CorrelationId} agent scope mismatch: request={RequestedScope} stored={StoredScope} — stored wins",
                    correlationId ?? "-", agentScope, storedScope);
                agentScope = storedScope;
            }

            if (_currentUser.IsAccountingFirmDelegatedContext)
                agentScope = FirmDelegatedAiScopePolicy.ResolveAllowedScope(true, agentScope);

            conversation.AddMessage(MessageRole.User, command.Message);
            if (!deferUserPersist)
                await _conversationRepository.UpdateAsync(conversation, cancellationToken);
        }
        else
        {
            var title = BuildConversationTitle(command);
            conversation = Conversation.Create(userId, title, modelRef.CanonicalModelRef, (int)requestedAgentScope);
            conversation.AddMessage(MessageRole.User, command.Message);
            if (!deferUserPersist)
                await _conversationRepository.AddAsync(conversation, cancellationToken);
        }

        LogPhase("conversation_load_or_create", sw.ElapsedMilliseconds);
        yield return ChatStreamEvent.PhaseEvent(
            "conversation_load_or_create",
            "completed",
            sw.ElapsedMilliseconds,
            detail: existing is not null ? "conversation existante" : "nouvelle conversation");
        sw.Restart();

        var isScreenAnalysis = assistantMode == AssistantMode.ScreenAnalysis;

        yield return ChatStreamEvent.PhaseEvent(
            "build_system_prompt",
            "running",
            detail: assistantMode.ToString());

        string? serverEnrichment = null;
        if (isScreenAnalysis && _screenAnalysisOptions.Enabled)
        {
            serverEnrichment = await _screenAnalysisEnricher.TryEnrichAsync(
                command.UiContext,
                correlationId,
                conversation.Id,
                cancellationToken);
        }

        var systemPrompt = await systemPromptTask;
        var volatileUi = _volatileContextFormatter.Format(command.UiContext, serverEnrichment);
        if (!string.IsNullOrEmpty(volatileUi))
            systemPrompt += "\n\n" + volatileUi;

        if (isScreenAnalysis)
        {
            _logger.LogInformation(
                "Screen analysis {CorrelationId} screen={ScreenId} payload_bytes={PayloadBytes} schema={Schema}",
                correlationId ?? "-",
                screenId ?? "-",
                command.UiContext?.AnalysisSummary?.Length ?? 0,
                TryExtractSchemaVersion(command.UiContext?.AnalysisSummary));
        }

        LogPhase("build_system_prompt", sw.ElapsedMilliseconds);
        yield return ChatStreamEvent.PhaseEvent(
            "build_system_prompt",
            "completed",
            sw.ElapsedMilliseconds,
            detail: assistantMode.ToString());

        // Routage par intention : n'exposer les outils d'ÉCRITURE que si la requête — ou l'échange récent,
        // pour couvrir les confirmations type « oui » après une demande de mutation — implique une mutation.
        // Cela réduit fortement la taille du prompt (et le prefill) pour les questions de LECTURE (cas dominant),
        // et évite de tronquer le catalogue d'outils. L'exécution reste de toute façon gardée par
        // EnableMutationTools + permissions (AiToolExecutor), donc aucun risque d'action non désirée.
        var mutationIntentText = command.Message ?? string.Empty;
        if (conversation.Messages.Count > 0)
        {
            var recent = conversation.Messages
                .OrderByDescending(m => m.SortOrder)
                .Take(3)
                .Select(m => m.Content);
            mutationIntentText += " " + string.Join(" ", recent);
        }
        // Canal externe (WhatsApp…) : ForceReadOnlyTools impose la lecture seule structurelle pour
        // cette requête, indépendamment du gating dynamique (défaut false = chemin web inchangé).
        var effectiveMutationTools = command.Options?.ForceReadOnlyTools != true
            && AssistantModeResolver.ShouldEnableMutationTools(
                assistantMode, _ollamaSettings.EnableMutationTools, mutationIntentText);
        var toolIntent = _ollamaSettings.EnableToolIntentRouting
            ? AiToolIntentRouter.Resolve(command.Message, assistantMode)
            : AiToolIntentRouter.AiToolIntent.Fallback;
        // Suivi conversationnel (clic sur un prompt suggéré) en mode Default : on restreint le catalogue
        // à l'intent Synthesis pour répondre depuis l'analyse déjà présente dans l'historique, au lieu de
        // dériver vers des outils hors-contexte. N'affecte ni ScreenAnalysis/Compliance, ni les questions tapées.
        if (command.Options?.ConversationalFollowUp == true
            && assistantMode == AssistantMode.Default
            && !isScreenAnalysis)
        {
            toolIntent = AiToolIntentRouter.AiToolIntent.Synthesis;
        }
        OllamaInferenceProfile? inferenceProfile = null;
        if (modelRef.Kind == LlmProviderKind.Ollama)
            inferenceProfile = await _inferenceProfileResolver.ResolveForPlatformAsync(cancellationToken);
        var studioReportDetection = !isScreenAnalysis
            && assistantMode == AssistantMode.StudioBuilder
            && _ollamaSettings.EnableStudioReportShortcut
            && _ollamaSettings.EnableStudioAiReportTools
            && _ollamaSettings.EnableStudioSqlReportEngine
            ? StudioReportIntentRouter.TryInfer(command.Message)
            : null;
        var studioToolFocus = assistantMode == AssistantMode.StudioBuilder
            && (studioReportDetection is not null || StudioReportIntentRouter.LooksLikeReportRequest(command.Message))
            ? StudioToolFocus.Report
            : StudioToolFocus.None;
        var tools = BuildOllamaTools(assistantMode, effectiveMutationTools, toolIntent, inferenceProfile, agentScope,
            _ollamaSettings.EnableStudioAiPlanPreview, _ollamaSettings.EnableStudioAiModifyTools,
            _ollamaSettings.EnableStudioAiViewTools,
            _ollamaSettings.EnableStudioAiReportTools && _ollamaSettings.EnableStudioSqlReportEngine,
            studioToolFocus,
            studioRecordViewTools: _ollamaSettings.EnableStudioAiRecordViewTools && _ollamaSettings.EnableStudioRecordViews,
            studioWorkflowTools: StudioAiPlanCreation.WorkflowToolsEnabled(_ollamaSettings));
        // Les schémas d'outils sont injectés dans le contexte du modèle : on les compte dans
        // l'estimation de taille pour dimensionner num_ctx (sinon Ollama tronque silencieusement
        // l'invite quand de nombreux outils sont exposés → réponses dégradées / hors-sujet).
        var toolsApproxChars = tools.Count > 0 ? JsonSerializer.Serialize(tools).Length : 0;
        var toolSourcesForClient = new List<SourceEntryDto>();
        var accumulatedSuggestedPrompts = new List<string>();
        string? accumulatedDashboardJson = null;
        // StudioBuilder : température basse dédiée (specs JSON déterministes — A13).
        var temperature = isScreenAnalysis
            ? _screenAnalysisOptions.Temperature
            : isStudioBuilder ? _ollamaSettings.StudioTemperature : _ollamaSettings.Temperature;
        // StudioBuilder : graine fixe par défaut pour des specs reproductibles d'un tour à l'autre.
        var seed = isStudioBuilder ? (_ollamaSettings.Seed ?? StudioDefaultSeed) : _ollamaSettings.Seed;
        // Lot 3.2 — budget de tokens réduit et scope-guardé pour FirmMission : les synthèses de revue
        // de portefeuille sont courtes, 1536 borne le pire cas de génération CPU. 0 = hérite du global.
        var maxTokens = isScreenAnalysis
            ? _screenAnalysisOptions.MaxTokens
            : (agentScope == AssistantAgentScope.FirmMission && _ollamaSettings.FirmMissionMaxTokens > 0
                ? _ollamaSettings.FirmMissionMaxTokens
                : _ollamaSettings.MaxTokens);
        var maxRounds = ResolveMaxToolCallRounds(
            isScreenAnalysis,
            _screenAnalysisOptions.MaxToolCallRounds,
            _ollamaSettings.MaxToolCallRounds,
            _ollamaSettings.CpuMaxToolCallRounds,
            assistantMode,
            toolIntent,
            inferenceProfile,
            agentScope,
            studioAdvanced: useAdvanced,
            studioAdvancedMaxToolCallRounds: _ollamaSettings.StudioAdvancedMaxToolCallRounds) + 1;
        var toolCallRound = 0;
        var continueLoop = true;
        // Compteur unique de générations LLM du tour (Lot 2.2) : incrémenté à CHAQUE génération —
        // boucle d'outils (ci-dessous), synthèse forcée et synthèse de secours (hook Lot 1). Pour
        // agentScope == FirmMission, budget ≤ 2 : voir AtLlmGenerationBudgetExhaustedForFirmTurn.
        var llmGenerationsThisTurn = 0;
        var minMeaningfulTextChars = ResolveMinMeaningfulTextChars(toolIntent, _ollamaSettings);
        // Raccourci déterministe CONFORMITÉ : « vérifie la conformité de ma dernière facture » résout
        // l'intent Sales (mot « facture ») et exigerait d'enchaîner recherche + contrôle — impossible
        // pour le petit modèle en un round CPU. On détecte la demande et on pré-appelle l'outil de
        // conformité (qui résout lui-même la facture : numéro extrait ou plus récente). Gate : modes
        // Default/Compliance uniquement, flag réversible, et outil présent dans le catalogue du scope.
        var complianceShortcutAllowed = assistantMode == AssistantMode.Compliance
            || (assistantMode == AssistantMode.Default
                && (agentScope == AssistantAgentScope.None
                    || AiAgentScopeCatalog.GetToolNames(agentScope).Contains("compliance_check_invoice")));
        var complianceDetection = !isScreenAnalysis
            && assistantMode is AssistantMode.Default or AssistantMode.Compliance
            && complianceShortcutAllowed
            && _ollamaSettings.ComplianceCheckShortcutEnabled
            ? AiToolIntentRouter.TryInferComplianceCheckInvoice(command.Message)
            : null;
        // Raccourci déterministe ÉTAT (même raison d'être que celui ci-dessus, transposé au Studio) :
        // « créer un rapport de ventes de produits » n'aboutissait jamais, le modèle Studio n'émettant
        // aucun appel d'outil. On reconnaît la demande et on pré-exécute l'état — le modèle n'a plus
        // qu'à rédiger. Aucune reconnaissance certaine ⇒ aucun raccourci, le flux normal reprend.
        // Assistant expert : les suffixes Sales/Fallback citent get_sales_revenue — on ne les applique
        // que si l'outil fait partie du catalogue du scope (sinon ils pousseraient le modèle vers un
        // outil qu'il n'a pas). Les autres suffixes (Greeting/Chart/Synthesis) restent génériques.
        // Raccourci conformité armé : le suffixe d'intent (Sales) égarerait le modèle vers le CA —
        // remplacé par la consigne de synthèse du contrôle déjà exécuté.
        var intentSuffix = complianceDetection is null && ShouldApplyIntentSuffixForScope(toolIntent, agentScope)
            ? AiToolIntentRouter.BuildIntentPromptSuffix(toolIntent)
            : string.Empty;
        if (!string.IsNullOrWhiteSpace(intentSuffix))
            systemPrompt += "\n\n" + intentSuffix;
        if (complianceDetection is not null)
            systemPrompt += "\n\n" + AiToolIntentRouter.ComplianceShortcutPromptSuffix;
        if (studioReportDetection is not null)
            systemPrompt += "\n\n" + StudioReportShortcutPromptSuffix;
        // Question de conseil (« comment gagner plus », « vos conseils pour… ») : cadrage cumulable avec
        // l'intent — recommandations ANCRÉES dans les données, jamais de méta-discours sur les outils.
        if (!isScreenAnalysis && AiToolIntentRouter.LooksLikeAdviceQuestion(command.Message))
            systemPrompt += "\n\n" + AiToolIntentRouter.AdvicePromptSuffix;
        // Suivi pour le filet de synthèse finale : le dernier tour d'appels d'outils a-t-il produit une réponse visible complète ?
        var lastToolRoundHadMeaningfulText = false;
        var forcedSynthesisTriggered = false;
        var deterministicFallbackUsed = false;
        var meaningfulResponseDelivered = false;
        // StudioBuilder : message d'erreur réel d'un outil studio_generate_* en échec, à surfacer
        // déterministiquement (le petit modèle le paraphrase sinon en excuse vague).
        string? studioBuilderToolError = null;
        // Charge utile de la carte d'échec d'un ÉTAT (distincte de l'erreur de construction Studio).
        string? studioReportFailureJson = null;
        // Demande de précision : domaine reconnu, ventilation absente. Court-circuite le modèle.
        string? studioClarification = null;
        var conversationalFastPath = false;
        var toolsExecutedThisRequest = 0;
        var totalContentCharsStreamed = 0;
        var contentCharsPersisted = 0;

        if (_ollamaSettings.ConversationalFastPathEnabled
            && !isScreenAnalysis
            && AiToolIntentRouter.ShouldUseConversationalFastPath(toolIntent, command.Message))
        {
            conversationalFastPath = true;
            yield return ChatStreamEvent.PhaseEvent("conversational_fast_path", "running");
            var fastBody = AssistantDeterministicFallback.LooksLikeIdentityQuestion(command.Message)
                ? AssistantDeterministicFallback.BuildIdentityResponse()
                : AssistantDeterministicFallback.BuildGreetingResponse();
            contentCharsPersisted = fastBody.Length;
            totalContentCharsStreamed = fastBody.Length;
            conversation.AddMessage(MessageRole.Assistant, fastBody);
            meaningfulResponseDelivered = true;
            yield return ChatStreamEvent.ContentReplace(fastBody);
            yield return ChatStreamEvent.PhaseEvent("conversational_fast_path", "completed");
        }

        // Raccourcis déterministes : pour une question de CA non ambiguë (« aujourd'hui » / « ce mois-ci »)
        // ou un CLASSEMENT clients (« mes 5 meilleurs clients »), on pré-appelle get_sales_revenue avec les
        // arguments déduits afin de garantir un résultat d'outil dans le contexte. Un petit modèle ne renvoie
        // alors plus une clarification au lieu du chiffre, ni ne choisit un mauvais outil pour le classement.
        // Assistant expert : le raccourci ne s'exécute que si get_sales_revenue appartient au catalogue
        // du scope (ex. Expert Stock interrogé sur les « meilleurs clients » → pas de pré-appel, le
        // modèle répond/oriente avec sa persona).
        var salesShortcutAllowedForScope = agentScope == AssistantAgentScope.None
            || AiAgentScopeCatalog.GetToolNames(agentScope).Contains("get_sales_revenue");
        // Exclusion mutuelle : une demande de conformité détectée (plus spécifique) prime sur les
        // raccourcis ventes — « la facture FAC-… est-elle conforme ce mois-ci ? » ne doit pas
        // déclencher get_sales_revenue(preset=current_month).
        var salesShortcutPreset = !conversationalFastPath
            && !isScreenAnalysis
            && complianceDetection is null
            && salesShortcutAllowedForScope
            && toolIntent == AiToolIntentRouter.AiToolIntent.Sales
            ? AiToolIntentRouter.InferSalesPreset(command.Message)
            : null;
        var clientRankingTopN = !conversationalFastPath
            && !isScreenAnalysis
            && complianceDetection is null
            && salesShortcutAllowedForScope
            && toolIntent == AiToolIntentRouter.AiToolIntent.Sales
            && _ollamaSettings.SalesClientRankingShortcutEnabled
            ? AiToolIntentRouter.TryInferClientRankingTopN(command.Message)
            : null;

        Dictionary<string, object?>? salesShortcutArgs = null;
        if (clientRankingTopN is int rankingTopN)
        {
            // Classement clients : group_by=Client + top_n ; période explicite si détectée,
            // sinon last_30_days (décision produit — le mois en cours est dégénéré en début de mois).
            salesShortcutArgs = new Dictionary<string, object?>
            {
                ["preset"] = salesShortcutPreset ?? ReportingPeriodResolver.PresetLast30Days,
                ["group_by"] = "Client",
                ["top_n"] = rankingTopN
            };
        }
        else if ((salesShortcutPreset == "today" && _ollamaSettings.SalesTodayPresetShortcutEnabled)
            || (salesShortcutPreset == "current_month" && _ollamaSettings.SalesMonthPresetShortcutEnabled))
        {
            salesShortcutArgs = new Dictionary<string, object?> { ["preset"] = salesShortcutPreset! };
        }

        if (salesShortcutArgs is not null)
        {
            var shortcutCallId = Guid.NewGuid().ToString("N")[..12];
            yield return ChatStreamEvent.ToolCallStart("get_sales_revenue", shortcutCallId);
            var shortcutSw = Stopwatch.StartNew();
            AiToolResult shortcutResult;
            try
            {
                shortcutResult = await _toolExecutor.ExecuteAsync(
                    "get_sales_revenue",
                    salesShortcutArgs,
                    new AiToolExecutionContext(correlationId, conversation.Id),
                    cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Sales shortcut failed (args={Args})",
                    JsonSerializer.Serialize(salesShortcutArgs));
                shortcutResult = AiToolResult.Error($"Erreur lors de l'exécution: {ex.Message}");
            }

            var shortcutContent = shortcutResult.Success
                ? shortcutResult.Data ?? string.Empty
                : $"Erreur: {shortcutResult.ErrorMessage}";
            conversation.AddMessage(MessageRole.Tool, shortcutContent, "get_sales_revenue", shortcutCallId);
            toolsExecutedThisRequest++;
            toolSourcesForClient.Add(new SourceEntryDto("get_sales_revenue", shortcutCallId));
            yield return ChatStreamEvent.ToolCallEnd("get_sales_revenue", shortcutCallId, shortcutSw.ElapsedMilliseconds);
        }

        // ── Lot 1.2 : raccourci déterministe FirmMission ──────────────────────────────────────────
        // Compteur de lectures firm ancrées ce tour (Lot 1.3) : distinct de toolsExecutedThisRequest
        // (qui compte les outils TENTÉS, même en erreur) — n'augmente que pour une lecture get_firm_*
        // réussie ET exploitable (result.IsGrounded). Lu par le grounding gate
        // avant chaque site de persistance, et journalisé dans total_request.
        var firmGroundedReads = 0;
        // Détection « le tour demande des données » calculée une fois, réutilisée par le raccourci,
        // le gate de persistance et l'éligibilité de la synthèse de secours.
        var firmTurnNeedsData = FirmTurnNeedsData(command.Message);
        var firmPreExecutedToolNames = new HashSet<string>(StringComparer.Ordinal);
        if (agentScope == AssistantAgentScope.FirmMission
            && !conversationalFastPath
            && !isScreenAnalysis
            && _ollamaSettings.FirmMissionShortcutEnabled
            && firmTurnNeedsData)
        {
            // Le routeur résout ≤ 2 appels get_firm_* réels avec les BONS paramètres (un routage naïf
            // par mot-clé serait sémantiquement faux — ex. « pour quel montant, chez combien de
            // clients ? » exige les agrégats de l'overview, pas la liste plafonnée à top_n). La
            // mémoïsation du fan-out (Lot 2.3) rend le 2ᵉ outil quasi gratuit à horizon égal.
            var plannedCalls = FirmMissionShortcutRouter.Resolve(command.Message);
            foreach (var planned in plannedCalls)
            {
                var firmCallId = Guid.NewGuid().ToString("N")[..12];
                yield return ChatStreamEvent.ToolCallStart(planned.ToolName, firmCallId);
                var firmSw = Stopwatch.StartNew();
                AiToolResult firmResult;
                try
                {
                    firmResult = await _toolExecutor.ExecuteAsync(
                        planned.ToolName,
                        planned.Arguments,
                        new AiToolExecutionContext(correlationId, conversation.Id),
                        cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex,
                        "Firm shortcut failed for {ToolName} (args={Args})",
                        planned.ToolName,
                        JsonSerializer.Serialize(planned.Arguments));
                    firmResult = AiToolResult.Error($"Erreur lors de l'exécution: {ex.Message}");
                }

                var firmContent = firmResult.Success
                    ? firmResult.Data ?? string.Empty
                    : $"Erreur: {firmResult.ErrorMessage}";
                conversation.AddMessage(MessageRole.Tool, firmContent, planned.ToolName, firmCallId);
                toolsExecutedThisRequest++;
                toolSourcesForClient.Add(new SourceEntryDto(planned.ToolName, firmCallId));
                // Grounding gate (Lot 1.3) : seules les lectures firm réussies ET exploitables
                // ancrent le tour — un échec d'outil ou un Ok au fan-out totalement en échec ne compte pas.
                if (firmResult.IsGrounded)
                    firmGroundedReads++;
                yield return ChatStreamEvent.ToolCallEnd(planned.ToolName, firmCallId, firmSw.ElapsedMilliseconds);
                firmPreExecutedToolNames.Add(planned.ToolName);
            }

            // Recalcul du catalogue exposé au modèle : on retire les outils déjà pré-exécutés pour que
            // l'unique round CPU firm ne soit pas gaspillé à rappeler une lecture déjà obtenue. Garde-fou
            // dans BuildOllamaTools : ne JAMAIS vider complètement le catalogue (si le filtrage ne laisse
            // rien, la liste non filtrée est conservée).
            if (firmPreExecutedToolNames.Count > 0)
            {
                tools = BuildOllamaTools(assistantMode, effectiveMutationTools, toolIntent, inferenceProfile, agentScope,
                    _ollamaSettings.EnableStudioAiPlanPreview, _ollamaSettings.EnableStudioAiModifyTools,
                    _ollamaSettings.EnableStudioAiViewTools,
                    _ollamaSettings.EnableStudioAiReportTools && _ollamaSettings.EnableStudioSqlReportEngine,
                    studioToolFocus,
                    studioRecordViewTools: _ollamaSettings.EnableStudioAiRecordViewTools && _ollamaSettings.EnableStudioRecordViews,
                    studioWorkflowTools: StudioAiPlanCreation.WorkflowToolsEnabled(_ollamaSettings),
                    preExecutedToolNamesToExclude: firmPreExecutedToolNames);
                toolsApproxChars = tools.Count > 0 ? JsonSerializer.Serialize(tools).Length : 0;
            }
        }

        // Pré-exécution du contrôle de conformité (même patron que le raccourci ventes ci-dessus) :
        // le résultat structuré est injecté dans le contexte, le modèle n'a plus qu'à synthétiser.
        if (complianceDetection is not null && !conversationalFastPath)
        {
            var complianceArgs = new Dictionary<string, object?>();
            if (complianceDetection.InvoiceNumber is not null)
                complianceArgs["invoice_number"] = complianceDetection.InvoiceNumber;
            var complianceCallId = Guid.NewGuid().ToString("N")[..12];
            yield return ChatStreamEvent.ToolCallStart("compliance_check_invoice", complianceCallId);
            var complianceSw = Stopwatch.StartNew();
            AiToolResult complianceResult;
            try
            {
                complianceResult = await _toolExecutor.ExecuteAsync(
                    "compliance_check_invoice",
                    complianceArgs,
                    new AiToolExecutionContext(correlationId, conversation.Id),
                    cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Compliance shortcut failed (args={Args})",
                    JsonSerializer.Serialize(complianceArgs));
                complianceResult = AiToolResult.Error($"Erreur lors de l'exécution: {ex.Message}");
            }

            var complianceContent = complianceResult.Success
                ? complianceResult.Data ?? string.Empty
                : $"Erreur: {complianceResult.ErrorMessage}";
            conversation.AddMessage(MessageRole.Tool, complianceContent, "compliance_check_invoice", complianceCallId);
            toolsExecutedThisRequest++;
            toolSourcesForClient.Add(new SourceEntryDto("compliance_check_invoice", complianceCallId));
            yield return ChatStreamEvent.ToolCallEnd("compliance_check_invoice", complianceCallId, complianceSw.ElapsedMilliseconds);
        }

        // Pré-exécution de l'ÉTAT (même patron) : la spécification est construite ICI, à partir d'un
        // préréglage et d'une période reconnus — le modèle n'écrit ni le JSON, ni le SQL, ni les
        // chiffres. Il ne lui reste qu'à rédiger la phrase d'accompagnement.
        if (studioReportDetection is not null && !conversationalFastPath)
        {
            var reportTool = studioReportDetection.Save ? "studio_plan_report" : "studio_run_report";
            // Priorité : période exprimée par l'utilisateur > période propre au préréglage
            // (pluriannuelle pour un état PAR ANNÉE) > défaut global. Sans l'étage intermédiaire,
            // « ventes par année » se calculait sur l'année en cours et ne rendait qu'une ligne.
            var period = ReportingPeriodResolver.Resolve(
                StudioReportIntentRouter.ResolvePeriodPreset(studioReportDetection),
                _timeProvider);
            var preset = SqlReportPresetCatalog.Find(studioReportDetection.PresetKey);

            var reportSpec = JsonSerializer.Serialize(new
            {
                title = preset?.DisplayName ?? studioReportDetection.PresetKey,
                preset = studioReportDetection.PresetKey,
                from = period.FromDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                to = period.ToDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            });

            // Jusqu'ici, aucun log ne nommait le préréglage retenu : diagnostiquer une session
            // obligeait à déduire l'état à partir du nombre de colonnes SQL. On le nomme.
            _logger.LogInformation(
                "AI chat {CorrelationId} studio_report_shortcut preset={Preset} period={Period} save={Save}",
                correlationId ?? "-", studioReportDetection.PresetKey, period.Label, studioReportDetection.Save);

            var reportCallId = Guid.NewGuid().ToString("N")[..12];
            yield return ChatStreamEvent.ToolCallStart(reportTool, reportCallId);
            var reportSw = Stopwatch.StartNew();
            AiToolResult reportResult;
            try
            {
                reportResult = await _toolExecutor.ExecuteAsync(
                    reportTool,
                    new Dictionary<string, object?> { ["spec_json"] = reportSpec },
                    new AiToolExecutionContext(correlationId, conversation.Id),
                    cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Studio report shortcut failed (preset={Preset})", studioReportDetection.PresetKey);
                // Le détail technique reste au journal : il nomme des tables et parfois la requête.
                reportResult = AiToolResult.Error("Le calcul de l'état n'a pas abouti.");
            }

            var reportContent = reportResult.Success
                ? reportResult.Data ?? string.Empty
                : $"Erreur: {reportResult.ErrorMessage}";
            conversation.AddMessage(MessageRole.Tool, reportContent, reportTool, reportCallId);
            // Décisif : réactive ShouldForceFinalSynthesis (ForceFinalSynthesisOnlyAfterTools) — sans
            // cela, une réponse trop courte du modèle retomberait dans le filet anti-silence.
            toolsExecutedThisRequest++;
            toolSourcesForClient.Add(new SourceEntryDto(reportTool, reportCallId));
            yield return ChatStreamEvent.ToolCallEnd(reportTool, reportCallId, reportSw.ElapsedMilliseconds);

            if (reportResult.Success && !string.IsNullOrWhiteSpace(reportResult.Data))
            {
                // R7/PR 2.4 : la décision « événement plan (carte d'aperçu) vs résultat d'état » suit
                // la liste centralisée — studio_plan_report y figure, studio_run_report non.
                yield return AiToolRegistry.StudioPlanEmittingTools.Contains(reportTool)
                    ? ChatStreamEvent.StudioPlanEvent(reportResult.Data)
                    : ChatStreamEvent.StudioReportResultEvent(reportResult.Data);
            }
            else if (!reportResult.Success)
            {
                // Erreur réelle (permission, source refusée…) : la surfacer telle quelle plutôt que
                // de laisser le modèle la paraphraser en excuse vague.
                studioBuilderToolError = string.IsNullOrWhiteSpace(reportResult.ErrorMessage)
                    ? "Le calcul de l'état a échoué."
                    : reportResult.ErrorMessage;
                // Ici, le préréglage et la période tentés sont connus : la carte d'échec peut les
                // nommer et proposer des reformulations plutôt qu'un simple message rouge.
                studioReportFailureJson = JsonSerializer.Serialize(
                    StudioReportFailure.Build(
                        command.Message, studioBuilderToolError, studioReportDetection.PresetKey, period.Label),
                    SourcesJsonOptions);
            }

            // La période retenue est ANNONCÉE : l'utilisateur doit pouvoir corriger un défaut implicite.
            systemPrompt += $"\n\nPÉRIODE RETENUE : {period.Label}. Annonce-la explicitement dans ta réponse.";
        }

        // Domaine reconnu mais ventilation absente (« le chiffre d'affaires de l'année en cours ») :
        // le score reste sous le seuil, donc aucun état n'est exécuté — et jusqu'ici l'utilisateur
        // recevait « Je n'ai pas pu formuler une réponse complète », ce qui est faux : la demande est
        // comprise, il manque un axe. On demande, en proposant les ventilations réellement
        // disponibles. Fidèle à la doctrine du routeur : en cas de doute, on ne devine pas.
        if (studioReportDetection is null
            && !conversationalFastPath
            && assistantMode == AssistantMode.StudioBuilder
            && StudioReportIntentRouter.LooksLikeReportRequest(command.Message))
        {
            var breakdowns = StudioReportIntentRouter.ToPromptSuggestions(
                StudioReportIntentRouter.SuggestForDomain(command.Message));

            if (breakdowns.Count > 0)
            {
                studioClarification =
                    "J'ai bien compris la demande, mais il me manque la ventilation souhaitée. "
                    + "Choisissez une répartition : " + string.Join(", ", breakdowns) + ".";

                _logger.LogInformation(
                    "AI chat {CorrelationId} studio_report_intent_ambiguous suggestions={Count}",
                    correlationId ?? "-", breakdowns.Count);

                contentCharsPersisted = studioClarification.Length;
                conversation.AddMessage(MessageRole.Assistant, studioClarification);
                meaningfulResponseDelivered = true;
                // Le modèle n'a rien à ajouter : on coupe la boucle LLM et, par voie de conséquence,
                // la synthèse forcée et le repli déterministe.
                continueLoop = false;

                yield return ChatStreamEvent.ContentReplace(studioClarification);
                yield return ChatStreamEvent.SuggestedPromptsEvent(JsonSerializer.Serialize(breakdowns));
            }
        }

        if (modelRef.Kind == LlmProviderKind.Cursor && studioClarification is null)
        {
            if (!conversationalFastPath)
            {
                var runId = Guid.NewGuid();
                var callbackToken = CursorToolRunContext.CreateToken();
                var scratchDir = CreateCursorScratchDirectory(runId);
                var role = _currentUser.Role ?? UserRole.Client;
                var cursorCtx = new CursorToolRunContext
                {
                    RunId = runId,
                    Token = callbackToken,
                    Conversation = conversation,
                    CorrelationId = correlationId,
                    ToolExecutor = _toolExecutor,
                    ScopeFactory = _toolExecutorScopeFactory,
                    TenantId = _currentUser.TenantId ?? _tenantContext.TenantId ?? Guid.Empty,
                    ConnectionString = _tenantContext.ConnectionString ?? string.Empty,
                    UserId = _currentUser.UserId ?? userId,
                    Email = _currentUser.Email,
                    Role = role,
                    Permissions = role.GetPermissions()
                        .Where(_currentUser.HasPermission)
                        .ToHashSet(StringComparer.Ordinal)
                };
                _cursorToolRuns.Register(cursorCtx);
                var cursorFailed = false;
                var fullContent = new System.Text.StringBuilder();
                sw.Restart();
                yield return ChatStreamEvent.PhaseEvent(
                    "llm_stream_round",
                    "running",
                    round: 1);
                try
                {
                    var cursorCreds = await _platformAiSettings.GetCursorCredentialsAsync(cancellationToken);
                    var userText = AiConversationMessageMapper.BuildCursorUserMessage(
                        systemPrompt,
                        conversation,
                        _ollamaSettings.MaxContextMessages,
                        _ollamaSettings.MaxToolResultChars);
                    var request = new CursorChatRunRequest(
                        cursorCreds.ApiKey!,
                        modelRef,
                        userText,
                        CursorToolSpecMapper.FromAttachments(command.Attachments),
                        CursorToolSpecMapper.FromOllamaTools(tools),
                        runId,
                        BuildCursorToolCallbackUrl(runId),
                        callbackToken,
                        scratchDir);

                    await foreach (var ev in _cursorAgentClient.RunChatAsync(request, cancellationToken))
                    {
                        while (cursorCtx.ExtraEvents.TryDequeue(out var extra))
                            yield return extra;

                        switch (ev.Type)
                        {
                            case "started":
                                _logger.LogInformation(
                                    "AI chat {CorrelationId} phase=llm_stream_round cursor agentId={AgentId} runId={RunId}",
                                    correlationId ?? "-",
                                    ev.AgentId ?? "-",
                                    ev.RunId ?? runId.ToString());
                                break;
                            case "assistant_text" when !string.IsNullOrEmpty(ev.Text):
                                fullContent.Append(ev.Text);
                                totalContentCharsStreamed += ev.Text.Length;
                                yield return ChatStreamEvent.ContentChunk(ev.Text);
                                break;
                            case "done" when !string.IsNullOrEmpty(ev.Text) && fullContent.Length == 0:
                                fullContent.Append(ev.Text);
                                totalContentCharsStreamed += ev.Text.Length;
                                yield return ChatStreamEvent.ContentChunk(ev.Text);
                                break;
                            case "error":
                                cursorFailed = true;
                                var userError = CursorSdkErrorMapper.ToUserMessage(ev.Error, out var logCursorError);
                                if (logCursorError)
                                {
                                    _logger.LogError(
                                        "AI chat {CorrelationId} Cursor SDK error: {Error}",
                                        correlationId ?? "-",
                                        ev.Error ?? "-");
                                }
                                yield return ChatStreamEvent.ErrorEvent(userError);
                                break;
                        }
                    }

                    while (cursorCtx.ExtraEvents.TryDequeue(out var trailing))
                        yield return trailing;
                }
                finally
                {
                    _cursorToolRuns.Complete(runId);
                    TryDeleteScratchDirectory(scratchDir);
                }

                if (cursorFailed)
                    yield break;

                toolsExecutedThisRequest += cursorCtx.ToolsExecuted;
                // Lot 1.3 : agrège les lectures firm ancrées exécutées via le callback Cursor (le
                // compteur ctx.FirmGroundedReads est alimenté dans CursorToolCallbackService).
                firmGroundedReads += cursorCtx.FirmGroundedReads;
                if (!string.IsNullOrEmpty(cursorCtx.AccumulatedDashboardJson))
                    accumulatedDashboardJson = cursorCtx.AccumulatedDashboardJson;
                foreach (var prompt in cursorCtx.AccumulatedSuggestedPrompts)
                {
                    if (!accumulatedSuggestedPrompts.Contains(prompt))
                        accumulatedSuggestedPrompts.Add(prompt);
                }

                foreach (var (name, callId) in cursorCtx.ToolSources)
                    toolSourcesForClient.Add(new SourceEntryDto(name, callId));
                if (cursorCtx.StudioBuilderToolError is not null)
                    studioBuilderToolError = cursorCtx.StudioBuilderToolError;

                yield return ChatStreamEvent.PhaseEvent(
                    "llm_stream_round",
                    "completed",
                    sw.ElapsedMilliseconds,
                    1,
                    hadToolCalls: cursorCtx.ToolsExecuted > 0);

                if (fullContent.Length > 0)
                {
                    var assistantBody = BuildFinalAssistantBodyWithAppendices(
                        fullContent.ToString(),
                        minMeaningfulTextChars,
                        accumulatedDashboardJson,
                        accumulatedSuggestedPrompts);
                    if (AssistantVisibleContentFormatter.HasMeaningfulAssistantText(assistantBody, minMeaningfulTextChars))
                    {
                        // Lot 1.3 : grounding gate — une réponse firm non ancrée n'est PAS persistée
                        // (le bloc de synthèse de secours plus bas tente une lecture puis une synthèse,
                        // sinon persiste le repli honnête). Gate désactivé ou autre scope ⇒ inchangé.
                        if (!ShouldRejectUngroundedFirmAnswer(agentScope, firmGroundedReads, firmTurnNeedsData, _ollamaSettings.FirmMissionGroundingGateEnabled))
                        {
                            contentCharsPersisted = assistantBody.Length;
                            conversation.AddMessage(MessageRole.Assistant, assistantBody);
                            meaningfulResponseDelivered = true;
                            yield return ChatStreamEvent.ContentReplace(assistantBody);
                        }
                    }
                }
            }
        }
        else if (!conversationalFastPath)
        while (continueLoop && toolCallRound < maxRounds)
        {
            continueLoop = false;
            // Chaque itération de cette boucle appelle le provider LLM une fois (Lot 2.2 — compteur
            // unique de générations, budget ≤ 2 pour le tour firm).
            llmGenerationsThisTurn++;
            var phaseRound = toolCallRound + 1;
            sw.Restart();
            yield return ChatStreamEvent.PhaseEvent(
                "llm_stream_round",
                "running",
                round: phaseRound);

            var fullContent = new System.Text.StringBuilder();
            List<OllamaToolCall>? pendingToolCalls = null;
            var firstTokenMs = (long?)null;

            // Streaming spéculatif : les segments sûrs (bornés par AiLiveContentStreamer, assainis) sont
            // émis EN DIRECT tant que le round n'a produit aucun tool call ; un content_replace final
            // réconcilie avec le corps post-traité (identique à l'historique). StudioBuilder exclu : son
            // contenu est retravaillé APRÈS le stream (récupération d'appel-texte + redaction dédiée).
            var liveStreaming = _ollamaSettings.LiveContentStreamingEnabled
                && assistantMode != AssistantMode.StudioBuilder;
            var liveFlushedUpTo = 0;
            var liveStreamedAny = false;
            var liveResetSent = false;
            var liveFlushSw = Stopwatch.StartNew();

            int? effectiveNumCtx = null;
            int effectivePromptChars = 0;
            switch (modelRef.Kind)
            {
            case LlmProviderKind.Ollama:
            {
                var ollamaMessages = AiConversationMessageMapper.BuildOllamaMessages(systemPrompt, conversation, _ollamaSettings.MaxContextMessages, _ollamaSettings.MaxToolResultChars);
                AttachImagesToLastUserOllamaMessage(ollamaMessages, command.Attachments, modelRef.ProviderModelId, toolCallRound);

                effectivePromptChars = toolsApproxChars;
                foreach (var m in ollamaMessages)
                    effectivePromptChars += m.Content?.Length ?? 0;

                effectiveNumCtx = ResolveChatNumCtx(effectivePromptChars, maxTokens, inferenceProfile);
                if (inferenceProfile?.Device == OllamaInferenceDevice.CpuOnly
                    && OllamaChatNumCtxResolver.MayTruncatePrompt(effectivePromptChars, maxTokens, effectiveNumCtx))
                {
                    _logger.LogWarning(
                        "AI chat {CorrelationId} cpu_ctx_may_truncate prompt_chars={PromptChars} num_ctx={NumCtx} tools_exposed={ToolCount} tool_intent={ToolIntent}",
                        correlationId ?? "-",
                        effectivePromptChars,
                        effectiveNumCtx,
                        tools.Count,
                        toolIntent);
                    yield return ChatStreamEvent.PhaseEvent(
                        "content_quality_warning",
                        "completed",
                        detail: "Le contexte est volumineux ; la réponse peut être incomplète.");
                }

                var request = new OllamaChatRequest
                {
                    Model = modelRef.ProviderModelId,
                    Messages = ollamaMessages,
                    Stream = true,
                    Tools = tools,
                    Options = BuildChatOllamaOptions(
                        temperature,
                        maxTokens,
                        effectiveNumCtx,
                        inferenceProfile,
                        seed)
                };

                using (var gateLease = await _ollamaGenerationGate.AcquireAsync(cancellationToken))
                {
                    if (gateLease.WaitMilliseconds >= 1000)
                    {
                        yield return ChatStreamEvent.PhaseEvent(
                            "ollama_queue_wait",
                            "completed",
                            gateLease.WaitMilliseconds);
                    }

                    await foreach (var chunk in _ollamaClient.StreamChatAsync(
                                       request,
                                       cancellationToken,
                                       streamReadTimeout: null,
                                       useGenerationGate: false))
                    {
                        if (chunk.Message?.ToolCalls is { Count: > 0 } toolCalls)
                        {
                            pendingToolCalls ??= new List<OllamaToolCall>();
                            pendingToolCalls.AddRange(toolCalls);
                            if (liveStreamedAny && !liveResetSent)
                            {
                                // Du texte a été streamé avant l'arrivée d'un tool call : préambule de
                                // tour à outils → on vide la bulle (l'indicateur de frappe reprend).
                                liveResetSent = true;
                                yield return ChatStreamEvent.ContentReplace(string.Empty);
                            }
                        }
                        if (!string.IsNullOrEmpty(chunk.Message?.Content))
                        {
                            if (firstTokenMs is null)
                                firstTokenMs = sw.ElapsedMilliseconds;
                            fullContent.Append(chunk.Message.Content);
                            if (liveStreaming && pendingToolCalls is null)
                            {
                                var pendingChars = fullContent.Length - liveFlushedUpTo;
                                if (pendingChars > 0
                                    && (liveFlushSw.ElapsedMilliseconds >= AiLiveContentStreamer.FlushIntervalMs
                                        || pendingChars >= AiLiveContentStreamer.MinFlushChars))
                                {
                                    var snapshot = fullContent.ToString();
                                    if (TryTakeSanitizedLiveSegment(snapshot, ref liveFlushedUpTo, out var segment))
                                    {
                                        liveStreamedAny = true;
                                        totalContentCharsStreamed += segment.Length;
                                        yield return ChatStreamEvent.ContentChunk(segment);
                                    }
                                    liveFlushSw.Restart();
                                }
                            }
                        }
                    }
                }
                break;
            }
            case LlmProviderKind.OpenRouter:
            case LlmProviderKind.Modal:
            {
                var resolved = await ResolveOpenAiCompatibleAsync(modelRef.Kind, conversation.Id, cancellationToken);
                if (resolved is null)
                {
                    yield return ChatStreamEvent.ErrorEvent(
                        modelRef.Kind == LlmProviderKind.Modal
                            ? ModalCredentialMessages.Unavailable()
                            : "Aucune clé API OpenRouter configurée. Configurez-la dans le back-office plateforme > Configuration IA (OpenRouter).");
                    yield break;
                }

                var openAiMessages = AiConversationMessageMapper.BuildOpenAiMessages(systemPrompt, conversation, _ollamaSettings.MaxContextMessages, _ollamaSettings.MaxToolResultChars);
                AttachImagesToLastUserOpenAiMessage(openAiMessages, command.Attachments, modelRef.ProviderModelId, toolCallRound);

                effectivePromptChars = 0;
                foreach (var m in openAiMessages)
                    effectivePromptChars += (m.Content as string)?.Length ?? 0;

                var toolsForCall = modelRef.Kind == LlmProviderKind.Modal && !_modalSettings.EnableTools
                    ? (IReadOnlyList<OllamaToolDefinition>)Array.Empty<OllamaToolDefinition>()
                    : tools;

                await foreach (var chunk in _openAiClient.StreamChatAsOllamaCompatibleAsync(
                    resolved.Value.BaseUrl,
                    resolved.Value.ApiKey,
                    modelRef.ProviderModelId,
                    openAiMessages,
                    toolsForCall,
                    temperature,
                    Math.Max(1, maxTokens),
                    cancellationToken,
                    seed,
                    resolved.Value.Options))
                {
                    if (chunk.Message?.ToolCalls is { Count: > 0 } toolCalls)
                    {
                        pendingToolCalls ??= new List<OllamaToolCall>();
                        pendingToolCalls.AddRange(toolCalls);
                        if (liveStreamedAny && !liveResetSent)
                        {
                            liveResetSent = true;
                            yield return ChatStreamEvent.ContentReplace(string.Empty);
                        }
                    }
                    if (!string.IsNullOrEmpty(chunk.Message?.Content))
                    {
                        if (firstTokenMs is null)
                            firstTokenMs = sw.ElapsedMilliseconds;
                        fullContent.Append(chunk.Message.Content);
                        if (liveStreaming && pendingToolCalls is null)
                        {
                            var pendingChars = fullContent.Length - liveFlushedUpTo;
                            if (pendingChars > 0
                                && (liveFlushSw.ElapsedMilliseconds >= AiLiveContentStreamer.FlushIntervalMs
                                    || pendingChars >= AiLiveContentStreamer.MinFlushChars))
                            {
                                var snapshot = fullContent.ToString();
                                if (TryTakeSanitizedLiveSegment(snapshot, ref liveFlushedUpTo, out var segment))
                                {
                                    liveStreamedAny = true;
                                    totalContentCharsStreamed += segment.Length;
                                    yield return ChatStreamEvent.ContentChunk(segment);
                                }
                                liveFlushSw.Restart();
                            }
                        }
                    }
                }

                break;
            }
            case LlmProviderKind.Cursor:
                yield return ChatStreamEvent.ErrorEvent(
                    "Inférence Cursor inattendue dans la boucle Ollama/OpenRouter.");
                yield break;
            default:
                yield return ChatStreamEvent.ErrorEvent($"Fournisseur LLM non géré : {modelRef.Kind}.");
                yield break;
            }

            // Récupération des appels d'outil émis en TEXTE par le petit modèle (qwen2.5:3b émet
            // parfois { "name": "studio_generate_system", "arguments": {…} } dans le contenu au lieu
            // d'un tool_call structuré). Strictement borné à StudioBuilder + 1er tour (anti-doublon) :
            // on réinjecte l'appel dans le pipeline d'exécution existant plutôt que de diffuser le
            // JSON brut + un faux succès.
            if (assistantMode == AssistantMode.StudioBuilder
                && toolCallRound == 0
                && pendingToolCalls is not { Count: > 0 }
                && fullContent.Length > 0)
            {
                var rawStudio = fullContent.ToString();
                string? recoveredToolName = null;
                string? recoveredSpecJson = null;
                if (StudioTextToolCallRecovery.TryExtract(rawStudio, out var envelopeName, out var envelopeSpec))
                {
                    recoveredToolName = envelopeName;
                    recoveredSpecJson = envelopeSpec;
                }
                else if (StudioTextToolCallRecovery.TryExtractBareStudioSpec(rawStudio, out var bareKind, out var bareSpec))
                {
                    recoveredToolName = StudioTextToolCallRecovery.ResolveToolName(
                        bareKind, _ollamaSettings.EnableStudioAiPlanPreview);
                    recoveredSpecJson = bareSpec;
                }

                if (recoveredToolName is not null && recoveredSpecJson is not null)
                {
                    pendingToolCalls = new List<OllamaToolCall>
                    {
                        new()
                        {
                            Id = Guid.NewGuid().ToString("N")[..12],
                            Function = new OllamaToolCallFunction
                            {
                                Name = recoveredToolName,
                                Arguments = new Dictionary<string, object?> { ["spec_json"] = recoveredSpecJson }
                            }
                        }
                    };
                    fullContent.Clear(); // ne pas laisser fuir l'enveloppe / spec nu comme contenu visible
                }
                else if (StudioTextToolCallRecovery.LooksLikeStudioSpecText(rawStudio))
                {
                    // Message choisi d'après l'intention lue dans le texte : parler de « création du
                    // système » à qui demande un état l'oriente vers une mauvaise reformulation.
                    // Spec incomplet / fence non fermée : message de reformulation, jamais le JSON brut.
                    fullContent.Clear();
                    fullContent.Append(StudioTextToolCallRecovery.ResolveReformulateMessage(null, rawStudio));
                }
            }

            // StudioBuilder : retirer de la prose les fuites internes (noms d'outils studio_*, mentions du
            // JSON) que le petit modèle ajoute parfois malgré le prompt. Sanitize fullContent EN PLACE →
            // couvre le contenu streamé (ContentChunk) ET le corps persisté (else-if fullContent plus bas).
            // Placé APRÈS la récupération d'appel-texte (gardé par pendingToolCalls vide) → aucune interférence.
            if (assistantMode == AssistantMode.StudioBuilder
                && pendingToolCalls is not { Count: > 0 }
                && fullContent.Length > 0)
            {
                var sanitizedStudio = AssistantVisibleContentFormatter.RedactStudioInternalLeaks(fullContent.ToString());
                if (!string.Equals(sanitizedStudio, fullContent.ToString(), StringComparison.Ordinal))
                {
                    fullContent.Clear();
                    fullContent.Append(sanitizedStudio);
                }
            }

            // N'émettre du contenu user-visible qu'au tour final (sans appels d'outils) :
            // les préambules intermédiaires (« Pour… ») ne polluent plus la bulle client.
            if (pendingToolCalls is not { Count: > 0 } && fullContent.Length > 0)
            {
                // StudioBuilder : si le contenu visible contient encore une enveloppe d'outil non
                // exécutée (récupération impossible : tour > 0 ou parse en échec), ne pas diffuser le
                // JSON brut / un faux succès — inviter à reformuler.
                if (assistantMode == AssistantMode.StudioBuilder
                    && (StudioTextToolCallRecovery.TryExtract(fullContent.ToString(), out var leakedTool, out _)
                        || StudioTextToolCallRecovery.LooksLikeStudioSpecText(fullContent.ToString())))
                {
                    // Ce message est une RÉPONSE à part entière : le persister et poser le drapeau,
                    // sinon le filet anti-silence en fin de flux émet un second ContentReplace qui
                    // le recouvre — l'utilisateur voyait alors « créer ce système » sur une demande
                    // d'état.
                    var reformulate = StudioTextToolCallRecovery.ResolveReformulateMessage(
                        leakedTool, fullContent.ToString(), command.Message);
                    totalContentCharsStreamed += reformulate.Length;
                    contentCharsPersisted = reformulate.Length;
                    conversation.AddMessage(MessageRole.Assistant, reformulate);
                    meaningfulResponseDelivered = true;
                    yield return ChatStreamEvent.ContentReplace(reformulate);
                }
                else if (liveStreaming && liveStreamedAny)
                {
                    // Streaming live actif : la réconciliation finale (content_replace avec le corps
                    // post-traité complet) est émise par le bloc de persistance ci-dessous. Si le texte
                    // du round est insuffisant, on vide la bulle pour que la synthèse forcée reprenne
                    // proprement (indicateur de frappe) au lieu de laisser un fragment.
                    var visibleRound = PrepareVisibleAssistantBody(fullContent.ToString(), minMeaningfulTextChars);
                    if (!AssistantVisibleContentFormatter.HasMeaningfulAssistantText(visibleRound, minMeaningfulTextChars))
                        yield return ChatStreamEvent.ContentReplace(string.Empty);
                }
                else
                {
                    var visibleRound = PrepareVisibleAssistantBody(fullContent.ToString(), minMeaningfulTextChars);
                    if (AssistantVisibleContentFormatter.HasMeaningfulAssistantText(visibleRound, minMeaningfulTextChars))
                    {
                        totalContentCharsStreamed += visibleRound.Length;
                        yield return ChatStreamEvent.ContentChunk(visibleRound);
                    }
                }
            }

            _logger.LogInformation(
                "AI chat {CorrelationId} phase=llm_stream_round elapsed_ms={ElapsedMs} round={Round} first_token_ms={FirstTokenMs} had_tool_calls={HadToolCalls} num_ctx_effective={NumCtxEffective} prompt_chars={PromptChars} inference_device={InferenceDevice} num_gpu_effective={NumGpuEffective} prefer_adaptive_ctx={PreferAdaptiveCtx}",
                LogSanitizer.Sanitize(correlationId ?? "-"),
                sw.ElapsedMilliseconds,
                phaseRound,
                firstTokenMs,
                pendingToolCalls is { Count: > 0 },
                effectiveNumCtx,
                effectivePromptChars,
                inferenceProfile?.Device.ToString() ?? "-",
                inferenceProfile?.NumGpu,
                inferenceProfile?.PreferAdaptiveChatNumCtx ?? false);
            yield return ChatStreamEvent.PhaseEvent(
                "llm_stream_round",
                "completed",
                sw.ElapsedMilliseconds,
                phaseRound,
                firstTokenMs,
                pendingToolCalls is { Count: > 0 });

            if (pendingToolCalls is { Count: > 0 })
            {
                continueLoop = true;
                toolCallRound++;
                lastToolRoundHadMeaningfulText = AssistantVisibleContentFormatter.HasMeaningfulAssistantText(
                    fullContent.ToString(),
                    minMeaningfulTextChars);

                EnsureToolCallIds(pendingToolCalls);
                var toolCallsJson = ToolCallsPersistenceHelper.Serialize(pendingToolCalls);
                conversation.AddMessage(MessageRole.Assistant, fullContent.ToString(), toolCallsJson: toolCallsJson);

                // Doublons stricts (même nom + mêmes args) émis dans le même round (ex. forecast_revenue ×3) :
                // exécutés UNE seule fois, le résultat est réutilisé pour chaque doublon. Les events SSE et les
                // messages Tool par call_id sont conservés (contrat historique/LLM inchangé).
                var duplicateCallMap = MapDuplicateToolCalls(pendingToolCalls);

                // ── Pass A : Pré-exécution parallèle (no-DB + read-only DB via scope DI isolé) ──
                var preExecutedResults = new Dictionary<string, AiToolResult>(StringComparer.Ordinal);
                var preExecutedDurations = new Dictionary<string, long>(StringComparer.Ordinal);
                var parallelCalls = pendingToolCalls
                    .Where(tc => tc.Function is not null
                        && !string.IsNullOrEmpty(tc.Id)
                        && !duplicateCallMap.ContainsKey(tc.Id!)
                        // Anti-boucle analyse d'écran : un dashboard déjà accumulé ne se ré-exécute pas (Pass B répond le nudge).
                        && !ShouldShortCircuitScreenAnalysisDashboardCall(isScreenAnalysis, tc.Function.Name, accumulatedDashboardJson)
                        && AiToolParallelEligibility.IsEligible(tc.Function.Name, _ollamaSettings))
                    .ToList();

                if (parallelCalls.Count > 1)
                {
                    var usesDbScope = parallelCalls.Any(tc => AiParallelDbToolPolicy.IsSafe(tc.Function!.Name));
                    var maxConcurrency = usesDbScope
                        ? Math.Clamp(_ollamaSettings.MaxParallelDbTools, 1, 8)
                        : Math.Min(parallelCalls.Count, 4);

                    using var sem = new SemaphoreSlim(Math.Min(parallelCalls.Count, maxConcurrency));
                    var execContext = new AiToolExecutionContext(correlationId, conversation.Id);
                    var tasks = parallelCalls.Select(async tc =>
                    {
                        await sem.WaitAsync(cancellationToken);
                        try
                        {
                            var sw2 = Stopwatch.StartNew();
                            AiToolResult res;
                            try
                            {
                                var toolName = tc.Function!.Name;
                                res = AiParallelDbToolPolicy.IsSafe(toolName)
                                    ? await _toolExecutorScopeFactory.ExecuteAsync(
                                        toolName,
                                        tc.Function.Arguments,
                                        execContext,
                                        cancellationToken)
                                    : await _toolExecutor.ExecuteAsync(
                                        toolName,
                                        tc.Function.Arguments,
                                        execContext,
                                        cancellationToken);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex, "Tool execution failed for {ToolName}", tc.Function!.Name);
                                res = AiToolResult.Error($"Erreur lors de l'exécution: {ex.Message}");
                            }

                            return (tc.Id!, res, sw2.ElapsedMilliseconds);
                        }
                        finally
                        {
                            sem.Release();
                        }
                    });
                    var results = await Task.WhenAll(tasks);
                    foreach (var (id, res, ms) in results)
                    {
                        preExecutedResults[id] = res;
                        preExecutedDurations[id] = ms;
                    }
                }

                // ── Pass B : Itération ordonnée pour préserver l'ordre des events SSE et de la conversation ──
                var completedCallResults = new Dictionary<string, AiToolResult>(StringComparer.Ordinal);
                foreach (var toolCall in pendingToolCalls)
                {
                    if (toolCall.Function is null)
                        continue;

                    var callId = !string.IsNullOrEmpty(toolCall.Id)
                        ? toolCall.Id!
                        : Guid.NewGuid().ToString("N")[..12];

                    yield return ChatStreamEvent.ToolCallStart(toolCall.Function.Name, callId);

                    // Les arguments d'outil peuvent contenir des données métier (spec_json, seed, filtres,
                    // montants) : on ne journalise que les clés et la taille, jamais les valeurs (CWE-532).
                    _logger.LogInformation(
                        "AI chat {CorrelationId} phase=ai_tool_call tool={Tool} call_id={CallId} arg_keys={ArgKeys} arg_bytes={ArgBytes}",
                        LogSanitizer.Sanitize(correlationId ?? "-"),
                        toolCall.Function.Name,
                        callId,
                        DescribeToolArgumentKeys(toolCall.Function.Arguments),
                        MeasureToolArgumentBytes(toolCall.Function.Arguments));

                    AiToolResult toolResult;
                    long toolElapsedMs;
                    var wasDeduplicated = false;
                    // Anti-boucle analyse d'écran : le petit modèle rappelle generate_dashboard_config au lieu
                    // de rédiger l'analyse. Une fois un dashboard accumulé, les appels suivants reçoivent un
                    // message déterministe qui le pousse à écrire — sans ré-exécution ni second événement SSE.
                    var dashboardShortCircuited = ShouldShortCircuitScreenAnalysisDashboardCall(
                        isScreenAnalysis, toolCall.Function.Name, accumulatedDashboardJson);
                    bool wasParallel = preExecutedResults.TryGetValue(callId, out var preResult) && !dashboardShortCircuited;
                    if (dashboardShortCircuited)
                    {
                        toolResult = AiToolResult.Ok(ScreenAnalysisDashboardAlreadyGeneratedMessage);
                        toolElapsedMs = 0;
                    }
                    else if (wasParallel)
                    {
                        toolResult = preResult!;
                        toolElapsedMs = preExecutedDurations.TryGetValue(callId, out var d) ? d : 0;
                    }
                    else if (duplicateCallMap.TryGetValue(callId, out var canonicalCallId)
                        && completedCallResults.TryGetValue(canonicalCallId, out var canonicalResult))
                    {
                        // Doublon strict : réutilise le résultat du 1er appel équivalent (aucune ré-exécution).
                        toolResult = canonicalResult;
                        toolElapsedMs = 0;
                        wasDeduplicated = true;
                    }
                    else
                    {
                        var toolSw = Stopwatch.StartNew();
                        try
                        {
                            toolResult = await _toolExecutor.ExecuteAsync(
                                toolCall.Function.Name,
                                toolCall.Function.Arguments,
                                new AiToolExecutionContext(correlationId, conversation.Id),
                                cancellationToken);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Tool execution failed for {ToolName}", toolCall.Function.Name);
                            toolResult = AiToolResult.Error($"Erreur lors de l'exécution: {ex.Message}");
                        }
                        toolElapsedMs = toolSw.ElapsedMilliseconds;
                    }

                    completedCallResults[callId] = toolResult;

                    _logger.LogInformation(
                        "AI chat {CorrelationId} phase=ai_tool_execute elapsed_ms={ElapsedMs} tool={Tool} call_id={CallId} parallel={Parallel} dedup={Dedup}",
                        LogSanitizer.Sanitize(correlationId ?? "-"),
                        toolElapsedMs,
                        toolCall.Function.Name,
                        callId,
                        wasParallel,
                        wasDeduplicated);

                    var resultContent = toolResult.Success
                        ? toolResult.Data
                        : $"Erreur: {toolResult.ErrorMessage}";

                    conversation.AddMessage(MessageRole.Tool, resultContent, toolCall.Function.Name, callId);
                    toolsExecutedThisRequest++;
                    // Lot 1.3 : une lecture get_firm_* réussie et exploitable ancre le tour (y compris
                    // via la boucle normale, pas seulement le raccourci). Compteur lu par le gate.
                    if (AiParallelDbToolPolicy.IsFirmReadOnly(toolCall.Function.Name) && toolResult.IsGrounded)
                        firmGroundedReads++;
                    yield return ChatStreamEvent.ToolCallEnd(toolCall.Function.Name, callId, toolElapsedMs);
                    toolSourcesForClient.Add(new SourceEntryDto(toolCall.Function.Name, callId));
                    if (toolCall.Function.Name == "propose_client_actions" && toolResult.Success &&
                        !string.IsNullOrWhiteSpace(toolResult.Data))
                        yield return ChatStreamEvent.ClientActionsEvent(toolResult.Data);
                    if (toolCall.Function.Name == FirmAgentTools.SendReminder && toolResult.Success &&
                        FirmReminderClientActionExtractor.TryBuildClientActionsJson(toolResult.Data, out var firmReminderActionsJson))
                        yield return ChatStreamEvent.ClientActionsEvent(firmReminderActionsJson!);
                    if (toolCall.Function.Name == "propose_follow_up_prompts" && toolResult.Success &&
                        !string.IsNullOrWhiteSpace(toolResult.Data))
                    {
                        yield return ChatStreamEvent.SuggestedPromptsEvent(toolResult.Data);
                        try
                        {
                            using var promptsDoc = JsonDocument.Parse(toolResult.Data);
                            if (promptsDoc.RootElement.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var el in promptsDoc.RootElement.EnumerateArray())
                                {
                                    if (el.ValueKind != JsonValueKind.String)
                                        continue;
                                    var s = el.GetString();
                                    if (string.IsNullOrEmpty(s) || accumulatedSuggestedPrompts.Contains(s))
                                        continue;
                                    accumulatedSuggestedPrompts.Add(s);
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Impossible d'extraire les suggestions de suivi pour la persistance.");
                        }
                    }
                    if (!dashboardShortCircuited
                        && toolCall.Function.Name == "generate_dashboard_config" && toolResult.Success &&
                        !string.IsNullOrWhiteSpace(toolResult.Data))
                    {
                        accumulatedDashboardJson = toolResult.Data;
                        yield return ChatStreamEvent.DashboardEvent(toolResult.Data);
                    }
                    if ((toolCall.Function.Name == "studio_generate_app" || toolCall.Function.Name == "studio_generate_system")
                        && toolResult.Success && !string.IsNullOrWhiteSpace(toolResult.Data))
                    {
                        foreach (var progressEv in TryBuildStudioProgressEvents(toolResult.Data))
                            yield return progressEv;
                        var openAction = TryBuildStudioClientActions(toolResult.Data);
                        if (openAction is not null)
                            yield return ChatStreamEvent.ClientActionsEvent(openAction);
                    }
                    else if ((toolCall.Function.Name == "studio_generate_app" || toolCall.Function.Name == "studio_generate_system")
                        && !toolResult.Success && assistantMode == AssistantMode.StudioBuilder)
                    {
                        // Capturer l'erreur réelle (ex. « Limite du plan atteinte : 50 tables maximum… ») pour
                        // l'afficher telle quelle après la boucle, au lieu de la paraphrase du petit modèle.
                        studioBuilderToolError = string.IsNullOrWhiteSpace(toolResult.ErrorMessage)
                            ? "La création du système a échoué."
                            : toolResult.ErrorMessage;
                    }
                    // Flux plan → aperçu → confirmation : le payload du plan est poussé au client
                    // (événement studio_plan) pour afficher la carte d'aperçu avec Valider/Annuler.
                    // R7/PR 2.4 : la liste est centralisée dans AiToolRegistry.StudioPlanEmittingTools
                    // (couvre désormais aussi studio_plan_changes et studio_plan_view — un seul
                    // événement par appel, ce bloc n'étant exécuté qu'une fois par outil).
                    if (AiToolRegistry.StudioPlanEmittingTools.Contains(toolCall.Function.Name)
                        && toolResult.Success && !string.IsNullOrWhiteSpace(toolResult.Data))
                    {
                        yield return ChatStreamEvent.StudioPlanEvent(toolResult.Data);
                    }
                    // État calculé en lecture seule : le tableau est poussé au client pour rendu
                    // immédiat (aucun enregistrement, aucune confirmation à demander).
                    else if (toolCall.Function.Name == "studio_run_report"
                        && toolResult.Success && !string.IsNullOrWhiteSpace(toolResult.Data))
                    {
                        yield return ChatStreamEvent.StudioReportResultEvent(toolResult.Data);
                    }
                    else if (toolCall.Function.Name is "studio_run_report" or "studio_plan_report"
                        && !toolResult.Success && assistantMode == AssistantMode.StudioBuilder)
                    {
                        studioBuilderToolError = string.IsNullOrWhiteSpace(toolResult.ErrorMessage)
                            ? "Le calcul de l'état a échoué."
                            : toolResult.ErrorMessage;
                        // Le préréglage tenté n'est pas connu ici (c'est le modèle qui a rédigé la
                        // spécification) : les suggestions sont déduites du message de l'utilisateur.
                        studioReportFailureJson = JsonSerializer.Serialize(
                            StudioReportFailure.Build(command.Message, studioBuilderToolError),
                            SourcesJsonOptions);
                    }
                    else if ((toolCall.Function.Name == "studio_plan_app" || toolCall.Function.Name == "studio_plan_system"
                                || toolCall.Function.Name == "studio_plan_record_view" || toolCall.Function.Name == "studio_plan_workflow")
                        && !toolResult.Success && assistantMode == AssistantMode.StudioBuilder)
                    {
                        studioBuilderToolError = string.IsNullOrWhiteSpace(toolResult.ErrorMessage)
                            ? "La préparation du plan a échoué."
                            : toolResult.ErrorMessage;
                    }
                }
            }
            else if (fullContent.Length > 0)
            {
                var assistantBody = BuildFinalAssistantBodyWithAppendices(
                    fullContent.ToString(),
                    minMeaningfulTextChars,
                    accumulatedDashboardJson,
                    accumulatedSuggestedPrompts);
                var leakClean = TryBuildLeakReplacementBody(
                    assistantBody,
                    conversation,
                    command.Message,
                    toolIntent,
                    toolsExecutedThisRequest > 0,
                    minMeaningfulTextChars,
                    accumulatedDashboardJson,
                    accumulatedSuggestedPrompts);
                if (leakClean is not null)
                {
                    // Une fuite de nom d'outil a été neutralisée : on remplace le contenu déjà streamé côté client.
                    assistantBody = leakClean;
                    deterministicFallbackUsed = true;
                    yield return ChatStreamEvent.ContentReplace(assistantBody);
                }
                if (AssistantVisibleContentFormatter.HasMeaningfulAssistantText(assistantBody, minMeaningfulTextChars))
                {
                    // Lot 1.3 : grounding gate — une réponse firm non ancrée n'est PAS persistée (le bloc
                    // de synthèse de secours plus bas tente une lecture puis une synthèse, sinon persiste
                    // le repli honnête et ContentReplace écrase la prose déjà streamée). Gate désactivé ou
                    // autre scope ⇒ comportement strictement identique à aujourd'hui.
                    if (!ShouldRejectUngroundedFirmAnswer(agentScope, firmGroundedReads, firmTurnNeedsData, _ollamaSettings.FirmMissionGroundingGateEnabled))
                    {
                        contentCharsPersisted = assistantBody.Length;
                        conversation.AddMessage(MessageRole.Assistant, assistantBody);
                        meaningfulResponseDelivered = true;
                        // Réconciliation du streaming live : le corps final post-traité (appendices,
                        // humanisation, assainissement complet) remplace les segments streamés. Sans
                        // streaming live, l'unique ContentChunk du round a déjà livré ce contenu.
                        if (liveStreaming && liveStreamedAny && leakClean is null)
                            yield return ChatStreamEvent.ContentReplace(assistantBody);
                    }
                }
            }
        }

        // StudioBuilder : un outil studio_generate_* a échoué → afficher l'erreur RÉELLE comme contenu
        // final (le ContentReplace recouvre la paraphrase éventuelle du modèle) et couper la synthèse.
        if (studioBuilderToolError is not null)
        {
            // Un échec d'ÉTAT part dans sa propre carte : l'interface montre ce qui a été tenté et
            // par quoi le remplacer, au lieu d'une ligne d'erreur déguisée en réponse d'assistant.
            if (studioReportFailureJson is not null)
                yield return ChatStreamEvent.StudioReportErrorEvent(studioReportFailureJson);

            yield return ChatStreamEvent.ContentReplace(studioBuilderToolError);
            if (!meaningfulResponseDelivered)
            {
                conversation.AddMessage(MessageRole.Assistant, studioBuilderToolError);
                meaningfulResponseDelivered = true;
            }
        }

        // ── Filet de synthèse finale : aucune réponse visible complète après exécution d'outils ───────
        // Lot 1.3 : éligibilité étendue au cas firm non ancré — une réponse firm a été rejetée par le
        // gate (non persistée) alors que la question demande des données : on déclenche la synthèse de
        // secours (lecture de secours + génération) SANS changer le défaut global ForceFinalSynthesisOnlyAfterTools
        // ni la signature/valeur par défaut de ShouldForceFinalSynthesis.
        var firmUngroundedNeedsSynthesis = ShouldRejectUngroundedFirmAnswer(
            agentScope, firmGroundedReads, firmTurnNeedsData, _ollamaSettings.FirmMissionGroundingGateEnabled)
            && !meaningfulResponseDelivered;
        if (!conversationalFastPath
            && (ShouldForceFinalSynthesis(
                isScreenAnalysis,
                _ollamaSettings.ForceFinalSynthesis,
                meaningfulResponseDelivered,
                toolsExecutedThisRequest > 0,
                _ollamaSettings.ForceFinalSynthesisOnlyAfterTools,
                _screenAnalysisOptions.ForceFinalSynthesisEnabled,
                assistantMode == AssistantMode.StudioBuilder)
                || firmUngroundedNeedsSynthesis))
        {
            forcedSynthesisTriggered = true;
            sw.Restart();

            // ── Lot 1.3 : secours firm — aucune lecture ancrée ce tour ────────────────────────────
            // Une seule tentative, jamais de boucle : on pré-appelle get_firm_portfolio_overview (lecture
            // la plus large) ; si elle réussit et est exploitable, firmGroundedReads passe à ≥ 1 et la
            // synthèse de secours peut s'appuyer sur une vraie donnée. L'appel d'outil N'est PAS compté
            // dans le budget de générations LLM (seul l'est l'appel de synthèse qui suit, via
            // IsFirmTurnGenerationBudgetExhausted). Si le secours échoue aussi, la synthèse est sautée et
            // le repli honnête déterministe est persisté (plus bas).
            if (firmUngroundedNeedsSynthesis)
            {
                var rescueToolName = FirmAgentTools.PortfolioOverview;
                var rescueCallId = Guid.NewGuid().ToString("N")[..12];
                yield return ChatStreamEvent.ToolCallStart(rescueToolName, rescueCallId);
                var rescueSw = Stopwatch.StartNew();
                AiToolResult rescueResult;
                try
                {
                    rescueResult = await _toolExecutor.ExecuteAsync(
                        rescueToolName,
                        new Dictionary<string, object?>(),
                        new AiToolExecutionContext(correlationId, conversation.Id),
                        cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Firm rescue tool failed for {ToolName}", rescueToolName);
                    rescueResult = AiToolResult.Error($"Erreur lors de l'exécution: {ex.Message}");
                }

                var rescueContent = rescueResult.Success
                    ? rescueResult.Data ?? string.Empty
                    : $"Erreur: {rescueResult.ErrorMessage}";
                conversation.AddMessage(MessageRole.Tool, rescueContent, rescueToolName, rescueCallId);
                toolsExecutedThisRequest++;
                toolSourcesForClient.Add(new SourceEntryDto(rescueToolName, rescueCallId));
                if (rescueResult.IsGrounded)
                    firmGroundedReads++;
                yield return ChatStreamEvent.ToolCallEnd(rescueToolName, rescueCallId, rescueSw.ElapsedMilliseconds);
            }

            // Budget de générations explicite (Lot 2.2) : pour le tour firm, au plus 2 générations
            // LLM au total (round outils + rédaction). Si le budget est déjà épuisé, on NE lance PAS
            // cette synthèse forcée — synthContent reste vide et le mécanisme de repli déterministe
            // existant (AssistantDeterministicFallback.TryBuild + ContentReplace, ci-dessous) prend le
            // relais sans 3ᵉ génération. Autres scopes : compteur journalisé seulement, comportement
            // inchangé (jamais bloqué ici).
            var firmGenerationBudgetExhausted = IsFirmTurnGenerationBudgetExhausted(agentScope, llmGenerationsThisTurn);
            // Lot 1.3 : si le secours firm a échoué (firmGroundedReads toujours à 0 après la lecture de
            // secours), on ne tente PAS une synthèse non ancrée — le repli honnête déterministe (plus
            // bas) est persisté directement. L'appel d'outil de secours n'a pas épuisé le budget LLM.
            var firmRescueFailed = firmUngroundedNeedsSynthesis && firmGroundedReads <= 0;
            var firmSynthesisBlocked = firmGenerationBudgetExhausted || firmRescueFailed;
            if (firmGenerationBudgetExhausted)
            {
                _logger.LogInformation(
                    "AI chat {CorrelationId} firm_llm_generation_budget_exhausted generations={Generations} forced_synthesis_skipped=true",
                    correlationId ?? "-",
                    llmGenerationsThisTurn);
            }
            else if (firmRescueFailed)
            {
                _logger.LogInformation(
                    "AI chat {CorrelationId} firm_rescue_failed grounded_reads={GroundedReads} forced_synthesis_skipped=true",
                    correlationId ?? "-",
                    firmGroundedReads);
            }
            else
            {
                llmGenerationsThisTurn++;
            }
            if (!firmSynthesisBlocked)
                yield return ChatStreamEvent.PhaseEvent("llm_forced_synthesis", "running");
            var synthContent = new System.Text.StringBuilder();
            // Streaming live de la synthèse : aucun outil attaché à cet appel → pas de reset possible ;
            // le ContentReplace(synthBody) final réconcilie comme pour le round principal.
            var synthLive = _ollamaSettings.LiveContentStreamingEnabled
                && assistantMode != AssistantMode.StudioBuilder;
            var synthFlushedUpTo = 0;
            var synthStreamedAny = false;
            var synthFlushSw = Stopwatch.StartNew();
            // Analyse d'écran : consigne dédiée (rédiger les 7 sections, aucun outil) ; le littéral
            // historique du mode Default reste strictement inchangé.
            var synthSystemPrompt = isScreenAnalysis
                ? systemPrompt + "\n\n" + AiScreenAnalysisPromptBuilder.ForcedSynthesisSection
                : toolsExecutedThisRequest > 0
                    ? systemPrompt + "\n\nSYNTHÈSE FINALE : Des résultats d'outils sont dans l'historique. "
                      + "Synthétise-les en français avec montants TND. Uniquement en français, sans traduction. "
                      + "Ne redemande pas la période si l'utilisateur a dit « aujourd'hui »."
                    : systemPrompt;

            if (!firmSynthesisBlocked)
            switch (modelRef.Kind)
            {
            case LlmProviderKind.Ollama:
            {
                var synthMessages = AiConversationMessageMapper.BuildOllamaMessages(synthSystemPrompt, conversation, _ollamaSettings.MaxContextMessages, _ollamaSettings.MaxToolResultChars);

                var synthPromptChars = 0;
                foreach (var m in synthMessages)
                    synthPromptChars += m.Content?.Length ?? 0;
                var synthNumCtx = ResolveChatNumCtx(synthPromptChars, maxTokens, inferenceProfile);

                var synthRequest = new OllamaChatRequest
                {
                    Model = modelRef.ProviderModelId,
                    Messages = synthMessages,
                    Stream = true,
                    Tools = null,
                    Options = BuildChatOllamaOptions(
                        temperature,
                        maxTokens,
                        synthNumCtx,
                        inferenceProfile,
                        seed)
                };

                using (var gateLease = await _ollamaGenerationGate.AcquireAsync(cancellationToken))
                {
                    if (gateLease.WaitMilliseconds >= 1000)
                    {
                        yield return ChatStreamEvent.PhaseEvent(
                            "ollama_queue_wait",
                            "completed",
                            gateLease.WaitMilliseconds);
                    }

                    await foreach (var chunk in _ollamaClient.StreamChatAsync(
                                       synthRequest,
                                       cancellationToken,
                                       streamReadTimeout: null,
                                       useGenerationGate: false))
                    {
                        if (string.IsNullOrEmpty(chunk.Message?.Content))
                            continue;
                        synthContent.Append(chunk.Message.Content);
                        if (!synthLive)
                            continue;
                        var pendingChars = synthContent.Length - synthFlushedUpTo;
                        if (pendingChars > 0
                            && (synthFlushSw.ElapsedMilliseconds >= AiLiveContentStreamer.FlushIntervalMs
                                || pendingChars >= AiLiveContentStreamer.MinFlushChars))
                        {
                            var snapshot = synthContent.ToString();
                            if (TryTakeSanitizedLiveSegment(snapshot, ref synthFlushedUpTo, out var segment))
                            {
                                synthStreamedAny = true;
                                totalContentCharsStreamed += segment.Length;
                                yield return ChatStreamEvent.ContentChunk(segment);
                            }
                            synthFlushSw.Restart();
                        }
                    }
                }

                break;
            }
            case LlmProviderKind.OpenRouter:
            case LlmProviderKind.Modal:
            {
                var resolved = await ResolveOpenAiCompatibleAsync(modelRef.Kind, conversation.Id, cancellationToken);
                if (resolved is null)
                    break;

                var synthMessages = AiConversationMessageMapper.BuildOpenAiMessages(synthSystemPrompt, conversation, _ollamaSettings.MaxContextMessages, _ollamaSettings.MaxToolResultChars);

                await foreach (var chunk in _openAiClient.StreamChatAsOllamaCompatibleAsync(
                    resolved.Value.BaseUrl,
                    resolved.Value.ApiKey,
                    modelRef.ProviderModelId,
                    synthMessages,
                    new List<OllamaToolDefinition>(),
                    temperature,
                    Math.Max(1, maxTokens),
                    cancellationToken,
                    seed,
                    resolved.Value.Options))
                {
                    if (string.IsNullOrEmpty(chunk.Message?.Content))
                        continue;
                    synthContent.Append(chunk.Message.Content);
                    if (!synthLive)
                        continue;
                    var pendingChars = synthContent.Length - synthFlushedUpTo;
                    if (pendingChars > 0
                        && (synthFlushSw.ElapsedMilliseconds >= AiLiveContentStreamer.FlushIntervalMs
                            || pendingChars >= AiLiveContentStreamer.MinFlushChars))
                    {
                        var snapshot = synthContent.ToString();
                        if (TryTakeSanitizedLiveSegment(snapshot, ref synthFlushedUpTo, out var segment))
                        {
                            synthStreamedAny = true;
                            totalContentCharsStreamed += segment.Length;
                            yield return ChatStreamEvent.ContentChunk(segment);
                        }
                        synthFlushSw.Restart();
                    }
                }

                break;
            }
            case LlmProviderKind.Cursor:
            {
                var cursorCreds = await _platformAiSettings.GetCursorCredentialsAsync(cancellationToken);
                if (string.IsNullOrEmpty(cursorCreds.ApiKey))
                    break;

                var synthRunId = Guid.NewGuid();
                var synthScratch = CreateCursorScratchDirectory(synthRunId);
                string? cursorSynthText = null;
                try
                {
                    var synthUser = AiConversationMessageMapper.BuildCursorUserMessage(
                        synthSystemPrompt,
                        conversation,
                        _ollamaSettings.MaxContextMessages,
                        _ollamaSettings.MaxToolResultChars);
                    cursorSynthText = await _cursorAgentClient.ExtractAsync(
                        new CursorExtractRequest(
                            cursorCreds.ApiKey,
                            modelRef,
                            synthSystemPrompt,
                            synthUser,
                            Array.Empty<CursorImagePayload>(),
                            synthScratch),
                        cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "AI chat {CorrelationId} Cursor synthesis failed", correlationId ?? "-");
                }
                finally
                {
                    TryDeleteScratchDirectory(synthScratch);
                }

                if (!string.IsNullOrEmpty(cursorSynthText))
                {
                    synthContent.Append(cursorSynthText);
                    if (synthLive)
                    {
                        synthStreamedAny = true;
                        totalContentCharsStreamed += cursorSynthText.Length;
                        yield return ChatStreamEvent.ContentChunk(cursorSynthText);
                    }
                }

                break;
            }
            default:
                _logger.LogWarning(
                    "AI chat {CorrelationId} synthèse : fournisseur {Kind} non géré",
                    correlationId ?? "-",
                    modelRef.Kind);
                break;
            }

            if (!firmSynthesisBlocked)
            {
                // Lot 3.1 — mesure READ-ONLY : borne la phase llm_forced_synthesis dans le journal serveur
                // (l'événement SSE ci-dessous la porte aussi au client). sw a été redémarré avant le secours.
                LogPhase("llm_forced_synthesis", sw.ElapsedMilliseconds);
                yield return ChatStreamEvent.PhaseEvent("llm_forced_synthesis", "completed", sw.ElapsedMilliseconds);
            }

            var synthBody = synthContent.Length > 0
                ? BuildFinalAssistantBodyWithAppendices(
                    synthContent.ToString(),
                    minMeaningfulTextChars,
                    accumulatedDashboardJson,
                    accumulatedSuggestedPrompts)
                : string.Empty;

            // Analyse d'écran : le fallback générique est écarté au profit du filet TEXTE dédié
            // (TryBuildAnalysisTextFromSnapshot, plus bas) construit depuis le snapshot de l'écran.
            if (!isScreenAnalysis
                && !AssistantVisibleContentFormatter.HasMeaningfulAssistantText(synthBody, minMeaningfulTextChars))
            {
                var fallback = AssistantDeterministicFallback.TryBuild(
                    conversation,
                    command.Message,
                    minMeaningfulTextChars,
                    _ollamaSettings.DeterministicFallbackEnabled,
                    toolsExecutedThisRequest > 0,
                    toolIntent);
                if (!string.IsNullOrWhiteSpace(fallback))
                {
                    synthBody = BuildFinalAssistantBodyWithAppendices(
                        fallback,
                        minMeaningfulTextChars,
                        accumulatedDashboardJson,
                        accumulatedSuggestedPrompts);
                    deterministicFallbackUsed = true;
                }
            }

            var synthLeakClean = TryBuildLeakReplacementBody(
                synthBody,
                conversation,
                command.Message,
                toolIntent,
                toolsExecutedThisRequest > 0,
                minMeaningfulTextChars,
                accumulatedDashboardJson,
                accumulatedSuggestedPrompts);
            if (synthLeakClean is not null)
            {
                synthBody = synthLeakClean;
                deterministicFallbackUsed = true;
            }

            // Lot 1.3 : repli honnête firm — si après la lecture de secours aucune lecture n'est ancrée
            // (firmRescueFailed), la prose — initiale ou de synthèse — ne doit PAS être persistée : on la
            // remplace par un message honnête explicite plutôt que de laisser le modèle répondre de
            // mémoire. Prend le pas sur le repli générique (TryBuild) et l'assainissement ci-dessus.
            if (firmRescueFailed)
            {
                synthBody = BuildFinalAssistantBodyWithAppendices(
                    FirmUngroundedFallbackMessage,
                    minMeaningfulTextChars,
                    accumulatedDashboardJson,
                    accumulatedSuggestedPrompts);
                deterministicFallbackUsed = true;
            }

            // StudioBuilder : même assainissement des fuites internes sur la synthèse forcée (cas rare).
            if (assistantMode == AssistantMode.StudioBuilder && !string.IsNullOrWhiteSpace(synthBody))
                synthBody = AssistantVisibleContentFormatter.RedactStudioInternalLeaks(synthBody);

            // Analyse d'écran : une synthèse sous le seuil de prose visible ne doit PAS être persistée —
            // elle marquerait meaningfulResponseDelivered et affamerait le filet TEXTE déterministe,
            // re-déclenchant le bouchon frontend. Pour les autres modes : condition historique inchangée.
            var synthDeliverable = !string.IsNullOrWhiteSpace(synthBody)
                && (!isScreenAnalysis
                    || AssistantVisibleContentFormatter.HasMeaningfulAssistantText(synthBody, minMeaningfulTextChars));
            if (synthDeliverable)
            {
                contentCharsPersisted = synthBody.Length;
                totalContentCharsStreamed += synthBody.Length;
                conversation.AddMessage(MessageRole.Assistant, synthBody);
                meaningfulResponseDelivered = true;
                yield return ChatStreamEvent.ContentReplace(synthBody);
            }
            else if (synthStreamedAny)
            {
                // Rien d'exploitable après post-traitement : ne pas laisser des fragments streamés.
                yield return ChatStreamEvent.ContentReplace(string.Empty);
            }
        }

        if (isScreenAnalysis && _screenAnalysisOptions.PostProcessToolsEnabled)
        {
            if (accumulatedSuggestedPrompts.Count == 0)
            {
                var promptsJson = AiScreenAnalysisPostProcessor.BuildDefaultFollowUpPromptsJson(screenId);
                var followUpResult = await _toolExecutor.ExecuteAsync(
                    "propose_follow_up_prompts",
                    new Dictionary<string, object?> { ["prompts_json"] = promptsJson },
                    new AiToolExecutionContext(correlationId, conversation.Id),
                    cancellationToken);
                if (followUpResult.Success && !string.IsNullOrWhiteSpace(followUpResult.Data))
                {
                    yield return ChatStreamEvent.SuggestedPromptsEvent(followUpResult.Data);
                    TryAccumulateSuggestedPrompts(followUpResult.Data, accumulatedSuggestedPrompts);
                }
            }

            if (string.IsNullOrEmpty(accumulatedDashboardJson))
            {
                var dashboardJson = AiScreenAnalysisPostProcessor.TryBuildDashboardFromSnapshot(
                    command.UiContext?.AnalysisSummary,
                    screenId,
                    _screenAnalysisOptions);
                if (!string.IsNullOrEmpty(dashboardJson))
                {
                    accumulatedDashboardJson = dashboardJson;
                    yield return ChatStreamEvent.DashboardEvent(dashboardJson);
                }
            }

            // ── Filet TEXTE analyse d'écran : ni le modèle ni la synthèse forcée n'ont livré de prose
            // visible — sans lui, le frontend affiche le bouchon « Analyse disponible dans le tableau
            // de bord… ». Sections factuelles construites depuis le snapshot, zéro appel LLM.
            if (!meaningfulResponseDelivered)
            {
                var fallbackText = AiScreenAnalysisPostProcessor.TryBuildAnalysisTextFromSnapshot(
                    command.UiContext?.AnalysisSummary,
                    screenId,
                    _screenAnalysisOptions);
                if (!string.IsNullOrWhiteSpace(fallbackText))
                {
                    var fallbackBody = BuildFinalAssistantBodyWithAppendices(
                        fallbackText,
                        minMeaningfulTextChars,
                        accumulatedDashboardJson,
                        accumulatedSuggestedPrompts);
                    contentCharsPersisted = fallbackBody.Length;
                    totalContentCharsStreamed += fallbackBody.Length;
                    conversation.AddMessage(MessageRole.Assistant, fallbackBody);
                    meaningfulResponseDelivered = true;
                    deterministicFallbackUsed = true;
                    yield return ChatStreamEvent.ContentReplace(fallbackBody);
                }
            }
        }

        // StudioBuilder : filet anti-silence. Si, après tout, rien de visible n'a été livré (le petit
        // modèle n'a ni exécuté d'outil, ni produit de texte exploitable), garantir une réponse claire
        // au lieu d'une bulle vide.
        if (assistantMode == AssistantMode.StudioBuilder && !meaningfulResponseDelivered)
        {
            // Le libellé suit l'INTENTION lue dans la demande de l'utilisateur : parler de création
            // de système à qui réclame un état l'oriente vers une mauvaise reformulation.
            var fallback = StudioReportIntentRouter.LooksLikeReportRequest(command.Message)
                ? StudioTextToolCallRecovery.ReformulateReportMessage
                : StudioBuilderSilenceFallback;
            contentCharsPersisted = fallback.Length;
            conversation.AddMessage(MessageRole.Assistant, fallback);
            meaningfulResponseDelivered = true;
            yield return ChatStreamEvent.ContentReplace(fallback);

            // Chemin jusqu'ici MUET dans les logs : il ne se détectait qu'à la signature
            // content_chars_persisted=0. On le nomme, pour pouvoir le compter.
            _logger.LogWarning(
                "AI chat {CorrelationId} studio_silence_fallback report_intent={ReportIntent} tools_executed={ToolsExecuted} rounds={Rounds}",
                correlationId ?? "-",
                StudioReportIntentRouter.LooksLikeReportRequest(command.Message),
                toolsExecutedThisRequest,
                toolCallRound);

            // Repartir avec des formulations qui fonctionnent plutôt qu'un conseil générique.
            var suggestions = StudioReportIntentRouter.ToPromptSuggestions(
                StudioReportIntentRouter.SuggestPresets(command.Message));
            if (suggestions.Count > 0)
                yield return ChatStreamEvent.SuggestedPromptsEvent(JsonSerializer.Serialize(suggestions));
        }

        sw.Restart();
        yield return ChatStreamEvent.PhaseEvent("persist_conversation", "running");
        // Persistance batchée : on persiste explicitement avec CancellationToken.None pour que
        // la sauvegarde aboutisse même si le client a coupé la connexion entre-temps (Stop).
        // Cela garantit que les messages assistant/tool produits restent dans la base.
        if (isNewConversation && deferUserPersist)
            await _conversationRepository.AddAsync(conversation, CancellationToken.None);
        else
            await _conversationRepository.UpdateAsync(conversation, CancellationToken.None);
        LogPhase("persist_conversation", sw.ElapsedMilliseconds);
        yield return ChatStreamEvent.PhaseEvent(
            "persist_conversation",
            "completed",
            sw.ElapsedMilliseconds);

        _logger.LogInformation(
            "AI chat {CorrelationId} phase=total_request elapsed_ms={ElapsedMs} conversation_id={ConversationId} model={Model} tool_intent={ToolIntent} conversational_fast_path={ConversationalFastPath} tool_rounds_executed={ToolRounds} tools_executed_this_request={ToolsExecutedThisRequest} forced_synthesis_triggered={ForcedSynthesisTriggered} deterministic_fallback_used={DeterministicFallbackUsed} final_response_meaningful={FinalResponseMeaningful} content_chars_streamed={ContentCharsStreamed} content_chars_persisted={ContentCharsPersisted} llm_generations_this_turn={LlmGenerationsThisTurn} agent_scope={AgentScope} firm_grounded_reads={FirmGroundedReads}",
            LogSanitizer.Sanitize(correlationId ?? "-"),
            total.ElapsedMilliseconds,
            conversation.Id,
            modelRef.CanonicalModelRef,
            toolIntent,
            conversationalFastPath,
            toolCallRound,
            toolsExecutedThisRequest,
            forcedSynthesisTriggered,
            deterministicFallbackUsed,
            meaningfulResponseDelivered,
            totalContentCharsStreamed,
            contentCharsPersisted,
            llmGenerationsThisTurn,
            agentScope,
            firmGroundedReads);
        yield return ChatStreamEvent.PhaseEvent(
            "total_request",
            "completed",
            total.ElapsedMilliseconds,
            hadToolCalls: toolCallRound > 0,
            detail: modelRef.CanonicalModelRef);

        if (toolSourcesForClient.Count > 0)
        {
            var srcJson = JsonSerializer.Serialize(toolSourcesForClient, SourcesJsonOptions);
            yield return ChatStreamEvent.SourcesEvent(srcJson);
        }

        yield return ChatStreamEvent.Done(conversation.Id);
    }

    /// <summary>
    /// Détermine si le filet de synthèse finale doit se déclencher lorsqu'aucune réponse visible complète
    /// n'a encore été livrée au client (optionnellement seulement après exécution d'outils).
    /// L'analyse d'écran est éligible uniquement si <paramref name="screenAnalysisForceFinalSynthesisEnabled"/>
    /// (ScreenAnalysis.ForceFinalSynthesisEnabled) est vrai — défaut du paramètre false : les appels 5-args
    /// existants conservent la sémantique historique à l'identique (ScreenAnalysis exclu).
    /// </summary>
    public static bool ShouldForceFinalSynthesis(
        bool isScreenAnalysis,
        bool forceEnabled,
        bool meaningfulResponseDelivered,
        bool toolsWereExecuted,
        bool onlyAfterTools,
        bool screenAnalysisForceFinalSynthesisEnabled = false,
        bool isStudioBuilder = false)
        => (!isScreenAnalysis || screenAnalysisForceFinalSynthesisEnabled)
           && forceEnabled
           && !meaningfulResponseDelivered
           // Studio : le mode qui a le plus besoin du filet en était le seul privé. Quand aucun outil
           // ne tourne, `onlyAfterTools` coupait la seule seconde chance et la réponse tombait dans le
           // filet anti-silence. Paramètre optionnel en fin de signature : les autres appelants et
           // leurs tests gardent la sémantique historique à l'identique.
           && (!onlyAfterTools || toolsWereExecuted || isStudioBuilder);

    /// <summary>
    /// Détection « le tour firm demande des données » (Lot 1.3 du plan v3) : vraie si le raccourci
    /// déterministe reconnaît la question (au moins un outil <c>get_firm_*</c> planifié) OU si une
    /// heuristique chiffres/listes est présente (« combien », « quel(s)/quelle(s) », « montant »,
    /// « liste », « classe », « qui », « top »). Méthode statique pure, testable isolément.
    /// Ne se substitue pas au gate : un faux positif ne déclenche au pire qu'une consultation
    /// superflue ; un faux négatif laisse le badge frontend (Lot 5) comme voyant résiduel. Exempte
    /// de facto <c>Greeting</c>/<c>conversationalFastPath</c> (traités en amont du handler), mais
    /// PAS l'intent <c>Synthesis</c> : un follow-up cliqué demandant de nouvelles données passe le
    /// gate comme un message tapé.
    /// </summary>
    public static bool FirmTurnNeedsData(string? message)
    {
        if (FirmMissionShortcutRouter.Resolve(message).Count > 0)
            return true;
        if (string.IsNullOrWhiteSpace(message))
            return false;
        var normalized = FirmMissionShortcutRouter.RemoveDiacritics(message).ToLowerInvariant();
        return normalized.Contains("combien", StringComparison.Ordinal)
            || normalized.Contains("quel", StringComparison.Ordinal)
            || normalized.Contains("montant", StringComparison.Ordinal)
            || normalized.Contains("liste", StringComparison.Ordinal)
            || normalized.Contains("classe", StringComparison.Ordinal)
            || FirmMissionShortcutRouter.ContainsWholeWord(normalized, "qui")
            || FirmMissionShortcutRouter.ContainsWholeWord(normalized, "top");
    }

    /// <summary>
    /// Fonction commune de décision du grounding gate firm (Lot 1.3 du plan v3), appelée avant chaque
    /// site de persistance du corps assistant (chemin Cursor et boucle principale). Rejette (retourne
    /// <c>true</c>) uniquement pour un tour <see cref="AssistantAgentScope.FirmMission"/> dont la
    /// question demande des données, alors qu'aucune lecture firm réussie et exploitable
    /// (<paramref name="firmGroundedReads"/>) n'a eu lieu ce tour, et le gate est activé. Tout autre
    /// scope, ou gate désactivé ⇒ <c>false</c> (comportement strictement identique à aujourd'hui).
    /// </summary>
    public static bool ShouldRejectUngroundedFirmAnswer(
        AssistantAgentScope agentScope,
        int firmGroundedReads,
        bool turnNeedsData,
        bool gateEnabled)
        => gateEnabled
           && agentScope == AssistantAgentScope.FirmMission
           && turnNeedsData
           && firmGroundedReads <= 0;

    /// <summary>
    /// Repli honnête déterministe du grounding gate firm (Lot 1.3 du plan v3) : persisté à la place
    /// de la prose non ancrée quand la lecture de secours elle-même a échoué. Texte stable figé par
    /// test — le frontend (Lot 5) peut s'y appuyer comme voyant « réponse non fiable ».
    /// </summary>
    private const string FirmUngroundedFallbackMessage =
        "Je n'ai pas pu consulter les données du cabinet pour répondre de façon fiable. " +
        "Aucune lecture du portefeuille n'a abouti ce tour — réessayez dans un instant ; si le problème " +
        "persiste, vérifiez que les dossiers du cabinet sont accessibles puis reformulez votre question.";

    public static int ResolveMinMeaningfulTextChars(
        AiToolIntentRouter.AiToolIntent toolIntent,
        OllamaSettings settings)
    {
        var defaultMin = Math.Clamp(settings.MinAssistantTextCharsForCompleteResponse, 1, 4096);
        return toolIntent == AiToolIntentRouter.AiToolIntent.Greeting
            ? Math.Min(20, defaultMin)
            : defaultMin;
    }

    private static string BuildFinalAssistantBodyWithAppendices(
        string rawBody,
        int minMeaningfulTextChars,
        string? accumulatedDashboardJson,
        IReadOnlyList<string> accumulatedSuggestedPrompts)
    {
        var assistantBody = PrepareVisibleAssistantBody(rawBody, minMeaningfulTextChars);
        if (!string.IsNullOrEmpty(accumulatedDashboardJson) &&
            !AssistantDashboardContent.HasDashboardFence(assistantBody))
        {
            assistantBody += AssistantDashboardContent.BuildAppendix(accumulatedDashboardJson);
        }

        if (accumulatedSuggestedPrompts.Count > 0)
            assistantBody += BuildFtMetaAppendix(accumulatedSuggestedPrompts);

        return assistantBody;
    }

    private static string PrepareVisibleAssistantBody(string rawBody, int minMeaningfulChars) =>
        AssistantVisibleContentFormatter.EnhanceForDisplay(
            // Substitution des identifiants d'outils puis retrait CJK — AVANT tout le reste, y compris
            // quand aucun outil n'a tourné (réponse depuis l'historique). Le chinois ne doit jamais
            // compter comme prose « significative » (sinon la synthèse forcée est sautée).
            AssistantVisibleContentFormatter.SanitizeVisibleProse(rawBody),
            minMeaningfulChars);

    /// <summary>
    /// Avance toujours <paramref name="flushedUpTo"/> jusqu'à la borne flushable. N'émet un segment
    /// que s'il reste de la prose après assainissement (un chunk 100 % CJK est avalé, pas streamé).
    /// </summary>
    private static bool TryTakeSanitizedLiveSegment(string snapshot, ref int flushedUpTo, out string segment)
    {
        var flushTo = AiLiveContentStreamer.ComputeFlushableLength(snapshot, flushedUpTo);
        if (flushTo <= flushedUpTo)
        {
            segment = string.Empty;
            return false;
        }

        segment = AssistantVisibleContentFormatter.SanitizeVisibleProse(snapshot[flushedUpTo..flushTo]);
        flushedUpTo = flushTo;
        return !string.IsNullOrWhiteSpace(segment);
    }

    /// <summary>
    /// Filet de DERNIER RECOURS anti-fuite : la substitution par libellés
    /// (<see cref="AssistantVisibleContentFormatter.SanitizeInternalToolNames"/>, appliquée en amont dans
    /// <see cref="PrepareVisibleAssistantBody"/>) neutralise déjà les fuites en PRÉSERVANT la réponse ;
    /// ce filet ne se déclenche que si un nom d'outil du registre subsiste malgré tout, et remplace alors
    /// le corps par une synthèse déterministe propre. Plus de condition « outils exécutés » : une réponse
    /// bâtie depuis l'historique (0 outil ce tour) était l'angle mort qui laissait fuir les identifiants.
    /// </summary>
    private string? TryBuildLeakReplacementBody(
        string body,
        Conversation conversation,
        string? userMessage,
        AiToolIntentRouter.AiToolIntent toolIntent,
        bool toolsExecuted,
        int minMeaningfulTextChars,
        string? accumulatedDashboardJson,
        IReadOnlyList<string> accumulatedSuggestedPrompts)
    {
        if (!_ollamaSettings.RedactInternalToolNamesEnabled
            || !AssistantVisibleContentFormatter.ContainsInternalToolName(body))
        {
            return null;
        }

        var clean = AssistantDeterministicFallback.TryBuild(
            conversation,
            userMessage,
            minMeaningfulTextChars,
            _ollamaSettings.DeterministicFallbackEnabled,
            toolsExecuted,
            toolIntent);

        if (string.IsNullOrWhiteSpace(clean))
        {
            clean = "Je n'ai pas pu finaliser cette réponse à partir des données disponibles. Reformulez votre question.";
        }

        return BuildFinalAssistantBodyWithAppendices(
            clean,
            minMeaningfulTextChars,
            accumulatedDashboardJson,
            accumulatedSuggestedPrompts);
    }

    /// <summary>
    /// Builds client navigation actions from studio_generate_app / studio_generate_system results.
    /// </summary>
    private static string? TryBuildStudioClientActions(string toolData)
    {
        try
        {
            using var doc = JsonDocument.Parse(toolData);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;

            var actions = new List<object>();

            if (root.TryGetProperty("systemUrl", out var sysUrl) && sysUrl.ValueKind == JsonValueKind.String)
            {
                var url = sysUrl.GetString();
                if (!string.IsNullOrWhiteSpace(url) && url.StartsWith("/", StringComparison.Ordinal))
                {
                    var sysLabel = root.TryGetProperty("displayName", out var dn) && dn.ValueKind == JsonValueKind.String
                        ? $"Ouvrir le système « {dn.GetString()} »"
                        : "Ouvrir le système";
                    actions.Add(new { label = sysLabel, route = url });
                }
            }

            if (root.TryGetProperty("entities", out var entities) && entities.ValueKind == JsonValueKind.Array)
            {
                foreach (var ent in entities.EnumerateArray())
                {
                    if (!ent.TryGetProperty("openUrl", out var eu) || eu.ValueKind != JsonValueKind.String) continue;
                    var url = eu.GetString();
                    if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("/", StringComparison.Ordinal)) continue;
                    var label = ent.TryGetProperty("displayName", out var en) && en.ValueKind == JsonValueKind.String
                        ? $"Ouvrir « {en.GetString()} »"
                        : "Ouvrir la table";
                    actions.Add(new { label, route = url });
                }
            }
            else if (root.TryGetProperty("openUrl", out var urlEl) && urlEl.ValueKind == JsonValueKind.String)
            {
                var url = urlEl.GetString();
                if (!string.IsNullOrWhiteSpace(url) && url.StartsWith("/", StringComparison.Ordinal))
                {
                    var label = root.TryGetProperty("displayName", out var dn) && dn.ValueKind == JsonValueKind.String
                        ? $"Ouvrir « {dn.GetString()} »"
                        : "Ouvrir la table";
                    actions.Add(new { label, route = url });
                }
            }

            return actions.Count > 0 ? JsonSerializer.Serialize(actions, SourcesJsonOptions) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IEnumerable<ChatStreamEvent> TryBuildStudioProgressEvents(string toolData)
    {
        var events = new List<ChatStreamEvent>();
        try
        {
            using var doc = JsonDocument.Parse(toolData);
            if (!doc.RootElement.TryGetProperty("buildSteps", out var steps) || steps.ValueKind != JsonValueKind.Array)
                return events;
            foreach (var step in steps.EnumerateArray())
                events.Add(ChatStreamEvent.StudioProgressEvent(step.GetRawText()));
        }
        catch (JsonException)
        {
            // ignore malformed tool payloads
        }

        return events;
    }

    private sealed record SourceEntryDto(string ToolName, string ToolCallId);

    /// <summary>
    /// Si le modèle ciblé supporte la vision et que des pièces jointes portent des
    /// images base64, attache-les au DERNIER message utilisateur (= message courant).
    /// Ne fait rien au-delà du 1er tour de tool-call (les rounds suivants n'ont pas
    /// besoin de re-pousser les images).
    /// </summary>
    private static void AttachImagesToLastUserOllamaMessage(
        List<OllamaChatMessage> messages,
        IReadOnlyList<ChatAttachmentInput>? attachments,
        string modelRef,
        int toolCallRound)
    {
        if (toolCallRound > 0 || attachments is null || attachments.Count == 0) return;
        if (!AiModelCapabilityDetector.DetectVisionSupport(modelRef)) return;

        var images = attachments
            .Where(a => a.ImagesBase64 is { Count: > 0 })
            .SelectMany(a => a.ImagesBase64!)
            .Where(b64 => !string.IsNullOrWhiteSpace(b64))
            .Take(10) // garde-fou : 10 images max par requête
            .ToList();
        if (images.Count == 0) return;

        for (var i = messages.Count - 1; i >= 0; i--)
        {
            if (messages[i].Role == "user")
            {
                messages[i] = messages[i] with { Images = images };
                return;
            }
        }
    }

    /// <summary>
    /// Variante OpenAI / OpenRouter : transforme le content du dernier user message
    /// en tableau de parts ([{type:text}, {type:image_url}, ...]) si le modèle est vision.
    /// </summary>
    private static void AttachImagesToLastUserOpenAiMessage(
        List<OpenAiChatMessagePayload> messages,
        IReadOnlyList<ChatAttachmentInput>? attachments,
        string modelRef,
        int toolCallRound)
    {
        if (toolCallRound > 0 || attachments is null || attachments.Count == 0) return;
        if (!AiModelCapabilityDetector.DetectVisionSupport(modelRef)) return;

        var images = attachments
            .Where(a => a.ImagesBase64 is { Count: > 0 })
            .SelectMany(a => a.ImagesBase64!)
            .Where(b64 => !string.IsNullOrWhiteSpace(b64))
            .Take(10)
            .ToList();
        if (images.Count == 0) return;

        for (var i = messages.Count - 1; i >= 0; i--)
        {
            if (messages[i].Role == "user")
            {
                var existingText = messages[i].Content as string ?? string.Empty;
                var parts = new List<OpenAiContentPart>
                {
                    new() { Type = "text", Text = existingText }
                };
                foreach (var b64 in images)
                {
                    parts.Add(new OpenAiContentPart
                    {
                        Type = "image_url",
                        ImageUrl = new OpenAiImageUrl { Url = "data:image/png;base64," + b64 }
                    });
                }
                messages[i] = new OpenAiChatMessagePayload
                {
                    Role = "user",
                    Content = parts,
                    ToolCalls = messages[i].ToolCalls,
                    ToolCallId = messages[i].ToolCallId
                };
                return;
            }
        }
    }


    private static string? TryExtractSchemaVersion(string? analysisSummary)
    {
        if (string.IsNullOrWhiteSpace(analysisSummary))
            return null;

        try
        {
            using var doc = JsonDocument.Parse(analysisSummary);
            if (doc.RootElement.TryGetProperty("schemaVersion", out var sv))
                return sv.ToString();
        }
        catch
        {
            // ignore
        }

        return null;
    }

    private void TryAccumulateSuggestedPrompts(string json, List<string> accumulated)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return;

            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.String)
                    continue;
                var s = el.GetString();
                if (!string.IsNullOrEmpty(s) && !accumulated.Contains(s))
                    accumulated.Add(s);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Impossible d'extraire les suggestions de suivi post-traitement.");
        }
    }

    private async Task<OpenAiCompatibleEndpoint?> ResolveOpenAiCompatibleAsync(
        LlmProviderKind kind,
        Guid conversationId,
        CancellationToken cancellationToken)
    {
        switch (kind)
        {
            case LlmProviderKind.OpenRouter:
            {
                var credentials = await _platformAiSettings.GetOpenRouterCredentialsAsync(cancellationToken);
                if (string.IsNullOrEmpty(credentials.ApiKey))
                    return null;
                return new OpenAiCompatibleEndpoint(credentials.BaseUrl, credentials.ApiKey, null);
            }
            case LlmProviderKind.Modal:
            {
                var credentials = await _modalCredentials.ResolveAsync(_tenantContext.TenantId, cancellationToken);
                if (string.IsNullOrEmpty(credentials.ApiKey) || string.IsNullOrWhiteSpace(credentials.BaseUrl))
                    return null;
                var sessionId = _modalSettings.EnableStickySessions
                    ? conversationId.ToString("N")
                    : null;
                return new OpenAiCompatibleEndpoint(
                    credentials.BaseUrl,
                    credentials.ApiKey,
                    OpenAiCompatibleCallOptions.ForModal(_modalSettings, sessionId));
            }
            default:
                return null;
        }
    }

    private readonly record struct OpenAiCompatibleEndpoint(
        string BaseUrl,
        string ApiKey,
        OpenAiCompatibleCallOptions? Options);

    private static string BuildConversationTitle(SendChatMessageCommand command)
    {
        if (!string.IsNullOrWhiteSpace(command.UiContext?.AnalysisSummary))
            return AiScreenTitleFormatter.BuildScreenAnalysisConversationTitle(command.UiContext.ScreenId);

        return command.Message.Length > 80
            ? command.Message[..80] + "..."
            : command.Message;
    }

    private static string BuildFtMetaAppendix(IReadOnlyList<string> prompts)
    {
        var json = JsonSerializer.Serialize(new { suggestedPrompts = prompts }, SourcesJsonOptions);
        return "\n\n```ft-meta\n" + json + "\n```\n";
    }

    /// <summary>
    /// Anti-boucle analyse d'écran : une fois un tableau de bord accumulé dans la requête, les appels
    /// generate_dashboard_config suivants sont court-circuités (réponse déterministe, pas de ré-exécution) —
    /// le petit modèle rappelait l'outil round après round au lieu de rédiger l'analyse. Gated ScreenAnalysis :
    /// aucun changement pour les autres modes.
    /// </summary>
    public static bool ShouldShortCircuitScreenAnalysisDashboardCall(
        bool isScreenAnalysis,
        string? toolName,
        string? accumulatedDashboardJson)
        => isScreenAnalysis
           && string.Equals(toolName, "generate_dashboard_config", StringComparison.Ordinal)
           && !string.IsNullOrEmpty(accumulatedDashboardJson);

    /// <summary>
    /// Description NON sensible des arguments d'un tool-call pour les logs : uniquement les noms de
    /// clés (triés, tronqués, sans CR/LF), jamais les valeurs — les arguments transportent des specs
    /// Studio complètes, des données seed ou des filtres financiers (CWE-532).
    /// </summary>
    public static string DescribeToolArgumentKeys(Dictionary<string, object?>? arguments)
    {
        if (arguments is null || arguments.Count == 0)
            return "-";

        var keys = arguments.Keys
            .OrderBy(k => k, StringComparer.Ordinal)
            .Select(k => LogSanitizer.Sanitize(k, 40));
        return LogSanitizer.Sanitize(string.Join(",", keys), 200);
    }

    /// <summary>Taille sérialisée (UTF-8) des arguments d'un tool-call — un ordre de grandeur pour le diagnostic, sans le contenu.</summary>
    public static int MeasureToolArgumentBytes(Dictionary<string, object?>? arguments)
    {
        if (arguments is null || arguments.Count == 0)
            return 0;

        try
        {
            return JsonSerializer.SerializeToUtf8Bytes(arguments).Length;
        }
        catch (Exception)
        {
            return -1;
        }
    }

    /// <summary>Message-nudge renvoyé au modèle à la place d'une ré-exécution (aucun nom d'outil dedans).</summary>
    public const string ScreenAnalysisDashboardAlreadyGeneratedMessage =
        "Le tableau de bord est déjà généré. Rédige maintenant l'analyse complète en sections markdown "
        + "(## Synthèse exécutive, ## Indicateurs clés, ## Analyse détaillée, ## Anomalies et risques, "
        + "## Opportunités, ## Actions recommandées, ## Points à vérifier).";

    /// <summary>
    /// Regroupe les tool-calls STRICTEMENT identiques (même nom + mêmes arguments sérialisés) d'un même
    /// round : chaque doublon pointe vers le PREMIER appel équivalent, qui seul est exécuté — le petit
    /// modèle émet parfois plusieurs fois le même appel (ex. forecast_revenue ×3), tripler la latence et
    /// le SQL est inutile. Des arguments différents (ex. scopes distincts) ne sont JAMAIS dédupliqués.
    /// Retourne callId → callId canonique (clé absente = appel unique ou premier de son groupe).
    /// </summary>
    public static Dictionary<string, string> MapDuplicateToolCalls(IReadOnlyList<OllamaToolCall> calls)
    {
        var canonicalByKey = new Dictionary<string, string>(StringComparer.Ordinal);
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var call in calls)
        {
            if (call.Function is null || string.IsNullOrEmpty(call.Id))
                continue;
            string argsJson;
            try
            {
                argsJson = JsonSerializer.Serialize(call.Function.Arguments);
            }
            catch (Exception)
            {
                continue; // arguments non sérialisables → jamais dédupliqué (prudence)
            }
            var key = call.Function.Name + "\n" + argsJson;
            if (canonicalByKey.TryGetValue(key, out var canonicalId))
                map[call.Id!] = canonicalId;
            else
                canonicalByKey[key] = call.Id!;
        }
        return map;
    }

    private static string CreateCursorScratchDirectory(Guid runId)
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "App_Data", "cursor-scratch", runId.ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static void TryDeleteScratchDirectory(string? directory)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            return;
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch
        {
            // Best-effort cleanup; leftover scratch dirs are empty and tenant-free.
        }
    }

    private string BuildCursorToolCallbackUrl(Guid runId)
    {
        var baseUrl = string.IsNullOrWhiteSpace(_cursorSdkSettings.ToolCallbackBaseUrl)
            ? "http://127.0.0.1:7000"
            : _cursorSdkSettings.ToolCallbackBaseUrl.TrimEnd('/');
        return $"{baseUrl}/internal/ai/cursor-tools/{runId}";
    }

    private static void EnsureToolCallIds(List<OllamaToolCall> calls)
    {
        for (var i = 0; i < calls.Count; i++)
        {
            if (string.IsNullOrEmpty(calls[i].Id))
                calls[i] = calls[i] with { Id = Guid.NewGuid().ToString("N")[..12] };
        }
    }

    /// <summary>
    /// Whitelist stricte des outils sûrs à exécuter EN PARALLÈLE pendant un même round.
    /// Critère : ne pas passer par <c>IMediator</c> / <c>DbContext</c> (qui est scoped et
    /// ne supporte pas la concurrence). Les autres tools (qui touchent la base via MediatR)
    /// restent exécutés séquentiellement pour préserver l'invariant EF Core.
    /// </summary>
    /// <summary>
    /// num_ctx du chat. Quand <c>FixedChatNumCtx &gt; 0</c> : valeur CONSTANTE identique à chaque requête
    /// (tours d'agent + synthèse finale) ⇒ Ollama ne recharge jamais le modèle. Sinon : calcul adaptatif historique.
    /// </summary>
    private int? ResolveChatNumCtx(int promptChars, int maxTokens, OllamaInferenceProfile? inferenceProfile) =>
        OllamaChatNumCtxResolver.ResolveForChat(_ollamaSettings, inferenceProfile, promptChars, maxTokens);

    /// <summary>
    /// Limite les tours agent en CPU pour les intentions simples (Sales, Stock, etc.) sans réduire
    /// les cas ambigus (Fallback, Forecasting) ni l'analyse écran.
    /// </summary>
    /// <param name="agentScope">
    /// Scope de l'agent (Lot 2.2 — budget explicite ≤ 2 générations LLM par tour firm). Pour
    /// <see cref="AssistantAgentScope.FirmMission"/> sur CPU, retourne toujours 1 round outils
    /// QUEL QUE SOIT l'intent mot-clé (Sales, Fallback, Accounting…) : le raccourci déterministe
    /// firm (Lot 1.2) garantit les données sans round supplémentaire, et la mauvaise classification
    /// « Sales » du routeur (2.1) devient ainsi sans effet sur le budget firm — elle était déjà sans
    /// effet sur le catalogue (voir <see cref="BuildOllamaTools"/>, neutralisation d'intent). Sur GPU,
    /// comportement par défaut inchangé. Défaut <see cref="AssistantAgentScope.None"/> : comportement
    /// identique à avant (aucun changement de signature publique sans paramètre par défaut).
    /// </param>
    public static int ResolveMaxToolCallRounds(
        bool isScreenAnalysis,
        int screenAnalysisMaxRounds,
        int defaultMaxRounds,
        int cpuMaxToolCallRounds,
        AssistantMode assistantMode,
        AiToolIntentRouter.AiToolIntent toolIntent,
        OllamaInferenceProfile? inferenceProfile,
        AssistantAgentScope agentScope = AssistantAgentScope.None,
        bool studioAdvanced = false,
        int studioAdvancedMaxToolCallRounds = 4)
    {
        if (isScreenAnalysis)
            return Math.Clamp(screenAnalysisMaxRounds, 1, 20);

        // Studio + modèle avancé (PR 1.2) : le budget dédié remplace le plafond CPU pour ce tour. Le
        // modèle avancé est censé tourner sur GPU / cloud ; si l'administrateur a pourtant désigné un
        // modèle Ollama exécuté sur un hôte CPU seul, le plafond CPU garde tout son sens et s'applique.
        if (assistantMode == AssistantMode.StudioBuilder && studioAdvanced
            && inferenceProfile?.Device != OllamaInferenceDevice.CpuOnly)
            return Math.Clamp(studioAdvancedMaxToolCallRounds, 1, 20);

        var defaultRounds = Math.Clamp(defaultMaxRounds, 1, 20);
        if (inferenceProfile?.Device != OllamaInferenceDevice.CpuOnly)
            return defaultRounds;

        if (cpuMaxToolCallRounds <= 0)
            return defaultRounds;

        if (assistantMode is AssistantMode.Compliance or AssistantMode.ScreenAnalysis)
            return defaultRounds;

        // Budget de générations explicite (Lot 2.2) : sur CPU, le tour firm reste à 1 round outils
        // quel que soit l'intent — voir la documentation du paramètre ci-dessus.
        if (agentScope == AssistantAgentScope.FirmMission)
            return 1;

        if (toolIntent is AiToolIntentRouter.AiToolIntent.Fallback
            or AiToolIntentRouter.AiToolIntent.Forecasting)
            return defaultRounds;

        return Math.Clamp(cpuMaxToolCallRounds, 1, defaultRounds);
    }

    /// <summary>
    /// Budget explicite de générations LLM pour un tour firm (Lot 2.2) : au plus
    /// <see cref="FirmTurnMaxLlmGenerations"/> générations complètes (1 round outils + 1 round
    /// rédaction — la synthèse forcée/de secours remplace le round de rédaction raté). Point d'entrée
    /// UNIQUE pour toute décision « peut-on encore générer ? » côté tour firm.
    /// </summary>
    /// <remarks>
    /// Hook Lot 1 (rescue synthesis, gate 1.3) : le compteur <c>llmGenerationsThisTurn</c> est une
    /// variable locale de <see cref="Handle"/>, partagée par la boucle d'outils et la synthèse forcée.
    /// La synthèse de secours du Lot 1 doit : (a) appeler cette méthode AVANT de générer — si elle
    /// retourne <c>true</c>, ne pas générer et laisser le repli déterministe existant s'appliquer ;
    /// (b) sinon, incrémenter <c>llmGenerationsThisTurn</c> immédiatement avant l'appel provider (même
    /// motif que la boucle et la synthèse forcée ci-dessus). Autres scopes que
    /// <see cref="AssistantAgentScope.FirmMission"/> : toujours <c>false</c> (aucun changement de
    /// comportement, compteur journalisé seulement).
    /// </remarks>
    public const int FirmTurnMaxLlmGenerations = 2;

    public static bool IsFirmTurnGenerationBudgetExhausted(AssistantAgentScope agentScope, int llmGenerationsThisTurn)
        => agentScope == AssistantAgentScope.FirmMission
            && llmGenerationsThisTurn >= FirmTurnMaxLlmGenerations;

    private OllamaOptions BuildChatOllamaOptions(
        double temperature,
        int maxTokens,
        int? numCtx,
        OllamaInferenceProfile? inferenceProfile,
        int? seed)
    {
        var options = new OllamaOptions
        {
            Temperature = temperature,
            NumPredict = Math.Max(1, maxTokens),
            NumCtx = numCtx,
            NumThread = _ollamaSettings.NumThread,
            NumBatch = _ollamaSettings.NumBatch,
            Seed = seed,
            TopP = _ollamaSettings.TopP
        };

        return inferenceProfile?.ApplyTo(options) ?? options;
    }

    /// <inheritdoc cref="AssistantModeResolver.QueryLikelyMutating"/>
    public static bool QueryLikelyMutating(string? text) => AssistantModeResolver.QueryLikelyMutating(text);

    private static ParsedModelRef ParseModelRefOrDefault(string rawModel, string defaultModel)
    {
        var modelRef = ModelRef.Parse(rawModel);
        return string.IsNullOrEmpty(modelRef.CanonicalModelRef)
            ? ModelRef.Parse($"{ModelRef.OllamaPrefix}{defaultModel}")
            : modelRef;
    }

    /// <summary>
    /// Charge utile de l'événement SSE <c>meta</c> (StudioBuilder, PR 1.2) :
    /// <c>{ usedAdvancedModel, advancedModelFallbackReason, model }</c>. <c>model</c> est le libellé lisible
    /// (identifiant fournisseur), même logique que la capacité <c>studioAiModelLabel</c>.
    /// </summary>
    public static string BuildStudioMetaJson(bool usedAdvancedModel, string? advancedModelFallbackReason, ParsedModelRef modelRef)
    {
        return JsonSerializer.Serialize(new
        {
            usedAdvancedModel,
            advancedModelFallbackReason,
            model = ModelRef.HumanLabel(modelRef.CanonicalModelRef)
        });
    }

    /// <summary>
    /// Vrai si le suffixe d'intent peut être appliqué pour ce scope : les suffixes Sales/Fallback citent
    /// get_sales_revenue, on ne les injecte que si l'outil appartient au catalogue du scope.
    /// </summary>
    public static bool ShouldApplyIntentSuffixForScope(
        AiToolIntentRouter.AiToolIntent toolIntent,
        AssistantAgentScope agentScope)
    {
        if (agentScope == AssistantAgentScope.None)
            return true;
        if (toolIntent is AiToolIntentRouter.AiToolIntent.Sales or AiToolIntentRouter.AiToolIntent.Fallback)
            return AiAgentScopeCatalog.GetToolNames(agentScope).Contains("get_sales_revenue");
        return true;
    }

    private static List<OllamaToolDefinition> BuildOllamaTools(
        AssistantMode mode,
        bool enableMutationTools,
        AiToolIntentRouter.AiToolIntent toolIntent,
        OllamaInferenceProfile? inferenceProfile,
        AssistantAgentScope agentScope = AssistantAgentScope.None,
        bool studioPlanPreview = false,
        bool studioModifyTools = false,
        bool studioViewTools = false,
        bool studioReportTools = false,
        StudioToolFocus studioFocus = StudioToolFocus.None,
        IReadOnlyCollection<string>? preExecutedToolNamesToExclude = null,
        // PR 2.4 : vues enregistrées proposées par l'IA — en fin de signature, les appels
        // positionnels existants (jusqu'à studioFocus) restent valides.
        bool studioRecordViewTools = false,
        bool studioWorkflowTools = false)
    {
        var isCpuOnly = inferenceProfile?.Device == OllamaInferenceDevice.CpuOnly;
        var isScoped = mode == AssistantMode.Default && agentScope != AssistantAgentScope.None;
        // Assistant expert : le catalogue scopé est déjà restreint — le filtrage par intent mot-clé est
        // neutralisé (Fallback), sauf Greeting (aucun outil) et Synthesis (réponse depuis l'historique).
        // toolIntent lui-même n'est PAS modifié en amont : ceci garde le catalogue insensible à l'intent
        // mot-clé (donc à une éventuelle mauvaise classification « Sales », cf. AiToolIntentRouter 2.1).
        // Le budget de rounds (ResolveMaxToolCallRounds) ne dépend PLUS de cet intent pour FirmMission
        // depuis le Lot 2.2 : il reçoit `agentScope` et force 1 round CPU quel que soit toolIntent —
        // la neutralisation ci-dessous et celle du budget sont donc désormais alignées pour ce scope.
        var effectiveIntent = isScoped
            && toolIntent is not (AiToolIntentRouter.AiToolIntent.Greeting or AiToolIntentRouter.AiToolIntent.Synthesis)
            ? AiToolIntentRouter.AiToolIntent.Fallback
            : toolIntent;
        // Les sous-ensembles CPU ne s'appliquent qu'au catalogue Default non scopé : les modes
        // focalisés sont déjà curés, les y soumettre les ampute (cf. CpuSubsetApplies).
        var cpuSubsetApplies = AiToolIntentRouter.CpuSubsetApplies(mode, agentScope, isCpuOnly);
        var useCpuCoreSubset = cpuSubsetApplies && effectiveIntent == AiToolIntentRouter.AiToolIntent.Fallback;
        var useCpuIntentSubset = cpuSubsetApplies && effectiveIntent is AiToolIntentRouter.AiToolIntent.Sales
            or AiToolIntentRouter.AiToolIntent.Stock
            or AiToolIntentRouter.AiToolIntent.Accounting;
        var definitions = AiToolRegistry.GetDefinitionsForMode(mode, enableMutationTools, agentScope, studioPlanPreview, studioModifyTools, studioViewTools, studioReportTools, studioFocus, studioRecordViewTools: studioRecordViewTools, studioWorkflowTools: studioWorkflowTools)
            .Where(tool => AiToolIntentRouter.ShouldIncludeTool(
                tool.Name,
                effectiveIntent,
                enableMutationTools,
                tool.IsMutating,
                useCpuCoreSubset,
                useCpuIntentSubset))
            .ToList();

        if (isScoped)
        {
            if (isCpuOnly && effectiveIntent == AiToolIntentRouter.AiToolIntent.Fallback)
            {
                // CPU : variante minimale du scope (≤ 8 outils), même esprit que les Cpu*ToolNames de l'intent router.
                var cpuScopeTools = AiAgentScopeCatalog.GetCpuToolNames(agentScope);
                definitions = definitions.Where(t => cpuScopeTools.Contains(t.Name)).ToList();
            }
            else if (effectiveIntent == AiToolIntentRouter.AiToolIntent.Synthesis && definitions.Count < 3)
            {
                // Synthesis ∩ scope trop étroit : repli déterministe sur la variante CPU du scope (lecture seule).
                var cpuScopeTools = AiAgentScopeCatalog.GetCpuToolNames(agentScope);
                definitions = AiToolRegistry.GetDefinitionsForMode(mode, enableMutationTools, agentScope, studioRecordViewTools: studioRecordViewTools, studioWorkflowTools: studioWorkflowTools)
                    .Where(t => cpuScopeTools.Contains(t.Name))
                    .ToList();
            }
        }

        // Hook Lot 2.2 pour le Lot 1 (raccourci firm) : retire du catalogue exposé au modèle les outils
        // déjà pré-exécutés par le raccourci déterministe firm (ex. get_firm_portfolio_overview), pour
        // que l'unique round outils CPU du tour firm ne soit pas gaspillé à rappeler une lecture déjà
        // obtenue. No-op tant qu'aucun appelant ne renseigne `preExecutedToolNamesToExclude` (le
        // raccourci n'existe pas encore). Garde-fou : ne JAMAIS vider complètement le catalogue — si le
        // filtrage ne laisserait plus aucun outil, on conserve la liste non filtrée.
        if (preExecutedToolNamesToExclude is { Count: > 0 })
        {
            var filtered = definitions.Where(t => !preExecutedToolNamesToExclude.Contains(t.Name)).ToList();
            if (filtered.Count > 0)
                definitions = filtered;
        }

        return definitions
            .Select(tool => new OllamaToolDefinition
        {
            Type = "function",
            Function = new OllamaFunctionDefinition
            {
                Name = tool.Name,
                Description = tool.Description,
                Parameters = new OllamaFunctionParameters
                {
                    Type = "object",
                    Properties = tool.Parameters.ToDictionary(
                        p => p.Key,
                        p => new OllamaParameterProperty
                        {
                            Type = p.Value.Type,
                            Description = p.Value.Description,
                            Enum = p.Value.AllowedValues
                        }),
                    Required = tool.RequiredParameters
                }
            }
        }).ToList();
    }
}
