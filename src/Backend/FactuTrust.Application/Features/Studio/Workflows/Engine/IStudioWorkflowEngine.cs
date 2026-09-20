using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>Moteur d'exécution des workflows Studio (implémentation : tranche 4.1f2).</summary>
public interface IStudioWorkflowEngine
{
    /// <summary>Démarre une instance et exécute un premier segment d'étapes synchrones.</summary>
    Task<StudioWorkflowInstance> StartAsync(
        StudioWorkflowDefinition definition,
        Guid recordId,
        StudioWorkflowTriggerKind trigger,
        Guid? startedBy,
        string? startedByEmail,
        string? previousDataJson,
        int depth,
        Guid? originInstanceId,
        CancellationToken ct = default);

    /// <summary>Reprend une instance suspendue (<c>Waiting</c> / <c>WaitingApproval</c>) arrivée à échéance.</summary>
    Task ResumeAsync(StudioWorkflowInstance instance, CancellationToken ct = default);

    /// <summary>Annule une instance non terminale (idempotent) ainsi que ses approbations en attente.</summary>
    Task CancelAsync(StudioWorkflowInstance instance, string reason, Guid? cancelledBy, CancellationToken ct = default);
}
