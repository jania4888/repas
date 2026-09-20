using System.Reflection;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for Quote aggregate.
/// </summary>
public sealed class QuoteRepository : IQuoteRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public QuoteRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Quote?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
    }

    public async Task<Quote?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .Include(q => q.Lines)
            .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
    }

    public async Task<Quote?> GetByNumberAsync(string number, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .FirstOrDefaultAsync(q => EF.Property<string>(q.Number, "Value") == number, cancellationToken);
    }

    public async Task<IReadOnlyList<Quote>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .OrderByDescending(q => q.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Quote>> GetByClientIdAsync(Guid clientId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .Where(q => q.ClientId == clientId)
            .OrderByDescending(q => q.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Quote>> GetByStatusAsync(QuoteStatus status, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .Where(q => q.Status == status)
            .OrderByDescending(q => q.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Quote>> GetByDateRangeAsync(DateTime startDate, DateTime endDate, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .Where(q => q.IssueDate >= startDate && q.IssueDate <= endDate)
            .OrderByDescending(q => q.IssueDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Quote>> GetExpiredQuotesAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var today = DateTime.UtcNow.Date;
        
        return await context.Quotes
            .Include(q => q.Client)
            .Where(q => q.ExpiryDate < today && 
                       q.Status != QuoteStatus.Expired && 
                       q.Status != QuoteStatus.Converted && 
                       q.Status != QuoteStatus.Cancelled)
            .OrderBy(q => q.ExpiryDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Quote>> GetConvertibleQuotesAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes
            .Include(q => q.Client)
            .Include(q => q.Lines)
            .Where(q => q.Status == QuoteStatus.Accepted && 
                       q.ConvertedInvoiceId == null)
            .OrderByDescending(q => q.AcceptedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<int> GetMonthlyCountAsync(int year, int month, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var startDate = new DateTime(year, month, 1);
        var endDate = startDate.AddMonths(1);
        
        return await context.Quotes
            .CountAsync(q => q.CreatedAt >= startDate && q.CreatedAt < endDate, cancellationToken);
    }

    public async Task<(IReadOnlyList<Quote> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        QuoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyQuoteFilters(
            context.Quotes.Include(q => q.Client).AsQueryable(),
            searchTerm, status, fromDate, toDate, clientId);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(q => q.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the quote list filters. Single source of truth shared by <see cref="SearchAsync"/>
    /// and <see cref="GetSummaryAsync"/> so the list and its totals zone can never diverge.
    /// </summary>
    private static IQueryable<Quote> ApplyQuoteFilters(
        IQueryable<Quote> query,
        string? searchTerm,
        QuoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            query = query.Where(q =>
                EF.Property<string>(q.Number, "Value").Contains(searchTerm) ||
                q.Client.Name.Contains(searchTerm) ||
                (q.Reference != null && q.Reference.Contains(searchTerm)));
        }

        if (status.HasValue)
            query = query.Where(q => q.Status == status.Value);

        if (fromDate.HasValue)
            query = query.Where(q => q.IssueDate >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(q => q.IssueDate <= toDate.Value);

        if (clientId.HasValue)
            query = query.Where(q => q.ClientId == clientId.Value);

        return query;
    }

    public async Task<QuoteListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        QuoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var filtered = ApplyQuoteFilters(
            context.Quotes.AsNoTracking(),
            searchTerm, status, fromDate, toDate, clientId);

        var rows = await filtered
            .Select(q => new
            {
                Ttc = q.TotalAmount.Amount,
                Ht = q.SubTotal.Amount,
                Vat = q.TotalVat.Amount,
                q.ExpiryDate,
                q.Status,
                Currency = q.TotalAmount.Currency
            })
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return new QuoteListSummaryDto { Currency = "TND" };

        var today = DateTime.UtcNow.Date;
        decimal totalTtc = 0m, totalHt = 0m, totalVat = 0m;
        var acceptedCount = 0;
        var expiredCount = 0;

        foreach (var r in rows)
        {
            totalTtc += r.Ttc;
            totalHt += r.Ht;
            totalVat += r.Vat;
            if (r.Status == QuoteStatus.Accepted)
                acceptedCount++;
            if (r.ExpiryDate < today
                && r.Status != QuoteStatus.Expired
                && r.Status != QuoteStatus.Converted
                && r.Status != QuoteStatus.Cancelled)
            {
                expiredCount++;
            }
        }

        return new QuoteListSummaryDto
        {
            Count = rows.Count,
            TotalTtc = Math.Round(totalTtc, 3),
            TotalHt = Math.Round(totalHt, 3),
            TotalVat = Math.Round(totalVat, 3),
            AcceptedCount = acceptedCount,
            ExpiredCount = expiredCount,
            Currency = rows[0].Currency
        };
    }

    public async Task<Quote> AddAsync(Quote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // CRITICAL: Ensure referenced Client entity is properly tracked in this context BEFORE adding the quote.
        // The Client is loaded from a different context (via ClientRepository) and needs to be properly handled
        // to avoid EF Core trying to insert it as a new entity or causing tracking conflicts with owned entities.
        if (entity.Client != null)
        {
            // Check if a Client with this ID is already tracked in the ChangeTracker
            var trackedClient = context.ChangeTracker.Entries<Client>()
                .FirstOrDefault(e => e.Entity.Id == entity.Client.Id)?.Entity;
            
            if (trackedClient != null)
            {
                // An instance with this ID is already tracked, replace the reference to use the tracked instance
                // This avoids tracking conflicts when adding the quote
                var clientProperty = typeof(Quote).GetProperty("Client",
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                if (clientProperty != null && clientProperty.CanWrite)
                {
                    clientProperty.SetValue(entity, trackedClient);
                }
            }
            else
            {
                // Client is not tracked in this context, attach it as Unchanged
                // This tells EF Core that the entity already exists in the database
                // and prevents it from trying to insert it or causing tracking conflicts
                context.Clients.Attach(entity.Client);
                context.Entry(entity.Client).State = EntityState.Unchanged;
            }
        }
        
        // CRITICAL: Ensure referenced Product entities are properly tracked in this context BEFORE adding the quote.
        // Products loaded from a different context (via ProductRepository) need to be properly handled
        // to avoid tracking issues with owned entities (Money value objects like UnitPrice, SubTotal, etc.).
        foreach (var line in entity.Lines)
        {
            if (line.Product != null)
            {
                // Ensure we never end up with multiple tracked instances of the same ProductCategory.
                EnsureProductCategoryTrackedOnce(context, line.Product);

                // Check if a Product with this ID is already tracked in the ChangeTracker
                var trackedProduct = context.ChangeTracker.Entries<Product>()
                    .FirstOrDefault(e => e.Entity.Id == line.Product.Id)?.Entity;
                
                if (trackedProduct != null)
                {
                    // An instance with this ID is already tracked, replace the reference to use the tracked instance
                    // This avoids tracking conflicts when adding the quote
                    var productProperty = typeof(QuoteLine).GetProperty("Product",
                        BindingFlags.Public | BindingFlags.Instance);
                    if (productProperty != null && productProperty.CanWrite)
                    {
                        productProperty.SetValue(line, trackedProduct);
                    }
                }
                else
                {
                    // Product is not tracked in this context, attach it as Unchanged
                    // This tells EF Core that the entity already exists in the database
                    // and prevents it from trying to insert it or causing tracking conflicts
                    context.Products.Attach(line.Product);
                    context.Entry(line.Product).State = EntityState.Unchanged;
                }
            }
        }
        
        // Add the quote entity to the context.
        // EF Core will automatically track all related entities including:
        // - All QuoteLine entities in the Lines collection (via HasMany/WithOne relationship)
        // - All owned Money entities within each QuoteLine (UnitPrice, DiscountAmount, SubTotal, VatAmount, Total)
        // - All owned Money entities within the Quote (SubTotal, TotalVat, TotalAmount)
        //
        // The owned entities are configured via OwnsOne() in TenantDbContext.ConfigureQuoteLine()
        // and will be automatically persisted when the owner (QuoteLine) is saved.
        context.Quotes.Add(entity);
        
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(Quote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Quotes.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Quote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Quotes.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes.AnyAsync(q => q.Id == id, cancellationToken);
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
