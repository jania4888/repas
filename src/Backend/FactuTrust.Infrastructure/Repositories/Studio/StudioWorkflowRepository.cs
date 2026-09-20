using System.Linq.Expressions;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories.Studio;

/// <summary>
/// Dépôt SQL des workflows Studio (PR 4.1c) — patron <see cref="CustomRecordViewRepository"/>
/// (contexte court par appel via <see cref="ITenantDbContextFactory.CreateContext"/>).
/// Chaque requête filtre sur <c>TenantId</c> ; les définitions supprimées sont masquées par le
/// filtre global <c>!IsDeleted</c> du contexte. Aucune exécution parallèle de requêtes
/// (garde-fou concurrence sur le contexte).
/// </summary>
public sealed class StudioWorkflowRepository : IStudioWorkflowRepository
{
    /// <summary>Statuts « ouverts » d'une instance : en cours ou en attente (job différé / approbation).</summary>
    private static readonly StudioWorkflowInstanceStatus[] OpenStatuses =
    {
        StudioWorkflowInstanceStatus.Running,
        StudioWorkflowInstanceStatus.Waiting,
        StudioWorkflowInstanceStatus.WaitingApproval
    };

    private readonly ITenantDbContextFactory _contextFactory;

    public StudioWorkflowRepository(ITenantDbContextFactory contextFactory) => _contextFactory = contextFactory;

