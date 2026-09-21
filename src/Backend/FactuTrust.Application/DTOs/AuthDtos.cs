using System.ComponentModel.DataAnnotations;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// DTO for user registration.
/// </summary>
public sealed record RegisterDto
{
    public string Email { get; init; } = null!;
    public string Password { get; init; } = null!;
    public string ConfirmPassword { get; init; } = null!;
    public string FirstName { get; init; } = null!;
    public string LastName { get; init; } = null!;
    
    // Company information
    public string CompanyName { get; init; } = null!;
    public string Nif { get; init; } = null!;
    public TaxRegime TaxRegime { get; init; }
    
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string? PostalCode { get; init; }
    public string Governorate { get; init; } = null!;
    
    public string CompanyEmail { get; init; } = null!;
    public string Phone { get; init; } = null!;
    public string? Website { get; init; }
    
    // Stock configuration
    /// <summary>
    /// Name of the default warehouse created for the company.
    /// If not provided, defaults to "Entrepôt Principal".
    /// </summary>
    [System.Text.Json.Serialization.JsonPropertyName("warehouseName")]
    public string? WarehouseName { get; init; }

    // Sector-aware registration wizard (plan §3 C1/C2, §6.1 B3) — all optional; legacy clients
    // simply omit them, in which case the behavior is byte-identical to today.
    /// <summary>Code segment (catalogue sectoriel), ex. "commerce". Null = comportement historique.</summary>
    public string? CompanySegment { get; init; }

    /// <summary>Code domaine d'activité, ex. "sante-paramedical".</summary>
    public string? BusinessDomain { get; init; }

    /// <summary>AppModule ids (int) choisis à l'étape Configuration. Null = tous les modules (historique).</summary>
    public IReadOnlyList<int>? EnabledModules { get; init; }

    /// <summary>
    /// Lot 3 — réponses de profilage de l'étape Configuration. Entièrement facultatif : null
    /// (charge héritée) laisse l'inscription strictement identique à avant ce lot.
    ///
    /// Ces réponses ne sont JAMAIS rejouées côté serveur pour dériver des modules : le client
    /// envoie déjà sa sélection dans <see cref="EnabledModules"/>, qui reste seule soumise à la
    /// chaîne de validation (plafond du plan, dépendances, rejet de Honoraires). Elles sont
    /// uniquement normalisées puis persistées sur le tenant.
    /// </summary>
    public RegistrationProfileAnswersDto? ProfileAnswers { get; init; }
}

/// <summary>
/// Réponses de profilage de l'inscription (lot 3). Tous les champs sont nullables : <c>null</c>
/// signifie « question non posée ou sans réponse », jamais « non ».
/// </summary>
public sealed record RegistrationProfileAnswersDto
{
    /// <summary>L'entreprise gère-t-elle du stock physique ?</summary>
    public bool? HasPhysicalStock { get; init; }

    /// <summary>Vend-elle à des particuliers (B2C) ?</summary>
    public bool? SellsToConsumers { get; init; }

    /// <summary>
    /// Tranche d'effectif. Validée côté domaine contre <c>Tenant.AllowedHeadcountBands</c>
    /// ("1", "2-9", "10-49", "50+") : toute autre valeur est traitée comme absente et n'est
    /// jamais persistée.
    /// </summary>
    public string? HeadcountBand { get; init; }

    /// <summary>La comptabilité est-elle tenue par un cabinet externe ?</summary>
    public bool? AccountingDelegatedToFirm { get; init; }
}

/// <summary>
/// DTO for user login.
/// </summary>
public sealed record LoginDto
{
    public string Email { get; init; } = null!;
    public string Password { get; init; } = null!;
    public bool RememberMe { get; init; }
}

/// <summary>
/// DTO for 2FA verification.
/// </summary>
public sealed record Verify2FaDto
{
    public string Email { get; init; } = null!;
    public string Code { get; init; } = null!;
}

/// <summary>
/// DTO for authentication response.
/// </summary>
public sealed record AuthResponseDto
{
    public string AccessToken { get; init; } = null!;
    public string RefreshToken { get; init; } = null!;
    public DateTime ExpiresAt { get; init; }
    public UserDto User { get; init; } = null!;
    public bool Requires2Fa { get; init; }

