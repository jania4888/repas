using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Forecasting;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Forecasting.Dtos;
using FactuTrust.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Module Prévisions IA — endpoints REST déterministes pour CA, demande produit, réapprovisionnement,
/// promotions, classification ABC/XYZ et calendrier commercial tunisien.
/// Tous les calculs viennent de StatisticalForecasting et du calendrier embarqué.
/// </summary>
[ApiController]
[Route("api/forecasting")]
[Authorize]
public class ForecastingController : ControllerBase
{
    private readonly IForecastingService _forecasting;
    private readonly IReplenishmentService _replenishment;
    private readonly IPromotionRecommendationService _promotions;
    private readonly IAbcXyzClassifier _classifier;
    private readonly ITunisianCalendarService _calendar;
    private readonly IForecastRecomputeOrchestrator _orchestrator;
    private readonly ICurrentUser _currentUser;
    private readonly ForecastingOptions _options;

    public ForecastingController(
        IForecastingService forecasting,
        IReplenishmentService replenishment,
        IPromotionRecommendationService promotions,
        IAbcXyzClassifier classifier,
        ITunisianCalendarService calendar,
        IForecastRecomputeOrchestrator orchestrator,
        ICurrentUser currentUser,
        IOptions<ForecastingOptions> options)
    {
        _forecasting = forecasting;
        _replenishment = replenishment;
        _promotions = promotions;
        _classifier = classifier;
        _calendar = calendar;
        _orchestrator = orchestrator;
        _currentUser = currentUser;
        _options = options.Value;
    }

