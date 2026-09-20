using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>Workflow lançable à la main sur une fiche (onglet « Workflows », 4.4h).</summary>
public sealed record RunnableWorkflowDto(Guid Id, string Key, string Name, string? Description, int StepCount);

/// <summary>Corps de <c>POST studio/workflows/instances/{id}/cancel</c> (4.2f).</summary>
public sealed record CancelInstanceRequest(string? Reason);

/// <summary>Instances de workflow d'un enregistrement, les plus récentes d'abord.</summary>
public sealed record ListRecordWorkflowInstancesQuery(string EntityKey, Guid RecordId, int Max = 50)
    : IRequest<Result<IReadOnlyList<WorkflowInstanceDto>>>;

/// <summary>Détail d'une instance d'un enregistrement, pour les lecteurs (<c>custom_records:read</c>, 4.5b1 / D11).</summary>
public sealed record GetRecordWorkflowInstanceQuery(string EntityKey, Guid RecordId, Guid InstanceId)
    : IRequest<Result<WorkflowInstanceDetailDto>>;

/// <summary>Workflows manuels actifs de la table (bouton « Lancer » de la fiche).</summary>
public sealed record GetRecordWorkflowsQuery(string EntityKey)
    : IRequest<Result<IReadOnlyList<RunnableWorkflowDto>>>;

/// <summary>Lance un workflow manuel sur l'enregistrement, sous l'identité de l'utilisateur courant.</summary>
public sealed record RunWorkflowCommand(string EntityKey, Guid RecordId, string WorkflowKey)
    : IRequest<Result<WorkflowInstanceDto>>;

/// <summary>Annule une instance ouverte (le moteur annule aussi les approbations en attente, D-20).</summary>
public sealed record CancelInstanceCommand(Guid InstanceId, string? Reason) : IRequest<Result<WorkflowInstanceDto>>;

/// <summary>Re-émet les notifications des approbations en attente (1 relance / 24 h).</summary>
public sealed record RemindInstanceCommand(Guid InstanceId) : IRequest<Result<WorkflowInstanceDto>>;

public sealed class ListRecordWorkflowInstancesQueryHandler
    : IRequestHandler<ListRecordWorkflowInstancesQuery, Result<IReadOnlyList<WorkflowInstanceDto>>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioUserNameResolver _userNames;

    public ListRecordWorkflowInstancesQueryHandler(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomRecordRepository records,
        ICurrentUser currentUser,
        IStudioUserNameResolver userNames)
    {
        _workflows = workflows;
        _entities = entities;
        _records = records;
        _currentUser = currentUser;
        _userNames = userNames;
    }

    public async Task<Result<IReadOnlyList<WorkflowInstanceDto>>> Handle(
        ListRecordWorkflowInstancesQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<WorkflowInstanceDto>>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<IReadOnlyList<WorkflowInstanceDto>>(
                Error.Unauthorized("Lecture des enregistrements requise."));

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(
            _entities, tenantId, query.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<IReadOnlyList<WorkflowInstanceDto>>(resolveError);

        // 404 aussi pour un enregistrement d'un autre tenant (aucune divulgation).
        var record = await _records.GetAsync(tenantId, entity.Id, query.RecordId, cancellationToken);
        if (record is null)
            return Result.Failure<IReadOnlyList<WorkflowInstanceDto>>(Error.NotFound("CustomRecord", query.RecordId));

        var instances = await _workflows.ListInstancesForRecordAsync(
            tenantId, query.RecordId, Math.Clamp(query.Max, 1, 200), cancellationToken);

        // Clé/nom du workflow : une lecture par définition distincte (supprimée ⇒ null toléré).
        var definitions = new Dictionary<Guid, StudioWorkflowDefinition?>();
        var result = new List<WorkflowInstanceDto>(instances.Count);
        foreach (var instance in instances)
        {
            if (!definitions.TryGetValue(instance.WorkflowDefinitionId, out var definition))
            {
                definition = await _workflows.GetDefinitionAsync(
                    tenantId, instance.WorkflowDefinitionId, cancellationToken);
                definitions[instance.WorkflowDefinitionId] = definition;
            }
            // Route lecteur : l'erreur au niveau instance (texte interne possible) ne sort pas
            // (revue ★ 4.6 / D-46-05 — même règle que le détail ; l'onglet fiche ne la rend pas).
            result.Add(StudioWorkflowMapping.ToDto(instance, definition) with { Error = null });
        }

        // 4.6b1 / D-46-B01 — « Demandé par » : une résolution en lot pour la page (motif inbox 4.5a2).
        return Result.Success<IReadOnlyList<WorkflowInstanceDto>>(
            await StudioWorkflowStartedByNameSupport.ResolveAsync(_userNames, tenantId, result, cancellationToken));
    }
}