    /// <summary>
    /// Non-blocking, French, human-readable warnings about the request (plan §1.2 — no silent
    /// rejections). Optional/additive: absent or empty for every existing flow that has nothing to
    /// report (e.g. login), so this never breaks an existing consumer of the contract. Registration
    /// populates it when part of the client's request was dropped or ignored (invalid module ids
    /// past the pre-check, modules denied by the plan ceiling, or a sector/module selection ignored
    /// because a kill-switch was off).
    /// </summary>
    public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Same warnings as <see cref="Warnings"/>, typed (code + severity) so the client can render
    /// each one correctly and offer a targeted action. Additive: a client that only reads
    /// <see cref="Warnings"/> keeps working, and <see cref="Warnings"/> is derived from this list
    /// so the two can never drift apart.
    /// </summary>
    public IReadOnlyList<RegistrationWarningDto> WarningDetails { get; init; } = Array.Empty<RegistrationWarningDto>();
}

/// <summary>
/// DTO for user information.
/// </summary>
public sealed record UserDto
{
    public Guid Id { get; init; }
    public string Email { get; init; } = null!;
    public string FirstName { get; init; } = null!;
    public string LastName { get; init; } = null!;
    public string FullName => $"{FirstName} {LastName}";
    /// <summary>
    /// Tenant role. JSON uses global API options: string enum in camelCase (e.g. <c>administrator</c>, <c>salesRep</c>).
    /// The Angular SPA normalizes to PascalCase at login for UI guards.
    /// </summary>
    public UserRole Role { get; init; }
    public string RoleDisplay { get; init; } = null!;
    public Guid TenantId { get; init; }
    public string CompanyName { get; init; } = null!;
    public TenantKind TenantKind { get; init; } = TenantKind.Company;
    public string AccessMode { get; init; } = "native";
    public Guid? ContextTenantId { get; init; }
    public string? ContextCompanyName { get; init; }
    /// <summary>
    /// True when the active delegated dossier is firm-managed (no platform commercial account).
    /// Always false in native mode.
    /// </summary>
    public bool IsFirmManaged { get; init; }

    /// <summary>
    /// True when the company tenant has an active cabinet assignment and payroll execution
    /// is delegated to the accounting firm. Always false in delegated mode.
    /// </summary>
    public bool IsPayrollFirmManaged { get; init; }
    public bool TwoFactorEnabled { get; init; }

    /// <summary>Enabled AppModule enum values (int) for UI.</summary>
    public IReadOnlyList<int> EnabledModuleIds { get; init; } = Array.Empty<int>();

    /// <summary>Effective permission strings (role ∩ modules).</summary>
    public IReadOnlyList<string> EffectivePermissions { get; init; } = Array.Empty<string>();

    /// <summary>
    /// First-login product tour status. Defaults to <see cref="ProductOnboardingStatus.Completed"/>
    /// for older clients / users created before the feature existed.
    /// </summary>
    public ProductOnboardingStatus ProductOnboardingStatus { get; init; } = ProductOnboardingStatus.Completed;

    public int ProductOnboardingVersion { get; init; }

    public ProductOnboardingChecklistDto? ProductOnboardingChecklist { get; init; }

    /// <summary>
    /// Phase 2 — tenant sector classification propagated from the tenant row (plan §WP-B8, D8).
    /// Nullable + additive: null for legacy/firm tenants; old frontends ignore the new field.
    /// </summary>
    public string? CompanySegment { get; init; }

    /// <summary>Phase 2 — tenant business domain (plan §WP-B8, D8). Nullable + additive.</summary>
    public string? BusinessDomain { get; init; }

    /// <summary>
    /// Phase 3 — UTC creation date of the home tenant (plan §3.5). Used by the frontend to gate
    /// onboarding nudges (e.g. "minAgeDays" before showing a configuration reminder). Additive;
    /// defaults to <see cref="DateTime.MinValue"/> only if a caller forgets to set it (should not
    /// happen in practice since both mapping sites populate it from the tenant row).
    /// </summary>
    public DateTime TenantCreatedAtUtc { get; init; }
}

/// <summary>
/// DTO for changing password.
/// </summary>
public sealed record ChangePasswordDto
{
    public string CurrentPassword { get; init; } = null!;
    public string NewPassword { get; init; } = null!;
    public string ConfirmNewPassword { get; init; } = null!;
}

