using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Invoices.Queries;

/// <summary>
/// Query to get aggregated totals for the invoice list over the ENTIRE filtered set.
/// Mirrors <see cref="GetInvoicesQuery"/> filters (without pagination) so the UI "totals zone"
/// reflects exactly the active filters, not just the current page.
/// </summary>
public sealed record GetInvoicesSummaryQuery(
    string? SearchTerm = null,
    InvoiceStatus? Status = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    Guid? ClientId = null,
    bool UnpaidOnly = false,
    InvoiceType? Type = null,
    // When true, restricts the summary to realized revenue documents (Paid + Validated).
    bool RealizedRevenueOnly = false) : IRequest<InvoiceListSummaryDto>;

/// <summary>
/// Handler for GetInvoicesSummaryQuery.
/// </summary>
public sealed class GetInvoicesSummaryQueryHandler
    : IRequestHandler<GetInvoicesSummaryQuery, InvoiceListSummaryDto>
{
    private readonly IInvoiceRepository _invoiceRepository;

    public GetInvoicesSummaryQueryHandler(IInvoiceRepository invoiceRepository)
    {
        _invoiceRepository = invoiceRepository;
    }

    public Task<InvoiceListSummaryDto> Handle(GetInvoicesSummaryQuery request, CancellationToken cancellationToken)
        => _invoiceRepository.GetSummaryAsync(
            request.SearchTerm,
            request.Status,
            request.FromDate,
            request.ToDate,
            request.ClientId,
            request.UnpaidOnly,
            request.Type,
            request.RealizedRevenueOnly,
            cancellationToken);
}
