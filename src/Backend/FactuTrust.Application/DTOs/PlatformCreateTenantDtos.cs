using System.ComponentModel.DataAnnotations;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// Corps des endpoints de provisionnement plateforme
/// (<c>POST /api/platform/tenants/companies</c>).
///
/// <para>
/// <b>Pourquoi un DTO distinct de <see cref="RegisterDto"/> ?</b> <see cref="RegisterDto"/> est le
/// corps d'un endpoint <c>[AllowAnonymous]</c>. Tout champ de privilège qu'on y ajouterait
/// (forfait, modules réservés, rôle) deviendrait pilotable par un visiteur non authentifié via
/// <c>POST /api/auth/register</c>. La séparation garantit qu'ajouter un champ plateforme reste une
/// décision consciente : il n'y a pas d'héritage, la projection vers <see cref="RegisterDto"/> est
/// explicite (<see cref="ToRegisterDto"/>).
/// </para>
///
/// <para>
/// Les annotations de validation sont portées ici et <b>pas</b> sur <see cref="RegisterDto"/> :
/// les ajouter là-bas transformerait la forme d'échec de l'inscription publique en
/// <c>ValidationProblemDetails</c> — une rupture de contrat pour l'application web.
/// </para>
/// </summary>
public sealed record PlatformCreateCompanyRequestDto
{
    [Required(ErrorMessage = "L'email de l'administrateur est obligatoire.")]
    [EmailAddress(ErrorMessage = "L'email de l'administrateur est invalide.")]
    [StringLength(256)]
    public string Email { get; init; } = null!;

    [Required(ErrorMessage = "Le mot de passe est obligatoire.")]
    [StringLength(128, MinimumLength = 12, ErrorMessage = "Le mot de passe doit contenir au moins 12 caractères.")]
    public string Password { get; init; } = null!;

    [Required(ErrorMessage = "La confirmation du mot de passe est obligatoire.")]
    [Compare(nameof(Password), ErrorMessage = "Les mots de passe ne correspondent pas.")]
    public string ConfirmPassword { get; init; } = null!;

    [Required(ErrorMessage = "Le prénom est obligatoire.")]
    [StringLength(100)]
    public string FirstName { get; init; } = null!;

    [Required(ErrorMessage = "Le nom est obligatoire.")]
    [StringLength(100)]
    public string LastName { get; init; } = null!;

    [Required(ErrorMessage = "La raison sociale est obligatoire.")]
    [StringLength(200)]
    public string CompanyName { get; init; } = null!;

    [Required(ErrorMessage = "Le matricule fiscal est obligatoire.")]
    [StringLength(32)]
    public string Nif { get; init; } = null!;

    public TaxRegime TaxRegime { get; init; }

    [Required(ErrorMessage = "La rue est obligatoire.")]
    [StringLength(200)]
    public string Street { get; init; } = null!;

    [StringLength(200)]
    public string? StreetLine2 { get; init; }

    [Required(ErrorMessage = "La ville est obligatoire.")]
    [StringLength(100)]
    public string City { get; init; } = null!;

    [StringLength(10)]
    public string? PostalCode { get; init; }

    [Required(ErrorMessage = "Le gouvernorat est obligatoire.")]
    [StringLength(100)]
    public string Governorate { get; init; } = null!;

    [Required(ErrorMessage = "L'email de la société est obligatoire.")]
    [EmailAddress(ErrorMessage = "L'email de la société est invalide.")]
    [StringLength(256)]
    public string CompanyEmail { get; init; } = null!;

    [Required(ErrorMessage = "Le téléphone est obligatoire.")]
    [StringLength(32)]
    public string Phone { get; init; } = null!;

    [StringLength(256)]
    public string? Website { get; init; }

    [StringLength(100)]
    public string? WarehouseName { get; init; }

    public string? CompanySegment { get; init; }

    public string? BusinessDomain { get; init; }

    public IReadOnlyList<int>? EnabledModules { get; init; }

    /// <summary>
    /// Forfait à appliquer au dossier créé. <c>null</c> ⇒ <see cref="SubscriptionPlan.Free"/>.
    /// Champ <b>exclusivement plateforme</b> : il n'existe volontairement pas sur
    /// <see cref="RegisterDto"/>. Le serveur refuse de l'honorer si l'opérateur ne détient pas
    /// <c>platform.subscription:change-plan</c>.
    /// </summary>
    public SubscriptionPlan? Plan { get; init; }