public sealed class GetRecordWorkflowInstanceQueryHandler
    : IRequestHandler<GetRecordWorkflowInstanceQuery, Result<WorkflowInstanceDetailDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioUserNameResolver _userNames;

    public GetRecordWorkflowInstanceQueryHandler(
        IStudioWorkflowRepository workflows, ICustomEntityRepository entities, ICustomRecordRepository records, ICurrentUser currentUser,
        IStudioUserNameResolver userNames)
    {
        _workflows = workflows;
        _entities = entities;
        _records = records;
        _currentUser = currentUser;
        _userNames = userNames;
    }

    public async Task<Result<WorkflowInstanceDetailDto>> Handle(GetRecordWorkflowInstanceQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<WorkflowInstanceDetailDto>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<WorkflowInstanceDetailDto>(Error.Unauthorized("Lecture des enregistrements requise."));

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, query.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<WorkflowInstanceDetailDto>(resolveError);

        // 404 aussi pour un enregistrement d'un autre tenant (aucune divulgation).
        var record = await _records.GetAsync(tenantId, entity.Id, query.RecordId, cancellationToken);
        if (record is null)
            return Result.Failure<WorkflowInstanceDetailDto>(Error.NotFound("CustomRecord", query.RecordId));

        // L'instance doit appartenir à CET enregistrement de CETTE table ; sinon 404 non révélateur (D-45-04).
        var instance = await _workflows.GetInstanceAsync(tenantId, query.InstanceId, cancellationToken);
        if (instance is null || instance.RecordId != query.RecordId || instance.EntityDefinitionId != entity.Id)
            return Result.Failure<WorkflowInstanceDetailDto>(Error.NotFound("StudioWorkflowInstance", query.InstanceId));

        // Portée lecteur : contexte expurgé (e-mail du lanceur, results, vars — D-45-27). Le NOM du lanceur
        // reste servi (colonne « Demandé par » déjà visible aux lecteurs dans l'inbox, 4.5e — D-46-B01).
        return Result.Success(await StudioWorkflowInstanceDetailBuilder.BuildAsync(
            _workflows, tenantId, instance, cancellationToken, readerScope: true, userNames: _userNames));
    }
}