/// <summary>
/// DTO for password reset request.
/// </summary>
public sealed record ForgotPasswordDto
{
    public string Email { get; init; } = null!;
}

/// <summary>
/// DTO for password reset.
/// </summary>
public sealed record ResetPasswordDto
{
    public string Email { get; init; } = null!;
    public string Token { get; init; } = null!;
    public string NewPassword { get; init; } = null!;
    public string ConfirmNewPassword { get; init; } = null!;
}

/// <summary>
/// DTO for email verification confirmation (plan §1.6).
/// </summary>
public sealed record VerifyEmailDto
{
    public string Email { get; init; } = null!;
    public string Token { get; init; } = null!;
}

/// <summary>
/// DTO to request a new email verification link (plan §1.6).
/// </summary>
public sealed record ResendVerificationDto
{
    public string Email { get; init; } = null!;
}

/// <summary>
/// DTO for refresh token request.
/// </summary>
public sealed record RefreshTokenDto
{
    public string RefreshToken { get; init; } = null!;
}

/// <summary>Authentication response for platform (backoffice) operators.</summary>
public sealed record PlatformAuthResponseDto
{
    public string AccessToken { get; init; } = null!;
    public string RefreshToken { get; init; } = null!;
    public DateTime ExpiresAt { get; init; }
    public PlatformUserDto User { get; init; } = null!;
}

/// <summary>
/// Lot B1 — Renvoie l'identité + rôles + permissions effectives de l'utilisateur courant
/// (consommé par <c>GET /api/platform/auth/me/permissions</c>).
/// </summary>
public sealed record PlatformMePermissionsDto
{
    public Guid UserId { get; init; }
    public string Email { get; init; } = null!;
    public IReadOnlyList<string> Roles { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Permissions { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Drapeaux de fonctionnalité de l'instance, booléens uniquement (ex. <c>accountingFirms</c>).
    /// Permet au backoffice de ne pas proposer une action que le serveur refusera par un 404 nu ;
    /// la garde qui fait autorité reste côté serveur.
    /// </summary>
    public IReadOnlyDictionary<string, bool> Features { get; init; } =
        new Dictionary<string, bool>();
}

/// <summary>Platform operator profile (no tenant context).</summary>
public sealed record PlatformUserDto
{
    public Guid Id { get; init; }
    public string Email { get; init; } = null!;
    public string FirstName { get; init; } = null!;
    public string LastName { get; init; } = null!;
    public string FullName => $"{FirstName} {LastName}";

    // ----- Lot B1 : multi-rôles + permissions effectives ---------------------
    /// <summary>Rôles plateforme attribués à cet utilisateur (ex: PlatformAdmin, BillingAdmin).</summary>
    public IReadOnlyList<string> Roles { get; init; } = Array.Empty<string>();
    /// <summary>Liste des permissions effectives (union des rôles), au format <c>platform.&lt;cat&gt;:&lt;action&gt;</c>.</summary>
    public IReadOnlyList<string> Permissions { get; init; } = Array.Empty<string>();
}

/// <summary>Profil détaillé de l'admin courant (GET /api/platform/auth/me).</summary>
public sealed record PlatformMeProfileDto
{
    public Guid Id { get; init; }
    public string Email { get; init; } = null!;
    public string FirstName { get; init; } = null!;
    public string LastName { get; init; } = null!;
    public IReadOnlyList<string> Roles { get; init; } = Array.Empty<string>();
    public DateTime? LastLoginAt { get; init; }
    public bool IsMfaEnabled { get; init; }
}

/// <summary>Mise à jour du profil courant (PUT /api/platform/auth/me).</summary>
public sealed record UpdatePlatformMeProfileRequest
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string FirstName { get; init; } = null!;

    [Required, StringLength(100, MinimumLength = 1)]
    public string LastName { get; init; } = null!;

    /// <summary>Si renseigné avec <see cref="NewPassword"/>, change le mot de passe.</summary>
    public string? CurrentPassword { get; init; }

    [StringLength(128, MinimumLength = 14)]
    public string? NewPassword { get; init; }

    public string? ConfirmNewPassword { get; init; }
}
