using System.Diagnostics;
using System.Security.Claims;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;

namespace FactuTrust.Infrastructure.Services;

public sealed class TenantAuthTokenService : ITenantAuthTokenService
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IEffectivePermissionService _effectivePermissionService;
    private readonly IFirmAssignmentService _firmAssignmentService;
    private readonly MasterDbContext _masterContext;
    private readonly IConfiguration _configuration;
    private readonly AccountingFirmsOptions _accountingFirmsOptions;
    private readonly PayrollOptions _payrollOptions;
    private readonly AccountingSettings _accountingSettings;
    private readonly FirmGovernanceOptions _firmGovernanceOptions;
    private readonly ILogger<TenantAuthTokenService> _logger;

    public TenantAuthTokenService(
        UserManager<ApplicationUser> userManager,
        IEffectivePermissionService effectivePermissionService,
        IFirmAssignmentService firmAssignmentService,
        MasterDbContext masterContext,
        IConfiguration configuration,
        IOptions<AccountingFirmsOptions> accountingFirmsOptions,
        IOptions<PayrollOptions> payrollOptions,
        IOptions<AccountingSettings> accountingSettings,
        IOptions<FirmGovernanceOptions> firmGovernanceOptions,
        ILogger<TenantAuthTokenService> logger)
    {
        _userManager = userManager;
        _effectivePermissionService = effectivePermissionService;
        _firmAssignmentService = firmAssignmentService;
        _masterContext = masterContext;
        _configuration = configuration;
        _accountingFirmsOptions = accountingFirmsOptions.Value;
        _payrollOptions = payrollOptions.Value;
        _accountingSettings = accountingSettings.Value;
        _firmGovernanceOptions = firmGovernanceOptions.Value;
        _logger = logger;
    }

    public async Task<AuthResponseDto> GenerateTokensAsync(
        Guid userId,
        Guid homeTenantId,
        Guid? contextTenantId = null,
        string? contextCompanyName = null,
        CancellationToken cancellationToken = default)
    {
        var totalSw = Stopwatch.StartNew();
        var user = await _userManager.FindByIdAsync(userId.ToString())
            ?? throw new InvalidOperationException("User not found.");

        var homeTenant = await _masterContext.Tenants.FindAsync([homeTenantId], cancellationToken)
            ?? throw new InvalidOperationException("Tenant not found.");

        if (user.TenantId == Guid.Empty)
            throw new InvalidOperationException("Cannot issue token: user has no tenant.");

        var roles = await _userManager.GetRolesAsync(user);
        var roleName = roles.FirstOrDefault(r => !string.Equals(r, PlatformRoles.PlatformAdmin, StringComparison.Ordinal))
            ?? UserRole.Accountant.ToString();
        var roleEnum = Enum.TryParse<UserRole>(roleName, out var r) ? r : UserRole.Accountant;

        var isDelegated = contextTenantId.HasValue && contextTenantId.Value != Guid.Empty
            && homeTenant.Kind == TenantKind.AccountingFirm;

        IReadOnlyList<string> effectivePermissions;
        IReadOnlyList<int> enabledModuleIds;
        UserAccessSnapshot? nativeSnapshot = null;

        var isFirmManaged = false;
        if (isDelegated)
        {
            var contextTenant = await _masterContext.Tenants.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == contextTenantId!.Value, cancellationToken);
            // Only dossiers managed by *this* firm (cabinet-created, no platform account).
            isFirmManaged = contextTenant?.ManagedByFirmTenantId == homeTenantId;

            effectivePermissions = DelegatedPermissionCatalog.GetDelegatedPermissions(roleEnum).ToList();
            enabledModuleIds = isFirmManaged
                ? BuildFirmManagedDelegatedModuleIds()
                : BuildPlatformClientDelegatedModuleIds();

            if (!_accountingFirmsOptions.AiAccountingEnabled)
            {
                effectivePermissions = effectivePermissions
                    .Where(p => !string.Equals(p, Permissions.AI.Chat, StringComparison.Ordinal))
                    .ToList();
                enabledModuleIds = enabledModuleIds
                    .Where(id => id != (int)AppModule.AI)
                    .ToList();
            }

            if (!isFirmManaged)
            {
                enabledModuleIds = await AppendProjectsIfClientLicensedAsync(
                    contextTenantId!.Value, enabledModuleIds, cancellationToken);
            }
        }
        else if (homeTenant.Kind == TenantKind.AccountingFirm)
        {
            nativeSnapshot = await _effectivePermissionService.GetUserAccessSnapshotAsync(user.Id, cancellationToken);
            effectivePermissions = FirmGovernanceNativeAccess.AugmentNativeFirmPermissions(
                nativeSnapshot.EffectivePermissions.ToList(),
                roleEnum,
                _firmGovernanceOptions,
                _accountingFirmsOptions);
            enabledModuleIds = FirmGovernanceNativeAccess.BuildNativeFirmModuleIds(_firmGovernanceOptions);
        }
        else
        {
            nativeSnapshot = await _effectivePermissionService.GetUserAccessSnapshotAsync(user.Id, cancellationToken);
            effectivePermissions = nativeSnapshot.EffectivePermissions.ToList();
            enabledModuleIds = nativeSnapshot.EnabledModules.Select(m => (int)m).ToList();
        }

        // Applique aux TROIS populations d'un coup (delegue cabinet, cabinet natif, societe) :
        // drapeau eteint, la cle n'entre pas dans le jeton, donc ni menu ni bouton d'ecriture.
        effectivePermissions = AccountingCurrencyAccess
            .FilterWhenDisabled(effectivePermissions, _accountingSettings.MultiCurrencyEnabled)
            .ToList();

        var isPayrollFirmManaged = false;
        if (!isDelegated
            && homeTenant.Kind == TenantKind.Company
            && _payrollOptions.FirmExclusiveOperations)
        {
            var assignment = await _firmAssignmentService.GetCompanyCurrentAssignmentAsync(
                homeTenantId,
                cancellationToken);
            if (assignment is not null)
            {
                isPayrollFirmManaged = true;
                effectivePermissions = PayrollOperationsAccess
                    .FilterCompanyPermissionsWhenFirmAssigned(effectivePermissions)
                    .ToList();
            }
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email!),
            new(ClaimTypes.GivenName, user.FirstName),
            new(ClaimTypes.Surname, user.LastName),
            new("tenant_id", user.TenantId.ToString()),
            new(AuthClaimTypes.TenantKind, homeTenant.Kind.ToClaimValue())
        };

        // Révocation immédiate (plan §6 Phase 2.5) : snapshot du SecurityStamp Identity à l'émission.
        // Vérifié à chaque requête (OnTokenValidated) contre la base master ; un changement de rôle,
        // une désactivation ou une réinitialisation de mot de passe invalident l'access token courant
        // sans attendre son expiration naturelle (15 min).
        if (!string.IsNullOrEmpty(user.SecurityStamp))
            claims.Add(new Claim(AuthClaimTypes.SecurityStamp, user.SecurityStamp));

        foreach (var role in roles)
        {
            if (string.Equals(role, PlatformRoles.PlatformAdmin, StringComparison.Ordinal))
                continue;
            claims.Add(new Claim(ClaimTypes.Role, role));
        }

        if (!claims.Exists(c => c.Type == ClaimTypes.Role))
            claims.Add(new Claim(ClaimTypes.Role, UserRole.Accountant.ToString()));

        foreach (var p in effectivePermissions)
            claims.Add(new Claim(AuthClaimTypes.Permission, p));

        if (isDelegated)
        {
            claims.Add(new Claim(AuthClaimTypes.AccessMode, "delegated"));
            claims.Add(new Claim(AuthClaimTypes.ContextTenantId, contextTenantId!.Value.ToString()));
            if (!string.IsNullOrEmpty(contextCompanyName))
                claims.Add(new Claim(AuthClaimTypes.ContextCompanyName, contextCompanyName));
            claims.Add(new Claim(AuthClaimTypes.IsFirmManaged, isFirmManaged ? "true" : "false"));
        }
        else
        {
            claims.Add(new Claim(AuthClaimTypes.AccessMode, "native"));
            nativeSnapshot ??= await _effectivePermissionService.GetUserAccessSnapshotAsync(user.Id, cancellationToken);
            if (nativeSnapshot.IsModulePermissionScoped)
                claims.Add(new Claim(AuthClaimTypes.PermissionSource, "modules"));
            if (isPayrollFirmManaged)
                claims.Add(new Claim(AuthClaimTypes.PayrollFirmManaged, "true"));
        }

        if (user.PortalClientId is Guid portalClientId)
        {
            claims.Add(new Claim(AuthClaimTypes.ClientId, portalClientId.ToString()));
            claims.Add(new Claim(AuthClaimTypes.IsPortal, "true"));
        }

        var jwtSettings = _configuration.GetSection("JwtSettings");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings["SecretKey"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var expiry = DateTime.UtcNow.AddMinutes(int.Parse(jwtSettings["ExpiryMinutes"] ?? "15"));

        var token = new JwtSecurityToken(
            issuer: jwtSettings["Issuer"],
            audience: jwtSettings["Audience"],
            claims: claims,
            expires: expiry,
            signingCredentials: credentials);

        var accessToken = new JwtSecurityTokenHandler().WriteToken(token);
        var refreshToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

        user.RefreshToken = RefreshTokenHasher.Hash(refreshToken);
        user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(7);

        // Le contexte dossier suit la rotation du refresh token : c'est la seule façon pour
        // /api/auth/refresh — endpoint anonyme, qui ne reçoit que le refresh token — de savoir sur
        // quel dossier la session était positionnée. Remise à null en mode natif : sortir du dossier
        // ne doit pas pouvoir être défait par un rafraîchissement.
        user.RefreshContextTenantId = isDelegated ? contextTenantId : null;

        await _userManager.UpdateAsync(user);

        totalSw.Stop();
        _logger.LogDebug(
            "FirmRegistration.Step={Step} DurationMs={DurationMs} TenantId={TenantId} UserId={UserId}",
            "TokenGeneration",
            totalSw.ElapsedMilliseconds,
            homeTenantId,
            userId);

        return new AuthResponseDto
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken,
            ExpiresAt = expiry,
            User = CreateUserDto(user, homeTenant, roleEnum, enabledModuleIds, effectivePermissions, isDelegated, contextTenantId, contextCompanyName, isFirmManaged, isPayrollFirmManaged),
            Requires2Fa = false
        };
    }

    private static IReadOnlyList<int> BuildFirmManagedDelegatedModuleIds() =>
        new[]
        {
            (int)AppModule.Accounting,
            (int)AppModule.Fiscal,
            (int)AppModule.Reports,
            (int)AppModule.Payroll,
            (int)AppModule.AI
        };

    private static IReadOnlyList<int> BuildPlatformClientDelegatedModuleIds() =>
        new[]
        {
            (int)AppModule.Accounting,
            (int)AppModule.Fiscal,
            (int)AppModule.Sales,
            (int)AppModule.Treasury,
            (int)AppModule.Reports,
            (int)AppModule.Purchases,
            (int)AppModule.Payroll,
            (int)AppModule.AI
        };

    /// <summary>
    /// Adds <see cref="AppModule.Projects"/> only when the client tenant's plan or override includes it.
    /// Firm-managed dossiers stay on the accounting/payroll dump (no Projects in V1).
    /// </summary>
    private async Task<IReadOnlyList<int>> AppendProjectsIfClientLicensedAsync(
        Guid clientTenantId,
        IReadOnlyList<int> moduleIds,
        CancellationToken cancellationToken)
    {
        if (moduleIds.Contains((int)AppModule.Projects))
            return moduleIds;

        var now = DateTime.UtcNow;
        var overrideRow = await _masterContext.TenantModuleOverrides.AsNoTracking()
            .Where(o => o.TenantId == clientTenantId && o.Module == (int)AppModule.Projects)
            .Where(o => o.ExpiresAt == null || o.ExpiresAt > now)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        bool licensed;
        if (overrideRow is not null)
        {
            licensed = overrideRow.IsEnabled;
        }
        else
        {
            var planId = await _masterContext.Subscriptions.AsNoTracking()
                .Where(s => s.TenantId == clientTenantId)
                .Select(s => s.PlanId)
                .FirstOrDefaultAsync(cancellationToken);

            if (planId is null || planId == Guid.Empty)
                licensed = false;
            else
                licensed = await _masterContext.PlanModules.AsNoTracking()
                    .AnyAsync(
                        m => m.PlanId == planId.Value && m.Module == (int)AppModule.Projects && m.IsIncluded,
                        cancellationToken);
        }

        if (!licensed)
            return moduleIds;

        var list = moduleIds.ToList();
        list.Add((int)AppModule.Projects);
        return list;
    }

    private static UserDto CreateUserDto(
        ApplicationUser user,
        Tenant homeTenant,
        UserRole roleEnum,
        IReadOnlyList<int> enabledModuleIds,
        IReadOnlyList<string> effectivePermissions,
        bool isDelegated,
        Guid? contextTenantId,
        string? contextCompanyName,
        bool isFirmManaged,
        bool isPayrollFirmManaged)
    {
        return new UserDto
        {
            Id = user.Id,
            Email = user.Email!,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = roleEnum,
            RoleDisplay = roleEnum.ToDisplayString(),
            TenantId = user.TenantId,
            CompanyName = homeTenant.CompanyName,
            TenantKind = homeTenant.Kind,
            TwoFactorEnabled = user.TwoFactorEnabled,
            EnabledModuleIds = enabledModuleIds.ToList(),
            EffectivePermissions = effectivePermissions.ToList(),
            AccessMode = isDelegated ? "delegated" : "native",
            ContextTenantId = isDelegated ? contextTenantId : null,
            ContextCompanyName = isDelegated ? contextCompanyName : null,
            IsFirmManaged = isDelegated && isFirmManaged,
            IsPayrollFirmManaged = !isDelegated && isPayrollFirmManaged,
            ProductOnboardingStatus = user.ProductOnboardingStatus,
            ProductOnboardingVersion = user.ProductOnboardingVersion,
            ProductOnboardingChecklist = ProductOnboardingUserDtoMapper.ChecklistOf(user),
            CompanySegment = homeTenant.CompanySegment,
            BusinessDomain = homeTenant.BusinessDomain,
            TenantCreatedAtUtc = homeTenant.CreatedAt,
            PreferredLanguage = user.PreferredLanguage
        };
    }
}
