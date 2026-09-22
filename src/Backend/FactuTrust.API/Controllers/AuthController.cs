using System.Diagnostics;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using FactuTrust.API.Http;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Logging;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.SectorConfiguration;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly SignInManager<ApplicationUser> _signInManager;
    private readonly MasterDbContext _masterContext;
    private readonly ITenantService _tenantService;
    private readonly ITenantAuthTokenService _tokenService;
    private readonly IConfiguration _configuration;
    private readonly IEffectivePermissionService _effectivePermissionService;
    private readonly IAccountingFirmsFeature _accountingFirmsFeature;
    private readonly IPublicRegistrationFeature _publicRegistrationFeature;
    private readonly IAccountingFirmRegistrationService _accountingFirmRegistrationService;
    private readonly ICompanyRegistrationService _companyRegistrationService;
    private readonly FirmGovernanceOptions _firmGovernanceOptions;
    private readonly AccountingFirmsOptions _accountingFirmsOptions;
    private readonly AccountingSettings _accountingSettings;
    private readonly IEmailService _emailService;
    private readonly IClientPortalService _clientPortalService;
    private readonly IFirmContextService _firmContextService;
    private readonly IRegistrationSectorService _registrationSectorService;
    private readonly ISectorCatalogProvider _sectorCatalogProvider;
    private readonly RegistrationSectorOptions _registrationSectorOptions;
    private readonly EmailVerificationOptions _emailVerificationOptions;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager,
        MasterDbContext masterContext,
        ITenantService tenantService,
        ITenantAuthTokenService tokenService,
        IConfiguration configuration,
        IEffectivePermissionService effectivePermissionService,
        IAccountingFirmsFeature accountingFirmsFeature,
        IPublicRegistrationFeature publicRegistrationFeature,
        IAccountingFirmRegistrationService accountingFirmRegistrationService,
        ICompanyRegistrationService companyRegistrationService,
        IOptions<FirmGovernanceOptions> firmGovernanceOptions,
        IOptions<AccountingFirmsOptions> accountingFirmsOptions,
        IOptions<AccountingSettings> accountingSettings,
        IEmailService emailService,
        IClientPortalService clientPortalService,
        IFirmContextService firmContextService,
        IRegistrationSectorService registrationSectorService,
        ISectorCatalogProvider sectorCatalogProvider,
        IOptions<RegistrationSectorOptions> registrationSectorOptions,
        IOptions<EmailVerificationOptions> emailVerificationOptions,
        ILogger<AuthController> logger)
    {
        _userManager = userManager;
        _signInManager = signInManager;
        _masterContext = masterContext;
        _tenantService = tenantService;
        _tokenService = tokenService;
        _configuration = configuration;
        _effectivePermissionService = effectivePermissionService;
        _accountingFirmsFeature = accountingFirmsFeature;
        _publicRegistrationFeature = publicRegistrationFeature;
        _accountingFirmRegistrationService = accountingFirmRegistrationService;
        _companyRegistrationService = companyRegistrationService;
        _firmGovernanceOptions = firmGovernanceOptions.Value;
        _accountingFirmsOptions = accountingFirmsOptions.Value;
        _accountingSettings = accountingSettings.Value;
        _emailService = emailService;
        _clientPortalService = clientPortalService;
        _firmContextService = firmContextService;
        _registrationSectorService = registrationSectorService;
        _sectorCatalogProvider = sectorCatalogProvider;
        _registrationSectorOptions = registrationSectorOptions.Value;
        _emailVerificationOptions = emailVerificationOptions.Value;
        _logger = logger;
    }

    /// <summary>
    /// Register a new user and create their company.
    /// </summary>
    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("register")]
    [ProducesResponseType(typeof(ApiResponse<AuthResponseDto>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Register([FromBody] RegisterDto dto, CancellationToken cancellationToken)
    {
        if (!_publicRegistrationFeature.IsCompanyEnabled)
            return NotFound();

        var result = await _companyRegistrationService.RegisterAsync(
            dto,
            CompanyRegistrationContext.Public(),
            cancellationToken);

        return MapCompanyRegistrationToActionResult(result);
    }

    /// <summary>
    /// Suffixe le message d'une référence de corrélation exploitable par le support. Le format
    /// <c>(réf. REG-xxxx)</c> est celui que le backoffice sait extraire (<c>api-error.ts</c>).
    /// </summary>
    private static string WithSupportReference(string message, string? correlationId) =>
        string.IsNullOrWhiteSpace(correlationId)
            ? message
            : $"{message} (réf. REG-{correlationId})";

    private IActionResult MapCompanyRegistrationToActionResult(CompanyRegistrationResult result)
    {
        if (result.Success && result.Tokens is not null)
            return CreatedAtAction(nameof(Login), ApiResponse<AuthResponseDto>.Ok(result.Tokens, "Inscription réussie"));

        return result.FailureKind switch
        {
            CompanyRegistrationFailureKind.Validation or CompanyRegistrationFailureKind.IdentityError or CompanyRegistrationFailureKind.DuplicateEmail =>
                BadRequest(ApiResponse<AuthResponseDto>.Fail(string.Join(", ", result.Errors))),
            CompanyRegistrationFailureKind.ConflictNif =>
                Conflict(ApiResponse<AuthResponseDto>.Fail(result.ErrorMessage ?? "Conflit matricule fiscal.")),
            CompanyRegistrationFailureKind.ProvisioningFailed or CompanyRegistrationFailureKind.Internal =>
                StatusCode(
                    StatusCodes.Status500InternalServerError,
                    // Le 2e paramètre de Fail() n'est pas sérialisé (cf. ApiResponse<T>) : la
                    // référence support était calculée puis perdue. On l'inclut dans le message,
                    // comme le fait déjà le provisionnement plateforme.
                    ApiResponse<AuthResponseDto>.Fail(
                        WithSupportReference(
                            result.ErrorMessage ?? "L'inscription n'a pas pu être finalisée.",
                            result.CorrelationId))),
            _ => StatusCode(StatusCodes.Status500InternalServerError, ApiResponse<AuthResponseDto>.Fail("Erreur inattendue."))
        };
    }

    /// <summary>
    /// Plan §1.6 — generates an ASP.NET Core Identity email-confirmation token (default 24h
    /// lifespan, no custom <c>TokenLifespan</c> configured) and emails the verification link.
    /// Never throws: a delivery failure must not fail registration or the resend endpoint's
    /// caller — it is logged and the caller still gets its generic success response, exactly like
    /// <see cref="ForgotPassword"/> already does for password reset emails.
    /// </summary>
    private async Task SendVerificationEmailAsync(ApplicationUser user, CancellationToken cancellationToken)
    {
        try
        {
            var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
            var frontendBase = _configuration["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";
            var verifyUrl =
                $"{frontendBase}/auth/verify-email?email={Uri.EscapeDataString(user.Email!)}&token={Uri.EscapeDataString(token)}";

            var recipientName = $"{user.FirstName} {user.LastName}".Trim();
            if (string.IsNullOrWhiteSpace(recipientName))
                recipientName = user.Email!;

            var htmlBody = $"""
                <p>Bonjour <strong>{System.Net.WebUtility.HtmlEncode(recipientName)}</strong>,</p>
                <p>Merci de vous être inscrit sur InstaFact. Confirmez votre adresse email pour finaliser votre inscription.</p>
                <p><a href="{verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Vérifier mon adresse email</a></p>
                <p style="color:#666;font-size:12px;">Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email. Ce lien expire après 24 heures.</p>
                """;

            await _emailService.SendEmailAsync(
                user.Email!,
                "Vérifiez votre adresse email InstaFact",
                htmlBody,
                cancellationToken: cancellationToken);

            _logger.LogInformation("Verification email queued for {Email}", LogSanitizer.MaskEmail(user.Email!));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send verification email for {Email}", LogSanitizer.MaskEmail(user.Email ?? "<null>"));
        }
    }

    /// <summary>
    /// Confirms a user's email using the token sent by <see cref="SendVerificationEmailAsync"/>
    /// (plan §1.6). No-ops (still returns success) if the account is already confirmed, so
    /// double-clicking the email link or replaying an old link on an already-verified account is
    /// harmless.
    /// </summary>
    [HttpPost("verify-email")]
    [AllowAnonymous]
    [EnableRateLimiting("email-verification")]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> VerifyEmail([FromBody] VerifyEmailDto dto, CancellationToken cancellationToken)
    {
        if (!_emailVerificationOptions.Enabled)
            return NotFound(ApiResponse<object>.Fail("La vérification d'email n'est pas activée."));

        if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Token))
            return BadRequest(ApiResponse<object>.Fail("Email et jeton de vérification requis."));

        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());
        if (user is null)
            return BadRequest(ApiResponse<object>.Fail("Jeton de vérification invalide ou expiré."));

        if (user.EmailConfirmed)
            return Ok(ApiResponse<object>.Ok(null!, "Votre adresse email est déjà vérifiée."));

        var result = await _userManager.ConfirmEmailAsync(user, dto.Token);
        if (!result.Succeeded)
        {
            var errors = IdentityErrorTranslator.TranslateToFrench(result.Errors);
            return BadRequest(ApiResponse<object>.Fail(errors));
        }

        _logger.LogInformation("Email verified for {Email}", LogSanitizer.MaskEmail(dto.Email));

        return Ok(ApiResponse<object>.Ok(null!, "Votre adresse email a été vérifiée avec succès."));
    }

    /// <summary>
    /// Re-sends the verification email (plan §1.6). Always returns the same generic success
    /// message regardless of whether the account exists, to avoid email enumeration — mirrors
    /// <see cref="ForgotPassword"/>.
    /// </summary>
    [HttpPost("resend-verification")]
    [AllowAnonymous]
    [EnableRateLimiting("email-verification")]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ResendVerification([FromBody] ResendVerificationDto dto, CancellationToken cancellationToken)
    {
        if (!_emailVerificationOptions.Enabled)
            return NotFound(ApiResponse<object>.Fail("La vérification d'email n'est pas activée."));

        if (string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest(ApiResponse<object>.Fail("L'adresse email est requise."));

        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());
        if (user is not null && user.IsActive && !user.EmailConfirmed)
            await SendVerificationEmailAsync(user, cancellationToken);

        return Ok(ApiResponse<object>.Ok(
            null!,
            "Si un compte non vérifié existe avec cette adresse email, un nouvel email de vérification a été envoyé."));
    }

    /// <summary>
    /// Authenticate user and return JWT tokens.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [ProducesResponseType(typeof(ApiResponse<AuthResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login([FromBody] LoginDto dto, CancellationToken cancellationToken)
    {
        var user = await _userManager.FindByEmailAsync(dto.Email);
        if (user is null || !user.IsActive)
        {
            _logger.LogWarning("Login failed for {Email}: user not found or inactive", LogSanitizer.MaskEmail(dto.Email));
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Email ou mot de passe incorrect"));
        }

        var result = await _signInManager.CheckPasswordSignInAsync(user, dto.Password, lockoutOnFailure: true);

        if (result.IsLockedOut)
        {
            _logger.LogWarning("User {Email} is locked out", LogSanitizer.MaskEmail(dto.Email));
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Compte verrouillé. Réessayez dans 15 minutes."));
        }

        if (!result.Succeeded)
        {
            _logger.LogWarning("Login failed for {Email}: invalid password", LogSanitizer.MaskEmail(dto.Email));
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Email ou mot de passe incorrect"));
        }

        var portalGate = await _clientPortalService.EnsurePortalLoginAllowedAsync(user.Id, cancellationToken);
        if (portalGate.IsFailure)
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<AuthResponseDto>.Fail(portalGate.Error.Description));

        // Check 2FA
        if (result.RequiresTwoFactor)
        {
            return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
            {
                Requires2Fa = true,
                User = await BuildUserProfileDtoAsync(user, null, cancellationToken)
            }));
        }

        if (user.TenantId == Guid.Empty)
        {
            _logger.LogWarning("User {Email} has no company (TenantId empty)", LogSanitizer.MaskEmail(user.Email));
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Aucune entreprise associée à ce compte. Veuillez contacter l'administrateur."));
        }

        var tenant = await _masterContext.Tenants.FindAsync(new object[] { user.TenantId }, cancellationToken);
        if (tenant is null || !tenant.IsActive)
        {
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Entreprise inactive ou introuvable"));
        }

        // Plan §1.5 (provisioning mini-saga): a Pending/Failed tenant has no working database yet
        // (provisioning still running, or it failed and is queued for orphan cleanup) — refuse login
        // with a clear message instead of letting the request through to a broken tenant context.
        if (tenant.ProvisioningStatus != TenantProvisioningStatus.Ready)
        {
            _logger.LogWarning(
                "Login refused for {Email}: tenant {TenantId} provisioning status is {Status}",
                LogSanitizer.MaskEmail(dto.Email),
                tenant.Id,
                tenant.ProvisioningStatus);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail(
                "La configuration de votre entreprise est en cours de finalisation. Réessayez dans quelques instants ou contactez le support si le problème persiste."));
        }

        // Plan §1.6 (D3 "mode doux") : ne bloque la connexion que si les deux flags sont actifs.
        // Enabled=false (défaut) ou BlockLoginIfUnverified=false laisse passer, quel que soit
        // EmailConfirmed — ce qui couvre aussi tous les comptes créés avant l'activation du flag.
        if (_emailVerificationOptions.Enabled && _emailVerificationOptions.BlockLoginIfUnverified && !user.EmailConfirmed)
        {
            _logger.LogWarning("Login refused for {Email}: email not verified.", LogSanitizer.MaskEmail(dto.Email));
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail(
                "Veuillez vérifier votre adresse email avant de vous connecter. Consultez votre boîte de réception ou demandez un nouvel email de vérification."));
        }

        // Update last login
        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);

        var tokens = await _tokenService.GenerateTokensAsync(user.Id, tenant.Id, cancellationToken: cancellationToken);

        _logger.LogInformation("User {Email} logged in successfully", LogSanitizer.MaskEmail(dto.Email));

        return Ok(ApiResponse<AuthResponseDto>.Ok(tokens, "Connexion réussie"));
    }

    /// <summary>
    /// Request a password reset link by email (always returns success to prevent email enumeration).
    /// </summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting("password-reset")]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordDto dto, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest(ApiResponse<object>.Fail("L'adresse email est requise."));

        var email = dto.Email.Trim();
        var user = await _userManager.FindByEmailAsync(email);

        if (user is not null && user.IsActive)
        {
            var tenantActive = user.TenantId != Guid.Empty;
            if (tenantActive)
            {
                var tenant = await _masterContext.Tenants.FindAsync(new object[] { user.TenantId }, cancellationToken);
                tenantActive = tenant is not null && tenant.IsActive;
            }

            if (tenantActive)
            {
                try
                {
                    var token = await _userManager.GeneratePasswordResetTokenAsync(user);
                    var frontendBase = _configuration["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";
                    var resetUrl =
                        $"{frontendBase}/auth/reset-password?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";

                    var recipientName = $"{user.FirstName} {user.LastName}".Trim();
                    if (string.IsNullOrWhiteSpace(recipientName))
                        recipientName = email;

                    var htmlBody = $"""
                        <p>Bonjour <strong>{System.Net.WebUtility.HtmlEncode(recipientName)}</strong>,</p>
                        <p>Vous avez demandé la réinitialisation de votre mot de passe InstaFact.</p>
                        <p><a href="{resetUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Réinitialiser mon mot de passe</a></p>
                        <p style="color:#666;font-size:12px;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Ce lien expire après un court délai.</p>
                        """;

                    await _emailService.SendEmailAsync(
                        email,
                        "Réinitialisation de votre mot de passe InstaFact",
                        htmlBody,
                        cancellationToken: cancellationToken);

                    _logger.LogInformation("Password reset email queued for {Email}", LogSanitizer.MaskEmail(email));
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send password reset email for {Email}", LogSanitizer.MaskEmail(email));
                }
            }
        }

        return Ok(ApiResponse<object>.Ok(
            null!,
            "Si un compte existe avec cette adresse email, un lien de réinitialisation a été envoyé."));
    }

    /// <summary>
    /// Reset password using token from email link.
    /// </summary>
    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting("password-reset")]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordDto dto, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Token))
            return BadRequest(ApiResponse<object>.Fail("Email et jeton de réinitialisation requis."));

        if (string.IsNullOrWhiteSpace(dto.NewPassword))
            return BadRequest(ApiResponse<object>.Fail("Le nouveau mot de passe est requis."));

        if (!string.Equals(dto.NewPassword, dto.ConfirmNewPassword, StringComparison.Ordinal))
            return BadRequest(ApiResponse<object>.Fail("Les mots de passe ne correspondent pas."));

        var user = await _userManager.FindByEmailAsync(dto.Email.Trim());
        if (user is null)
            return BadRequest(ApiResponse<object>.Fail("Jeton de réinitialisation invalide ou expiré."));

        var result = await _userManager.ResetPasswordAsync(user, dto.Token, dto.NewPassword);
        if (!result.Succeeded)
        {
            var errors = IdentityErrorTranslator.TranslateToFrench(result.Errors);
            return BadRequest(ApiResponse<object>.Fail(errors));
        }

        user.RefreshToken = null;
        user.RefreshTokenExpiryTime = null;
        await _userManager.UpdateAsync(user);

        _logger.LogInformation("Password reset successful for {Email}", LogSanitizer.MaskEmail(dto.Email));

        return Ok(ApiResponse<object>.Ok(null!, "Votre mot de passe a été réinitialisé avec succès."));
    }

    /// <summary>
    /// Refresh access token using refresh token.
    /// </summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ApiResponse<AuthResponseDto>), StatusCodes.Status200OK)]
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
        {
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Token de rafraîchissement invalide ou expiré"));
        }

        if (user.TenantId == Guid.Empty)
        {
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Aucune entreprise associée à ce compte. Veuillez contacter l'administrateur."));
        }

        var tenant = await _masterContext.Tenants.FindAsync(new object[] { user.TenantId }, cancellationToken);
        if (tenant is null)
        {
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Entreprise introuvable"));
        }

        var portalGate = await _clientPortalService.EnsurePortalLoginAllowedAsync(user.Id, cancellationToken);
        if (portalGate.IsFailure)
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<AuthResponseDto>.Fail(portalGate.Error.Description));

        // Session de cabinet positionnée sur un dossier client : le contexte délégué doit survivre au
        // rafraîchissement. Sans cela, le nouveau jeton repartait en mode « native » sur le tenant du
        // cabinet, et l'intercepteur front rejouait la requête en silence : au bout de 15 minutes, le
        // collaborateur lisait la base DU CABINET en croyant être resté dans le dossier.
        if (user.RefreshContextTenantId is { } contextTenantId && contextTenantId != Guid.Empty)
        {
            var restored = await _firmContextService.TryRestoreDelegatedContextAsync(
                user.Id, tenant.Id, contextTenantId, cancellationToken);

            if (restored is not null)
                return Ok(ApiResponse<AuthResponseDto>.Ok(restored));

            // Affectation révoquée, portée retirée ou dossier désactivé entre-temps : on ne bloque pas
            // la session, on la ramène au cabinet. La colonne est remise à null par l'émission du
            // jeton natif ci-dessous.
            _logger.LogInformation(
                "Refresh: contexte dossier {ContextTenantId} non rétabli pour l'utilisateur {UserId} "
                + "(affectation révoquée, portée retirée ou dossier inactif) — retour au cabinet.",
                contextTenantId,
                user.Id);
        }

        var tokens = await _tokenService.GenerateTokensAsync(user.Id, tenant.Id, cancellationToken: cancellationToken);

        return Ok(ApiResponse<AuthResponseDto>.Ok(tokens));
    }

    /// <summary>
    /// Logout and invalidate refresh token.
    /// </summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userId is not null && Guid.TryParse(userId, out var id))
        {
            var user = await _userManager.FindByIdAsync(userId);
            if (user is not null)
            {
                user.RefreshToken = null;
                user.RefreshTokenExpiryTime = null;
                await _userManager.UpdateAsync(user);
            }
        }

        return Ok(ApiResponse<object>.Ok(null!, "Déconnexion réussie"));
    }

    /// <summary>
    /// Returns the current authenticated user with fresh permissions and modules
    /// computed from the database, without rotating the JWT or refresh token.
    /// Used by the front-end at app boot to re-sync the locally stored user with
    /// backend permission/module changes (role updates, grant changes) without
    /// forcing a logout.
    /// </summary>
    [HttpGet("me")]
    [Authorize]
    [ProducesResponseType(typeof(ApiResponse<UserDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(ApiResponse<UserDto>.Fail("Identité utilisateur invalide"));
        }

        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return Unauthorized(ApiResponse<UserDto>.Fail("Utilisateur introuvable"));
        }

        Tenant? tenant = null;
        if (user.TenantId != Guid.Empty)
        {
            tenant = await _masterContext.Tenants.FindAsync(new object[] { user.TenantId }, cancellationToken);
        }

        var dto = await BuildUserProfileDtoAsync(user, tenant, cancellationToken);
        return Ok(ApiResponse<UserDto>.Ok(dto));
    }

    /// <summary>
    /// Register a new accounting firm and its manager user.
    /// </summary>
    [HttpPost("register-firm")]
    [AllowAnonymous]
    [EnableRateLimiting("register")]
    [ProducesResponseType(typeof(ApiResponse<AuthResponseDto>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RegisterFirm([FromBody] RegisterAccountingFirmDto dto, CancellationToken cancellationToken)
    {
        if (!_publicRegistrationFeature.IsFirmEnabled)
            return NotFound();

        if (!_accountingFirmsFeature.IsEnabled)
            return NotFound();

        var result = await _accountingFirmRegistrationService.RegisterAsync(
            dto,
            AccountingFirmRegistrationContext.Public(),
            cancellationToken);

        if (result.Success && result.Tokens is not null)
        {
            return CreatedAtAction(
                nameof(Login),
                ApiResponse<AuthResponseDto>.Ok(result.Tokens, "Inscription cabinet réussie"));
        }

        return result.FailureKind switch
        {
            AccountingFirmRegistrationFailureKind.Validation =>
                BadRequest(ApiResponse<AuthResponseDto>.Fail(
                    string.Join(", ", result.Errors))),
            AccountingFirmRegistrationFailureKind.DuplicateEmail =>
                BadRequest(ApiResponse<AuthResponseDto>.Fail(
                    string.Join(", ", result.Errors))),
            AccountingFirmRegistrationFailureKind.ConflictNif =>
                Conflict(ApiResponse<AuthResponseDto>.Fail(
                    string.Join(", ", result.Errors))),
            _ => StatusCode(
                StatusCodes.Status500InternalServerError,
                ApiResponse<AuthResponseDto>.Fail(
                    result.Errors.FirstOrDefault() ?? "L'inscription du cabinet n'a pas pu être finalisée.",
                    $"FIRM-{result.CorrelationId}"))
        };
    }

    private async Task<UserDto> BuildUserProfileDtoAsync(ApplicationUser user, Tenant? tenant, CancellationToken cancellationToken)
    {
        var roles = await _userManager.GetRolesAsync(user);
        var snapshot = await _effectivePermissionService.GetUserAccessSnapshotAsync(user.Id, cancellationToken);
        return CreateUserDto(user, tenant, snapshot, roles);
    }

    private UserDto CreateUserDto(ApplicationUser user, Tenant? tenant, UserAccessSnapshot snapshot, IList<string> roles)
    {
        var roleName = roles.FirstOrDefault(r => !string.Equals(r, PlatformRoles.PlatformAdmin, StringComparison.Ordinal))
            ?? UserRole.Accountant.ToString();
        var roleEnum = Enum.TryParse<UserRole>(roleName, out var r) ? r : UserRole.Accountant;

        IReadOnlyList<int> enabledModuleIds;
        IReadOnlyList<string> effectivePermissions;
        if (tenant?.Kind == TenantKind.AccountingFirm)
        {
            enabledModuleIds = FirmGovernanceNativeAccess.BuildNativeFirmModuleIds(_firmGovernanceOptions);
            effectivePermissions = FirmGovernanceNativeAccess.AugmentNativeFirmPermissions(
                snapshot.EffectivePermissions.ToList(),
                roleEnum,
                _firmGovernanceOptions,
                _accountingFirmsOptions);
        }
        else
        {
            enabledModuleIds = snapshot.EnabledModules.Select(m => (int)m).ToList();
            effectivePermissions = snapshot.EffectivePermissions.ToList();
        }

        // Miroir obligatoire du filtre applique a l'emission du JWT
        // (TenantAuthTokenService) : sans lui, /auth/me renverrait une permission que le jeton
        // ne porte pas, et le bouton d'ecriture resterait affiche.
        effectivePermissions = AccountingCurrencyAccess
            .FilterWhenDisabled(effectivePermissions, _accountingSettings.MultiCurrencyEnabled);

        return new UserDto
        {
            Id = user.Id,
            Email = user.Email!,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = roleEnum,
            RoleDisplay = roleEnum.ToDisplayString(),
            TenantId = user.TenantId,
            CompanyName = tenant?.CompanyName ?? "",
            TenantKind = tenant?.Kind ?? TenantKind.Company,
            AccessMode = "native",
            TwoFactorEnabled = user.TwoFactorEnabled,
            EnabledModuleIds = enabledModuleIds.ToList(),
            EffectivePermissions = effectivePermissions.ToList(),
            ProductOnboardingStatus = user.ProductOnboardingStatus,
            ProductOnboardingVersion = user.ProductOnboardingVersion,
            ProductOnboardingChecklist = ProductOnboardingUserDtoMapper.ChecklistOf(user),
            CompanySegment = tenant?.CompanySegment,
            BusinessDomain = tenant?.BusinessDomain,
            TenantCreatedAtUtc = tenant?.CreatedAt ?? DateTime.UtcNow
        };
    }

    /// <summary>
    /// Accept a client-portal invitation (anonymous). Sets password and issues a portal JWT.
    /// </summary>
    [HttpPost("portal/accept-invite")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [ProducesResponseType(typeof(ApiResponse<AuthResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> AcceptPortalInvite(
        [FromBody] AcceptPortalInviteRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _clientPortalService.AcceptInviteAsync(request, cancellationToken);
        if (result.IsFailure)
            return ResultHttp.ToError(this, result.Error);

        return Ok(ApiResponse<AuthResponseDto>.Ok(result.Value, "Invitation acceptée"));
    }
}
