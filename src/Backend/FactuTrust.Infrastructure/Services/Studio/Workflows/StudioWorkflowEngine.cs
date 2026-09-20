using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows;

/// <summary>
/// Moteur d'exécution des workflows Studio (PR 4.1f2) : exécute les étapes par SEGMENTS
/// synchrones bornés (30 étapes et 5 s par défaut, délai borné 1..30), avec un checkpoint
/// SQL (<c>UpdateInstanceAsync</c>) après CHAQUE étape — une interruption ne perd jamais
/// plus que l'étape en cours, et un segment épuisé est suspendu (<c>Waiting</c>, échéance
/// immédiate) pour reprise par le job différé (4.2). Anti-boucle : la portée ambiante
/// <see cref="StudioWorkflowExecutionScope"/> est posée pendant chaque étape avec
/// <c>Depth + 1</c> ; les sauts arrière sont refusés. Journaux : ids et clés d'étapes
/// uniquement, jamais de données d'enregistrement.
/// </summary>
public sealed class StudioWorkflowEngine : IStudioWorkflowEngine
{
    /// <summary>Nombre maximal d'étapes exécutées dans un segment synchrone.</summary>
    public const int MaxStepsPerSegment = 30;

    private const string InvalidDefinitionMessage = "Définition invalide";
    private const string RecordDeletedMessage = "Enregistrement supprimé";
    private const string UnsupportedStepTypeMessage = "Type d'étape non pris en charge.";
    private const string BackwardGotoMessage = "Saut arrière interdit.";
    private const string WorkflowDisabledMessage = "Workflow désactivé";

    private const string InstanceStartedAction = "Studio.Workflow.InstanceStarted";

    // internal : partagé avec StudioWorkflowRunner (chemin « lanceur indisponible ») — source unique du nom d'audit.
    internal const string InstanceFailedAction = "Studio.Workflow.InstanceFailed";
    private const string InstanceCancelledAction = "Studio.Workflow.InstanceCancelled";

    private const int MaxStepRunResultBytes = 8 * 1024;
    private const int MaxNotificationBodyLength = 1000;

    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly IReadOnlyDictionary<string, IStudioWorkflowStepHandler> _handlers;
    private readonly INotificationService _notifications;
    private readonly IAuditService _audit;
    private readonly OllamaSettings _settings;
    private readonly ILogger<StudioWorkflowEngine> _logger;
    private readonly TimeProvider _timeProvider;

    public StudioWorkflowEngine(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordRepository records,
        IEnumerable<IStudioWorkflowStepHandler> handlers,
        INotificationService notifications,
        IAuditService audit,
        IOptions<OllamaSettings> settings,
        ILogger<StudioWorkflowEngine> logger,
        TimeProvider? timeProvider = null)
    {
        _workflows = workflows;
        _entities = entities;
        _fields = fields;
        _records = records;
        _notifications = notifications;
        _audit = audit;
        _settings = settings.Value;
        _logger = logger;
        _timeProvider = timeProvider ?? TimeProvider.System;

        // Indexation par type d'étape (sensible à la casse) : un doublon est une erreur de composition.
        var byType = new Dictionary<string, IStudioWorkflowStepHandler>(StringComparer.Ordinal);
        foreach (var handler in handlers)
        {
            if (!byType.TryAdd(handler.StepType, handler))
                throw new InvalidOperationException($"Plusieurs handlers pour le type d'étape « {handler.StepType} ».");
        }
        _handlers = byType;
    }

