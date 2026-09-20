using System.Text.Json;
using System.Threading.Channels;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.Studio.Ai;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers.Studio;

/// <summary>
/// Plans Studio IA (flux plan → aperçu → confirmation). La confirmation est un endpoint REST
/// DÉTERMINISTE : aucun LLM dans la boucle — le plan approuvé est exécuté tel quel et la
/// progression (<c>StudioBuildStep</c>) est streamée en SSE au fur et à mesure.
/// </summary>
[ApiController]
[Route("api/studio/ai/plans")]
[Authorize]
[Authorize(Policy = PermissionPolicies.StudioDesignEntities)]
public sealed class StudioAiPlansController : ControllerBase
{
    private static readonly JsonSerializerOptions SseJsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IMediator _mediator;
    private readonly OllamaSettings _ollamaSettings;

    public StudioAiPlansController(IMediator mediator, IOptions<OllamaSettings> ollamaSettings)
    {
        _mediator = mediator;
        _ollamaSettings = ollamaSettings.Value;
    }

    // ---- Endpoints « workbench » (P0) : gardés par EnableStudioAiWorkbench (flag off ⇒ 404),
    // SAUF l'historique (List) et la purge (CancelPending) qui relèvent du flux d'aperçu
    // (EnableStudioAiPlanPreview, PR 3.2 — même garde que la confirmation SSE).
    // Les routes fixes (« cancel-pending », « validate », …) sont déclarées avant « {id:guid} »
    // par lisibilité ; la contrainte :guid empêche de toute façon toute collision.

