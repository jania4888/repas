using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class PurchaseReceiptRepository
{
    public async Task<HeaderLinesExportData<PurchaseReceiptExportRow, PurchaseReceiptLineExportRow>> ListForExportAsync(
        string? searchTerm,
        PurchaseReceiptStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        DateTime? fromDate,
        DateTime? toDate,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        // Mêmes filtres que la liste et la barre de totaux : le fichier contient exactement ce que l'écran compte.
        var documents = ApplyFilters(
            context.PurchaseReceipts.AsNoTracking(), searchTerm, status, supplierId, purchaseOrderId, fromDate, toDate);
        var documentCount = await documents.CountAsync(cancellationToken);
        var lineCount = await (
            from line in context.PurchaseReceiptLines.AsNoTracking()
            join receipt in documents on line.PurchaseReceiptId equals receipt.Id
            select line).CountAsync(cancellationToken);

        if (documentCount > documentMax || lineCount > lineMax)
            return HeaderLinesExportData<PurchaseReceiptExportRow, PurchaseReceiptLineExportRow>.Blocked(documentCount, lineCount);

        var headers = await documents
            .OrderByDescending(receipt => receipt.ReceiptDate)
            .ThenByDescending(receipt => receipt.CreatedAt)
            .ThenBy(receipt => receipt.Id)
            .Select(receipt => new PurchaseReceiptExportRow(
                receipt.Id,
                EF.Property<string>(receipt.Number, "Value"),
                receipt.ReceiptDate,
                receipt.Status,
                receipt.Supplier.Name,
                receipt.PurchaseOrderId == null
                    ? null
                    : context.PurchaseOrders.Where(order => order.Id == receipt.PurchaseOrderId)
                        .Select(order => EF.Property<string>(order.Number, "Value"))
                        .FirstOrDefault(),
                receipt.Warehouse.Name,
                receipt.SupplierReference,
                receipt.DeliveryNoteNumber,
                receipt.TransporterName,
                receipt.Lines.Count(),
                receipt.SubTotal.Amount,
                receipt.TotalVat.Amount,
                receipt.TotalAmount.Amount,
                receipt.ValidatedAt,
                receipt.CancelledAt,
                receipt.CancellationReason,
                receipt.Notes))
            .ToListAsync(cancellationToken);

        var lines = await (
            from line in context.PurchaseReceiptLines.AsNoTracking()
            join receipt in documents on line.PurchaseReceiptId equals receipt.Id
            orderby receipt.ReceiptDate descending, receipt.CreatedAt descending, receipt.Id, line.LineNumber
            select new PurchaseReceiptLineExportRow(
                EF.Property<string>(receipt.Number, "Value"),
                line.LineNumber,
                line.ProductCode,
                line.ProductName,
                line.Unit,
                line.OrderedQuantity,
                line.ReceivedQuantity,
                line.InvoicedQuantity,
                line.UnitPrice.Amount,
                line.DiscountPercent,
                line.VatRate,
                line.SubTotal.Amount,
                line.VatAmount.Amount,
                line.Total.Amount,
                line.Id)).ToListAsync(cancellationToken);

        return new HeaderLinesExportData<PurchaseReceiptExportRow, PurchaseReceiptLineExportRow>(
            documentCount, lineCount, headers, lines);
    }
}
