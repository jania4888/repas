using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Tests.Services.Barcodes;

/// <summary>
/// Décodeur écrit <b>pour les tests</b>, volontairement indépendant des tables de l'encodeur.
///
/// <para>
/// Un test qui comparerait la sortie de l'encodeur à des motifs recopiés depuis ce même
/// encodeur ne prouverait rien : il figerait l'erreur au lieu de la révéler. Ici, le décodeur
/// redécrit l'alphabet à partir de la spécification, et l'aller-retour
/// <c>valeur → modules → valeur</c> est ce qui atteste que l'encodage est correct.
/// </para>
/// </summary>
internal static class BarcodeDecoder
{
    // ─────────────────────── EAN / UPC ───────────────────────

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

    private static string LeftEven(int digit) => new(Right[digit].Reverse().ToArray());

    private static readonly string[] ParityByFirstDigit =
    {
        "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
        "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"
    };

    /// <summary>Reconstitue la suite de bits à partir des largeurs (première barre = 1).</summary>
    private static string ToBits(IReadOnlyList<int> widths)
    {
        var bits = new System.Text.StringBuilder();
        var bar = true;

        foreach (var width in widths)
        {
            bits.Append(new string(bar ? '1' : '0', width));
            bar = !bar;
        }

        return bits.ToString();
    }

    public static string DecodeEan13(IReadOnlyList<int> widths)
    {
        var bits = ToBits(widths);
        if (bits.Length != 95) throw new InvalidOperationException($"EAN-13 : {bits.Length} modules au lieu de 95.");
        if (bits[..3] != "101" || bits[45..50] != "01010" || bits[92..] != "101")
            throw new InvalidOperationException("EAN-13 : motifs de garde incorrects.");

        var parity = new char[6];
        var left = new char[6];

        for (var i = 0; i < 6; i++)
        {
            var chunk = bits.Substring(3 + i * 7, 7);
            var digit = Array.FindIndex(LeftOdd, p => p == chunk);
            if (digit >= 0)
            {
                parity[i] = 'L';
            }
            else
            {
                digit = Enumerable.Range(0, 10).FirstOrDefault(d => LeftEven(d) == chunk, -1);
                if (digit < 0) throw new InvalidOperationException($"EAN-13 : chiffre gauche {i} illisible.");
                parity[i] = 'G';
            }
            left[i] = (char)('0' + digit);
        }

        var firstDigit = Array.FindIndex(ParityByFirstDigit, p => p == new string(parity));
        if (firstDigit < 0) throw new InvalidOperationException("EAN-13 : parité gauche inconnue.");

        var right = new char[6];
        for (var i = 0; i < 6; i++)
        {
            var chunk = bits.Substring(50 + i * 7, 7);
            var digit = Array.FindIndex(Right, p => p == chunk);
            if (digit < 0) throw new InvalidOperationException($"EAN-13 : chiffre droit {i} illisible.");
            right[i] = (char)('0' + digit);
        }

        return $"{firstDigit}{new string(left)}{new string(right)}";
    }

    public static string DecodeUpcA(IReadOnlyList<int> widths)
    {
        var ean13 = DecodeEan13(widths);
        if (ean13[0] != '0') throw new InvalidOperationException("UPC-A : le premier chiffre devrait être 0.");
        return ean13[1..];
    }

    public static string DecodeEan8(IReadOnlyList<int> widths)
    {
        var bits = ToBits(widths);
        if (bits.Length != 67) throw new InvalidOperationException($"EAN-8 : {bits.Length} modules au lieu de 67.");
        if (bits[..3] != "101" || bits[31..36] != "01010" || bits[64..] != "101")
            throw new InvalidOperationException("EAN-8 : motifs de garde incorrects.");

        var digits = new char[8];
        for (var i = 0; i < 4; i++)
        {
            var chunk = bits.Substring(3 + i * 7, 7);
            var digit = Array.FindIndex(LeftOdd, p => p == chunk);
            if (digit < 0) throw new InvalidOperationException($"EAN-8 : chiffre gauche {i} illisible.");
            digits[i] = (char)('0' + digit);
        }
        for (var i = 0; i < 4; i++)
        {
            var chunk = bits.Substring(36 + i * 7, 7);
            var digit = Array.FindIndex(Right, p => p == chunk);
            if (digit < 0) throw new InvalidOperationException($"EAN-8 : chiffre droit {i} illisible.");
            digits[4 + i] = (char)('0' + digit);
        }

        return new string(digits);
    }

    // ─────────────────────── ITF-14 ───────────────────────

