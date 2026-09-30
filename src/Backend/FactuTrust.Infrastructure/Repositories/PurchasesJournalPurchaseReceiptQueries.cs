using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

internal static class PurchasesJournalPurchaseReceiptQueries
{
    public static async Task<(IReadOnlyList<PurchasesJournalDetailRowDto> Rows, int TotalCount)> GetDetailPagedAsync(
        TenantDbContext context,
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var (from, toExclusive) = DateRange(fromDate, toDate);
        var baseQuery = JournalLines(context, from, toExclusive, supplierId);
        var total = await baseQuery.CountAsync(cancellationToken);
        var skip = Math.Max(0, (page - 1) * pageSize);
        var rows = await baseQuery
            .OrderBy(l => l.PurchaseReceipt.ReceiptDate)
            .ThenBy(l => l.LineNumber)
            .Skip(skip)
            .Take(pageSize)
            .Select(l => new PurchasesJournalDetailRowDto
            {
                EntryDate = l.PurchaseReceipt.ReceiptDate,
                DocumentId = l.PurchaseReceiptId,
                DocumentNumber = EF.Property<string>(l.PurchaseReceipt.Number, "Value"),
                DocumentKind = "BR",
                SupplierId = l.PurchaseReceipt.SupplierId,
                SupplierName = l.PurchaseReceipt.Supplier != null ? l.PurchaseReceipt.Supplier.Name : string.Empty,
                ProductId = l.ProductId,
                ProductCode = l.ProductCode,
                ProductName = l.ProductName,
                Quantity = l.ReceivedQuantity,
                UnitPrice = l.UnitPrice.Amount,
                LineSubTotal = l.SubTotal.Amount,
                LineTotal = l.Total.Amount,
                VatAmount = l.VatAmount.Amount,
                Currency = l.Total.Currency
            })
            .ToListAsync(cancellationToken);
        return (rows, total);
    }

    public static async Task<IReadOnlyList<PurchasesJournalDetailRowDto>> GetDetailAllAsync(
        TenantDbContext context,
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        int maxRows,
        CancellationToken cancellationToken)
    {
        var (from, toExclusive) = DateRange(fromDate, toDate);
        var baseQuery = JournalLines(context, from, toExclusive, supplierId);
        return await baseQuery
            .OrderBy(l => l.PurchaseReceipt.ReceiptDate)
            .ThenBy(l => l.LineNumber)
            .Take(maxRows + 1)
            .Select(l => new PurchasesJournalDetailRowDto
            {
                EntryDate = l.PurchaseReceipt.ReceiptDate,
                DocumentId = l.PurchaseReceiptId,
                DocumentNumber = EF.Property<string>(l.PurchaseReceipt.Number, "Value"),
                DocumentKind = "BR",
                SupplierId = l.PurchaseReceipt.SupplierId,
                SupplierName = l.PurchaseReceipt.Supplier != null ? l.PurchaseReceipt.Supplier.Name : string.Empty,
                ProductId = l.ProductId,
                ProductCode = l.ProductCode,
                ProductName = l.ProductName,
                Quantity = l.ReceivedQuantity,
                UnitPrice = l.UnitPrice.Amount,
                LineSubTotal = l.SubTotal.Amount,
                LineTotal = l.Total.Amount,
                VatAmount = l.VatAmount.Amount,
                Currency = l.Total.Currency
            })
            .ToListAsync(cancellationToken);
    }

    public static async Task<int> CountDetailAsync(
        TenantDbContext context,
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        CancellationToken cancellationToken)
    {
        var (from, toExclusive) = DateRange(fromDate, toDate);
        return await JournalLines(context, from, toExclusive, supplierId).CountAsync(cancellationToken);
    }