    /// <inheritdoc />
    public async Task<StudioWorkflowInstance> StartAsync(
        StudioWorkflowDefinition definition,
        Guid recordId,
        StudioWorkflowTriggerKind trigger,
        Guid? startedBy,
        string? startedByEmail,
        string? previousDataJson,
        int depth,
        Guid? originInstanceId,
        CancellationToken ct = default)
    {
        var tenantId = definition.TenantId;

        var parsed = StudioWorkflowStepsSpec.Parse(definition.StepsJson);
        if (!parsed.IsSuccess)
        {
            // L'instance est quand même créée puis mise en échec : la tentative reste traçable.
            var invalid = StudioWorkflowInstance.Start(tenantId, definition, recordId, trigger, startedBy, "{}", depth, originInstanceId);
            invalid.Fail(InvalidDefinitionMessage);
            await _workflows.AddInstanceAsync(invalid, ct);
            var failedAt = Now();
            await _workflows.AddStepRunAsync(StudioWorkflowStepRun.Record(
                tenantId, invalid.Id, 0, "definition", "definition",
                StudioWorkflowStepRunStatus.Failed, StudioWorkflowStepOutcome.Fail,
                null, null, InvalidDefinitionMessage, failedAt, failedAt, startedBy), ct);
            await AuditAsync(InstanceFailedAction, invalid, new { definition.Id, definition.Version }, ct);
            return invalid;
        }

        var spec = parsed.Value;
        var entity = await _entities.GetByIdAsync(tenantId, definition.EntityDefinitionId, ct)
            ?? throw new InvalidOperationException($"Table {definition.EntityDefinitionId} introuvable.");
        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, ct);

        var context = StudioWorkflowContext.Create(recordId, entity.Key, startedBy, startedByEmail, ParsePrevious(previousDataJson));
        var initialJson = context.Serialize();
        if (!initialJson.IsSuccess)
        {
            var failed = StudioWorkflowInstance.Start(tenantId, definition, recordId, trigger, startedBy, "{}", depth, originInstanceId);
            failed.Fail(initialJson.Error.Description);
            await _workflows.AddInstanceAsync(failed, ct);
            await AuditAsync(InstanceFailedAction, failed, new { definition.Id, definition.Version }, ct);
            return failed;
        }

        var instance = StudioWorkflowInstance.Start(
            tenantId, definition, recordId, trigger, startedBy, initialJson.Value, depth, originInstanceId);
        await _workflows.AddInstanceAsync(instance, ct);
        await AuditAsync(
            InstanceStartedAction, instance,
            new { definition.Id, definition.Version, trigger, depth }, ct);

