using FactuTrust.Domain.Entities.Studio.Workflows;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Ordonnancement des déclencheurs planifiés des workflows Studio (4.7b2 / D-47-B03) : un job
/// récurrent Hangfire par définition <b>active</b> dont le déclencheur est <c>scheduled</c>,
/// synchronisé aux écritures (create / update / toggle / delete). Contrat d'identifiant :
/// <c>studio-workflow-scheduled:{tenantId:N}:{definitionId:N}</c> ; fuseau UTC.
/// Best-effort : une erreur de l'ordonnanceur ne casse jamais l'écriture métier, et le job se
/// retire lui-même s'il retrouve une définition supprimée / inactive / non planifiée
/// (auto-guérison, 4.7b3). Résiduel assumé : si le stockage Hangfire est vidé, les jobs ne
/// reviennent qu'à la prochaine écriture (réconciliation au démarrage : candidat v1.2).
/// </summary>
public interface IStudioWorkflowScheduleService
{
    /// <summary>
    /// Enregistre ou met à jour le job récurrent si la définition est active et planifiée
    /// (cron relu de <c>TriggerConfigJson</c>) ; sinon le retire. Idempotent.
    /// </summary>
    Task SyncDefinitionAsync(StudioWorkflowDefinition definition, CancellationToken cancellationToken = default);

    /// <summary>Retire le job récurrent de la définition (suppression). Idempotent.</summary>
    Task RemoveDefinitionAsync(Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default);
}
