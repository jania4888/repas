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

namespace FactuTrust.Infrastructure.Tests.Domain;

/// <summary>
/// Filet de sécurité AVANT l'extension des symbologies.
///
/// <para>
/// Le code-barres d'un article s'écrit par TROIS chemins distincts — création, mise à jour, et
/// la matrice de variantes (<see cref="BulkUpdateVariantPricesCommand"/>). Ce dernier est le
/// plus facile à oublier : il n'apparaît dans aucun écran de la liste des documents, et c'est
/// pourtant aujourd'hui la seule voie de saisie réellement câblée côté Angular.
/// </para>
///
/// <para>
/// Ces tests épinglent le comportement ACTUEL, y compris celui qui est défectueux
/// (voir <c>Update_WithoutBarcodeInDto_ErasesTheExistingBarcode</c>). Ils doivent rester verts
/// pendant toute la refonte ; la seule assertion destinée à changer est celle-là, et elle
/// changera par l'ajout du champ au formulaire, pas par une modification du domaine.
/// </para>
/// </summary>
public sealed class ProductBarcodeWriteRegressionTests
{
    private const string ValidEan13 = "4006381333931";
    private const string OtherValidEan13 = "5901234123457";
    private const string BrokenCheckDigit = "4006381333932";

    private readonly Mock<IProductRepository> _products = new();
    private readonly Mock<IProductCategoryRepository> _categories = new();
    private readonly Mock<ISupplierRepository> _suppliers = new();
    private readonly Mock<IStockItemRepository> _stockItems = new();
    private readonly Mock<IUnitOfWork> _unitOfWork = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ITenantContext> _tenant = new();

    private readonly Guid _categoryId = Guid.NewGuid();

