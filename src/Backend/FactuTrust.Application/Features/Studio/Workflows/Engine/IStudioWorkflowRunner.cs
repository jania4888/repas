using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>Issue d'une reprise d'instance par <see cref="IStudioWorkflowRunner.ResumeUnderStarterAsync"/>.</summary>
public enum StudioWorkflowRunOutcome
{
    /// <summary>Le moteur a repris l'instance (sous l'identité du lanceur, ou sans impersonation si déclencheur système).</summary>
    Resumed = 0,

    /// <summary>Un bail encore frais est détenu par un autre worker : l'instance est abandonnée pour ce tick.</summary>
    LeaseBusy = 1,

    /// <summary>Le lanceur est introuvable, inactif ou refusé : l'instance a été mise en échec et notifiée.</summary>
    StarterUnavailable = 2,

    /// <summary>Instance déjà terminale : rien à faire.</summary>
    Skipped = 3
}

/// <summary>
/// Point d'entrée unique pour « reprendre » ou « lancer » une instance de workflow Studio sous la bonne
/// identité (plan 4.2c2) : pose le bail (<c>TryLeaseInstanceAsync</c>), ouvre
/// <c>ImpersonatedUserContext.Enter(snapshot)</c> autour du moteur, relâche le bail en <c>finally</c>.
/// Le moteur (<see cref="IStudioWorkflowEngine"/>) n'est pas modifié.
/// </summary>
public interface IStudioWorkflowRunner
{
    /// <summary>
    /// Reprend une instance échue sous l'identité de son lanceur. Sans lanceur (déclencheur système),
    /// le moteur tourne sans impersonation. Lanceur refusé ⇒ instance mise en échec + notification 17 +
    /// audit <c>Studio.Workflow.InstanceFailed</c>. Le bail est relâché dans tous les chemins.
    /// </summary>
    Task<StudioWorkflowRunOutcome> ResumeUnderStarterAsync(StudioWorkflowInstance instance, CancellationToken ct);

    /// <summary>
    /// Démarre une instance sous l'utilisateur HTTP/canal courant (segment initial dans la requête,
    /// comme <c>StudioWorkflowTriggerHandler</c> : pas de bail).
    /// </summary>
    Task<Result<StudioWorkflowInstance>> StartUnderCurrentUserAsync(
        StudioWorkflowDefinition definition, Guid recordId, StudioWorkflowTriggerKind trigger, CancellationToken ct);
}
