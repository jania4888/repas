using System.Security.Claims;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

public sealed class FirmContextService : IFirmContextService
{
    private readonly MasterDbContext _masterContext;
    private readonly IFirmAssignmentService _assignmentService;
    private readonly IFirmDossierAccessService _dossierAccess;
    private readonly ICurrentUser _currentUser;
    private readonly ITenantAuthTokenService _tokenService;

    public FirmContextService(
        MasterDbContext masterContext,
        IFirmAssignmentService assignmentService,
        IFirmDossierAccessService dossierAccess,
        ICurrentUser currentUser,
        ITenantAuthTokenService tokenService)
    {
        _masterContext = masterContext;
        _assignmentService = assignmentService;
        _dossierAccess = dossierAccess;
        _currentUser = currentUser;
        _tokenService = tokenService;
    }

    public async Task<AuthResponseDto> SwitchToClientAsync(
        Guid userId, Guid homeTenantId, Guid clientTenantId, CancellationToken cancellationToken = default)
    {
        var homeTenant = await _masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == homeTenantId, cancellationToken)
            ?? throw new InvalidOperationException("Cabinet introuvable.");

        if (homeTenant.Kind != TenantKind.AccountingFirm)
            throw new InvalidOperationException("Seul un cabinet comptable peut basculer vers un dossier client.");

        var hasAssignment = await _assignmentService.HasActiveAssignmentAsync(homeTenantId, clientTenantId, cancellationToken);
        if (!hasAssignment)
            throw new UnauthorizedAccessException(FirmDossierAccessService.InactiveAssignmentMessage);

        var scope = ResolveScope(userId);
        if (!await _dossierAccess.CanAccessClientDossierAsync(homeTenantId, scope, clientTenantId, cancellationToken))
            throw new UnauthorizedAccessException(FirmDossierAccessService.NotAssignedMessage);

        var clientTenant = await _masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == clientTenantId && t.IsActive, cancellationToken)
            ?? throw new UnauthorizedAccessException("Société cliente introuvable ou inactive.");

        return await _tokenService.GenerateTokensAsync(
            userId, homeTenantId, clientTenantId, clientTenant.CompanyName, cancellationToken);
    }

    public async Task<AuthResponseDto?> TryRestoreDelegatedContextAsync(
        Guid userId, Guid homeTenantId, Guid clientTenantId, CancellationToken cancellationToken = default)
    {
        var homeTenant = await _masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == homeTenantId, cancellationToken);

        if (homeTenant is null || homeTenant.Kind != TenantKind.AccountingFirm)
            return null;

        if (!await _assignmentService.HasActiveAssignmentAsync(homeTenantId, clientTenantId, cancellationToken))
            return null;

        var scope = await ResolveScopeFromStoreAsync(userId, cancellationToken);
        if (!await _dossierAccess.CanAccessClientDossierAsync(homeTenantId, scope, clientTenantId, cancellationToken))
            return null;

        var clientTenant = await _masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == clientTenantId && t.IsActive, cancellationToken);

        if (clientTenant is null)
            return null;

        return await _tokenService.GenerateTokensAsync(
            userId, homeTenantId, clientTenantId, clientTenant.CompanyName, cancellationToken);
    }

    /// <summary>
    /// Portée du collaborateur déduite de son rôle <b>en base</b>, et non du principal HTTP : au
    /// rafraîchissement, celui-ci est expiré ou absent. <c>PlatformAdmin</c> est ignoré, comme dans
    /// la fabrique de jetons, et l'absence de rôle retombe sur <c>FirmAccountant</c> (fail-closed).
    /// </summary>
    private async Task<FirmDossierAccessScope> ResolveScopeFromStoreAsync(
        Guid userId, CancellationToken cancellationToken)
    {
        var roleName = await (
                from userRole in _masterContext.UserRoles
                join role in _masterContext.Roles on userRole.RoleId equals role.Id
                where userRole.UserId == userId && role.Name != PlatformRoles.PlatformAdmin
                select role.Name)
            .FirstOrDefaultAsync(cancellationToken);

        return FirmDossierAccessScope.ForUser(userId, roleName ?? nameof(UserRole.FirmAccountant));
    }

    private FirmDossierAccessScope ResolveScope(Guid userId)
    {
        if (_currentUser.TryGetAccessScope(out var scope) && scope.UserId == userId)
            return scope;

        // Fallback défensif : rôle issu du claim courant, sinon FirmAccountant (fail-closed).
        var role = _currentUser.Role?.ToString() ?? nameof(UserRole.FirmAccountant);
        return FirmDossierAccessScope.ForUser(userId, role);
    }

    public Task<AuthResponseDto> ClearContextAsync(
        Guid userId, Guid homeTenantId, CancellationToken cancellationToken = default)
    {
        return _tokenService.GenerateTokensAsync(userId, homeTenantId, cancellationToken: cancellationToken);
    }

    public async Task<FirmContextDto> GetCurrentContextAsync(
        ClaimsPrincipal principal, CancellationToken cancellationToken = default)
    {
        var accessMode = principal.FindFirstValue(AuthClaimTypes.AccessMode) ?? "native";
        var contextTenantIdClaim = principal.FindFirstValue(AuthClaimTypes.ContextTenantId);
        Guid? contextTenantId = Guid.TryParse(contextTenantIdClaim, out var id) ? id : null;
        var contextCompanyName = principal.FindFirstValue(AuthClaimTypes.ContextCompanyName);

        var isFirmManaged = false;
        if (string.Equals(accessMode, "delegated", StringComparison.OrdinalIgnoreCase)
            && contextTenantId.HasValue)
        {
            // Prefer JWT claim (set at switch / refresh); fall back to Master DB.
            var claim = principal.FindFirstValue(AuthClaimTypes.IsFirmManaged);
            if (string.Equals(claim, "true", StringComparison.OrdinalIgnoreCase))
            {
                isFirmManaged = true;
            }
            else if (string.Equals(claim, "false", StringComparison.OrdinalIgnoreCase))
            {
                isFirmManaged = false;
            }
            else
            {
                var homeTenantId = _currentUser.TenantId;
                var contextTenant = await _masterContext.Tenants.AsNoTracking()
                    .FirstOrDefaultAsync(t => t.Id == contextTenantId.Value, cancellationToken);
                isFirmManaged = contextTenant?.ManagedByFirmTenantId == homeTenantId;
            }
        }

        return new FirmContextDto
        {
            AccessMode = accessMode,
            ClientTenantId = contextTenantId,
            ClientCompanyName = contextCompanyName,
            IsFirmManaged = isFirmManaged
        };
    }
}
