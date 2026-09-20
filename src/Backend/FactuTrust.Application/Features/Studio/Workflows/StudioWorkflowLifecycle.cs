using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>
/// Publie les notifications de cycle de vie destinées aux workflows Studio (patron
/// <c>StudioRecordLifecycle</c>, P15 : un échec est journalisé en <c>LogWarning</c> — jamais
/// silencieux). La publication est enveloppée pour qu'un handler de workflow défaillant ne
/// puisse JAMAIS affecter le résultat de la création/modification de l'enregistrement (déjà
/// persisté à ce stade). L'origine et la profondeur proviennent du marqueur ambiant
/// <see cref="StudioWorkflowExecutionScope"/> (anti-boucle).
/// </summary>
public static class StudioWorkflowLifecycle
{
    public static async Task PublishAsync(
        IPublisher publisher,
        Guid tenantId,
        Guid entityDefinitionId,
        Guid recordId,
        string dataJson,
        string? previousDataJson,
        StudioAutomationTrigger trigger,
        Guid? runBy,
        ILogger? logger,
        CancellationToken cancellationToken)
    {
        var marker = StudioWorkflowExecutionScope.Current;
        try
        {
            await publisher.Publish(
                new CustomRecordWorkflowNotification(
                    tenantId, entityDefinitionId, recordId, dataJson, previousDataJson, trigger, runBy,
                    marker?.OriginInstanceId, marker?.Depth ?? 0),
                cancellationToken);
        }
        catch (Exception ex)
        {
            // Best-effort MAIS jamais silencieux (P15) : ids uniquement, jamais de données.
            logger?.LogWarning(ex, "Workflow trigger publication failed for record {RecordId}", recordId);
        }
    }
}
