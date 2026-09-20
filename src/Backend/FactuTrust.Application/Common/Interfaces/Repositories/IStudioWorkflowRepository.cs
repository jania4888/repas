using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>Ligne du catalogue tenant (4.5c1) : définition + identité de sa table (jointure SQL, tables actives non-jonction).</summary>
public sealed record StudioWorkflowCatalogRow(StudioWorkflowDefinition Definition, string EntityKey, string EntityDisplayName);

/// <summary>
/// Accès aux définitions, instances, exécutions d'étapes et approbations des workflows Studio
/// (PR 4.1). Toutes les méthodes filtrent sur <c>TenantId</c> ; le filtre global
/// <c>IsDeleted</c> du contexte s'applique aux définitions (aucune définition supprimée
/// n'est exposée en 4.1 — la corbeille arrive en 4.2).
/// </summary>
public interface IStudioWorkflowRepository
{
    /// <summary>Définitions non supprimées d'une table (actives, et inactives si <paramref name="includeInactive"/>), triées par nom.</summary>
    Task<IReadOnlyList<StudioWorkflowDefinition>> ListByEntityAsync(
        Guid tenantId, Guid entityDefinitionId, bool includeInactive = true, CancellationToken cancellationToken = default);

    /// <summary>Définitions actives non supprimées d'une table pour un déclencheur donné, triées par nom.</summary>
    Task<IReadOnlyList<StudioWorkflowDefinition>> ListActiveByTriggerAsync(
        Guid tenantId, Guid entityDefinitionId, StudioWorkflowTriggerKind trigger, CancellationToken cancellationToken = default);

    Task<StudioWorkflowDefinition?> GetDefinitionAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Définition non supprimée par sa clé (comparaison collation SQL, insensible à la casse par défaut).</summary>
    Task<StudioWorkflowDefinition?> GetDefinitionByKeyAsync(
        Guid tenantId, Guid entityDefinitionId, string key, CancellationToken cancellationToken = default);

    /// <summary>Nombre de définitions non supprimées de la table (quota plan).</summary>
    Task<int> CountByEntityAsync(Guid tenantId, Guid entityDefinitionId, CancellationToken cancellationToken = default);

    Task AddDefinitionAsync(StudioWorkflowDefinition definition, CancellationToken cancellationToken = default);

    /// <summary>
    /// Met à jour une définition avec contrôle de concurrence optimiste : si
    /// <paramref name="expectedRowVersion"/> est fourni, il devient la valeur d'origine du jeton
    /// et EF lève <c>DbUpdateConcurrencyException</c> si la ligne a changé depuis sa lecture
    /// (patron <c>CustomRecordRepository.UpdateWithConcurrencyAsync</c>).
    /// </summary>
    Task UpdateDefinitionWithConcurrencyAsync(
        StudioWorkflowDefinition definition, byte[]? expectedRowVersion, CancellationToken cancellationToken = default);

    Task<StudioWorkflowInstance?> GetInstanceAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Instances d'un enregistrement, les plus récentes d'abord ; <paramref name="max"/> borné à [1, 200].</summary>
    Task<IReadOnlyList<StudioWorkflowInstance>> ListInstancesForRecordAsync(
        Guid tenantId, Guid recordId, int max, CancellationToken cancellationToken = default);

    /// <summary>Page d'instances d'une définition, les plus récentes d'abord ; <paramref name="take"/> borné à [1, 200] (4.7a1 / D-47-B01).</summary>
    Task<IReadOnlyList<StudioWorkflowInstance>> ListInstancesForDefinitionAsync(
        Guid tenantId, Guid definitionId, int skip, int take, CancellationToken cancellationToken = default);

    /// <summary>Nombre total d'instances d'une définition (pagination du panneau « Historique », 4.7a1).</summary>
    Task<int> CountInstancesForDefinitionAsync(Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default);

    /// <summary>Instances ouvertes (Running, Waiting, WaitingApproval) d'une définition, les plus récentes d'abord.</summary>
    Task<IReadOnlyList<StudioWorkflowInstance>> ListOpenInstancesForDefinitionAsync(
        Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default);

    /// <summary>Nombre d'instances d'un enregistrement ; ouvertes seulement si <paramref name="openOnly"/> (quota anti-boucle).</summary>
    Task<int> CountInstancesForRecordAsync(Guid tenantId, Guid recordId, bool openOnly, CancellationToken cancellationToken = default);

