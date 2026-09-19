using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Repositories;

/// <summary>
/// Prédicats de résolution et de recherche par code-barres.
///
/// <para>
/// Deux exigences s'y jouent. La première est la sûreté : la correspondance doit être EXACTE.
/// Le scan en caisse interrogeait autrefois le code produit interne avec un <c>Contains</c>
/// bidirectionnel — scanner « 1234 » pouvait encaisser l'article « 12345 ». Réintroduire un
/// <c>Contains</c> sur le code-barres rouvrirait exactement ce défaut.
/// </para>
///
/// <para>
/// La seconde est l'équivalence UPC-A / EAN-13 : le code est stocké tel que scanné, jamais
/// normalisé, donc c'est la lecture qui doit reconnaître les deux formes.
/// </para>
/// </summary>
public sealed class ProductRepositoryBarcodeTests : IDisposable
{
    private readonly TestTenantDbContextFactory _contextFactory;
    private readonly ProductRepository _repository;
    private readonly Guid _categoryId;

    public ProductRepositoryBarcodeTests()
    {
        _contextFactory = new TestTenantDbContextFactory($"TestDb_ProductBarcode_{Guid.NewGuid()}");
        _repository = new ProductRepository(_contextFactory);

        // La catégorie doit exister réellement : plusieurs lectures du repository font un
        // Include(p => p.Category), et le fournisseur en mémoire écarte la ligne lorsque le
        // principal d'une navigation requise est absent. Sans elle, les articles semés
        // deviennent invisibles et l'échec masque ce qu'on veut mesurer.
        var category = ProductCategory.Create("GEN", "Général").Value;
        _categoryId = category.Id;

        using var context = _contextFactory.CreateContext();
        context.Set<ProductCategory>().Add(category);
        context.SaveChanges();
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;

        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;

        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    public void Dispose()
    {
        using var context = _contextFactory.CreateContext();
        context.Database.EnsureDeleted();
    }

    private async Task<Product> SeedAsync(
        string code,
        string? barcode = null,
        string name = "Article",
        bool isVariantTemplate = false,
        bool isActive = true)
    {
        var product = Product.Create(
            code, name, ProductType.Product,
            Money.Create(100m, Money.DefaultCurrency),
            VatRate.Standard, _categoryId, unit: "Unité").Value;

        if (barcode is not null)
            Assert.True(product.SetBarcode(barcode).IsSuccess, $"code-barres de test invalide : {barcode}");

        if (isVariantTemplate)
            Assert.True(product.MarkAsVariantTemplate().IsSuccess);

        if (!isActive)
            product.Deactivate();

        await using var context = _contextFactory.CreateContext();
        context.Products.Add(product);
        await context.SaveChangesAsync();
        return product;
    }

    // ─────────────────────── Résolution exacte ───────────────────────

    [Fact]
    public async Task GetByBarcode_FindsTheExactMatch()
    {
        var expected = await SeedAsync("ART-1", "4006381333931");
        await SeedAsync("ART-2", "5901234123457");

        var found = await _repository.GetByBarcodeAsync("4006381333931");

        Assert.NotNull(found);
        Assert.Equal(expected.Id, found!.Id);
    }

    [Fact]
    public async Task GetByBarcode_NeverMatchesAPrefixOrASuffix()
    {
        await SeedAsync("ART-1", "4006381333931");

        Assert.Null(await _repository.GetByBarcodeAsync("400638133393"));
        Assert.Null(await _repository.GetByBarcodeAsync("40063813339311"));
    }

    [Fact]
    public async Task GetByBarcode_IgnoresVariantTemplates()
    {
        // Un modèle de variantes n'est pas un article vendable : le scanner doit échouer,
        // pas proposer un gabarit.
        await SeedAsync("TSHIRT", "4006381333931", isVariantTemplate: true);

        Assert.Null(await _repository.GetByBarcodeAsync("4006381333931"));
    }

    [Fact]
    public async Task GetByBarcode_TrimsTheInput()
    {
        var expected = await SeedAsync("ART-1", "4006381333931");

        var found = await _repository.GetByBarcodeAsync("  4006381333931  ");

        Assert.Equal(expected.Id, found!.Id);
    }

    // ─────────────────────── Équivalence UPC-A / EAN-13 ───────────────────────

    [Fact]
    public async Task GetByBarcode_ResolvesAnUpcAScanAgainstAnEan13Stored()
    {
        // La douchette renvoie 12 chiffres sur un UPC-A ; l'article peut avoir été saisi en
        // EAN-13 préfixé d'un zéro. Les deux doivent se rejoindre.
        var expected = await SeedAsync("ART-1", "0036000291452");

        var found = await _repository.GetByBarcodeAsync("036000291452");

        Assert.Equal(expected.Id, found!.Id);
    }

    [Fact]
    public async Task GetByBarcode_ResolvesAnEan13ScanAgainstAnUpcAStored()
    {
        var expected = await SeedAsync("ART-1", "036000291452");

        var found = await _repository.GetByBarcodeAsync("0036000291452");

        Assert.Equal(expected.Id, found!.Id);
    }

    [Fact]
    public async Task GetByBarcode_DoesNotInventEquivalencesForOtherLengths()
    {
        // L'équivalence ne vaut que pour le zéro de tête d'un UPC-A. Un EAN-13 qui ne commence
        // pas par zéro ne doit pas se voir amputer de son premier chiffre.
        await SeedAsync("ART-1", "4006381333931");

        Assert.Null(await _repository.GetByBarcodeAsync("006381333931"));
    }

    // ─────────────────────── Garde d'unicité ───────────────────────

    [Fact]
    public async Task BarcodeExists_IsTrueWhenAnotherProductCarriesIt()
    {
        await SeedAsync("ART-1", "4006381333931");

        Assert.True(await _repository.BarcodeExistsAsync("4006381333931"));
    }

    [Fact]
    public async Task BarcodeExists_ExcludesTheProductBeingUpdated()
    {
        // Sans cette exclusion, réenregistrer une fiche sans toucher au code-barres serait
        // refusé comme un doublon de lui-même.
        var product = await SeedAsync("ART-1", "4006381333931");

        Assert.False(await _repository.BarcodeExistsAsync("4006381333931", product.Id));
    }

    [Fact]
    public async Task BarcodeExists_DetectsTheUpcAEquivalent()
    {
        // Enregistrer « 036000291452 » alors qu'un autre article porte « 0036000291452 »
        // produirait deux articles indiscernables au scan.
        await SeedAsync("ART-1", "0036000291452");

        Assert.True(await _repository.BarcodeExistsAsync("036000291452"));
    }

    [Fact]
    public async Task BarcodeExists_IsFalseForAnUnknownCodeOrAnEmptyInput()
    {
        await SeedAsync("ART-1", "4006381333931");

        Assert.False(await _repository.BarcodeExistsAsync("5901234123457"));
        Assert.False(await _repository.BarcodeExistsAsync(""));
        Assert.False(await _repository.BarcodeExistsAsync("   "));
    }

    [Fact]
    public async Task BarcodeExists_IgnoresProductsWithoutABarcode()
    {
        await SeedAsync("ART-1");
        await SeedAsync("ART-2");

        Assert.False(await _repository.BarcodeExistsAsync("4006381333931"));
    }

    // ─────────────────────── Recherche ───────────────────────

    [Fact]
    public async Task Search_FindsAProductByItsExactBarcode()
    {
        var expected = await SeedAsync("ART-1", "4006381333931", name: "Café moulu");

        var (items, _) = await _repository.SearchAsync(
            "4006381333931", null, null, null, 1, 20);

        Assert.Equal(expected.Id, Assert.Single(items).Id);
    }

    [Fact]
    public async Task Search_NeverMatchesABarcodeByPrefix()
    {
        // L'exigence centrale : « 1234 » ne doit jamais ramener « 12345 ». Le nom et le code
        // interne se cherchent en Contains, le code-barres en égalité stricte.
        await SeedAsync("ART-1", "4006381333931", name: "Café moulu");

        var (items, _) = await _repository.SearchAsync(
            "400638133393", null, null, null, 1, 20);

        Assert.Empty(items);
    }

    [Fact]
    public async Task Search_StillFindsByNameAndInternalCode()
    {
        // Non-régression : l'ajout du troisième prédicat ne doit rien retirer aux deux autres.
        await SeedAsync("CAFE-01", "4006381333931", name: "Café moulu");

        var byName = await _repository.SearchAsync("Café", null, null, null, 1, 20);
        var byCode = await _repository.SearchAsync("CAFE", null, null, null, 1, 20);

        Assert.Single(byName.Items);
        Assert.Single(byCode.Items);
    }

    [Fact]
    public async Task SearchForSelect_FindsAProductByItsExactBarcode()
    {
        var expected = await SeedAsync("ART-1", "4006381333931", name: "Café moulu");

        var items = await _repository.SearchForSelectAsync("4006381333931", true, 20);

        Assert.Equal(expected.Id, Assert.Single(items).Id);
    }

    [Fact]
    public async Task SearchForSelect_NeverMatchesABarcodeByPrefix()
    {
        await SeedAsync("ART-1", "4006381333931", name: "Café moulu");

        var items = await _repository.SearchForSelectAsync("400638133393", true, 20);

        Assert.Empty(items);
    }
}
