using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

/// <summary>
/// Code-barres article : EAN-8, UPC-A, EAN-13, GTIN-14 et Code 128.
///
/// <para>
/// Pour les longueurs GTIN, la clé de contrôle est vérifiée à la SAISIE : un code mal recopié
/// est refusé au catalogue plutôt que de dormir jusqu'à ce qu'un scan tombe à côté. C'est un
/// défaut de sûreté, pas de confort : le scan du point de vente cherchait auparavant dans le
/// code produit interne avec repli sur une correspondance approchée, et pouvait donc encaisser
/// un autre article.
/// </para>
///
/// <para>
/// L'extension aux autres symbologies n'assouplit <b>pas</b> cette vérification : un numérique
/// de longueur GTIN dont la clé est fausse reste refusé et ne peut pas se replier sur Code 128.
/// </para>
/// </summary>
public sealed class BarcodeTests
{
    // ─────────────────────── Symbologies acceptées ───────────────────────

    [Theory]
    [InlineData("4006381333931", BarcodeSymbology.Ean13)] // EAN-13 de référence
    [InlineData("5901234123457", BarcodeSymbology.Ean13)] // EAN-13 de référence
    [InlineData("96385074", BarcodeSymbology.Ean8)]       // EAN-8 de référence
    [InlineData("73513537", BarcodeSymbology.Ean8)]       // EAN-8 de référence
    public void ValidEanIsAccepted(string value, BarcodeSymbology expected)
    {
        var result = Barcode.Create(value);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(value, result.Value.Value);
        Assert.Equal(expected, result.Value.Symbology);
    }

    [Theory]
    [InlineData("123456789012")] // clé 2, valide
    [InlineData("036000291452")] // UPC-A de référence
    public void UpcAIsAccepted(string value)
    {
        var result = Barcode.Create(value);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(BarcodeSymbology.UpcA, result.Value.Symbology);
    }

    [Fact]
    public void Gtin14IsAccepted()
    {
        var result = Barcode.Create("40063813339314");

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(BarcodeSymbology.Gtin14, result.Value.Symbology);
    }

    [Theory]
    [InlineData("REF-2024-A")]     // référence interne alphanumérique
    [InlineData("ABC_123.4")]      // ponctuation autorisée
    [InlineData("1234567890")]     // numérique, mais longueur non-GTIN : pas de clé à vérifier
    [InlineData("400638133393A")]  // 13 caractères dont une lettre : ce n'est pas un GTIN
    [InlineData("4006-38133393")]  // 13 caractères dont un tiret : idem
    public void Code128IsAccepted(string value)
    {
        var result = Barcode.Create(value);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(BarcodeSymbology.Code128, result.Value.Symbology);
    }

    // ─────────────────────── Refus ───────────────────────

    [Theory]
    [InlineData("4006381333932")]  // EAN-13, dernier chiffre faussé
    [InlineData("5901234123456")]  // EAN-13
    [InlineData("96385075")]       // EAN-8
    [InlineData("036000291453")]   // UPC-A
    [InlineData("40063813339311")] // GTIN-14
    public void WrongCheckDigitIsRejected(string value)
    {
        var result = Barcode.Create(value);

        Assert.True(result.IsFailure);
        Assert.Contains("Clé de contrôle", result.Error.Description);
    }

    [Fact]
    public void GtinLengthWithWrongCheckDigitNeverFallsBackToCode128()
    {
        // Le point de sûreté de toute l'extension. Si un numérique de 13 chiffres à clé fausse
        // pouvait être classé Code 128, il suffirait de fausser un chiffre pour contourner la
        // vérification — ce qui reviendrait au défaut d'origine.
        foreach (var value in new[] { "96385075", "123456789013", "4006381333932", "40063813339311" })
        {
            var result = Barcode.Create(value);

            Assert.True(result.IsFailure, $"« {value} » ne doit pas être accepté");
            Assert.Contains("Clé de contrôle", result.Error.Description);
        }
    }

    [Theory]
    [InlineData("A/B")]  // segment de chemin : %2F est rejeté par le routage
    [InlineData("A\\B")]
    [InlineData("A%B")]
    [InlineData("A?B")]
    [InlineData("A#B")]
    [InlineData("A&B")]
    [InlineData("A<B")]
    [InlineData("A\"B")]
    public void Code128RejectsPathHostileCharacters(string value)
    {
        // La recherche par code-barres passe par GET api/products/by-barcode/{barcode}, donc
        // par un SEGMENT DE CHEMIN. Un code contenant « / » y serait irrécupérable. Exclure
        // ces caractères à la saisie ferme aussi tout vecteur d'injection dans l'étiquette PDF.
        var result = Barcode.Create(value);

        Assert.True(result.IsFailure, $"« {value} » ne doit pas être accepté");
    }

    [Fact]
    public void TooLongIsRejected()
    {
        var result = Barcode.Create(new string('A', 49));

        Assert.True(result.IsFailure);
        Assert.Contains("48", result.Error.Description);
    }

