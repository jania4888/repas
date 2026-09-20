using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// Exécute un plan Studio IA confirmé (routage par <see cref="StudioAiPlanKind"/> vers les
/// orchestrateurs Infrastructure). Ne contient AUCUNE logique métier : tout passe par les
/// commandes CQRS Studio existantes (validation/quotas/permissions/audit inclus).
/// </summary>
public interface IStudioAiPlanExecutor
{
    Task<(bool Success, string? Error, object? Payload)> ExecuteAsync(
        StudioAiBuildPlan plan, IStudioBuildProgress? progress, CancellationToken cancellationToken);
}

public sealed record StudioAiPlanDto(
    Guid Id,
    string Kind,
    string Status,
    string SummaryJson,
    string? ResultJson,
    string? ErrorMessage,
    DateTime CreatedAt,
    DateTime ExpiresAt,
    DateTime? ExecutedAt);

public static class StudioAiPlanDefaults
{
    /// <summary>Durée de vie d'un plan en attente : au-delà, la confirmation est refusée.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(60);

    /// <summary>Statuts depuis lesquels un plan peut être REJOUÉ (PR 3.2) : tout état terminal.</summary>
    public static readonly IReadOnlySet<StudioAiPlanStatus> ReplayableStatuses =
        new HashSet<StudioAiPlanStatus>
        {
            StudioAiPlanStatus.Completed, StudioAiPlanStatus.Failed,
            StudioAiPlanStatus.Cancelled, StudioAiPlanStatus.Expired
        };

    /// <summary>
    /// Un plan est rejouable s'il est dans un état terminal (succès, échec, annulation, expiration)
    /// — y compris un plan Pending échu, présenté « Expired » sans écriture.
    /// </summary>
    public static bool IsReplayable(StudioAiBuildPlan plan, DateTime utcNow) =>
        ReplayableStatuses.Contains(plan.Status) || plan.IsExpired(utcNow);

    public static StudioAiPlanDto ToDto(StudioAiBuildPlan plan)
    {
        // Un plan Pending dont l'échéance est passée est présenté « Expired » sans écriture
        // (l'état persistant n'est corrigé qu'au moment d'une confirmation/annulation).
        var status = plan.IsExpired(DateTime.UtcNow) ? StudioAiPlanStatus.Expired : plan.Status;
        return new StudioAiPlanDto(
            plan.Id, plan.Kind.ToString(), status.ToString(), plan.SummaryJson,
            plan.ResultJson, plan.ErrorMessage, plan.CreatedAt, plan.ExpiresAt, plan.ExecutedAt);
    }

    /// <summary>Permission de design requise pour consulter/confirmer/annuler un plan selon sa nature.</summary>
    public static string RequiredPermission(StudioAiPlanKind kind) => kind switch
    {
        StudioAiPlanKind.View => Permissions.Studio.DesignForms,
        // PR 2.4 : une vue enregistrée relève de la conception des formulaires/affichages,
        // comme une fenêtre — pas de la définition du modèle de données.
        StudioAiPlanKind.RecordView => Permissions.Studio.DesignForms,
        StudioAiPlanKind.Report => Permissions.Studio.DesignReports,
        // PR 4.3 (D-11) : cas explicite — un plan de workflows relève de la conception des tables,
        // comme les créations ; ne pas le laisser au cas par défaut.
        StudioAiPlanKind.Workflow => Permissions.Studio.DesignEntities,
        _ => Permissions.Studio.DesignEntities
    };

    /// <summary>
    /// Politique de propriété (décision D1 du plan) : un plan n'est visible et actionnable QUE par
    /// son créateur. Un plan sans créateur connu n'appartient à personne et n'est donc jamais rendu
    /// (deny-by-default) ; un tel plan Pending expire de lui-même au bout de <see cref="Lifetime"/>.
    /// </summary>
    public static bool IsOwnedBy(StudioAiBuildPlan plan, Guid? userId) =>
        plan.CreatedBy is { } creator && userId is { } actor && creator == actor;

    /// <summary>
    /// Charge un plan puis applique, dans l'ordre, tenant → propriétaire → permission par nature.
    /// Un plan d'un autre tenant OU d'un autre utilisateur est indistinguable d'un plan inexistant
    /// (NotFound) : la référence ne révèle rien. Une permission révoquée entre l'aperçu et l'action
    /// est en revanche un refus explicite (Unauthorized), pour que l'UI n'affiche pas « introuvable ».
    /// </summary>
    internal static async Task<Result<StudioAiBuildPlan>> LoadAuthorizedAsync(
        IStudioAiBuildPlanRepository plans, ICurrentUser currentUser, Guid planId, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<StudioAiBuildPlan>(err);

        var plan = await plans.GetByIdAsync(tenantId, planId, cancellationToken);
        if (plan is null || !IsOwnedBy(plan, userId))
            return Result.Failure<StudioAiBuildPlan>(Error.NotFound("StudioAiBuildPlan", planId));

        // Revalidation à chaque action : le droit détenu au moment de l'aperçu ne vaut pas pour la suite.
        if (!currentUser.HasPermission(RequiredPermission(plan.Kind)))
            return Result.Failure<StudioAiBuildPlan>(Error.Unauthorized("Permission de conception Studio requise."));

        return Result.Success(plan);
    }
}

