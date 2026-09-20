using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for Invoice aggregate.
/// </summary>
public sealed class InvoiceRepository : IInvoiceRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public InvoiceRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Invoice?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .Include(i => i.Client)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }

    public async Task<decimal> SumFiscalStampAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;
        return await context.Invoices
            .AsNoTracking()
            .Where(i => i.IssueDate >= from && i.IssueDate <= to
                && i.Status != InvoiceStatus.Draft && i.Status != InvoiceStatus.Cancelled)
            .SumAsync(i => i.FiscalStampAmount.Amount, cancellationToken);
    }

    public async Task<decimal> SumFodecAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;
        return await context.Invoices
            .AsNoTracking()
            .Where(i => i.IssueDate >= from && i.IssueDate <= to
                && i.Status != InvoiceStatus.Draft && i.Status != InvoiceStatus.Cancelled)
            .SumAsync(i => i.FodecAmount.Amount, cancellationToken);
    }

    public async Task<decimal> SumFodecTaxableBaseAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;
        return await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.IsFodecApplicable
                && l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to
                && l.Invoice.Status != InvoiceStatus.Draft && l.Invoice.Status != InvoiceStatus.Cancelled)
            .SumAsync(l => l.SubTotal.Amount, cancellationToken);
    }

    public async Task<Invoice?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .Include(i => i.Client)
            .Include(i => i.Warehouse)
            .Include(i => i.Lines)
            .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }

    public async Task<Invoice?> GetByNumberAsync(string number, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .Include(i => i.Client)
            .FirstOrDefaultAsync(i => EF.Property<string>(i.Number, "Value") == number, cancellationToken);
    }

    public async Task<IReadOnlyList<Invoice>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .Include(i => i.Client)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Invoice>> GetByClientIdAsync(Guid clientId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .Include(i => i.Client)
            .Where(i => i.ClientId == clientId)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Invoice>> GetByStatusAsync(InvoiceStatus status, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .Include(i => i.Client)
            .Where(i => i.Status == status)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Invoice>> GetByDateRangeAsync(DateTime startDate, DateTime endDate, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .Include(i => i.Client)
            .Where(i => i.IssueDate >= startDate && i.IssueDate <= endDate)
            .OrderByDescending(i => i.IssueDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Invoice>> GetByDateRangeWithLinesAsync(DateTime fromDate, DateTime toDate, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;
        return await context.Invoices
            .Include(i => i.Client)
            .Include(i => i.Lines)
            .ThenInclude(l => l.Product)
            .ThenInclude(p => p!.Category)
            .Where(i => i.IssueDate >= from && i.IssueDate <= to)
            .OrderByDescending(i => i.IssueDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<SalesRevenueReportRowDto>> GetSalesRevenueAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        SalesRevenueGroupBy groupBy,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        // CA = revenu réalisé : seules les factures Payée ou Validée comptent (miroir de
        // InvoiceStatusExtensions.IsRealizedRevenue / REALIZED_REVENUE_STATUSES côté frontend).
        // Condition inlinée car une méthode d'extension ne se traduit pas en SQL via EF Core.
        var lines = context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to
                && (l.Invoice.Status == InvoiceStatus.Paid || l.Invoice.Status == InvoiceStatus.Validated));

        List<SalesRevenueReportRowDto> rows = groupBy switch
        {
            SalesRevenueGroupBy.Product => await lines
                .GroupBy(l => l.ProductName)
                .Select(g => new SalesRevenueReportRowDto
                {
                    GroupKey = g.Key,
                    Revenue = g.Sum(x => x.Total.Amount),
                    Quantity = g.Sum(x => x.Quantity),
                    Currency = g.Select(x => x.Total.Currency).First()
                })
                .OrderByDescending(r => r.Revenue)
                .ToListAsync(cancellationToken),

            SalesRevenueGroupBy.Category => await lines
                .GroupBy(l => l.Product != null && l.Product.Category != null
                    ? l.Product.Category.Name
                    : "Sans catégorie")
                .Select(g => new SalesRevenueReportRowDto
                {
                    GroupKey = g.Key,
                    Revenue = g.Sum(x => x.Total.Amount),
                    Quantity = g.Sum(x => x.Quantity),
                    Currency = g.Select(x => x.Total.Currency).First()
                })
                .OrderByDescending(r => r.Revenue)
                .ToListAsync(cancellationToken),

            SalesRevenueGroupBy.Client => await lines
                .GroupBy(l => l.Invoice.Client != null ? l.Invoice.Client.Name : string.Empty)
                .Select(g => new SalesRevenueReportRowDto
                {
                    GroupKey = g.Key,
                    Revenue = g.Sum(x => x.Total.Amount),
                    Quantity = g.Sum(x => x.Quantity),
                    Currency = g.Select(x => x.Total.Currency).First()
                })
                .OrderByDescending(r => r.Revenue)
                .ToListAsync(cancellationToken),

            SalesRevenueGroupBy.ProductAndClient => await lines
                .GroupBy(l => new
                {
                    l.ProductName,
                    ClientName = l.Invoice.Client != null ? l.Invoice.Client.Name : string.Empty
                })
                .Select(g => new SalesRevenueReportRowDto
                {
                    GroupKey = g.Key.ProductName,
                    GroupKey2 = g.Key.ClientName,
                    Revenue = g.Sum(x => x.Total.Amount),
                    Quantity = g.Sum(x => x.Quantity),
                    Currency = g.Select(x => x.Total.Currency).First()
                })
                .OrderByDescending(r => r.Revenue)
                .ToListAsync(cancellationToken),

            _ => await lines
                .GroupBy(l => l.ProductName)
                .Select(g => new SalesRevenueReportRowDto
                {
                    GroupKey = g.Key,
                    Revenue = g.Sum(x => x.Total.Amount),
                    Quantity = g.Sum(x => x.Quantity),
                    Currency = g.Select(x => x.Total.Currency).First()
                })
                .OrderByDescending(r => r.Revenue)
                .ToListAsync(cancellationToken)
        };

        return rows;
    }

    public async Task<BasketMetricsReportDto> GetBasketMetricsAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        var invoiceStats = await context.Invoices
            .AsNoTracking()
            .Where(i => i.IssueDate >= from && i.IssueDate <= to)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                TotalInvoices = g.Count(),
                TotalRevenue = g.Sum(i => i.TotalAmount.Amount),
                Currency = g.Select(i => i.TotalAmount.Currency).FirstOrDefault() ?? "TND"
            })
            .FirstOrDefaultAsync(cancellationToken);

        var totalLines = await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to)
            .CountAsync(cancellationToken);

        var totalInvoices = invoiceStats?.TotalInvoices ?? 0;
        var totalRevenue = invoiceStats?.TotalRevenue ?? 0m;
        var currency = invoiceStats?.Currency ?? "TND";

        return new BasketMetricsReportDto
        {
            TotalInvoices = totalInvoices,
            TotalRevenue = totalRevenue,
            TotalLines = totalLines,
            AverageBasket = totalInvoices > 0 ? totalRevenue / totalInvoices : 0m,
            AverageLinesPerInvoice = totalInvoices > 0 ? (decimal)totalLines / totalInvoices : 0m,
            Currency = currency
        };
    }

    public async Task<IReadOnlyList<InvoiceProductLineAggregateDto>> GetProductPerformanceAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        return await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to && l.ProductId.HasValue)
            .GroupBy(l => l.ProductId!.Value)
            .Select(g => new InvoiceProductLineAggregateDto
            {
                ProductId = g.Key,
                ProductName = g.Select(x => x.ProductName).First(),
                ProductCode = g.Select(x => x.ProductCode).First(),
                CategoryName = g.Select(x => x.Product != null && x.Product.Category != null
                    ? x.Product.Category.Name
                    : null).First(),
                Quantity = g.Sum(x => x.Quantity),
                Revenue = g.Sum(x => x.Total.Amount),
                TotalCost = g.Sum(x => x.Quantity * (x.Product != null
                    ? (x.Product.PurchasePrice != null
                        ? x.Product.PurchasePrice.Amount
                        : x.Product.UnitPrice.Amount)
                    : 0m)),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .OrderByDescending(r => r.Revenue)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<InvoiceProductPeriodAggregateDto>> GetProductSalesTrendAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        return await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to && l.ProductId.HasValue)
            .GroupBy(l => new
            {
                ProductId = l.ProductId!.Value,
                l.Invoice.IssueDate.Year,
                l.Invoice.IssueDate.Month
            })
            .Select(g => new InvoiceProductPeriodAggregateDto
            {
                ProductId = g.Key.ProductId,
                Year = g.Key.Year,
                Month = g.Key.Month,
                ProductName = g.Select(x => x.ProductName).First(),
                ProductCode = g.Select(x => x.ProductCode).First(),
                CategoryName = g.Select(x => x.Product != null && x.Product.Category != null
                    ? x.Product.Category.Name
                    : null).First(),
                Quantity = g.Sum(x => x.Quantity),
                Revenue = g.Sum(x => x.Total.Amount),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .OrderBy(r => r.Year)
            .ThenBy(r => r.Month)
            .ThenByDescending(r => r.Revenue)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlySet<Guid>> GetSoldProductIdsInDateRangeAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        var ids = await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to && l.ProductId.HasValue)
            .Select(l => l.ProductId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        return ids.ToHashSet();
    }

    public async Task<IReadOnlyList<CommercialProfitLineSourceDto>> GetCommercialProfitLineSourcesAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        return await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to)
            .Select(l => new CommercialProfitLineSourceDto
            {
                InvoiceId = l.InvoiceId,
                InvoiceNumber = EF.Property<string>(l.Invoice.Number, "Value"),
                IssueDate = l.Invoice.IssueDate,
                Reference = l.Invoice.Reference,
                ProductId = l.ProductId,
                ProductName = l.ProductName,
                ProductCode = l.ProductCode,
                Quantity = l.Quantity,
                Revenue = l.SubTotal.Amount,
                Currency = l.SubTotal.Currency,
                FallbackUnitCost = l.Product != null
                    ? (l.Product.PurchasePrice != null
                        ? l.Product.PurchasePrice.Amount
                        : l.Product.UnitPrice.Amount)
                    : 0m
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<SalesVatReportRowDto>> GetSalesVatAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        bool realizedOnly = false,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        var raw = await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to)
            // Assiette légale de la déclaration : exclure brouillons et annulées.
            .Where(l => !realizedOnly
                || (l.Invoice.Status != InvoiceStatus.Draft && l.Invoice.Status != InvoiceStatus.Cancelled))
            .GroupBy(l => l.VatRate)
            .Select(g => new
            {
                VatRate = g.Key,
                TotalVat = g.Sum(x => x.VatAmount.Amount),
                TotalTaxable = g.Sum(x => x.SubTotal.Amount),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .OrderBy(x => x.VatRate)
            .ToListAsync(cancellationToken);

        return raw
            .Select(r => new SalesVatReportRowDto
            {
                VatRatePercent = (int)r.VatRate,
                VatRateDisplay = r.VatRate.ToDisplayString(),
                TotalVatAmount = r.TotalVat,
                TotalTaxableAmount = r.TotalTaxable,
                Currency = r.Currency
            })
            .ToList();
    }

    public async Task<IReadOnlyList<SalesByLineReportRowDto>> GetSalesByLineAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        return await context.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.IssueDate >= from && l.Invoice.IssueDate <= to && l.ProductId.HasValue)
            .GroupBy(l => l.ProductId!.Value)
            .Select(g => new SalesByLineReportRowDto
            {
                ProductId = g.Key,
                ProductName = g.Select(x => x.ProductName).First(),
                ProductCode = g.Select(x => x.ProductCode).First(),
                CategoryName = g.Select(x => x.Product != null && x.Product.Category != null
                    ? x.Product.Category.Name
                    : null).First(),
                Quantity = g.Sum(x => x.Quantity),
                Revenue = g.Sum(x => x.Total.Amount),
                VatAmount = g.Sum(x => x.VatAmount.Amount),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .OrderByDescending(r => r.Revenue)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Invoice>> GetForReportAsync(
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId = null,
        InvoiceType? type = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.Invoices
            .Include(i => i.Client)
            .AsQueryable();

        if (fromDate.HasValue)
            query = query.Where(i => i.IssueDate >= fromDate.Value.Date);

        if (toDate.HasValue)
        {
            // Borne de fin inclusive sur toute la journée (robuste si IssueDate porte une heure).
            var toExclusive = toDate.Value.Date.AddDays(1);
            query = query.Where(i => i.IssueDate < toExclusive);
        }

        if (clientId.HasValue)
            query = query.Where(i => i.ClientId == clientId.Value);

        if (type.HasValue)
            query = query.Where(i => i.Type == type.Value);

        return await query
            .OrderByDescending(i => i.IssueDate)
            .ToListAsync(cancellationToken);
    }

    [Obsolete("Use IDocumentNumberService instead.")]
    public async Task<InvoiceNumber> GetNextNumberAsync(string prefix, int year, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        var lastSequence = await context.Invoices
            .Where(i => EF.Property<string>(i.Number, "Prefix") == prefix && 
                       EF.Property<int>(i.Number, "Year") == year)
            .Select(i => EF.Property<int>(i.Number, "Sequence"))
            .OrderByDescending(s => s)
            .FirstOrDefaultAsync(cancellationToken);

        return InvoiceNumber.Create(prefix, year, lastSequence + 1);
    }

    public async Task<IReadOnlyList<Invoice>> GetOverdueInvoicesAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var today = DateTime.UtcNow.Date;
        
        return await context.Invoices
            .Include(i => i.Client)
            .Where(i => i.DueDate.HasValue && 
                       i.DueDate.Value < today && 
                       i.Status != InvoiceStatus.Paid && 
                       i.Status != InvoiceStatus.Cancelled)
            .OrderBy(i => i.DueDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<int> GetMonthlyCountAsync(int year, int month, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var startDate = new DateTime(year, month, 1);
        var endDate = startDate.AddMonths(1);
        
        return await context.Invoices
            .CountAsync(i => i.CreatedAt >= startDate && i.CreatedAt < endDate, cancellationToken);
    }

    public async Task<(IReadOnlyList<Invoice> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        InvoiceStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int page,
        int pageSize,
        bool unpaidOnly = false,
        InvoiceType? type = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyInvoiceFilters(
            context.Invoices
                .AsNoTracking()
                .Include(i => i.Client)
                .Include(i => i.Warehouse)
                .AsQueryable(),
            searchTerm, status, fromDate, toDate, clientId, unpaidOnly, type);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(i => i.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the invoice list filters (search, status, period, client, unpaid-only, type) to a query.
    /// Single source of truth shared by <see cref="SearchAsync"/> and <see cref="GetSummaryAsync"/>
    /// so the list and its totals zone can never diverge.
    /// </summary>
    private static IQueryable<Invoice> ApplyInvoiceFilters(
        IQueryable<Invoice> query,
        string? searchTerm,
        InvoiceStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        bool unpaidOnly,
        InvoiceType? type)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            query = query.Where(i =>
                EF.Property<string>(i.Number, "Value").Contains(searchTerm) ||
                i.Client.Name.Contains(searchTerm) ||
                (i.Reference != null && i.Reference.Contains(searchTerm)));
        }

        if (unpaidOnly)
            query = query.Where(i => i.Status != InvoiceStatus.Paid && i.Status != InvoiceStatus.Cancelled);

        if (status.HasValue)
            query = query.Where(i => i.Status == status.Value);

        if (fromDate.HasValue)
            query = query.Where(i => i.IssueDate >= fromDate.Value.Date);

        if (toDate.HasValue)
        {
            // Borne de fin inclusive sur toute la journée (robuste si IssueDate porte une heure).
            var toExclusive = toDate.Value.Date.AddDays(1);
            query = query.Where(i => i.IssueDate < toExclusive);
        }

        if (clientId.HasValue)
            query = query.Where(i => i.ClientId == clientId.Value);

        if (type.HasValue)
            query = query.Where(i => i.Type == type.Value);

        return query;
    }

    public async Task<InvoiceListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        InvoiceStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        bool unpaidOnly = false,
        InvoiceType? type = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var filtered = ApplyInvoiceFilters(
            context.Invoices.AsNoTracking(),
            searchTerm, status, fromDate, toDate, clientId, unpaidOnly, type);

        // Lightweight per-invoice projection (scalar columns only, no entity graph).
        var rows = await filtered
            .Select(i => new
            {
                i.Id,
                Ttc = i.TotalAmount.Amount,
                Ht = i.SubTotal.Amount,
                Vat = i.TotalVat.Amount,
                i.DueDate,
                i.Status,
                Currency = i.TotalAmount.Currency
            })
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return new InvoiceListSummaryDto { Currency = "TND" };

        // Paid per invoice — mirrors PaymentRepository.GetTotalPaidByInvoiceIdsAsync
        // (non-refunded payments, net amount + retenue subie).
        var ids = rows.Select(r => r.Id).ToList();
        var paidById = (await context.Payments
                .AsNoTracking()
                .Where(p => ids.Contains(p.InvoiceId) && !p.IsRefunded)
                .GroupBy(p => p.InvoiceId)
                .Select(g => new
                {
                    InvoiceId = g.Key,
                    Total = g.Sum(p => p.Amount.Amount + (p.ClientWithholdingAmount ?? 0m))
                })
                .ToListAsync(cancellationToken))
            .ToDictionary(x => x.InvoiceId, x => x.Total);

        var today = DateTime.UtcNow.Date;
        decimal totalTtc = 0m, totalHt = 0m, totalVat = 0m, totalPaid = 0m, totalRemaining = 0m;
        var overdueCount = 0;

        foreach (var r in rows)
        {
            var paid = paidById.GetValueOrDefault(r.Id, 0m);
            totalTtc += r.Ttc;
            totalHt += r.Ht;
            totalVat += r.Vat;
            totalPaid += paid;
            // Same per-invoice remaining magnitude as the list (see GetInvoicesQueryHandler).
            totalRemaining += Math.Max(0m, Math.Abs(r.Ttc) - paid);
            if (r.DueDate.HasValue && r.DueDate.Value < today
                && r.Status != InvoiceStatus.Paid && r.Status != InvoiceStatus.Cancelled)
            {
                overdueCount++;
            }
        }

        return new InvoiceListSummaryDto
        {
            Count = rows.Count,
            TotalTtc = Math.Round(totalTtc, 3),
            TotalHt = Math.Round(totalHt, 3),
            TotalVat = Math.Round(totalVat, 3),
            TotalPaid = Math.Round(totalPaid, 3),
            TotalRemaining = Math.Round(totalRemaining, 3),
            OverdueCount = overdueCount,
            Currency = rows[0].Currency
        };
    }

    public async Task<Invoice> AddAsync(Invoice entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // Attach the Client as Unchanged so EF Core doesn't try to insert it.
        if (entity.Client != null)
        {
            var trackedClient = context.ChangeTracker.Entries<Client>()
                .FirstOrDefault(e => e.Entity.Id == entity.Client.Id)?.Entity;

            if (trackedClient == null)
            {
                context.Clients.Attach(entity.Client);
                context.Entry(entity.Client).State = EntityState.Unchanged;
            }
        }
        
        // Attach each distinct Product as Unchanged so EF Core doesn't try to insert them.
        // Multiple lines may reference the same Product, so we deduplicate first.
        var productsByLine = entity.Lines
            .Where(l => l.Product != null)
            .Select(l => l.Product!)
            .GroupBy(p => p.Id)
            .Select(g => g.First())
            .ToList();

        foreach (var product in productsByLine)
        {
            // Pre-track the category as Unchanged so that, if several products in this graph
            // share the same Category id, EF Core does not try to track two distinct C# instances
            // for the same key (which would throw a "duplicate key" InvalidOperationException).
            if (product.Category != null)
            {
                var alreadyTrackedCategory = context.ChangeTracker.Entries<ProductCategory>()
                    .FirstOrDefault(e => e.Entity.Id == product.Category.Id)?.Entity;

                if (alreadyTrackedCategory == null)
                {
                    context.Entry(product.Category).State = EntityState.Unchanged;
                }
                else if (!ReferenceEquals(alreadyTrackedCategory, product.Category))
                {
                    typeof(Product).GetProperty(nameof(Product.Category))!
                        .SetValue(product, alreadyTrackedCategory);
                }
            }

            var trackedProduct = context.ChangeTracker.Entries<Product>()
                .FirstOrDefault(e => e.Entity.Id == product.Id)?.Entity;

            if (trackedProduct == null)
            {
                context.Products.Attach(product);
                context.Entry(product).State = EntityState.Unchanged;
            }
        }
        
        // Add the invoice entity to the context.
        // EF Core will automatically track all related entities including:
        // - All InvoiceLine entities in the Lines collection (via HasMany/WithOne relationship)
        // - All owned Money entities within each InvoiceLine (UnitPrice, DiscountAmount, SubTotal, VatAmount, Total)
        // - All owned Money entities within the Invoice (SubTotal, TotalVat, TotalAmount)
        //
        // The owned entities are configured via OwnsOne() in TenantDbContext.ConfigureInvoiceLine()
        // and will be automatically persisted when the owner (InvoiceLine) is saved.
        context.Invoices.Add(entity);
        
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(Invoice entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Collect distinct products from lines before touching the change tracker.
        var distinctProducts = entity.Lines
            .Where(l => l.Product != null)
            .Select(l => l.Product!)
            .GroupBy(p => p.Id)
            .Select(g => g.First())
            .ToList();

        // Step 1: pre-track distinct categories as Unchanged BEFORE products.
        // Must happen first: products that share a category would otherwise cause
        // EF Core to attempt tracking two C# instances for the same category Id
        // ("duplicate key" InvalidOperationException).
        foreach (var product in distinctProducts)
        {
            if (product.Category == null) continue;

            var alreadyTracked = context.ChangeTracker.Entries<ProductCategory>()
                .FirstOrDefault(e => e.Entity.Id == product.Category.Id)?.Entity;

            if (alreadyTracked == null)
            {
                context.Entry(product.Category).State = EntityState.Unchanged;
            }
            else if (!ReferenceEquals(alreadyTracked, product.Category))
            {
                // Point the product at the already-tracked instance so Attach(product) below
                // does not encounter a second C# object for the same category Id.
                typeof(Product).GetProperty(nameof(Product.Category))!
                    .SetValue(product, alreadyTracked);
            }
        }

        // Step 2: pre-track distinct products as Unchanged.
        foreach (var product in distinctProducts)
            context.Entry(product).State = EntityState.Unchanged;

        // Step 3: pre-track reference navigations as Unchanged.
        if (entity.Client != null)
            context.Entry(entity.Client).State = EntityState.Unchanged;
        if (entity.Warehouse != null)
            context.Entry(entity.Warehouse).State = EntityState.Unchanged;

        // Step 4: attach the aggregate root, then mark only its own scalars as Modified.
        // Using context.Attach() instead of context.Update() avoids the recursive Modified
        // flood that context.Update() applies to the entire navigation graph.
        context.Attach(entity);
        context.Entry(entity).State = EntityState.Modified;

        // Step 5: mark each line as Modified; reset product references to Unchanged.
        foreach (var line in entity.Lines)
        {
            context.Entry(line).State = EntityState.Modified;
            if (line.Product != null)
                context.Entry(line.Product).State = EntityState.Unchanged;
        }

        // Step 6: defensive reset — ensure all reference entities are still Unchanged.
        if (entity.Client != null)
            context.Entry(entity.Client).State = EntityState.Unchanged;
        if (entity.Warehouse != null)
            context.Entry(entity.Warehouse).State = EntityState.Unchanged;
        foreach (var product in distinctProducts)
        {
            context.Entry(product).State = EntityState.Unchanged;
            if (product.Category != null)
                context.Entry(product.Category).State = EntityState.Unchanged;
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Invoice entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Invoices.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices.AnyAsync(i => i.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<(Guid UserId, int Month), decimal>> GetAchievedRevenueTndByUserMonthForYearAsync(
        int year,
        CancellationToken cancellationToken = default)
    {
        var yearStart = new DateTime(year, 1, 1);
        var yearEnd = new DateTime(year, 12, 31, 23, 59, 59, 999);
        await using var context = _contextFactory.CreateContext();

        var query = from inv in context.Invoices.AsNoTracking()
                    join c in context.Clients.AsNoTracking() on inv.ClientId equals c.Id
                    where inv.IssueDate >= yearStart && inv.IssueDate <= yearEnd
                          && inv.Status != InvoiceStatus.Draft && inv.Status != InvoiceStatus.Cancelled
                          && c.AssignedUserId != null
                    select new
                    {
                        UserId = c.AssignedUserId!.Value,
                        Month = inv.IssueDate.Month,
                        Amount = inv.TotalAmount.Amount
                    };

        var grouped = await query
            .GroupBy(x => new { x.UserId, x.Month })
            .Select(g => new { g.Key.UserId, g.Key.Month, Sum = g.Sum(x => x.Amount) })
            .ToListAsync(cancellationToken);

        return grouped.ToDictionary(x => (x.UserId, x.Month), x => x.Sum);
    }

    public async Task<decimal> SumIssuedCreditNoteCommercialTtcAsync(
        Guid linkedInvoiceId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var rows = await context.Invoices
            .AsNoTracking()
            .Where(i => i.LinkedInvoiceId == linkedInvoiceId
                && i.Type == InvoiceType.CreditNote
                && i.Status != InvoiceStatus.Draft
                && i.Status != InvoiceStatus.Cancelled)
            .Select(i => new { Total = i.TotalAmount.Amount, Stamp = i.FiscalStampAmount.Amount })
            .ToListAsync(cancellationToken);

        return rows.Sum(r => Math.Abs(r.Total - r.Stamp));
    }

    public async Task<IReadOnlyList<Invoice>> GetByCashRegisterSessionIdAsync(
        Guid cashRegisterSessionId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices
            .AsNoTracking()
            .Where(i => i.CashRegisterSessionId == cashRegisterSessionId)
            .OrderBy(i => i.CreatedAt)
            .ToListAsync(cancellationToken);
    }
}
