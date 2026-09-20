using FactuTrust.API.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Lecture du journal d'audit des actions d'administration <b>plateforme</b>.
///
/// <para>
/// À ne pas confondre avec <c>PlatformAuditController</c>, qui lit les journaux chaînés par
/// hachage <b>d'un tenant donné</b>. Ici, il s'agit des actions de l'opérateur plateforme
/// lui-même : création d'un dossier client, reprise de provisionnement — des actions qui, par
/// construction, précèdent l'existence de la base du tenant.
/// </para>
/// </summary>
[ApiController]
[Route("api/platform/audit/provisioning")]
[Authorize(Policy = PlatformPolicies.PlatformAdmin)]
public sealed class PlatformProvisioningAuditController : ControllerBase
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _masterContext;

    public PlatformProvisioningAuditController(MasterDbContext masterContext)
    {
        _masterContext = masterContext;
    }

    [HttpGet]
    [Authorize(Policy = "perm:" + PlatformPermissions.AuditRead)]
    [ProducesResponseType(typeof(ApiResponse<PlatformActionAuditPageDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List(
        [FromQuery] Guid? tenantId,
        [FromQuery] string? action,
        [FromQuery] string? outcome,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken cancellationToken = default)
    {
        var safePage = page < 1 ? 1 : page;
        var safePageSize = pageSize is < 1 or > MaxPageSize ? 50 : pageSize;

        var query = _masterContext.PlatformActionAuditEntries.AsNoTracking();

        if (tenantId is { } tid)
            query = query.Where(e => e.TargetTenantId == tid);

        if (!string.IsNullOrWhiteSpace(action))
            query = query.Where(e => e.Action == action);

        if (!string.IsNullOrWhiteSpace(outcome))
            query = query.Where(e => e.Outcome == outcome);

        if (from is { } fromUtc)
            query = query.Where(e => e.CreatedAtUtc >= fromUtc);

        if (to is { } toUtc)
            query = query.Where(e => e.CreatedAtUtc <= toUtc);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(e => e.CreatedAtUtc)
            .Skip((safePage - 1) * safePageSize)
            .Take(safePageSize)
            .Select(e => new PlatformActionAuditItemDto
            {
                Id = e.Id,
                ActorUserId = e.ActorUserId,
                ActorEmail = e.ActorEmail,
                Action = e.Action,
                Outcome = e.Outcome,
                TargetTenantId = e.TargetTenantId,
                CreatedAtUtc = e.CreatedAtUtc,
                CorrelationId = e.CorrelationId,
                DetailsJson = e.DetailsJson
            })
            .ToListAsync(cancellationToken);

        return Ok(ApiResponse<PlatformActionAuditPageDto>.Ok(
            new PlatformActionAuditPageDto { Items = items, TotalCount = totalCount }));
    }
}
