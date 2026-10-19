using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PurchaseReceipts.DocumentImport;

public sealed class ProductLineMatcherTests
{
    private static readonly Guid SomeCategoryId = Guid.NewGuid();

    private static Product NewProduct(
        string code, string name, decimal vatPercent = 19m, bool active = true, bool template = false)
    {
        var vatRate = vatPercent switch
        {
            0m => VatRate.Exempt,
            7m => VatRate.Reduced,
            13m => VatRate.Intermediate,
            _ => VatRate.Standard
        };
        var product = Product.Create(
            code, name, ProductType.Product, Money.Create(100m), vatRate, SomeCategoryId,
            isStockManaged: true).Value;
        if (!active)
            product.Deactivate();
        if (template)
            product.MarkAsVariantTemplate();
        return product;
    }

    private static ProductListDto ToListDto(Product p) => new()
    {
        Id = p.Id,
        Code = p.Code,
        Name = p.Name,
        Type = p.Type.ToString(),
        UnitPrice = p.UnitPrice.Amount,
        PurchasePrice = p.PurchasePrice?.Amount,
        SalePriceTtc = p.UnitPrice.Amount,
        Currency = "TND",
        VatRatePercent = (int)p.VatRate.ToDecimal(),
        VatRateDisplay = p.VatRate.ToString(),
        Unit = p.Unit
    };

    private static ExtractedLineDto NewLine(
        string designation, string? reference = null, int vatRatePercent = 19, decimal unitPriceHt = 100m)
        => new()
        {
            Designation = designation,
            Reference = reference,
            Quantity = 1m,
            UnitPriceHt = unitPriceHt,
            VatRatePercent = vatRatePercent
        };

    private static (ProductLineMatcher Matcher, Mock<IProductRepository> Products, Mock<IMediator> Mediator) BuildSut(
        Product? byCode = null,
        Product? byBarcode = null,
        IReadOnlyList<ProductListDto>? searchResults = null,
        Func<Guid, Product?>? byId = null)
    {
        var products = new Mock<IProductRepository>();
        products.Setup(x => x.GetByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(byCode);
        products.Setup(x => x.GetByBarcodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(byBarcode);
        products.Setup(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid id, CancellationToken _) => byId is not null ? byId(id) : null);

        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PagedResult<ProductListDto>
            {
                Items = searchResults ?? Array.Empty<ProductListDto>(),
                TotalCount = searchResults?.Count ?? 0,
                Page = 1,
                PageSize = 10
            }));