    /// <summary>
    /// True si une instance ouverte de la même définition existe pour l'enregistrement dans la
    /// chaîne d'origine (<paramref name="originInstanceId"/> null ⇒ n'importe quelle origine ;
    /// sinon l'origine directe ou l'instance elle-même). Verrou anti-doublon au démarrage.
    /// </summary>
    Task<bool> HasOpenInstanceInChainAsync(
        Guid tenantId, Guid definitionId, Guid recordId, Guid? originInstanceId, CancellationToken cancellationToken = default);

    Task AddInstanceAsync(StudioWorkflowInstance instance, CancellationToken cancellationToken = default);

    /// <summary>Met à jour une instance ; <c>DbUpdateConcurrencyException</c> remonte telle quelle (jeton RowVersion).</summary>
    Task UpdateInstanceAsync(StudioWorkflowInstance instance, CancellationToken cancellationToken = default);

    /// <summary>Ajoute une exécution d'étape (journal append-only).</summary>
    Task AddStepRunAsync(StudioWorkflowStepRun stepRun, CancellationToken cancellationToken = default);

    /// <summary>Exécutions d'étapes d'une instance, triées par <c>StepIndex</c> puis <c>StartedAt</c>.</summary>
    Task<IReadOnlyList<StudioWorkflowStepRun>> ListStepRunsAsync(Guid tenantId, Guid instanceId, CancellationToken cancellationToken = default);

    Task AddApprovalAsync(StudioWorkflowApproval approval, CancellationToken cancellationToken = default);

    Task<StudioWorkflowApproval?> GetApprovalAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Approbations en attente d'une instance, les plus anciennes d'abord.</summary>
    Task<IReadOnlyList<StudioWorkflowApproval>> ListPendingApprovalsForInstanceAsync(
        Guid tenantId, Guid instanceId, CancellationToken cancellationToken = default);

    /// <summary>Toutes les approbations d'une instance, quel que soit leur statut, les plus anciennes d'abord (4.1j2, D-41-07).</summary>
    Task<IReadOnlyList<StudioWorkflowApproval>> ListApprovalsForInstanceAsync(
        Guid tenantId, Guid instanceId, CancellationToken cancellationToken = default);

    Task UpdateApprovalAsync(StudioWorkflowApproval approval, CancellationToken cancellationToken = default);

    /// <summary>Nombre d'instances ouvertes d'une définition (D9 : alimente <c>WorkflowDefinitionDto.OpenInstances</c>).</summary>
    Task<int> CountOpenInstancesForDefinitionAsync(Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default);

    // ---- Catalogue tenant (4.5c1, D-44-20) ----

    /// <summary>
    /// Page du catalogue tenant : définitions (actives et inactives, non supprimées) des tables <b>actives non-jonction</b>,
    /// filtrées par <paramref name="search"/> (nom ou clé, insensible à la casse), triées <c>EntityDisplayName, Name, Key</c>.
    /// <paramref name="skip"/> ≥ 0, <paramref name="take"/> ∈ 1..200 (bornés par l'appelant).
    /// </summary>
    Task<IReadOnlyList<StudioWorkflowCatalogRow>> ListByTenantAsync(
        Guid tenantId, string? search, int skip, int take, CancellationToken cancellationToken = default);

    /// <summary>Total correspondant à <see cref="ListByTenantAsync"/> (mêmes filtres), pour <c>PagedResult.TotalCount</c>.</summary>
    Task<int> CountByTenantAsync(Guid tenantId, string? search, CancellationToken cancellationToken = default);

    /// <summary>Instances ouvertes (Running / Waiting / WaitingApproval) par définition, en une requête ; définitions sans instance absentes du résultat.</summary>
    Task<IReadOnlyDictionary<Guid, int>> CountOpenInstancesForDefinitionsAsync(
        Guid tenantId, IReadOnlyCollection<Guid> definitionIds, CancellationToken cancellationToken = default);

    // ---- Runtime (4.2) ----

    /// <summary>
    /// Instances échues à reprendre : <c>Waiting</c> dont <c>DueAt</c> est atteint, ou
    /// <c>WaitingApproval</c> dont <c>DueAt</c> est atteint sans approbation encore en attente (D-04,
    /// même règle que <c>ApprovalStepHandler</c>). Le bail n'est pas filtré ici : c'est
    /// <see cref="TryLeaseInstanceAsync"/> qui tranche. Tri <c>DueAt</c> croissant, borné à
    /// <c>Math.Clamp(max, 1, 500)</c>.
    /// </summary>
    Task<IReadOnlyList<StudioWorkflowInstance>> ListDueAsync(
        Guid tenantId, DateTime nowUtc, int max, CancellationToken cancellationToken = default);