    [Theory]
    [InlineData("12")]
    [InlineData("A")]
    public void TooShortIsRejected(string value)
    {
        var result = Barcode.Create(value);

        Assert.True(result.IsFailure);
        Assert.Contains("au moins", result.Error.Description);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptyIsRejected(string? value)
    {
        Assert.True(Barcode.Create(value).IsFailure);
    }

    // ─────────────────────── Normalisation ───────────────────────

    [Fact]
    public void SurroundingWhitespaceIsTrimmed()
    {
        var result = Barcode.Create("  4006381333931  ");

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal("4006381333931", result.Value.Value);
    }

    [Fact]
    public void TrimmingCanExposeAnInvalidGtin()
    {
        // « 400638133393 » fait 12 chiffres une fois détouré : c'est une longueur UPC-A, et sa
        // clé est fausse. Il est donc refusé — la présence d'espaces ne doit pas le faire
        // basculer en Code 128.
        var result = Barcode.Create(" 400638133393");

        Assert.True(result.IsFailure);
        Assert.Contains("Clé de contrôle", result.Error.Description);
    }

    // ─────────────────────── Génération ───────────────────────

    [Theory]
    [InlineData("9638507", "96385074")]                 // 7  -> EAN-8
    [InlineData("03600029145", "036000291452")]         // 11 -> UPC-A
    [InlineData("400638133393", "4006381333931")]       // 12 -> EAN-13
    [InlineData("4006381333931", "40063813339314")]     // 13 -> GTIN-14
    public void CheckDigitIsComputedFromBody(string body, string expected)
    {
        var result = Barcode.FromBody(body);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(expected, result.Value.Value);
    }

    [Theory]
    [InlineData("12345")]          // 5 chiffres : aucune longueur GTIN ne correspond
    [InlineData("123456789")]      // 9
    [InlineData("12345678901234")] // 14 : le corps ferait un GTIN-15
    public void FromBodyRejectsNonGtinBodyLengths(string body)
    {
        Assert.True(Barcode.FromBody(body).IsFailure);
    }

    [Fact]
    public void GeneratedBarcodeIsAlwaysValid()
    {
        // Tout code engendré doit repasser la validation : c'est ce qui rend sûre la
        // génération d'un code interne pour un article sans code fournisseur.
        for (var i = 0; i < 200; i++)
        {
            var body = (100000000000L + i * 7919).ToString()[..12];
            var generated = Barcode.FromBody(body);

            Assert.True(generated.IsSuccess, $"corps {body} : {generated.Error?.Description}");
            Assert.True(Barcode.IsValid(generated.Value.Value));
        }
    }

    // ─────────────────────── Symbologie dérivée ───────────────────────

    [Theory]
    [InlineData("96385074")]
    [InlineData("036000291452")]
    [InlineData("4006381333931")]
    [InlineData("40063813339314")]
    [InlineData("REF-2024-A")]
    public void SymbologyIsStableAcrossReconstruction(string value)
    {
        // La symbologie n'est pas persistée : elle se recalcule à partir de la seule colonne
        // stockée. Un aller-retour en base ne doit donc jamais la faire changer.
        var original = Barcode.Create(value).Value;
        var reloaded = Barcode.Create(original.Value).Value;

        Assert.Equal(original.Symbology, reloaded.Symbology);
        Assert.Equal(original.Value, reloaded.Value);
    }

    [Fact]
    public void EqualityDependsOnTheValueAlone()
    {
        // Le contrat d'égalité doit rester exactement celui d'avant l'extension : la
        // symbologie étant dérivée, l'inclure ne changerait rien, mais l'omettre garantit
        // qu'aucun comportement d'égalité ou de dictionnaire ne bouge ailleurs.
        var a = Barcode.Create("4006381333931").Value;
        var b = Barcode.Create("  4006381333931  ").Value;

        Assert.Equal(a, b);
        Assert.Equal(a.GetHashCode(), b.GetHashCode());
    }

    [Fact]
    public void LengthAndStringConversionAreUnchanged()
    {
        var barcode = Barcode.Create("4006381333931").Value;

        Assert.Equal(13, barcode.Length);
        Assert.Equal("4006381333931", barcode.ToString());
        Assert.Equal("4006381333931", (string)barcode);
    }

    // ─────────────────────── Intégration au produit ───────────────────────

    [Fact]
    public void ProductStartsWithoutBarcode()
    {
        Assert.Null(NewProduct().Barcode);
    }

    [Fact]
    public void SettingAValidBarcodeSucceeds()
    {
        var product = NewProduct();

        var result = product.SetBarcode("4006381333931");

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal("4006381333931", product.Barcode!.Value);
    }

    [Fact]
    public void SettingAnInvalidBarcodeIsRejectedAndLeavesTheProductUntouched()
    {
        var product = NewProduct();
        Assert.True(product.SetBarcode("4006381333931").IsSuccess);

        var result = product.SetBarcode("4006381333932"); // clé faussée

        Assert.True(result.IsFailure);
        Assert.Equal("4006381333931", product.Barcode!.Value); // valeur précédente intacte
    }

    [Fact]
    public void SettingNullClearsTheBarcode()
    {
        var product = NewProduct();
        Assert.True(product.SetBarcode("4006381333931").IsSuccess);

        Assert.True(product.SetBarcode(null).IsSuccess);
        Assert.Null(product.Barcode);
    }

    [Fact]
    public void BarcodeIsDistinctFromTheInternalProductCode()
    {
        // Le point clé du correctif : deux identifiants distincts. Le scan doit interroger
        // le code-barres, jamais le code interne.
        var product = NewProduct();
        Assert.True(product.SetBarcode("4006381333931").IsSuccess);

        Assert.Equal("P-EAN", product.Code);
        Assert.NotEqual(product.Code, product.Barcode!.Value);
    }

    private static Product NewProduct() =>
        Product.Create(
            code: "P-EAN",
            name: "Produit scanné",
            type: ProductType.Product,
            unitPrice: Money.Create(100m),
            vatRate: VatRate.Standard,
            categoryId: Guid.NewGuid(),
            unit: "Unité").Value;
}
