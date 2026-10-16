using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class PurchaseOrderRepository
{
    public async Task<HeaderLinesExportData<PurchaseOrderExportRow, PurchaseOrderLineExportRow>> ListForExportAsync(
        string? searchTerm,
        PurchaseOrderStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var documents = ApplyPurchaseOrderFilters(
            context.PurchaseOrders.AsNoTracking(), searchTerm, status, supplierId, fromDate, toDate);
        var documentCount = await documents.CountAsync(cancellationToken);
        var lineCount = await (
            from line in context.PurchaseOrderLines.AsNoTracking()
            join order in documents on line.PurchaseOrderId equals order.Id
            select line).CountAsync(cancellationToken);

        if (documentCount > documentMax || lineCount > lineMax)
            return HeaderLinesExportData<PurchaseOrderExportRow, PurchaseOrderLineExportRow>.Blocked(documentCount, lineCount);

        var headers = await documents
            .OrderByDescending(order => order.OrderDate)
            .ThenBy(order => order.Id)
            .Select(order => new PurchaseOrderExportRow(
                order.Id,
                EF.Property<string>(order.Number, "Value"),
                order.OrderDate,
                order.ExpectedDeliveryDate,
                order.Status,
                order.Supplier.Name,
                order.SubTotal.Amount,
                order.TotalVat.Amount,
                order.TotalAmount.Amount,
                order.Reference,
                order.Warehouse != null ? order.Warehouse.Name : null))
            .ToListAsync(cancellationToken);

        var lines = await (
            from line in context.PurchaseOrderLines.AsNoTracking()
            join order in documents on line.PurchaseOrderId equals order.Id
            orderby order.OrderDate descending, line.LineNumber
            select new PurchaseOrderLineExportRow(
                EF.Property<string>(order.Number, "Value"),
                line.LineNumber,
                line.ProductCode,
                line.ProductName,
                line.Quantity,
                line.ReceivedQuantity,
                line.InvoicedQuantity,
                line.Unit,
                line.UnitPrice.Amount,
                line.SubTotal.Amount,
                line.VatAmount.Amount,
                line.Total.Amount,
                line.Id)).ToListAsync(cancellationToken);

        return new HeaderLinesExportData<PurchaseOrderExportRow, PurchaseOrderLineExportRow>(
            documentCount, lineCount, headers, lines);
    }
}