public sealed class GetRecordWorkflowsQueryHandler
    : IRequestHandler<GetRecordWorkflowsQuery, Result<IReadOnlyList<RunnableWorkflowDto>>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICurrentUser _currentUser;

    public GetRecordWorkflowsQueryHandler(
        IStudioWorkflowRepository workflows, ICustomEntityRepository entities, ICurrentUser currentUser)
    {
        _workflows = workflows;
        _entities = entities;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<RunnableWorkflowDto>>> Handle(
        GetRecordWorkflowsQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<RunnableWorkflowDto>>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<IReadOnlyList<RunnableWorkflowDto>>(
                Error.Unauthorized("Lecture des enregistrements requise."));

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(
            _entities, tenantId, query.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<IReadOnlyList<RunnableWorkflowDto>>(resolveError);

        var definitions = await _workflows.ListActiveByTriggerAsync(
            tenantId, entity.Id, StudioWorkflowTriggerKind.Manual, cancellationToken);

        var result = definitions
            .Select(d => new RunnableWorkflowDto(d.Id, d.Key, d.Name, d.Description, StepCountOf(d.StepsJson)))
            .ToList();
        return Result.Success<IReadOnlyList<RunnableWorkflowDto>>(result);
    }

    /// <summary>Nombre d'étapes du spec ; 0 si le JSON est devenu illisible (le DTO reste exploitable).</summary>
    private static int StepCountOf(string stepsJson)
    {
        var parsed = StudioWorkflowStepsSpec.Parse(stepsJson);
        return parsed.IsSuccess ? parsed.Value.Steps.Count : 0;
    }
}

public sealed class RunWorkflowCommandHandler : IRequestHandler<RunWorkflowCommand, Result<WorkflowInstanceDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordRepository _records;
    private readonly IStudioWorkflowRunner _runner;
    private readonly IStudioQuotaService _quota;
    private readonly ICurrentUser _currentUser;

    public RunWorkflowCommandHandler(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomRecordRepository records,
        IStudioWorkflowRunner runner,
        IStudioQuotaService quota,
        ICurrentUser currentUser)
    {
        _workflows = workflows;
        _entities = entities;
        _records = records;
        _runner = runner;
        _quota = quota;
        _currentUser = currentUser;
    }

    public async Task<Result<WorkflowInstanceDto>> Handle(RunWorkflowCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<WorkflowInstanceDto>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsWrite))
            return Result.Failure<WorkflowInstanceDto>(Error.Unauthorized("Écriture des enregistrements requise."));

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(
            _entities, tenantId, command.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<WorkflowInstanceDto>(resolveError);

        var record = await _records.GetAsync(tenantId, entity.Id, command.RecordId, cancellationToken);
        if (record is null)
            return Result.Failure<WorkflowInstanceDto>(Error.NotFound("CustomRecord", command.RecordId));

        var definition = await _workflows.GetDefinitionByKeyAsync(tenantId, entity.Id, command.WorkflowKey, cancellationToken);
        if (definition is null || !definition.IsActive || definition.Trigger != StudioWorkflowTriggerKind.Manual)
            return Result.Failure<WorkflowInstanceDto>(
                Error.NotFound($"Workflow « {command.WorkflowKey} » introuvable ou non lançable à la main."));

        // Quota anti-boucle (400 Validation.Plan, motif StudioWorkflowTriggerHandler).
        var openCount = await _workflows.CountInstancesForRecordAsync(
            tenantId, command.RecordId, openOnly: true, cancellationToken);
        var quota = await _quota.EnsureUnderLimitAsync(
            tenantId, StudioQuotas.MaxWorkflowInstancesPerRecordKey, openCount,
            StudioQuotas.MaxWorkflowInstancesPerRecordFallback,
            "instances de workflow actives par enregistrement", cancellationToken);
        if (quota.IsFailure)
            return Result.Failure<WorkflowInstanceDto>(quota.Error);

        var started = await _runner.StartUnderCurrentUserAsync(
            definition, command.RecordId, StudioWorkflowTriggerKind.Manual, cancellationToken);
        if (started.IsFailure)
            return Result.Failure<WorkflowInstanceDto>(started.Error);

        return Result.Success(StudioWorkflowMapping.ToDto(started.Value, definition));
    }
}

public sealed class CancelInstanceCommandHandler : IRequestHandler<CancelInstanceCommand, Result<WorkflowInstanceDto>>
{
    private const int MaxReasonLength = 500;

    private readonly IStudioWorkflowRepository _workflows;
    private readonly IStudioWorkflowEngine _engine;
    private readonly ICurrentUser _currentUser;

    public CancelInstanceCommandHandler(
        IStudioWorkflowRepository workflows, IStudioWorkflowEngine engine, ICurrentUser currentUser)
    {
        _workflows = workflows;
        _engine = engine;
        _currentUser = currentUser;
    }

    public async Task<Result<WorkflowInstanceDto>> Handle(CancelInstanceCommand command, CancellationToken cancellationToken)
    {
        // RecordsWrite (R15 ratifié) : pas de studio:design_entities pour le runtime lecteur.
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<WorkflowInstanceDto>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsWrite))
            return Result.Failure<WorkflowInstanceDto>(Error.Unauthorized("Écriture des enregistrements requise."));

        var instance = await _workflows.GetInstanceAsync(tenantId, command.InstanceId, cancellationToken);
        if (instance is null)
            return Result.Failure<WorkflowInstanceDto>(Error.NotFound("StudioWorkflowInstance", command.InstanceId));
        if (instance.IsTerminal)
            return Result.Failure<WorkflowInstanceDto>(Error.Conflict("Cette instance est déjà terminée."));

        var trimmed = string.IsNullOrWhiteSpace(command.Reason) ? null : command.Reason.Trim();
        var reason = trimmed is null
            ? "Annulée par l'utilisateur"
            : trimmed[..Math.Min(trimmed.Length, MaxReasonLength)];

        // Le moteur annule aussi les approbations Pending et audite Studio.Workflow.InstanceCancelled (D-20).
        await _engine.CancelAsync(instance, reason, userId, cancellationToken);

        var definition = await _workflows.GetDefinitionAsync(tenantId, instance.WorkflowDefinitionId, cancellationToken);
        return Result.Success(StudioWorkflowMapping.ToDto(instance, definition));
    }
}