        var matcher = new ProductLineMatcher(products.Object, mediator.Object);
        return (matcher, products, mediator);
    }

    [Fact]
    public async Task Exact_code_match_is_case_insensitive()
    {
        // GetByCodeAsync is mocked to behave case-insensitively; this confirms the matcher
        // trusts the repository's lookup and reports "code" regardless of the reference case.
        var product = NewProduct("ABC-123", "Produit Alpha");
        var (matcher, _, _) = BuildSut(byCode: product);

        var result = await matcher.MatchAsync(NewLine("Produit Alpha", reference: "abc-123"), null, CancellationToken.None);

        Assert.Equal("code", result.MatchMethod);
        Assert.Equal(product.Id, result.ProductId);
    }

    [Fact]
    public async Task Ean13_reference_matches_by_barcode_when_code_lookup_fails()
    {
        var product = NewProduct("ABC-999", "Produit Beta");
        var (matcher, _, _) = BuildSut(byCode: null, byBarcode: product);

        var result = await matcher.MatchAsync(NewLine("Produit Beta", reference: "6291041500213"), null, CancellationToken.None);

        Assert.Equal("barcode", result.MatchMethod);
        Assert.Equal(product.Id, result.ProductId);
    }

    [Fact]
    public async Task Unique_similar_designation_matches_by_name()
    {
        var product = NewProduct("GAM-01", "Gants de Protection Taille L");
        var (matcher, _, _) = BuildSut(searchResults: new[] { ToListDto(product) }, byId: id => id == product.Id ? product : null);

        var result = await matcher.MatchAsync(NewLine("Gants de Protection Taille L"), null, CancellationToken.None);

        Assert.Equal("name", result.MatchMethod);
        Assert.Equal(product.Id, result.ProductId);
    }

    [Fact]
    public async Task Multiple_similar_designations_are_ambiguous_with_at_most_five_candidates()
    {
        var items = Enumerable.Range(1, 7)
            .Select(i => ToListDto(NewProduct($"CAB-{i:00}", "Cable Electrique 2.5mm")))
            .ToList();
        var (matcher, _, _) = BuildSut(searchResults: items);

        var result = await matcher.MatchAsync(NewLine("Cable Electrique 2.5mm"), null, CancellationToken.None);

        Assert.Equal("ambiguous", result.MatchMethod);
        Assert.Null(result.ProductId);
        Assert.True(result.Candidates.Count <= 5);
    }

    [Fact]
    public async Task No_match_returns_none_with_a_prefill()
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(NewLine("Article Totalement Inconnu"), null, CancellationToken.None);

        Assert.Equal("none", result.MatchMethod);
        Assert.Null(result.ProductId);
        Assert.NotNull(result.Prefill);
        Assert.False(result.InactiveOrTemplate);
    }

    [Fact]
    public async Task Found_by_code_but_inactive_resolves_to_none_with_inactive_flag()
    {
        var product = NewProduct("ABC-123", "Produit Inactif", active: false);
        var (matcher, _, _) = BuildSut(byCode: product);

        var result = await matcher.MatchAsync(NewLine("Produit Inactif", reference: "ABC-123"), null, CancellationToken.None);

        Assert.Equal("none", result.MatchMethod);
        Assert.True(result.InactiveOrTemplate);
        // Code review item 12 : un pré-remplissage doit tout de même être proposé, pour permettre
        // une création rapide de remplacement plutôt que de forcer une saisie manuelle complète.
        Assert.NotNull(result.Prefill);
    }

    [Fact]
    public async Task Found_by_code_but_variant_template_resolves_to_none_with_inactive_flag()
    {
        var product = NewProduct("ABC-123", "Produit Modele", template: true);
        var (matcher, _, _) = BuildSut(byCode: product);

        var result = await matcher.MatchAsync(NewLine("Produit Modele", reference: "ABC-123"), null, CancellationToken.None);

        Assert.Equal("none", result.MatchMethod);
        Assert.True(result.InactiveOrTemplate);
        Assert.NotNull(result.Prefill);
    }

    [Fact]
    public async Task Code_lookup_uses_the_same_normalization_as_the_quick_create_prefill()
    {
        // Code review item 5 : un produit créé rapidement lors d'un import précédent est stocké
        // avec un code "nettoyé" (espaces supprimés, majuscules) — voir BuildPrefillAsync. Le
        // document réimporté porte souvent la référence brute, avec un espace et une casse
        // différente ("abc 123"). L'étape 1 (recherche par code) doit utiliser la même
        // normalisation que le pré-remplissage pour retrouver ce produit.
        var product = NewProduct("ABC123", "Produit Quick-Create");
        var products = new Mock<IProductRepository>();
        products.Setup(x => x.GetByCodeAsync("ABC123", It.IsAny<CancellationToken>())).ReturnsAsync(product);
        products.Setup(x => x.GetByCodeAsync(It.Is<string>(c => c != "ABC123"), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);
        products.Setup(x => x.GetByBarcodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((Product?)null);
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PagedResult<ProductListDto> { Items = Array.Empty<ProductListDto>() }));
        var matcher = new ProductLineMatcher(products.Object, mediator.Object);

        var result = await matcher.MatchAsync(NewLine("Produit Quick-Create", reference: "abc 123"), null, CancellationToken.None);

        Assert.Equal("code", result.MatchMethod);
        Assert.Equal(product.Id, result.ProductId);
    }

    [Theory]
    [InlineData(7, "Reduced")]
    [InlineData(13, "Intermediate")]
    [InlineData(0, "Exempt")]
    [InlineData(19, "Standard")]
    public async Task Prefill_vat_rate_maps_to_the_matching_enum_value(int percent, string expectedEnumName)
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(NewLine("Produit Sans Correspondance", vatRatePercent: percent), null, CancellationToken.None);

        Assert.Equal(expectedEnumName, result.Prefill!.VatRate.ToString());
    }

    [Fact]
    public async Task Prefill_reports_a_code_conflict_when_the_reference_already_exists_on_another_product()
    {
        var existing = NewProduct("DUP-1", "Produit Existant");
        var (matcher, _, _) = BuildSut(byCode: null); // code lookup for the extracted reference succeeds below
        var products = new Mock<IProductRepository>();
        products.Setup(x => x.GetByCodeAsync("DUP-1", It.IsAny<CancellationToken>())).ReturnsAsync((Product?)null);
        // Simulate: first GetByCodeAsync (match attempt) returns null, second (prefill conflict check) returns existing.
        var callCount = 0;
        products.Setup(x => x.GetByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => ++callCount == 1 ? null : existing);
        products.Setup(x => x.GetByBarcodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((Product?)null);
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PagedResult<ProductListDto> { Items = Array.Empty<ProductListDto>() }));
        var matcherWithConflict = new ProductLineMatcher(products.Object, mediator.Object);

        var result = await matcherWithConflict.MatchAsync(NewLine("Produit Nouveau", reference: "DUP-1"), null, CancellationToken.None);

        Assert.Equal("none", result.MatchMethod);
        Assert.True(result.Prefill!.CodeConflict);
        Assert.Null(result.Prefill.Code);
    }

    [Fact]
    public async Task Long_reference_is_truncated_to_fifty_characters_in_the_prefill_code()
    {
        var longReference = new string('X', 60);
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(NewLine("Produit Reference Longue", reference: longReference), null, CancellationToken.None);

        Assert.Equal(50, result.Prefill!.Code!.Length);
    }

    [Fact]
    public async Task Preferred_supplier_id_passes_through_to_the_prefill()
    {
        var supplierId = Guid.NewGuid();
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(NewLine("Produit Quelconque"), supplierId, CancellationToken.None);

        Assert.Equal(supplierId, result.Prefill!.PreferredSupplierId);
    }
}
