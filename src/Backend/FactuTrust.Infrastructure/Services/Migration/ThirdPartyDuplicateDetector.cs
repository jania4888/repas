using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Infrastructure.Services.Migration;

/// <summary>Vue aplatie d'un tiers (importé ou existant) pour la détection de doublons.</summary>
internal sealed record ThirdPartySnapshot(
    string Ref,
    string Name,
    string? Nif,
    string? Email,
    string? Phone,
    string? City,
    string Origin);

/// <summary>Interne : paire scorée avant mise en forme en DTO.</summary>
internal sealed record DuplicateMatch(
    ThirdPartySnapshot Imported,
    ThirdPartySnapshot Existing,
    double Score,
    string Reason);

/// <summary>
/// Détection DÉTERMINISTE de doublons de tiers (N1 / M3). Signaux combinés par score maximal :
/// matricule fiscal, email, téléphone, nom normalisé (formes juridiques retirées), proximité
/// orthographique bornée (Levenshtein ≤ 2) avec confirmation par la ville. Chaque paire porte
/// un motif lisible — explicable devant un auditeur, aucun appel LLM.
/// </summary>
internal static class ThirdPartyDuplicateDetector
{
    private static readonly HashSet<string> LegalFormTokens = new(StringComparer.Ordinal)
    {
        "societe", "ste", "sarl", "suarl", "sa", "snc", "scs", "ets",
        "etablissement", "etablissements", "entreprise", "groupe", "holding", "sarlu"
    };

    /// <summary>
    /// Détecte les paires candidates : importé ↔ existant ET importé ↔ importé (doublons internes
    /// au fichier). Les paires sous <paramref name="minScore"/> sont écartées ; tri décroissant.
    /// </summary>
    public static IReadOnlyList<DuplicateMatch> Detect(
        IReadOnlyList<ThirdPartySnapshot> imported,
        IReadOnlyList<ThirdPartySnapshot> existing,
        double minScore,
        int maxPairs)
    {
        var matches = new List<DuplicateMatch>();

        foreach (var imp in imported)
        {
            foreach (var ext in existing)
            {
                var m = Score(imp, ext);
                if (m is not null && m.Score >= minScore) matches.Add(m);
            }
        }

        // Doublons internes au fichier importé (chaque paire une seule fois).
        for (var i = 0; i < imported.Count; i++)
        {
            for (var j = i + 1; j < imported.Count; j++)
            {
                var m = Score(imported[i], imported[j]);
                if (m is not null && m.Score >= minScore) matches.Add(m);
            }
        }

        return matches
            .OrderByDescending(m => m.Score)
            .ThenBy(m => m.Imported.Ref, StringComparer.Ordinal)
            .Take(Math.Max(1, maxPairs))
            .ToList();
    }

    /// <summary>Score la paire ; null si aucun signal ne se déclenche.</summary>
    private static DuplicateMatch? Score(ThirdPartySnapshot a, ThirdPartySnapshot b)
    {
        // Signaux forts (quasi-certitude).
        if (SameNif(a.Nif, b.Nif))
            return new DuplicateMatch(a, b, 1.0, "Même matricule fiscal");

        if (!string.IsNullOrWhiteSpace(a.Email) && !string.IsNullOrWhiteSpace(b.Email)
            && string.Equals(a.Email.Trim(), b.Email.Trim(), StringComparison.OrdinalIgnoreCase))
            return new DuplicateMatch(a, b, 0.95, "Même adresse email");

        var phoneA = NormalizePhone(a.Phone);
        var phoneB = NormalizePhone(b.Phone);
        if (phoneA is { Length: >= 6 } && phoneA == phoneB)
            return new DuplicateMatch(a, b, 0.9, "Même numéro de téléphone");

        // Signaux de nom.
        var nameA = NormalizeName(a.Name);
        var nameB = NormalizeName(b.Name);
        if (nameA.Length == 0 || nameB.Length == 0)
            return null;

        if (nameA == nameB)
            return new DuplicateMatch(a, b, 0.85, "Noms identiques après normalisation");

        var sameCity = !string.IsNullOrWhiteSpace(a.City) && !string.IsNullOrWhiteSpace(b.City)
            && string.Equals(
                TabularFileParsing.Normalize(a.City),
                TabularFileParsing.Normalize(b.City),
                StringComparison.Ordinal);

        if (sameCity && BoundedLevenshtein(nameA, nameB, 2) <= 2)
            return new DuplicateMatch(a, b, 0.7, "Noms très proches, même ville");

        if (BoundedLevenshtein(nameA, nameB, 1) <= 1)
            return new DuplicateMatch(a, b, 0.65, "Noms quasi identiques");

        return null;
    }

    /// <summary>
    /// Normalise un nom de tiers : découpage en tokens, suppression des accents/casse par token,
    /// retrait des formes juridiques (STE, SARL, SUARL…), recomposition. Le retrait se fait AVANT
    /// la concaténation pour ne pas corrompre les noms contenant « sa » ou « ste » (ex. « Santé »).
    /// </summary>
    /// <summary>
    /// Compare deux matricules sur leur forme CANONIQUE. Depuis la canonicalisation du NIF, la base
    /// stocke la forme carte (<c>NNNNNNNL/A/M/NNN</c>) alors qu'un fichier importé porte souvent la
    /// forme historique (<c>NNNNNNN/L/A/M/NNN</c>) : comparées brutes, elles ne se reconnaissaient
    /// plus, et un doublon certain retombait au mieux sur la similarité de nom (0,85). Une valeur
    /// non reconnue comme NIF garde l'ancienne comparaison, pour ne rien perdre des cas existants.
    /// </summary>
    internal static bool SameNif(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b))
            return false;

        var left = NIF.TryCanonicalize(a, out var canonicalA) ? canonicalA : a.Trim();
        var right = NIF.TryCanonicalize(b, out var canonicalB) ? canonicalB : b.Trim();
        return string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    }

    internal static string NormalizeName(string name)
    {
        var tokens = name
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(TabularFileParsing.Normalize)
            .Where(t => t.Length > 0)
            .Where(t => !LegalFormTokens.Contains(t))
            .ToArray();
        return string.Concat(tokens);
    }

    private static string? NormalizePhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        // Trunk international : 00216…/ +216…/216… alignés sur le national.
        if (digits.StartsWith("00216", StringComparison.Ordinal)) digits = digits[5..];
        else if (digits.StartsWith("216", StringComparison.Ordinal) && digits.Length > 8) digits = digits[3..];
        return digits;
    }

    /// <summary>Distance de Levenshtein avec abandon dès que <paramref name="maxDistance"/> est dépassé.</summary>
    internal static int BoundedLevenshtein(string a, string b, int maxDistance)
    {
        if (Math.Abs(a.Length - b.Length) > maxDistance) return maxDistance + 1;

        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++) previous[j] = j;

        for (var i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            var rowMin = current[0];
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(
                    Math.Min(previous[j] + 1, current[j - 1] + 1),
                    previous[j - 1] + cost);
                rowMin = Math.Min(rowMin, current[j]);
            }
            if (rowMin > maxDistance) return maxDistance + 1;
            (previous, current) = (current, previous);
        }

        return previous[b.Length];
    }
}
