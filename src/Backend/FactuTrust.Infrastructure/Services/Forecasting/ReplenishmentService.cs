using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Forecasting;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Forecasting.Dtos;
using FactuTrust.Application.Features.Forecasting.Services;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Domain.Entities.Forecasting;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Forecasting.Statistics;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Forecasting;

/// <summary>
/// V2 replenishment service. Generation considers <c>StockItem.MinimumStock</c>, on-order quantities and
/// product-level supplier/MOQ/packaging hints. PO preparation creates real draft <c>PurchaseOrder</c> entities
/// (fix F-C1, F-C2). Every state-changing action writes a <c>ReplenishmentDecisionAudit</c> row.
/// Gated by <c>Features:Forecasting:ReplenishmentV2:Enabled</c>: controller code returns 503 when the flag is off.
/// </summary>
public sealed class ReplenishmentService : IReplenishmentService
{
    private const string Currency = "TND";

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ITunisianCalendarService _calendar;
    private readonly ICurrentUser _currentUser;
    private readonly IPurchaseOrderDraftFactory _poFactory;
    private readonly ForecastingOptions _options;
    private readonly ILogger<ReplenishmentService> _logger;

    public ReplenishmentService(
        ITenantDbContextFactory contextFactory,
        ITunisianCalendarService calendar,
        ICurrentUser currentUser,
        IPurchaseOrderDraftFactory poFactory,
        IOptions<ForecastingOptions> options,
        ILogger<ReplenishmentService> logger)
    {
        _contextFactory = contextFactory;
        _calendar = calendar;
        _currentUser = currentUser;
        _poFactory = poFactory;
        _options = options.Value;
        _logger = logger;
    }

    // ───────────────────────────── Generation ─────────────────────────────

    /// <summary>
    /// Per-tenant generation gates (fix C4). Without them, two overlapping runs (manual
    /// "Régénérer" + nightly job, or a double-click) both supersede the Pending rows and both
    /// insert fresh ones — duplicate Pending recommendations for the same (product, warehouse).
    /// The filtered unique index <c>UX_ReplenishmentRecommendations_Pending_ProductWarehouse</c>
    /// is the database-level backstop for cross-process races.
    /// The dictionary is bounded by the number of tenants served by this instance — no eviction.
    /// </summary>
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> TenantGenerationLocks = new();

