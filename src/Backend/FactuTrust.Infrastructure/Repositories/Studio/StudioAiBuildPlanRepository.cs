using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using FactuTrust.Infrastructure.Repositories;

namespace FactuTrust.Infrastructure.Repositories.Studio;

public sealed class StudioAiBuildPlanRepository : IStudioAiBuildPlanRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public StudioAiBuildPlanRepository(ITenantDbContextFactory contextFactory) => _contextFactory = contextFactory;

    public async Task<StudioAiBuildPlan?> GetByIdAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StudioAiBuildPlans
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id, cancellationToken);
    }

    public async Task AddAsync(StudioAiBuildPlan plan, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioAiBuildPlans.Add(plan);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> TryUpdateAsync(StudioAiBuildPlan plan, CancellationToken cancellationToken = default, byte[]? expectedRowVersion = null)
    {
        await using var context = _contextFactory.CreateContext();
        context.StudioAiBuildPlans.Update(plan);
        if (expectedRowVersion is { Length: > 0 })
        {
            // Jeton lu par le client (édition de la spec) : EF lève DbUpdateConcurrencyException si la
            // ligne a bougé depuis sa lecture — même patron que CustomRecordRepository.UpdateWithConcurrencyAsync.
            context.Entry(plan).Property(p => p.RowVersion).OriginalValue = expectedRowVersion;
        }
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Une autre requête a déjà fait avancer le plan (double clic « Valider ») — le perdant renonce.
            return false;
        }
    }

    public async Task<(IReadOnlyList<StudioAiBuildPlan> Items, int TotalCount)> ListByOwnerAsync(
        Guid tenantId, string userId, StudioAiPlanStatus? status, StudioAiPlanKind? kind,
        int page, int pageSize, CancellationToken cancellationToken = default)
    {
        // Un plan n'appartient qu'à son créateur (CreatedBy est un Guid?) : un identifiant
        // illisible ne possède rien — la liste est vide plutôt qu'une fuite.
        if (!Guid.TryParse(userId, out var ownerId))
            return (Array.Empty<StudioAiBuildPlan>(), 0);

        await using var context = _contextFactory.CreateContext();
        var query = context.StudioAiBuildPlans
            .Where(p => p.TenantId == tenantId && p.CreatedBy == ownerId);

        if (status is not null)
            query = query.Where(p => p.Status == status.Value);
        if (kind is not null)
            query = query.Where(p => p.Kind == kind.Value);

        // Deux requêtes (comptage puis page), comme CustomRecordRepository.ListAsync.
        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(p => p.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, total);
    }

    public async Task<IReadOnlyList<StudioAiBuildPlan>> ListPendingByOwnerAsync(
        Guid tenantId, string userId, CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParse(userId, out var ownerId))
            return Array.Empty<StudioAiBuildPlan>();

        await using var context = _contextFactory.CreateContext();
        var utcNow = DateTime.UtcNow;
        return await context.StudioAiBuildPlans
            .Where(p => p.TenantId == tenantId && p.CreatedBy == ownerId
                && p.Status == StudioAiPlanStatus.Pending && p.ExpiresAt > utcNow)
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync(cancellationToken);
    }
}
