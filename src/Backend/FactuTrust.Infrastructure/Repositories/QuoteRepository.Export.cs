using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class QuoteRepository
{
    public async Task<HeaderLinesExportData<QuoteExportRow, QuoteLineExportRow>> ListForExportAsync(
        string? searchTerm,
        QuoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var documents = ApplyQuoteFilters(context.Quotes.AsNoTracking(), searchTerm, status, fromDate, toDate, clientId);
        var documentCount = await documents.CountAsync(cancellationToken);
        var lineCount = await (
            from line in context.QuoteLines.AsNoTracking()
            join quote in documents on line.QuoteId equals quote.Id
            select line).CountAsync(cancellationToken);

        if (documentCount > documentMax || lineCount > lineMax)
            return HeaderLinesExportData<QuoteExportRow, QuoteLineExportRow>.Blocked(documentCount, lineCount);

        var headers = await documents
            .OrderByDescending(quote => quote.IssueDate)
            .ThenBy(quote => quote.Id)
            .Select(quote => new QuoteExportRow(
                quote.Id,
                EF.Property<string>(quote.Number, "Value"),
                quote.IssueDate,
                quote.ExpiryDate,
                quote.Status,
                quote.Client.Name,
                quote.SubTotal.Amount,
                quote.TotalVat.Amount,
                quote.TotalAmount.Amount,
                quote.Reference,
                quote.Notes))
            .ToListAsync(cancellationToken);

        var lines = await (
            from line in context.QuoteLines.AsNoTracking()
            join quote in documents on line.QuoteId equals quote.Id
            orderby quote.IssueDate descending, line.LineNumber
            select new QuoteLineExportRow(
                EF.Property<string>(quote.Number, "Value"),
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
                line.Id)).ToListAsync(cancellationToken);

        return new HeaderLinesExportData<QuoteExportRow, QuoteLineExportRow>(documentCount, lineCount, headers, lines);
    }
}