    public async Task<IReadOnlyList<StudioWorkflowDefinition>> ListByEntityAsync(
        Guid tenantId, Guid entityDefinitionId, bool includeInactive = true, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowDefinitions
            .Where(d => d.TenantId == tenantId && d.EntityDefinitionId == entityDefinitionId && (includeInactive || d.IsActive))
            .OrderBy(d => d.Name)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowDefinition>> ListActiveByTriggerAsync(
        Guid tenantId, Guid entityDefinitionId, StudioWorkflowTriggerKind trigger, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowDefinitions
            .Where(d => d.TenantId == tenantId && d.EntityDefinitionId == entityDefinitionId && d.IsActive && d.Trigger == trigger)
            .OrderBy(d => d.Name)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<StudioWorkflowDefinition?> GetDefinitionAsync(
        Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowDefinitions
            .FirstOrDefaultAsync(d => d.TenantId == tenantId && d.Id == id, cancellationToken);
    }

    public async Task<StudioWorkflowDefinition?> GetDefinitionByKeyAsync(
        Guid tenantId, Guid entityDefinitionId, string key, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowDefinitions
            .FirstOrDefaultAsync(d => d.TenantId == tenantId && d.EntityDefinitionId == entityDefinitionId && d.Key == key, cancellationToken);
    }

    public async Task<int> CountByEntityAsync(Guid tenantId, Guid entityDefinitionId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowDefinitions
            .CountAsync(d => d.TenantId == tenantId && d.EntityDefinitionId == entityDefinitionId, cancellationToken);
    }

    public async Task AddDefinitionAsync(StudioWorkflowDefinition definition, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioWorkflowDefinitions.Add(definition);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdateDefinitionWithConcurrencyAsync(
        StudioWorkflowDefinition definition, byte[]? expectedRowVersion, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Attach(definition);
        context.Entry(definition).State = EntityState.Modified;
        if (expectedRowVersion is { Length: > 0 })
        {
            // Use the client's RowVersion as the concurrency token → EF throws DbUpdateConcurrencyException
            // if the row changed since the client loaded it (mapped to HTTP 409 by the middleware).
            context.Entry(definition).Property(d => d.RowVersion).OriginalValue = expectedRowVersion;
        }
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<StudioWorkflowInstance?> GetInstanceAsync(
        Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .FirstOrDefaultAsync(i => i.TenantId == tenantId && i.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowInstance>> ListInstancesForRecordAsync(
        Guid tenantId, Guid recordId, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId && i.RecordId == recordId)
            .OrderByDescending(i => i.StartedAt)
            .Take(Math.Clamp(max, 1, 200))
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowInstance>> ListInstancesForDefinitionAsync(
        Guid tenantId, Guid definitionId, int skip, int take, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId && i.WorkflowDefinitionId == definitionId)
            .OrderByDescending(i => i.StartedAt)
            .Skip(skip)
            .Take(Math.Clamp(take, 1, 200))
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountInstancesForDefinitionAsync(
        Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .CountAsync(i => i.TenantId == tenantId && i.WorkflowDefinitionId == definitionId, cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowInstance>> ListOpenInstancesForDefinitionAsync(
        Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId && i.WorkflowDefinitionId == definitionId && OpenStatuses.Contains(i.Status))
            .OrderByDescending(i => i.StartedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountInstancesForRecordAsync(
        Guid tenantId, Guid recordId, bool openOnly, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .CountAsync(i => i.TenantId == tenantId && i.RecordId == recordId && (!openOnly || OpenStatuses.Contains(i.Status)), cancellationToken);
    }

    public async Task<bool> HasOpenInstanceInChainAsync(
        Guid tenantId, Guid definitionId, Guid recordId, Guid? originInstanceId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .AnyAsync(i => i.TenantId == tenantId && i.WorkflowDefinitionId == definitionId && i.RecordId == recordId
                && OpenStatuses.Contains(i.Status)
                && (originInstanceId == null || i.OriginInstanceId == originInstanceId || i.Id == originInstanceId), cancellationToken);
    }

    public async Task AddInstanceAsync(StudioWorkflowInstance instance, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioWorkflowInstances.Add(instance);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdateInstanceAsync(StudioWorkflowInstance instance, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioWorkflowInstances.Update(instance);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task AddStepRunAsync(StudioWorkflowStepRun stepRun, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioWorkflowStepRuns.Add(stepRun);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowStepRun>> ListStepRunsAsync(
        Guid tenantId, Guid instanceId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowStepRuns
            .Where(r => r.TenantId == tenantId && r.InstanceId == instanceId)
            .OrderBy(r => r.StepIndex)
            .ThenBy(r => r.StartedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task AddApprovalAsync(StudioWorkflowApproval approval, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioWorkflowApprovals.Add(approval);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<StudioWorkflowApproval?> GetApprovalAsync(
        Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowApprovals
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowApproval>> ListPendingApprovalsForInstanceAsync(
        Guid tenantId, Guid instanceId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowApprovals
            .Where(a => a.TenantId == tenantId && a.InstanceId == instanceId && a.Status == StudioWorkflowApprovalStatus.Pending)
            .OrderBy(a => a.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowApproval>> ListApprovalsForInstanceAsync(
        Guid tenantId, Guid instanceId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowApprovals
            .Where(a => a.TenantId == tenantId && a.InstanceId == instanceId)
            .OrderBy(a => a.CreatedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task UpdateApprovalAsync(StudioWorkflowApproval approval, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioWorkflowApprovals.Update(approval);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<int> CountOpenInstancesForDefinitionAsync(
        Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .CountAsync(i => i.TenantId == tenantId && i.WorkflowDefinitionId == definitionId && OpenStatuses.Contains(i.Status), cancellationToken);
    }

    // ---- Catalogue tenant (4.5c1) ----

    public async Task<IReadOnlyList<StudioWorkflowCatalogRow>> ListByTenantAsync(
        Guid tenantId, string? search, int skip, int take, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await CatalogQuery(context, tenantId, search)
            .Skip(skip).Take(take)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountByTenantAsync(Guid tenantId, string? search, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await CatalogQuery(context, tenantId, search).CountAsync(cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, int>> CountOpenInstancesForDefinitionsAsync(
        Guid tenantId, IReadOnlyCollection<Guid> definitionIds, CancellationToken cancellationToken = default)
    {
        if (definitionIds.Count == 0)
            return new Dictionary<Guid, int>();

        await using var context = _contextFactory.CreateContext();
        var ids = definitionIds.Distinct().ToList();
        return await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId && ids.Contains(i.WorkflowDefinitionId) && OpenStatuses.Contains(i.Status))
            .GroupBy(i => i.WorkflowDefinitionId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);
    }

    /// <summary>
    /// Jointure explicite définitions ↔ tables (aucune navigation EF entre les deux) ; filtres globaux <c>!IsDeleted</c>
    /// appliqués aux deux côtés ; filtre et tri exprimés sur les colonnes AVANT la projection (pas de relecture du record).
    /// </summary>
    private static IQueryable<StudioWorkflowCatalogRow> CatalogQuery(TenantDbContext context, Guid tenantId, string? search)
    {
        var term = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        return
            from d in context.StudioWorkflowDefinitions
            join e in context.CustomEntityDefinitions on d.EntityDefinitionId equals e.Id
            where d.TenantId == tenantId && e.TenantId == tenantId && e.IsActive && e.Kind != CustomEntityKind.Junction
                && (term == null || d.Name.Contains(term) || d.Key.Contains(term))
            orderby e.DisplayName, d.Name, d.Key
            select new StudioWorkflowCatalogRow(d, e.Key, e.DisplayName);
    }

    // ---- Runtime (4.2) ----

    public async Task<IReadOnlyList<StudioWorkflowInstance>> ListDueAsync(
        Guid tenantId, DateTime nowUtc, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId
                && i.DueAt <= nowUtc
                && (i.Status == StudioWorkflowInstanceStatus.Waiting
                    || (i.Status == StudioWorkflowInstanceStatus.WaitingApproval
                        && !context.StudioWorkflowApprovals.Any(a =>
                            a.TenantId == tenantId && a.InstanceId == i.Id
                            && a.Status == StudioWorkflowApprovalStatus.Pending))))
            .OrderBy(i => i.DueAt)
            .Take(Math.Clamp(max, 1, 500))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowInstance>> ListStaleLeasesAsync(
        Guid tenantId, DateTime leasedBeforeUtc, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId
                && i.LeasedAt != null && i.LeasedAt < leasedBeforeUtc
                && OpenStatuses.Contains(i.Status))
            .OrderBy(i => i.LeasedAt)
            .Take(Math.Clamp(max, 1, 500))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowApproval>> ListExpiredApprovalsAsync(
        Guid tenantId, DateTime nowUtc, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowApprovals
            .Where(a => a.TenantId == tenantId && a.Status == StudioWorkflowApprovalStatus.Pending && a.DueAt <= nowUtc)
            .OrderBy(a => a.DueAt)
            .Take(Math.Clamp(max, 1, 500))
            .ToListAsync(cancellationToken);
    }

    /// <summary>Prédicat partagé liste/compteur : en attente, assignée à l'utilisateur directement ou via son rôle.</summary>
    private static Expression<Func<StudioWorkflowApproval, bool>> PendingForUser(Guid tenantId, Guid userId, string? role)
        => a => a.TenantId == tenantId && a.Status == StudioWorkflowApprovalStatus.Pending
            && (a.AssigneeUserId == userId || (role != null && a.AssigneeRole == role));

    public async Task<IReadOnlyList<StudioWorkflowApproval>> ListPendingApprovalsForUserAsync(
        Guid tenantId, Guid userId, string? role, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowApprovals
            .Where(PendingForUser(tenantId, userId, role))
            .OrderBy(a => a.DueAt)
            .ThenBy(a => a.CreatedAt)
            .Take(Math.Clamp(max, 1, 200))
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountPendingApprovalsForUserAsync(
        Guid tenantId, Guid userId, string? role, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowApprovals.CountAsync(PendingForUser(tenantId, userId, role), cancellationToken);
    }

    public async Task<IReadOnlyList<StudioWorkflowApproval>> ListDecidedApprovalsByUserAsync(
        Guid tenantId, Guid userId, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioWorkflowApprovals
            .Where(a => a.TenantId == tenantId && a.DecidedBy == userId
                && (a.Status == StudioWorkflowApprovalStatus.Approved || a.Status == StudioWorkflowApprovalStatus.Rejected))
            .OrderByDescending(a => a.DecidedAt)
            .ThenByDescending(a => a.Id)
            .Take(Math.Clamp(max, 1, 200))
            .ToListAsync(cancellationToken);
    }

    public async Task<int> PurgeTerminalOlderThanAsync(
        Guid tenantId, DateTime completedBeforeUtc, int max, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var ids = await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId
                && (i.Status == StudioWorkflowInstanceStatus.Completed
                    || i.Status == StudioWorkflowInstanceStatus.Failed
                    || i.Status == StudioWorkflowInstanceStatus.Cancelled)
                && i.CompletedAt != null && i.CompletedAt < completedBeforeUtc)
            .OrderBy(i => i.CompletedAt)
            .Select(i => i.Id)
            .Take(Math.Clamp(max, 1, 500))
            .ToListAsync(cancellationToken);
        if (ids.Count == 0)
            return 0;

        // Pas de FK entre les tables (0.11 point 4) : les enfants d'abord, puis les instances.
        await context.StudioWorkflowStepRuns
            .Where(r => r.TenantId == tenantId && ids.Contains(r.InstanceId))
            .ExecuteDeleteAsync(cancellationToken);
        await context.StudioWorkflowApprovals
            .Where(a => a.TenantId == tenantId && ids.Contains(a.InstanceId))
            .ExecuteDeleteAsync(cancellationToken);
        return await context.StudioWorkflowInstances
            .Where(i => i.TenantId == tenantId && ids.Contains(i.Id))
            .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<bool> TryLeaseInstanceAsync(
        StudioWorkflowInstance instance, DateTime nowUtc, TimeSpan leaseDuration, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(instance);
        if (!instance.TryLease(nowUtc, leaseDuration))
            return false;

        try
        {
            await UpdateInstanceAsync(instance, cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Course perdue sur le RowVersion : l'appelant abandonne l'instance pour ce tick (D-01).
            return false;
        }
    }
}