    private IActionResult GuardEnabled()
    {
        if (!_options.Enabled)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, ApiResponse<object>.Fail(
                "Le module Prévisions IA est désactivé. Activez Features:Forecasting:Enabled pour ce tenant."));
        return null!;
    }

    /// <summary>
    /// Standardised exception-to-HTTP mapping for the V2 endpoints (Phase 3 review).
    /// Service-layer exceptions used to bubble up as raw HTTP 500 — this helper translates
    /// them into the canonical 4xx counterparts so the front can render the right toast.
    /// </summary>
    /// <remarks>
    /// Heuristic on the message keeps the mapping pragmatic without forcing the service to
    /// expose typed exceptions yet. A future iteration can replace this with dedicated
    /// exception types (NotFoundException, ConflictException) if the surface grows.
    /// </remarks>
    private IActionResult MapServiceException(Exception ex) => ex switch
    {
        ArgumentException                                             => BadRequest(ApiResponse<object>.Fail(ex.Message, "InvalidArgument")),
        InvalidOperationException when LooksLikeNotFound(ex.Message)  => NotFound(ApiResponse<object>.Fail(ex.Message, "NotFound")),
        InvalidOperationException                                     => Conflict(ApiResponse<object>.Fail(ex.Message, "InvalidState")),
        NotSupportedException                                         => BadRequest(ApiResponse<object>.Fail(ex.Message, "NotSupported")),
        _ => throw ex
    };

    private static bool LooksLikeNotFound(string message) =>
        message.Contains("not found", StringComparison.OrdinalIgnoreCase)
        || message.Contains("introuvable", StringComparison.OrdinalIgnoreCase);

    // ────────────────────── Revenue forecast ──────────────────────────────

    [HttpGet("revenue")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<SalesForecastDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetRevenueForecast(
        [FromQuery] ForecastScopeType scope = ForecastScopeType.Global,
        [FromQuery] Guid? scopeId = null,
        [FromQuery] ForecastHorizon horizon = ForecastHorizon.Month,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;

        // Validation amont : scopeId obligatoire pour tout scope autre que Global.
        // Évite de lancer une exception côté service et fournit un message FR clair à l'UI.
        if (scope != ForecastScopeType.Global && (scopeId is null || scopeId == Guid.Empty))
        {
            var label = scope switch
            {
                ForecastScopeType.Category  => "Catégorie",
                ForecastScopeType.Product   => "Produit",
                ForecastScopeType.Warehouse => "Entrepôt",
                ForecastScopeType.Client    => "Client",
                _ => scope.ToString()
            };
            return BadRequest(ApiResponse<SalesForecastDto>.Fail(
                $"Veuillez sélectionner un(e) {label} avant de calculer la prévision.",
                "ScopeIdRequired"));
        }

        var dto = await _forecasting.ForecastRevenueAsync(scope, scopeId, horizon, from, to, ct);
        return Ok(ApiResponse<SalesForecastDto>.Ok(dto));
    }

    [HttpGet("product-demand/{productId:guid}")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<ProductDemandForecastDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProductDemandForecast(
        Guid productId,
        [FromQuery] ForecastHorizon horizon = ForecastHorizon.Month,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _forecasting.ForecastProductDemandAsync(productId, horizon, ct);
        return Ok(ApiResponse<ProductDemandForecastDto>.Ok(dto));
    }

    // ────────────────────── Replenishment ─────────────────────────────────
    // V1 endpoints have been removed in the 2026-05-13 cutover — V2 is the only flavour.
    // The legacy URLs (no /v2 suffix) are kept by the V2 routes below; the controller now
    // exposes a single canonical surface backed by ReplenishmentService.

    [HttpGet("replenishment")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<ReplenishmentRecommendationDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> GetReplenishment(
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] Guid? supplierId = null,
        [FromQuery] ReplenishmentStatus? status = null,
        [FromQuery] string? search = null,
        [FromQuery] string? urgencyLevel = null,
        [FromQuery] DateTime? fromGeneratedAt = null,
        [FromQuery] DateTime? toGeneratedAt = null,
        [FromQuery] string? orderBy = null,
        [FromQuery] bool orderDesc = true,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var filters = new ReplenishmentFiltersDto(
            warehouseId, supplierId, status, search, urgencyLevel,
            fromGeneratedAt, toGeneratedAt, orderBy, orderDesc, page, pageSize);
        var paged = await _replenishment.GetRecommendationsAsync(filters, ct);
        return Ok(ApiResponse<PagedResult<ReplenishmentRecommendationDto>>.Ok(paged));
    }

    [HttpPost("replenishment/{id:guid}/approve")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<ReplenishmentRecommendationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> ApproveReplenishment(Guid id, CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        try
        {
            var dto = await _replenishment.ApproveAsync(id, ct);
            return Ok(ApiResponse<ReplenishmentRecommendationDto>.Ok(dto, "Recommandation approuvée."));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return MapServiceException(ex);
        }
    }

    [HttpPost("replenishment/{id:guid}/dismiss")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<ReplenishmentRecommendationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> DismissReplenishment(
        Guid id,
        [FromBody] DismissReplenishmentRequestDto body,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        if (body is null || string.IsNullOrWhiteSpace(body.Reason))
            return BadRequest(ApiResponse<object>.Fail(
                "La raison du rejet est obligatoire.", "ReasonRequired"));
        try
        {
            var dto = await _replenishment.DismissAsync(id, body.Reason, ct);
            return Ok(ApiResponse<ReplenishmentRecommendationDto>.Ok(dto, "Recommandation écartée."));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return MapServiceException(ex);
        }
    }

    [HttpPost("replenishment/{id:guid}/override")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<ReplenishmentRecommendationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> OverrideReplenishment(
        Guid id,
        [FromBody] OverrideReplenishmentRequestDto body,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        // Phase 3 review P3-m1: explicit null guard. A missing body is a client mistake — refuse
        // rather than silently clear both overrides.
        if (body is null)
            return BadRequest(ApiResponse<object>.Fail(
                "Un corps de requête est requis (manualQty et/ou manualSupplierId).", "BodyRequired"));
        try
        {
            var dto = await _replenishment.OverrideAsync(id, body.ManualQty, body.ManualSupplierId, ct);
            return Ok(ApiResponse<ReplenishmentRecommendationDto>.Ok(dto, "Override appliqué."));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return MapServiceException(ex);
        }
    }

    [HttpPost("replenishment/{id:guid}/undo")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<ReplenishmentRecommendationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> UndoReplenishment(Guid id, CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        try
        {
            var dto = await _replenishment.UndoLastDecisionAsync(id, ct);
            return Ok(ApiResponse<ReplenishmentRecommendationDto>.Ok(dto, "Décision annulée."));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return MapServiceException(ex);
        }
    }

    [HttpPost("replenishment/{id:guid}/notes")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<ReplenishmentRecommendationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> AttachNotes(
        Guid id,
        [FromBody] AttachNotesRequestDto body,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        try
        {
            var dto = await _replenishment.AttachNotesAsync(id, body?.Notes, ct);
            return Ok(ApiResponse<ReplenishmentRecommendationDto>.Ok(dto, "Notes enregistrées."));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return MapServiceException(ex);
        }
    }

    [HttpPost("replenishment/create-purchase-orders")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<CreatePurchaseOrdersResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> CreatePurchaseOrders(
        [FromBody] CreatePurchaseOrdersRequestDto body,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        if (body is null || body.RecommendationIds is null || body.RecommendationIds.Count == 0)
            return BadRequest(ApiResponse<object>.Fail(
                "Au moins une recommandation est requise.", "RecommendationIdsRequired"));
        try
        {
            var dto = await _replenishment.CreatePurchaseOrdersAsync(
                body.RecommendationIds, body.LinePrices, ct);
            string msg;
            if (dto.CreatedPurchaseOrdersCount == 0)
            {
                msg = dto.UnlinkedRecommendationIds.Count > 0
                    ? $"Aucun bon de commande créé : {dto.UnlinkedRecommendationIds.Count} recommandation(s) sans fournisseur. Assignez un fournisseur puis réessayez."
                    : "Aucun bon de commande créé (vérifiez les avertissements).";
            }
            else
            {
                msg = $"{dto.CreatedPurchaseOrdersCount} bon(s) de commande créé(s), {dto.LinkedRecommendationsCount} recommandation(s) liée(s).";
            }
            return Ok(ApiResponse<CreatePurchaseOrdersResultDto>.Ok(dto, msg));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return MapServiceException(ex);
        }
    }

    [HttpPost("replenishment/generate")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<int>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> GenerateReplenishment(
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] Guid? productId = null,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var count = await _replenishment.GenerateRecommendationsAsync(warehouseId, productId, ct);
        return Ok(ApiResponse<int>.Ok(count, $"{count} recommandation(s) générée(s)."));
    }

    [HttpGet("replenishment/{id:guid}/history")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ReplenishmentDecisionAuditDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> GetReplenishmentHistory(Guid id, CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var rows = await _replenishment.GetHistoryAsync(id, ct);
        return Ok(ApiResponse<IReadOnlyList<ReplenishmentDecisionAuditDto>>.Ok(rows));
    }

    [HttpGet("replenishment/kpi")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<ReplenishmentKpiDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> GetReplenishmentKpi(
        [FromQuery] Guid? warehouseId = null,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _replenishment.GetKpiAsync(warehouseId, ct);
        return Ok(ApiResponse<ReplenishmentKpiDto>.Ok(dto));
    }

    [HttpGet("replenishment/export")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> ExportReplenishment(
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] Guid? supplierId = null,
        [FromQuery] ReplenishmentStatus? status = null,
        [FromQuery] string? search = null,
        [FromQuery] string? urgencyLevel = null,
        [FromQuery] DateTime? fromGeneratedAt = null,
        [FromQuery] DateTime? toGeneratedAt = null,
        [FromQuery] string format = "csv",
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        try
        {
            var filters = new ReplenishmentFiltersDto(
                warehouseId, supplierId, status, search, urgencyLevel,
                fromGeneratedAt, toGeneratedAt);
            var (bytes, fileName, contentType) = await _replenishment.ExportAsync(filters, format, ct);
            return File(bytes, contentType, fileName);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return MapServiceException(ex);
        }
    }

    // ────────────────────── Promotions ────────────────────────────────────

    [HttpGet("promotions")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<PromotionRecommendationDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPromotions(
        [FromQuery] Guid? productId = null,
        [FromQuery] Guid? categoryId = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var paged = await _promotions.GetActiveAsync(productId, categoryId, from, to, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<PromotionRecommendationDto>>.Ok(paged));
    }

    [HttpPost("promotions/simulate")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<PromotionSimulationResultDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SimulatePromotion([FromBody] PromotionSimulationRequestDto body, CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _promotions.SimulateAsync(body.ProductId, body.DiscountPercent, body.DurationDays, ct);
        return Ok(ApiResponse<PromotionSimulationResultDto>.Ok(dto));
    }

    [HttpPost("promotions/{id:guid}/prepare-discount")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<PreparePromotionDraftResultDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> PrepareDiscountDraft(Guid id, CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _promotions.PrepareDiscountDraftAsync(id, ct);
        return Ok(ApiResponse<PreparePromotionDraftResultDto>.Ok(dto, dto.Notes));
    }

    [HttpPost("promotions/{id:guid}/dismiss")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DismissPromotion(Guid id, CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        await _promotions.DismissAsync(id, ct);
        return NoContent();
    }

    [HttpPost("promotions/generate")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<int>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GeneratePromotionsNow([FromQuery] int? horizonDays = null, CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var count = await _promotions.GenerateAsync(horizonDays ?? _options.DefaultHorizonDays, ct);
        return Ok(ApiResponse<int>.Ok(count, $"{count} recommandation(s) promotionnelle(s) générée(s)."));
    }

    // ────────────────────── ABC / XYZ ─────────────────────────────────────

    [HttpGet("abc-xyz")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<AbcXyzMatrixDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAbcXyzMatrix(
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] AbcClass? abcClass = null,
        [FromQuery] XyzClass? xyzClass = null,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _classifier.GetMatrixAsync(warehouseId, abcClass, xyzClass, ct);
        return Ok(ApiResponse<AbcXyzMatrixDto>.Ok(dto));
    }

    [HttpPost("abc-xyz/recompute")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<int>), StatusCodes.Status200OK)]
    public async Task<IActionResult> RecomputeAbcXyz(CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var count = await _classifier.ClassifyAsync(ct);
        return Ok(ApiResponse<int>.Ok(count, $"{count} produit(s) classifié(s)."));
    }

    // ────────────────────── Calendar ──────────────────────────────────────

    [HttpGet("calendar")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<CalendarEventDto>>), StatusCodes.Status200OK)]
    public IActionResult GetCalendar([FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
    {
        if (GuardEnabled() is { } guard) return guard;
        var start = from ?? DateTime.UtcNow.Date;
        var end = to ?? start.AddDays(60);
        var events = _calendar.GetEvents(start, end)
            .Select(e => new CalendarEventDto(e.Code, e.DisplayName, e.StartDate, e.EndDate, e.IsHoliday, e.IsCommercialWindow, e.Category))
            .ToList();
        return Ok(ApiResponse<IReadOnlyList<CalendarEventDto>>.Ok(events));
    }

    // ────────────────────── Seasonal impact ───────────────────────────────

    [HttpGet("seasonal-impact")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<SeasonalImpactDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSeasonalImpact(
        [FromQuery] Guid? productId = null,
        [FromQuery] Guid? categoryId = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var start = from ?? DateTime.UtcNow.Date;
        var end = to ?? start.AddDays(30);
        var dto = await _forecasting.AnalyzeSeasonalImpactAsync(productId, categoryId, start, end, ct);
        return Ok(ApiResponse<SeasonalImpactDto>.Ok(dto));
    }

    // ────────────────────── Recompute (manual) ────────────────────────────

    [HttpPost("recompute")]
    [Authorize(Policy = PermissionPolicies.ForecastingManage)]
    [ProducesResponseType(typeof(ApiResponse<RecomputeResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status429TooManyRequests)]
    public async Task<IActionResult> RecomputeAll(CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        try
        {
            var dto = await _orchestrator.RecomputeAsync("Manual", _currentUser.UserId?.ToString(), ct);
            return Ok(ApiResponse<RecomputeResultDto>.Ok(dto, dto.Success ? "Recalcul terminé." : dto.ErrorMessage));
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, ApiResponse<object>.Fail(ex.Message));
        }
    }

    [HttpGet("recompute-audit")]
    [Authorize(Policy = PermissionPolicies.ForecastingView)]
    [ProducesResponseType(typeof(ApiResponse<RecomputeAuditDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetRecomputeAudit(CancellationToken ct = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _orchestrator.GetLastAuditAsync(ct);
        return Ok(new ApiResponse<RecomputeAuditDto>
        {
            Success = true,
            Data = dto,
            Message = null
        });
    }
}
