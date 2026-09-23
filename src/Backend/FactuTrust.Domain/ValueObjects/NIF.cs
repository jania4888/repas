using System.Text.RegularExpressions;
using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.ValueObjects;

/// <summary>
/// Segments d'un matricule fiscal tunisien, indépendants de l'écriture stockée.
/// La première lettre (<see cref="Key"/>) est celle que <see cref="NIF.TaxpayerCategory"/> expose :
/// c'est la clé collée aux 7 chiffres sur la carte (<c>W</c> dans <c>1772793W/A/M/000</c>),
/// pas une catégorie réinterprétée.
/// </summary>
public readonly record struct NifParts(string Digits, char Key, char Second, char Third, string Office);

/// <summary>
/// Numéro d'identification fiscale tunisien (matricule fiscal).
/// Forme stockée : <c>NNNNNNNL/A/M/NNN</c> (ex. <c>1772793W/A/M/000</c>).
/// La forme historique <c>NNNNNNN/L/A/M/NNN</c> est acceptée en saisie et ramenée à la forme stockée.
/// Les deux écritures désignent le même matricule.
/// </summary>
public sealed partial class NIF : ValueObject
{
    public const int MaxInputLength = 40;

    private const string OfficialPattern = @"^([0-9]{7})([A-Z])/([A-Z])/([A-Z])/([0-9]{3})$";
    private const string LegacyPattern = @"^([0-9]{7})/([A-Z])/([A-Z])/([A-Z])/([0-9]{3})$";

    public const string FormatError =
        "Format du NIF invalide. Format attendu: NNNNNNNL/A/M/NNN (ex: 1772793W/A/M/000).";

    public string Value { get; private set; }

    public string IdentificationNumber => TryGetParts(Value, out var parts) ? parts.Digits : string.Empty;
    public char TaxpayerCategory => TryGetParts(Value, out var parts) ? parts.Key : ' ';
    public char MainActivity => TryGetParts(Value, out var parts) ? parts.Second : ' ';
    public char SecondaryEstablishment => TryGetParts(Value, out var parts) ? parts.Third : ' ';
    public string OfficeCode => TryGetParts(Value, out var parts) ? parts.Office : string.Empty;

    /// <summary>Écriture historique <c>NNNNNNN/L/A/M/NNN</c> du même matricule.</summary>
    public string LegacySpelling =>
        TryGetParts(Value, out var parts) ? FormatLegacy(parts) : Value;

    // Required for EF Core
    private NIF()
    {
        Value = string.Empty;
    }

    private NIF(string canonical)
    {
        Value = canonical;
    }

    public static Result<NIF> Create(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Failure<NIF>(Error.Validation("NIF", "Le NIF est obligatoire"));

        if (!TryCanonicalize(value, out var canonical))
            return Result.Failure<NIF>(Error.Validation("NIF", FormatError));

        return Result.Success(new NIF(canonical));
    }

    public static bool IsValid(string? value) => TryCanonicalize(value, out _);

    /// <summary>
    /// Ramène une saisie à la forme stockée. Idempotent.
    /// Rejette toute chaîne vide, trop longue, ou qui n'est ni la forme officielle ni la forme historique.
    /// </summary>
    public static bool TryCanonicalize(string? value, out string canonical)
    {
        canonical = string.Empty;
        if (!TryGetParts(value, out var parts))
            return false;

        canonical = FormatOfficial(parts);
        return true;
    }

    /// <summary>
    /// Lit les cinq segments depuis la forme officielle ou historique.
    /// Les index bruts ne sont pas utilisés : une valeur historique encore en base reste lisible.
    /// </summary>
    public static bool TryGetParts(string? value, out NifParts parts)
    {
        parts = default;
        if (!TryPrepare(value, out var prepared))
            return false;

        var official = OfficialRegex().Match(prepared);
        if (official.Success)
        {
            parts = FromMatch(official);
            return true;
        }

        var legacy = LegacyRegex().Match(prepared);
        if (legacy.Success)
        {
            parts = FromMatch(legacy);
            return true;
        }

        return false;
    }

    /// <summary>Forme officielle et forme historique, pour une recherche d'unicité.</summary>
    public static bool TryGetLookupSpellings(string? value, out string canonical, out string legacy)
    {
        canonical = string.Empty;
        legacy = string.Empty;
        if (!TryGetParts(value, out var parts))
            return false;

        canonical = FormatOfficial(parts);
        legacy = FormatLegacy(parts);
        return true;
    }

    public override string ToString() => Value;

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }

    private static bool TryPrepare(string? value, out string prepared)
    {
        prepared = string.Empty;
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxInputLength)
            return false;

        prepared = value.Trim()
            .Replace(" ", string.Empty)
            .Replace("\t", string.Empty)
            .Replace("\u2044", "/")
            .Replace("\u2215", "/")
            .ToUpperInvariant();

        return prepared.Length > 0 && prepared.Length <= MaxInputLength;
    }

    private static NifParts FromMatch(Match match) =>
        new(match.Groups[1].Value, match.Groups[2].Value[0], match.Groups[3].Value[0], match.Groups[4].Value[0], match.Groups[5].Value);

    private static string FormatOfficial(NifParts parts) =>
        $"{parts.Digits}{parts.Key}/{parts.Second}/{parts.Third}/{parts.Office}";

    private static string FormatLegacy(NifParts parts) =>
        $"{parts.Digits}/{parts.Key}/{parts.Second}/{parts.Third}/{parts.Office}";

    [GeneratedRegex(OfficialPattern, RegexOptions.CultureInvariant)]
    private static partial Regex OfficialRegex();

    [GeneratedRegex(LegacyPattern, RegexOptions.CultureInvariant)]
    private static partial Regex LegacyRegex();
}

/// <summary>
/// Taxpayer categories according to Tunisian tax law.
/// </summary>
public static class TaxpayerCategories
{
    public const char NaturalPerson = 'A';           // Personnes physiques
    public const char Partnership = 'B';              // Sociétés de personnes
    public const char Corporation = 'C';              // Sociétés de capitaux
    public const char Association = 'D';              // Associations
    public const char PublicEstablishment = 'E';      // Établissements publics
    public const char ForeignLegalEntity = 'F';       // Personnes morales étrangères
    public const char Other = 'G';                    // Autres

    public static string GetDescription(char category) => category switch
    {
        'A' => "Personne physique",
        'B' => "Société de personnes",
        'C' => "Société de capitaux",
        'D' => "Association",
        'E' => "Établissement public",
        'F' => "Personne morale étrangère",
        'G' => "Autre",
        _ => "Inconnu"
    };

    /// <summary>
    /// True when <paramref name="category"/> is one of the letters this table actually maps
    /// (A–G). The NIF format accepts <c>[A-Z]</c>, so real matricules carry letters outside this
    /// set (P, M, N, …) which <see cref="GetDescription"/> renders as "Inconnu". Any rule derived
    /// from the category MUST abstain on those letters rather than infer a meaning:
    /// "Inconnu" means "not interpretable here", never "incoherent".
    /// Kept switch-explicit (not an ASCII range) so it stays 1:1 with <see cref="GetDescription"/>.
    /// </summary>
    public static bool IsKnown(char category) => category switch
    {
        'A' or 'B' or 'C' or 'D' or 'E' or 'F' or 'G' => true,
        _ => false
    };
}