    public static async Task<PurchasesJournalTotalsDto> GetDetailTotalsAsync(
        TenantDbContext context,
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        CancellationToken cancellationToken)
    {
        var (from, toExclusive) = DateRange(fromDate, toDate);
        var baseQuery = JournalLines(context, from, toExclusive, supplierId);
        var agg = await baseQuery
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Quantity = g.Sum(x => x.ReceivedQuantity),
                LineSubTotal = g.Sum(x => x.SubTotal.Amount),
                LineTotal = g.Sum(x => x.Total.Amount),
                VatAmount = g.Sum(x => x.VatAmount.Amount),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (agg is null)
            return new PurchasesJournalTotalsDto { Currency = "TND" };

        return new PurchasesJournalTotalsDto
        {
            Quantity = agg.Quantity,
            LineSubTotal = agg.LineSubTotal,
            LineTotal = agg.LineTotal,
            VatAmount = agg.VatAmount,
            Currency = agg.Currency
        };
    }

    public static async Task<IReadOnlyList<PurchasesJournalAggregatedRowDto>> GetAggregatedAsync(
        TenantDbContext context,
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        SalesJournalViewMode groupBy,
        CancellationToken cancellationToken)
    {
        var (from, toExclusive) = DateRange(fromDate, toDate);
        var baseQuery = JournalLines(context, from, toExclusive, supplierId);
        return groupBy switch
        {
            SalesJournalViewMode.Day => await AggregateByDayAsync(baseQuery, cancellationToken),
            SalesJournalViewMode.Month => await AggregateByMonthAsync(baseQuery, cancellationToken),
            SalesJournalViewMode.Year => await AggregateByYearAsync(baseQuery, cancellationToken),
            _ => await AggregateByDayAsync(baseQuery, cancellationToken)
        };
    }

    private static (DateTime From, DateTime ToExclusive) DateRange(DateTime fromDate, DateTime toDate)
    {
        var from = fromDate.Date;
        var toExclusive = toDate.Date.AddDays(1);
        return (from, toExclusive);
    }

    private static IQueryable<PurchaseReceiptLine> JournalLines(
        TenantDbContext context,
        DateTime from,
        DateTime toExclusive,
        Guid? supplierId)
    {
        var lines = context.PurchaseReceiptLines.AsNoTracking()
            .Where(l =>
                l.PurchaseReceipt.ReceiptDate >= from
                && l.PurchaseReceipt.ReceiptDate < toExclusive
                && (l.PurchaseReceipt.Status == PurchaseReceiptStatus.Validated
                    || l.PurchaseReceipt.Status == PurchaseReceiptStatus.PartiallyInvoiced
                    || l.PurchaseReceipt.Status == PurchaseReceiptStatus.Invoiced));

        if (supplierId.HasValue)
            lines = lines.Where(l => l.PurchaseReceipt.SupplierId == supplierId.Value);

        return lines;
    }