    public async Task<int> GenerateRecommendationsAsync(
        Guid? warehouseId,
        Guid? productId,
        CancellationToken ct = default)
    {
        if (!_options.Enabled) return 0;

        var lockKey = _currentUser.TenantId ?? Guid.Empty;
        var gate = TenantGenerationLocks.GetOrAdd(lockKey, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            return await GenerateRecommendationsCoreAsync(warehouseId, productId, ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Cross-process race (another API instance won the insert): the DB backstop fired.
            // Surface a clear conflict instead of a raw 500 — the losing run persisted nothing new.
            _logger.LogWarning(ex,
                "Concurrent replenishment generation blocked by the unique Pending index (tenant={Tenant}).", lockKey);
            throw new InvalidOperationException(
                "Une génération de recommandations est déjà en cours. Réessayez dans quelques instants.", ex);
        }
        finally
        {
            gate.Release();
        }
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.GetBaseException() is SqlException { Number: 2601 or 2627 };

    private async Task<int> GenerateRecommendationsCoreAsync(
        Guid? warehouseId,
        Guid? productId,
        CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var v2 = _options.Replenishment;

        // 1) Mark in-scope Pending recommendations as Superseded before generating fresh ones.
        var existing = ctx.ReplenishmentRecommendations
            .Where(r => r.Status == ReplenishmentStatus.Pending
                        && (warehouseId == null || r.WarehouseId == warehouseId)
                        && (productId == null || r.ProductId == productId));
        await foreach (var r in existing.AsAsyncEnumerable().WithCancellation(ct)) r.MarkSuperseded();

        // 2) Stock-managed items in scope.
        var stockItems = await (
            from s in ctx.StockItems
            join p in ctx.Products on s.ProductId equals p.Id
            where (warehouseId == null || s.WarehouseId == warehouseId)
                  && (productId == null || s.ProductId == productId)
                  && p.IsStockManaged
            select new StockItemSnapshot(
                s.ProductId,
                s.WarehouseId,
                s.QuantityOnHand,
                s.MinimumStock,
                s.MaximumStock,
                p.Category != null ? p.Category.Name : null,
                p.PreferredSupplierId,
                p.MinimumOrderQuantity,
                p.PackagingQty,
                p.LeadTimeDaysOverride)).ToListAsync(ct);

        if (stockItems.Count == 0)
        {
            await ctx.SaveChangesAsync(ct);
            return 0;
        }

        // 3) 90-day daily demand history.
        var since = DateTime.UtcNow.Date.AddDays(-90);
        var dailySalesByProduct = await ctx.InvoiceLines
            .Where(il => il.Invoice.IssueDate >= since
                         && il.Invoice.Status != InvoiceStatus.Draft
                         && il.Invoice.Status != InvoiceStatus.Cancelled
                         && il.ProductId.HasValue
                         && (warehouseId == null || il.Invoice.WarehouseId == warehouseId)
                         && (productId == null || il.ProductId == productId))
            .GroupBy(il => new { ProductId = il.ProductId!.Value, il.Invoice.IssueDate.Date })
            .Select(g => new { ProductId = g.Key.ProductId, Date = g.Key.Date, Qty = g.Sum(l => l.Quantity) })
            .ToListAsync(ct);

        var groupedByProduct = dailySalesByProduct.GroupBy(x => x.ProductId).ToDictionary(g => g.Key, g => g.ToList());

        // 4) Open POs not yet fully received → on-order qty per (product, warehouse).
        var onOrderByPair = await ctx.PurchaseOrders
            .Where(po => po.Status == PurchaseOrderStatus.Draft
                         || po.Status == PurchaseOrderStatus.Confirmed
                         || po.Status == PurchaseOrderStatus.PartiallyReceived)
            .SelectMany(po => po.Lines.Select(l => new
            {
                l.ProductId,
                WarehouseId = po.WarehouseId,
                Remaining = l.Quantity - l.ReceivedQuantity
            }))
            .Where(x => x.WarehouseId.HasValue && x.Remaining > 0
                        && (warehouseId == null || x.WarehouseId == warehouseId)
                        && (productId == null || x.ProductId == productId))
            .GroupBy(x => new { x.ProductId, x.WarehouseId })
            .Select(g => new { g.Key.ProductId, WarehouseId = g.Key.WarehouseId!.Value, OnOrder = g.Sum(x => x.Remaining) })
            .ToListAsync(ct);
        var onOrderMap = onOrderByPair.ToDictionary(x => (x.ProductId, x.WarehouseId), x => x.OnOrder);

        // 5) Supplier names lookup (single round trip).
        var supplierIds = stockItems
            .Select(s => s.PreferredSupplierId)
            .Where(g => g.HasValue)
            .Select(g => g!.Value)
            .Distinct()
            .ToList();
        var supplierNames = await ctx.Suppliers
            .Where(s => supplierIds.Contains(s.Id))
            .Select(s => new { s.Id, s.Name })
            .ToDictionaryAsync(s => s.Id, s => s.Name, ct);

        var generated = 0;
        foreach (var item in stockItems)
        {
            var demands = new double[90];
            if (groupedByProduct.TryGetValue(item.ProductId, out var rows))
            {
                foreach (var r in rows)
                {
                    var idx = (r.Date.Date - since).Days;
                    if (idx >= 0 && idx < 90) demands[idx] = (double)r.Qty;
                }
            }
            var dailyDemand = (decimal)StatisticalForecasting.Mean(demands);
            var demandSd = (decimal)StatisticalForecasting.StandardDeviation(demands);

            var leadTime = item.LeadTimeDaysOverride ?? _options.DefaultLeadTimeDays;

            var seasonalFactor = 1.0;
            if (item.ProductCategoryName is not null)
            {
                double sum = 0;
                for (var d = DateTime.UtcNow.Date; d <= DateTime.UtcNow.Date.AddDays(leadTime); d = d.AddDays(1))
                    sum += _calendar.GetSeasonalFactor(item.ProductCategoryName, d);
                seasonalFactor = sum / Math.Max(1, leadTime + 1);
            }
            dailyDemand *= (decimal)seasonalFactor;

            var z = v2.DefaultServiceLevelZ;

            // Effective stock takes on-order into account so we do NOT double-order.
            var onOrder = onOrderMap.TryGetValue((item.ProductId, item.WarehouseId), out var oo) ? oo : 0m;
            var effectiveQty = item.QuantityOnHand + onOrder;

            // Fix C2: the recommended quantity itself also deducts the on-order quantity —
            // previously only the trigger did, which over-ordered while a PO was in flight.
            var math = StatisticalForecasting.ComputeReplenishment(
                dailyDemand,
                demandSd,
                leadTime,
                z,
                item.QuantityOnHand,
                item.MaximumStock ?? 0m,
                onOrder);

            // Floor the safety stock with the user-configured MinimumStock (V2 — fix F-C4).
            var effectiveRop = Math.Max(math.Rop, item.MinimumStock);

            // Trigger condition: effective stock at-or-below the effective ROP AND a recommended qty > 0.
            if (effectiveQty > effectiveRop || math.RecommendedQty <= 0)
                continue;

            // Bump to MOQ then round up to packaging multiple.
            var qty = math.RecommendedQty;
            if (item.MinimumOrderQuantity is { } moq && qty < moq) qty = moq;
            if (item.PackagingQty is { } pack && pack > 0)
                qty = Math.Ceiling(qty / pack) * pack;

            var reasons = new List<string>();
            if (item.QuantityOnHand <= 0) reasons.Add("OutOfStock");
            else if (item.QuantityOnHand <= math.SafetyStock) reasons.Add("BelowSafetyStock");
            else if (item.QuantityOnHand <= effectiveRop) reasons.Add("AtOrBelowReorderPoint");
            if (item.QuantityOnHand <= item.MinimumStock && item.MinimumStock > 0)
                reasons.Add("BelowUserMinimumStock");
            if (seasonalFactor > 1.05) reasons.Add("SeasonalUpcomingEvent");
            if (dailyDemand > 0) reasons.Add(
                FormattableString.Invariant($"DailyDemand:{Math.Round(dailyDemand, 2)}"));

            var rec = ReplenishmentRecommendation.Create(
                item.ProductId,
                item.WarehouseId,
                qty,
                effectiveRop,
                math.SafetyStock,
                leadTime,
                dailyDemand,
                JsonSerializer.Serialize(reasons));

            // V2 enrichment — supplier hint, on-order, effective qty, days of stock.
            decimal? daysOfStock = dailyDemand > 0 ? Math.Round(item.QuantityOnHand / dailyDemand, 2) : (decimal?)null;
            string? supplierName = null;
            if (item.PreferredSupplierId is { } sid && supplierNames.TryGetValue(sid, out var name))
                supplierName = name;

            rec.SetV2Enrichment(
                preferredSupplierId: item.PreferredSupplierId,
                preferredSupplierName: supplierName,
                quantityOnHand: item.QuantityOnHand,
                quantityOnOrder: onOrder,
                daysOfStockRemaining: daysOfStock);

            ctx.ReplenishmentRecommendations.Add(rec);
            generated++;
        }

        await ctx.SaveChangesAsync(ct);
        _logger.LogInformation(
            "ReplenishmentV2 generated {Count} recommendation(s) (warehouse={Warehouse}, product={Product}).",
            generated, warehouseId, productId);
        return generated;
    }

    // ───────────────────────────── Reads ─────────────────────────────────

    public async Task<PagedResult<ReplenishmentRecommendationDto>> GetRecommendationsAsync(
        ReplenishmentFiltersDto filters,
        CancellationToken ct = default)
    {
        // 4.7 suite (R52, motif D-45-28) : borne haute pour que (page - 1) * pageSize reste un int.
        var page = filters.Page < 1 ? 1 : Math.Min(filters.Page, int.MaxValue / 200);
        var pageSize = filters.PageSize is < 1 or > 200 ? 50 : filters.PageSize;

        await using var ctx = _contextFactory.CreateContext();

        // Phase 2 review C2: search now uses a SQL JOIN onto Products so we filter on
        // productCode / productName / supplierName in a single sargable WHERE clause. Previously
        // search was applied only on PreferredSupplierName in SQL and re-filtered in memory after
        // pagination — TotalCount was wrong and pages were dropped silently.
        var q =
            from r in ctx.ReplenishmentRecommendations
            join p in ctx.Products on r.ProductId equals p.Id
            select new { r, p };

        if (filters.WarehouseId.HasValue) q = q.Where(x => x.r.WarehouseId == filters.WarehouseId.Value);
        if (filters.SupplierId.HasValue)
            q = q.Where(x => x.r.PreferredSupplierId == filters.SupplierId.Value
                             || x.r.ManualSupplierOverride == filters.SupplierId.Value);
        if (filters.Status.HasValue) q = q.Where(x => x.r.Status == filters.Status.Value);
        if (filters.FromGeneratedAt.HasValue) q = q.Where(x => x.r.GeneratedAt >= filters.FromGeneratedAt);
        if (filters.ToGeneratedAt.HasValue) q = q.Where(x => x.r.GeneratedAt <= filters.ToGeneratedAt);
        if (!string.IsNullOrWhiteSpace(filters.Search))
        {
            var like = $"%{filters.Search.Trim()}%";
            q = q.Where(x =>
                EF.Functions.Like(x.p.Code, like)
                || EF.Functions.Like(x.p.Name, like)
                || EF.Functions.Like(x.r.PreferredSupplierName ?? "", like));
        }

        // Sort — applied on the recommendation columns regardless of the join.
        q = (filters.OrderBy?.ToLowerInvariant(), filters.OrderDesc) switch
        {
            ("rop", true)   => q.OrderByDescending(x => x.r.Rop),
            ("rop", false)  => q.OrderBy(x => x.r.Rop),
            ("qty", true)   => q.OrderByDescending(x => x.r.RecommendedQty),
            ("qty", false)  => q.OrderBy(x => x.r.RecommendedQty),
            ("days", true)  => q.OrderByDescending(x => x.r.DaysOfStockRemaining),
            ("days", false) => q.OrderBy(x => x.r.DaysOfStockRemaining),
            _ => filters.OrderDesc ? q.OrderByDescending(x => x.r.GeneratedAt) : q.OrderBy(x => x.r.GeneratedAt),
        };

        var total = await q.CountAsync(ct);
        var page1 = await q.Skip((page - 1) * pageSize).Take(pageSize).Select(x => x.r).ToListAsync(ct);

        var items = await MapRowsAsync(ctx, page1, ct);

        // Urgency is derived in MapRowsAsync — we still filter it post-fetch, but the page size is
        // bounded (≤200) so the cost is fine. TotalCount above remains the true SQL count.
        if (!string.IsNullOrWhiteSpace(filters.UrgencyLevel))
            items = items.Where(i => string.Equals(i.UrgencyLevel, filters.UrgencyLevel, StringComparison.OrdinalIgnoreCase)).ToList();

        return new PagedResult<ReplenishmentRecommendationDto>
        {
            Items = items,
            Page = page,
            PageSize = pageSize,
            TotalCount = total
        };
    }

    public async Task<IReadOnlyList<ReplenishmentDecisionAuditDto>> GetHistoryAsync(Guid recommendationId, CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rows = await ctx.ReplenishmentDecisionAudits
            .Where(a => a.RecommendationId == recommendationId)
            .OrderBy(a => a.ActedAt)
            .Select(a => new ReplenishmentDecisionAuditDto(
                a.Id, a.RecommendationId, a.FromStatus, a.ToStatus, a.ActionType,
                a.Reason, a.ActorUserId, a.ActedAt, a.PayloadJson))
            .ToListAsync(ct);
        return rows;
    }

    public async Task<ReplenishmentKpiDto> GetKpiAsync(Guid? warehouseId, CancellationToken ct = default)
    {
        var v2 = _options.Replenishment;
        await using var ctx = _contextFactory.CreateContext();
        var baseQuery = ctx.ReplenishmentRecommendations
            .Where(r => warehouseId == null || r.WarehouseId == warehouseId);

        var pending = await baseQuery.CountAsync(r => r.Status == ReplenishmentStatus.Pending, ct);
        var urgent = await baseQuery.CountAsync(
            r => r.Status == ReplenishmentStatus.Pending
                 && r.DaysOfStockRemaining != null
                 && r.DaysOfStockRemaining < v2.UrgencyThresholdDays, ct);
        var outOfStock = await baseQuery.CountAsync(
            r => r.Status == ReplenishmentStatus.Pending && r.EffectiveQty == 0, ct);

        // Phase 2 review M4: compute SUM(qty × price) directly in SQL via JOIN — V1 loaded every
        // pending row + every product price and joined in memory (O(N) round trips for big tenants).
        // PurchasePrice is the owned `Money` value object; fall back to UnitPrice when null.
        // Only lines with an explicit product purchase price count toward the estimate (no sale-price fallback).
        var value = await (
                from r in baseQuery
                where r.Status == ReplenishmentStatus.Pending
                join p in ctx.Products on r.ProductId equals p.Id
                where p.PurchasePrice != null
                select (r.ManualQtyOverride ?? r.RecommendedQty) * p.PurchasePrice!.Amount)
            .SumAsync(ct);

        // Top 5 urgencies (lowest days of stock first).
        var topRows = await baseQuery
            .Where(r => r.Status == ReplenishmentStatus.Pending)
            .OrderBy(r => r.DaysOfStockRemaining ?? decimal.MaxValue)
            .Take(5)
            .ToListAsync(ct);
        var topProductIds = topRows.Select(r => r.ProductId).Distinct().ToList();
        var topProducts = await ctx.Products
            .Where(p => topProductIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Code, p.Name })
            .ToDictionaryAsync(p => p.Id, ct);
        var stocks = await ctx.StockItems
            .Where(s => topProductIds.Contains(s.ProductId))
            .ToListAsync(ct);
        var stockMap = stocks.ToDictionary(s => (s.ProductId, s.WarehouseId), s => s.QuantityOnHand);

        var top = topRows.Select(r =>
        {
            topProducts.TryGetValue(r.ProductId, out var p);
            stockMap.TryGetValue((r.ProductId, r.WarehouseId), out var onHand);
            return new KpiTopUrgencyDto(
                r.Id,
                p?.Code ?? "?",
                p?.Name ?? "?",
                onHand,
                r.DaysOfStockRemaining,
                r.ManualQtyOverride ?? r.RecommendedQty);
        }).ToList();

        // Service / stock-out rates — proxy: % of stock-managed product/warehouse pairs currently NOT in shortage.
        var totalManaged = await (
            from s in ctx.StockItems
            join p in ctx.Products on s.ProductId equals p.Id
            where p.IsStockManaged && (warehouseId == null || s.WarehouseId == warehouseId)
            select 1).CountAsync(ct);
        decimal serviceLevel = totalManaged == 0 ? 100m : Math.Round(100m * (1m - (decimal)outOfStock / totalManaged), 2);
        decimal stockOutRate = totalManaged == 0 ? 0m : Math.Round(100m * outOfStock / totalManaged, 2);

        return new ReplenishmentKpiDto(
            PendingCount: pending,
            UrgentCount: urgent,
            OutOfStockCount: outOfStock,
            EstimatedValueToOrder: Math.Round(value, 3),
            Currency: Currency,
            ServiceLevelPercent: serviceLevel,
            StockOutRatePercent: stockOutRate,
            ComputedAt: DateTime.UtcNow,
            TopUrgencies: top);
    }

    // ───────────────────────────── Decisions ──────────────────────────────

    public async Task<ReplenishmentRecommendationDto> ApproveAsync(Guid recommendationId, CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rec = await ctx.ReplenishmentRecommendations.FirstOrDefaultAsync(r => r.Id == recommendationId, ct)
            ?? throw new InvalidOperationException("Recommendation not found");

        var from = rec.Status;
        rec.Approve(GetUserId());
        // Phase 2 review M3: don't pollute the audit trail with idempotent no-ops.
        // Domain.Approve() is a no-op when already Approved (fix F-M1) — we mirror that here.
        if (from != rec.Status)
        {
            ctx.ReplenishmentDecisionAudits.Add(
                ReplenishmentDecisionAudit.Create(rec.Id, from, rec.Status, "Approve", GetUserId()));
            await ctx.SaveChangesAsync(ct);
        }

        return (await MapRowsAsync(ctx, new[] { rec }, ct)).Single();
    }

    public async Task<ReplenishmentRecommendationDto> DismissAsync(Guid recommendationId, string reason, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw new ArgumentException("La raison du rejet est obligatoire.", nameof(reason));

        await using var ctx = _contextFactory.CreateContext();
        var rec = await ctx.ReplenishmentRecommendations.FirstOrDefaultAsync(r => r.Id == recommendationId, ct)
            ?? throw new InvalidOperationException("Recommendation not found");

        var from = rec.Status;
        rec.Dismiss(GetUserId(), reason);
        if (from != rec.Status)
        {
            ctx.ReplenishmentDecisionAudits.Add(
                ReplenishmentDecisionAudit.Create(rec.Id, from, rec.Status, "Dismiss", GetUserId(), reason: reason));
            await ctx.SaveChangesAsync(ct);
        }

        return (await MapRowsAsync(ctx, new[] { rec }, ct)).Single();
    }

    public async Task<ReplenishmentRecommendationDto> OverrideAsync(
        Guid recommendationId,
        decimal? manualQty,
        Guid? manualSupplierId,
        CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rec = await ctx.ReplenishmentRecommendations.FirstOrDefaultAsync(r => r.Id == recommendationId, ct)
            ?? throw new InvalidOperationException("Recommendation not found");

        var payload = JsonSerializer.Serialize(new
        {
            oldQty = rec.ManualQtyOverride,
            newQty = manualQty,
            oldSupplier = rec.ManualSupplierOverride,
            newSupplier = manualSupplierId
        });

        var from = rec.Status;
        rec.ApplyManualOverride(manualQty, manualSupplierId, GetUserId());
        ctx.ReplenishmentDecisionAudits.Add(
            ReplenishmentDecisionAudit.Create(rec.Id, from, rec.Status, "Override", GetUserId(), payloadJson: payload));
        await ctx.SaveChangesAsync(ct);

        return (await MapRowsAsync(ctx, new[] { rec }, ct)).Single();
    }

    public async Task<ReplenishmentRecommendationDto> UndoLastDecisionAsync(Guid recommendationId, CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rec = await ctx.ReplenishmentRecommendations.FirstOrDefaultAsync(r => r.Id == recommendationId, ct)
            ?? throw new InvalidOperationException("Recommendation not found");

        var window = TimeSpan.FromHours(_options.Replenishment.UndoWindowHours);
        if (rec.ProcessedAt is { } processedAt && DateTime.UtcNow - processedAt > window)
            throw new InvalidOperationException(
                $"La fenêtre d'annulation ({_options.Replenishment.UndoWindowHours}h) est expirée.");

        var from = rec.Status;
        rec.RevertToPending(GetUserId());
        if (from != rec.Status)
        {
            ctx.ReplenishmentDecisionAudits.Add(
                ReplenishmentDecisionAudit.Create(rec.Id, from, rec.Status, "Revert", GetUserId()));
            await ctx.SaveChangesAsync(ct);
        }

        return (await MapRowsAsync(ctx, new[] { rec }, ct)).Single();
    }

    public async Task<ReplenishmentRecommendationDto> AttachNotesAsync(Guid recommendationId, string? notes, CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rec = await ctx.ReplenishmentRecommendations.FirstOrDefaultAsync(r => r.Id == recommendationId, ct)
            ?? throw new InvalidOperationException("Recommendation not found");

        var payload = JsonSerializer.Serialize(new { previous = rec.UserNotes, next = notes });
        rec.AttachNotes(notes, GetUserId());
        ctx.ReplenishmentDecisionAudits.Add(
            ReplenishmentDecisionAudit.Create(rec.Id, rec.Status, rec.Status, "AttachNotes", GetUserId(), payloadJson: payload));
        await ctx.SaveChangesAsync(ct);

        return (await MapRowsAsync(ctx, new[] { rec }, ct)).Single();
    }

    // ───────────────────────────── Create real POs (fix F-C1, F-C2) ──────

    public async Task<IReadOnlyList<CreatePurchaseOrderLinePriceDto>> SuggestPurchaseOrderLinePricesAsync(
        IReadOnlyList<Guid> recommendationIds,
        CancellationToken ct = default)
    {
        if (recommendationIds is null || recommendationIds.Count == 0)
            throw new ArgumentException("At least one recommendation id is required.", nameof(recommendationIds));

        await using var ctx = _contextFactory.CreateContext();
        var recs = await ctx.ReplenishmentRecommendations
            .Where(r => recommendationIds.Contains(r.Id)
                        && (r.Status == ReplenishmentStatus.Pending || r.Status == ReplenishmentStatus.Approved))
            .ToListAsync(ct);

        if (recs.Count == 0)
            throw new InvalidOperationException(
                "Aucune recommandation éligible (Pending ou Approved) pour les identifiants fournis.");

        var productIds = recs.Select(r => r.ProductId).Distinct().ToList();
        var products = await ctx.Products
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, ct);

        var list = new List<CreatePurchaseOrderLinePriceDto>();
        foreach (var rec in recs)
        {
            if (rec.GetEffectiveSupplierId() is null || rec.GetEffectiveOrderQty() <= 0)
                continue;

            if (!products.TryGetValue(rec.ProductId, out var product))
                throw new ArgumentException($"Produit introuvable pour la recommandation {rec.Id}.");

            var suggested = ReplenishmentPurchaseUnitPriceResolver.SuggestUnitPrice(
                product, rec.GetEffectiveSupplierId());
            if (suggested is null or <= 0)
                throw new ArgumentException(
                    $"Prix d'achat produit manquant pour « {product.Code} » — renseignez-le sur la fiche produit ou créez le BC depuis le module Réapprovisionnement.");

            list.Add(new CreatePurchaseOrderLinePriceDto(rec.Id, suggested.Value));
        }

        return list;
    }

