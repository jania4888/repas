using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for Quote aggregate.
/// </summary>
public interface IQuoteRepository : IRepository<Quote>
{
    /// <summary>
    /// Gets a quote with all its lines.
    /// </summary>
    Task<Quote?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets a quote by its number.
    /// </summary>
    Task<Quote?> GetByNumberAsync(string number, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all quotes for a client.
    /// </summary>
    Task<IReadOnlyList<Quote>> GetByClientIdAsync(Guid clientId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets quotes by status.
    /// </summary>
    Task<IReadOnlyList<Quote>> GetByStatusAsync(QuoteStatus status, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets quotes within a date range.
    /// </summary>
    Task<IReadOnlyList<Quote>> GetByDateRangeAsync(DateTime startDate, DateTime endDate, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets expired quotes.
    /// </summary>
    Task<IReadOnlyList<Quote>> GetExpiredQuotesAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets quotes that can be converted to invoices (accepted and not yet converted).
    /// </summary>
    Task<IReadOnlyList<Quote>> GetConvertibleQuotesAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets quote count for the current month.
    /// </summary>
    Task<int> GetMonthlyCountAsync(int year, int month, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Searches quotes by various criteria.
    /// </summary>
    Task<(IReadOnlyList<Quote> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        QuoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Aggregated totals over the ENTIRE filtered set (same filters as <see cref="SearchAsync"/>,
    /// without pagination). Powers the quote list "totals zone".
    /// </summary>
    Task<QuoteListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        QuoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        CancellationToken cancellationToken = default);

    Task<HeaderLinesExportData<QuoteExportRow, QuoteLineExportRow>> ListForExportAsync(
        string? searchTerm,
        QuoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId,
        int documentMax,
        int lineMax,
        CancellationToken cancellationToken = default);
}
