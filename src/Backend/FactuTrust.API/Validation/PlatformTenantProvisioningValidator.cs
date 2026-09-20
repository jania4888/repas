using System.Text.RegularExpressions;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.API.Validation;

/// <summary>
/// Validation d'entrée des endpoints de provisionnement plateforme.
///
/// <para>
/// Elle existe parce que la chaîne de value objects de <c>CompanyRegistrationService</c>
/// (<see cref="NIF"/>, <see cref="Address"/>, <see cref="PhoneNumber"/>…) est séquentielle et
/// s'arrête à la <b>première</b> erreur : un opérateur qui se trompe sur trois champs corrige
/// trois fois. Ici on renvoie tout d'un coup.
/// </para>
///
/// <para>
/// <b>Portée volontairement limitée au chemin plateforme.</b> Les règles ajoutées ici — en
/// particulier la vérification du gouvernorat contre <see cref="TunisianGovernorates.All"/> — ne
/// doivent pas migrer dans <c>Address.Create</c> : cette fabrique est utilisée par une quinzaine
/// de flux (clients, fournisseurs, employés, factures, commandes vitrine, import de référentiel,
/// provisionnement de tenant) et durcir sa validation rejetterait des adresses historiques
/// saisies en texte libre.
/// </para>
/// </summary>
public static class PlatformTenantProvisioningValidator
{
    /// <summary>Code postal tunisien : exactement 4 chiffres.</summary>
    private static readonly Regex PostalCodePattern = new(@"^\d{4}$", RegexOptions.Compiled);

    public static IReadOnlyList<string> Validate(PlatformCreateCompanyRequestDto dto)
    {
        var errors = new List<string>();

        ValidateCommon(
            errors,
            dto.PostalCode,
            dto.Governorate,
            dto.Website);

        if (!Enum.IsDefined(typeof(TaxRegime), dto.TaxRegime))
            errors.Add("Régime fiscal invalide.");

        if (dto.Plan is { } plan && !Enum.IsDefined(typeof(SubscriptionPlan), plan))
            errors.Add("Forfait invalide.");

        if (dto.EnabledModules is { Count: > 0 })
        {
            var invalidModuleIds = dto.EnabledModules
                .Where(id => !Enum.IsDefined(typeof(AppModule), id))
                .Distinct()
                .ToList();

            if (invalidModuleIds.Count > 0)
                errors.Add($"Modules invalides : {string.Join(", ", invalidModuleIds)}.");
        }

        // Un domaine sans segment est rejeté plus loin par RegistrationSectorService ; le signaler
        // ici évite un aller-retour et un message générique.
        if (string.IsNullOrWhiteSpace(dto.CompanySegment) && !string.IsNullOrWhiteSpace(dto.BusinessDomain))
            errors.Add("Le type de société est obligatoire lorsqu'un domaine d'activité est fourni.");

        return errors;
    }

    public static IReadOnlyList<string> Validate(PlatformCreateFirmRequestDto dto)
    {
        var errors = new List<string>();

        ValidateCommon(
            errors,
            dto.PostalCode,
            dto.Governorate,
            dto.Website);

        if (dto.Plan is { } plan && !Enum.IsDefined(typeof(SubscriptionPlan), plan))
            errors.Add("Forfait invalide.");

        return errors;
    }

    private static void ValidateCommon(
        List<string> errors,
        string? postalCode,
        string governorate,
        string? website)
    {
        if (!string.IsNullOrWhiteSpace(postalCode) && !PostalCodePattern.IsMatch(postalCode.Trim()))
            errors.Add("Le code postal doit comporter exactement 4 chiffres.");

        if (!string.IsNullOrWhiteSpace(governorate) && !TunisianGovernorates.IsValid(governorate.Trim()))
        {
            errors.Add(
                $"Gouvernorat invalide : « {governorate.Trim()} ». Valeurs acceptées : "
                + string.Join(", ", TunisianGovernorates.All)
                + ".");
        }

        if (!string.IsNullOrWhiteSpace(website)
            && !Uri.TryCreate(website.Trim(), UriKind.Absolute, out var uri))
        {
            errors.Add("Le site web doit être une URL absolue (ex. https://exemple.tn).");
        }
        else if (!string.IsNullOrWhiteSpace(website)
            && Uri.TryCreate(website.Trim(), UriKind.Absolute, out uri)
            && uri.Scheme != Uri.UriSchemeHttp
            && uri.Scheme != Uri.UriSchemeHttps)
        {
            errors.Add("Le site web doit utiliser le protocole http ou https.");
        }
    }
}