    public async Task<CreatePurchaseOrdersResultDto> CreatePurchaseOrdersAsync(
        IReadOnlyList<Guid> recommendationIds,
        IReadOnlyList<CreatePurchaseOrderLinePriceDto>? linePrices,
        CancellationToken ct = default)
    {
        if (recommendationIds is null || recommendationIds.Count == 0)
            throw new ArgumentException("At least one recommendation id is required.", nameof(recommendationIds));

        var max = _options.Replenishment.MaxPrepareBatchSize;
        if (recommendationIds.Count > max)
            throw new ArgumentException($"Cannot prepare more than {max} recommendations at once.", nameof(recommendationIds));

        await using var ctx = _contextFactory.CreateContext();

        // Eligible recommendations: Pending or Approved (not yet Ordered/Dismissed/Superseded).
        var recs = await ctx.ReplenishmentRecommendations
            .Where(r => recommendationIds.Contains(r.Id)
                        && (r.Status == ReplenishmentStatus.Pending || r.Status == ReplenishmentStatus.Approved))
            .ToListAsync(ct);

        if (recs.Count == 0)
            throw new InvalidOperationException(
                "Aucune recommandation éligible (Pending ou Approved) pour les identifiants fournis.");

        var actor = GetUserId();

        // ─── Step 1: approve still-Pending recos (idempotent — fix F-M1) ──────────
        foreach (var rec in recs.Where(r => r.Status == ReplenishmentStatus.Pending))
        {
            var from = rec.Status;
            rec.Approve(actor);
            // Phase 2 review M3: only audit on actual transition.
            if (from != rec.Status)
                ctx.ReplenishmentDecisionAudits.Add(
                    ReplenishmentDecisionAudit.Create(rec.Id, from, rec.Status, "Approve", actor));
        }

        // ─── Step 2: short-circuit when auto-creation is disabled ─────────────────
        if (!_options.Replenishment.AutoCreatePurchaseOrders)
        {
            await ctx.SaveChangesAsync(ct);  // Persist the approvals + audit rows only.
            return new CreatePurchaseOrdersResultDto(
                CreatedPurchaseOrdersCount: 0,
                LinkedRecommendationsCount: 0,
                TotalEstimatedQty: recs.Sum(r => r.GetEffectiveOrderQty()),
                CreatedPurchaseOrders: Array.Empty<CreatedPurchaseOrderDto>(),
                Warnings: new[] { "Création automatique de BC désactivée (AutoCreatePurchaseOrders=false). Recommandations approuvées sans BC réel." },
                UnlinkedRecommendationIds: Array.Empty<Guid>());
        }

        // ─── Step 3: load Products + Suppliers in the SAME DbContext (fix C1) ─────
        // The factory used to spin up its own context and persist POs with its own SaveChanges,
        // leaving the link mutations on the service-side recs in a separate transaction.
        // Now we load everything here and pass the materialised dictionaries to the factory.
        var productIds = recs.Select(r => r.ProductId).Distinct().ToList();
        var supplierIds = recs
            .Select(r => r.GetEffectiveSupplierId())
            .Where(s => s.HasValue)
            .Select(s => s!.Value)
            .Distinct()
            .ToList();

        var products = await ctx.Products
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, ct);
        var suppliers = await ctx.Suppliers
            .Where(s => supplierIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, ct);

