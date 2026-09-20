using System.Reflection;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository de l'agrégat <see cref="SalesOrder"/>, calqué sur
/// <see cref="PurchaseOrderRepository"/>.
/// </summary>
public sealed class SalesOrderRepository : ISalesOrderRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public SalesOrderRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<SalesOrder?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesOrders
            .Include(o => o.Client)
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
    }

    public async Task<SalesOrder?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesOrders
            .Include(o => o.Client)
            .Include(o => o.Warehouse)
            .Include(o => o.Lines)
                .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<SalesOrder>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesOrders
            .Include(o => o.Client)
            .OrderByDescending(o => o.OrderDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<SalesOrder> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        SalesOrderStatus? status,
        Guid? clientId,
        DateTime? fromDate,
        DateTime? toDate,
        bool openOnly,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = BuildFilteredQuery(
            context.SalesOrders.Include(o => o.Client).Include(o => o.Lines).AsNoTracking(),
            searchTerm, status, clientId, fromDate, toDate, openOnly);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(o => o.OrderDate)
            .ThenByDescending(o => o.Number.Sequence)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<SalesOrderListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        SalesOrderStatus? status,
        Guid? clientId,
        DateTime? fromDate,
        DateTime? toDate,
        bool openOnly,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Les lignes sont chargées : le carnet se calcule au prorata ligne à ligne
        // (BacklogAmountHt), ce qu'une agrégation SQL directe ne saurait pas exprimer.
        var orders = await BuildFilteredQuery(
                context.SalesOrders.Include(o => o.Lines).AsNoTracking(),
                searchTerm, status, clientId, fromDate, toDate, openOnly)
            .ToListAsync(cancellationToken);

        return new SalesOrderListSummaryDto
        {
            Count = orders.Count,
            TotalHt = orders.Sum(o => o.SubTotal.Amount),
            TotalVat = orders.Sum(o => o.TotalVat.Amount),
            TotalTtc = orders.Sum(o => o.TotalAmount.Amount),
            BacklogAmountHt = orders.Where(o => o.Status.IsOpen()).Sum(o => o.BacklogAmountHt),
            OpenCount = orders.Count(o => o.Status.IsOpen()),
            PartiallyDeliveredCount = orders.Count(o => o.Status == SalesOrderStatus.PartiallyDelivered),
            CompletedCount = orders.Count(o => o.Status == SalesOrderStatus.Completed),
            Currency = orders.Count > 0 ? orders[0].TotalAmount.Currency : "TND"
        };
    }

    public async Task<IReadOnlyList<SalesOrderBacklogRowDto>> GetBacklogAsync(
        Guid? clientId,
        DateTime? dueBefore,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.SalesOrders
            .Include(o => o.Client)
            .Include(o => o.Lines)
            .AsNoTracking()
            .Where(o => o.Status == SalesOrderStatus.Confirmed
                     || o.Status == SalesOrderStatus.PartiallyDelivered);

        if (clientId.HasValue)
            query = query.Where(o => o.ClientId == clientId.Value);

        if (dueBefore.HasValue)
            query = query.Where(o => o.ExpectedDeliveryDate != null
                                  && o.ExpectedDeliveryDate <= dueBefore.Value);

        var orders = await query.ToListAsync(cancellationToken);
        var today = DateTime.UtcNow.Date;

        return orders
            .SelectMany(o => o.Lines
                .Where(l => l.PendingDeliveryQuantity > 0)
                .Select(l => new SalesOrderBacklogRowDto
                {
                    SalesOrderId = o.Id,
                    OrderNumber = o.Number.Value,
                    OrderDate = o.OrderDate,
                    ExpectedDeliveryDate = o.ExpectedDeliveryDate,
                    ClientId = o.ClientId,
                    ClientName = o.Client?.Name ?? string.Empty,
                    ProductId = l.ProductId,
                    ProductCode = l.ProductCode,
                    ProductName = l.ProductName,
                    OrderedQuantity = l.Quantity,
                    DeliveredQuantity = l.DeliveredQuantity,
                    PendingQuantity = l.PendingDeliveryQuantity,
                    PendingAmountHt = l.Quantity == 0
                        ? 0m
                        : Math.Round(l.SubTotal.Amount * l.PendingDeliveryQuantity / l.Quantity, 3),
                    IsLate = o.ExpectedDeliveryDate.HasValue
                             && o.ExpectedDeliveryDate.Value.Date < today
                }))
            .OrderBy(r => r.ExpectedDeliveryDate ?? DateTime.MaxValue)
            .ThenBy(r => r.OrderNumber)
            .ToList();
    }

    public async Task<IReadOnlyList<SalesOrder>> GetOpenOrdersByClientAsync(
        Guid clientId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesOrders
            .Include(o => o.Lines)
            .AsNoTracking()
            .Where(o => o.ClientId == clientId
                     && (o.Status == SalesOrderStatus.Confirmed
                      || o.Status == SalesOrderStatus.PartiallyDelivered
                      || o.Status == SalesOrderStatus.Delivered))
            .OrderByDescending(o => o.OrderDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<SalesOrder> AddAsync(SalesOrder entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Client et produits proviennent d'autres contextes (chargés par leurs propres
        // repositories). Même précaution que QuoteRepository / PurchaseOrderRepository :
        // unifier Client, Product et ProductCategory avant l'ajout pour éviter les conflits
        // de suivi EF Core ("another instance with the same key value is already being tracked").
        if (entity.Client != null)
        {
            var trackedClient = context.ChangeTracker.Entries<Client>()
                .FirstOrDefault(e => e.Entity.Id == entity.Client.Id)?.Entity;

            if (trackedClient != null)
            {
                var clientProperty = typeof(SalesOrder).GetProperty(
                    nameof(SalesOrder.Client),
                    BindingFlags.Public | BindingFlags.Instance);
                clientProperty?.SetValue(entity, trackedClient);
            }
            else
            {
                context.Clients.Attach(entity.Client);
                context.Entry(entity.Client).State = EntityState.Unchanged;
            }
        }

        foreach (var line in entity.Lines)
        {
            if (line.Product == null) continue;

            EnsureProductCategoryTrackedOnce(context, line.Product);

            var trackedProduct = context.ChangeTracker.Entries<Product>()
                .FirstOrDefault(e => e.Entity.Id == line.Product.Id)?.Entity;

            if (trackedProduct != null)
            {
                var productProperty = typeof(SalesOrderLine).GetProperty(
                    nameof(SalesOrderLine.Product),
                    BindingFlags.Public | BindingFlags.Instance);
                productProperty?.SetValue(line, trackedProduct);
            }
            else
            {
                context.Products.Attach(line.Product);
                context.Entry(line.Product).State = EntityState.Unchanged;
            }
        }

        context.SalesOrders.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(SalesOrder entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.SalesOrders.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(SalesOrder entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.SalesOrders.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesOrders.AnyAsync(o => o.Id == id, cancellationToken);
    }

    private static IQueryable<SalesOrder> BuildFilteredQuery(
        IQueryable<SalesOrder> query,
        string? searchTerm,
        SalesOrderStatus? status,
        Guid? clientId,
        DateTime? fromDate,
        DateTime? toDate,
        bool openOnly)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(o =>
                o.Number.Value.Contains(term) ||
                (o.Reference != null && o.Reference.Contains(term)) ||
                o.Client.Name.Contains(term));
        }

        if (status.HasValue)
            query = query.Where(o => o.Status == status.Value);

        if (clientId.HasValue)
            query = query.Where(o => o.ClientId == clientId.Value);

        if (fromDate.HasValue)
            query = query.Where(o => o.OrderDate >= fromDate.Value.Date);

        if (toDate.HasValue)
            query = query.Where(o => o.OrderDate <= toDate.Value.Date);

        if (openOnly)
        {
            query = query.Where(o => o.Status != SalesOrderStatus.Completed
                                  && o.Status != SalesOrderStatus.Cancelled
                                  && o.Status != SalesOrderStatus.Closed);
        }

        return query;
    }

    /// <summary>
    /// Ensures only one instance of a given ProductCategory is tracked when attaching products.
    /// Products loaded from different contexts may each have their own Category instance for the same Id;
    /// attaching them without this would cause InvalidOperationException (duplicate key tracking).
    /// </summary>
    private static void EnsureProductCategoryTrackedOnce(DbContext context, Product product)
    {
        if (product.Category == null) return;

        var trackedCategory = context.ChangeTracker.Entries<ProductCategory>()
            .FirstOrDefault(e => e.Entity.Id == product.Category.Id)?.Entity;

        if (trackedCategory != null)
        {
            var categoryProp = typeof(Product).GetProperty(
                nameof(Product.Category),
                BindingFlags.Public | BindingFlags.Instance);
            categoryProp?.SetValue(product, trackedCategory);
        }
    }
}