        await RunSegmentAsync(instance, definition, spec, entity, fields, isResume: false, ct);
        return instance;
    }

    /// <inheritdoc />
    public async Task ResumeAsync(StudioWorkflowInstance instance, CancellationToken ct = default)
    {
        if (instance.IsTerminal)
            return;

        var tenantId = instance.TenantId;
        var definition = await _workflows.GetDefinitionAsync(tenantId, instance.WorkflowDefinitionId, ct);
        if (definition is null || !definition.IsActive)
        {
            instance.Cancel(WorkflowDisabledMessage);
            await _workflows.UpdateInstanceAsync(instance, ct);
            await AuditAsync(InstanceCancelledAction, instance, new { instance.WorkflowDefinitionId, Reason = WorkflowDisabledMessage }, ct);
            return;
        }

        var parsed = StudioWorkflowStepsSpec.Parse(definition.StepsJson);
        if (!parsed.IsSuccess)
        {
            instance.Fail(InvalidDefinitionMessage);
            await _workflows.UpdateInstanceAsync(instance, ct);
            await AuditAsync(InstanceFailedAction, instance, new { definition.Id, definition.Version }, ct);
            return;
        }

        var entity = await _entities.GetByIdAsync(tenantId, definition.EntityDefinitionId, ct)
            ?? throw new InvalidOperationException($"Table {definition.EntityDefinitionId} introuvable.");
        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, ct);

        await RunSegmentAsync(instance, definition, parsed.Value, entity, fields, isResume: true, ct);
    }

    /// <inheritdoc />
    public async Task CancelAsync(StudioWorkflowInstance instance, string reason, Guid? cancelledBy, CancellationToken ct = default)
    {
        if (instance.IsTerminal)
            return;

        instance.Cancel(reason);
        await _workflows.UpdateInstanceAsync(instance, ct);

        var pendingApprovals = await _workflows.ListPendingApprovalsForInstanceAsync(instance.TenantId, instance.Id, ct);
        var now = Now();
        foreach (var approval in pendingApprovals)
        {
            approval.Cancel(now);
            await _workflows.UpdateApprovalAsync(approval, ct);
        }

        await AuditAsync(InstanceCancelledAction, instance, new { instance.WorkflowDefinitionId, Reason = reason, cancelledBy }, ct);
    }

    /// <summary>
    /// Exécute un segment d'étapes à partir du pointeur courant de l'instance. Checkpoint SQL
    /// après chaque étape ; segment borné par <see cref="MaxStepsPerSegment"/> et par l'horloge.
    /// </summary>
    private async Task RunSegmentAsync(
        StudioWorkflowInstance instance,
        StudioWorkflowDefinition definition,
        ParsedWorkflowSpec spec,
        CustomEntityDefinition entity,
        IReadOnlyList<CustomFieldDefinition> fields,
        bool isResume,
        CancellationToken ct)
    {
        var tenantId = instance.TenantId;
        var deadline = Now().AddSeconds(Math.Clamp(_settings.StudioWorkflowMaxSegmentSeconds, 1, 30));
        var context = StudioWorkflowContext.Parse(instance.ContextJson);
        var index = instance.CurrentStepIndex;
        var executed = 0;
        var contextJson = instance.ContextJson;

        while (index < spec.Steps.Count && executed < MaxStepsPerSegment && Now() < deadline)
        {
            var step = spec.Steps[index];

            // Relecture à chaque étape : l'enregistrement a pu être supprimé depuis l'étape précédente.
            var record = await _records.GetAsync(tenantId, entity.Id, instance.RecordId, ct);
            if (record is null)
            {
                instance.Cancel(RecordDeletedMessage);
                await _workflows.UpdateInstanceAsync(instance, ct);
                await AuditAsync(InstanceCancelledAction, instance, new { definition.Id, Reason = RecordDeletedMessage }, ct);
                return;
            }

            if (!_handlers.TryGetValue(step.Type, out var handler))
            {
                await FailStepAsync(instance, definition, entity, step, UnsupportedStepTypeMessage, ct);
                return;
            }

            var stepStartedAt = Now();
            StepOutcome outcome;
            using (StudioWorkflowExecutionScope.Enter(instance.Id, instance.Depth + 1))
            {
                try
                {
                    var recordData = JsonNode.Parse(record.DataJson) as JsonObject ?? new JsonObject();
                    var stepContext = new StepExecutionContext(
                        tenantId, definition, instance, entity, fields, record, recordData,
                        context, step, index, isResume, stepStartedAt);
                    outcome = await handler.ExecuteAsync(stepContext, ct);
                }
                catch (Exception ex)
                {
                    // Jamais de données dans les journaux : ids et clé d'étape uniquement.
                    _logger.LogWarning(ex, "Workflow step failed {InstanceId} {StepKey}", instance.Id, step.Key);
                    outcome = new StepOutcome.Fail(ex.Message);
                }
            }

            isResume = false;

            // Sérialisation bornée (64 Ko) avant toute application d'issue : le checkpoint l'exige.
            var serialized = context.Serialize();

            // Journal append-only : une ligne par étape exécutée, résultat tronqué à 8 Ko.
            await _workflows.AddStepRunAsync(StudioWorkflowStepRun.Record(
                tenantId,
                instance.Id,
                index,
                step.Key,
                step.Type,
                StepRunStatusOf(outcome),
                outcome.Kind,
                inputJson: null,
                resultJson: Truncate(ResultJsonOf(outcome), MaxStepRunResultBytes),
                error: (outcome as StepOutcome.Fail)?.Error,
                startedAt: stepStartedAt,
                finishedAt: Now(),
                runBy: instance.StartedBy), ct);

            if (!serialized.IsSuccess)
            {
                await FailStepAsync(instance, definition, entity, step, serialized.Error.Description, ct);
                return;
            }

            contextJson = serialized.Value;
            executed++;

            switch (outcome)
            {
                case StepOutcome.Continue:
                case StepOutcome.Skip:
                    index++;
                    instance.Advance(index, index < spec.Steps.Count ? spec.Steps[index].Key : null, contextJson);
                    break;

                case StepOutcome.Goto gotoOutcome:
                    if (!spec.IndexByKey.TryGetValue(gotoOutcome.TargetKey, out var targetIndex) || targetIndex <= index)
                    {
                        await FailStepAsync(instance, definition, entity, step, BackwardGotoMessage, ct);
                        return;
                    }
                    index = targetIndex;
                    instance.Advance(index, spec.Steps[index].Key, contextJson);
                    break;

                case StepOutcome.Stop:
                    instance.Complete(contextJson);
                    await _workflows.UpdateInstanceAsync(instance, ct);
                    return;

                case StepOutcome.Suspend suspend:
                    instance.Suspend(suspend.Status, suspend.DueAt, contextJson);
                    await _workflows.UpdateInstanceAsync(instance, ct);
                    return;

                case StepOutcome.Fail fail when !fail.ContinueAnyway:
                    await FailStepAsync(instance, definition, entity, step, fail.Error, ct);
                    return;

                case StepOutcome.Fail:
                    index++;
                    instance.Advance(index, index < spec.Steps.Count ? spec.Steps[index].Key : null, contextJson);
                    break;
            }

            // Checkpoint : l'instance est persistée après CHAQUE étape (reprise sans perte).
            await _workflows.UpdateInstanceAsync(instance, ct);
        }

        if (index >= spec.Steps.Count && executed < MaxStepsPerSegment && Now() < deadline)
        {
            instance.Complete(contextJson);
        }
        else
        {
            // Segment épuisé (30 étapes ou horloge) alors que non terminal : reprise par le job différé.
            instance.Suspend(StudioWorkflowInstanceStatus.Waiting, Now(), contextJson);
        }

        await _workflows.UpdateInstanceAsync(instance, ct);
    }

    /// <summary>Échec d'étape : instance en échec + checkpoint, notification best-effort au lanceur, audit.</summary>
    private async Task FailStepAsync(
        StudioWorkflowInstance instance,
        StudioWorkflowDefinition definition,
        CustomEntityDefinition entity,
        WorkflowStepSpec step,
        string? error,
        CancellationToken ct)
    {
        instance.Fail(error);
        await _workflows.UpdateInstanceAsync(instance, ct);
        await NotifyFailureAsync(definition, entity, instance, error, ct);
        await AuditAsync(InstanceFailedAction, instance, new { definition.Id, StepKey = step.Key }, ct);
    }

    /// <summary>Notification d'échec best-effort (tronquée à 1000 caractères) ; ne fait jamais échouer le moteur.</summary>
    private async Task NotifyFailureAsync(
        StudioWorkflowDefinition definition,
        CustomEntityDefinition entity,
        StudioWorkflowInstance instance,
        string? error,
        CancellationToken ct)
    {
        if (instance.StartedBy is not { } recipient)
            return;

        try
        {
            await _notifications.CreateAsync(
                instance.TenantId,
                null,
                NotificationType.StudioWorkflowStepFailed,
                $"Workflow « {definition.Name} » en échec",
                Truncate(error, MaxNotificationBodyLength) ?? string.Empty,
                $"/studio/d/{entity.Key}/{instance.RecordId}/edit",
                recipient,
                ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Workflow failure notification failed {InstanceId}", instance.Id);
        }
    }

    private Task AuditAsync(string action, StudioWorkflowInstance instance, object? newValues, CancellationToken ct)
        => StudioAudit.SafeLogAsync(_audit, action, "StudioWorkflowInstance", instance.Id, null, newValues, ct);

    private DateTime Now() => _timeProvider.GetUtcNow().UtcDateTime;

    private static StudioWorkflowStepRunStatus StepRunStatusOf(StepOutcome outcome) => outcome switch
    {
        StepOutcome.Skip => StudioWorkflowStepRunStatus.Skipped,
        StepOutcome.Suspend => StudioWorkflowStepRunStatus.Suspended,
        StepOutcome.Fail => StudioWorkflowStepRunStatus.Failed,
        _ => StudioWorkflowStepRunStatus.Succeeded
    };

    private static string? ResultJsonOf(StepOutcome outcome)
    {
        var result = outcome switch
        {
            StepOutcome.Continue continueOutcome => continueOutcome.Result,
            StepOutcome.Goto gotoOutcome => gotoOutcome.Result,
            StepOutcome.Suspend suspendOutcome => suspendOutcome.Result,
            _ => null
        };
        return result?.ToJsonString();
    }

    private static JsonObject? ParsePrevious(string? previousDataJson)
    {
        if (string.IsNullOrWhiteSpace(previousDataJson))
            return null;
        try
        {
            return JsonNode.Parse(previousDataJson) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Truncate(string? value, int maxLength)
        => value is not null && value.Length > maxLength ? value[..maxLength] : value;
}
