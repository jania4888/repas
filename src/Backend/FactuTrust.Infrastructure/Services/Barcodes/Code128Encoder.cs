namespace FactuTrust.Infrastructure.Services.Barcodes;

/// <summary>
/// Code 128, jeu B.
///
/// <para>
/// Seul le jeu B est implémenté, et c'est suffisant : il couvre l'ASCII imprimable de l'espace
/// au tilde, donc tout le jeu de caractères que le catalogue accepte. Le jeu C compacterait les
/// chiffres deux par deux, mais un code purement numérique de longueur GTIN est refusé en
/// amont au profit d'un EAN ou d'un ITF — il n'y a donc rien à y gagner ici, et un aiguillage
/// entre jeux serait du code non testé en production.
/// </para>
/// </summary>
internal static class Code128Encoder
{
    private const int StartB = 104;
    private const int Stop = 106;
    private const int ChecksumModulus = 103;

    /// <summary>
    /// 107 motifs de six éléments (trois barres, trois espaces), plus l'arrêt à sept éléments.
    /// L'indice est la valeur du symbole ; en jeu B, valeur = code ASCII − 32.
    /// </summary>
    private static readonly string[] Patterns =
    {
        "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
        "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
        "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
        "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
        "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
        "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
        "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
        "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
        "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
        "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
        "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
        "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
        "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
        "211214", "211232", "2331112"
    };

    public static IReadOnlyList<int> Encode(string value)
    {
        if (string.IsNullOrEmpty(value))
            throw new ArgumentException("La valeur à encoder est vide.", nameof(value));

        var symbols = new List<int>(value.Length + 3) { StartB };

        foreach (var c in value)
        {
            if (c < ' ' || c > '~')
                throw new ArgumentException(
                    $"Le caractère « {c} » n'est pas représentable en Code 128 jeu B.", nameof(value));

            symbols.Add(c - ' ');
        }

        symbols.Add(Checksum(symbols));
        symbols.Add(Stop);

        var widths = new List<int>(symbols.Count * 6 + 1);
        foreach (var symbol in symbols)
        {
            foreach (var element in Patterns[symbol])
                widths.Add(element - '0');
        }

        return widths;
    }

    /// <summary>
    /// Somme pondérée modulo 103 : le symbole de départ compte pour 1, puis chaque donnée est
    /// multipliée par sa position. Sans elle, une barre mal imprimée passerait pour une autre
    /// valeur sans que rien ne le signale — le Code 128 n'a pas d'autre garde-fou.
    /// </summary>
    private static int Checksum(IReadOnlyList<int> symbolsIncludingStart)
    {
        var sum = symbolsIncludingStart[0];
        for (var i = 1; i < symbolsIncludingStart.Count; i++)
            sum += symbolsIncludingStart[i] * i;

        return sum % ChecksumModulus;
    }

    /// <summary>Exposé pour le décodeur de test : une seule source de vérité pour les motifs.</summary>
    internal static IReadOnlyList<string> SymbolPatterns => Patterns;
}
