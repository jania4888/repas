using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class InvoiceRepository
{
    public async Task<HeaderLinesPaymentsExportData<InvoiceExportRow, InvoiceLineExportRow, InvoicePaymentExportRow>> ListForExportAsync(
        string? searchTerm,
        InvoiceStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        bool unpaidOnly,
        InvoiceType? type,
        bool realizedRevenueOnly,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var documents = ApplyInvoiceFilters(
            context.Invoices.AsNoTracking(),
            searchTerm,
            status,
            fromDate,
            toDate,
            clientId,
            unpaidOnly,
            type,
            realizedRevenueOnly);

        var documentCount = await documents.CountAsync(cancellationToken);
        var lineCount = await (
            from line in context.InvoiceLines.AsNoTracking()
            join invoice in documents on line.InvoiceId equals invoice.Id
            select line).CountAsync(cancellationToken);
        var paymentCount = await (
            from payment in context.Payments.AsNoTracking()
            join invoice in documents on payment.InvoiceId equals invoice.Id
            select payment).CountAsync(cancellationToken);

        if (documentCount > documentMax || lineCount > lineMax || paymentCount > lineMax)
            return HeaderLinesPaymentsExportData<InvoiceExportRow, InvoiceLineExportRow, InvoicePaymentExportRow>
                .Blocked(documentCount, lineCount, paymentCount);

        var headers = await documents
            .OrderByDescending(invoice => invoice.IssueDate)
            .ThenBy(invoice => invoice.Id)
            .Select(invoice => new InvoiceExportRow(
                invoice.Id,
                EF.Property<string>(invoice.Number, "Value"),
                invoice.Type,
                invoice.IssueDate,
                invoice.DueDate,
                invoice.Status,
                invoice.Client.Name,
                invoice.SubTotal.Amount,
                invoice.TotalVat.Amount,
                invoice.TotalAmount.Amount,
                context.Payments.Where(payment => payment.InvoiceId == invoice.Id && !payment.IsRefunded)
                    .Sum(payment => (decimal?)payment.Amount.Amount) ?? 0m,
                invoice.Reference,
                invoice.Notes,
                invoice.PaymentTerms,
                invoice.Warehouse != null ? invoice.Warehouse.Name : null,
                invoice.LinkedInvoiceId == null
                    ? null
                    : context.Invoices.Where(linked => linked.Id == invoice.LinkedInvoiceId)
                        .Select(linked => EF.Property<string>(linked.Number, "Value"))
                        .FirstOrDefault(),
                invoice.PaidAt))
            .ToListAsync(cancellationToken);

        var lines = await (
            from line in context.InvoiceLines.AsNoTracking()
            join invoice in documents on line.InvoiceId equals invoice.Id
            orderby invoice.IssueDate descending, line.LineNumber
            select new InvoiceLineExportRow(
                EF.Property<string>(invoice.Number, "Value"),
                line.LineNumber,
                line.ProductCode,
                line.ProductName,
                line.Quantity,
                line.Unit,
                line.UnitPrice.Amount,
                line.VatRate,
                line.DiscountPercent,
                line.SubTotal.Amount,
                line.VatAmount.Amount,
                line.Total.Amount,
                line.IsFodecApplicable,
                line.Id)).ToListAsync(cancellationToken);

        var payments = await (
            from payment in context.Payments.AsNoTracking()
            join invoice in documents on payment.InvoiceId equals invoice.Id
            orderby payment.PaymentDate descending
            select new InvoicePaymentExportRow(
                EF.Property<string>(invoice.Number, "Value"),
                payment.PaymentDate,
                payment.Amount.Amount,
                payment.Method,
                payment.Reference,
                payment.IsRefunded,
                payment.Id)).ToListAsync(cancellationToken);

        return new HeaderLinesPaymentsExportData<InvoiceExportRow, InvoiceLineExportRow, InvoicePaymentExportRow>(
            documentCount, lineCount, paymentCount, headers, lines, payments);
    }
}
