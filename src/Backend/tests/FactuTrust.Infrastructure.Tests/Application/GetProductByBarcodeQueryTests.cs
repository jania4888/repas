using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Résolution d'un code scanné en article.
///
/// <para>
/// Le format est vérifié AVANT d'interroger la base : un code mal formé n'a aucune chance de
/// correspondre, et le refuser tout de suite donne un message utile au caissier plutôt qu'un
/// « article introuvable » trompeur.
/// </para>
/// </summary>
public sealed class GetProductByBarcodeQueryTests
{
    private readonly Mock<IProductRepository> _repo = new();

    private GetProductByBarcodeQueryHandler Handler() => new(_repo.Object);

    private static Product NewProduct(string code = "ART-1", string? barcode = null)
    {
        var product = Product.Create(
            code, "Article", ProductType.Product,
            Money.Create(20m, Money.DefaultCurrency),
            VatRate.Standard, Guid.NewGuid()).Value;

        typeof(Product).GetProperty(nameof(Product.Category))!
            .SetValue(product, ProductCategory.Create("GEN", "Général").Value);

        if (barcode is not null)
            Assert.True(product.SetBarcode(barcode).IsSuccess);

        return product;
    }

    [Fact]
    public async Task Handle_VariantTemplate_IsRefused()
    {
        var product = Product.Create(
            "TSHIRT",
            "T-shirt",
            ProductType.Product,
            Money.Create(20m, Money.DefaultCurrency),
            VatRate.Standard,
            Guid.NewGuid()).Value;
        Assert.True(product.MarkAsVariantTemplate().IsSuccess);

        _repo.Setup(r => r.GetByBarcodeAsync("4006381333931", It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);

        var result = await Handler().Handle(
            new GetProductByBarcodeQuery("4006381333931"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("variante", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Handle_KnownBarcode_ReturnsTheProductWithItsSymbology()
    {
        var product = NewProduct(barcode: "4006381333931");
        _repo.Setup(r => r.GetByBarcodeAsync("4006381333931", It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);

        var result = await Handler().Handle(
            new GetProductByBarcodeQuery("4006381333931"), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal("4006381333931", result.Value.Barcode);
        Assert.Equal(nameof(BarcodeSymbology.Ean13), result.Value.BarcodeSymbology);
    }

    [Fact]
    public async Task Handle_UnknownBarcode_ReturnsNotFoundWithTheExactCodeTheControllerKeysOn()
    {
        // ProductsController renvoie 404 si et seulement si Error.Code vaut « NotFound ».
        // La surcharge Error.NotFound(entité, id) produirait « Product.NotFound », donc un 400
        // portant un message technique anglais avec un identifiant vide — et les écrans ne
        // pourraient plus distinguer un code inconnu d'un code mal formé.
        _repo.Setup(r => r.GetByBarcodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);

        var result = await Handler().Handle(
            new GetProductByBarcodeQuery("4006381333931"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        Assert.DoesNotContain("00000000", result.Error.Description);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Handle_EmptyInput_IsRefusedWithoutTouchingTheDatabase(string barcode)
    {
        var result = await Handler().Handle(
            new GetProductByBarcodeQuery(barcode), CancellationToken.None);

        Assert.True(result.IsFailure);
        _repo.Verify(r => r.GetByBarcodeAsync(
            It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_MalformedBarcode_IsRefusedWithoutTouchingTheDatabase()
    {
        // Clé de contrôle faussée : inutile d'interroger la base, et le message doit dire
        // pourquoi plutôt que de laisser croire à un article manquant.
        var result = await Handler().Handle(
            new GetProductByBarcodeQuery("4006381333932"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Barcode", result.Error.Code);
        _repo.Verify(r => r.GetByBarcodeAsync(
            It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_ACode128Value_NowReachesTheDatabase()
    {
        // Changement de comportement assumé depuis l'extension des symbologies : une valeur
        // alphanumérique comme un code produit interne était autrefois refusée d'emblée pour
        // format invalide (400). C'est désormais un Code 128 valide, donc la base est
        // interrogée et la réponse devient « introuvable » (404) si rien ne correspond.
        //
        // Aucune régression en caisse : le scan retombe sur le code produit interne dans les
        // deux cas, l'erreur et l'absence passant par le même chemin côté client. En
        // contrepartie, un article dont le champ code-barres contient littéralement cette
        // valeur est maintenant trouvé.
        var product = NewProduct("REF-2024-A", barcode: "REF-2024-A");
        _repo.Setup(r => r.GetByBarcodeAsync("REF-2024-A", It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);

        var result = await Handler().Handle(
            new GetProductByBarcodeQuery("REF-2024-A"), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(nameof(BarcodeSymbology.Code128), result.Value.BarcodeSymbology);
    }

    [Fact]
    public async Task Handle_AnUpcAScan_IsForwardedVerbatimToTheRepository()
    {
        // L'équivalence UPC-A / EAN-13 est résolue par le repository, pas ici : la requête ne
        // doit surtout pas normaliser le code, sous peine de faire diverger les deux couches.
        var product = NewProduct(barcode: "036000291452");
        _repo.Setup(r => r.GetByBarcodeAsync("036000291452", It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);

        var result = await Handler().Handle(
            new GetProductByBarcodeQuery("036000291452"), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal("036000291452", result.Value.Barcode);
        Assert.Equal(nameof(BarcodeSymbology.UpcA), result.Value.BarcodeSymbology);
        _repo.Verify(r => r.GetByBarcodeAsync("036000291452", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_TrimsTheScannedValueBeforeQuerying()
    {
        var product = NewProduct(barcode: "4006381333931");
        _repo.Setup(r => r.GetByBarcodeAsync("4006381333931", It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);

        var result = await Handler().Handle(
            new GetProductByBarcodeQuery("  4006381333931  "), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        _repo.Verify(r => r.GetByBarcodeAsync("4006381333931", It.IsAny<CancellationToken>()), Times.Once);
    }
}
