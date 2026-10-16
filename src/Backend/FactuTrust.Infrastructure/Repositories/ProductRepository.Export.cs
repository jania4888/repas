using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class ProductRepository
{
    public async Task<CountedRows<ProductExportRow>> ListForExportAsync(
        string? searchTerm,
        ProductType? type,
        bool? isActive,
        Guid? categoryId,
        bool excludeVariantTemplates,
        bool? isVariantTemplate,
        bool? hasParentProduct,
        int maxRows,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var filtered = ApplyProductListFilters(
            context.Products.AsNoTracking(),
            searchTerm,
            type,
            isActive,
            categoryId,
            excludeVariantTemplates,
            isVariantTemplate,
            hasParentProduct);

        var count = await filtered.CountAsync(cancellationToken);
        if (count > maxRows)
            return CountedRows<ProductExportRow>.Over(count);

        var raw = await filtered
            .OrderBy(p => p.Code)
            .Select(p => new
            {
                p.Id,
                p.Code,
                p.Name,
                p.Description,
                p.Type,
                CategoryName = p.Category.Name,
                UnitPrice = p.UnitPrice.Amount,
                PurchasePrice = p.PurchasePrice == null ? (decimal?)null : p.PurchasePrice.Amount,
                LastPurchasePrice = p.LastPurchasePrice == null ? (decimal?)null : p.LastPurchasePrice.Amount,
                p.VatRate,
                p.Unit,
                Barcode = p.Barcode == null ? null : p.Barcode.Value,
                p.IsActive,
                p.IsStockManaged,
                p.IsFodecApplicable,
                p.IsDiscountEnabled,
                p.MaxDiscountPercent
            })
            .ToListAsync(cancellationToken);

        var costs = await (
            from stock in context.StockItems.AsNoTracking()
            join product in filtered on stock.ProductId equals product.Id
            where stock.IsActive && stock.QuantityOnHand > 0
            group stock by stock.ProductId
            into grouped
            select new
            {
                ProductId = grouped.Key,
                Quantity = grouped.Sum(item => item.QuantityOnHand),
                Value = grouped.Sum(item => item.QuantityOnHand * item.AverageCost)
            }).ToListAsync(cancellationToken);

        var cump = costs.ToDictionary(
            row => row.ProductId,
            row => row.Quantity == 0 ? (decimal?)null : row.Value / row.Quantity);

        var rows = raw.Select(product => new ProductExportRow(
            product.Id,
            product.Code,
            product.Name,
            product.Description,
            product.Type,
            product.CategoryName,
            product.UnitPrice,
            product.PurchasePrice,
            product.LastPurchasePrice,
            cump.GetValueOrDefault(product.Id),
            product.VatRate,
            product.Unit,
            product.Barcode,
            product.IsActive,
            product.IsStockManaged,
            product.IsFodecApplicable,
            product.IsDiscountEnabled,
            product.MaxDiscountPercent)).ToList();

        return CountedRows<ProductExportRow>.Ready(rows);
    }

    /// <summary>
    /// Même prédicats que <c>SearchAsync</c>. Dupliqués ici pour ne pas modifier le chemin de liste.
    /// </summary>
    private static IQueryable<Domain.Entities.Product> ApplyProductListFilters(
        IQueryable<Domain.Entities.Product> query,
        string? searchTerm,
        ProductType? type,
        bool? isActive,
        Guid? categoryId,
        bool excludeVariantTemplates,
        bool? isVariantTemplate,
        bool? hasParentProduct)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
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

        if (isVariantTemplate.HasValue)
            query = query.Where(p => p.IsVariantTemplate == isVariantTemplate.Value);

        if (hasParentProduct == true)
            query = query.Where(p => p.ParentProductId != null);

        if (hasParentProduct == false)
            query = query.Where(p => p.ParentProductId == null);

        return query;
    }
}