    private const int N = 1;
    private const int W = 3;

    private static readonly int[][] ItfPatterns =
    {
        new[] { N, N, W, W, N }, new[] { W, N, N, N, W }, new[] { N, W, N, N, W },
        new[] { W, W, N, N, N }, new[] { N, N, W, N, W }, new[] { W, N, W, N, N },
        new[] { N, W, W, N, N }, new[] { N, N, N, W, W }, new[] { W, N, N, W, N },
        new[] { N, W, N, W, N }
    };

    public static string DecodeItf14(IReadOnlyList<int> widths)
    {
        // 77 ÉLÉMENTS (4 de départ + 7 paires à 10 + 3 d'arrêt) pour 135 MODULES : les deux
        // grandeurs diffèrent dès qu'une symbologie a des éléments larges, ce qui est tout
        // l'intérêt de l'entrelacé 2 parmi 5.
        if (widths.Count != 77) throw new InvalidOperationException($"ITF-14 : {widths.Count} éléments au lieu de 77.");
        if (widths.Sum() != 135) throw new InvalidOperationException($"ITF-14 : {widths.Sum()} modules au lieu de 135.");
        if (widths.Take(4).Any(w => w != N)) throw new InvalidOperationException("ITF-14 : motif de départ incorrect.");
        if (widths[^3] != W || widths[^2] != N || widths[^1] != N)
            throw new InvalidOperationException("ITF-14 : motif d'arrêt incorrect.");

        var digits = new char[14];
        var pos = 4;

        for (var pair = 0; pair < 7; pair++)
        {
            var bars = new int[5];
            var spaces = new int[5];

            for (var k = 0; k < 5; k++)
            {
                bars[k] = widths[pos++];
                spaces[k] = widths[pos++];
            }

            digits[pair * 2] = (char)('0' + MatchItf(bars));
            digits[pair * 2 + 1] = (char)('0' + MatchItf(spaces));
        }

        return new string(digits);
    }

    private static int MatchItf(int[] elements)
    {
        for (var digit = 0; digit < 10; digit++)
            if (ItfPatterns[digit].SequenceEqual(elements))
                return digit;

        throw new InvalidOperationException("ITF-14 : motif de chiffre inconnu.");
    }

    // ─────────────────────── Code 128 ───────────────────────

    private static readonly string[] Code128Patterns =
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

    public static string DecodeCode128(IReadOnlyList<int> widths)
    {
        // Tous les symboles font six éléments, sauf l'arrêt qui en fait sept.
        var body = widths.Count - 7;
        if (body <= 0 || body % 6 != 0)
            throw new InvalidOperationException($"Code 128 : {widths.Count} éléments, découpage impossible.");

        var symbols = new List<int>();
        for (var i = 0; i < body; i += 6)
        {
            var pattern = string.Concat(widths.Skip(i).Take(6));
            var value = Array.FindIndex(Code128Patterns, p => p == pattern);
            if (value < 0) throw new InvalidOperationException($"Code 128 : motif « {pattern} » inconnu.");
            symbols.Add(value);
        }

        var stop = string.Concat(widths.Skip(body).Take(7));
        if (stop != Code128Patterns[106]) throw new InvalidOperationException("Code 128 : motif d'arrêt incorrect.");

        if (symbols[0] != 104) throw new InvalidOperationException("Code 128 : le symbole de départ n'est pas START B.");

        var checksum = symbols[^1];
        var data = symbols.GetRange(1, symbols.Count - 2);

        var expected = symbols[0];
        for (var i = 0; i < data.Count; i++)
            expected += data[i] * (i + 1);
        expected %= 103;

        if (expected != checksum)
            throw new InvalidOperationException($"Code 128 : somme de contrôle {checksum} au lieu de {expected}.");

        return new string(data.Select(v => (char)(v + ' ')).ToArray());
    }

    /// <summary>Aiguillage, pour écrire l'aller-retour en une ligne dans les tests.</summary>
    public static string Decode(IReadOnlyList<int> widths, BarcodeSymbology symbology) => symbology switch
    {
        BarcodeSymbology.Ean8 => DecodeEan8(widths),
        BarcodeSymbology.UpcA => DecodeUpcA(widths),
        BarcodeSymbology.Ean13 => DecodeEan13(widths),
        BarcodeSymbology.Gtin14 => DecodeItf14(widths),
        BarcodeSymbology.Code128 => DecodeCode128(widths),
        _ => throw new ArgumentOutOfRangeException(nameof(symbology))
    };
}
