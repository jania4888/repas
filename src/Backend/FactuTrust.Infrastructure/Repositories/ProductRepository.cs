using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for Product aggregate.
/// </summary>
public sealed class ProductRepository : IProductRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    // Dépendance sur l'interface et non sur la fabrique concrète : c'est ce qui permet de
    // vérifier les prédicats de recherche sur une base en mémoire, comme le fait déjà
    // StockMovementRepository. La résolution DI est inchangée, les deux étant enregistrées.
    public ProductRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Product?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .Include(p => p.Category)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
    }

    public async Task<Product?> GetByCodeAsync(string code, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .FirstOrDefaultAsync(p => p.Code == code.ToUpperInvariant(), cancellationToken);
    }

    public async Task<Product?> GetByBarcodeAsync(string barcode, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(barcode))
            return null;

        var normalized = barcode.Trim();
        var alternate = UpcEanEquivalent(normalized);

        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .Include(p => p.Category)
            .FirstOrDefaultAsync(
                p => (p.Barcode!.Value == normalized || p.Barcode!.Value == alternate)
                     && !p.IsVariantTemplate,
                cancellationToken);
    }

    public async Task<bool> BarcodeExistsAsync(
        string barcode,
        Guid? excludeProductId = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(barcode))
            return false;

        var normalized = barcode.Trim();
        var alternate = UpcEanEquivalent(normalized);

        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .AsNoTracking()
            .AnyAsync(
                p => (p.Barcode!.Value == normalized || p.Barcode!.Value == alternate)
                     && (excludeProductId == null || p.Id != excludeProductId),
                cancellationToken);
    }

    /// <summary>
    /// Forme équivalente d'un UPC-A et d'un EAN-13 : un UPC-A est un EAN-13 préfixé d'un zéro.
    ///
    /// <para>
    /// Le code est stocké tel qu'il a été scanné — normaliser en base casserait la douchette,
    /// qui renvoie 12 chiffres sur un UPC-A dans sa configuration par défaut, et changerait la
    /// largeur physique de l'étiquette réimprimée. L'équivalence est donc résolue ici, à la
    /// lecture, en interrogeant les deux formes.
    /// </para>
    ///
    /// <para>
    /// Renvoie la valeur elle-même lorsqu'il n'y a pas d'équivalent : les deux égalités portent
    /// alors sur le même paramètre, ce qui reste un <i>seek</i> sur l'index filtré. Aucune des
    /// deux comparaisons ne peut être satisfaite par NULL, donc l'optimiseur conserve le
    /// filtre <c>[Barcode] IS NOT NULL</c>.
    /// </para>
    /// </summary>
    private static string UpcEanEquivalent(string normalized)
    {
        if (normalized.Length == 12 && normalized.All(char.IsAsciiDigit))
            return "0" + normalized;

        if (normalized.Length == 13 && normalized[0] == '0' && normalized.All(char.IsAsciiDigit))
            return normalized[1..];

        return normalized;
    }

    public async Task<IReadOnlyList<Product>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> GetActiveProductsAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .Where(p => p.IsActive)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> GetActiveProductsWithCategoryAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .Include(p => p.Category)
            .Where(p => p.IsActive)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> GetByTypeAsync(ProductType type, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .Where(p => p.Type == type && p.IsActive)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<Product> Items, int TotalCount)> SearchAsync(
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
        bool? hasParentProduct = null)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.Products.AsQueryable();

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            // Le code-barres se compare en égalité STRICTE, jamais en Contains : on ne tape
            // pas un morceau de code-barres, on le scanne en entier. Un Contains rouvrirait
            // le défaut de correspondance partielle que le scan a précisément corrigé
            // (« 1234 » trouvant « 12345 »). Le coût est nul : la requête est déjà un balayage
            // à cause de Name.Contains, on n'ajoute qu'une comparaison par ligne.
            var exact = searchTerm.Trim();
            query = query.Where(p =>
                p.Name.Contains(searchTerm) ||
                p.Code.Contains(searchTerm) ||
                p.Barcode!.Value == exact);
        }

        if (type.HasValue)
            query = query.Where(p => p.Type == type.Value);

        if (isActive.HasValue)
            query = query.Where(p => p.IsActive == isActive.Value);

        if (categoryId.HasValue)
            query = query.Where(p => p.CategoryId == categoryId.Value);

        if (excludeVariantTemplates)
            query = query.Where(p => !p.IsVariantTemplate);

        if (parentProductId.HasValue)
            query = query.Where(p => p.ParentProductId == parentProductId.Value);

        if (isVariantTemplate.HasValue)
            query = query.Where(p => p.IsVariantTemplate == isVariantTemplate.Value);

        if (hasParentProduct == true)
            query = query.Where(p => p.ParentProductId != null);

        if (hasParentProduct == false)
            query = query.Where(p => p.ParentProductId == null);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .Include(p => p.Category)
            .OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<(IReadOnlyList<Product> Items, int TotalCount)> GetChildrenByParentIdAsync(
        Guid parentProductId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.Products
            .Where(p => p.ParentProductId == parentProductId);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .Include(p => p.Category)
            .OrderBy(p => p.Code)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<IReadOnlyList<Product>> SearchTemplatesForSelectAsync(
        string? searchTerm,
        bool? isActive,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.Products.AsNoTracking()
            .Where(p => p.IsVariantTemplate)
            .AsQueryable();

        if (isActive.HasValue)
            query = query.Where(p => p.IsActive == isActive.Value);

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(p =>
                p.Code.StartsWith(term) ||
                p.Name.Contains(term));
        }

        return await query
            .OrderBy(p => p.Name)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> SearchForSelectAsync(
        string? searchTerm,
        bool? isActive,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.Products.AsNoTracking().Where(p => !p.IsVariantTemplate).AsQueryable();

        if (isActive.HasValue)
            query = query.Where(p => p.IsActive == isActive.Value);

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            // Prefix on Code uses the unique index; Contains on Name for free-text matching.
            // Le code-barres se compare en égalité stricte (voir SearchAsync) : c'est ce qui
            // permet de scanner directement dans l'autocomplétion d'une ligne de document.
            query = query.Where(p =>
                p.Code.StartsWith(term) ||
                p.Name.Contains(term) ||
                p.Barcode!.Value == term);
        }

        return await query
            .OrderBy(p => p.Name)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, bool>> GetFodecFlagsByIdsAsync(
        IReadOnlyCollection<Guid> productIds,
        CancellationToken cancellationToken = default)
    {
        if (productIds.Count == 0)
            return new Dictionary<Guid, bool>();

        await using var context = _contextFactory.CreateContext();
        var distinct = productIds.Distinct().ToList();
        return await context.Products
            .AsNoTracking()
            .Where(p => distinct.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.IsFodecApplicable, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, ProductTrackingInfo>> GetTrackingInfoByIdsAsync(
        IReadOnlyCollection<Guid> productIds,
        CancellationToken cancellationToken = default)
    {
        if (productIds.Count == 0)
            return new Dictionary<Guid, ProductTrackingInfo>();

        await using var context = _contextFactory.CreateContext();
        var distinct = productIds.Distinct().ToList();
        return await context.Products
            .AsNoTracking()
            .Where(p => distinct.Contains(p.Id))
            .ToDictionaryAsync(
                p => p.Id,
                p => new ProductTrackingInfo(p.TrackingMode, p.HasExpiryTracking),
                cancellationToken);
    }

    public async Task<bool> IsUsedInInvoicesAsync(Guid productId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.InvoiceLines.AnyAsync(l => l.ProductId == productId, cancellationToken);
    }

    public async Task<IReadOnlyList<Product>> GetStockManagedProductsAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products
            .Where(p => p.IsActive && p.IsStockManaged)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<Product> AddAsync(Product entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Products.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(Product entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Products.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Product entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Products.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Products.AnyAsync(p => p.Id == id, cancellationToken);
    }

    public async Task UpdateImageUrlAsync(Guid productId, string imageUrl, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var product = await context.Products
            .FirstOrDefaultAsync(p => p.Id == productId, cancellationToken);
        if (product is null)
            return;
        product.SetImageUrl(imageUrl);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task ClearImageUrlAsync(Guid productId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var product = await context.Products
            .FirstOrDefaultAsync(p => p.Id == productId, cancellationToken);
        if (product is null)
            return;
        product.ClearImageUrl();
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, string>> GetProductNamesByIdsAsync(
        IReadOnlyCollection<Guid> productIds,
        CancellationToken cancellationToken = default)
    {
        if (productIds.Count == 0)
            return new Dictionary<Guid, string>();

        await using var context = _contextFactory.CreateContext();
        var distinct = productIds.Distinct().ToList();
        return await context.Products
            .AsNoTracking()
            .Where(p => distinct.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
    }
}