    /// <summary>
    /// Instances ouvertes dont le bail (<c>LeasedAt</c>) est antérieur à <paramref name="leasedBeforeUtc"/>
    /// (reaper du job différé). Tri <c>LeasedAt</c> croissant, borné à <c>Math.Clamp(max, 1, 500)</c>.
    /// </summary>
    Task<IReadOnlyList<StudioWorkflowInstance>> ListStaleLeasesAsync(
        Guid tenantId, DateTime leasedBeforeUtc, int max, CancellationToken cancellationToken = default);

    /// <summary>
    /// Approbations <c>Pending</c> dont <c>DueAt</c> est atteint (expiration). Tri <c>DueAt</c> croissant,
    /// borné à <c>Math.Clamp(max, 1, 500)</c>.
    /// </summary>
    Task<IReadOnlyList<StudioWorkflowApproval>> ListExpiredApprovalsAsync(
        Guid tenantId, DateTime nowUtc, int max, CancellationToken cancellationToken = default);

    /// <summary>
    /// Approbations <c>Pending</c> assignées à l'utilisateur, directement (<c>AssigneeUserId</c>) ou via
    /// son rôle (<c>AssigneeRole</c>). Tri <c>DueAt</c> puis <c>CreatedAt</c> croissants, borné à
    /// <c>Math.Clamp(max, 1, 200)</c>.
    /// </summary>
    Task<IReadOnlyList<StudioWorkflowApproval>> ListPendingApprovalsForUserAsync(
        Guid tenantId, Guid userId, string? role, int max, CancellationToken cancellationToken = default);

    /// <summary>Même prédicat que <see cref="ListPendingApprovalsForUserAsync"/>, en nombre.</summary>
    Task<int> CountPendingApprovalsForUserAsync(
        Guid tenantId, Guid userId, string? role, CancellationToken cancellationToken = default);

    /// <summary>
    /// Décisions d'approbation <paramref name="userId"/> (4.7 « v1.1 », D‑47‑60) : statuts
    /// <c>Approved</c>/<c>Rejected</c> décidés par l'utilisateur (les annulées/expirées ne sont pas
    /// des décisions), tri <c>DecidedAt</c> puis <c>Id</c> décroissants, borné à
    /// <c>Math.Clamp(max, 1, 200)</c>. Miroir de <see cref="ListPendingApprovalsForUserAsync"/>.
    /// </summary>
    Task<IReadOnlyList<StudioWorkflowApproval>> ListDecidedApprovalsByUserAsync(
        Guid tenantId, Guid userId, int max, CancellationToken cancellationToken = default);

    /// <summary>
    /// Supprime les instances terminales (<c>Completed</c>/<c>Failed</c>/<c>Cancelled</c>) achevées avant
    /// <paramref name="completedBeforeUtc"/> avec leurs exécutions d'étapes et leurs approbations
    /// (pas de FK : enfants d'abord). Retourne le nombre d'instances supprimées, borné à
    /// <c>Math.Clamp(max, 1, 500)</c>. Les trois suppressions ne sont pas atomiques : la purge est
    /// exécutée par le job Hangfire sous <c>DisableConcurrentExecution</c> (4.2d) et les tables sont sans
    /// FK par conception (0.11 point 4) — une insertion concurrente d'enfants y laisserait des orphelins.
    /// </summary>
    Task<int> PurgeTerminalOlderThanAsync(
        Guid tenantId, DateTime completedBeforeUtc, int max, CancellationToken cancellationToken = default);

    /// <summary>
    /// Pose le bail de reprise (D-01) : <see cref="StudioWorkflowInstance.TryLease"/> puis enregistrement ;
    /// une course perdue sur le <c>RowVersion</c> (<c>DbUpdateConcurrencyException</c>) retourne
    /// <c>false</c> — l'appelant abandonne l'instance pour ce tick, il ne la recharge pas. Après un retour
    /// <c>false</c>, l'<paramref name="instance"/> peut être partiellement mutée (<c>LeasedAt</c>) : l'appelant
    /// la jette et la recharge depuis le dépôt s'il retente.
    /// </summary>
    Task<bool> TryLeaseInstanceAsync(
        StudioWorkflowInstance instance, DateTime nowUtc, TimeSpan leaseDuration, CancellationToken cancellationToken = default);
}