    private static async Task<IReadOnlyList<PurchasesJournalAggregatedRowDto>> AggregateByDayAsync(
        IQueryable<PurchaseReceiptLine> baseQuery,
        CancellationToken cancellationToken)
    {
        var raw = await baseQuery
            .GroupBy(l => new
            {
                Day = l.PurchaseReceipt.ReceiptDate.Date,
                l.PurchaseReceipt.SupplierId,
                SupplierName = l.PurchaseReceipt.Supplier != null ? l.PurchaseReceipt.Supplier.Name : string.Empty,
                l.ProductId,
                l.ProductCode,
                l.ProductName
            })
            .Select(g => new
            {
                g.Key.Day,
                g.Key.SupplierId,
                g.Key.SupplierName,
                g.Key.ProductId,
                g.Key.ProductCode,
                g.Key.ProductName,
                Quantity = g.Sum(x => x.ReceivedQuantity),
                LineSubTotal = g.Sum(x => x.SubTotal.Amount),
                LineTotal = g.Sum(x => x.Total.Amount),
                VatAmount = g.Sum(x => x.VatAmount.Amount),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .OrderBy(x => x.Day).ThenBy(x => x.SupplierName).ThenBy(x => x.ProductName)
            .ToListAsync(cancellationToken);

        return raw.Select(r => new PurchasesJournalAggregatedRowDto
        {
            PeriodKey = r.Day.ToString("yyyy-MM-dd"),
            SupplierId = r.SupplierId,
            SupplierName = r.SupplierName,
            ProductId = r.ProductId,
            ProductCode = r.ProductCode,
            ProductName = r.ProductName,
            Quantity = r.Quantity,
            LineSubTotal = r.LineSubTotal,
            LineTotal = r.LineTotal,
            VatAmount = r.VatAmount,
            Currency = r.Currency
        }).ToList();
    }

    private static async Task<IReadOnlyList<PurchasesJournalAggregatedRowDto>> AggregateByMonthAsync(
        IQueryable<PurchaseReceiptLine> baseQuery,
        CancellationToken cancellationToken)
    {
        var raw = await baseQuery
            .GroupBy(l => new
            {
                l.PurchaseReceipt.ReceiptDate.Year,
                l.PurchaseReceipt.ReceiptDate.Month,
                l.PurchaseReceipt.SupplierId,
                SupplierName = l.PurchaseReceipt.Supplier != null ? l.PurchaseReceipt.Supplier.Name : string.Empty,
                l.ProductId,
                l.ProductCode,
                l.ProductName
            })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.Month,
                g.Key.SupplierId,
                g.Key.SupplierName,
                g.Key.ProductId,
                g.Key.ProductCode,
                g.Key.ProductName,
                Quantity = g.Sum(x => x.ReceivedQuantity),
                LineSubTotal = g.Sum(x => x.SubTotal.Amount),
                LineTotal = g.Sum(x => x.Total.Amount),
                VatAmount = g.Sum(x => x.VatAmount.Amount),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .OrderBy(x => x.Year).ThenBy(x => x.Month).ThenBy(x => x.SupplierName).ThenBy(x => x.ProductName)
            .ToListAsync(cancellationToken);

        return raw.Select(r => new PurchasesJournalAggregatedRowDto
        {
            PeriodKey = $"{r.Year:D4}-{r.Month:D2}",
            SupplierId = r.SupplierId,
            SupplierName = r.SupplierName,
            ProductId = r.ProductId,
            ProductCode = r.ProductCode,
            ProductName = r.ProductName,
            Quantity = r.Quantity,
            LineSubTotal = r.LineSubTotal,
            LineTotal = r.LineTotal,
            VatAmount = r.VatAmount,
            Currency = r.Currency
        }).ToList();
    }

    private static async Task<IReadOnlyList<PurchasesJournalAggregatedRowDto>> AggregateByYearAsync(
        IQueryable<PurchaseReceiptLine> baseQuery,
        CancellationToken cancellationToken)
    {
        var raw = await baseQuery
            .GroupBy(l => new
            {
                l.PurchaseReceipt.ReceiptDate.Year,
                l.PurchaseReceipt.SupplierId,
                SupplierName = l.PurchaseReceipt.Supplier != null ? l.PurchaseReceipt.Supplier.Name : string.Empty,
                l.ProductId,
                l.ProductCode,
                l.ProductName
            })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.SupplierId,
                g.Key.SupplierName,
                g.Key.ProductId,
                g.Key.ProductCode,
                g.Key.ProductName,
                Quantity = g.Sum(x => x.ReceivedQuantity),
                LineSubTotal = g.Sum(x => x.SubTotal.Amount),
                LineTotal = g.Sum(x => x.Total.Amount),
                VatAmount = g.Sum(x => x.VatAmount.Amount),
                Currency = g.Select(x => x.Total.Currency).First()
            })
            .OrderBy(x => x.Year).ThenBy(x => x.SupplierName).ThenBy(x => x.ProductName)
            .ToListAsync(cancellationToken);

        return raw.Select(r => new PurchasesJournalAggregatedRowDto
        {
            PeriodKey = r.Year.ToString("D4"),
            SupplierId = r.SupplierId,
            SupplierName = r.SupplierName,
            ProductId = r.ProductId,
            ProductCode = r.ProductCode,
            ProductName = r.ProductName,
            Quantity = r.Quantity,
            LineSubTotal = r.LineSubTotal,
            LineTotal = r.LineTotal,
            VatAmount = r.VatAmount,
            Currency = r.Currency
        }).ToList();
    }
}
