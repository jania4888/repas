using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Services.Barcodes;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Barcodes;

/// <summary>
/// Encodeur de codes-barres linéaires.
///
/// <para>
/// La garantie principale est apportée par l'<b>aller-retour</b> : un décodeur indépendant,
/// écrit dans le projet de test à partir de la spécification, doit retrouver la valeur
/// d'origine. Épingler des motifs recopiés depuis l'encodeur figerait une erreur au lieu de la
/// révéler ; un aller-retour, lui, échoue dès qu'une table est fausse.
/// </para>
///
/// <para>
/// Les largeurs totales sont vérifiées séparément : ce sont des invariants publiés des
/// symbologies (95 modules pour un EAN-13, 67 pour un EAN-8…), indépendants de notre code.
/// Une étiquette à la mauvaise largeur ne se voit pas à l'écran — elle se voit sur le papier,
/// trop tard.
/// </para>
/// </summary>
public sealed class BarcodeEncoderTests
{
    private readonly BarcodeEncoder _encoder = new();

    // ─────────────────────── Largeurs publiées ───────────────────────

    [Theory]
    [InlineData("4006381333931", BarcodeSymbology.Ean13, 95)]
    [InlineData("5901234123457", BarcodeSymbology.Ean13, 95)]
    [InlineData("036000291452", BarcodeSymbology.UpcA, 95)]
    [InlineData("96385074", BarcodeSymbology.Ean8, 67)]
    [InlineData("40063813339314", BarcodeSymbology.Gtin14, 135)]
    public void ModuleCountMatchesTheSpecification(string value, BarcodeSymbology symbology, int expected)
    {
        var widths = _encoder.Encode(value, symbology);

        Assert.Equal(expected, widths.Sum());
    }

    [Fact]
    public void Code128ModuleCountFollowsTheSymbolFormula()
    {
        // 11 modules par symbole (départ + données + contrôle), 13 pour l'arrêt.
        const string value = "REF-2024-A";
        var widths = _encoder.Encode(value, BarcodeSymbology.Code128);

        var expected = 11 * (1 + value.Length + 1) + 13;
        Assert.Equal(expected, widths.Sum());
    }

    [Theory]
    [InlineData("4006381333931", BarcodeSymbology.Ean13)]
    [InlineData("96385074", BarcodeSymbology.Ean8)]
    [InlineData("036000291452", BarcodeSymbology.UpcA)]
    [InlineData("40063813339314", BarcodeSymbology.Gtin14)]
    [InlineData("REF-2024-A", BarcodeSymbology.Code128)]
    public void EveryEncodingStartsWithABar(string value, BarcodeSymbology symbology)
    {
        // Contrat de l'interface : l'alternance commence par une barre. Le rendu s'y fie pour
        // savoir quels rectangles noircir ; l'inverser produirait un négatif illisible.
        var widths = _encoder.Encode(value, symbology);

        Assert.NotEmpty(widths);
        Assert.All(widths, w => Assert.InRange(w, 1, 4));
    }

    [Theory]
    [InlineData("4006381333931", BarcodeSymbology.Ean13)]
    [InlineData("96385074", BarcodeSymbology.Ean8)]
    public void GuardPatternsFrameTheSymbol(string value, BarcodeSymbology symbology)
    {
        var widths = _encoder.Encode(value, symbology);

        // Gardes normales « 101 » : trois modules unitaires à chaque extrémité.
        Assert.Equal(new[] { 1, 1, 1 }, widths.Take(3));
        Assert.Equal(new[] { 1, 1, 1 }, widths.TakeLast(3));
    }

    // ─────────────────────── Aller-retour ───────────────────────

    [Theory]
    [InlineData("4006381333931", BarcodeSymbology.Ean13)]
    [InlineData("5901234123457", BarcodeSymbology.Ean13)]
    [InlineData("0036000291452", BarcodeSymbology.Ean13)]
    [InlineData("96385074", BarcodeSymbology.Ean8)]
    [InlineData("73513537", BarcodeSymbology.Ean8)]
    [InlineData("036000291452", BarcodeSymbology.UpcA)]
    [InlineData("123456789012", BarcodeSymbology.UpcA)]
    [InlineData("40063813339314", BarcodeSymbology.Gtin14)]
    [InlineData("REF-2024-A", BarcodeSymbology.Code128)]
    [InlineData("ABC_123.4", BarcodeSymbology.Code128)]
    [InlineData("1234567890", BarcodeSymbology.Code128)]
    public void ReferenceValuesSurviveARoundTrip(string value, BarcodeSymbology symbology)
    {
        var widths = _encoder.Encode(value, symbology);

        Assert.Equal(value, BarcodeDecoder.Decode(widths, symbology));
    }

    [Fact]
    public void EveryEanThirteenSurvivesARoundTrip()
    {
        // Balayage large : la table de parité de la moitié gauche dépend du PREMIER chiffre,
        // donc une erreur peut n'affecter qu'une seule des dix familles de préfixe. Un seul
        // vecteur de référence ne la verrait pas.
        for (var first = 0; first <= 9; first++)
        {
            for (var i = 0; i < 40; i++)
            {
                var body = first.ToString() + (100000000000L + i * 8191).ToString()[..11];
                var barcode = Barcode.FromBody(body).Value.Value;

                var widths = _encoder.Encode(barcode, BarcodeSymbology.Ean13);

                Assert.Equal(95, widths.Sum());
                Assert.Equal(barcode, BarcodeDecoder.DecodeEan13(widths));
            }
        }
    }

