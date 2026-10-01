using System.Numerics;

namespace FactuTrust.Domain.Banking;

/// <summary>
/// Helpers RIB / IBAN tunisiens (20 chiffres → IBAN TN + clé ISO 13616).
/// Fonctions pures, sans dépendance infrastructure.
/// </summary>
public static class TunisianIban
{
    /// <summary>Normalise un RIB en ne conservant que les chiffres.</summary>
    public static string NormalizeRibDigits(string? rib)
    {
        if (string.IsNullOrWhiteSpace(rib))
            return string.Empty;
        return new string(rib.Where(char.IsDigit).ToArray());
    }

    /// <summary>True si le RIB contient exactement 20 chiffres.</summary>
    public static bool IsValidRibDigits(string? rib)
    {
        var digits = NormalizeRibDigits(rib);
        return digits.Length == 20;
    }

    /// <summary>
    /// True si le RIB a 20 chiffres ET une clé (2 derniers chiffres) cohérente :
    /// clé = 97 − ((18 premiers chiffres × 100) mod 97). Vérifié sur des RIB réels STB, BH,
    /// Zitouna, Attijari et BIAT. Volontairement distinct de <see cref="IsValidRibDigits"/>,
    /// dont le contrat (longueur seule) est utilisé ailleurs et ne doit pas changer.
    /// </summary>
    public static bool HasValidRibKey(string? rib)
    {
        var digits = NormalizeRibDigits(rib);
        if (digits.Length != 20)
            return false;

        var body = BigInteger.Parse(digits[..18]);
        var expected = 97 - (int)((body * 100) % 97);
        return int.Parse(digits[18..]) == expected;
    }

    /// <summary>Code banque BCT (2 premiers chiffres du RIB), ou null si le RIB n'a pas 20 chiffres.</summary>
    public static string? BankCodeOf(string? rib)
    {
        var digits = NormalizeRibDigits(rib);
        return digits.Length == 20 ? digits[..2] : null;
    }

    /// <summary>
    /// Dérive l'IBAN tunisien (24 caractères) à partir d'un RIB de 20 chiffres.
    /// Retourne null si le RIB est invalide.
    /// </summary>
    public static string? FromRib(string? rib)
    {
        var digits = NormalizeRibDigits(rib);
        if (digits.Length != 20)
            return null;

        // Rearrangement ISO 13616 : RIB + "TN00" → chiffres (T=29, N=23).
        var numeric = digits + "292300";
        var mod = (int)(BigInteger.Parse(numeric) % 97);
        var check = 98 - mod;
        return $"TN{check:D2}{digits}";
    }
}
