using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Extrait les références de pièce (<c>FAC-2026-001</c>, <c>REG2026-005</c>…) d'une ligne
/// d'écriture, pour la règle R2 « même référence » du moteur de propositions (plan v2, annexe C §2.4).
/// </summary>
/// <remarks>
/// <para>
/// Sûr face aux entrées hostiles (libellés saisis par l'utilisateur) :
/// chaque entrée est tronquée à <see cref="MaxInputLength"/> caractères AVANT tout traitement ;
/// la normalisation se fait par boucle de caractères, sans regex ; le motif est compilé avec
/// <see cref="RegexOptions.NonBacktracking"/> (temps linéaire garanti, aucun ReDoS possible) et
/// garde un délai de 50 ms par défense en profondeur. Pas de <c>[GeneratedRegex]</c> : le
/// générateur source ne prend pas en charge <c>NonBacktracking</c>.
/// </para>
/// <para>
/// Pur et déterministe : même entrée, même liste (jetons distincts, triés ordinalement).
/// Aucune donnée de la ligne n'est journalisée, seulement sa longueur.
/// </para>
/// </remarks>
internal static class ReferenceExtractor
{
    /// <summary>Longueur maximale lue par champ (le libellé fait au plus 500 caractères).</summary>
    internal const int MaxInputLength = 600;

    private const int MinTokenLength = 5;
    private const int MinTokenDigits = 3;

    private static readonly Regex TokenPattern = new(
        @"\b[A-Z]{2,10}-?\d{2,6}(?:-\d{1,8}){0,3}\b",
        RegexOptions.NonBacktracking | RegexOptions.CultureInvariant,
        TimeSpan.FromMilliseconds(50));

    /// <summary>
    /// Jetons de référence distincts, triés ordinalement, trouvés dans la référence de pièce, le
    /// libellé de la ligne et le libellé de l'écriture.
    /// </summary>
    internal static IReadOnlyList<string> Extract(string? pieceRef, string? label, string? entryLabel, ILogger? logger = null)
    {
        var tokens = new SortedSet<string>(StringComparer.Ordinal);
        AddTokens(pieceRef, tokens, logger);
        AddTokens(label, tokens, logger);
        AddTokens(entryLabel, tokens, logger);
        return tokens.Count == 0 ? Array.Empty<string>() : tokens.ToArray();
    }

    private static void AddTokens(string? input, SortedSet<string> tokens, ILogger? logger)
    {
        if (string.IsNullOrWhiteSpace(input))
            return;

        var normalized = Normalize(input);
        if (normalized.Length < MinTokenLength)
            return;

        try
        {
            foreach (Match match in TokenPattern.Matches(normalized))
            {
                var token = match.Value;
                if (token.Length >= MinTokenLength && CountDigits(token) >= MinTokenDigits)
                    tokens.Add(token);
            }
        }
        catch (RegexMatchTimeoutException)
        {
            // Défense en profondeur : NonBacktracking rend ce cas théorique. On ignore la ligne
            // (zéro jeton) sans journaliser son contenu.
            logger?.LogWarning(
                "Extraction de référence de lettrage abandonnée (délai dépassé) pour une entrée de {Length} caractères.",
                normalized.Length);
        }
    }

    /// <summary>
    /// Troncature, majuscules invariantes, retrait des diacritiques, séparateurs (espaces, <c>_</c>,
    /// <c>/</c>, <c>.</c>, <c>\</c>) remplacés par <c>-</c>, tirets multiples réduits à un seul.
    /// </summary>
    internal static string Normalize(string input)
    {
        var truncated = input.Length > MaxInputLength ? input[..MaxInputLength] : input;
        var decomposed = truncated.ToUpperInvariant().Normalize(NormalizationForm.FormD);

        var sb = new StringBuilder(decomposed.Length);
        var previousDash = false;
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
                continue;

            var c = char.IsWhiteSpace(ch) || ch is '_' or '/' or '.' or '\\' ? '-' : ch;
            if (c == '-')
            {
                if (previousDash)
                    continue;
                previousDash = true;
            }
            else
            {
                previousDash = false;
            }
            sb.Append(c);
        }

        return sb.ToString();
    }

    private static int CountDigits(string token)
    {
        var count = 0;
        foreach (var ch in token)
        {
            if (ch is >= '0' and <= '9')
                count++;
        }
        return count;
    }
}
