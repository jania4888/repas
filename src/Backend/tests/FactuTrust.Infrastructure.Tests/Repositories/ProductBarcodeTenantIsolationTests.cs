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
/// Isolation entre dossiers des chemins de résolution par code-barres.
///
/// <para>
/// L'isolation de ce dépôt est <b>physique</b> : une base par dossier, la chaîne de connexion
/// étant résolue côté serveur depuis le jeton. Aucun filtre de requête n'est donc à maintenir,
/// et c'est cette absence même qui rend la vérification nécessaire : un repository qui
/// mémoriserait un contexte, tiendrait un cache statique, ou contournerait la fabrique
/// romprait l'isolation <b>sans qu'aucun filtre manquant ne le signale</b>.
/// </para>
///
/// <para>
/// Deux bases en mémoire distinctes, une fabrique qui bascule de l'une à l'autre : si les
/// nouvelles méthodes passent bien par la fabrique à chaque appel, un dossier ne peut pas voir
/// les codes-barres d'un autre. Le cas du <b>même code-barres chez deux dossiers</b> est le
/// plus révélateur — c'est une situation parfaitement normale (deux commerces vendant le même
/// article), et un scan ne doit jamais y traverser la frontière.
/// </para>
/// </summary>
public sealed class ProductBarcodeTenantIsolationTests : IDisposable
{
    private const string SharedBarcode = "4006381333931";

    private readonly SwitchableTenantDbContextFactory _factory;
    private readonly ProductRepository _repository;

    private readonly Guid _categoryA = Guid.NewGuid();
    private readonly Guid _categoryB = Guid.NewGuid();

    public ProductBarcodeTenantIsolationTests()
    {
        var suffix = Guid.NewGuid().ToString("N");
        _factory = new SwitchableTenantDbContextFactory(
            $"TestDb_IsoTenantA_{suffix}",
            $"TestDb_IsoTenantB_{suffix}");
        _repository = new ProductRepository(_factory);

        SeedCategory(_factory.TenantA, _categoryA);
        SeedCategory(_factory.TenantB, _categoryB);
    }

    /// <summary>Une base par dossier, comme en production. La bascule imite le middleware.</summary>
    private sealed class SwitchableTenantDbContextFactory : ITenantDbContextFactory
    {
        public string TenantA { get; }
        public string TenantB { get; }

        private string _current;

        public SwitchableTenantDbContextFactory(string tenantA, string tenantB)
        {
            TenantA = tenantA;
            TenantB = tenantB;
            _current = tenantA;
        }

        public void SwitchTo(string database) => _current = database;

        public TenantDbContext CreateContext() => Create(_current);

        public static TenantDbContext Create(string database)
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: database)
                .Options;
            return new TenantDbContext(options);
        }
    }

    private static void SeedCategory(string database, Guid categoryId)
    {
        using var context = SwitchableTenantDbContextFactory.Create(database);
        var category = ProductCategory.Create("GEN", "Général").Value;
        typeof(ProductCategory).GetProperty(nameof(ProductCategory.Id))!.SetValue(category, categoryId);
        context.Set<ProductCategory>().Add(category);
        context.SaveChanges();
    }

    private static Guid SeedProduct(string database, Guid categoryId, string code, string barcode)
    {
        var product = Product.Create(
            code, $"Article {code}", ProductType.Product,
            Money.Create(100m, Money.DefaultCurrency),
            VatRate.Standard, categoryId, unit: "Unité").Value;

        Assert.True(product.SetBarcode(barcode).IsSuccess);

        using var context = SwitchableTenantDbContextFactory.Create(database);
        context.Products.Add(product);
        context.SaveChanges();
        return product.Id;
    }

    public void Dispose()
    {
        using (var a = SwitchableTenantDbContextFactory.Create(_factory.TenantA)) a.Database.EnsureDeleted();
        using (var b = SwitchableTenantDbContextFactory.Create(_factory.TenantB)) b.Database.EnsureDeleted();
    }

    [Fact]
    public async Task AScanNeverCrossesTheTenantBoundary()
    {
        SeedProduct(_factory.TenantA, _categoryA, "ART-A", SharedBarcode);

        _factory.SwitchTo(_factory.TenantB);
        var fromB = await _repository.GetByBarcodeAsync(SharedBarcode);

        Assert.Null(fromB);

        _factory.SwitchTo(_factory.TenantA);
        Assert.NotNull(await _repository.GetByBarcodeAsync(SharedBarcode));
    }

    [Fact]
    public async Task TheSameBarcodeMayLiveInTwoTenantsAndResolveToEachOnesArticle()
    {
        // Deux commerces peuvent parfaitement vendre le même article : le code-barres est
        // unique PAR DOSSIER, jamais globalement. Chacun doit résoudre vers le sien.
        var idA = SeedProduct(_factory.TenantA, _categoryA, "ART-A", SharedBarcode);
        var idB = SeedProduct(_factory.TenantB, _categoryB, "ART-B", SharedBarcode);

        _factory.SwitchTo(_factory.TenantA);
        var fromA = await _repository.GetByBarcodeAsync(SharedBarcode);

        _factory.SwitchTo(_factory.TenantB);
        var fromB = await _repository.GetByBarcodeAsync(SharedBarcode);

        Assert.Equal(idA, fromA!.Id);
        Assert.Equal(idB, fromB!.Id);
        Assert.NotEqual(fromA.Id, fromB.Id);
    }

    [Fact]
    public async Task TheUniquenessGuardOnlyLooksInsideTheCurrentTenant()
    {
        // Le contrôle d'unicité ne doit pas refuser un code-barres parce qu'un AUTRE dossier
        // l'utilise : ce serait une fuite d'information sur le catalogue du voisin, et un
        // refus incompréhensible pour l'utilisateur.
        SeedProduct(_factory.TenantA, _categoryA, "ART-A", SharedBarcode);

        _factory.SwitchTo(_factory.TenantB);

        Assert.False(await _repository.BarcodeExistsAsync(SharedBarcode));
    }

    [Fact]
    public async Task TheSearchNeverReturnsAnotherTenantsArticle()
    {
        SeedProduct(_factory.TenantA, _categoryA, "ART-A", SharedBarcode);

        _factory.SwitchTo(_factory.TenantB);

        var (bySearch, _) = await _repository.SearchAsync(SharedBarcode, null, null, null, 1, 20);
        var forSelect = await _repository.SearchForSelectAsync(SharedBarcode, true, 20);

        Assert.Empty(bySearch);
        Assert.Empty(forSelect);
    }

    [Fact]
    public async Task TheDetectionItselfWorks()
    {
        // Contrôle positif : sans lui, les quatre tests précédents passeraient tout aussi bien
        // avec un repository qui ne renvoie jamais rien.
        SeedProduct(_factory.TenantB, _categoryB, "ART-B", SharedBarcode);

        _factory.SwitchTo(_factory.TenantB);

        Assert.NotNull(await _repository.GetByBarcodeAsync(SharedBarcode));
        Assert.True(await _repository.BarcodeExistsAsync(SharedBarcode));
        Assert.NotEmpty(await _repository.SearchForSelectAsync(SharedBarcode, true, 20));
    }
}
