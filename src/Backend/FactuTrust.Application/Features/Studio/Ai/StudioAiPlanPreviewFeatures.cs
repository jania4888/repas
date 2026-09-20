using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// Aperçu structuré d'un plan Studio IA persisté (PR 3.2c, flag <c>EnableStudioAiPlanPreview</c>) :
/// la spec stockée est re-projetée en <see cref="StudioAiPlanPreviewDto"/> par le constructeur PUR
/// <see cref="StudioAiPlanPreviewBuilder"/> (3.2b) — aucune écriture, aucun appel LLM. Le flag est
/// vérifié DANS le handler (contrôleur fin) : fonctionnalité coupée = introuvable, avec la même
/// chaîne figée que la création « from-spec ». Pour un amendement, le schéma RÉEL de la table cible
/// est relu via MediatR ; s'il est introuvable, l'aperçu reste rendu en mode dégradé (200 + warning,
/// C-B8) plutôt qu'en erreur.
/// </summary>
public sealed record GetStudioAiPlanPreviewQuery(Guid PlanId) : IRequest<Result<StudioAiPlanPreviewDto>>;

public sealed class GetStudioAiPlanPreviewQueryHandler
    : IRequestHandler<GetStudioAiPlanPreviewQuery, Result<StudioAiPlanPreviewDto>>
{
    private readonly IStudioAiBuildPlanRepository _plans;
    private readonly ICurrentUser _currentUser;
    private readonly IMediator _mediator;
    private readonly OllamaSettings _settings;

    public GetStudioAiPlanPreviewQueryHandler(
        IStudioAiBuildPlanRepository plans,
        ICurrentUser currentUser,
        IMediator mediator,
        IOptions<OllamaSettings> settings)
    {
        _plans = plans;
        _currentUser = currentUser;
        _mediator = mediator;
        _settings = settings.Value;
    }

    public async Task<Result<StudioAiPlanPreviewDto>> Handle(
        GetStudioAiPlanPreviewQuery request, CancellationToken cancellationToken)
    {
        // 1. Flag coupé = introuvable (chaîne figée, partagée avec les autres gardes Studio IA).
        if (!_settings.EnableStudioAiPlanPreview)
            return Result.Failure<StudioAiPlanPreviewDto>(Error.NotFound("Fonctionnalité non disponible."));

        // 2. Tenant → propriétaire → permission par nature (mêmes gardes que GET / spec / actions).
        var loaded = await StudioAiPlanDefaults.LoadAuthorizedAsync(
            _plans, _currentUser, request.PlanId, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<StudioAiPlanPreviewDto>(loaded.Error);
        var plan = loaded.Value;

        // 3. Amendement : diff résolu contre le schéma RÉEL de la table cible, relu via MediatR.
        //    Échec de lecture (table supprimée, tenant, permission) ⇒ schema null : le constructeur
        //    rend alors l'aperçu DÉGRADÉ (200 + warning), jamais une erreur (B-Q4).
        CustomEntitySchemaDto? schema = null;
        if (plan.Kind == StudioAiPlanKind.Amendment
            && StudioAiAmendmentSpec.TryParse(plan.SpecJson, out var amendment, out _) && amendment is not null)
        {
            var resolved = await _mediator.Send(
                new GetCustomEntitySchemaQuery(amendment.TargetEntityRef), cancellationToken);
            if (resolved.IsSuccess)
                schema = resolved.Value;
        }

        // 4. Projection pure et déterministe ; les deux flags bornent relations N-N et vues.
        return StudioAiPlanPreviewBuilder.Build(
            plan.Id, plan.Kind, plan.Status.ToString(), plan.SpecJson, plan.SummaryJson, schema,
            _settings.EnableStudioManyToMany, _settings.EnableStudioRecordViews);
    }
}

/// <summary>
/// Rejeu d'un plan Studio IA en état terminal (PR 3.2c, flag <c>EnableStudioAiPlanPreview</c>) :
/// la spec persistée RE-PASSE parse → canonicalisation → résumé recalculé (doublons et schéma de
/// vue enregistrée relus, jamais de confiance au contenu stocké), puis un plan NEUF
/// <c>Pending</c> est créé par délégation à <see cref="CreateStudioAiPlanCommand"/> — même
/// permission par nature, même audit <c>Studio.AiPlan.Created</c>. Le plan d'origine n'est JAMAIS
/// modifié ; le résumé du nouveau plan porte <c>replayedFromPlanId</c> (traçabilité). E1 : pour
/// les natures sans résumé recalculé (Amendment/View/Report), le summary persisté sert de repli.
/// </summary>
public sealed record ReplayStudioAiPlanCommand(Guid PlanId) : IRequest<Result<StudioAiPlanCreationResponse>>;

public sealed class ReplayStudioAiPlanCommandHandler
    : IRequestHandler<ReplayStudioAiPlanCommand, Result<StudioAiPlanCreationResponse>>
{
    private readonly IStudioAiBuildPlanRepository _plans;
    private readonly ICurrentUser _currentUser;
    private readonly IMediator _mediator;
    private readonly OllamaSettings _settings;
    private readonly ICustomEntityRepository? _customEntities;
    private readonly ICustomFieldRepository? _customFields;

    public ReplayStudioAiPlanCommandHandler(
        IStudioAiBuildPlanRepository plans,
        ICurrentUser currentUser,
        IMediator mediator,
        IOptions<OllamaSettings> settings,
        // Optionnels (défaut null) : sans eux, doublons et résolution de vue restent indicatifs,
        // comme à la validation « from-spec ». Production les résout via DI.
        ICustomEntityRepository? entities = null,
        ICustomFieldRepository? fields = null)
    {
        _plans = plans;
        _currentUser = currentUser;
        _mediator = mediator;
        _settings = settings.Value;
        _customEntities = entities;
        _customFields = fields;
    }

    public async Task<Result<StudioAiPlanCreationResponse>> Handle(
        ReplayStudioAiPlanCommand command, CancellationToken cancellationToken)
    {
        // Ordre des gardes : flag 404 → tenant/propriétaire 404, permission 401 → statut 409 → validation 400.
        if (!_settings.EnableStudioAiPlanPreview)
            return Result.Failure<StudioAiPlanCreationResponse>(Error.NotFound("Fonctionnalité non disponible."));

        var loaded = await StudioAiPlanDefaults.LoadAuthorizedAsync(
            _plans, _currentUser, command.PlanId, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<StudioAiPlanCreationResponse>(loaded.Error);
        var plan = loaded.Value;

        // États terminaux uniquement (Pending échu présenté « Expired » inclus) — message figé.
        if (!StudioAiPlanDefaults.IsReplayable(plan, DateTime.UtcNow))
            return Result.Failure<StudioAiPlanCreationResponse>(
                Error.Conflict("Seul un plan terminé, échoué, annulé ou expiré peut être rejoué."));

        // Re-canonicalisation : doublons contre les tables ACTIVES et schéma réel d'une vue
        // enregistrée, exactement comme la création « from-spec » (5 et 5 paramètres).
        var duplicates = await StudioAiPlanCreation.DetectDuplicatesAsync(
            plan.Kind, plan.SpecJson, _customEntities, _currentUser, cancellationToken);
        var recordViewSchema = plan.Kind == StudioAiPlanKind.RecordView
            ? await StudioAiPlanCreation.LoadRecordViewSchemaAsync(
                plan.SpecJson, _customEntities, _customFields, _currentUser, cancellationToken)
            : null;

        if (!StudioAiPlanCreation.TryCanonicalize(
                plan.Kind, plan.SpecJson, out var canonical, out var summary, out var error, duplicates, recordViewSchema))
            return Result.Failure<StudioAiPlanCreationResponse>(
                Error.Validation("spec", error ?? "La spec est invalide."));

        // E1 : Amendment/View/Report n'ont pas de résumé recalculé ⇒ repli sur le summary persisté.
        summary ??= plan.SummaryJson;
        summary = WithReplayedFrom(summary, plan.Id);

        // Création DÉLÉGUÉE : même permission RequiredPermission(kind), même audit
        // « Studio.AiPlan.Created » — le rejeu ne fait aucune écriture directe.
        var created = await _mediator.Send(
            new CreateStudioAiPlanCommand(plan.Kind, canonical!, summary), cancellationToken);
        if (created.IsFailure)
            return Result.Failure<StudioAiPlanCreationResponse>(created.Error);

        return Result.Success(new StudioAiPlanCreationResponse(
            created.Value, StudioAiPlanCreation.ToFreshSpecDto(created.Value, canonical!)));
    }

    /// <summary>
    /// Ajoute <c>replayedFromPlanId</c> À LA RACINE du résumé, sans toucher aux autres clés.
    /// Un résumé illisible est remplacé par un objet minimal (le marqueur reste posé).
    /// </summary>
    private static string WithReplayedFrom(string summary, Guid replayedFromPlanId)
    {
        JsonObject root;
        try
        {
            root = JsonNode.Parse(summary) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            root = new JsonObject();
        }
        root["replayedFromPlanId"] = replayedFromPlanId;
        return root.ToJsonString();
    }
}
