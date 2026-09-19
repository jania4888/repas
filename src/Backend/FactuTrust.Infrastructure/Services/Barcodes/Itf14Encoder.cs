namespace FactuTrust.Infrastructure.Services.Barcodes;

/// <summary>
/// ITF-14 (« entrelacé 2 parmi 5 »), la symbologie des unités logistiques : carton, palette.
///
/// <para>
/// Son principe tient dans son nom : les chiffres vont par paires, le premier dessiné en
/// <b>barres</b>, le second dans les <b>espaces</b> qui les séparent. Deux chiffres occupent
/// donc la place d'un seul, ce qui explique sa compacité — et pourquoi il exige un nombre pair
/// de chiffres. Les 14 chiffres d'un GTIN-14 tombent juste.
/// </para>
/// </summary>
internal static class Itf14Encoder
{
    private const int Narrow = 1;
    private const int Wide = 3;

    /// <summary>
    /// Cinq éléments par chiffre, dont exactement deux larges — d'où « 2 parmi 5 ».
    /// </summary>
    private static readonly int[][] Patterns =
    {
        new[] { Narrow, Narrow, Wide, Wide, Narrow },   // 0
        new[] { Wide, Narrow, Narrow, Narrow, Wide },   // 1
        new[] { Narrow, Wide, Narrow, Narrow, Wide },   // 2
        new[] { Wide, Wide, Narrow, Narrow, Narrow },   // 3
        new[] { Narrow, Narrow, Wide, Narrow, Wide },   // 4
        new[] { Wide, Narrow, Wide, Narrow, Narrow },   // 5
        new[] { Narrow, Wide, Wide, Narrow, Narrow },   // 6
        new[] { Narrow, Narrow, Narrow, Wide, Wide },   // 7
        new[] { Wide, Narrow, Narrow, Wide, Narrow },   // 8
        new[] { Narrow, Wide, Narrow, Wide, Narrow }    // 9
    };

    private static readonly int[] StartPattern = { Narrow, Narrow, Narrow, Narrow };
    private static readonly int[] StopPattern = { Wide, Narrow, Narrow };

    /// <summary>GTIN-14 : 135 modules (4 de départ, 7 paires à 18, 5 d'arrêt).</summary>
    public static IReadOnlyList<int> EncodeGtin14(string digits)
    {
        if (digits.Length != 14 || !digits.All(char.IsAsciiDigit))
            throw new ArgumentException(
                $"L'ITF-14 attend 14 chiffres (reçu : « {digits} »).", nameof(digits));

        var widths = new List<int>(135);
        widths.AddRange(StartPattern);

        for (var i = 0; i < digits.Length; i += 2)
        {
            var bars = Patterns[digits[i] - '0'];
            var spaces = Patterns[digits[i + 1] - '0'];

            // Entrelacement : barre du premier chiffre, espace du second, et ainsi de suite.
            for (var k = 0; k < 5; k++)
            {
                widths.Add(bars[k]);
                widths.Add(spaces[k]);
            }
        }

        widths.AddRange(StopPattern);
        return widths;
    }

    /// <summary>Exposé pour le décodeur de test : mêmes motifs, une seule source de vérité.</summary>
    internal static IReadOnlyList<IReadOnlyList<int>> DigitPatterns => Patterns;
}
