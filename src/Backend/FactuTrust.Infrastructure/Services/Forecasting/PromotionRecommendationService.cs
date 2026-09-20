using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Forecasting;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Forecasting.Dtos;
using FactuTrust.Domain.Entities.Forecasting;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Forecasting;

/// <summary>
/// Generates promotion recommendations from deterministic, scored rules:
///  • Dormants > N days + stock > 0 → Destockage
///  • Stock-on-hand > MaximumStock × OverstockMultiplier → Surstock
///  • ABC×XYZ class CZ → CrossSell candidate
///  • ABC×XYZ class AX during a pre-peak window → PrePic (no discount)
///  • Calendar window match (Ramadan, Aïd, Soldes, Rentrée…) → Saisonnier
/// PrepareDiscountDraftAsync only marks the recommendation Accepted; the actual catalog discount
/// is created by the user from the UI dialog (Génération auto avec confirmation).
/// </summary>
public sealed class PromotionRecommendationService : IPromotionRecommendationService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ITunisianCalendarService _calendar;
    private readonly IForecastingService _forecasting;
    private readonly ICurrentUser _currentUser;
    private readonly ForecastingOptions _options;
    private readonly ILogger<PromotionRecommendationService> _logger;

    public PromotionRecommendationService(
        ITenantDbContextFactory contextFactory,
        ITunisianCalendarService calendar,
        IForecastingService forecasting,
        ICurrentUser currentUser,
        IOptions<ForecastingOptions> options,
        ILogger<PromotionRecommendationService> logger)
    {
        _contextFactory = contextFactory;
        _calendar = calendar;
        _forecasting = forecasting;
        _currentUser = currentUser;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<int> GenerateAsync(int horizonDays, CancellationToken ct = default)
    {
        if (!_options.Enabled) return 0;
        if (horizonDays < 7) horizonDays = 7;
        if (horizonDays > 90) horizonDays = 90;

        await using var ctx = _contextFactory.CreateContext();
        var today = DateTime.UtcNow.Date;
        var validUntil = today.AddDays(horizonDays);

        // Mark previously Pending recommendations whose ValidUntil has passed as Expired.
        var stale = await ctx.PromotionRecommendations
            .Where(p => p.Status == PromotionRecommendationStatus.Pending && p.ValidUntil < today)
            .ToListAsync(ct);
        foreach (var s in stale) s.MarkExpired();

        // 1) Dormant + stock > 0 → Destockage
        var dormantSince = today.AddDays(-_options.DormantProductDays);
        var soldRecently = await ctx.InvoiceLines
            .Where(il => il.Invoice.IssueDate >= dormantSince
                         && il.Invoice.Status != InvoiceStatus.Draft
                         && il.Invoice.Status != InvoiceStatus.Cancelled)
            .Select(il => il.ProductId)
            .Distinct()
            .ToListAsync(ct);
        var soldRecentlySet = soldRecently.ToHashSet();

        // StockItem has no Product navigation in V1 — manual join with Products + Category.
        var stockedProducts = await (
            from s in ctx.StockItems
            join p in ctx.Products on s.ProductId equals p.Id
            where s.QuantityOnHand > 0 && p.IsStockManaged
            select new
            {
                s.ProductId,
                s.QuantityOnHand,
                MaximumStock = s.MaximumStock ?? 0m,
                ProductName = p.Name,
                ProductCode = p.Code,
                CategoryId = p.CategoryId,
                CategoryName = p.Category != null ? p.Category.Name : null
            }).ToListAsync(ct);

        var generated = 0;

        // Destockage rule: dormant + stocked + stock > 0
        foreach (var sp in stockedProducts.Where(sp => !soldRecentlySet.Contains(sp.ProductId)))
        {
            // Avoid duplicates: skip if a Pending Destockage already exists for this product.
            var alreadyHas = await ctx.PromotionRecommendations
                .AnyAsync(p => p.ProductId == sp.ProductId
                               && p.Type == PromotionRecommendationType.Destockage
                               && p.Status == PromotionRecommendationStatus.Pending, ct);
            if (alreadyHas) continue;

            // Graduated discount: 15% baseline, +5% per 30-day chunk of dormancy beyond threshold (cap at 30%).
            var discount = 15m;
            // Approximate by stock level: bigger stock relative to max → bigger discount.
            if (sp.MaximumStock > 0 && sp.QuantityOnHand > sp.MaximumStock)
                discount = Math.Min(30m, 15m + 5m * Math.Floor((sp.QuantityOnHand - sp.MaximumStock) / Math.Max(1, sp.MaximumStock) * 5m));
            ctx.PromotionRecommendations.Add(PromotionRecommendation.Create(
                sp.ProductId, null,
                PromotionRecommendationType.Destockage,
                discount, expectedUpliftPercent: 25m,
                today, validUntil,
                $"Article dormant depuis plus de {_options.DormantProductDays} jours, stock disponible {Math.Round(sp.QuantityOnHand, 2)} unités.",
                JsonSerializer.Serialize(new[] { $"Dormant{_options.DormantProductDays}d", "InStock" })));
            generated++;
        }

        // Surstock rule: stock > maxStock × overstockMultiplier
        foreach (var sp in stockedProducts.Where(sp =>
                     sp.MaximumStock > 0 && sp.QuantityOnHand > sp.MaximumStock * (decimal)_options.OverstockMultiplier))
        {
            var alreadyHas = await ctx.PromotionRecommendations
                .AnyAsync(p => p.ProductId == sp.ProductId
                               && p.Type == PromotionRecommendationType.Surstock
                               && p.Status == PromotionRecommendationStatus.Pending, ct);
            if (alreadyHas) continue;

            ctx.PromotionRecommendations.Add(PromotionRecommendation.Create(
                sp.ProductId, null,
                PromotionRecommendationType.Surstock,
                10m, 15m, today, validUntil,
                $"Surstock détecté : {Math.Round(sp.QuantityOnHand, 2)} unités vs. maximum {sp.MaximumStock}.",
                JsonSerializer.Serialize(new[] { "Overstock" })));
            generated++;
        }

        // 2) Calendar-driven seasonal recommendations per category
        var upcoming = _calendar.GetEvents(today, validUntil)
            .Where(e => e.IsCommercialWindow)
            .ToList();
        var categories = stockedProducts
            .Where(sp => sp.CategoryId != Guid.Empty && !string.IsNullOrEmpty(sp.CategoryName))
            .Select(sp => new { CategoryId = sp.CategoryId, CategoryName = sp.CategoryName! })
            .Distinct()
            .ToList();
        foreach (var cat in categories)
        {
            foreach (var ev in upcoming)
            {
                var factor = _calendar.GetSeasonalFactor(cat.CategoryName, ev.StartDate);
                if (factor <= 1.05) continue; // not significant
                var alreadyHas = await ctx.PromotionRecommendations
                    .AnyAsync(p => p.CategoryId == cat.CategoryId
                                   && p.Type == PromotionRecommendationType.Saisonnier
                                   && p.RelatedEventCode == ev.Code
                                   && p.Status == PromotionRecommendationStatus.Pending, ct);
                if (alreadyHas) continue;

                ctx.PromotionRecommendations.Add(PromotionRecommendation.Create(
                    null, cat.CategoryId,
                    PromotionRecommendationType.Saisonnier,
                    suggestedDiscountPercent: 0m,
                    expectedUpliftPercent: (decimal)((factor - 1) * 100),
                    ev.StartDate.AddDays(-15), ev.EndDate,
                    $"Catégorie « {cat.CategoryName} » : pic saisonnier prévu pour {ev.DisplayName}. Mise en avant + bundle plutôt que remise.",
                    JsonSerializer.Serialize(new[] { ev.Code, "SeasonalUplift" }),
                    relatedEventCode: ev.Code));
                generated++;
            }
        }

        // 3) Class CZ → CrossSell suggestion (low CA + erratic demand → bundle)
        // Correlated sub-query (latest ComputedAt per product) instead of GroupBy/First —
        // the original formulation triggered EF Core 8's "EmptyProjectionMember" translation
        // bug when followed by a Where on the projected entity.
        var classifications = await ctx.ProductAbcXyzClassifications
            .Where(c => c.AbcClass == AbcClass.C
                        && c.XyzClass == XyzClass.Z
                        && c.ComputedAt == ctx.ProductAbcXyzClassifications
                            .Where(c2 => c2.ProductId == c.ProductId)
                            .Max(c2 => c2.ComputedAt))
            .Take(50) // cap to keep recommendation lists actionable
            .ToListAsync(ct);
        foreach (var c in classifications)
        {
            var sp = stockedProducts.FirstOrDefault(s => s.ProductId == c.ProductId);
            if (sp is null) continue;
            var alreadyHas = await ctx.PromotionRecommendations
                .AnyAsync(p => p.ProductId == c.ProductId
                               && p.Type == PromotionRecommendationType.CrossSell
                               && p.Status == PromotionRecommendationStatus.Pending, ct);
            if (alreadyHas) continue;

            ctx.PromotionRecommendations.Add(PromotionRecommendation.Create(
                c.ProductId, null,
                PromotionRecommendationType.CrossSell,
                10m, 12m, today, validUntil,
                "Classe CZ (faible rotation, faible CA) — proposer en bundle avec un best-seller pour activer le panier.",
                JsonSerializer.Serialize(new[] { "ClassCZ", "BundleSuggested" })));
            generated++;
        }

        await ctx.SaveChangesAsync(ct);
        _logger.LogInformation("Promotion recommendations generated: {Count}.", generated);
        return generated;
    }

    public async Task<PagedResult<PromotionRecommendationDto>> GetActiveAsync(
        Guid? productId, Guid? categoryId, DateTime? periodStart, DateTime? periodEnd, int page, int pageSize, CancellationToken ct = default)
    {
        // 4.7 suite (R52, motif D-45-28) : borne haute pour que (page - 1) * pageSize reste un int.
        if (page < 1) page = 1; else if (page > int.MaxValue / 200) page = int.MaxValue / 200;
        if (pageSize < 1 || pageSize > 200) pageSize = 50;

        await using var ctx = _contextFactory.CreateContext();
        var q = ctx.PromotionRecommendations
            .Where(p => p.Status == PromotionRecommendationStatus.Pending
                        || p.Status == PromotionRecommendationStatus.Accepted);

        if (productId.HasValue) q = q.Where(p => p.ProductId == productId.Value);
        if (categoryId.HasValue) q = q.Where(p => p.CategoryId == categoryId.Value);
        if (periodStart.HasValue) q = q.Where(p => p.ValidUntil >= periodStart.Value);
        if (periodEnd.HasValue) q = q.Where(p => p.ValidFrom <= periodEnd.Value);

        var total = await q.CountAsync(ct);
        var rows = await q
            .OrderBy(p => p.ValidFrom)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(ct);

        var productIds = rows.Where(r => r.ProductId.HasValue).Select(r => r.ProductId!.Value).Distinct().ToList();
        var categoryIds = rows.Where(r => r.CategoryId.HasValue).Select(r => r.CategoryId!.Value).Distinct().ToList();
        var products = await ctx.Products
            .Where(p => productIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Code, p.Name })
            .ToDictionaryAsync(x => x.Id, ct);
        var categories = await ctx.ProductCategories
            .Where(c => categoryIds.Contains(c.Id))
            .Select(c => new { c.Id, c.Name })
            .ToDictionaryAsync(x => x.Id, ct);

        var items = rows.Select(r => new PromotionRecommendationDto(
            r.Id,
            r.ProductId,
            r.ProductId.HasValue && products.TryGetValue(r.ProductId.Value, out var p) ? p.Code : null,
            r.ProductId.HasValue && products.TryGetValue(r.ProductId.Value, out var pn) ? pn.Name : null,
            r.CategoryId,
            r.CategoryId.HasValue && categories.TryGetValue(r.CategoryId.Value, out var c) ? c.Name : null,
            r.GeneratedAt, r.Type, r.SuggestedDiscountPercent, r.ExpectedUpliftPercent,
            r.ValidFrom, r.ValidUntil, r.ReasoningSummary,
            ParseReasonCodes(r.ReasonCodesJson),
            r.Status, r.RelatedEventCode)).ToList();

        return new PagedResult<PromotionRecommendationDto>
        {
            Items = items, Page = page, PageSize = pageSize, TotalCount = total
        };
    }

    public async Task<PreparePromotionDraftResultDto> PrepareDiscountDraftAsync(Guid promotionRecommendationId, CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rec = await ctx.PromotionRecommendations.FirstOrDefaultAsync(p => p.Id == promotionRecommendationId, ct)
            ?? throw new InvalidOperationException("Promotion recommendation not found.");
        rec.Accept(_currentUser.UserId?.ToString() ?? "system");
        await ctx.SaveChangesAsync(ct);

        return new PreparePromotionDraftResultDto(
            rec.Id, rec.ProductId, rec.CategoryId, rec.SuggestedDiscountPercent,
            rec.ValidFrom, rec.ValidUntil,
            "Brouillon de remise préparé. Configurez la remise effective dans le catalogue puis activez-la.");
    }

    public async Task DismissAsync(Guid recommendationId, CancellationToken ct = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var rec = await ctx.PromotionRecommendations.FirstOrDefaultAsync(p => p.Id == recommendationId, ct)
            ?? throw new InvalidOperationException("Promotion recommendation not found.");
        rec.Dismiss(_currentUser.UserId?.ToString() ?? "system");
        await ctx.SaveChangesAsync(ct);
    }

    public Task<PromotionSimulationResultDto> SimulateAsync(Guid productId, decimal discountPercent, int durationDays, CancellationToken ct = default)
        => _forecasting.SimulatePromotionImpactAsync(productId, discountPercent, durationDays, ct);

    private static IReadOnlyList<string> ParseReasonCodes(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }
}
