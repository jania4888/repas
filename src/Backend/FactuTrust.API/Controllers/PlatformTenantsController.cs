using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Scripts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

/// <summary>Platform operator endpoints for tenant directory (master database).</summary>
[ApiController]
[Route("api/platform/tenants")]
[Authorize(Policy = PlatformPolicies.PlatformAdmin)]
public sealed class PlatformTenantsController : ControllerBase
{
    private readonly IPlatformTenantQueryService _tenantQuery;
    private readonly ISubscriptionAdminService _subscriptionAdmin;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<PlatformTenantsController> _logger;

    public PlatformTenantsController(
        IPlatformTenantQueryService tenantQuery,
        ISubscriptionAdminService subscriptionAdmin,
        IServiceProvider serviceProvider,
        ILogger<PlatformTenantsController> logger)
    {
        _tenantQuery = tenantQuery;
        _subscriptionAdmin = subscriptionAdmin;
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    [HttpGet("stats")]
    [ProducesResponseType(typeof(ApiResponse<PlatformTenantStatsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Stats(CancellationToken cancellationToken)
    {
        var stats = await _tenantQuery.GetStatsAsync(cancellationToken);
        return Ok(ApiResponse<PlatformTenantStatsDto>.Ok(stats));
    }

    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<PlatformTenantListPageDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List(
        [FromQuery] string? search,
        [FromQuery] string? segment,
        [FromQuery] int? plan,
        [FromQuery] int? subscriptionStatus,
        [FromQuery] bool? isActive,
        [FromQuery] int? taxRegime,
        [FromQuery] int? kind,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? sortBy = null,
        [FromQuery] string? sortDir = null,
        CancellationToken cancellationToken = default)
    {
        var query = new PlatformTenantListQuery
        {
            Search = search,
            Segment = segment,
            Plan = ParseEnum<SubscriptionPlan>(plan),
            SubscriptionStatus = ParseEnum<SubscriptionStatus>(subscriptionStatus),
            IsActive = isActive,
            TaxRegime = ParseEnum<TaxRegime>(taxRegime),
            Kind = ParseEnum<TenantKind>(kind),
            Page = page,
            PageSize = pageSize,
            SortBy = sortBy,
            SortDir = sortDir
        };
        var result = await _tenantQuery.ListAsync(query, cancellationToken);
        return Ok(ApiResponse<PlatformTenantListPageDto>.Ok(result));
    }

    [HttpGet("{tenantId:guid}")]
    [ProducesResponseType(typeof(ApiResponse<PlatformTenantDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(Guid tenantId, CancellationToken cancellationToken)
    {
        var detail = await _tenantQuery.GetDetailAsync(tenantId, cancellationToken);
        if (detail is null)
        {
            return NotFound(ApiResponse<PlatformTenantDetailDto>.Fail($"Tenant {tenantId} introuvable."));
        }

        bool hasMigrations;
        try
        {
            hasMigrations = await TenantMigrationHelper.HasMigrationsAppliedAsync(
                _serviceProvider,
                tenantId,
                cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read migration status for tenant {TenantId}", tenantId);
            hasMigrations = false;
        }

        return Ok(ApiResponse<PlatformTenantDetailDto>.Ok(detail with { HasMigrationsApplied = hasMigrations }));
    }

    [HttpPost("{tenantId:guid}/subscription/change")]
    [ProducesResponseType(typeof(ApiResponse<SubscriptionDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ChangeSubscription(
        Guid tenantId,
        [FromBody] ChangePlanRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponse<SubscriptionDto>.Fail("Requête invalide."));

        if (!Enum.TryParse<SubscriptionPlan>(request.Plan, ignoreCase: true, out var newPlan))
        {
            return BadRequest(ApiResponse<SubscriptionDto>.Fail(
                "Plan invalide. Valeurs acceptées : Free, Monthly, Annual"));
        }

        if (await _tenantQuery.GetDetailAsync(tenantId, cancellationToken) is null)
        {
            return NotFound(ApiResponse<SubscriptionDto>.Fail($"Tenant {tenantId} introuvable."));
        }

        var changeResult = await _subscriptionAdmin.ChangePlanAsync(tenantId, newPlan, cancellationToken);
        if (changeResult.IsFailure)
            return BadRequest(ApiResponse<SubscriptionDto>.Fail(changeResult.Error.Description));

        var dto = SubscriptionDtoMapper.ToDto(changeResult.Value);
        return Ok(ApiResponse<SubscriptionDto>.Ok(dto, "Forfait mis à jour avec succès"));
    }

    [HttpPost("{tenantId:guid}/subscription/cancel")]
    [ProducesResponseType(typeof(ApiResponse<SubscriptionDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CancelSubscription(
        Guid tenantId,
        [FromBody] CancelSubscriptionRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponse<SubscriptionDto>.Fail("Requête invalide."));

        if (await _tenantQuery.GetDetailAsync(tenantId, cancellationToken) is null)
        {
            return NotFound(ApiResponse<SubscriptionDto>.Fail($"Tenant {tenantId} introuvable."));
        }

        var cancelResult = await _subscriptionAdmin.CancelAsync(tenantId, request.Reason, cancellationToken);
        if (cancelResult.IsFailure)
        {
            if (cancelResult.Error.Code == "Subscription.NotFound")
                return NotFound(ApiResponse<SubscriptionDto>.Fail(cancelResult.Error.Description));
            return BadRequest(ApiResponse<SubscriptionDto>.Fail(cancelResult.Error.Description));
        }

        var dto = SubscriptionDtoMapper.ToDto(cancelResult.Value);
        return Ok(ApiResponse<SubscriptionDto>.Ok(dto, "Abonnement annulé"));
    }

    private static TEnum? ParseEnum<TEnum>(int? value) where TEnum : struct, Enum
    {
        if (value is null)
            return null;
        return Enum.IsDefined(typeof(TEnum), value.Value) ? (TEnum)(object)value.Value : null;
    }
}
