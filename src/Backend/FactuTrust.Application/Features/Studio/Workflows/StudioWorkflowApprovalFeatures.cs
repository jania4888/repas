using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>Corps de <c>POST studio/approvals/{id}/decide</c> (4.2e).</summary>
public sealed record ApprovalDecisionRequest(string? Comment);

/// <summary>Badge « Mes approbations » (A20) : nombre de demandes en attente pour l'utilisateur courant.</summary>
public sealed record ApprovalCountDto(int Count);

/// <summary>
/// Élément de la boîte de réception des approbations (format master-B2 §3.4, consommé par 4.4g) :
/// la demande, son instance, le workflow (« — » si la définition a été supprimée), l'entité, un
/// libellé d'enregistrement (premier champ texte, <see langword="null"/> si indisponible) et le nom du
/// lanceur (<c>StartedByName</c>, 4.5a2 / D-44-79, <see langword="null"/> si inconnu).
/// </summary>
public sealed record WorkflowApprovalInboxItemDto(
    WorkflowApprovalDto Approval,
    Guid InstanceId,
    string WorkflowKey,
    string WorkflowName,
    string EntityKey,
    string EntityName,
    Guid RecordId,
    string? RecordLabel,
    Guid? StartedBy,
    DateTime StartedAt,
    string? StartedByName = null);

/// <summary>Approbations en attente de l'utilisateur courant (directes ou via son rôle).</summary>
public sealed record ListMyApprovalsQuery(int Max = 100) : IRequest<Result<IReadOnlyList<WorkflowApprovalInboxItemDto>>>;

/// <summary>
/// Mes décisions d'approbation passées (4.7 « v1.1 », D‑47‑60) : approuvées/refusées par
/// l'utilisateur courant, triées de la plus récente. Même forme de DTO que la boîte de réception.
/// Borné par la rétention des instances (<c>StudioWorkflowRetentionDays</c>, la purge supprime
/// instances et approbations).
/// </summary>
public sealed record ListMyApprovalHistoryQuery(int Max = 50) : IRequest<Result<IReadOnlyList<WorkflowApprovalInboxItemDto>>>;

/// <summary>Compteur pour le badge (appel fréquent : une seule requête SQL).</summary>
public sealed record CountMyApprovalsQuery : IRequest<Result<ApprovalCountDto>>;

/// <summary>Décision (approuver / refuser) puis reprise inline du workflow via le runner.</summary>
public sealed record DecideApprovalCommand(Guid ApprovalId, bool Approve, string? Comment) : IRequest<Result<WorkflowInstanceDto>>;

public sealed class ListMyApprovalsQueryHandler
    : IRequestHandler<ListMyApprovalsQuery, Result<IReadOnlyList<WorkflowApprovalInboxItemDto>>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioUserNameResolver _userNames;

    public ListMyApprovalsQueryHandler(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordRepository records,
        ICurrentUser currentUser,
        IStudioUserNameResolver userNames)
    {
        _workflows = workflows;
        _entities = entities;
        _fields = fields;
        _records = records;
        _currentUser = currentUser;
        _userNames = userNames;
    }

    public async Task<Result<IReadOnlyList<WorkflowApprovalInboxItemDto>>> Handle(
        ListMyApprovalsQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<IReadOnlyList<WorkflowApprovalInboxItemDto>>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<IReadOnlyList<WorkflowApprovalInboxItemDto>>(
                Error.Unauthorized("Lecture des enregistrements requise."));

        var approvals = await _workflows.ListPendingApprovalsForUserAsync(
            tenantId, userId ?? Guid.Empty, _currentUser.Role?.ToString(), Math.Clamp(query.Max, 1, 200), cancellationToken);

        var items = await StudioApprovalInboxEnrichment.EnrichAsync(
            _workflows, _entities, _fields, _records, _userNames, tenantId, approvals,
            skipTerminalInstances: true, cancellationToken);
        return Result.Success<IReadOnlyList<WorkflowApprovalInboxItemDto>>(items);
    }
}

