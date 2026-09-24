using System.Text.RegularExpressions;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Listes fermées et règles de la fiche publique d'un cabinet.
/// Les codes ne contiennent que [a-z0-9-] afin de pouvoir filtrer le JSON en SQL sans injection.
/// </summary>
public static partial class AccountingFirmProfileCatalog
{
    public const int DescriptionMaxLength = 2000;
    public const int WebsiteMaxLength = 200;
    public const int SearchMaxLength = 100;
    public const int MaxPracticeAreas = 8;
    public const int MaxClientSegments = 5;
    public const int MaxLanguages = 3;
    public const int MaxYearsOfExperience = 60;
    public const int CompletenessDescriptionMinLength = 80;

    public static readonly IReadOnlyList<string> PracticeAreas =
    [
        "tenue-comptable",
        "fiscalite",
        "tva",
        "paie-cnss",
        "tej-retenue",
        "liasse-fiscale",
        "creation-societe",
        "conseil"
    ];

    public static readonly IReadOnlyList<string> ClientSegments =
    [
        "tpe",
        "pme",
        "profession-liberale",
        "association",
        "export"
    ];

    public static readonly IReadOnlyList<string> Languages = ["fr", "ar", "en"];

    public static readonly IReadOnlyList<string> TeamSizeBands = ["solo", "2-5", "6-20", "20-plus"];

    public static bool TryNormalizeCodes(
        IReadOnlyList<string>? raw,
        IReadOnlyList<string> allowed,
        int max,
        out IReadOnlyList<string> normalized,
        out string? error)
    {
        normalized = Array.Empty<string>();
        error = null;
        if (raw is null || raw.Count == 0)
            return true;

        if (raw.Count > max)
        {
            error = $"Au plus {max} valeurs sont autorisées.";
            return false;
        }

        var seen = new List<string>(raw.Count);
        foreach (var item in raw)
        {
            if (string.IsNullOrWhiteSpace(item))
            {
                error = "Une valeur vide n'est pas autorisée.";
                return false;
            }

            var code = item.Trim().ToLowerInvariant();
            if (!allowed.Contains(code, StringComparer.Ordinal))
            {
                error = $"Valeur inconnue : {item.Trim()}.";
                return false;
            }

            if (!seen.Contains(code, StringComparer.Ordinal))
                seen.Add(code);
        }

        normalized = seen;
        return true;
    }

    public static bool TryNormalizeTeamSize(string? raw, out string? normalized, out string? error)
    {
        normalized = null;
        error = null;
        if (string.IsNullOrWhiteSpace(raw))
            return true;

        var code = raw.Trim().ToLowerInvariant();
        if (!TeamSizeBands.Contains(code, StringComparer.Ordinal))
        {
            error = "Taille d'équipe inconnue.";
            return false;
        }

        normalized = code;
        return true;
    }

    public static bool ContainsHtmlTag(string? value) =>
        !string.IsNullOrEmpty(value) && HtmlTagRegex().IsMatch(value);

    public static bool TryNormalizeWebsite(string? raw, out string? normalized, out string? error)
    {
        normalized = null;
        error = null;
        if (string.IsNullOrWhiteSpace(raw))
            return true;

        var trimmed = raw.Trim();
        if (trimmed.Length > WebsiteMaxLength)
        {
            error = "L'adresse du site est trop longue.";
            return false;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || string.IsNullOrEmpty(uri.Host)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            error = "Le site doit être une adresse https valide.";
            return false;
        }

        normalized = uri.AbsoluteUri;
        return true;
    }

    public static string? SerializeCodes(IReadOnlyList<string> codes)
    {
        if (codes.Count == 0)
            return null;

        return "[" + string.Join(',', codes.Select(c => "\"" + c + "\"")) + "]";
    }

    public static IReadOnlyList<string> ParseCodes(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Array.Empty<string>();

        var inner = json.Trim();
        if (inner.StartsWith('[') && inner.EndsWith(']'))
            inner = inner[1..^1];

        if (string.IsNullOrWhiteSpace(inner))
            return Array.Empty<string>();

        return inner
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(part => part.Trim().Trim('"'))
            .Where(part => part.Length > 0)
            .ToArray();
    }

    /// <summary>0–100. Six critères à poids égal. La société ne reçoit jamais ce score.</summary>
    public static int CompletenessScore(
        string? description,
        IReadOnlyList<string> practiceAreas,
        IReadOnlyList<string> languages,
        string? governorate,
        string? registrationNumber,
        bool isPublic)
    {
        var met = MissingCriteria(description, practiceAreas, languages, governorate, registrationNumber, isPublic);
        return ((6 - met.Count) * 100) / 6;
    }

    public static IReadOnlyList<string> MissingCriteria(
        string? description,
        IReadOnlyList<string> practiceAreas,
        IReadOnlyList<string> languages,
        string? governorate,
        string? registrationNumber,
        bool isPublic)
    {
        var missing = new List<string>(6);
        if (string.IsNullOrWhiteSpace(description) || description.Trim().Length < CompletenessDescriptionMinLength)
            missing.Add("description");
        if (practiceAreas.Count == 0)
            missing.Add("practiceAreas");
        if (languages.Count == 0)
            missing.Add("languages");
        if (!TunisianGovernorates.IsValid(governorate ?? string.Empty))
            missing.Add("governorate");
        if (string.IsNullOrWhiteSpace(registrationNumber))
            missing.Add("registration");
        if (!isPublic)
            missing.Add("visibility");
        return missing;
    }

    [GeneratedRegex(@"<\s*/?\s*[a-zA-Z!][^>]*>", RegexOptions.Compiled)]
    private static partial Regex HtmlTagRegex();
}
