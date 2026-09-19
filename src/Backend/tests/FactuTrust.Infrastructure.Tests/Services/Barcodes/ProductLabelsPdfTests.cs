using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Models;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Services.Barcodes;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Barcodes;

/// <summary>
/// Impression d'une planche d'étiquettes.
///
/// <para>
/// Les plafonds de volume comptent autant que le rendu : une sélection « tout cocher » sur un
/// gros catalogue doit être refusée avec un message, jamais aboutir à une requête qui expire.
/// </para>
/// </summary>
public sealed class ProductLabelsPdfTests
{
    private readonly Mock<IProductRepository> _products = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly ProductLabelPdfRenderer _renderer = new(new BarcodeEncoder());

    public ProductLabelsPdfTests()
    {
        _audit.Setup(x => x.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    private ExportProductLabelsPdfQueryHandler Handler(bool enabled = true) =>
        new(_products.Object, _renderer, _audit.Object,
            Options.Create(new BarcodeOptions { LabelPrintingEnabled = enabled }));

    private static Product NewProduct(string code = "P-001", string? barcode = "4006381333931")
    {
        var product = Product.Create(
            code, "Article de test", ProductType.Product,
            Money.Create(100m, Money.DefaultCurrency),
            VatRate.Standard, Guid.NewGuid(), unit: "Unité").Value;

        if (barcode is not null)
            Assert.True(product.SetBarcode(barcode).IsSuccess);

        return product;
    }

    private Guid SeedProduct(Product product)
    {
        _products.Setup(x => x.GetByIdAsync(product.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);
        return product.Id;
    }

    private static ProductLabelRequestDto Request(Guid productId, int quantity, string layout = "A4_65") =>
        new()
        {
            Layout = layout,
            Items = new[] { new ProductLabelItemDto { ProductId = productId, Quantity = quantity } }
        };

    // ─────────────────────── Drapeau ───────────────────────

    [Fact]
    public async Task WhenTheFlagIsOffTheEndpointBehavesAsIfItDidNotExist()
    {
        // 404 et non 503 : la fonctionnalité n'est pas déployée, ce n'est pas un incident.
        var id = SeedProduct(NewProduct());

        var result = await Handler(enabled: false).Handle(
            new ExportProductLabelsPdfQuery(Request(id, 1)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
    }

    // ─────────────────────── Plafonds ───────────────────────

    [Fact]
    public async Task MoreLabelsThanTheCapAreRefusedWithAnExplicitMessage()
    {
        var id = SeedProduct(NewProduct());

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, ExportProductLabelsPdfQueryHandler.MaxLabels + 1)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Items", result.Error.Code);
        Assert.Contains("500", result.Error.Description);
    }

    [Fact]
    public async Task ExactlyTheCapIsAccepted()
    {
        var id = SeedProduct(NewProduct());

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, ExportProductLabelsPdfQueryHandler.MaxLabels)),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
    }

    [Fact]
    public async Task TooManyDistinctProductsAreRefused()
    {
        var items = Enumerable.Range(0, ExportProductLabelsPdfQueryHandler.MaxDistinctProducts + 1)
            .Select(_ => new ProductLabelItemDto { ProductId = Guid.NewGuid(), Quantity = 1 })
            .ToList();

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(new ProductLabelRequestDto { Layout = "A4_65", Items = items }),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("articles distincts", result.Error.Description);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    [InlineData(501)]
    public async Task AnOutOfRangeQuantityIsRefused(int quantity)
    {
        var id = SeedProduct(NewProduct());

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, quantity)), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task AnEmptySelectionIsRefused()
    {
        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(new ProductLabelRequestDto { Layout = "A4_65" }),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("au moins un article", result.Error.Description);
    }

    [Fact]
    public async Task DuplicateLinesForTheSameProductAreMerged()
    {
        // Deux fois le même article dans la sélection doit compter pour le total, sans faire
        // deux lectures ni deux blocs d'étiquettes dispersés dans la planche.
        var id = SeedProduct(NewProduct());

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(new ProductLabelRequestDto
            {
                Layout = "A4_65",
                Items = new[]
                {
                    new ProductLabelItemDto { ProductId = id, Quantity = 3 },
                    new ProductLabelItemDto { ProductId = id, Quantity = 2 }
                }
            }),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        _products.Verify(x => x.GetByIdAsync(id, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ─────────────────────── Gabarits ───────────────────────

    [Fact]
    public async Task AnUnknownLayoutIsRefused()
    {
        var id = SeedProduct(NewProduct());

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, 1, "A4_999")), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Layout", result.Error.Code);
    }

    [Theory]
    [InlineData("A4_65")]
    [InlineData("A4_40")]
    [InlineData("A4_24")]
    [InlineData("A4_21")]
    [InlineData("Roll_58x40")]
    [InlineData("Roll_40x30")]
    public async Task EveryLayoutProducesANonEmptyPdf(string layout)
    {
        var id = SeedProduct(NewProduct());

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, 3, layout)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.NotEmpty(result.Value.Content);
        Assert.Equal("application/pdf", result.Value.ContentType);
        Assert.EndsWith(".pdf", result.Value.FileName);
        // En-tête PDF : preuve que le flux est bien un document, pas un tableau vide.
        Assert.Equal("%PDF"u8.ToArray(), result.Value.Content.Take(4).ToArray());
    }

    [Fact]
    public void LayoutKeysAreUniqueAndPositivelyDimensioned()
    {
        // Une géométrie nulle ou négative ne se voit pas à la relecture, mais ferait dériver
        // toute la planche à l'impression.
        Assert.Equal(
            LabelSheetLayout.All.Count,
            LabelSheetLayout.All.Select(l => l.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count());

        Assert.All(LabelSheetLayout.All, l =>
        {
            Assert.True(l.LabelWidthMm > 0);
            Assert.True(l.LabelHeightMm > 0);
            Assert.True(l.Columns >= 1);
            Assert.True(l.Rows >= 1);
            Assert.False(string.IsNullOrWhiteSpace(l.Label));
        });
    }

    // ─────────────────────── Contenu ───────────────────────

    [Fact]
    public async Task AProductWithoutABarcodeStillGetsALabel()
    {
        // Exigence explicite : un catalogue en cours de codification contient forcément des
        // articles sans code-barres. Les refuser obligerait à trier la sélection à la main.
        var id = SeedProduct(NewProduct(barcode: null));

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, 2)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.NotEmpty(result.Value.Content);
    }

    [Fact]
    public async Task AnUnknownProductIsReportedAsNotFound()
    {
        _products.Setup(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);

        var result = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(Guid.NewGuid(), 1)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("NotFound", result.Error.Code);
    }

    [Fact]
    public async Task ThePrintIsAudited()
    {
        var id = SeedProduct(NewProduct());

        await Handler().Handle(new ExportProductLabelsPdfQuery(Request(id, 4)), CancellationToken.None);

        _audit.Verify(x => x.LogAsync(
            AuditActions.Product.LabelsExported, "Product", null,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AskingForThePriceChangesTheDocument()
    {
        // Le prix est optionnel et éteint par défaut ; on vérifie qu'il est bien pris en
        // compte, sans quoi la case à cocher n'aurait aucun effet visible.
        var id = SeedProduct(NewProduct());

        var without = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, 1)), CancellationToken.None);
        var with = await Handler().Handle(
            new ExportProductLabelsPdfQuery(new ProductLabelRequestDto
            {
                Layout = "A4_65",
                IncludePrice = true,
                Items = new[] { new ProductLabelItemDto { ProductId = id, Quantity = 1 } }
            }),
            CancellationToken.None);

        Assert.True(without.IsSuccess && with.IsSuccess);
        Assert.NotEqual(without.Value.Content.Length, with.Value.Content.Length);
    }

    [Fact]
    public async Task MoreLabelsThanOnePageProduceALargerDocument()
    {
        // La planche A4_65 porte 65 étiquettes : 200 en exigent quatre pages.
        var id = SeedProduct(NewProduct());

        var onePage = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, 10)), CancellationToken.None);
        var fourPages = await Handler().Handle(
            new ExportProductLabelsPdfQuery(Request(id, 200)), CancellationToken.None);

        Assert.True(onePage.IsSuccess && fourPages.IsSuccess, fourPages.Error?.Description);
        Assert.True(fourPages.Value.Content.Length > onePage.Value.Content.Length);
    }

    // ─────────────────────── Gabarits exposés ───────────────────────

    [Fact]
    public async Task TheLayoutCatalogueIsExposedToTheFront()
    {
        var layouts = await new GetLabelLayoutsQueryHandler()
            .Handle(new GetLabelLayoutsQuery(), CancellationToken.None);

        Assert.Equal(LabelSheetLayout.All.Count, layouts.Count);
        Assert.Contains(layouts, l => l.Key == "A4_65" && l.LabelsPerPage == 65);
        Assert.Contains(layouts, l => l.IsRoll);
    }
}