    [Fact]
    public void EveryEanEightSurvivesARoundTrip()
    {
        for (var i = 0; i < 300; i++)
        {
            var body = (1000000 + i * 7).ToString()[..7];
            var barcode = Barcode.FromBody(body).Value.Value;

            var widths = _encoder.Encode(barcode, BarcodeSymbology.Ean8);

            Assert.Equal(67, widths.Sum());
            Assert.Equal(barcode, BarcodeDecoder.DecodeEan8(widths));
        }
    }

    [Fact]
    public void EveryGtin14SurvivesARoundTrip()
    {
        for (var i = 0; i < 300; i++)
        {
            var body = (1000000000000L + i * 104729).ToString()[..13];
            var barcode = Barcode.FromBody(body).Value.Value;

            var widths = _encoder.Encode(barcode, BarcodeSymbology.Gtin14);

            Assert.Equal(135, widths.Sum());
            Assert.Equal(barcode, BarcodeDecoder.DecodeItf14(widths));
        }
    }

    [Fact]
    public void EveryCode128CharacterSurvivesARoundTrip()
    {
        // Tout le jeu de caractères que le catalogue accepte, plus le reste de l'ASCII
        // imprimable : un décalage d'un cran dans la table se verrait immédiatement.
        var alphabet = string.Concat(Enumerable.Range(' ', '~' - ' ' + 1).Select(c => (char)c));

        for (var start = 0; start < alphabet.Length; start += 8)
        {
            // Encadré de 'X' : l'encodeur détoure les espaces de bord, comme Barcode.Create.
            // Sans cet encadrement, un tronçon commençant par l'espace perdrait son premier
            // caractère et l'aller-retour échouerait pour une raison qui n'est pas la sienne.
            var value = "X" + new string(alphabet.Skip(start).Take(8).ToArray()) + "X";

            var widths = _encoder.Encode(value, BarcodeSymbology.Code128);

            Assert.Equal(value, BarcodeDecoder.DecodeCode128(widths));
        }
    }

    [Fact]
    public void EdgeWhitespaceIsTrimmedLikeItIsAtTheCatalogue()
    {
        // Même normalisation que Barcode.Create : ce qui est stocké n'a pas d'espace de bord,
        // et l'étiquette doit porter exactement ce qui est stocké. Les espaces INTERNES, eux,
        // sont des caractères Code 128 légitimes et doivent survivre.
        var trimmed = _encoder.Encode("  A B  ", BarcodeSymbology.Code128);

        Assert.Equal("A B", BarcodeDecoder.DecodeCode128(trimmed));
    }

    [Fact]
    public void Code128ChecksumIsVerifiedByTheDecoder()
    {
        // Le décodeur recalcule la somme de contrôle : cet aller-retour vaut donc aussi
        // vérification du modulo 103, sans avoir à figer une valeur attendue.
        var widths = _encoder.Encode("FACTUTRUST", BarcodeSymbology.Code128);

        Assert.Equal("FACTUTRUST", BarcodeDecoder.DecodeCode128(widths));
    }

    // ─────────────────────── Refus ───────────────────────

    [Theory]
    [InlineData("123456", BarcodeSymbology.Ean13)]
    [InlineData("4006381333931", BarcodeSymbology.Ean8)]
    [InlineData("4006381333931", BarcodeSymbology.UpcA)]
    [InlineData("4006381333931", BarcodeSymbology.Gtin14)]
    [InlineData("ABC", BarcodeSymbology.Ean13)]
    public void AValueIncompatibleWithTheSymbologyIsRefused(string value, BarcodeSymbology symbology)
    {
        // Mieux vaut une exception qu'une étiquette imprimée de travers : une erreur de
        // longueur produirait des barres qu'aucune douchette ne lirait.
        Assert.Throws<ArgumentException>(() => _encoder.Encode(value, symbology));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void AnEmptyValueIsRefused(string value)
    {
        Assert.Throws<ArgumentException>(() => _encoder.Encode(value, BarcodeSymbology.Code128));
    }

    [Fact]
    public void ANonPrintableCharacterIsRefusedInCode128()
    {
        Assert.Throws<ArgumentException>(() => _encoder.Encode("A\tB", BarcodeSymbology.Code128));
    }

    // ─────────────────────── Texte lisible ───────────────────────

    [Theory]
    [InlineData("4006381333931", BarcodeSymbology.Ean13, "4 006381 333931")]
    [InlineData("036000291452", BarcodeSymbology.UpcA, "0 36000 29145 2")]
    [InlineData("96385074", BarcodeSymbology.Ean8, "9638 5074")]
    [InlineData("40063813339314", BarcodeSymbology.Gtin14, "4 00 63813 33931 4")]
    [InlineData("REF-2024-A", BarcodeSymbology.Code128, "REF-2024-A")]
    public void HumanReadableFollowsTheConventionalGrouping(
        string value, BarcodeSymbology symbology, string expected)
    {
        Assert.Equal(expected, _encoder.HumanReadable(value, symbology));
    }

    [Fact]
    public void HumanReadableFallsBackToTheRawValueOnALengthMismatch()
    {
        // Le groupement est un confort de lecture : il ne doit jamais faire échouer une
        // impression, même sur une valeur inattendue.
        Assert.Equal("12345", _encoder.HumanReadable("12345", BarcodeSymbology.Ean13));
    }
}