// ---- Create ----

public sealed record CreateStudioAiPlanCommand(StudioAiPlanKind Kind, string SpecJson, string SummaryJson)
    : IRequest<Result<StudioAiPlanDto>>;

public sealed class CreateStudioAiPlanCommandHandler
    : IRequestHandler<CreateStudioAiPlanCommand, Result<StudioAiPlanDto>>
{
    private readonly IStudioAiBuildPlanRepository _plans;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public CreateStudioAiPlanCommandHandler(
        IStudioAiBuildPlanRepository plans, IAuditService audit, ICurrentUser currentUser)
    {
        _plans = plans;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<StudioAiPlanDto>> Handle(CreateStudioAiPlanCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<StudioAiPlanDto>(err);

        if (string.IsNullOrWhiteSpace(command.SpecJson))
            return Result.Failure<StudioAiPlanDto>(Error.Validation("specJson", "La spécification du plan est vide."));
        if (string.IsNullOrWhiteSpace(command.SummaryJson))
            return Result.Failure<StudioAiPlanDto>(Error.Validation("summaryJson", "L'aperçu du plan est vide."));

        if (!_currentUser.HasPermission(StudioAiPlanDefaults.RequiredPermission(command.Kind)))
            return Result.Failure<StudioAiPlanDto>(Error.Unauthorized("Permission de conception Studio requise."));

        var plan = StudioAiBuildPlan.Create(
            tenantId, command.Kind, command.SpecJson, command.SummaryJson, userId, StudioAiPlanDefaults.Lifetime);

        await _plans.AddAsync(plan, cancellationToken);
        await StudioAudit.SafeLogAsync(_audit, "Studio.AiPlan.Created", "StudioAiBuildPlan", plan.Id,
            null, new { plan.Kind, plan.ExpiresAt }, cancellationToken);

        return Result.Success(StudioAiPlanDefaults.ToDto(plan));
    }
}

// ---- Get ----

public sealed record GetStudioAiPlanQuery(Guid Id) : IRequest<Result<StudioAiPlanDto>>;

public sealed class GetStudioAiPlanQueryHandler : IRequestHandler<GetStudioAiPlanQuery, Result<StudioAiPlanDto>>
{
    private readonly IStudioAiBuildPlanRepository _plans;
    private readonly ICurrentUser _currentUser;

    public GetStudioAiPlanQueryHandler(IStudioAiBuildPlanRepository plans, ICurrentUser currentUser)
    {
        _plans = plans;
        _currentUser = currentUser;
    }

    public async Task<Result<StudioAiPlanDto>> Handle(GetStudioAiPlanQuery request, CancellationToken cancellationToken)
    {
        // Le GET restitue SummaryJson (échantillon de données) et ResultJson : mêmes gardes que les
        // actions — propriétaire uniquement et droit de conception revalidé pour la nature du plan.
        var loaded = await StudioAiPlanDefaults.LoadAuthorizedAsync(_plans, _currentUser, request.Id, cancellationToken);
        return loaded.IsFailure
            ? Result.Failure<StudioAiPlanDto>(loaded.Error)
            : Result.Success(StudioAiPlanDefaults.ToDto(loaded.Value));
    }
}

// ---- Confirm (exécution déterministe, jamais déclenchée par le LLM) ----

public sealed record ConfirmStudioAiPlanCommand(Guid Id, IStudioBuildProgress? Progress = null)
    : IRequest<Result<StudioAiPlanDto>>;

public sealed class ConfirmStudioAiPlanCommandHandler
    : IRequestHandler<ConfirmStudioAiPlanCommand, Result<StudioAiPlanDto>>
{
    private readonly IStudioAiBuildPlanRepository _plans;
    private readonly IStudioAiPlanExecutor _executor;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public ConfirmStudioAiPlanCommandHandler(
        IStudioAiBuildPlanRepository plans,
        IStudioAiPlanExecutor executor,
        IAuditService audit,
        ICurrentUser currentUser)
    {
        _plans = plans;
        _executor = executor;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<StudioAiPlanDto>> Handle(ConfirmStudioAiPlanCommand command, CancellationToken cancellationToken)
    {
        // Tenant → propriétaire → permission par nature (défense en profondeur : la politique du
        // contrôleur exige une permission de design, mais pas celle qui correspond au plan).
        var loaded = await StudioAiPlanDefaults.LoadAuthorizedAsync(_plans, _currentUser, command.Id, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<StudioAiPlanDto>(loaded.Error);
        var plan = loaded.Value;

        if (plan.IsExpired(DateTime.UtcNow))
        {
            plan.MarkExpired();
            await _plans.TryUpdateAsync(plan, cancellationToken);
            return Result.Failure<StudioAiPlanDto>(
                Error.Validation("plan", "Ce plan a expiré. Redemandez la génération à l'assistant."));
        }

        if (plan.Status != StudioAiPlanStatus.Pending)
            return Result.Failure<StudioAiPlanDto>(
                Error.Conflict("Ce plan a déjà été traité (exécuté, annulé ou expiré)."));

        // Verrou anti double-confirmation : le perdant du RowVersion renonce sans rien exécuter.
        plan.MarkExecuting();
        if (!await _plans.TryUpdateAsync(plan, cancellationToken))
            return Result.Failure<StudioAiPlanDto>(Error.Conflict("Ce plan est déjà en cours d'exécution."));

        // Une exception qui s'échappe de l'exécuteur (défaut bruyant, erreur d'infrastructure) ne
        // doit pas laisser le plan figé en Executing — il deviendrait inannulable et inconfirmable.
        bool success; string? error; object? payload;
        try
        {
            (success, error, payload) = await _executor.ExecuteAsync(plan, command.Progress, cancellationToken);
        }
        catch (Exception)
        {
            plan.MarkFailed("Échec inattendu de l'exécution du plan.");
            await _plans.TryUpdateAsync(plan, cancellationToken);
            throw;
        }
        if (success)
            plan.MarkCompleted(payload is null ? null : System.Text.Json.JsonSerializer.Serialize(payload));
        else
            plan.MarkFailed(error ?? "Échec de l'exécution du plan.");

        await _plans.TryUpdateAsync(plan, cancellationToken);
        // Auteur du plan et acteur de la confirmation sont tracés séparément (l'acteur est porté par
        // le service d'audit ; l'auteur est celui du plan), même si la politique actuelle les confond.
        await StudioAudit.SafeLogAsync(_audit,
            success ? "Studio.AiPlan.Executed" : "Studio.AiPlan.Failed", "StudioAiBuildPlan", plan.Id,
            null, new { plan.Kind, plan.Status, PlanCreatedBy = plan.CreatedBy, ConfirmedBy = _currentUser.UserId }, cancellationToken);

        return success
            ? Result.Success(StudioAiPlanDefaults.ToDto(plan))
            : Result.Failure<StudioAiPlanDto>(Error.Validation("plan", plan.ErrorMessage ?? "Échec de l'exécution du plan."));
    }
}

// ---- Cancel ----

public sealed record CancelStudioAiPlanCommand(Guid Id) : IRequest<Result<StudioAiPlanDto>>;

public sealed class CancelStudioAiPlanCommandHandler
    : IRequestHandler<CancelStudioAiPlanCommand, Result<StudioAiPlanDto>>
{
    private readonly IStudioAiBuildPlanRepository _plans;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public CancelStudioAiPlanCommandHandler(
        IStudioAiBuildPlanRepository plans, IAuditService audit, ICurrentUser currentUser)
    {
        _plans = plans;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<StudioAiPlanDto>> Handle(CancelStudioAiPlanCommand command, CancellationToken cancellationToken)
    {
        // Annuler est aussi une action sur le plan : propriétaire uniquement et droit par nature revalidé.
        var loaded = await StudioAiPlanDefaults.LoadAuthorizedAsync(_plans, _currentUser, command.Id, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<StudioAiPlanDto>(loaded.Error);
        var plan = loaded.Value;

        if (plan.Status != StudioAiPlanStatus.Pending)
            return Result.Failure<StudioAiPlanDto>(Error.Conflict("Seul un plan en attente peut être annulé."));

        plan.MarkCancelled();
        if (!await _plans.TryUpdateAsync(plan, cancellationToken))
            return Result.Failure<StudioAiPlanDto>(Error.Conflict("Ce plan est déjà en cours d'exécution."));

        await StudioAudit.SafeLogAsync(_audit, "Studio.AiPlan.Cancelled", "StudioAiBuildPlan", plan.Id,
            null, new { plan.Kind, PlanCreatedBy = plan.CreatedBy, CancelledBy = _currentUser.UserId }, cancellationToken);
        return Result.Success(StudioAiPlanDefaults.ToDto(plan));
    }
}
