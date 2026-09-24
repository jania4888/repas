using System.Security.Claims;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/platform/company-support")]
[Authorize(Policy = PlatformPolicies.PlatformAdmin)]
public sealed class PlatformCompanySupportController : ControllerBase
{
    private readonly ICompanySupportService _support;

    public PlatformCompanySupportController(ICompanySupportService support)
    {
        _support = support;
    }

    [HttpGet("conversations")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    public async Task<ActionResult<ApiResponse<CompanySupportInboxDto>>> List(
        [FromQuery] string? companyName,
        [FromQuery] bool unreadOnly,
        [FromQuery] CompanySupportCategory? category,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (!HasPermission(PlatformPermissions.CompanySupportRead) || !IsPlatformOperator())
            return Forbidden<CompanySupportInboxDto>();
        var userId = GetUserId();
        if (userId is null)
            return Unauthorized();
        var result = await _support.ListForPlatformAsync(userId.Value, companyName, unreadOnly, category, page, pageSize, cancellationToken);
        return Map(result);
    }

    [HttpGet("unread-count")]
    public async Task<ActionResult<ApiResponse<int>>> UnreadCount(CancellationToken cancellationToken)
    {
        if (!HasPermission(PlatformPermissions.CompanySupportRead) || !IsPlatformOperator())
            return Forbidden<int>();
        var userId = GetUserId();
        if (userId is null)
            return Unauthorized();
        var count = await _support.GetPlatformUnreadCountAsync(userId.Value, cancellationToken);
        return Ok(ApiResponse<int>.Ok(count));
    }

    [HttpGet("conversations/{tenantId:guid}")]
    public async Task<ActionResult<ApiResponse<CompanySupportBootstrapDto>>> Get(Guid tenantId, CancellationToken cancellationToken)
    {
        if (!HasPermission(PlatformPermissions.CompanySupportRead) || !IsPlatformOperator())
            return Forbidden<CompanySupportBootstrapDto>();
        var userId = GetUserId();
        if (userId is null)
            return Unauthorized();
        var result = await _support.GetForPlatformAsync(tenantId, userId.Value, cancellationToken);
        return Map(result);
    }

    [HttpPost("conversations/{tenantId:guid}/messages")]
    [EnableRateLimiting("company-support-write")]
    [RequestSizeLimit(52 * 1024 * 1024)]
    public async Task<ActionResult<ApiResponse<CompanySupportMessageDto>>> Reply(Guid tenantId, CancellationToken cancellationToken)
    {
        if (!HasPermission(PlatformPermissions.CompanySupportWrite) || !IsPlatformOperator())
            return Forbidden<CompanySupportMessageDto>();
        var userId = GetUserId();
        if (userId is null)
            return Unauthorized();
        if (!Request.HasFormContentType)
            return BadRequest(ApiResponse<CompanySupportMessageDto>.Fail("Requête multipart attendue"));

        var form = await Request.ReadFormAsync(cancellationToken);
        if (!Guid.TryParse(form["clientRequestId"], out var clientRequestId))
            return BadRequest(ApiResponse<CompanySupportMessageDto>.Fail("Identifiant de requête obligatoire"));

        var files = await ReadFilesAsync(form.Files, cancellationToken);
        var result = await _support.PostPlatformReplyAsync(
            tenantId, userId.Value, OperatorDisplayName(), User.FindFirstValue(ClaimTypes.Email),
            form["body"], clientRequestId, files, cancellationToken);
        return Map(result);
    }

    [HttpPost("conversations/{tenantId:guid}/read")]
    public async Task<ActionResult<ApiResponse<object>>> MarkRead(Guid tenantId, [FromQuery] DateTime? readAt, CancellationToken cancellationToken)
    {
        if (!HasPermission(PlatformPermissions.CompanySupportRead) || !IsPlatformOperator())
            return Forbidden<object>();
        var userId = GetUserId();
        if (userId is null)
            return Unauthorized();
        var result = await _support.MarkReadForPlatformAsync(tenantId, userId.Value, readAt, cancellationToken);
        return MapEmpty(result);
    }

    [HttpGet("attachments/{attachmentId:guid}")]
    public async Task<IActionResult> Download(Guid attachmentId, CancellationToken cancellationToken)
    {
        if (!HasPermission(PlatformPermissions.CompanySupportRead) || !IsPlatformOperator())
            return StatusCode(StatusCodes.Status403Forbidden);
        var userId = GetUserId();
        if (userId is null)
            return Unauthorized();
        var result = await _support.DownloadForPlatformAsync(
            userId.Value, User.FindFirstValue(ClaimTypes.Email), attachmentId, cancellationToken);
        if (result.IsFailure)
            return NotFound();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(result.Value.Stream, result.Value.ContentType, result.Value.FileName);
    }

    private bool IsPlatformOperator()
    {
        var tenantClaim = User.FindFirstValue("tenant_id");
        if (string.IsNullOrWhiteSpace(tenantClaim))
            return true;
        return Guid.TryParse(tenantClaim, out var tenantId) && tenantId == Guid.Empty;
    }

    private bool HasPermission(string permission)
        => User.FindAll(AuthClaimTypes.Permission).Any(c => string.Equals(c.Value, permission, StringComparison.Ordinal));

    private Guid? GetUserId()
    {
        var claim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(claim, out var id) ? id : null;
    }

    private string OperatorDisplayName()
    {
        var first = User.FindFirstValue(ClaimTypes.GivenName) ?? User.FindFirstValue("first_name") ?? "Assistance";
        var role = User.FindFirstValue(ClaimTypes.Role);
        var roleLabel = role switch
        {
            PlatformRoles.PlatformAdmin => "Administrateur",
            PlatformRoles.SupportAgent => "Support",
            _ => "Assistance"
        };
        return $"{first.Trim()} · {roleLabel}";
    }

    private static async Task<IReadOnlyList<CompanySupportUpload>> ReadFilesAsync(IFormFileCollection files, CancellationToken cancellationToken)
    {
        var list = new List<CompanySupportUpload>(files.Count);
        foreach (var file in files)
        {
            await using var stream = file.OpenReadStream();
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, cancellationToken);
            list.Add(new CompanySupportUpload(file.FileName, file.ContentType, memory.ToArray()));
        }
        return list;
    }

    private ActionResult<ApiResponse<T>> Map<T>(Result<T> result)
    {
        if (result.IsFailure)
        {
            if (result.Error.Code.Contains("NotFound", StringComparison.Ordinal))
                return NotFound(ApiResponse<T>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<T>.Fail(result.Error.Description));
        }
        return Ok(ApiResponse<T>.Ok(result.Value));
    }

    private ActionResult<ApiResponse<object>> MapEmpty(Result result)
    {
        if (result.IsFailure)
        {
            if (result.Error.Code.Contains("NotFound", StringComparison.Ordinal))
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }
        return Ok(ApiResponse<object>.Ok(null!));
    }

    private ActionResult<ApiResponse<T>> Forbidden<T>()
        => StatusCode(StatusCodes.Status403Forbidden, ApiResponse<T>.Fail("Accès refusé"));
}