        var priceByRecId = BuildUnitPriceMap(recs, linePrices);

        // ─── Step 4: build POs (no persistence) ───────────────────────────────────
        // M3: the factory reserves each BC number through the atomic unified numbering
        // service (IDocumentNumberService), which requires the tenant id.
        var tenantId = _currentUser.TenantId
            ?? throw new InvalidOperationException("Tenant courant introuvable pour la création des bons de commande.");
        var batch = await _poFactory.BuildDraftPurchaseOrdersAsync(
            recs, products, suppliers, priceByRecId, actor, tenantId, ct);

        // ─── Step 5: attach + link + audit in the service's DbContext ─────────────
        foreach (var draft in batch.Drafts)
        {
            ctx.PurchaseOrders.Add(draft.PurchaseOrder);

            foreach (var recId in draft.RecommendationIds)
            {
                var rec = recs.First(r => r.Id == recId);
                var fromStatus = rec.Status;
                rec.LinkToPurchaseOrder(draft.PurchaseOrder.Id, actor);
                ctx.ReplenishmentDecisionAudits.Add(
                    ReplenishmentDecisionAudit.Create(
                        rec.Id, fromStatus, rec.Status, "LinkPO", actor,
                        payloadJson: JsonSerializer.Serialize(new
                        {
                            poId = draft.PurchaseOrder.Id,
                            poNumber = draft.PurchaseOrder.Number.Value
                        })));
            }
        }

