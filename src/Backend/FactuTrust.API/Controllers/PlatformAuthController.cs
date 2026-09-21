using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Authentification pour les opérateurs plateforme.
/// Lot B1 — 5 rôles plateforme + permissions fines via claims JWT.
/// Lot B2 — flux de login en 2 étapes avec TOTP (RFC 6238).
/// Lot B4 — tracking sessions actives + log des tentatives échouées.
/// </summary>
[ApiController]
[Route("api/platform/auth")]
public sealed class PlatformAuthController : ControllerBase
{
    /// <summary>Audience JWT spéciale pour le ticket court "en attente de 2FA" (Lot B2).</summary>
    private const string TwoFactorPendingAudience = "platform-2fa-pending";

    private readonly UserManager<ApplicationUser> _userManager;
    private readonly SignInManager<ApplicationUser> _signInManager;
    private readonly MasterDbContext _masterContext;
    private readonly IConfiguration _configuration;
    private readonly IPlatformMfaService _mfaService;
    private readonly IUserSessionService _sessionService;
    private readonly IFailedLoginAttemptService _failedLogins;
    private readonly IAccountingFirmsFeature _accountingFirmsFeature;
    private readonly ILogger<PlatformAuthController> _logger;

    public PlatformAuthController(
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager,
        MasterDbContext masterContext,
        IConfiguration configuration,
        IPlatformMfaService mfaService,
        IUserSessionService sessionService,
        IFailedLoginAttemptService failedLogins,
        IAccountingFirmsFeature accountingFirmsFeature,
        ILogger<PlatformAuthController> logger)
    {
        _userManager = userManager;
        _signInManager = signInManager;
        _masterContext = masterContext;
        _configuration = configuration;
        _mfaService = mfaService;
        _sessionService = sessionService;
        _failedLogins = failedLogins;
        _accountingFirmsFeature = accountingFirmsFeature;
        _logger = logger;
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [ProducesResponseType(typeof(ApiResponse<PlatformAuthResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<TwoFactorChallengeDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login([FromBody] LoginDto dto, CancellationToken cancellationToken)
    {
        var user = await _userManager.FindByEmailAsync(dto.Email);
        if (user is null)
        {
            await _failedLogins.RecordAsync(dto.Email ?? "", null, GetIpAddress(), GetUserAgent(),
                FailedLoginReason.UserNotFound, null, cancellationToken);
            _logger.LogWarning("Platform login failed for {Email}: user not found", dto.Email);
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Email ou mot de passe incorrect"));
        }
        if (!user.IsActive)
        {
            await _failedLogins.RecordAsync(dto.Email ?? "", user.Id, GetIpAddress(), GetUserAgent(),
                FailedLoginReason.AccountInactive, null, cancellationToken);
            _logger.LogWarning("Platform login failed for {Email}: account inactive", dto.Email);
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Email ou mot de passe incorrect"));
        }

        var platformRoles = await GetPlatformRolesAsync(user);
        if (platformRoles.Count == 0)
        {
            await _failedLogins.RecordAsync(dto.Email ?? "", user.Id, GetIpAddress(), GetUserAgent(),
                FailedLoginReason.NotAPlatformAdmin, null, cancellationToken);
            _logger.LogWarning("Platform login failed for {Email}: not a platform administrator", dto.Email);
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Email ou mot de passe incorrect"));
        }

        if (user.TenantId != Guid.Empty)
        {
            await _failedLogins.RecordAsync(dto.Email ?? "", user.Id, GetIpAddress(), GetUserAgent(),
                FailedLoginReason.BoundToTenant, user.TenantId, cancellationToken);
            _logger.LogWarning("Platform login rejected for {Email}: account is bound to a tenant", dto.Email);
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Ce compte n'est pas autorisé sur l'espace plateforme."));
        }

        var result = await _signInManager.CheckPasswordSignInAsync(user, dto.Password, lockoutOnFailure: true);
        if (result.IsLockedOut)
        {
            await _failedLogins.RecordAsync(dto.Email ?? "", user.Id, GetIpAddress(), GetUserAgent(),
                FailedLoginReason.AccountLocked, null, cancellationToken);
            _logger.LogWarning("Platform user {Email} is locked out", dto.Email);
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Compte verrouillé. Réessayez dans 15 minutes."));
        }
        if (!result.Succeeded)
        {
            await _failedLogins.RecordAsync(dto.Email ?? "", user.Id, GetIpAddress(), GetUserAgent(),
                FailedLoginReason.WrongPassword, null, cancellationToken);
            _logger.LogWarning("Platform login failed for {Email}: invalid password", dto.Email);
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Email ou mot de passe incorrect"));
        }

        // ----- Lot B2 : 2FA enabled ? --------------------------------------
        var mfaStatus = await _mfaService.GetStatusAsync(user.Id, cancellationToken);
        if (mfaStatus.IsEnabled)
        {
            var ticket = GenerateTwoFactorTicket(user.Id, platformRoles);
            return Ok(ApiResponse<TwoFactorChallengeDto>.Ok(new TwoFactorChallengeDto
            {
                RequiresTwoFactor = true,
                Ticket = ticket.Token,
                TicketExpiresAt = ticket.ExpiresAt
            }));
        }

        // ----- Pas de 2FA, login complet immédiat --------------------------
        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);
        var tokens = await GeneratePlatformTokensAsync(user, platformRoles, cancellationToken);

        _logger.LogInformation("Platform user {Email} logged in successfully with roles [{Roles}]",
            dto.Email, string.Join(",", platformRoles));

        return Ok(ApiResponse<PlatformAuthResponseDto>.Ok(tokens, "Connexion réussie"));
    }

    [HttpPost("refresh")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ApiResponse<PlatformAuthResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> RefreshToken([FromBody] RefreshTokenDto dto, CancellationToken cancellationToken)
    {
        var refreshTokenHash = RefreshTokenHasher.Hash(dto.RefreshToken);
        var user = await _masterContext.Users
            .FirstOrDefaultAsync(u => u.RefreshToken == refreshTokenHash, cancellationToken);

        // Compatibilité : tokens émis avant le passage au stockage haché (rotation ré-écrit en hash).
        // À retirer après le 2026-07-31 (durée de vie max des refresh tokens : 7 jours).
        user ??= await _masterContext.Users
            .FirstOrDefaultAsync(u => u.RefreshToken == dto.RefreshToken, cancellationToken);

        if (user is null || user.RefreshTokenExpiryTime <= DateTime.UtcNow)
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Token de rafraîchissement invalide ou expiré"));

        var platformRoles = await GetPlatformRolesAsync(user);
        if (platformRoles.Count == 0 || user.TenantId != Guid.Empty)
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Token de rafraîchissement invalide ou expiré"));

        var tokens = await GeneratePlatformTokensAsync(user, platformRoles, cancellationToken);
        return Ok(ApiResponse<PlatformAuthResponseDto>.Ok(tokens));
    }

    [HttpPost("logout")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Logout()
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var jtiClaim = User.FindFirst(JwtRegisteredClaimNames.Jti)?.Value;

        if (userId is not null && Guid.TryParse(userId, out var actorId))
        {
            var user = await _userManager.FindByIdAsync(userId);
            if (user is not null)
            {
                user.RefreshToken = null;
                user.RefreshTokenExpiryTime = null;
                await _userManager.UpdateAsync(user);
            }

            // Lot B4 : révoque la session courante (le user pourra re-login derrière).
            if (Guid.TryParse(jtiClaim, out var jwtId))
            {
                var session = await _masterContext.UserSessions
                    .FirstOrDefaultAsync(s => s.JwtId == jwtId);
                if (session is not null)
                {
                    await _sessionService.RevokeAsync(session.Id, actorId, "Logout");
                }
            }
        }

        return Ok(ApiResponse<object>.Ok(null!, "Déconnexion réussie"));
    }

    [HttpGet("me/permissions")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<PlatformMePermissionsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> MyPermissions()
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userId is null)
            return Unauthorized(ApiResponse<PlatformMePermissionsDto>.Fail("Non authentifié."));

        var user = await _userManager.FindByIdAsync(userId);
        if (user is null)
            return Unauthorized(ApiResponse<PlatformMePermissionsDto>.Fail("Utilisateur introuvable."));

        var roles = await GetPlatformRolesAsync(user);
        var permissions = RolePermissionMatrix.ComputeEffectivePermissions(roles).OrderBy(p => p).ToList();

        return Ok(ApiResponse<PlatformMePermissionsDto>.Ok(new PlatformMePermissionsDto
        {
            UserId = user.Id,
            Email = user.Email!,
            Roles = roles,
            Permissions = permissions,
            Features = new Dictionary<string, bool>
            {
                // Consommé par le backoffice pour ne pas offrir la création de cabinet quand
                // l'endpoint répondrait 404 (PlatformTenantProvisioningController.CreateAccountingFirm).
                ["accountingFirms"] = _accountingFirmsFeature.IsEnabled
            }
        }));
    }

    /// <summary>Profil détaillé de l'administrateur courant.</summary>
    [HttpGet("me")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<PlatformMeProfileDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetMe(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized(ApiResponse<PlatformMeProfileDto>.Fail("Non authentifié."));

        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null || user.TenantId != Guid.Empty)
            return Unauthorized(ApiResponse<PlatformMeProfileDto>.Fail("Utilisateur introuvable."));

        var roles = await GetPlatformRolesAsync(user);
        if (roles.Count == 0)
            return Unauthorized(ApiResponse<PlatformMeProfileDto>.Fail("Compte non autorisé."));

        var mfaStatus = await _mfaService.GetStatusAsync(userId, cancellationToken);

        return Ok(ApiResponse<PlatformMeProfileDto>.Ok(new PlatformMeProfileDto
        {
            Id = user.Id,
            Email = user.Email!,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Roles = roles,
            LastLoginAt = user.LastLoginAt,
            IsMfaEnabled = mfaStatus.IsEnabled
        }));
    }

    /// <summary>Met à jour le profil de l'administrateur courant (nom + mot de passe optionnel).</summary>
    [HttpPut("me")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<PlatformMeProfileDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UpdateMe(
        [FromBody] UpdatePlatformMeProfileRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponse<PlatformMeProfileDto>.Fail("Requête invalide."));

        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized(ApiResponse<PlatformMeProfileDto>.Fail("Non authentifié."));

        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null || user.TenantId != Guid.Empty)
            return Unauthorized(ApiResponse<PlatformMeProfileDto>.Fail("Utilisateur introuvable."));

        var roles = await GetPlatformRolesAsync(user);
        if (roles.Count == 0)
            return Unauthorized(ApiResponse<PlatformMeProfileDto>.Fail("Compte non autorisé."));

        user.FirstName = request.FirstName.Trim();
        user.LastName = request.LastName.Trim();

        var hasPasswordChange = !string.IsNullOrWhiteSpace(request.NewPassword)
            || !string.IsNullOrWhiteSpace(request.CurrentPassword);

        if (hasPasswordChange)
        {
            if (string.IsNullOrWhiteSpace(request.CurrentPassword)
                || string.IsNullOrWhiteSpace(request.NewPassword)
                || string.IsNullOrWhiteSpace(request.ConfirmNewPassword))
            {
                return BadRequest(ApiResponse<PlatformMeProfileDto>.Fail(
                    "Pour changer le mot de passe, renseignez le mot de passe actuel, le nouveau et sa confirmation."));
            }

            if (!string.Equals(request.NewPassword, request.ConfirmNewPassword, StringComparison.Ordinal))
                return BadRequest(ApiResponse<PlatformMeProfileDto>.Fail("La confirmation du mot de passe ne correspond pas."));

            var passwordResult = await _userManager.ChangePasswordAsync(
                user, request.CurrentPassword, request.NewPassword);
            if (!passwordResult.Succeeded)
            {
                var msg = string.Join(" ", passwordResult.Errors.Select(e => e.Description));
                return BadRequest(ApiResponse<PlatformMeProfileDto>.Fail(msg));
            }
        }

        var updateResult = await _userManager.UpdateAsync(user);
        if (!updateResult.Succeeded)
        {
            var msg = string.Join(" ", updateResult.Errors.Select(e => e.Description));
            return BadRequest(ApiResponse<PlatformMeProfileDto>.Fail(msg));
        }

        var mfaStatus = await _mfaService.GetStatusAsync(userId, cancellationToken);

        _logger.LogInformation("Platform user {UserId} updated profile", userId);

        return Ok(ApiResponse<PlatformMeProfileDto>.Ok(new PlatformMeProfileDto
        {
            Id = user.Id,
            Email = user.Email!,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Roles = roles,
            LastLoginAt = user.LastLoginAt,
            IsMfaEnabled = mfaStatus.IsEnabled
        }, "Profil mis à jour."));
    }

    /// <summary>Sessions actives de l'administrateur courant (self-service).</summary>
    [HttpGet("me/sessions")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<UserSessionsPageDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> MySessions(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized(ApiResponse<UserSessionsPageDto>.Fail("Non authentifié."));

        var result = await _sessionService.ListByUserAsync(userId, page, pageSize, cancellationToken);
        return Ok(ApiResponse<UserSessionsPageDto>.Ok(result));
    }

    /// <summary>Tentatives de connexion échouées pour l'email de l'administrateur courant.</summary>
    [HttpGet("me/failed-logins")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<FailedLoginAttemptsPageDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> MyFailedLogins(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        CancellationToken cancellationToken = default)
    {
        var email = User.FindFirst(ClaimTypes.Email)?.Value;
        if (string.IsNullOrWhiteSpace(email))
            return Unauthorized(ApiResponse<FailedLoginAttemptsPageDto>.Fail("Non authentifié."));

        var result = await _failedLogins.ListAsync(email, null, null, null, page, pageSize, cancellationToken);
        return Ok(ApiResponse<FailedLoginAttemptsPageDto>.Ok(result));
    }

    // ============================================================================
    //  Lot B2 — Endpoints 2FA TOTP
    // ============================================================================

    [HttpGet("2fa/status")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<MfaStatusDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Get2faStatus(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized(ApiResponse<MfaStatusDto>.Fail("Non authentifié."));
        var status = await _mfaService.GetStatusAsync(userId, cancellationToken);
        return Ok(ApiResponse<MfaStatusDto>.Ok(status));
    }

    [HttpPost("2fa/setup")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<MfaSetupDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Start2faSetup(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized(ApiResponse<MfaSetupDto>.Fail("Non authentifié."));
        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
            return Unauthorized(ApiResponse<MfaSetupDto>.Fail("Utilisateur introuvable."));

        var setup = await _mfaService.StartSetupAsync(userId, user.Email!, cancellationToken);
        return Ok(ApiResponse<MfaSetupDto>.Ok(setup));
    }

    [HttpPost("2fa/confirm")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<MfaConfirmDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Confirm2faSetup(
        [FromBody] MfaConfirmRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponse<MfaConfirmDto>.Fail("Code invalide."));
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized(ApiResponse<MfaConfirmDto>.Fail("Non authentifié."));

        var result = await _mfaService.ConfirmSetupAsync(userId, request.Code, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<MfaConfirmDto>.Fail(result.Error.Description, result.Error.Code));

        _logger.LogInformation("Platform user {UserId} confirmed 2FA setup", userId);
        return Ok(ApiResponse<MfaConfirmDto>.Ok(result.Value, "2FA activé. Conservez vos codes de récupération."));
    }

    [HttpPost("2fa/verify")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [ProducesResponseType(typeof(ApiResponse<PlatformAuthResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Verify2faLogin(
        [FromBody] MfaVerifyRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Requête invalide."));

        var ticket = ValidateTwoFactorTicket(request.Ticket);
        if (ticket is null)
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Ticket 2FA invalide ou expiré."));

        var user = await _userManager.FindByIdAsync(ticket.Value.UserId.ToString());
        if (user is null || !user.IsActive || user.TenantId != Guid.Empty)
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Compte introuvable."));

        var platformRoles = await GetPlatformRolesAsync(user);
        if (platformRoles.Count == 0)
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail("Compte non autorisé."));

        var trimmed = request.Code.Trim();
        Result verification;
        if (trimmed.Length == 6 && trimmed.All(char.IsDigit))
        {
            verification = await _mfaService.VerifyAsync(user.Id, trimmed, cancellationToken);
        }
        else
        {
            verification = await _mfaService.VerifyRecoveryCodeAsync(user.Id, trimmed, cancellationToken);
        }

        if (verification.IsFailure)
        {
            await _failedLogins.RecordAsync(user.Email ?? "", user.Id, GetIpAddress(), GetUserAgent(),
                FailedLoginReason.TwoFactorInvalid, null, cancellationToken);
            _logger.LogWarning("Platform user {UserId} 2FA verification failed: {Error}", user.Id, verification.Error.Description);
            return Unauthorized(ApiResponse<PlatformAuthResponseDto>.Fail(verification.Error.Description, verification.Error.Code));
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);
        var tokens = await GeneratePlatformTokensAsync(user, platformRoles, cancellationToken);

        _logger.LogInformation("Platform user {Email} logged in with 2FA", user.Email);
        return Ok(ApiResponse<PlatformAuthResponseDto>.Ok(tokens, "Connexion réussie"));
    }

    [HttpPost("2fa/disable")]
    [Authorize(Policy = PlatformPolicies.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Disable2fa(
        [FromBody] MfaDisableRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponse<object>.Fail("Requête invalide."));
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized(ApiResponse<object>.Fail("Non authentifié."));

        var result = await _mfaService.DisableAsync(userId, request.Password, request.Code, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));

        _logger.LogInformation("Platform user {UserId} disabled 2FA", userId);
        return Ok(ApiResponse<object>.Ok(null!, "2FA désactivé."));
    }

    // ============================================================================
    //  Helpers internes
    // ============================================================================

    private async Task<IReadOnlyList<string>> GetPlatformRolesAsync(ApplicationUser user)
    {
        var allRoles = await _userManager.GetRolesAsync(user);
        return allRoles.Where(PlatformRoles.IsKnownRole).ToList();
    }

    private string GetIpAddress() =>
        HttpContext?.Connection?.RemoteIpAddress?.ToString() ?? "unknown";

    private string? GetUserAgent() =>
        HttpContext?.Request?.Headers["User-Agent"].ToString();

    private (string Token, DateTime ExpiresAt) GenerateTwoFactorTicket(Guid userId, IReadOnlyList<string> roles)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings["SecretKey"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var expires = DateTime.UtcNow.AddMinutes(5);

        var token = new JwtSecurityToken(
            issuer: jwtSettings["Issuer"],
            audience: TwoFactorPendingAudience,
            claims: new[]
            {
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim("ticket_purpose", "2fa")
            },
            expires: expires,
            signingCredentials: credentials);

        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }

    private (Guid UserId, DateTime ExpiresAt)? ValidateTwoFactorTicket(string ticket)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var handler = new JwtSecurityTokenHandler();

        try
        {
            var parameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = jwtSettings["Issuer"],
                ValidAudience = TwoFactorPendingAudience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings["SecretKey"]!)),
                ClockSkew = TimeSpan.Zero
            };

            var principal = handler.ValidateToken(ticket, parameters, out var validatedToken);
            if (validatedToken is not JwtSecurityToken jwt)
                return null;

            var purpose = principal.FindFirst("ticket_purpose")?.Value;
            if (purpose != "2fa")
                return null;

            var idValue = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!Guid.TryParse(idValue, out var userId))
                return null;

            return (userId, jwt.ValidTo);
        }
        catch (SecurityTokenException)
        {
            return null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private async Task<PlatformAuthResponseDto> GeneratePlatformTokensAsync(
        ApplicationUser user,
        IReadOnlyList<string> platformRoles,
        CancellationToken cancellationToken)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var permissions = RolePermissionMatrix.ComputeEffectivePermissions(platformRoles)
            .OrderBy(p => p)
            .ToList();

        // Lot B4 : un Jti unique par session (claim "jti") pour permettre l'invalidation côté serveur.
        var jwtId = Guid.NewGuid();

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email!),
            new(ClaimTypes.GivenName, user.FirstName),
            new(ClaimTypes.Surname, user.LastName),
            new(JwtRegisteredClaimNames.Jti, jwtId.ToString())
        };

        // Révocation immédiate (plan §6 Phase 2.5) : même claim sstamp que TenantAuthTokenService,
        // vérifié par le même OnTokenValidated (même scheme JWT). Sans ce claim, tous les tokens
        // plateforme seraient rejetés dès que RequireSecurityStampClaim=true (étape 2 du rollout).
        if (!string.IsNullOrEmpty(user.SecurityStamp))
            claims.Add(new Claim(AuthClaimTypes.SecurityStamp, user.SecurityStamp));

        foreach (var role in platformRoles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }
        foreach (var permission in permissions)
        {
            claims.Add(new Claim(AuthClaimTypes.Permission, permission));
        }

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
        var refreshTokenExpiry = DateTime.UtcNow.AddDays(7);

        user.RefreshToken = RefreshTokenHasher.Hash(refreshToken);
        user.RefreshTokenExpiryTime = refreshTokenExpiry;
        await _userManager.UpdateAsync(user);

        // Lot B4 : enregistre la session active.
        await _sessionService.RecordAsync(
            user.Id,
            jwtId,
            refreshToken,
            GetIpAddress(),
            GetUserAgent(),
            refreshTokenExpiry, // on aligne ExpiresAt sur le refresh token (15 min access + 7j refresh)
            tenantId: null,
            cancellationToken);

        return new PlatformAuthResponseDto
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken,
            ExpiresAt = expiry,
            User = new PlatformUserDto
            {
                Id = user.Id,
                Email = user.Email!,
                FirstName = user.FirstName,
                LastName = user.LastName,
                Roles = platformRoles,
                Permissions = permissions
            }
        };
    }
}
