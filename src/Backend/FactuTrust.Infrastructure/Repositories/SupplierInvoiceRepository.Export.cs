using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class SupplierInvoiceRepository
{
    public async Task<HeaderLinesPaymentsExportData<SupplierInvoiceExportRow, SupplierInvoiceLineExportRow, SupplierPaymentExportRow>> ListForExportAsync(
        string? searchTerm,
        SupplierInvoiceStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        bool unpaidOnly,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var documents = ApplySupplierInvoiceFilters(
            context.SupplierInvoices.AsNoTracking(),
            searchTerm,
            status,
            supplierId,
            purchaseOrderId: null,
            purchaseReceiptId: null,
            fromDate,
            toDate,
            unpaidOnly);

        var documentCount = await documents.CountAsync(cancellationToken);
        var lineCount = await (
            from line in context.SupplierInvoiceLines.AsNoTracking()
            join invoice in documents on line.SupplierInvoiceId equals invoice.Id
            select line).CountAsync(cancellationToken);
        var paymentCount = await (
            from payment in context.SupplierPayments.AsNoTracking()
            join invoice in documents on payment.SupplierInvoiceId equals invoice.Id
            select payment).CountAsync(cancellationToken);

        if (documentCount > documentMax || lineCount > lineMax || paymentCount > lineMax)
            return HeaderLinesPaymentsExportData<SupplierInvoiceExportRow, SupplierInvoiceLineExportRow, SupplierPaymentExportRow>
                .Blocked(documentCount, lineCount, paymentCount);

        var headers = await documents
            .OrderByDescending(invoice => invoice.InvoiceDate)
            .ThenBy(invoice => invoice.Id)
            .Select(invoice => new SupplierInvoiceExportRow(
                invoice.Id,
                invoice.InvoiceNumber,
                invoice.InvoiceDate,
                invoice.DueDate,
                invoice.Status,
                invoice.Supplier.Name,
                invoice.SubTotal.Amount,
                invoice.TotalVat.Amount,
                invoice.TotalAmount.Amount,
                context.SupplierPayments.Where(payment => payment.SupplierInvoiceId == invoice.Id)
                    .Sum(payment => (decimal?)payment.Amount.Amount) ?? 0m,
                invoice.ExternalReference,
                invoice.PurchaseOrderId == null
                    ? null
                    : context.PurchaseOrders.Where(order => order.Id == invoice.PurchaseOrderId)
                        .Select(order => EF.Property<string>(order.Number, "Value"))
                        .FirstOrDefault(),
                invoice.Warehouse != null ? invoice.Warehouse.Name : null,
                invoice.WithholdingRate,
                invoice.WithholdingAmount,
                invoice.PaidAt))
            .ToListAsync(cancellationToken);

        var lines = await (
            from line in context.SupplierInvoiceLines.AsNoTracking()
            join invoice in documents on line.SupplierInvoiceId equals invoice.Id
            orderby invoice.InvoiceDate descending, line.LineNumber
            select new SupplierInvoiceLineExportRow(
                invoice.InvoiceNumber,
                line.LineNumber,
                line.ProductCode,
                line.ProductName,
                line.Quantity,
                line.Unit,
                line.UnitPrice.Amount,
                line.VatRate,
                line.SubTotal.Amount,
                line.VatAmount.Amount,
                line.Total.Amount,
                line.Id)).ToListAsync(cancellationToken);

        var payments = await (
            from payment in context.SupplierPayments.AsNoTracking()
            join invoice in documents on payment.SupplierInvoiceId equals invoice.Id
            orderby payment.PaymentDate descending
            select new SupplierPaymentExportRow(
                invoice.InvoiceNumber,
                payment.PaymentDate,
                payment.Amount.Amount,
                payment.Method,
                payment.Reference,
                payment.Id)).ToListAsync(cancellationToken);

        return new HeaderLinesPaymentsExportData<SupplierInvoiceExportRow, SupplierInvoiceLineExportRow, SupplierPaymentExportRow>(
            documentCount, lineCount, paymentCount, headers, lines, payments);
    }
}
