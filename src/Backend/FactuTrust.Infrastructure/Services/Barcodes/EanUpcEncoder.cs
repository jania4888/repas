namespace FactuTrust.Infrastructure.Services.Barcodes;

/// <summary>
/// EAN-13, EAN-8 et UPC-A.
///
/// <para>
/// Les trois partagent le même alphabet à 7 modules par chiffre et les mêmes motifs de garde.
/// Ce qui les distingue est la façon dont la moitié gauche est encodée : en EAN-13 le
/// <b>premier chiffre n'est pas dessiné</b>, il est porté par l'alternance des jeux L et G des
/// six chiffres suivants. C'est pour cela qu'un EAN-13 tient dans la même largeur qu'un UPC-A.
/// </para>
///
/// <para>
/// Un UPC-A est exactement un EAN-13 préfixé d'un zéro : on le réduit donc au cas EAN-13,
/// dont la table de parité commence par six « L » pour un premier chiffre nul.
/// </para>
/// </summary>
internal static class EanUpcEncoder
{
    // Jeu L : moitié gauche, parité impaire. Le jeu G est le miroir du jeu R, et le jeu R le
    // complément du jeu L — on ne stocke donc que L et R.
    private static readonly string[] LeftOdd =
    {
        "0001101", "0011001", "0010011", "0111101", "0100011",
        "0110001", "0101111", "0111011", "0110111", "0001011"
    };

    private static readonly string[] Right =
    {
        "1110010", "1100110", "1101100", "1000010", "1011100",
        "1001110", "1010000", "1000100", "1001000", "1110100"
    };

    /// <summary>Parité de la moitié gauche selon le premier chiffre. 'L' impaire, 'G' paire.</summary>
    private static readonly string[] ParityByFirstDigit =
    {
        "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
        "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"
    };

    private const string NormalGuard = "101";
    private const string CentreGuard = "01010";

    /// <summary>EAN-13 : 95 modules.</summary>
    public static IReadOnlyList<int> EncodeEan13(string digits)
    {
        Require(digits, 13);

        var parity = ParityByFirstDigit[digits[0] - '0'];
        var bits = new System.Text.StringBuilder(95);

        bits.Append(NormalGuard);
        for (var i = 0; i < 6; i++)
        {
            var digit = digits[i + 1] - '0';
            bits.Append(parity[i] == 'L' ? LeftOdd[digit] : LeftEven(digit));
        }

        bits.Append(CentreGuard);
        for (var i = 7; i < 13; i++)
            bits.Append(Right[digits[i] - '0']);

        bits.Append(NormalGuard);
        return ToModuleWidths(bits.ToString());
    }

    /// <summary>UPC-A : un EAN-13 préfixé d'un zéro, donc 95 modules également.</summary>
    public static IReadOnlyList<int> EncodeUpcA(string digits)
    {
        Require(digits, 12);
        return EncodeEan13("0" + digits);
    }

    /// <summary>EAN-8 : 67 modules, sans encodage de parité — gauche en L, droite en R.</summary>
    public static IReadOnlyList<int> EncodeEan8(string digits)
    {
        Require(digits, 8);

        var bits = new System.Text.StringBuilder(67);

        bits.Append(NormalGuard);
        for (var i = 0; i < 4; i++)
            bits.Append(LeftOdd[digits[i] - '0']);

        bits.Append(CentreGuard);
        for (var i = 4; i < 8; i++)
            bits.Append(Right[digits[i] - '0']);

        bits.Append(NormalGuard);
        return ToModuleWidths(bits.ToString());
    }

    /// <summary>Jeu G : le jeu R lu à l'envers.</summary>
    private static string LeftEven(int digit) =>
        new(Right[digit].Reverse().ToArray());

    private static void Require(string digits, int length)
    {
        if (digits.Length != length || !digits.All(char.IsAsciiDigit))
            throw new ArgumentException(
                $"Cette symbologie attend {length} chiffres (reçu : « {digits} »).", nameof(digits));
    }

    /// <summary>
    /// Convertit une suite de bits en largeurs de modules. Le premier bit vaut toujours 1
    /// (barre de garde), donc la suite commence bien par une barre comme le contrat l'exige.
    /// </summary>
    internal static IReadOnlyList<int> ToModuleWidths(string bits)
    {
        var widths = new List<int>();
        var run = 1;

        for (var i = 1; i < bits.Length; i++)
        {
            if (bits[i] == bits[i - 1])
            {
                run++;
            }
            else
            {
                widths.Add(run);
                run = 1;
            }
        }

        widths.Add(run);
        return widths;
    }
}
