using FactuTrust.Application.Common.Identity;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows;

/// <summary>
/// Implémentation de <see cref="IStudioWorkflowRunner"/> (plan 4.2c2). La reprise pose le bail
/// (<see cref="IStudioWorkflowRepository.TryLeaseInstanceAsync"/>, atomique par RowVersion), résout le
/// cliché d'impersonation du lanceur (<see cref="IImpersonationSnapshotResolver"/>, fail-closed) puis
/// exécute le moteur dans ce périmètre ; le bail est relâché en <c>finally</c> même si le moteur lève.
/// Aucune donnée d'instance n'est loguée ; le cliché n'est jamais mis en cache (résolution à chaque tick).
/// Le ctor dépasse la fiche 4.2c2 de <see cref="ICustomEntityRepository"/> et
/// <see cref="IAuditService"/> : le chemin « lanceur indisponible » doit le nom de la définition, la clé
/// d'entité (lien de la notification 17) et l'audit <c>Studio.Workflow.InstanceFailed</c> (écart consigné).
/// </summary>
internal sealed class StudioWorkflowRunner : IStudioWorkflowRunner
{
    private const string StarterUnavailableReason = "Lanceur introuvable ou inactif : reprise refusée.";

    private readonly IStudioWorkflowRepository _workflows;
    private readonly IStudioWorkflowEngine _engine;
    private readonly IImpersonationSnapshotResolver _impersonation;
    private readonly ICurrentUser _currentUser;
    private readonly INotificationService _notifications;
    private readonly ICustomEntityRepository _entities;
    private readonly IAuditService _audit;
    private readonly OllamaSettings _settings;
    private readonly ILogger<StudioWorkflowRunner> _logger;
    private readonly TimeProvider _timeProvider;

    public StudioWorkflowRunner(
        IStudioWorkflowRepository workflows,
        IStudioWorkflowEngine engine,
        IImpersonationSnapshotResolver impersonation,
        ICurrentUser currentUser,
        INotificationService notifications,
        ICustomEntityRepository entities,
        IAuditService audit,
        IOptions<OllamaSettings> settings,
        ILogger<StudioWorkflowRunner> logger,
        TimeProvider? timeProvider = null)
    {
        _workflows = workflows;
        _engine = engine;
        _impersonation = impersonation;
        _currentUser = currentUser;
        _notifications = notifications;
        _entities = entities;
        _audit = audit;
        _settings = settings.Value;
        _logger = logger;
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public async Task<StudioWorkflowRunOutcome> ResumeUnderStarterAsync(StudioWorkflowInstance instance, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(instance);
        if (instance.IsTerminal)
            return StudioWorkflowRunOutcome.Skipped;

        var lease = _settings.StudioWorkflowLeaseDuration;
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        if (!await _workflows.TryLeaseInstanceAsync(instance, now, lease, ct))
            return StudioWorkflowRunOutcome.LeaseBusy;

        try
        {
            if (instance.StartedBy is not { } starterId)
            {
                // Déclencheur système : pas d'impersonation — ICurrentUser reste celui du scope appelant
                // (anonyme sous Hangfire).
                await _engine.ResumeAsync(instance, ct);
                return StudioWorkflowRunOutcome.Resumed;
            }

            var snapshot = await _impersonation.ResolveAsync(
                instance.TenantId, starterId, $"studio-workflow:{instance.Id:N}", ct);
            if (snapshot is null)
            {
                await FailForUnavailableStarterAsync(instance, ct);
                return StudioWorkflowRunOutcome.StarterUnavailable;
            }

            using (ImpersonatedUserContext.Enter(snapshot))
            {
                await _engine.ResumeAsync(instance, ct);
            }

            return StudioWorkflowRunOutcome.Resumed;
        }
        finally
        {
            instance.ReleaseLease();
            try
            {
                await _workflows.UpdateInstanceAsync(instance, ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Une écriture concurrente a gagné pendant l'exécution : le reaper (4.2d) rattrapera.
                _logger.LogWarning("Workflow {InstanceId} : relâchement du bail sur RowVersion périmé.", instance.Id);
            }
            catch (Exception persistEx)
            {
                // Jamais masquer l'exception du moteur par celle du relâchement (revue 4.2c2) : on
                // journalise et on laisse l'originale (ou le retour) se propager ; le reaper rattrapera.
                _logger.LogError(persistEx, "Workflow {InstanceId} : échec du relâchement du bail ; le reaper rattrapera.", instance.Id);
            }
        }
    }

    public async Task<Result<StudioWorkflowInstance>> StartUnderCurrentUserAsync(
        StudioWorkflowDefinition definition, Guid recordId, StudioWorkflowTriggerKind trigger, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(definition);
        if (!StudioContext.TryGet(_currentUser, out _, out var userId, out var error))
            return Result.Failure<StudioWorkflowInstance>(error);

        var instance = await _engine.StartAsync(
            definition, recordId, trigger, userId, _currentUser.Email,
            previousDataJson: null, depth: 0, originInstanceId: null, ct);
        return Result.Success(instance);
    }

    /// <summary>
    /// Met l'instance en échec puis notifie le lanceur (type 17, titre/lien sur le modèle de
    /// <c>StudioWorkflowEngine.NotifyFailureAsync</c>) et audite. Notification et audit sont best-effort.
    /// </summary>
    private async Task FailForUnavailableStarterAsync(StudioWorkflowInstance instance, CancellationToken ct)
    {
        instance.Fail(StarterUnavailableReason);
        await _workflows.UpdateInstanceAsync(instance, ct);

        var definition = await _workflows.GetDefinitionAsync(instance.TenantId, instance.WorkflowDefinitionId, ct);
        var title = "Workflow supprimé en échec";
        string? link = null;
        if (definition is not null)
        {
            title = $"Workflow « {definition.Name} » en échec";
            var entity = await _entities.GetByIdAsync(instance.TenantId, definition.EntityDefinitionId, ct);
            if (entity is not null)
                link = $"/studio/d/{entity.Key}/{instance.RecordId}/edit";
        }

        try
        {
            await _notifications.CreateAsync(
                instance.TenantId,
                null,
                NotificationType.StudioWorkflowStepFailed,
                title,
                StarterUnavailableReason,
                link,
                instance.StartedBy!.Value,
                ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Workflow starter-unavailable notification failed {InstanceId}", instance.Id);
        }

        await StudioAudit.SafeLogAsync(
            _audit, StudioWorkflowEngine.InstanceFailedAction, "StudioWorkflowInstance", instance.Id, null,
            new { Reason = "starter-unavailable" }, ct);
    }
}
