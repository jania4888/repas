using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Billing;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Billing;

/// <summary>Lot C6 — Lecture paginée des états dunning + KPIs.</summary>
public sealed class DunningStateQueryService : IDunningStateQueryService
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _db;

    public DunningStateQueryService(MasterDbContext db)
    {
        _db = db;
    }

    public async Task<DunningStatesPageDto> ListAsync(
        string? outcome,
        Guid? tenantId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.DunningStates.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(outcome) && Enum.TryParse<DunningOutcome>(outcome, true, out var o))
            query = query.Where(s => s.Outcome == o);
        if (tenantId.HasValue) query = query.Where(s => s.TenantId == tenantId.Value);

        var totalCount = await query.CountAsync(cancellationToken);
        var stats = await _db.DunningStates.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Active = g.Count(s => s.Outcome == DunningOutcome.Active),
                Paid = g.Count(s => s.Outcome == DunningOutcome.Paid),
                Suspended = g.Count(s => s.Outcome == DunningOutcome.Suspended),
                GiveUp = g.Count(s => s.Outcome == DunningOutcome.GiveUp)
            })
            .FirstOrDefaultAsync(cancellationToken);

        var rows = await query
            .OrderBy(s => s.Outcome == DunningOutcome.Active ? 0 : 1)
            .ThenBy(s => s.NextActionAt)
            .ThenByDescending(s => s.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var tenantIds = rows.Select(r => r.TenantId).Distinct().ToList();
        var tenants = await _db.Tenants.AsNoTracking()
            .Where(t => tenantIds.Contains(t.Id))
            .Select(t => new { t.Id, t.CompanyName })
            .ToDictionaryAsync(t => t.Id, t => t.CompanyName, cancellationToken);

        var invoiceIds = rows.Where(r => r.RelatedInvoiceId.HasValue).Select(r => r.RelatedInvoiceId!.Value).ToList();
        var invoices = await _db.PlatformInvoices.AsNoTracking()
            .Where(i => invoiceIds.Contains(i.Id))
            .Select(i => new { i.Id, i.Number })
            .ToDictionaryAsync(i => i.Id, i => i.Number, cancellationToken);

        var items = rows.Select(s => new DunningStateDto
        {
            Id = s.Id,
            SubscriptionId = s.SubscriptionId,
            TenantId = s.TenantId,
            TenantName = tenants.GetValueOrDefault(s.TenantId, "—"),
            CampaignId = s.CampaignId,
            DueDate = s.DueDate,
            CurrentStepIndex = s.CurrentStepIndex,
            NextActionAt = s.NextActionAt,
            LastEmailSentAt = s.LastEmailSentAt,
            AttemptsCount = s.AttemptsCount,
            Outcome = s.Outcome,
            OutcomeDisplay = s.Outcome.ToDisplayString(),
            CompletedAt = s.CompletedAt,
            RelatedInvoiceId = s.RelatedInvoiceId,
            RelatedInvoiceNumber = s.RelatedInvoiceId.HasValue ? invoices.GetValueOrDefault(s.RelatedInvoiceId.Value) : null,
            CreatedAt = s.CreatedAt
        }).ToList();

        return new DunningStatesPageDto
        {
            Items = items,
            TotalCount = totalCount,
            ActiveCount = stats?.Active ?? 0,
            PaidCount = stats?.Paid ?? 0,
            SuspendedCount = stats?.Suspended ?? 0,
            GiveUpCount = stats?.GiveUp ?? 0
        };
    }

    public async Task<Result<DunningStateDto>> GetBySubscriptionAsync(Guid subscriptionId, CancellationToken cancellationToken = default)
    {
        var entity = await _db.DunningStates.AsNoTracking()
            .Where(s => s.SubscriptionId == subscriptionId)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (entity is null) return Result.Failure<DunningStateDto>(Error.NotFound(nameof(DunningState), subscriptionId));

        var page = await ListAsync(null, null, 1, 1, cancellationToken);
        var matching = await _db.DunningStates.AsNoTracking()
            .Where(s => s.Id == entity.Id)
            .ToListAsync(cancellationToken);
        if (matching.Count == 0) return Result.Failure<DunningStateDto>(Error.NotFound(nameof(DunningState), subscriptionId));

        // Réutilise le mapping via List
        var listed = (await ListAsync(null, entity.TenantId, 1, MaxPageSize, cancellationToken)).Items.FirstOrDefault(i => i.Id == entity.Id);
        if (listed is null) return Result.Failure<DunningStateDto>(Error.NotFound(nameof(DunningState), subscriptionId));
        return Result.Success(listed);
    }
}