/// <summary>Historique de mes décisions d'approbation (onglet « Historique » de la page, 4.7 ap-b).</summary>
public sealed class ListMyApprovalHistoryQueryHandler
    : IRequestHandler<ListMyApprovalHistoryQuery, Result<IReadOnlyList<WorkflowApprovalInboxItemDto>>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioUserNameResolver _userNames;

    public ListMyApprovalHistoryQueryHandler(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordRepository records,
        ICurrentUser currentUser,
        IStudioUserNameResolver userNames)
    {
        _workflows = workflows;
        _entities = entities;
        _fields = fields;
        _records = records;
        _currentUser = currentUser;
        _userNames = userNames;
    }

    public async Task<Result<IReadOnlyList<WorkflowApprovalInboxItemDto>>> Handle(
        ListMyApprovalHistoryQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<IReadOnlyList<WorkflowApprovalInboxItemDto>>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<IReadOnlyList<WorkflowApprovalInboxItemDto>>(
                Error.Unauthorized("Lecture des enregistrements requise."));

        var approvals = await _workflows.ListDecidedApprovalsByUserAsync(
            tenantId, userId ?? Guid.Empty, Math.Clamp(query.Max, 1, 200), cancellationToken);

        // Mode tolérant : une instance terminée reste listée (la décision est passée) ; seule une
        // instance purgée entre la liste et l'enrichissement fait sauter la ligne.
        var items = await StudioApprovalInboxEnrichment.EnrichAsync(
            _workflows, _entities, _fields, _records, _userNames, tenantId, approvals,
            skipTerminalInstances: false, cancellationToken);
        return Result.Success<IReadOnlyList<WorkflowApprovalInboxItemDto>>(items);
    }
}

public sealed class CountMyApprovalsQueryHandler : IRequestHandler<CountMyApprovalsQuery, Result<ApprovalCountDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICurrentUser _currentUser;

    public CountMyApprovalsQueryHandler(IStudioWorkflowRepository workflows, ICurrentUser currentUser)
    {
        _workflows = workflows;
        _currentUser = currentUser;
    }

    public async Task<Result<ApprovalCountDto>> Handle(CountMyApprovalsQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<ApprovalCountDto>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<ApprovalCountDto>(Error.Unauthorized("Lecture des enregistrements requise."));

        var count = await _workflows.CountPendingApprovalsForUserAsync(
            tenantId, userId ?? Guid.Empty, _currentUser.Role?.ToString(), cancellationToken);
        return Result.Success(new ApprovalCountDto(count));
    }
}

public sealed class DecideApprovalCommandHandler : IRequestHandler<DecideApprovalCommand, Result<WorkflowInstanceDto>>
{
    private const int MaxNotificationBodyLength = 1000;

    private readonly IStudioWorkflowRepository _workflows;
    private readonly IStudioWorkflowRunner _runner;
    private readonly INotificationService _notifications;
    private readonly ICustomEntityRepository _entities;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _time;

    public DecideApprovalCommandHandler(
        IStudioWorkflowRepository workflows,
        IStudioWorkflowRunner runner,
        INotificationService notifications,
        ICustomEntityRepository entities,
        IAuditService audit,
        ICurrentUser currentUser,
        TimeProvider? time = null)
    {
        _workflows = workflows;
        _runner = runner;
        _notifications = notifications;
        _entities = entities;
        _audit = audit;
        _currentUser = currentUser;
        _time = time ?? TimeProvider.System;
    }

