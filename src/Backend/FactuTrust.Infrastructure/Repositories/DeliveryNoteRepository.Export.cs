using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class DeliveryNoteRepository
{
    public async Task<HeaderLinesExportData<DeliveryNoteExportRow, DeliveryNoteLineExportRow>> ListForExportAsync(
        string? searchTerm,
        DeliveryNoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var documents = ApplyDeliveryNoteFilters(
            context.DeliveryNotes.AsNoTracking(), clientId, status, fromDate, toDate, searchTerm);
        var documentCount = await documents.CountAsync(cancellationToken);
        var lineCount = await (
            from line in context.DeliveryNoteLines.AsNoTracking()
            join note in documents on line.DeliveryNoteId equals note.Id
            select line).CountAsync(cancellationToken);

        if (documentCount > documentMax || lineCount > lineMax)
            return HeaderLinesExportData<DeliveryNoteExportRow, DeliveryNoteLineExportRow>.Blocked(documentCount, lineCount);

        var headers = await documents
            .OrderByDescending(note => note.IssueDate)
            .ThenBy(note => note.Id)
            .Select(note => new DeliveryNoteExportRow(
                note.Id,
                EF.Property<string>(note.Number, "Value"),
                note.IssueDate,
                note.DeliveryDate,
                note.Status,
                note.Client.Name,
                note.DeliveryAddress,
                note.DeliveryCity,
                note.Warehouse != null ? note.Warehouse.Name : null,
                note.Reference))
            .ToListAsync(cancellationToken);

        var lines = await (
            from line in context.DeliveryNoteLines.AsNoTracking()
            join note in documents on line.DeliveryNoteId equals note.Id
            orderby note.IssueDate descending, line.LineNumber
            select new DeliveryNoteLineExportRow(
                EF.Property<string>(note.Number, "Value"),
                line.LineNumber,
                line.ProductCode,
                line.Designation,
                line.OrderedQuantity,
                line.DeliveredQuantity,
                line.RejectedQuantity,
                line.ReturnedQuantity,
                line.Unit,
                line.UnitPriceHT,
                line.VatRatePercent,
                line.DiscountPercent,
                line.IsFodecApplicable,
                line.Id)).ToListAsync(cancellationToken);

        return new HeaderLinesExportData<DeliveryNoteExportRow, DeliveryNoteLineExportRow>(
            documentCount, lineCount, headers, lines);
    }
}
