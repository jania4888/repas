using System.Text;

namespace FactuTrust.Application.Features.PublicContact;

/// <summary>
/// Normalizes a phone number typed on the landing page: Arabic-Indic digits (U+0660–U+0669) become
/// ASCII digits, spaces / dots / dashes / parentheses are removed and the international prefix
/// <c>00216</c> becomes <c>+216</c>. Any other character is kept so that validation rejects it.
/// </summary>
public static class PhoneNormalizer
{
    public static string Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(raw.Length);
        foreach (var c in raw)
        {
            switch (c)
            {
                case >= '\u0660' and <= '\u0669':
                    builder.Append((char)('0' + (c - '\u0660')));
                    break;
                case >= '\u06F0' and <= '\u06F9':
                    builder.Append((char)('0' + (c - '\u06F0')));
                    break;
                case ' ' or '.' or '-' or '(' or ')' or '\u00A0' or '\u2010' or '\u2011' or '\u2012' or '\u2013' or '\u2014':
                    break;
                default:
                    builder.Append(c);
                    break;
            }
        }

        var normalized = builder.ToString();
        if (normalized.StartsWith("00216", StringComparison.Ordinal))
        {
            normalized = string.Concat("+216", normalized.AsSpan(5));
        }

        return normalized;
    }
}
