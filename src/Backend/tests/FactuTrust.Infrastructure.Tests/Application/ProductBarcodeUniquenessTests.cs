using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Products.Commands;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Garde d'unicité applicative du code-barres, sur les trois chemins d'écriture.
///
/// <para>
/// L'index de base reste délibérément NON unique tant que le parc n'a pas été balayé : une
/// migration UNIQUE en échec bloquerait le tenant au démarrage
/// (<c>docs/runbooks/invoice-number-uniqueness.md</c>). C'est donc ce contrôle applicatif qui
/// arrête la production de nouveaux doublons — condition préalable au futur index.
/// </para>
///
/// <para>
/// Il couvre aussi l'ordre des contrôles : format, puis drapeau de déploiement, puis conflit.
/// Un code mal formé doit être refusé pour sa forme, jamais pour un conflit.
/// </para>
/// </summary>
public sealed class ProductBarcodeUniquenessTests
{
    private const string ValidEan13 = "4006381333931";
    private const string UpcA = "036000291452";

    private readonly Mock<IProductRepository> _products = new();
    private readonly Mock<IProductCategoryRepository> _categories = new();
    private readonly Mock<ISupplierRepository> _suppliers = new();
    private readonly Mock<IStockItemRepository> _stockItems = new();
    private readonly Mock<IUnitOfWork> _unitOfWork = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ITenantContext> _tenant = new();

    private readonly Guid _categoryId = Guid.NewGuid();

