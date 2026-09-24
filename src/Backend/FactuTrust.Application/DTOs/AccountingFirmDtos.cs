using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

public sealed record RegisterAccountingFirmDto
{
    public string Email { get; init; } = null!;
    public string Password { get; init; } = null!;
    public string ConfirmPassword { get; init; } = null!;
    public string FirstName { get; init; } = null!;
    public string LastName { get; init; } = null!;
    public string FirmName { get; init; } = null!;
    public string Nif { get; init; } = null!;
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string? PostalCode { get; init; }
    public string Governorate { get; init; } = null!;
    public string FirmEmail { get; init; } = null!;
    public string Phone { get; init; } = null!;
    public string? Website { get; init; }
    public string? Description { get; init; }
    public string? ProfessionalRegistrationNumber { get; init; }
    public bool IsPublicInDirectory { get; init; } = true;
}

public sealed record AccountingFirmDirectoryQuery
{
    public string? Search { get; init; }
    public string? Governorate { get; init; }
    public string? PracticeArea { get; init; }
    public string? Language { get; init; }
    public string? ClientSegment { get; init; }
    public bool? Remote { get; init; }
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 20;
}

public sealed record AccountingFirmDirectoryPageDto
{
    public IReadOnlyList<AccountingFirmDirectoryItemDto> Items { get; init; } = Array.Empty<AccountingFirmDirectoryItemDto>();
    public int Page { get; init; }
    public int TotalCount { get; init; }
    public string? CompanyGovernorate { get; init; }
}