    public async Task<Result<WorkflowInstanceDto>> Handle(DecideApprovalCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<WorkflowInstanceDto>(err);
        if (userId is null)
            return Result.Failure<WorkflowInstanceDto>(Error.Unauthorized("Aucun utilisateur authentifié."));
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsWrite))
            return Result.Failure<WorkflowInstanceDto>(Error.Unauthorized("Écriture des enregistrements requise."));

        var approval = await _workflows.GetApprovalAsync(tenantId, command.ApprovalId, cancellationToken);
        // 404 (et non 403) : ne pas révéler l'existence d'une approbation assignée à quelqu'un d'autre.
        if (approval is null || !approval.CanBeDecidedBy(userId.Value, _currentUser.Role?.ToString()))
            return Result.Failure<WorkflowInstanceDto>(Error.NotFound("StudioWorkflowApproval", command.ApprovalId));
        if (approval.Status != StudioWorkflowApprovalStatus.Pending)
            return Result.Failure<WorkflowInstanceDto>(Error.Conflict("Cette approbation a déjà été traitée."));
        if (!command.Approve && string.IsNullOrWhiteSpace(command.Comment))
            return Result.Failure<WorkflowInstanceDto>(Error.Validation("comment", "Un commentaire est requis pour refuser."));
        if (command.Comment is { Length: > StudioWorkflowApproval.CommentMaxLength })
            return Result.Failure<WorkflowInstanceDto>(
                Error.Validation("comment", $"Le commentaire dépasse {StudioWorkflowApproval.CommentMaxLength} caractères."));

        var now = _time.GetUtcNow().UtcDateTime;
        var comment = string.IsNullOrWhiteSpace(command.Comment) ? null : command.Comment.Trim();
        approval.Decide(
            command.Approve ? StudioWorkflowApprovalStatus.Approved : StudioWorkflowApprovalStatus.Rejected,
            userId.Value, comment, now);
        try
        {
            await _workflows.UpdateApprovalAsync(approval, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Course perdue sur le RowVersion : quelqu'un a décidé entre-temps (D-41-16, même 409).
            return Result.Failure<WorkflowInstanceDto>(Error.Conflict("Cette approbation a déjà été traitée."));
        }

        var instance = await _workflows.GetInstanceAsync(tenantId, approval.InstanceId, cancellationToken);
        if (instance is null)
            return Result.Failure<WorkflowInstanceDto>(Error.NotFound("StudioWorkflowInstance", approval.InstanceId));

        // Définition (possiblement supprimée) : lien de la notification et clé/nom du DTO.
        var definition = await _workflows.GetDefinitionAsync(tenantId, instance.WorkflowDefinitionId, cancellationToken);

        if (!instance.IsTerminal)
        {
            // La décision est mémorisée au contexte et l'instance devient due sans changer d'étape (D-05 ;
            // contrat de repli JSON documenté sur StudioWorkflowDecisionSync — la décision, elle, est
            // déjà persistée sur l'approbation).
            StudioWorkflowDecisionSync.Apply(
                instance, approval.StepKey, StudioWorkflowEnumNames.ApprovalStatusName(approval.Status), comment, userId.Value, now);
            // Non atomique avec UpdateApprovalAsync (revue 4.2e) : si cette écriture échoue, l'approbation
            // est décidée mais l'instance n'est pas due — le job studio-workflow-resume réconcilie au tick
            // suivant (ListDueAsync), une nouvelle tentative utilisateur renvoie 409.
            await _workflows.UpdateInstanceAsync(instance, cancellationToken);

            if (instance.StartedBy is { } recipient)
                await SafeNotifyDecisionAsync(tenantId, approval, definition, instance, recipient, command.Approve, comment, cancellationToken);

            // Reprise inline ; LeaseBusy ⇒ l'instance est due, le job la reprendra au prochain tick.
            await _runner.ResumeUnderStarterAsync(instance, cancellationToken);
        }

        // Audit sans le commentaire (S-base) : statut + instance seulement.
        await StudioAudit.SafeLogAsync(
            _audit, "Studio.Workflow.ApprovalDecided", "StudioWorkflowApproval", approval.Id, null,
            new { status = StudioWorkflowEnumNames.ApprovalStatusName(approval.Status), instanceId = approval.InstanceId },
            cancellationToken);

        var reloaded = await _workflows.GetInstanceAsync(tenantId, instance.Id, cancellationToken);
        return Result.Success(StudioWorkflowMapping.ToDto(reloaded ?? instance, definition));
    }

    /// <summary>Notification 16 au lanceur — best-effort, tronquée ; ne fait jamais échouer la décision.</summary>
    private async Task SafeNotifyDecisionAsync(
        Guid tenantId, StudioWorkflowApproval approval, StudioWorkflowDefinition? definition,
        StudioWorkflowInstance instance, Guid recipient, bool approve, string? comment, CancellationToken ct)
    {
        string? link = null;
        if (definition is not null)
        {
            var entity = await _entities.GetByIdAsync(tenantId, definition.EntityDefinitionId, ct);
            if (entity is not null)
                link = $"/studio/d/{entity.Key}/{instance.RecordId}/edit";
        }

        try
        {
            await _notifications.CreateAsync(
                tenantId,
                null,
                NotificationType.StudioWorkflowApprovalDecided,
                $"Approbation « {approval.Title} » {(approve ? "accordée" : "refusée")}",
                Truncate(comment, MaxNotificationBodyLength) ?? string.Empty,
                link,
                recipient,
                ct);
        }
        catch (Exception)
        {
            // Notification best-effort : la décision est déjà persistée (pas de log du commentaire).
        }
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is not null && value.Length > maxLength ? value[..maxLength] : value;
}