public sealed class RemindInstanceCommandHandler : IRequestHandler<RemindInstanceCommand, Result<WorkflowInstanceDto>>
{
    private static readonly TimeSpan RemindCooldown = TimeSpan.FromHours(24);

    private readonly IStudioWorkflowRepository _workflows;
    private readonly INotificationService _notifications;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _time;
    private readonly ILogger<RemindInstanceCommandHandler> _logger;

    public RemindInstanceCommandHandler(
        IStudioWorkflowRepository workflows,
        INotificationService notifications,
        IAuditService audit,
        ICurrentUser currentUser,
        TimeProvider? time = null,
        ILogger<RemindInstanceCommandHandler>? logger = null)
    {
        _workflows = workflows;
        _notifications = notifications;
        _audit = audit;
        _currentUser = currentUser;
        _time = time ?? TimeProvider.System;
        _logger = logger ?? NullLogger<RemindInstanceCommandHandler>.Instance;
    }

    public async Task<Result<WorkflowInstanceDto>> Handle(RemindInstanceCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<WorkflowInstanceDto>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsWrite))
            return Result.Failure<WorkflowInstanceDto>(Error.Unauthorized("Écriture des enregistrements requise."));

        var instance = await _workflows.GetInstanceAsync(tenantId, command.InstanceId, cancellationToken);
        if (instance is null)
            return Result.Failure<WorkflowInstanceDto>(Error.NotFound("StudioWorkflowInstance", command.InstanceId));
        if (instance.Status != StudioWorkflowInstanceStatus.WaitingApproval)
            return Result.Failure<WorkflowInstanceDto>(
                Error.Conflict("Aucune approbation en attente sur cette instance."));

        var now = _time.GetUtcNow().UtcDateTime;
        if (instance.LastRemindedAt is { } last && now - last < RemindCooldown)
            return Result.Failure<WorkflowInstanceDto>(
                Error.Conflict("Les approbateurs ont déjà été relancés il y a moins de 24 h."));

        var pending = (await _workflows.ListApprovalsForInstanceAsync(tenantId, instance.Id, cancellationToken))
            .Where(a => a.Status == StudioWorkflowApprovalStatus.Pending)
            .ToList();
        if (pending.Count == 0)
            return Result.Failure<WorkflowInstanceDto>(
                Error.Conflict("Aucune approbation en attente sur cette instance."));

        foreach (var approval in pending)
        {
            try
            {
                // Mêmes arguments que la demande initiale (ApprovalStepHandler), titre préfixé.
                await _notifications.CreateAsync(
                    tenantId, approval.AssigneeRole, NotificationType.StudioWorkflowApprovalRequested,
                    $"Rappel : {approval.Title}", approval.Message ?? string.Empty, "/studio/approvals",
                    approval.AssigneeUserId, cancellationToken);
            }
            catch (Exception ex)
            {
                // Notification best-effort : la relance est mémorisée quoi qu'il arrive (revue 4.2f : log support).
                _logger.LogWarning(ex, "Relance de l'approbation {ApprovalId} non notifiée", approval.Id);
            }
        }

        instance.MarkReminded(now);
        await _workflows.UpdateInstanceAsync(instance, cancellationToken);

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.Workflow.InstanceReminded", "StudioWorkflowInstance", instance.Id, null,
            new { pendingApprovals = pending.Count }, cancellationToken);

        var definition = await _workflows.GetDefinitionAsync(tenantId, instance.WorkflowDefinitionId, cancellationToken);
        return Result.Success(StudioWorkflowMapping.ToDto(instance, definition));
    }
}
