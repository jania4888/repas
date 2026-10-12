using System.Security.Cryptography;
using System.Text;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Clé stable d'une proposition : SHA-256 de <c>compte|devise|id1|id2…</c> (ids au format <c>"D"</c>,
/// triés ordinalement), 16 premiers caractères hexadécimaux en minuscules (annexe C §2.6). Indépendante
/// de l'ordre des lignes ; sert au front (sélection) et aux rapports du lettrage en masse.
/// </summary>
internal static class SuggestionKey
{
    internal const int Length = 16;

    internal static string Compute(string accountNumber, string currencyCode, IEnumerable<Guid> lineIds)
    {
        ArgumentNullException.ThrowIfNull(lineIds);
        var ids = lineIds.Select(id => id.ToString("D")).ToArray();
        Array.Sort(ids, StringComparer.Ordinal);

        var payload = string.Join('|', new[] { accountNumber, currencyCode }.Concat(ids));
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(hash, 0, Length / 2).ToLowerInvariant();
    }
}