    /// <summary>Historique paginé des générations de l'utilisateur courant (jamais de spec ici).</summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] string? kind,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (PlanPreviewUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(
            new ListStudioAiPlansQuery(status, kind, page, pageSize), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Ok(ApiResponse<PagedResult<StudioAiPlanListItemDto>>.Ok(value)));
    }

    /// <summary>« Réinitialiser la conversation » : annule les plans en attente de l'utilisateur.</summary>
    [HttpPost("cancel-pending")]
    public async Task<IActionResult> CancelPending(CancellationToken cancellationToken)
    {
        if (PlanPreviewUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(new CancelPendingStudioAiPlansCommand(), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            cancelled => Ok(ApiResponse<int>.Ok(cancelled, "Plans en attente annulés.")));
    }

    /// <summary>
    /// Valide une spec sans rien créer ni lire en base (alimente « Tester » / « Personnaliser »
    /// en direct) : renvoie la forme canonique et le résumé recalculé côté serveur.
    /// </summary>
    [HttpPost("validate")]
    public async Task<IActionResult> ValidateSpec(
        [FromBody] ValidateStudioAiSpecRequest request, CancellationToken cancellationToken)
    {
        if (WorkbenchUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(
            new ValidateStudioAiSpecCommand(request.Kind, request.SpecJson), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Ok(ApiResponse<StudioAiSpecValidationDto>.Ok(value)));
    }

    /// <summary>Crée un plan Pending directement depuis une spec JSON — AUCUN appel LLM.</summary>
    [HttpPost("from-spec")]
    public async Task<IActionResult> CreateFromSpec(
        [FromBody] CreatePlanFromSpecRequest request, CancellationToken cancellationToken)
    {
        if (WorkbenchUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(
            new CreateStudioAiPlanFromSpecCommand(request.Kind, request.SpecJson), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Ok(ApiResponse<StudioAiPlanCreationResponse>.Ok(value, "Plan créé.")));
    }

    /// <summary>
    /// Instancie un modèle de la bibliothèque (clé du catalogue embarqué en P0 ; identifiant de
    /// modèle tenant à partir de P3) en plan Pending — AUCUN appel LLM.
    /// </summary>
    [HttpPost("from-template")]
    public async Task<IActionResult> CreateFromTemplate(
        [FromBody] CreatePlanFromTemplateRequest request, CancellationToken cancellationToken)
    {
        if (WorkbenchUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(
            new CreateStudioAiPlanFromTemplateCommand(
                request.TemplateKey, request.TemplateId, request.DisplayNameOverride),
            cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Ok(ApiResponse<StudioAiPlanCreationResponse>.Ok(value, "Plan créé.")));
    }

    /// <summary>Spec canonique d'un plan possédé (entrée de l'éditeur « Personnaliser »).</summary>
    [HttpGet("{id:guid}/spec")]
    public async Task<IActionResult> GetSpec(Guid id, CancellationToken cancellationToken)
    {
        if (WorkbenchUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(new GetStudioAiPlanSpecQuery(id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Ok(ApiResponse<StudioAiPlanSpecDto>.Ok(value)));
    }

    /// <summary>
    /// Réécrit la spec d'un plan en attente (re-parse + résumé recalculé côté serveur,
    /// jeton <c>rowVersion</c> obligatoire contre les écritures concurrentes).
    /// </summary>
    [HttpPut("{id:guid}/spec")]
    public async Task<IActionResult> UpdateSpec(
        Guid id, [FromBody] UpdateStudioAiPlanSpecRequest request, CancellationToken cancellationToken)
    {
        if (WorkbenchUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(
            new UpdateStudioAiPlanSpecCommand(id, request.SpecJson, request.RowVersion), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Ok(ApiResponse<UpdateStudioAiPlanSpecResponse>.Ok(value, "Plan mis à jour.")));
    }

    /// <summary>Garde du workbench : 404 tant que le flag est désactivé (surface d'API inchangée).</summary>
    private IActionResult? WorkbenchUnavailableOrNull() =>
        _ollamaSettings.EnableStudioAiWorkbench
            ? null
            : NotFound(ApiResponse<object>.Fail("Le workbench Studio IA n'est pas activé."));

    /// <summary>
    /// Garde du flux d'aperçu (PR 3.2) : 404 tant que <c>EnableStudioAiPlanPreview</c> est coupé.
    /// Message identique à celui du refus SSE de <c>Confirm</c> — figé par test de contrat.
    /// </summary>
    private IActionResult? PlanPreviewUnavailableOrNull() =>
        _ollamaSettings.EnableStudioAiPlanPreview
            ? null
            : NotFound(ApiResponse<object>.Fail("Le flux d'aperçu Studio n'est pas activé."));

    /// <summary>
    /// Aperçu structuré d'un plan persisté (PR 3.2) : la spec stockée est re-projetée en DTO
    /// (entités, relations, amendement, avertissements, doublons) sans aucune écriture ni appel
    /// LLM. 200 / 400 (spec incanonisable) / 401 / 404 (flag coupé, autre tenant, autre
    /// propriétaire) — un amendement dont la table cible est introuvable reste un 200 dégradé.
    /// </summary>
    [HttpGet("{id:guid}/preview")]
    public async Task<IActionResult> Preview(Guid id, CancellationToken cancellationToken)
    {
        if (PlanPreviewUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(new GetStudioAiPlanPreviewQuery(id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Ok(ApiResponse<StudioAiPlanPreviewDto>.Ok(value)));
    }

    /// <summary>
    /// Rejoue un plan en état terminal (terminé, échoué, annulé ou expiré) : la spec persistée est
    /// re-canonicalisée (doublons et schéma relus) puis un plan NEUF Pending est créé — le plan
    /// d'origine n'est jamais modifié. 201 + <c>Location</c> (première 201 du contrôleur, E5) /
    /// 409 (statut non rejouable) / 400 (spec incanonisable) / 401 / 404 (flag, tenant,
    /// propriétaire).
    /// </summary>
    [HttpPost("{id:guid}/replay")]
    public async Task<IActionResult> Replay(Guid id, CancellationToken cancellationToken)
    {
        if (PlanPreviewUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(new ReplayStudioAiPlanCommand(id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            value => Created(
                $"/api/studio/ai/plans/{value.Plan.Id}",
                ApiResponse<StudioAiPlanCreationResponse>.Ok(value)));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetStudioAiPlanQuery(id), cancellationToken);
        return result.IsFailure
            ? NotFound(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<StudioAiPlanDto>.Ok(result.Value));
    }

    [HttpPost("{id:guid}/cancel")]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new CancelStudioAiPlanCommand(id), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<StudioAiPlanDto>.Ok(result.Value, "Plan annulé."));
    }

    /// <summary>
    /// Exécute le plan confirmé et streame la progression en SSE : événements
    /// <c>studio_progress</c> (étapes live), puis <c>studio_result</c> (payload final) ou
    /// <c>error</c>, et enfin <c>done</c>.
    /// </summary>
    [HttpPost("{id:guid}/confirm")]
    public async Task Confirm(Guid id, CancellationToken cancellationToken)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        if (!_ollamaSettings.EnableStudioAiPlanPreview)
        {
            await WriteEventAsync(ChatStreamEvent.ErrorEvent(
                "Le flux d'aperçu Studio n'est pas activé."), cancellationToken);
            return;
        }

        // Les étapes émises par l'orchestrateur (thread du handler) transitent par un channel
        // que cette action draine vers la réponse SSE — progression réellement temps réel.
        var channel = Channel.CreateUnbounded<StudioBuildStep>();
        var progress = new ChannelBuildProgress(channel.Writer);

        // CancellationToken.None : une exécution confirmée va jusqu'au bout même si l'onglet se ferme
        // (sinon le plan resterait bloqué en Executing) ; seul le flux SSE suit la déconnexion.
        var sendTask = _mediator.Send(new ConfirmStudioAiPlanCommand(id, progress), CancellationToken.None);
        _ = sendTask.ContinueWith(
            _ => channel.Writer.TryComplete(),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        try
        {
            await foreach (var step in channel.Reader.ReadAllAsync(cancellationToken))
            {
                await WriteEventAsync(
                    ChatStreamEvent.StudioProgressEvent(JsonSerializer.Serialize(step, SseJsonOptions)),
                    cancellationToken);
            }

            var result = await sendTask;
            if (result.IsSuccess)
            {
                await WriteEventAsync(new ChatStreamEvent
                {
                    Type = "studio_result",
                    Content = JsonSerializer.Serialize(result.Value, SseJsonOptions)
                }, cancellationToken);
            }
            else
            {
                await WriteEventAsync(ChatStreamEvent.ErrorEvent(result.Error.Description), cancellationToken);
            }

            await WriteEventAsync(new ChatStreamEvent { Type = "done" }, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Déconnexion du client : on attend la fin de l'exécution AVANT de libérer la requête
            // (le scope DI du handler doit survivre) ; le statut final reste consultable via GET.
            try { await sendTask; }
            catch { /* le résultat est persistant sur le plan */ }
        }
    }

    private async Task WriteEventAsync(ChatStreamEvent evt, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(evt, SseJsonOptions);
        await Response.WriteAsync($"data: {json}\n\n", cancellationToken);
        await Response.Body.FlushAsync(cancellationToken);
    }

    private sealed class ChannelBuildProgress : IStudioBuildProgress
    {
        private readonly ChannelWriter<StudioBuildStep> _writer;

        public ChannelBuildProgress(ChannelWriter<StudioBuildStep> writer) => _writer = writer;

        public void Report(StudioBuildStep step) => _writer.TryWrite(step);
    }
}
