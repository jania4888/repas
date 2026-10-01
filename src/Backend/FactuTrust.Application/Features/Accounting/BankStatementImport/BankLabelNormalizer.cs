using System.Globalization;
using System.Text;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Normalisation des libellés bancaires : sert de clé commune aux règles du dossier, au catalogue
/// des opérations, au dédoublonnage inter-relevés et au cache de classification IA.
///
/// « VIREMENT REÇU  Les Grands Ecrans » et « VIREMENT RECU LES GRANDS ECRANS » donnent la même clé.
/// </summary>
public static class BankLabelNormalizer
{
    /// <summary>Majuscules, accents retirés, ponctuation de bord retirée, espaces compactés.</summary>
    public static string Normalize(string? label)
    {
        if (string.IsNullOrWhiteSpace(label))
            return string.Empty;

        var decomposed = label.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        var pendingSpace = false;
        foreach (var ch in decomposed)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (category == UnicodeCategory.NonSpacingMark)
                continue;

            if (char.IsWhiteSpace(ch) || ch == ' ')
            {
                pendingSpace = sb.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                sb.Append(' ');
                pendingSpace = false;
            }

            sb.Append(char.ToUpperInvariant(ch));
        }

        return sb.ToString().Trim(' ', '.', ',', ';', ':', '-', '*', '"', '\'');
    }

    /// <summary>
    /// « Cœur » d'un libellé pour une règle apprise : libellé normalisé dont on retire les
    /// numéros (chèque, effet, références) et les dates, pour qu'une règle mémorisée sur
    /// « RÈG CHÈQUE N° 0001234 » s'applique aussi à « RÈG CHÈQUE N° 0001299 ».
    /// </summary>
    public static string Core(string? label)
    {
        var normalized = Normalize(label);
        if (normalized.Length == 0)
            return normalized;

        var tokens = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(t => !IsVariableToken(t))
            .ToArray();
        return string.Join(' ', tokens).Trim(' ', '.', ',', ';', ':', '-', '/');
    }

    private static bool IsVariableToken(string token)
    {
        var digits = token.Count(char.IsDigit);
        if (digits == 0)
            return false;

        // « N°0001234 », « EFF », « 011220000001 », « 30/09/25 », « AC-TND100000002 », « 2026 »…
        var letters = token.Count(char.IsLetter);
        return digits >= 3 || digits >= letters;
    }
}