    /// <summary>
    /// Projection explicite vers le DTO d'inscription partagé. Le profilage
    /// (<see cref="RegisterDto.ProfileAnswers"/>) reste volontairement absent : un opérateur ne
    /// doit pas répondre à la place du dirigeant, et <c>null</c> signifie honnêtement
    /// « non renseigné ».
    /// </summary>
    public RegisterDto ToRegisterDto() => new()
    {
        Email = Email,
        Password = Password,
        ConfirmPassword = ConfirmPassword,
        FirstName = FirstName,
        LastName = LastName,
        CompanyName = CompanyName,
        Nif = Nif,
        TaxRegime = TaxRegime,
        Street = Street,
        StreetLine2 = StreetLine2,
        City = City,
        PostalCode = PostalCode,
        Governorate = Governorate,
        CompanyEmail = CompanyEmail,
        Phone = Phone,
        Website = Website,
        WarehouseName = WarehouseName,
        CompanySegment = CompanySegment,
        BusinessDomain = BusinessDomain,
        EnabledModules = EnabledModules
    };
}

/// <summary>
/// Corps de <c>POST /api/platform/tenants/accounting-firms</c>. Même justification que
/// <see cref="PlatformCreateCompanyRequestDto"/> : ne jamais annoter ni enrichir le DTO anonyme.
/// </summary>
public sealed record PlatformCreateFirmRequestDto
{
    [Required(ErrorMessage = "L'email du gérant est obligatoire.")]
    [EmailAddress(ErrorMessage = "L'email du gérant est invalide.")]
    [StringLength(256)]
    public string Email { get; init; } = null!;

    [Required(ErrorMessage = "Le mot de passe est obligatoire.")]
    [StringLength(128, MinimumLength = 12, ErrorMessage = "Le mot de passe doit contenir au moins 12 caractères.")]
    public string Password { get; init; } = null!;

    [Required(ErrorMessage = "La confirmation du mot de passe est obligatoire.")]
    [Compare(nameof(Password), ErrorMessage = "Les mots de passe ne correspondent pas.")]
    public string ConfirmPassword { get; init; } = null!;

    [Required(ErrorMessage = "Le prénom est obligatoire.")]
    [StringLength(100)]
    public string FirstName { get; init; } = null!;

    [Required(ErrorMessage = "Le nom est obligatoire.")]
    [StringLength(100)]
    public string LastName { get; init; } = null!;

    [Required(ErrorMessage = "La raison sociale du cabinet est obligatoire.")]
    [StringLength(200)]
    public string FirmName { get; init; } = null!;

    [Required(ErrorMessage = "Le matricule fiscal est obligatoire.")]
    [StringLength(32)]
    public string Nif { get; init; } = null!;

    [Required(ErrorMessage = "La rue est obligatoire.")]
    [StringLength(200)]
    public string Street { get; init; } = null!;

    [StringLength(200)]
    public string? StreetLine2 { get; init; }

    [Required(ErrorMessage = "La ville est obligatoire.")]
    [StringLength(100)]
    public string City { get; init; } = null!;

    [StringLength(10)]
    public string? PostalCode { get; init; }

    [Required(ErrorMessage = "Le gouvernorat est obligatoire.")]
    [StringLength(100)]
    public string Governorate { get; init; } = null!;

    [Required(ErrorMessage = "L'email du cabinet est obligatoire.")]
    [EmailAddress(ErrorMessage = "L'email du cabinet est invalide.")]
    [StringLength(256)]
    public string FirmEmail { get; init; } = null!;

    [Required(ErrorMessage = "Le téléphone est obligatoire.")]
    [StringLength(32)]
    public string Phone { get; init; } = null!;

    [StringLength(256)]
    public string? Website { get; init; }

    [StringLength(1000)]
    public string? Description { get; init; }

    [StringLength(64)]
    public string? ProfessionalRegistrationNumber { get; init; }

    public bool IsPublicInDirectory { get; init; } = true;

    /// <summary>Forfait du cabinet créé. <c>null</c> ⇒ <see cref="SubscriptionPlan.Free"/>.</summary>
    public SubscriptionPlan? Plan { get; init; }

    public RegisterAccountingFirmDto ToRegisterDto() => new()
    {
        Email = Email,
        Password = Password,
        ConfirmPassword = ConfirmPassword,
        FirstName = FirstName,
        LastName = LastName,
        FirmName = FirmName,
        Nif = Nif,
        Street = Street,
        StreetLine2 = StreetLine2,
        City = City,
        PostalCode = PostalCode,
        Governorate = Governorate,
        FirmEmail = FirmEmail,
        Phone = Phone,
        Website = Website,
        Description = Description,
        ProfessionalRegistrationNumber = ProfessionalRegistrationNumber,
        IsPublicInDirectory = IsPublicInDirectory
    };
}
