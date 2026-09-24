using System.Security.Claims;
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
[Route("api/company-support")]
[Authorize(Roles = $"{nameof(UserRole.Administrator)},{nameof(UserRole.Supervisor)}")]
public sealed class CompanySupportController : ControllerBase
{
    private readonly ICompanySupportService _support;

    public CompanySupportController(ICompanySupportService support)
    {
        _support = support;
    }

    [HttpGet("bootstrap")]
    public async Task<ActionResult<ApiResponse<CompanySupportBootstrapDto>>> Bootstrap(CancellationToken cancellationToken)
    {
        var caller = ResolveCompanyCaller();
        if (caller is null)
            return Forbidden<CompanySupportBootstrapDto>();
        var result = await _support.BootstrapForCompanyAsync(caller.Value.TenantId, caller.Value.UserId, cancellationToken);
        return Map(result);
    }

    [HttpGet("messages")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<CompanySupportMessageDto>>>> Messages(
        [FromQuery] DateTime? before, [FromQuery] DateTime? after, [FromQuery] int? limit, CancellationToken cancellationToken)
    {
        var caller = ResolveCompanyCaller();
        if (caller is null)
            return Forbidden<IReadOnlyList<CompanySupportMessageDto>>();
        var result = await _support.GetMessagesForCompanyAsync(caller.Value.TenantId, before, after, limit, cancellationToken);
        return Map(result);
    }

    [HttpGet("unread-count")]
    public async Task<ActionResult<ApiResponse<int>>> UnreadCount(CancellationToken cancellationToken)
    {
        var caller = ResolveCompanyCaller();
        if (caller is null)
            return Forbidden<int>();
        var count = await _support.GetCompanyUnreadCountAsync(caller.Value.TenantId, caller.Value.UserId, cancellationToken);
        return Ok(ApiResponse<int>.Ok(count));
    }

    [HttpPost("messages")]
    [EnableRateLimiting("company-support-write")]
    [RequestSizeLimit(52 * 1024 * 1024)]
    public async Task<ActionResult<ApiResponse<CompanySupportMessageDto>>> Post(CancellationToken cancellationToken)
    {
        var caller = ResolveCompanyCaller();
        if (caller is null)
            return Forbidden<CompanySupportMessageDto>();
        if (!Request.HasFormContentType)
            return BadRequest(ApiResponse<CompanySupportMessageDto>.Fail("Requête multipart attendue"));

        var form = await Request.ReadFormAsync(cancellationToken);
        if (!Enum.TryParse<CompanySupportCategory>(form["category"], ignoreCase: true, out var category))
            return BadRequest(ApiResponse<CompanySupportMessageDto>.Fail("Type de message obligatoire"));
        if (!Guid.TryParse(form["clientRequestId"], out var clientRequestId))
            return BadRequest(ApiResponse<CompanySupportMessageDto>.Fail("Identifiant de requête obligatoire"));

        var files = await ReadFilesAsync(form.Files, cancellationToken);
        var result = await _support.PostCompanyMessageAsync(
            caller.Value.TenantId, caller.Value.UserId, caller.Value.DisplayName,
            category, form["body"], clientRequestId, files, cancellationToken);
        return Map(result);
    }

    [HttpPost("read")]
    public async Task<ActionResult<ApiResponse<object>>> MarkRead([FromQuery] DateTime? readAt, CancellationToken cancellationToken)
    {
        var caller = ResolveCompanyCaller();
        if (caller is null)
            return Forbidden<object>();
        var result = await _support.MarkReadForCompanyAsync(caller.Value.TenantId, caller.Value.UserId, readAt, cancellationToken);
        return MapEmpty(result);
    }

    [HttpGet("attachments/{attachmentId:guid}")]
    public async Task<IActionResult> Download(Guid attachmentId, CancellationToken cancellationToken)
    {
        var caller = ResolveCompanyCaller();
        if (caller is null)
            return StatusCode(StatusCodes.Status403Forbidden);
        var result = await _support.DownloadForCompanyAsync(caller.Value.TenantId, caller.Value.UserId, attachmentId, cancellationToken);
        if (result.IsFailure)
            return NotFound();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(result.Value.Stream, result.Value.ContentType, result.Value.FileName);
    }

    private Caller? ResolveCompanyCaller()
    {
        var tenantClaim = User.FindFirstValue("tenant_id");
        var userClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(tenantClaim, out var tenantId) || tenantId == Guid.Empty
            || !Guid.TryParse(userClaim, out var userId))
            return null;

        var accessMode = User.FindFirstValue(AuthClaimTypes.AccessMode);
        if (string.Equals(accessMode, "delegated", StringComparison.OrdinalIgnoreCase))
            return null;

        var role = User.FindFirstValue(ClaimTypes.Role);
        if (role is nameof(UserRole.FirmManager) or nameof(UserRole.FirmAccountant))
            return null;

        var kind = User.FindFirstValue(AuthClaimTypes.TenantKind);
        if (!string.IsNullOrEmpty(kind)
            && !string.Equals(kind, "company", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(kind, nameof(TenantKind.Company), StringComparison.OrdinalIgnoreCase))
            return null;

        if (string.Equals(User.FindFirstValue(AuthClaimTypes.IsPortal), "true", StringComparison.OrdinalIgnoreCase))
            return null;

        var first = User.FindFirstValue("first_name") ?? User.FindFirstValue(ClaimTypes.GivenName) ?? "";
        var last = User.FindFirstValue("last_name") ?? User.FindFirstValue(ClaimTypes.Surname) ?? "";
        var display = $"{first} {last}".Trim();
        if (string.IsNullOrEmpty(display))
            display = "Utilisateur";
        return new Caller(tenantId, userId, display);
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
            if (result.Error.Code.StartsWith("Forbidden", StringComparison.Ordinal))
                return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<T>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<T>.Fail(result.Error.Description));
        }
        return Ok(ApiResponse<T>.Ok(result.Value));
    }

    private ActionResult<ApiResponse<object>> MapEmpty(Result result)
    {
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<object>.Ok(null!));
    }

    private ActionResult<ApiResponse<T>> Forbidden<T>()
        => StatusCode(StatusCodes.Status403Forbidden, ApiResponse<T>.Fail("Accès refusé"));

    private readonly record struct Caller(Guid TenantId, Guid UserId, string DisplayName);
}
