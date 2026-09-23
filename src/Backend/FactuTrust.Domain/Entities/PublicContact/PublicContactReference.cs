using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace FactuTrust.Domain.Entities.PublicContact;

/// <summary>
/// Référence publique d'une demande de contact : <c>CR-</c> + 6 symboles tirés au CSPRNG dans un
/// alphabet sans ambiguïté (pas de 0/O/1/I). Non séquentielle (n'expose pas le volume de demandes),
/// lisible au téléphone. L'unicité est garantie par l'index unique en base, pas ici.
/// </summary>
public static partial class PublicContactReference
{
    public const string Prefix = "CR-";
    public const int SymbolCount = 6;
    public const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>Génère une nouvelle référence, ex. <c>CR-7F3K9Q</c>.</summary>
    public static string Generate()
    {
        return string.Create(Prefix.Length + SymbolCount, Alphabet, static (span, alphabet) =>
        {
            Prefix.AsSpan().CopyTo(span);
            for (var i = Prefix.Length; i < span.Length; i++)
            {
                span[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
            }
        });
    }

    /// <summary>Vrai si la chaîne a la forme exacte d'une référence générée par <see cref="Generate"/>.</summary>
    public static bool IsWellFormed(string? value) => value is not null && WellFormedRegex().IsMatch(value);

    [GeneratedRegex("^CR-[A-HJ-NP-Z2-9]{6}$", RegexOptions.CultureInvariant)]
    private static partial Regex WellFormedRegex();
}