    public ProductBarcodeUniquenessTests()
    {
        _tenant.Setup(x => x.TenantId).Returns(Guid.NewGuid());
        _currentUser.Setup(x => x.UserId).Returns(Guid.NewGuid());
        _products.Setup(x => x.GetByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);
        _products.Setup(x => x.UpdateAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _products.Setup(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product p, CancellationToken _) => p);
        _categories.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        _unitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        _audit.Setup(x => x.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    private void BarcodeIsTaken(bool taken) =>
        _products.Setup(x => x.BarcodeExistsAsync(
                It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(taken);

    private static IOptions<StockTraceabilityOptions> Traceability() =>
        Options.Create(new StockTraceabilityOptions { ProductVariantsEnabled = true });

    private static IOptions<BarcodeOptions> Barcodes(bool extended = true) =>
        Options.Create(new BarcodeOptions { ExtendedSymbologiesEnabled = extended });

    private static Product NewProduct(string code = "P-001")
    {
        var product = Product.Create(
            code, "Produit test", ProductType.Product,
            Money.Create(100m, Money.DefaultCurrency),
            VatRate.Standard, Guid.NewGuid(), unit: "Unité").Value;

        typeof(Product).GetProperty(nameof(Product.Category))!
            .SetValue(product, ProductCategory.Create("GEN", "Général").Value);

        return product;
    }

    // ─────────────────────── Création ───────────────────────

    private CreateProductCommandHandler CreateHandler(bool extended = true) =>
        new(_products.Object, _categories.Object, _suppliers.Object,
            _unitOfWork.Object, _currentUser.Object, _audit.Object, _tenant.Object,
            Traceability(), Barcodes(extended));

    private CreateProductDto CreateDto(string? barcode) => new()
    {
        Code = "P-001",
        Name = "Produit test",
        Type = ProductType.Product,
        UnitPrice = 100m,
        VatRate = VatRate.Standard,
        Unit = "Unité",
        CategoryId = _categoryId,
        Barcode = barcode
    };

    [Fact]
    public async Task Create_WithABarcodeAlreadyTaken_ReturnsConflictAndPersistsNothing()
    {
        BarcodeIsTaken(true);

        var result = await CreateHandler().Handle(
            new CreateProductCommand(CreateDto(ValidEan13)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Contains("déjà utilisé", result.Error.Description);
        _products.Verify(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_WithAFreeBarcode_Succeeds()
    {
        BarcodeIsTaken(false);

        var result = await CreateHandler().Handle(
            new CreateProductCommand(CreateDto(ValidEan13)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
    }

    [Fact]
    public async Task Create_WithoutABarcode_NeverQueriesUniqueness()
    {
        var result = await CreateHandler().Handle(
            new CreateProductCommand(CreateDto(null)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        _products.Verify(x => x.BarcodeExistsAsync(
            It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_WithAMalformedBarcode_FailsOnFormatBeforeCheckingUniqueness()
    {
        // L'ordre compte : un code mal recopié doit être signalé pour sa clé de contrôle,
        // pas pour un conflit qu'il n'a pas.
        BarcodeIsTaken(true);

        var result = await CreateHandler().Handle(
            new CreateProductCommand(CreateDto("4006381333932")), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Barcode", result.Error.Code);
        Assert.Contains("Clé de contrôle", result.Error.Description);
        _products.Verify(x => x.BarcodeExistsAsync(
            It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_WithAnExtendedSymbologyWhileTheFlagIsOff_IsRefusedBeforeCheckingUniqueness()
    {
        BarcodeIsTaken(false);

        var result = await CreateHandler(extended: false).Handle(
            new CreateProductCommand(CreateDto(UpcA)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Barcode", result.Error.Code);
        Assert.Contains("EAN-8 et EAN-13", result.Error.Description);
        _products.Verify(x => x.BarcodeExistsAsync(
            It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ─────────────────────── Mise à jour ───────────────────────

    private UpdateProductCommandHandler UpdateHandler(Product existing)
    {
        _products.Setup(x => x.GetByIdAsync(existing.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existing);

        return new UpdateProductCommandHandler(
            _products.Object, _categories.Object, _suppliers.Object, _stockItems.Object,
            _unitOfWork.Object, _currentUser.Object, _audit.Object, Traceability(), Barcodes());
    }

    private static UpdateProductDto UpdateDto(string? barcode) => new()
    {
        Name = "Produit test",
        UnitPrice = 100m,
        VatRate = VatRate.Standard,
        Unit = "Unité",
        Barcode = barcode
    };

    [Fact]
    public async Task Update_WithABarcodeHeldByAnotherProduct_ReturnsConflict()
    {
        BarcodeIsTaken(true);
        var product = NewProduct();

        var result = await UpdateHandler(product).Handle(
            new UpdateProductCommand(product.Id, UpdateDto(ValidEan13)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
    }

    [Fact]
    public async Task Update_ExcludesTheProductItselfFromTheUniquenessCheck()
    {
        // Réenregistrer une fiche sans toucher au code-barres ne doit pas être refusé comme
        // un doublon de lui-même : l'identifiant de l'article est transmis à l'exclusion.
        BarcodeIsTaken(false);
        var product = NewProduct();
        Assert.True(product.SetBarcode(ValidEan13).IsSuccess);

        var result = await UpdateHandler(product).Handle(
            new UpdateProductCommand(product.Id, UpdateDto(ValidEan13)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        _products.Verify(x => x.BarcodeExistsAsync(
            ValidEan13, product.Id, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_ClearingTheBarcode_NeverQueriesUniqueness()
    {
        var product = NewProduct();
        Assert.True(product.SetBarcode(ValidEan13).IsSuccess);

        var result = await UpdateHandler(product).Handle(
            new UpdateProductCommand(product.Id, UpdateDto(null)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Null(product.Barcode);
        _products.Verify(x => x.BarcodeExistsAsync(
            It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ─────────────────────── Matrice de variantes ───────────────────────

    [Fact]
    public async Task BulkUpdateVariants_WithABarcodeAlreadyTaken_ReturnsConflict()
    {
        // Le troisième chemin d'écriture, celui qu'on oublie : il doit porter exactement la
        // même garde que les deux autres.
        BarcodeIsTaken(true);

        var parent = NewProduct("TSHIRT");
        Assert.True(parent.MarkAsVariantTemplate().IsSuccess);
        var child = NewProduct("TSHIRT-RED-M");
        Assert.True(child.AttachToParent(parent.Id).IsSuccess);

        _products.Setup(x => x.GetByIdAsync(parent.Id, It.IsAny<CancellationToken>())).ReturnsAsync(parent);
        _products.Setup(x => x.GetByIdAsync(child.Id, It.IsAny<CancellationToken>())).ReturnsAsync(child);

        var handler = new BulkUpdateVariantPricesCommandHandler(
            _products.Object, _currentUser.Object, Barcodes());

        var result = await handler.Handle(
            new BulkUpdateVariantPricesCommand(
                parent.Id, "absolute",
                new[] { new BulkUpdateVariantPriceItem { ChildId = child.Id, Barcode = ValidEan13 } }),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Null(child.Barcode);
    }
}
