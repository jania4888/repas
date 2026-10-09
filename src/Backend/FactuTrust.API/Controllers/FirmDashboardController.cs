using System.Security.Claims;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/firm/dashboard")]
[Authorize(Roles = $"{nameof(UserRole.FirmManager)},{nameof(UserRole.FirmAccountant)}")]
// Ceinture : le tableau de bord cabinet lit le tenant du CABINET (claim tenant_id). Sous un jeton
// positionne sur un dossier client, il servait les donnees de tout le cabinet. Le middleware ferme
// deja la zone ; cette politique le dit aussi au niveau du point d'entree.
[Authorize(Policy = Authorization.PermissionPolicies.FirmNativeContext)]
[Filters.RequireAccountingFirmsFeature]
public sealed class FirmDashboardController : ControllerBase
{
    private readonly IFirmDashboardService _dashboardService;
    private readonly IFirmDecisionTablesService _decisionTablesService;

    public FirmDashboardController(
        IFirmDashboardService dashboardService,
        IFirmDecisionTablesService decisionTablesService)
    {
        _dashboardService = dashboardService;
        _decisionTablesService = decisionTablesService;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<FirmDashboardDto>>> GetDashboard(CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var dashboard = await _dashboardService.GetDashboardAsync(tenantId.Value, cancellationToken);
        return Ok(ApiResponse<FirmDashboardDto>.Ok(dashboard));
    }

    [HttpGet("decision-tables")]
    [Authorize(Roles = nameof(UserRole.FirmManager))]
    public async Task<ActionResult<ApiResponse<FirmDecisionTablesDto>>> GetDecisionTables(CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var tables = await _decisionTablesService.GetDecisionTablesAsync(tenantId.Value, cancellationToken);
        return Ok(ApiResponse<FirmDecisionTablesDto>.Ok(tables));
    }

    private Guid? GetHomeTenantId()
    {
        var claim = User.FindFirstValue("tenant_id");
        return Guid.TryParse(claim, out var id) ? id : null;
    }
}
