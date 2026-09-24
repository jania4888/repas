using System.Security.Claims;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.API.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/firm/users")]
[Authorize(Policy = PermissionPolicies.FirmUsersManage)]
[Filters.RequireAccountingFirmsFeature]
public sealed class FirmUsersController : ControllerBase
{
    private readonly IFirmCollaboratorService _collaborators;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<FirmUsersController> _logger;

    public FirmUsersController(
        IFirmCollaboratorService collaborators,
        ICurrentUser currentUser,
        ILogger<FirmUsersController> logger)
    {
        _collaborators = collaborators;
        _currentUser = currentUser;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<FirmUserDto>>>> List(
        [FromQuery] string? name,
        [FromQuery] string? qualification,
        [FromQuery] bool? isActive,
        CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.ListAsync(tenantId.Value, name, qualification, isActive, cancellationToken);
        if (!result.IsSuccess)
            return BadRequest(ApiResponse<IReadOnlyList<FirmUserDto>>.Fail(result.Error.Description));

        return Ok(ApiResponse<IReadOnlyList<FirmUserDto>>.Ok(result.Value));
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(
        [FromQuery] string? name,
        [FromQuery] string? qualification,
        [FromQuery] bool? isActive,
        CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.ExportExcelAsync(tenantId.Value, name, qualification, isActive, cancellationToken);
        if (!result.IsSuccess)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return File(
            result.Value.Content,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            result.Value.FileName);
    }

    [HttpGet("firm-address")]
    public async Task<ActionResult<ApiResponse<FirmAddressSnapshotDto>>> FirmAddress(CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.GetFirmAddressAsync(tenantId.Value, cancellationToken);
        if (!result.IsSuccess)
            return BadRequest(ApiResponse<FirmAddressSnapshotDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<FirmAddressSnapshotDto>.Ok(result.Value));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<FirmUserDto>>> GetById(Guid id, CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.GetByIdAsync(tenantId.Value, id, cancellationToken);
        if (!result.IsSuccess)
            return NotFound(ApiResponse<FirmUserDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<FirmUserDto>.Ok(result.Value));
    }

    [HttpPost]
    [Consumes("application/json", "multipart/form-data")]
    public async Task<ActionResult<ApiResponse<FirmUserDto>>> Create(CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        CreateFirmUserDto? dto;
        Stream? cniStream = null;
        string? cniFileName = null;
        string? cniContentType = null;

        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync(cancellationToken);
            var userJson = form["user"].ToString();
            if (string.IsNullOrWhiteSpace(userJson))
                userJson = form["dto"].ToString();
            if (string.IsNullOrWhiteSpace(userJson))
                return BadRequest(ApiResponse<FirmUserDto>.Fail("Payload collaborateur manquant"));

            dto = JsonSerializer.Deserialize<CreateFirmUserDto>(userJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
            var file = form.Files.GetFile("file") ?? form.Files.GetFile("cni");
            if (file is { Length: > 0 })
            {
                cniStream = file.OpenReadStream();
                cniFileName = file.FileName;
                cniContentType = file.ContentType;
            }
        }
        else
        {
            dto = await HttpContext.Request.ReadFromJsonAsync<CreateFirmUserDto>(cancellationToken: cancellationToken);
        }

        if (dto is null)
            return BadRequest(ApiResponse<FirmUserDto>.Fail("Payload invalide"));

        try
        {
            var result = await _collaborators.CreateAsync(
                tenantId.Value, dto, cniStream, cniFileName, cniContentType, cancellationToken);
            if (!result.IsSuccess)
            {
                // Seul le code est journalisé : le message peut contenir l'e-mail saisi.
                _logger.LogWarning(
                    "Collaborator creation refused: {ErrorCode} (firm {TenantId})",
                    result.Error.Code, tenantId.Value);
                // Le code permet à l'écran de signaler le champ fautif sans analyser le texte.
                return BadRequest(ApiResponse<FirmUserDto>.Fail(result.Error.Description, result.Error.Code));
            }

            return Ok(ApiResponse<FirmUserDto>.Ok(result.Value, "Utilisateur créé"));
        }
        finally
        {
            if (cniStream is not null)
                await cniStream.DisposeAsync();
        }
    }

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<ApiResponse<FirmUserDto>>> Update(
        Guid id,
        [FromBody] UpdateFirmUserDto dto,
        CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var currentUserId = _currentUser.UserId;
        if (currentUserId is null)
            return Unauthorized();

        var result = await _collaborators.UpdateAsync(tenantId.Value, id, currentUserId.Value, dto, cancellationToken);
        if (!result.IsSuccess)
        {
            if (result.Error.Code.Contains("NotFound", StringComparison.Ordinal))
                return NotFound(ApiResponse<FirmUserDto>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<FirmUserDto>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<FirmUserDto>.Ok(result.Value, "Collaborateur mis à jour"));
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<ActionResult<ApiResponse<object>>> SetStatus(
        Guid id,
        [FromBody] UpdateFirmUserStatusDto dto,
        CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var currentUserId = _currentUser.UserId;
        if (currentUserId is null)
            return Unauthorized();

        var result = await _collaborators.SetActiveAsync(tenantId.Value, id, currentUserId.Value, dto.IsActive, cancellationToken);
        if (!result.IsSuccess)
        {
            if (result.Error.Code.Contains("NotFound", StringComparison.Ordinal))
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<object>.Ok(null!, dto.IsActive ? "Collaborateur activé" : "Collaborateur désactivé"));
    }

    [HttpPost("{id:guid}/resend-invite")]
    public async Task<ActionResult<ApiResponse<object>>> ResendInvite(Guid id, CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.ResendInviteAsync(tenantId.Value, id, cancellationToken);
        if (!result.IsSuccess)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Invitation renvoyée"));
    }

    [HttpPut("{id:guid}/binomes")]
    public async Task<ActionResult<ApiResponse<object>>> SetBinomes(
        Guid id,
        [FromBody] SetFirmUserBinomesDto dto,
        CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.SetBinomesAsync(tenantId.Value, id, dto.BinomeUserIds, cancellationToken);
        if (!result.IsSuccess)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Binômes mis à jour"));
    }

    [HttpPost("{id:guid}/cni")]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<ApiResponse<FirmCollaboratorCniInfoDto>>> UploadCni(
        Guid id,
        IFormFile file,
        CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<FirmCollaboratorCniInfoDto>.Fail("Fichier requis"));

        await using var stream = file.OpenReadStream();
        var result = await _collaborators.UploadCniAsync(
            tenantId.Value, id, stream, file.FileName, file.ContentType, file.Length, cancellationToken);
        if (!result.IsSuccess)
            return BadRequest(ApiResponse<FirmCollaboratorCniInfoDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<FirmCollaboratorCniInfoDto>.Ok(result.Value, "CNI enregistrée"));
    }

    [HttpGet("{id:guid}/cni")]
    public async Task<IActionResult> DownloadCni(Guid id, CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.DownloadCniAsync(tenantId.Value, id, cancellationToken);
        if (!result.IsSuccess)
            return NotFound(ApiResponse<object>.Fail(result.Error.Description));

        return File(result.Value.Stream, result.Value.ContentType, result.Value.FileName);
    }

    [HttpDelete("{id:guid}/cni")]
    public async Task<ActionResult<ApiResponse<object>>> DeleteCni(Guid id, CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _collaborators.DeleteCniAsync(tenantId.Value, id, cancellationToken);
        if (!result.IsSuccess)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "CNI supprimée"));
    }

    private Guid? GetHomeTenantId()
    {
        var claim = User.FindFirstValue("tenant_id");
        return Guid.TryParse(claim, out var id) ? id : null;
    }
}