        // ─── Step 6: ONE atomic SaveChanges for POs + recs + audit rows ───────────
        await ctx.SaveChangesAsync(ct);

        var createdDtos = batch.Drafts.Select(d => new CreatedPurchaseOrderDto(
            PurchaseOrderId: d.PurchaseOrder.Id,
            PurchaseOrderNumber: d.PurchaseOrder.Number.Value,
            SupplierId: d.PurchaseOrder.SupplierId,
            SupplierName: d.PurchaseOrder.Supplier.Name,
            LinesCount: d.RecommendationIds.Count,
            TotalAmount: d.PurchaseOrder.TotalAmount.Amount,
            RecommendationIds: d.RecommendationIds)).ToList();

        var linkedTotal = batch.Drafts.Sum(d => d.RecommendationIds.Count);
        var totalQty = batch.Drafts
            .SelectMany(d => d.RecommendationIds)
            .Select(id => recs.First(r => r.Id == id).GetEffectiveOrderQty())
            .Sum();

        return new CreatePurchaseOrdersResultDto(
            CreatedPurchaseOrdersCount: batch.Drafts.Count,
            LinkedRecommendationsCount: linkedTotal,
            TotalEstimatedQty: totalQty,
            CreatedPurchaseOrders: createdDtos,
            Warnings: batch.Warnings,
            UnlinkedRecommendationIds: batch.UnlinkedRecommendationIds);
    }

    // ───────────────────────────── Export ─────────────────────────────────

    public async Task<(byte[] Bytes, string FileName, string ContentType)> ExportAsync(
        ReplenishmentFiltersDto filters,
        string format,
        CancellationToken ct = default)
    {
        var paged = await GetRecommendationsAsync(filters with { Page = 1, PageSize = 1000 }, ct);

        format = (format ?? "csv").Trim().ToLowerInvariant();
        if (format != "csv")
            throw new NotSupportedException($"Format d'export non supporté : {format} (csv uniquement en V1 de l'export).");

        var sb = new StringBuilder();
        sb.AppendLine(string.Join(';', new[]
        {
            "Code","Nom","Entrepôt","Stock","On Order","Effective","ROP","Qté recommandée","Qté manuelle",
            "Fournisseur","Lead time (j)","Demande quotidienne","Jours de stock restants","Statut","Urgence","Raisons","Notes","Date génération"
        }));
        foreach (var i in paged.Items)
        {
            sb.AppendLine(string.Join(';', new[]
            {
                Csv(i.ProductCode),
                Csv(i.ProductName),
                Csv(i.WarehouseName),
                Csv(i.CurrentStockOnHand),
                Csv(i.QuantityOnOrder),
                Csv(i.EffectiveQty),
                Csv(i.Rop),
                Csv(i.RecommendedQty),
                Csv(i.ManualQtyOverride),
                Csv(i.PreferredSupplierName ?? ""),
                Csv(i.LeadTimeDays),
                Csv(i.DailyDemand),
                Csv(i.DaysOfStockRemaining),
                Csv(i.Status.ToString()),
                Csv(i.UrgencyLevel),
                Csv(string.Join("|", i.ReasonCodes)),
                Csv(i.UserNotes ?? ""),
                Csv(i.GeneratedAt.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture))
            }));
        }
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        var fileName = $"replenishment-{DateTime.UtcNow:yyyyMMdd-HHmm}.csv";
        return (bytes, fileName, "text/csv; charset=utf-8");
    }

    // ───────────────────────────── Helpers ────────────────────────────────

    private string GetUserId() => _currentUser.UserId?.ToString() ?? "system";

    private async Task<List<ReplenishmentRecommendationDto>> MapRowsAsync(
        TenantDbContext ctx,
        IReadOnlyList<ReplenishmentRecommendation> rows,
        CancellationToken ct)
    {
        var v2 = _options.Replenishment;
        // Distinct() — multiple recos for the same (product, warehouse) are possible across statuses;
        // keep the parameter list as tight as possible so the WHERE IN clause stays sargable.
        var productIds = rows.Select(r => r.ProductId).Distinct().ToList();
        var warehouseIds = rows.Select(r => r.WarehouseId).Distinct().ToList();

        var products = await ctx.Products
            .Where(p => productIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Code, p.Name, p.Unit, PurchasePriceAmount = p.PurchasePrice != null ? (decimal?)p.PurchasePrice.Amount : null })
            .ToDictionaryAsync(x => x.Id, ct);
        var warehouses = await ctx.Warehouses
            .Where(w => warehouseIds.Contains(w.Id))
            .Select(w => new { w.Id, w.Name })
            .ToDictionaryAsync(x => x.Id, ct);
        var stocks = await ctx.StockItems
            .Where(s => productIds.Contains(s.ProductId) && warehouseIds.Contains(s.WarehouseId))
            .ToListAsync(ct);
        var stockMap = stocks.ToDictionary(s => (s.ProductId, s.WarehouseId), s => s.QuantityOnHand);

        return rows.Select(r =>
        {
            products.TryGetValue(r.ProductId, out var p);
            warehouses.TryGetValue(r.WarehouseId, out var w);
            stockMap.TryGetValue((r.ProductId, r.WarehouseId), out var qty);
            var urgency = ComputeUrgency(qty, r.DaysOfStockRemaining, r.LeadTimeDays, v2.UrgencyThresholdDays);

            return new ReplenishmentRecommendationDto(
                r.Id, r.ProductId, p?.Code ?? "?", p?.Name ?? "?",
                r.WarehouseId, w?.Name ?? "?",
                r.GeneratedAt, qty, r.RecommendedQty, r.Rop, r.SafetyStock, r.LeadTimeDays, r.DailyDemand,
                ParseReasonCodes(r.ReasonCodesJson),
                r.Status, r.LinkedPurchaseOrderId, r.ProcessedAt,
                p?.Unit,
                r.PreferredSupplierId,
                r.PreferredSupplierName,
                r.QuantityOnOrder,
                r.EffectiveQty,
                r.ManualQtyOverride,
                r.ManualSupplierOverride,
                r.DaysOfStockRemaining,
                r.UserNotes,
                urgency,
                p?.PurchasePriceAmount);
        }).ToList();
    }

    /// <summary>
    /// Validates client-supplied unit prices for recommendations that can become PO lines
    /// (resolved supplier + positive effective qty).
    /// </summary>
    private static Dictionary<Guid, Money> BuildUnitPriceMap(
        IReadOnlyList<ReplenishmentRecommendation> recs,
        IReadOnlyList<CreatePurchaseOrderLinePriceDto>? linePrices)
    {
        var submitted = (linePrices ?? Array.Empty<CreatePurchaseOrderLinePriceDto>())
            .GroupBy(p => p.RecommendationId)
            .ToDictionary(g => g.Key, g => g.Last().UnitPrice);

        var map = new Dictionary<Guid, Money>();
        foreach (var rec in recs)
        {
            var supplierId = rec.GetEffectiveSupplierId();
            var qty = rec.GetEffectiveOrderQty();
            if (supplierId is null || qty <= 0)
                continue;

            if (!submitted.TryGetValue(rec.Id, out var amount) || amount <= 0)
                throw new ArgumentException(
                    $"Prix unitaire manquant ou invalide pour la recommandation {rec.Id}.");

            map[rec.Id] = Money.Create(amount, Currency);
        }

        return map;
    }

    private static string ComputeUrgency(decimal onHand, decimal? daysOfStock, int leadTimeDays, int threshold)
    {
        if (onHand <= 0) return "OutOfStock";
        if (daysOfStock is { } d)
        {
            if (d < threshold) return "Urgent";
            if (d < leadTimeDays * 2) return "Warning";
        }
        return "Normal";
    }

    private static IReadOnlyList<string> ParseReasonCodes(string json)
    {
        try
        {
            var arr = JsonSerializer.Deserialize<List<string>>(json);
            return arr ?? new List<string>();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static string Csv(object? value)
    {
        if (value is null) return "";
        string s = value is IFormattable f
            ? f.ToString(null, CultureInfo.InvariantCulture)
            : value.ToString() ?? "";
        if (s.Contains(';') || s.Contains('"') || s.Contains('\n'))
            s = "\"" + s.Replace("\"", "\"\"") + "\"";
        return s;
    }

    /// <summary>Snapshot of a stock item with the joined product fields needed for V2 generation.</summary>
    private sealed record StockItemSnapshot(
        Guid ProductId,
        Guid WarehouseId,
        decimal QuantityOnHand,
        decimal MinimumStock,
        decimal? MaximumStock,
        string? ProductCategoryName,
        Guid? PreferredSupplierId,
        decimal? MinimumOrderQuantity,
        decimal? PackagingQty,
        int? LeadTimeDaysOverride);
}