    public ProductBarcodeWriteRegressionTests()
    {
        _tenant.Setup(x => x.TenantId).Returns(Guid.NewGuid());
        _currentUser.Setup(x => x.UserId).Returns(Guid.NewGuid());
        _products.Setup(x => x.GetByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);
        _categories.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        _unitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        _audit.Setup(x => x.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    /// <summary>
    /// Drapeau des symbologies étendues ÉTEINT : c'est la configuration de production par
    /// défaut. Les codes de ce fichier sont des EAN-13 et des EAN-8, que le catalogue accepte
    /// dans les deux états du drapeau — ces tests mesurent donc les chemins d'écriture, pas le
    /// drapeau (celui-là est couvert par BarcodePolicyTests).
    /// </summary>
    private static IOptions<BarcodeOptions> Barcodes() => Options.Create(new BarcodeOptions());

    private static IOptions<StockTraceabilityOptions> Traceability() =>
        Options.Create(new StockTraceabilityOptions
        {
            LotTrackingEnabled = true,
            SerialTrackingEnabled = true,
            ExpiryTrackingEnabled = true,
            ProductVariantsEnabled = true,
            FifoLifoValuationEnabled = true
        });

    private static Product NewProduct(string code = "P-001")
    {
        var product = Product.Create(
            code,
            "Produit test",
            ProductType.Product,
            Money.Create(100m, Money.DefaultCurrency),
            VatRate.Standard,
            Guid.NewGuid(),
            unit: "Unité").Value;

        AttachCategoryNavigation(product);
        return product;
    }

    /// <summary>
    /// Renseigne la navigation <c>Category</c>, que seul EF peut normalement poser.
    ///
    /// <para>
    /// <see cref="UpdateProductCommandHandler"/> projette le résultat via le mapper de détail,
    /// lequel lit <c>product.Category</c>. En production la navigation est toujours chargée
    /// (<c>ProductRepository.GetByIdAsync</c> fait un <c>Include(p =&gt; p.Category)</c>) ; en
    /// test il faut la poser soi-même, sans quoi l'échec masque ce qu'on veut mesurer.
    /// </para>
    /// </summary>
    private static void AttachCategoryNavigation(Product product)
    {
        var category = ProductCategory.Create("GEN", "Général").Value;
        typeof(Product)
            .GetProperty(nameof(Product.Category))!
            .SetValue(product, category);
    }

    // ─────────────────────── Chemin 1 : création ───────────────────────

    private CreateProductCommandHandler BuildCreateHandler(out List<Product> added)
    {
        var captured = new List<Product>();
        added = captured;
        _products.Setup(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .Callback<Product, CancellationToken>((p, _) => captured.Add(p))
            .ReturnsAsync((Product p, CancellationToken _) => p);

        return new CreateProductCommandHandler(
            _products.Object, _categories.Object, _suppliers.Object,
            _unitOfWork.Object, _currentUser.Object, _audit.Object, _tenant.Object,
            Traceability(), Barcodes());
    }

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
    public async Task Create_WithValidEan_PersistsTheBarcode()
    {
        var handler = BuildCreateHandler(out var added);

        var result = await handler.Handle(new CreateProductCommand(CreateDto(ValidEan13)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        var product = Assert.Single(added);
        Assert.Equal(ValidEan13, product.Barcode!.Value);
    }

    [Fact]
    public async Task Create_WithBrokenCheckDigit_FailsAndPersistsNothing()
    {
        var handler = BuildCreateHandler(out var added);

        var result = await handler.Handle(new CreateProductCommand(CreateDto(BrokenCheckDigit)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Barcode", result.Error.Code);
        Assert.Empty(added);
        _products.Verify(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_WithoutBarcode_LeavesItNull()
    {
        var handler = BuildCreateHandler(out var added);

        var result = await handler.Handle(new CreateProductCommand(CreateDto(null)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Null(Assert.Single(added).Barcode);
    }

    // ─────────────────────── Chemin 2 : mise à jour ───────────────────────

    private UpdateProductCommandHandler BuildUpdateHandler(Product existing)
    {
        _products.Setup(x => x.GetByIdAsync(existing.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existing);
        _products.Setup(x => x.UpdateAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

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
    public async Task Update_WithValidEan_ReplacesTheBarcode()
    {
        var product = NewProduct();
        Assert.True(product.SetBarcode(ValidEan13).IsSuccess);
        var handler = BuildUpdateHandler(product);

        var result = await handler.Handle(
            new UpdateProductCommand(product.Id, UpdateDto(OtherValidEan13)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(OtherValidEan13, product.Barcode!.Value);
    }

    [Fact]
    public async Task Update_WithBrokenCheckDigit_FailsAndKeepsThePreviousBarcode()
    {
        var product = NewProduct();
        Assert.True(product.SetBarcode(ValidEan13).IsSuccess);
        var handler = BuildUpdateHandler(product);

        var result = await handler.Handle(
            new UpdateProductCommand(product.Id, UpdateDto(BrokenCheckDigit)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Barcode", result.Error.Code);
        Assert.Equal(ValidEan13, product.Barcode!.Value);
        _unitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Update_WithoutBarcodeInDto_ErasesTheExistingBarcode()
    {
        // ⚠️ COMPORTEMENT ACTUEL, ET C'EST UN DÉFAUT.
        //
        // Le handler appelle SetBarcode(dto.Barcode) sans condition, et le formulaire produit
        // Angular construit sa charge utile champ par champ SANS y inclure le code-barres.
        // Conséquence : la moindre modification d'un article depuis l'écran produit efface
        // silencieusement son code-barres. C'est la raison pour laquelle le catalogue reste
        // vide de codes-barres malgré une API qui les accepte depuis des mois.
        //
        // Ce test existe pour que la correction (ajout du champ à la charge utile) soit un
        // changement VISIBLE et intentionnel, et non un effet de bord.
        var product = NewProduct();
        Assert.True(product.SetBarcode(ValidEan13).IsSuccess);
        var handler = BuildUpdateHandler(product);

        var result = await handler.Handle(
            new UpdateProductCommand(product.Id, UpdateDto(null)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Null(product.Barcode);
    }

    // ─────────────── Chemin 3 : matrice de variantes (le plus facile à oublier) ───────────────

    private BulkUpdateVariantPricesCommandHandler BuildBulkHandler(Product parent, params Product[] children)
    {
        _products.Setup(x => x.GetByIdAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(parent);
        foreach (var child in children)
        {
            var captured = child;
            _products.Setup(x => x.GetByIdAsync(captured.Id, It.IsAny<CancellationToken>()))
                .ReturnsAsync(captured);
        }
        _products.Setup(x => x.UpdateAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        return new BulkUpdateVariantPricesCommandHandler(
            _products.Object, _currentUser.Object, Barcodes());
    }

    private static (Product Parent, Product Child) NewTemplateWithChild()
    {
        var parent = NewProduct("TSHIRT");
        Assert.True(parent.MarkAsVariantTemplate().IsSuccess);

        var child = NewProduct("TSHIRT-RED-M");
        Assert.True(child.AttachToParent(parent.Id).IsSuccess);

        return (parent, child);
    }

    [Fact]
    public async Task BulkUpdateVariants_WithValidEan_PersistsTheBarcodeOnTheChild()
    {
        var (parent, child) = NewTemplateWithChild();
        var handler = BuildBulkHandler(parent, child);

        var result = await handler.Handle(
            new BulkUpdateVariantPricesCommand(
                parent.Id,
                "absolute",
                new[] { new BulkUpdateVariantPriceItem { ChildId = child.Id, Barcode = ValidEan13 } }),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(1, result.Value);
        Assert.Equal(ValidEan13, child.Barcode!.Value);
    }

    [Fact]
    public async Task BulkUpdateVariants_WithBrokenCheckDigit_FailsAndKeepsThePreviousBarcode()
    {
        var (parent, child) = NewTemplateWithChild();
        Assert.True(child.SetBarcode(ValidEan13).IsSuccess);
        var handler = BuildBulkHandler(parent, child);

        var result = await handler.Handle(
            new BulkUpdateVariantPricesCommand(
                parent.Id,
                "absolute",
                new[] { new BulkUpdateVariantPriceItem { ChildId = child.Id, Barcode = BrokenCheckDigit } }),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Barcode", result.Error.Code);
        Assert.Equal(ValidEan13, child.Barcode!.Value);
    }

    [Fact]
    public async Task BulkUpdateVariants_WithNullBarcode_LeavesTheExistingOneUntouched()
    {
        // Différence ASSUMÉE avec la mise à jour d'article : ici le null signifie « ne touche
        // pas », grâce au `if (item.Barcode is not null)`. La matrice n'efface donc rien.
        var (parent, child) = NewTemplateWithChild();
        Assert.True(child.SetBarcode(ValidEan13).IsSuccess);
        var handler = BuildBulkHandler(parent, child);

        var result = await handler.Handle(
            new BulkUpdateVariantPricesCommand(
                parent.Id,
                "absolute",
                new[] { new BulkUpdateVariantPriceItem { ChildId = child.Id, UnitPrice = 42m } }),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(ValidEan13, child.Barcode!.Value);
    }

    [Fact]
    public async Task BulkUpdateVariants_WithEmptyBarcode_ClearsIt()
    {
        var (parent, child) = NewTemplateWithChild();
        Assert.True(child.SetBarcode(ValidEan13).IsSuccess);
        var handler = BuildBulkHandler(parent, child);

        var result = await handler.Handle(
            new BulkUpdateVariantPricesCommand(
                parent.Id,
                "absolute",
                new[] { new BulkUpdateVariantPriceItem { ChildId = child.Id, Barcode = string.Empty } }),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Null(child.Barcode);
    }

    // ─────────────────────── Invariant commun aux trois chemins ───────────────────────

    [Fact]
    public void SetBarcode_OnFailure_NeverLeavesTheProductPartiallyModified()
    {
        // L'invariant sur lequel reposent les trois handlers : ils propagent l'échec sans
        // rien annuler eux-mêmes, parce que le domaine garantit de n'avoir rien touché.
        var product = NewProduct();
        Assert.True(product.SetBarcode(ValidEan13).IsSuccess);

        // L'échantillon ne retient que des valeurs refusées quel que soit l'état du chantier :
        // clés de contrôle faussées, caractères hostiles au routage, longueurs hors bornes.
        // Y faire figurer « 123456789012 » ou « ABC » serait une erreur — le premier est un
        // UPC-A parfaitement valide, le second un Code 128 : tous deux sont acceptés depuis
        // l'extension des symbologies, et ce test mesure l'atomicité de l'échec, pas la liste
        // de ce qui est refusé (celle-là vit dans BarcodeTests).
        var alwaysInvalid = new[]
        {
            BrokenCheckDigit,   // EAN-13, clé faussée
            "40063813339311",   // GTIN-14, clé faussée
            "036000291453",     // UPC-A, clé faussée
            "A/B",              // hostile au segment de chemin
            "12",               // trop court
            new string('A', 49) // trop long
        };

        foreach (var invalid in alwaysInvalid)
        {
            var result = product.SetBarcode(invalid);

            Assert.True(result.IsFailure, $"« {invalid} » ne doit pas être accepté");
            Assert.Equal(ValidEan13, product.Barcode!.Value);
        }
    }
}