public sealed record AccountingFirmDirectoryItemDto
{
    public Guid FirmTenantId { get; init; }
    public string DisplayName { get; init; } = null!;
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public string? Description { get; init; }
    public string? ProfessionalRegistrationNumber { get; init; }
    public IReadOnlyList<string> PracticeAreas { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> ClientSegments { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Languages { get; init; } = Array.Empty<string>();
    public string? TeamSizeBand { get; init; }
    public bool? AcceptsRemote { get; init; }
    public int? YearsOfExperience { get; init; }
    public string? PublicWebsite { get; init; }
    public bool SameGovernorate { get; init; }
}

public sealed record AccountingFirmProfileDto
{
    public Guid TenantId { get; init; }
    public string DisplayName { get; init; } = null!;
    public string? Description { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public bool IsPublicInDirectory { get; init; }
    public string? ProfessionalRegistrationNumber { get; init; }
    public string ContactEmail { get; init; } = null!;
    public string ContactPhone { get; init; } = null!;
    public IReadOnlyList<string> PracticeAreas { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> ClientSegments { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Languages { get; init; } = Array.Empty<string>();
    public string? TeamSizeBand { get; init; }
    public bool? AcceptsRemote { get; init; }
    public int? YearsOfExperience { get; init; }
    public string? PublicWebsite { get; init; }
    /// <summary>Guidage cabinet uniquement. Jamais exposé dans l'annuaire.</summary>
    public int Completeness { get; init; }
    public IReadOnlyList<string> Missing { get; init; } = Array.Empty<string>();
}

public sealed record UpdateAccountingFirmProfileDto
{
    public string DisplayName { get; init; } = null!;
    public string? Description { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public bool IsPublicInDirectory { get; init; }
    public string? ProfessionalRegistrationNumber { get; init; }
    public string ContactEmail { get; init; } = null!;
    public string ContactPhone { get; init; } = null!;
    public IReadOnlyList<string>? PracticeAreas { get; init; }
    public IReadOnlyList<string>? ClientSegments { get; init; }
    public IReadOnlyList<string>? Languages { get; init; }
    public string? TeamSizeBand { get; init; }
    public bool? AcceptsRemote { get; init; }
    public int? YearsOfExperience { get; init; }
    public string? PublicWebsite { get; init; }
}

public sealed record RequestFirmAssignmentDto
{
    public Guid FirmTenantId { get; init; }
    public string? Notes { get; init; }
}

/// <summary>Profil société capturé au moment de l'invitation cabinet (snapshot immuable).</summary>
public sealed record CompanyProfileSnapshotDto
{
    public int SchemaVersion { get; init; } = 1;
    public DateTime CapturedAtUtc { get; init; }
    public string CompanyName { get; init; } = null!;
    public string? TradeName { get; init; }
    public string Nif { get; init; } = null!;
    public int TaxRegime { get; init; }
    public string? RneIdentifier { get; init; }
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public string? PostalCode { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
}

public sealed record FirmClientAssignmentDto
{
    public Guid Id { get; init; }
    public Guid CompanyTenantId { get; init; }
    public string CompanyName { get; init; } = null!;
    public Guid FirmTenantId { get; init; }
    public string FirmDisplayName { get; init; } = null!;
    public FirmAssignmentStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public DateTime RequestedAt { get; init; }
    public DateTime? RespondedAt { get; init; }
    public DateTime? RevokedAt { get; init; }
    public string? Notes { get; init; }
    public string? RejectionReason { get; init; }
    public CompanyProfileSnapshotDto? CompanyProfile { get; init; }
    /// <summary>Ville publique du cabinet. Renseignée seulement sur la liaison courante.</summary>
    public string? FirmCity { get; init; }
    public string? FirmGovernorate { get; init; }
    public IReadOnlyList<string> FirmPracticeAreas { get; init; } = Array.Empty<string>();
    /// <summary>Coordonnées du cabinet. Uniquement sur la liaison courante au statut Active.</summary>
    public string? FirmContactEmail { get; init; }
    public string? FirmContactPhone { get; init; }
    /// <summary>True si la société est un dossier créé et géré par le cabinet (sans compte plateforme).</summary>
    public bool IsFirmManaged { get; init; }
}

public sealed record RejectFirmAssignmentDto
{
    public string? Reason { get; init; }
}

public sealed record FirmClientDossierDto
{
    public Guid AssignmentId { get; init; }
    public Guid CompanyTenantId { get; init; }
    public string CompanyName { get; init; } = null!;
    public DateTime ActiveSince { get; init; }
    public bool HasPermanentFile { get; init; }
    public int? PermanentFileStatus { get; init; }
    public string? PermanentFileStatusDisplay { get; init; }
    public Guid? AssignedAccountantUserId { get; init; }
    public string? AssignedAccountantName { get; init; }
    /// <summary>True si aucun gestionnaire comptable n'est encore affecté.</summary>
    public bool IsAwaitingAccountantAssignment { get; init; }
    /// <summary>True si la société est un dossier créé et géré par le cabinet (sans compte plateforme).</summary>
    public bool IsFirmManaged { get; init; }
}

public sealed record FirmAssignableAccountantDto
{
    public Guid Id { get; init; }
    public string FullName { get; init; } = null!;
    public string Email { get; init; } = null!;
    public UserRole Role { get; init; }
    public string RoleDisplay { get; init; } = null!;
}

public sealed record SwitchFirmContextDto
{
    public Guid ClientTenantId { get; init; }
}

public sealed record FirmContextDto
{
    public Guid? ClientTenantId { get; init; }
    public string? ClientCompanyName { get; init; }
    public string AccessMode { get; init; } = "native";
    /// <summary>
    /// True when the active delegated dossier is firm-managed (no platform commercial account).
    /// </summary>
    public bool IsFirmManaged { get; init; }
}

public sealed record CreateFirmUserDto
{
    public string Email { get; init; } = null!;
    public string FirstName { get; init; } = null!;
    public string LastName { get; init; } = null!;
    /// <summary>Optionnel : si vide, un mot de passe aléatoire est généré et une invitation est envoyée.</summary>
    public string? Password { get; init; }
    public UserRole Role { get; init; }
    public CollaboratorCivility Civility { get; init; } = CollaboratorCivility.Mr;
    public string? Qualification { get; init; }
    public string? PhoneNumber { get; init; }
    public string? PhoneLandline { get; init; }
    public bool UseFirmAddress { get; init; } = true;
    public string? AddressLine { get; init; }
    public string? PostalCode { get; init; }
    public string? City { get; init; }
    public string? Country { get; init; }
    /// <summary>Si true et Password vide, EmailConfirmed=false + email d'invitation. Défaut false pour rétrocompat MVP (password fourni).</summary>
    public bool SendInvite { get; init; }

    /// <summary>Obligatoire lorsque l'auto-provision paie est active à la création.</summary>
    public FirmCollaboratorPayrollOnboardingDto? Payroll { get; init; }
}

public sealed record UpdateFirmUserDto
{
    public string? FirstName { get; init; }
    public string? LastName { get; init; }
    public UserRole? Role { get; init; }
    public string? NewPassword { get; init; }
    public CollaboratorCivility? Civility { get; init; }
    public string? Qualification { get; init; }
    public string? PhoneNumber { get; init; }
    public string? PhoneLandline { get; init; }
    public bool? UseFirmAddress { get; init; }
    public string? AddressLine { get; init; }
    public string? PostalCode { get; init; }
    public string? City { get; init; }
    public string? Country { get; init; }
}

public sealed record UpdateFirmUserStatusDto
{
    public bool IsActive { get; init; }
}

public sealed record SetFirmUserBinomesDto
{
    public IReadOnlyList<Guid> BinomeUserIds { get; init; } = Array.Empty<Guid>();
}

public sealed record FirmAddressSnapshotDto
{
    public string AddressLine { get; init; } = string.Empty;
    public string? PostalCode { get; init; }
    public string City { get; init; } = string.Empty;
    public string Country { get; init; } = string.Empty;
    public string? Governorate { get; init; }
}

public sealed record FirmCollaboratorCniInfoDto
{
    public bool HasCni { get; init; }
    public string? FileName { get; init; }
    public string? ContentType { get; init; }
    public DateTime? UploadedAt { get; init; }
}

public sealed record FirmUserBinomeDto
{
    public Guid Id { get; init; }
    public string FullName { get; init; } = null!;
    public string Email { get; init; } = null!;
}

public sealed record FirmUserDto
{
    public Guid Id { get; init; }
    public string Email { get; init; } = null!;
    public string FirstName { get; init; } = null!;
    public string LastName { get; init; } = null!;
    public UserRole Role { get; init; }
    public string RoleDisplay { get; init; } = null!;
    public bool IsActive { get; init; }
    public bool EmailConfirmed { get; init; }
    public CollaboratorCivility? Civility { get; init; }
    public string? Qualification { get; init; }
    public string? PhoneNumber { get; init; }
    public string? PhoneLandline { get; init; }
    public bool UseFirmAddress { get; init; }
    public string? AddressLine { get; init; }
    public string? PostalCode { get; init; }
    public string? City { get; init; }
    public string? Country { get; init; }
    public bool HasCni { get; init; }
    public DateTime? CniUploadedAt { get; init; }
    public string? BinomesDisplay { get; init; }
    public IReadOnlyList<FirmUserBinomeDto> Binomes { get; init; } = Array.Empty<FirmUserBinomeDto>();
    public Guid? PayrollEmployeeId { get; init; }
    public string? PayrollLinkSourceDisplay { get; init; }
}

public sealed record FirmDashboardClientRowDto
{
    public Guid AssignmentId { get; init; }
    public Guid CompanyTenantId { get; init; }
    public string CompanyName { get; init; } = null!;
    public DateTime ActiveSince { get; init; }
    public DateTime? LastJournalEntryDate { get; init; }
    public bool IsInactive30Days { get; init; }
}

public sealed record FirmDashboardInvitationRowDto
{
    public Guid Id { get; init; }
    public string CompanyName { get; init; } = null!;
    public DateTime RequestedAt { get; init; }
    public string? Notes { get; init; }
}

public sealed record FirmDashboardDto
{
    public int ActiveClientsCount { get; init; }
    public int PendingInvitationsCount { get; init; }
    public int InactiveDossiersCount { get; init; }
    public int VatDraftsCount { get; init; }
    public int OverdueSchedulesCount { get; init; }
    public int UpcomingWithin7DaysCount { get; init; }
    public int TejPendingCount { get; init; }
    public int LiasseDraftsCount { get; init; }
    public int DtsPendingCount { get; init; }
    public decimal OverdueEstimatedAmount { get; init; }
    public decimal Upcoming7DaysEstimatedAmount { get; init; }
    public IReadOnlyList<FirmDashboardClientRowDto> Clients { get; init; } = Array.Empty<FirmDashboardClientRowDto>();
    public IReadOnlyList<FirmDashboardInvitationRowDto> PendingInvitations { get; init; } = Array.Empty<FirmDashboardInvitationRowDto>();
}
