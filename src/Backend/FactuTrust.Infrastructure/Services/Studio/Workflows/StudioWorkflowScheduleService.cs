using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Hangfire;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows;

/// <summary>
/// Implémentation Hangfire de <see cref="IStudioWorkflowScheduleService"/> (4.7b2 / D-47-B03) :
/// <c>AddOrUpdate</c> idempotent quand la définition est active et planifiée (cron relu de
/// <c>TriggerConfigJson</c>, UTC) ; <c>RemoveIfExists</c> sinon. Un cron illisible ou toute erreur
/// de l'ordonnanceur est journalisé et absorbé : l'écriture métier n'est jamais cassée.
/// </summary>
public sealed class StudioWorkflowScheduleService : IStudioWorkflowScheduleService
{
    private readonly IRecurringJobManager _recurring;
    private readonly ILogger<StudioWorkflowScheduleService> _logger;

    public StudioWorkflowScheduleService(IRecurringJobManager recurring, ILogger<StudioWorkflowScheduleService> logger)
    {
        _recurring = recurring;
        _logger = logger;
    }

    /// <summary>Identifiant du job récurrent d'une définition (contrat documenté de l'interface).</summary>
    public static string JobId(Guid tenantId, Guid definitionId)
        => $"studio-workflow-scheduled:{tenantId:N}:{definitionId:N}";

    public Task SyncDefinitionAsync(StudioWorkflowDefinition definition, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(definition);
        var jobId = JobId(definition.TenantId, definition.Id);
        try
        {
            if (definition.IsActive && !definition.IsDeleted && definition.Trigger == StudioWorkflowTriggerKind.Scheduled
                && TryReadCron(definition.TriggerConfigJson, out var cron))
            {
                _recurring.AddOrUpdate<StudioWorkflowScheduledJob>(
                    jobId,
                    job => job.FireAsync(definition.TenantId, definition.Id, CancellationToken.None),
                    cron,
                    new RecurringJobOptions { TimeZone = TimeZoneInfo.Utc });
            }
            else
            {
                if (definition.IsActive && !definition.IsDeleted && definition.Trigger == StudioWorkflowTriggerKind.Scheduled)
                {
                    _logger.LogWarning(
                        "Studio workflow {WorkflowId} : cron illisible dans TriggerConfigJson — job planifié retiré (défense en profondeur : la validation 4.7b1 rejette ce cas à l'écriture).",
                        definition.Id);
                }
                _recurring.RemoveIfExists(jobId);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex,
                "Studio workflow {WorkflowId} : synchronisation du job planifié impossible (best-effort — l'écriture métier est conservée ; le job obsolète s'auto-retirera à son prochain tick).",
                definition.Id);
        }
        return Task.CompletedTask;
    }

    public Task RemoveDefinitionAsync(Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default)
    {
        try
        {
            _recurring.RemoveIfExists(JobId(tenantId, definitionId));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex,
                "Studio workflow {WorkflowId} : retrait du job planifié impossible (best-effort — le job s'auto-retirera à son prochain tick).",
                definitionId);
        }
        return Task.CompletedTask;
    }

    /// <summary>Relit <c>triggerConfig.cron</c> et le revalide (<see cref="StudioWorkflowCronSpec"/>).</summary>
    internal static bool TryReadCron(string? triggerConfigJson, out string cron)
    {
        cron = string.Empty;
        if (!StudioWorkflowJson.TryParseObject(triggerConfigJson, out var config))
            return false;
        if (config["cron"] is not JsonValue value || !value.TryGetValue<string>(out var raw))
            return false;
        return StudioWorkflowCronSpec.TryParse(raw, out cron);
    }
}
