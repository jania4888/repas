using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Invoices.Queries;

/// <summary>
/// Query to get paginated invoices with optional filtering.
/// </summary>
public sealed record GetInvoicesQuery(
    string? SearchTerm = null,
    InvoiceStatus? Status = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    Guid? ClientId = null,
    int Page = 1,
    int PageSize = 20,
    bool UnpaidOnly = false,
    InvoiceType? Type = null,
    // When true, restricts the list to realized revenue documents (Paid + Validated).
    bool RealizedRevenueOnly = false) : IRequest<PagedResult<InvoiceListDto>>;

/// <summary>
/// Handler for GetInvoicesQuery.
/// </summary>
public sealed class GetInvoicesQueryHandler : IRequestHandler<GetInvoicesQuery, PagedResult<InvoiceListDto>>
{
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IPaymentRepository _paymentRepository;

    public GetInvoicesQueryHandler(IInvoiceRepository invoiceRepository, IPaymentRepository paymentRepository)
    {
        _invoiceRepository = invoiceRepository;
        _paymentRepository = paymentRepository;
    }

    public async Task<PagedResult<InvoiceListDto>> Handle(GetInvoicesQuery request, CancellationToken cancellationToken)
    {
        var (invoices, totalCount) = await _invoiceRepository.SearchAsync(
            request.SearchTerm,
            request.Status,
            request.FromDate,
            request.ToDate,
            request.ClientId,
            request.Page,
            request.PageSize,
            request.UnpaidOnly,
            request.Type,
            request.RealizedRevenueOnly,
            cancellationToken);

        var totalPaidByInvoice = await _paymentRepository.GetTotalPaidByInvoiceIdsAsync(
            invoices.Select(i => i.Id),
            cancellationToken);

        var dtos = invoices.Select(i =>
        {
            var totalAmount = i.TotalAmount.Amount;
            var totalPaid = totalPaidByInvoice.GetValueOrDefault(i.Id, 0);
            // Remaining magnitude — UI shows "amount still due/to refund" as a positive number.
            var remainingAmount = Math.Max(0m, Math.Abs(totalAmount) - totalPaid);

            return new InvoiceListDto
            {
                Id = i.Id,
                Number = i.Number.Value,
                Type = i.Type == InvoiceType.CreditNote ? "CREDIT_NOTE" : "INVOICE",
                IsCreditNote = i.IsCreditNote,
                IssueDate = i.IssueDate,
                DueDate = i.DueDate,
                Status = i.Status.ToDisplayString(),
                StatusCssClass = i.Status.ToCssClass(),
                ClientName = i.Client.Name,
                TotalAmount = totalAmount,
                SubTotal = i.SubTotal.Amount,
                Currency = i.TotalAmount.Currency,
                IsOverdue = i.DueDate.HasValue && i.DueDate.Value < DateTime.UtcNow.Date &&
                           i.Status != InvoiceStatus.Paid && i.Status != InvoiceStatus.Cancelled,
                PaidAt = i.PaidAt,
                TotalPaid = totalPaid,
                RemainingAmount = remainingAmount,
                WarehouseId = i.WarehouseId,
                WarehouseName = i.Warehouse?.Name
            };
        }).ToList();

        return PagedResult<InvoiceListDto>.Create(dtos, request.Page, request.PageSize, totalCount);
    }
}
