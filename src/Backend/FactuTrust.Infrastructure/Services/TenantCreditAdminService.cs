using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Billing;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>Lot C3 — Implémentation EF Core du CRUD crédits tenant.</summary>
public sealed class TenantCreditAdminService : ITenantCreditAdminService
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _db;

    public TenantCreditAdminService(MasterDbContext db)
    {
        _db = db;
    }

    public async Task<TenantCreditsPageDto> ListByTenantAsync(
        Guid tenantId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.TenantCredits.AsNoTracking().Where(c => c.TenantId == tenantId);
        return await BuildPageAsync(query, tenantId, page, pageSize, cancellationToken);
    }

    public async Task<TenantCreditsPageDto> ListAllAsync(
        bool? activeOnly,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.TenantCredits.AsNoTracking().AsQueryable();
        if (activeOnly == true)
        {
            var nowUtc = DateTime.UtcNow;
            query = query.Where(c =>
                c.RevokedAt == null
                && (c.ExpiresAt == null || c.ExpiresAt > nowUtc)
                && (c.AmountTND - c.ConsumedAmountTND) > 0);
        }

        return await BuildPageAsync(query, tenantIdFilter: null, page, pageSize, cancellationToken);
    }

    public async Task<Result<TenantCreditDto>> GrantAsync(
        Guid tenantId,
        GrantTenantCreditRequest request,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var tenantExists = await _db.Tenants.AsNoTracking().AnyAsync(t => t.Id == tenantId, cancellationToken);
        if (!tenantExists)
            return Result.Failure<TenantCreditDto>(Error.NotFound("Tenant", tenantId));

        if (request.ExpiresAt is { } exp && exp <= DateTime.UtcNow)
            return Result.Failure<TenantCreditDto>(Error.Validation("ExpiresAt", "La date d'expiration doit être dans le futur."));

        try
        {
            var credit = TenantCredit.Grant(
                tenantId,
                request.AmountTND,
                request.Reason,
                actorUserId,
                request.ExpiresAt);
            _db.TenantCredits.Add(credit);
            await _db.SaveChangesAsync(cancellationToken);

            var tenantName = await _db.Tenants.AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => t.CompanyName)
                .FirstAsync(cancellationToken);
            return Result.Success(Map(credit, tenantName));
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<TenantCreditDto>(Error.Validation("Amount", ex.Message));
        }
    }

    public async Task<Result> RevokeAsync(
        Guid creditId,
        RevokeTenantCreditRequest request,
        CancellationToken cancellationToken = default)
    {
        var credit = await _db.TenantCredits.FirstOrDefaultAsync(c => c.Id == creditId, cancellationToken);
        if (credit is null)
            return Result.Failure(Error.NotFound(nameof(TenantCredit), creditId));

        credit.Revoke(request.Reason);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<TenantCreditsPageDto> BuildPageAsync(
        IQueryable<TenantCredit> filtered,
        Guid? tenantIdFilter,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var totalCount = await filtered.CountAsync(cancellationToken);

        var nowUtc = DateTime.UtcNow;
        var activeCount = await filtered.CountAsync(c =>
            c.RevokedAt == null
            && (c.ExpiresAt == null || c.ExpiresAt > nowUtc)
            && (c.AmountTND - c.ConsumedAmountTND) > 0, cancellationToken);

        var totalGranted = await filtered.SumAsync(c => (decimal?)c.AmountTND, cancellationToken) ?? 0m;
        var totalRemaining = await filtered
            .Where(c => c.RevokedAt == null && (c.ExpiresAt == null || c.ExpiresAt > nowUtc))
            .SumAsync(c => (decimal?)(c.AmountTND - c.ConsumedAmountTND), cancellationToken) ?? 0m;

        var rows = await filtered
            .OrderByDescending(c => c.GrantedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var tenantIds = rows.Select(r => r.TenantId).Distinct().ToList();
        var tenantNames = tenantIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.Tenants.AsNoTracking()
                .Where(t => tenantIds.Contains(t.Id))
                .ToDictionaryAsync(t => t.Id, t => t.CompanyName, cancellationToken);

        return new TenantCreditsPageDto
        {
            Items = rows.Select(c => Map(c, tenantNames.TryGetValue(c.TenantId, out var n) ? n : "—")).ToList(),
            TotalCount = totalCount,
            ActiveCount = activeCount,
            TotalGrantedTND = Math.Round(totalGranted, 3),
            TotalRemainingTND = Math.Round(totalRemaining, 3)
        };
    }

    private static TenantCreditDto Map(TenantCredit c, string tenantName) => new()
    {
        Id = c.Id,
        TenantId = c.TenantId,
        TenantName = tenantName,
        AmountTND = c.AmountTND,
        ConsumedAmountTND = c.ConsumedAmountTND,
        RemainingTND = c.RemainingTND,
        Reason = c.Reason,
        GrantedByUserId = c.GrantedByUserId,
        GrantedAt = c.GrantedAt,
        ExpiresAt = c.ExpiresAt,
        RelatedInvoiceId = c.RelatedInvoiceId,
        RevokedAt = c.RevokedAt,
        RevocationReason = c.RevocationReason,
        IsActive = c.IsActive
    };
}
