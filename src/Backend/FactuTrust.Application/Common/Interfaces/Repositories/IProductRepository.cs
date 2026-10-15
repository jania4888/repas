using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for Product aggregate.
/// </summary>
public interface IProductRepository : IRepository<Product>
{
    /// <summary>
    /// Gets a product by its code.
    /// </summary>
    Task<Product?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>
    /// Recherche par code-barres, en correspondance EXACTE. Aucune approximation : un scan
    /// qui ne correspond à rien doit échouer, jamais deviner.
    ///
    /// <para>
    /// Seule tolérance : l'équivalence entre un UPC-A (12 chiffres) et le même code stocké en
    /// EAN-13 préfixé d'un zéro, et réciproquement. Les modèles de variantes sont exclus.
    /// </para>
    /// </summary>
    Task<Product?> GetByBarcodeAsync(string barcode, CancellationToken cancellationToken = default);

    /// <summary>
    /// Indique si un code-barres est déjà porté par un article, hors celui dont l'identifiant
    /// est fourni (pour qu'une mise à jour ne se voie pas refuser son propre code).
    ///
    /// <para>
    /// C'est la garde d'unicité applicative. L'index de base reste NON unique tant que le parc
    /// n'a pas été balayé — voir <c>docs/runbooks/barcode-cutover.md</c>. Ce contrôle arrête la
    /// production de nouveaux doublons, ce qui est la condition préalable au futur index.
    /// </para>
    ///
    /// <para>
    /// Il tolère la même équivalence UPC-A / EAN-13 que <see cref="GetByBarcodeAsync"/> :
    /// enregistrer « 036000291452 » sur un article alors qu'un autre porte « 0036000291452 »
    /// produirait deux articles indiscernables au scan.
    /// </para>
    /// </summary>
    Task<bool> BarcodeExistsAsync(
        string barcode,
        Guid? excludeProductId = null,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all active products.
    /// </summary>
    Task<IReadOnlyList<Product>> GetActiveProductsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets all active products with category included (for reports).
    /// </summary>
    Task<IReadOnlyList<Product>> GetActiveProductsWithCategoryAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets products by type.
    /// </summary>
    Task<IReadOnlyList<Product>> GetByTypeAsync(ProductType type, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Searches products by name or code.
    /// </summary>
    Task<(IReadOnlyList<Product> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        ProductType? type,
        bool? isActive,
        Guid? categoryId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default,
        bool excludeVariantTemplates = false,
        Guid? parentProductId = null,
        bool? isVariantTemplate = null,
        bool? hasParentProduct = null);

    /// <summary>
    /// Child SKU products for a variant template parent.
    /// </summary>
    Task<(IReadOnlyList<Product> Items, int TotalCount)> GetChildrenByParentIdAsync(
        Guid parentProductId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Lightweight search for variant template products (grouped picker step 1).
    /// </summary>
    Task<IReadOnlyList<Product>> SearchTemplatesForSelectAsync(
        string? searchTerm,
        bool? isActive,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Lightweight search for autocomplete/select dropdowns.
    /// No category include, no tracking. Returns at most <paramref name="pageSize"/> items
    /// ordered by name; does not compute a full total count.
    /// </summary>
    Task<IReadOnlyList<Product>> SearchForSelectAsync(
        string? searchTerm,
        bool? isActive,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns FODEC flags for the given product ids (missing ids are omitted).
    /// </summary>
    Task<IReadOnlyDictionary<Guid, bool>> GetFodecFlagsByIdsAsync(
        IReadOnlyCollection<Guid> productIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns traceability flags for the given product ids (missing ids are omitted).
    /// </summary>
    Task<IReadOnlyDictionary<Guid, ProductTrackingInfo>> GetTrackingInfoByIdsAsync(
        IReadOnlyCollection<Guid> productIds,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Checks if a product is used in any invoice.
    /// </summary>
    Task<bool> IsUsedInInvoicesAsync(Guid productId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all active products with stock management enabled.
    /// </summary>
    Task<IReadOnlyList<Product>> GetStockManagedProductsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Updates the image URL for a product.
    /// </summary>
    Task UpdateImageUrlAsync(Guid productId, string imageUrl, CancellationToken cancellationToken = default);

    /// <summary>
    /// Clears the image URL for a product.
    /// </summary>
    Task ClearImageUrlAsync(Guid productId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns product display names for the given ids (missing ids are omitted).
    /// </summary>
    Task<IReadOnlyDictionary<Guid, string>> GetProductNamesByIdsAsync(
        IReadOnlyCollection<Guid> productIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Charge plusieurs produits en une requête (ids manquants simplement absents du résultat).
    /// À préférer à une boucle de <c>GetByIdAsync</c>, qui fait un aller-retour par produit.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, Product>> GetByIdsAsync(
        IReadOnlyCollection<Guid> productIds,
        CancellationToken cancellationToken = default);
}

/// <summary>Lightweight traceability snapshot for inventory and stock flows.</summary>
public sealed record ProductTrackingInfo(TrackingMode TrackingMode, bool HasExpiryTracking);
