using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

public sealed class PlatformTenantQueryService : IPlatformTenantQueryService
{
    private const int MaxPageSize = 100;

    private readonly MasterDbContext _db;

    public PlatformTenantQueryService(MasterDbContext db)
    {
        _db = db;
    }

    public async Task<PlatformTenantListPageDto> ListAsync(PlatformTenantListQuery query, CancellationToken cancellationToken = default)
    {
        var page = Math.Clamp(query.Page, 1, int.MaxValue / MaxPageSize);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);

        var filtered = from t in _db.Tenants.AsNoTracking()
            join s in _db.Subscriptions.AsNoTracking() on t.Id equals s.TenantId into subJoin
            from sub in subJoin.DefaultIfEmpty()
            select new { Tenant = t, Sub = sub };

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            var pattern = $"%{term}%";
            filtered = filtered.Where(x =>
                EF.Functions.Like(x.Tenant.CompanyName, pattern)
                || EF.Functions.Like(x.Tenant.Email.Value, pattern)
                || EF.Functions.Like(x.Tenant.NIF.Value, pattern));
        }

        if (query.IsActive.HasValue)
            filtered = filtered.Where(x => x.Tenant.IsActive == query.IsActive.Value);

        if (query.TaxRegime.HasValue)
            filtered = filtered.Where(x => x.Tenant.TaxRegime == query.TaxRegime.Value);

        if (query.Plan.HasValue)
        {
            if (query.Plan.Value == SubscriptionPlan.Free)
                filtered = filtered.Where(x => x.Sub == null || x.Sub.Plan == SubscriptionPlan.Free);
            else
                filtered = filtered.Where(x => x.Sub != null && x.Sub.Plan == query.Plan.Value);
        }

        if (query.SubscriptionStatus.HasValue)
            filtered = filtered.Where(x => x.Sub != null && x.Sub.Status == query.SubscriptionStatus.Value);

        var segment = query.Segment?.Trim().ToLowerInvariant();
        if (segment == "paying")
        {
            filtered = filtered.Where(x => x.Sub != null
                && (x.Sub.Plan == SubscriptionPlan.Monthly || x.Sub.Plan == SubscriptionPlan.Annual)
                && (x.Sub.Status == SubscriptionStatus.Active || x.Sub.Status == SubscriptionStatus.Trial));
        }
        else if (segment == "non_paying")
        {
            filtered = filtered.Where(x => x.Sub == null
                || !((x.Sub.Plan == SubscriptionPlan.Monthly || x.Sub.Plan == SubscriptionPlan.Annual)
                    && (x.Sub.Status == SubscriptionStatus.Active || x.Sub.Status == SubscriptionStatus.Trial)));
        }

        var totalCount = await filtered.CountAsync(cancellationToken);

        // ----- Tri serveur (Lot A2) ---------------------------------------------
        // Sortable keys reconnues : name | createdAt | lastActivity | plan | status | endDate | mrr.
        // Toute autre valeur retombe sur le tri par nom (rétro-compat).
        var sortKey = (query.SortBy ?? string.Empty).Trim().ToLowerInvariant();
        var sortDesc = (query.SortDir ?? string.Empty).Trim().ToLowerInvariant() == "desc";

        // On utilise des branches if/else (et non un switch expression) pour préserver
        // le typage anonyme de `filtered` côté EF Core et permettre la traduction SQL.
        var ordered = sortKey switch
        {
            "createdat" => sortDesc
                ? filtered.OrderByDescending(x => x.Tenant.CreatedAt).ThenByDescending(x => x.Tenant.Id)
                : filtered.OrderBy(x => x.Tenant.CreatedAt).ThenBy(x => x.Tenant.Id),
            "lastactivity" => sortDesc
                ? filtered.OrderByDescending(x => x.Tenant.UpdatedAt ?? x.Tenant.CreatedAt).ThenByDescending(x => x.Tenant.Id)
                : filtered.OrderBy(x => x.Tenant.UpdatedAt ?? x.Tenant.CreatedAt).ThenBy(x => x.Tenant.Id),
            "plan" => sortDesc
                ? filtered.OrderByDescending(x => x.Sub == null ? -1 : (int)x.Sub.Plan).ThenByDescending(x => x.Tenant.CompanyName)
                : filtered.OrderBy(x => x.Sub == null ? -1 : (int)x.Sub.Plan).ThenBy(x => x.Tenant.CompanyName),
            "status" => sortDesc
                ? filtered.OrderByDescending(x => x.Sub == null ? -1 : (int)x.Sub.Status).ThenByDescending(x => x.Tenant.CompanyName)
                : filtered.OrderBy(x => x.Sub == null ? -1 : (int)x.Sub.Status).ThenBy(x => x.Tenant.CompanyName),
            "enddate" => sortDesc
                ? filtered.OrderByDescending(x => x.Sub == null ? (DateTime?)null : x.Sub.EndDate).ThenByDescending(x => x.Tenant.CompanyName)
                : filtered.OrderBy(x => x.Sub == null ? (DateTime?)null : x.Sub.EndDate).ThenBy(x => x.Tenant.CompanyName),
            "mrr" => sortDesc
                ? filtered.OrderByDescending(x => x.Sub == null || x.Sub.MonthlyPrice == null ? 0m : x.Sub.MonthlyPrice.Amount).ThenByDescending(x => x.Tenant.CompanyName)
                : filtered.OrderBy(x => x.Sub == null || x.Sub.MonthlyPrice == null ? 0m : x.Sub.MonthlyPrice.Amount).ThenBy(x => x.Tenant.CompanyName),
            _ => sortDesc
                ? filtered.OrderByDescending(x => x.Tenant.CompanyName).ThenByDescending(x => x.Tenant.Id)
                : filtered.OrderBy(x => x.Tenant.CompanyName).ThenBy(x => x.Tenant.Id)
        };

        var pageRows = await ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var items = pageRows.Select(r =>
        {
            var monthlyPrice = r.Sub?.MonthlyPrice?.Amount;
            var annualPrice = r.Sub?.AnnualPrice?.Amount;
            return new PlatformTenantListItemDto
            {
                TenantId = r.Tenant.Id,
                CompanyName = r.Tenant.CompanyName,
                CompanyEmail = r.Tenant.Email.Value,
                TaxRegimeDisplay = r.Tenant.TaxRegime.ToDisplayString(),
                IsActive = r.Tenant.IsActive,
                DatabaseName = r.Tenant.DatabaseName,
                SubscriptionPlan = r.Sub?.Plan,
                SubscriptionPlanDisplay = r.Sub is null ? null : r.Sub.Plan.ToDisplayString(),
                SubscriptionStatus = r.Sub?.Status,
                SubscriptionStatusDisplay = r.Sub is null ? null : r.Sub.Status.ToDisplayString(),
                SubscriptionEndDate = r.Sub?.EndDate,
                IsPayingSubscriber = PlatformSubscriptionSegmentHelper.IsPayingSubscriber(r.Sub?.Plan, r.Sub?.Status),
                // Lot A2
                Nif = r.Tenant.NIF.Value,
                CreatedAt = r.Tenant.CreatedAt,
                LastActivityAt = r.Tenant.UpdatedAt ?? r.Tenant.CreatedAt,
                MrrTnd = PlatformSubscriptionMetricsHelper.ComputeRowMrrTnd(
                    r.Sub?.Plan, r.Sub?.Status, monthlyPrice, annualPrice),
                // Phase 2 (§WP-B8) — sector classification propagation
                CompanySegment = r.Tenant.CompanySegment,
                BusinessDomain = r.Tenant.BusinessDomain
            };
        }).ToList();

        return new PlatformTenantListPageDto
        {
            Items = items,
            TotalCount = totalCount
        };
    }

    public async Task<PlatformTenantStatsDto> GetStatsAsync(CancellationToken cancellationToken = default)
    {
        var nowUtc = DateTime.UtcNow;
        var thirtyDaysAgo = nowUtc.AddDays(-30);
        var sixtyDaysAgo = nowUtc.AddDays(-60);

        var total = await _db.Tenants.CountAsync(cancellationToken);

        var baseQuery = from t in _db.Tenants.AsNoTracking()
            join s in _db.Subscriptions.AsNoTracking() on t.Id equals s.TenantId into subJoin
            from sub in subJoin.DefaultIfEmpty()
            select new { Tenant = t, Sub = sub };

        var paying = await baseQuery.Where(x => x.Sub != null
                && (x.Sub.Plan == SubscriptionPlan.Monthly || x.Sub.Plan == SubscriptionPlan.Annual)
                && (x.Sub.Status == SubscriptionStatus.Active || x.Sub.Status == SubscriptionStatus.Trial))
            .CountAsync(cancellationToken);

        // ----- Lot A2 : KPIs enrichis ---------------------------------------------

        // Variation 30j : nouveaux signups sur 30 derniers jours
        var newLast30d = await _db.Tenants
            .Where(t => t.CreatedAt >= thirtyDaysAgo)
            .CountAsync(cancellationToken);

        // MRR estimé du parc (TND) — calculé en mémoire après projection des prix.
        // On évite la projection LINQ-to-SQL des Money value objects en chargeant
        // (Plan, Status, Monthly.Amount, Annual.Amount) puis en délégant au helper.
        var mrrInputs = await _db.Subscriptions.AsNoTracking()
            .Where(s => (s.Plan == SubscriptionPlan.Monthly || s.Plan == SubscriptionPlan.Annual)
                && (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Trial))
            .Select(s => new
            {
                s.Plan,
                s.Status,
                MonthlyAmount = s.MonthlyPrice != null ? (decimal?)s.MonthlyPrice.Amount : null,
                AnnualAmount = s.AnnualPrice != null ? (decimal?)s.AnnualPrice.Amount : null
            })
            .ToListAsync(cancellationToken);

        var mrrTnd = mrrInputs.Sum(x =>
            PlatformSubscriptionMetricsHelper.ComputeRowMrrTnd(
                x.Plan, x.Status, x.MonthlyAmount, x.AnnualAmount) ?? 0m);

        // Tenants en risque : PastDue + Suspended
        var risk = await _db.Subscriptions
            .Where(s => s.Status == SubscriptionStatus.PastDue || s.Status == SubscriptionStatus.Suspended)
            .CountAsync(cancellationToken);

        // Conversion essai → payant : sur les 30 derniers jours, parmi les essais terminés
        // (TrialEndDate <= now) on compte ceux qui sont devenus Active.
        // Si aucun essai n'a expiré dans la fenêtre, retourne null.
        var endedTrials30d = await _db.Subscriptions
            .Where(s => s.TrialEndDate != null
                && s.TrialEndDate >= thirtyDaysAgo
                && s.TrialEndDate <= nowUtc)
            .CountAsync(cancellationToken);

        var convertedTrials30d = await _db.Subscriptions
            .Where(s => s.TrialEndDate != null
                && s.TrialEndDate >= thirtyDaysAgo
                && s.TrialEndDate <= nowUtc
                && s.Status == SubscriptionStatus.Active)
            .CountAsync(cancellationToken);

        decimal? trialConversionRate = endedTrials30d > 0
            ? Math.Round((decimal)convertedTrials30d / endedTrials30d, 4)
            : null;

        // Période précédente (J-60..J-30) pour calculer le delta
        var endedTrialsPrev = await _db.Subscriptions
            .Where(s => s.TrialEndDate != null
                && s.TrialEndDate >= sixtyDaysAgo
                && s.TrialEndDate < thirtyDaysAgo)
            .CountAsync(cancellationToken);

        var convertedTrialsPrev = await _db.Subscriptions
            .Where(s => s.TrialEndDate != null
                && s.TrialEndDate >= sixtyDaysAgo
                && s.TrialEndDate < thirtyDaysAgo
                && s.Status == SubscriptionStatus.Active)
            .CountAsync(cancellationToken);

        decimal? trialConversionDelta = null;
        if (trialConversionRate.HasValue && endedTrialsPrev > 0)
        {
            var prev = (decimal)convertedTrialsPrev / endedTrialsPrev;
            trialConversionDelta = Math.Round(trialConversionRate.Value - prev, 4);
        }

        // Série temporelle des nouveaux signups (J-29 .. J-0)
        var signupsByDay = await _db.Tenants
            .Where(t => t.CreatedAt >= nowUtc.Date.AddDays(-29))
            .GroupBy(t => t.CreatedAt.Date)
            .Select(g => new { Date = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Date, x => x.Count, cancellationToken);

        var timeseries = new int[30];
        for (var i = 0; i < 30; i++)
        {
            var day = nowUtc.Date.AddDays(-(29 - i));
            timeseries[i] = signupsByDay.TryGetValue(day, out var count) ? count : 0;
        }

        return new PlatformTenantStatsDto
        {
            TotalTenants = total,
            PayingSubscribers = paying,
            NonPayingSubscribers = total - paying,
            // Lot A2
            TotalDelta30d = newLast30d,
            MrrEstimateTnd = Math.Round(mrrTnd, 3),
            TrialConversionRate30d = trialConversionRate,
            TrialConversionDelta30d = trialConversionDelta,
            RiskCount = risk,
            NewSignupsTimeseries30d = timeseries
        };
    }

    public async Task<PlatformTenantDetailDto?> GetDetailAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var row = await (
                from t in _db.Tenants.AsNoTracking()
                where t.Id == tenantId
                join s in _db.Subscriptions.AsNoTracking() on t.Id equals s.TenantId into subJoin
                from sub in subJoin.DefaultIfEmpty()
                select new { Tenant = t, Sub = sub })
            .FirstOrDefaultAsync(cancellationToken);

        if (row is null)
            return null;

        var tenant = row.Tenant;
        var subscription = row.Sub;

        return new PlatformTenantDetailDto
        {
            TenantId = tenant.Id,
            CompanyName = tenant.CompanyName,
            CompanyEmail = tenant.Email.Value,
            Nif = tenant.NIF.Value,
            Phone = tenant.Phone.Value,
            City = tenant.Address.City,
            Governorate = tenant.Address.Governorate,
            Website = tenant.Website,
            TaxRegimeDisplay = tenant.TaxRegime.ToDisplayString(),
            IsActive = tenant.IsActive,
            DeactivatedAt = tenant.DeactivatedAt,
            DatabaseName = tenant.DatabaseName,
            SubscriptionPlan = subscription?.Plan,
            SubscriptionPlanDisplay = subscription?.Plan.ToDisplayString(),
            SubscriptionStatus = subscription?.Status,
            SubscriptionStatusDisplay = subscription?.Status.ToDisplayString(),
            SubscriptionEndDate = subscription?.EndDate,
            IsPayingSubscriber = PlatformSubscriptionSegmentHelper.IsPayingSubscriber(subscription?.Plan, subscription?.Status),
            // Phase 2 (§WP-B8) — sector classification propagation
            CompanySegment = tenant.CompanySegment,
            BusinessDomain = tenant.BusinessDomain
        };
    }

}
