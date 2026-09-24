using FactuTrust.Domain.Common;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Public directory profile for an accounting firm tenant.
/// </summary>
public sealed class AccountingFirmProfile : AggregateRoot
{
    public Guid TenantId { get; private set; }
    public string DisplayName { get; private set; } = null!;
    public string? Description { get; private set; }
    public string City { get; private set; } = null!;
    public string Governorate { get; private set; } = null!;
    public bool IsPublicInDirectory { get; private set; }
    public string? ProfessionalRegistrationNumber { get; private set; }
    public string ContactEmail { get; private set; } = null!;
    public string ContactPhone { get; private set; } = null!;
    public string? PracticeAreasJson { get; private set; }
    public string? ClientSegmentsJson { get; private set; }
    public string? LanguagesJson { get; private set; }
    public string? TeamSizeBand { get; private set; }
    public bool? AcceptsRemote { get; private set; }
    public int? YearsOfExperience { get; private set; }
    public string? PublicWebsite { get; private set; }

    public IReadOnlyList<string> PracticeAreas => AccountingFirmProfileCatalog.ParseCodes(PracticeAreasJson);
    public IReadOnlyList<string> ClientSegments => AccountingFirmProfileCatalog.ParseCodes(ClientSegmentsJson);
    public IReadOnlyList<string> Languages => AccountingFirmProfileCatalog.ParseCodes(LanguagesJson);

    private AccountingFirmProfile() { }

    public static Result<AccountingFirmProfile> Create(
        Guid tenantId,
        string displayName,
        string city,
        string governorate,
        Email contactEmail,
        PhoneNumber contactPhone,
        string? description = null,
        string? professionalRegistrationNumber = null,
        bool isPublicInDirectory = true)
    {
        if (tenantId == Guid.Empty)
            return Result.Failure<AccountingFirmProfile>(Error.Validation("TenantId", "Identifiant cabinet invalide"));

        if (string.IsNullOrWhiteSpace(displayName))
            return Result.Failure<AccountingFirmProfile>(Error.Validation("DisplayName", "Le nom affiché est obligatoire"));

        return Result.Success(new AccountingFirmProfile
        {
            TenantId = tenantId,
            DisplayName = displayName.Trim(),
            Description = description?.Trim(),
            City = city.Trim(),
            Governorate = governorate.Trim(),
            IsPublicInDirectory = isPublicInDirectory,
            ProfessionalRegistrationNumber = professionalRegistrationNumber?.Trim(),
            ContactEmail = contactEmail.Value,
            ContactPhone = contactPhone.Value
        });
    }

    public Result Update(AccountingFirmProfileUpdate update)
    {
        if (string.IsNullOrWhiteSpace(update.DisplayName) || update.DisplayName.Trim().Length > 200)
            return Result.Failure(Error.Validation("DisplayName", "Le nom affiché est obligatoire (200 caractères maximum)."));

        if (string.IsNullOrWhiteSpace(update.City) || update.City.Trim().Length > 100)
            return Result.Failure(Error.Validation("City", "La ville est obligatoire (100 caractères maximum)."));

        if (!TunisianGovernorates.IsValid(update.Governorate ?? string.Empty))
            return Result.Failure(Error.Validation("Governorate", "Le gouvernorat est invalide."));

        var description = string.IsNullOrWhiteSpace(update.Description) ? null : update.Description.Trim();
        if (description is { Length: > AccountingFirmProfileCatalog.DescriptionMaxLength })
            return Result.Failure(Error.Validation("Description", "La description dépasse 2000 caractères."));

        if (AccountingFirmProfileCatalog.ContainsHtmlTag(description))
            return Result.Failure(Error.Validation("Description", "La description ne peut pas contenir de balise HTML."));

        var registration = string.IsNullOrWhiteSpace(update.ProfessionalRegistrationNumber)
            ? null
            : update.ProfessionalRegistrationNumber.Trim();
        if (registration is { Length: > 100 })
            return Result.Failure(Error.Validation("ProfessionalRegistrationNumber", "Le numéro d'inscription est trop long."));

        var email = Email.Create(update.ContactEmail ?? string.Empty);
        if (email.IsFailure)
            return Result.Failure(email.Error);

        var phone = PhoneNumber.Create(update.ContactPhone ?? string.Empty);
        if (phone.IsFailure)
            return Result.Failure(phone.Error);

        if (!AccountingFirmProfileCatalog.TryNormalizeCodes(
                update.PracticeAreas, AccountingFirmProfileCatalog.PracticeAreas, AccountingFirmProfileCatalog.MaxPracticeAreas,
                out var practiceAreas, out var practiceError))
            return Result.Failure(Error.Validation("PracticeAreas", practiceError!));

        if (!AccountingFirmProfileCatalog.TryNormalizeCodes(
                update.ClientSegments, AccountingFirmProfileCatalog.ClientSegments, AccountingFirmProfileCatalog.MaxClientSegments,
                out var segments, out var segmentError))
            return Result.Failure(Error.Validation("ClientSegments", segmentError!));

        if (!AccountingFirmProfileCatalog.TryNormalizeCodes(
                update.Languages, AccountingFirmProfileCatalog.Languages, AccountingFirmProfileCatalog.MaxLanguages,
                out var languages, out var languageError))
            return Result.Failure(Error.Validation("Languages", languageError!));

        if (!AccountingFirmProfileCatalog.TryNormalizeTeamSize(update.TeamSizeBand, out var teamSize, out var teamError))
            return Result.Failure(Error.Validation("TeamSizeBand", teamError!));

        if (update.YearsOfExperience is < 0 or > AccountingFirmProfileCatalog.MaxYearsOfExperience)
            return Result.Failure(Error.Validation("YearsOfExperience", "Les années d'expérience doivent être comprises entre 0 et 60."));

        if (!AccountingFirmProfileCatalog.TryNormalizeWebsite(update.PublicWebsite, out var website, out var websiteError))
            return Result.Failure(Error.Validation("PublicWebsite", websiteError!));

        var governorate = TunisianGovernorates.All.First(g =>
            string.Equals(g, update.Governorate!.Trim(), StringComparison.OrdinalIgnoreCase));

        DisplayName = update.DisplayName.Trim();
        Description = description;
        City = update.City.Trim();
        Governorate = governorate;
        IsPublicInDirectory = update.IsPublicInDirectory;
        ProfessionalRegistrationNumber = registration;
        ContactEmail = email.Value.Value;
        ContactPhone = phone.Value.Value;
        PracticeAreasJson = AccountingFirmProfileCatalog.SerializeCodes(practiceAreas);
        ClientSegmentsJson = AccountingFirmProfileCatalog.SerializeCodes(segments);
        LanguagesJson = AccountingFirmProfileCatalog.SerializeCodes(languages);
        TeamSizeBand = teamSize;
        AcceptsRemote = update.AcceptsRemote;
        YearsOfExperience = update.YearsOfExperience;
        PublicWebsite = website;
        return Result.Success();
    }
}

/// <summary>Demande de mise à jour validée par <see cref="AccountingFirmProfile.Update"/>.</summary>
public sealed record AccountingFirmProfileUpdate
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
