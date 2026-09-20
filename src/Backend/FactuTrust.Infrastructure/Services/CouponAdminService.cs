using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Billing;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>Lot C3 — Implémentation EF Core du CRUD coupons.</summary>
public sealed class CouponAdminService : ICouponAdminService
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _db;

    public CouponAdminService(MasterDbContext db)
    {
        _db = db;
    }

    public async Task<CouponsPageDto> ListAsync(
        bool? activeOnly,
        string? search,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.Coupons.AsNoTracking().AsQueryable();
        if (activeOnly == true)
            query = query.Where(c => c.IsActive);
        else if (activeOnly == false)
            query = query.Where(c => !c.IsActive);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = search.Trim().ToUpperInvariant();
            query = query.Where(c => c.Code.Contains(pattern));
        }

        var totalCount = await query.CountAsync(cancellationToken);
        var nowUtc = DateTime.UtcNow;
        var activeCount = await _db.Coupons.CountAsync(c => c.IsActive, cancellationToken);
        var redeemableCount = await _db.Coupons.CountAsync(c =>
            c.IsActive
            && c.ValidFrom <= nowUtc
            && c.ValidTo >= nowUtc
            && (c.MaxRedemptions == null || c.RedeemedCount < c.MaxRedemptions), cancellationToken);
        var totalRedemptions = await _db.CouponRedemptions.CountAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(c => c.IsActive)
            .ThenByDescending(c => c.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        // Charge les codes plan en bulk
        var planIds = rows.Where(r => r.AppliesToPlanId.HasValue).Select(r => r.AppliesToPlanId!.Value).Distinct().ToList();
        var planCodes = planIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.Plans.AsNoTracking()
                .Where(p => planIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => p.Code, cancellationToken);

        return new CouponsPageDto
        {
            Items = rows.Select(c => Map(c, planCodes)).ToList(),
            TotalCount = totalCount,
            ActiveCount = activeCount,
            RedeemableCount = redeemableCount,
            TotalRedemptions = totalRedemptions
        };
    }

    public async Task<Result<CouponDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var coupon = await _db.Coupons.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (coupon is null)
            return Result.Failure<CouponDto>(Error.NotFound(nameof(Coupon), id));

        var planCodes = new Dictionary<Guid, string>();
        if (coupon.AppliesToPlanId.HasValue)
        {
            var plan = await _db.Plans.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == coupon.AppliesToPlanId.Value, cancellationToken);
            if (plan is not null) planCodes[plan.Id] = plan.Code;
        }
        return Result.Success(Map(coupon, planCodes));
    }

    public async Task<Result<CouponDto>> CreateAsync(
        CreateCouponRequest request,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var code = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (await _db.Coupons.AnyAsync(c => c.Code == code, cancellationToken))
            return Result.Failure<CouponDto>(Error.Validation("Code", "Un coupon avec ce code existe déjà."));

        if (request.ValidFrom >= request.ValidTo)
            return Result.Failure<CouponDto>(Error.Validation("Period", "La date de fin doit être postérieure à la date de début."));

        if (request.Type == CouponType.Percent && (request.Value <= 0 || request.Value > 100))
            return Result.Failure<CouponDto>(Error.Validation("Value", "Pour un pourcentage, la valeur doit être entre 0 et 100."));

        var coupon = Coupon.Create(
            code,
            request.Type,
            request.Value,
            request.ValidFrom,
            request.ValidTo,
            actorUserId,
            request.DurationMonths,
            request.MaxRedemptions,
            request.AppliesToPlanId,
            request.Notes);

        _db.Coupons.Add(coupon);
        await _db.SaveChangesAsync(cancellationToken);

        return await GetByIdAsync(coupon.Id, cancellationToken);
    }

    public async Task<Result<CouponDto>> UpdateAsync(
        Guid id,
        UpdateCouponRequest request,
        CancellationToken cancellationToken = default)
    {
        var coupon = await _db.Coupons.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (coupon is null)
            return Result.Failure<CouponDto>(Error.NotFound(nameof(Coupon), id));

        if (request.ValidFrom >= request.ValidTo)
            return Result.Failure<CouponDto>(Error.Validation("Period", "La date de fin doit être postérieure à la date de début."));
        if (request.Type == CouponType.Percent && (request.Value <= 0 || request.Value > 100))
            return Result.Failure<CouponDto>(Error.Validation("Value", "Pour un pourcentage, la valeur doit être entre 0 et 100."));

        coupon.Update(
            request.Type,
            request.Value,
            request.ValidFrom,
            request.ValidTo,
            request.DurationMonths,
            request.MaxRedemptions,
            request.AppliesToPlanId,
            request.Notes);
        await _db.SaveChangesAsync(cancellationToken);

        return await GetByIdAsync(coupon.Id, cancellationToken);
    }

    public async Task<Result> DeactivateAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var coupon = await _db.Coupons.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (coupon is null) return Result.Failure(Error.NotFound(nameof(Coupon), id));
        coupon.Deactivate();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReactivateAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var coupon = await _db.Coupons.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (coupon is null) return Result.Failure(Error.NotFound(nameof(Coupon), id));
        coupon.Reactivate();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<CouponRedemptionDto>> ListRedemptionsAsync(
        Guid couponId,
        CancellationToken cancellationToken = default)
    {
        var rows = await _db.CouponRedemptions.AsNoTracking()
            .Where(r => r.CouponId == couponId)
            .OrderByDescending(r => r.RedeemedAt)
            .ToListAsync(cancellationToken);

        var tenantIds = rows.Select(r => r.TenantId).Distinct().ToList();
        var tenantNames = tenantIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.Tenants.AsNoTracking()
                .Where(t => tenantIds.Contains(t.Id))
                .ToDictionaryAsync(t => t.Id, t => t.CompanyName, cancellationToken);

        return rows.Select(r => new CouponRedemptionDto
        {
            Id = r.Id,
            CouponId = r.CouponId,
            TenantId = r.TenantId,
            TenantName = tenantNames.TryGetValue(r.TenantId, out var n) ? n : "—",
            RedeemedAt = r.RedeemedAt,
            AmountSavedTND = r.AmountSavedTND,
            AppliedToInvoiceId = r.AppliedToInvoiceId
        }).ToList();
    }

    private static CouponDto Map(Coupon c, IReadOnlyDictionary<Guid, string> planCodes) => new()
    {
        Id = c.Id,
        Code = c.Code,
        Type = c.Type,
        TypeDisplay = c.Type.ToDisplayString(),
        Value = c.Value,
        DurationMonths = c.DurationMonths,
        MaxRedemptions = c.MaxRedemptions,
        RedeemedCount = c.RedeemedCount,
        ValidFrom = c.ValidFrom,
        ValidTo = c.ValidTo,
        AppliesToPlanId = c.AppliesToPlanId,
        AppliesToPlanCode = c.AppliesToPlanId.HasValue && planCodes.TryGetValue(c.AppliesToPlanId.Value, out var code)
            ? code
            : null,
        IsActive = c.IsActive,
        IsRedeemable = c.IsRedeemableNow(),
        Notes = c.Notes,
        CreatedAt = c.CreatedAt
    };
}
