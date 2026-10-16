using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for DeliveryNote aggregate.
/// </summary>
public interface IDeliveryNoteRepository : IRepository<DeliveryNote>
{
    /// <summary>
    /// Gets a delivery note by ID with all lines loaded.
    /// </summary>
    Task<DeliveryNote?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets a delivery note by ID with full details (lines, client, products, invoice).
    /// </summary>
    Task<DeliveryNote?> GetByIdWithDetailsAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets a paginated list of delivery notes with optional filtering.
    /// </summary>
    Task<(IReadOnlyList<DeliveryNote> Items, int TotalCount)> GetPagedAsync(
        int page,
        int pageSize,
        Guid? clientId = null,
        DeliveryNoteStatus? status = null,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        string? search = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Aggregated totals over the ENTIRE filtered set (same filters as <see cref="GetPagedAsync"/>,
    /// without pagination). Powers the delivery note list "totals zone".
    /// </summary>
    Task<DeliveryNoteListSummaryDto> GetSummaryAsync(
        Guid? clientId = null,
        DeliveryNoteStatus? status = null,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        string? search = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets delivery notes for report export (by date range and optional client).
    /// </summary>
    Task<IReadOnlyList<DeliveryNote>> GetForReportAsync(
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets all uninvoiced delivery notes for a client (for grouping into single invoice).
    /// </summary>
    Task<IReadOnlyList<DeliveryNote>> GetUninvoicedByClientAsync(
        Guid clientId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Delivered / partially delivered notes that still have invoiceable quantity (for return notes).
    /// </summary>
    Task<IReadOnlyList<DeliveryNote>> GetEligibleForReturnAsync(
        Guid? clientId = null,
        string? search = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies confirmed return quantities on a tracked BL instance so <c>Version</c>
    /// concurrency uses the store token, not a detached incremented value.
    /// </summary>
    Task<Result> ApplyReturnsAsync(
        Guid deliveryNoteId,
        IReadOnlyList<(Guid LineId, decimal Quantity)> returns,
        string updatedBy,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Generates the next delivery note number for the specified year.
    /// </summary>
    [Obsolete("Use IDocumentNumberService instead.")]
    Task<DeliveryNoteNumber> GetNextNumberAsync(int year, CancellationToken cancellationToken = default);

    Task<HeaderLinesExportData<DeliveryNoteExportRow, DeliveryNoteLineExportRow>> ListForExportAsync(
        string? searchTerm,
        DeliveryNoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default);
}
