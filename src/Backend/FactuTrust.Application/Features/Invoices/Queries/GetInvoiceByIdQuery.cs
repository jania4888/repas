using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Invoices.Queries;

/// <summary>
/// Query to get invoice details by ID.
/// </summary>
public sealed record GetInvoiceByIdQuery(Guid Id) : IRequest<Result<InvoiceDetailDto>>;

/// <summary>
/// Handler for GetInvoiceByIdQuery.
/// </summary>
public sealed class GetInvoiceByIdQueryHandler : IRequestHandler<GetInvoiceByIdQuery, Result<InvoiceDetailDto>>
{
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IPaymentRepository _paymentRepository;

    public GetInvoiceByIdQueryHandler(IInvoiceRepository invoiceRepository, IPaymentRepository paymentRepository)
    {
        _invoiceRepository = invoiceRepository;
        _paymentRepository = paymentRepository;
    }

    public async Task<Result<InvoiceDetailDto>> Handle(GetInvoiceByIdQuery request, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceRepository.GetByIdWithLinesAsync(request.Id, cancellationToken);

        if (invoice is null)
            return Result.Failure<InvoiceDetailDto>(Error.NotFound("Facture", request.Id));

        var payments = await _paymentRepository.GetByInvoiceIdAsync(request.Id, cancellationToken);
        var activePayments = payments.Where(p => !p.IsRefunded).ToList();
        var totalPaid = activePayments.Sum(p => p.GetTotalAppliedTowardInvoice());
        var totalClientWithholding = activePayments.Sum(p => p.ClientWithholdingAmount ?? 0m);
        // Remaining magnitude — UI always shows a positive "amount still due/to refund".
        var remainingAmount = Math.Max(0m, Math.Abs(invoice.TotalAmount.Amount) - totalPaid);

        // Numéro de la facture rectifiée (avoirs uniquement) — affiché au détail et imprimé.
        string? linkedInvoiceNumber = null;
        if (invoice.LinkedInvoiceId.HasValue)
        {
            var linked = await _invoiceRepository.GetByIdAsync(invoice.LinkedInvoiceId.Value, cancellationToken);
            linkedInvoiceNumber = linked?.Number.Value;
        }

        var vatBreakdown = invoice.GetVatBreakdown();

        var dto = new InvoiceDetailDto
        {
            Id = invoice.Id,
            Number = invoice.Number.Value,
            Type = invoice.Type == InvoiceType.CreditNote ? "CREDIT_NOTE" : "INVOICE",
            IsCreditNote = invoice.IsCreditNote,
            IssueDate = invoice.IssueDate,
            DueDate = invoice.DueDate,
            Status = invoice.Status,
            StatusDisplay = invoice.Status.ToDisplayString(),
            ClientId = invoice.ClientId,
            Client = new ClientSummaryDto
            {
                Id = invoice.Client.Id,
                Name = invoice.Client.Name,
                Nif = invoice.Client.NIF?.Value,
                Email = invoice.Client.Email?.Value,
                Address = invoice.Client.Address.ToSingleLine()
            },
            WarehouseId = invoice.WarehouseId,
            WarehouseName = invoice.Warehouse?.Name,
            LinkedInvoiceId = invoice.LinkedInvoiceId,
            LinkedInvoiceNumber = linkedInvoiceNumber,
            Reference = invoice.Reference,
            Notes = invoice.Notes,
            PaymentTerms = invoice.PaymentTerms,
            Lines = invoice.Lines.Select(l => new InvoiceLineDto
            {
                Id = l.Id,
                LineNumber = l.LineNumber,
                ProductId = l.ProductId,
                ProductCode = l.ProductCode,
                ProductName = l.ProductName,
                ProductDescription = l.ProductDescription,
                Quantity = l.Quantity,
                Unit = l.Unit,
                UnitPrice = l.UnitPrice.Amount,
                VatRatePercent = (int)l.VatRate,
                DiscountPercent = l.DiscountPercent,
                AppliedPromotionId = l.AppliedPromotionId,
                AppliedPromotionName = l.AppliedPromotionName,
                DiscountAmount = l.DiscountAmount.Amount,
                AllocatedGlobalDiscount = l.AllocatedGlobalDiscount.Amount,
                SubTotal = l.SubTotal.Amount,
                IsFodecApplicable = l.IsFodecApplicable,
                FodecAmount = l.FodecAmount.Amount,
                VatAmount = l.VatAmount.Amount,
                Total = l.Total.Amount
            }).ToList(),
            SubTotal = invoice.SubTotal.Amount,
            GlobalDiscountPercent = invoice.GlobalDiscountPercent,
            GlobalDiscountAmount = invoice.GlobalDiscountAmount.Amount,
            FodecAmount = invoice.FodecAmount.Amount,
            TotalVat = invoice.TotalVat.Amount,
            FiscalStampAmount = invoice.FiscalStampAmount.Amount,
            TotalAmount = invoice.TotalAmount.Amount,
            Currency = invoice.TotalAmount.Currency,
            VatBreakdown = vatBreakdown.Select(kv => new VatBreakdownDto
            {
                Rate = (int)kv.Key,
                RateDisplay = kv.Key.ToDisplayString(),
                BaseAmount = invoice.Lines
                    .Where(l => l.VatRate == kv.Key)
                    .Sum(l => l.SubTotal.Amount + l.FodecAmount.Amount),
                VatAmount = kv.Value.Amount
            }).ToList(),
            SignatureHash = invoice.SignatureHash,
            SignedAt = invoice.SignedAt,
            SentAt = invoice.SentAt,
            PaidAt = invoice.PaidAt,
            Payments = payments.Select(p => new PaymentDto
            {
                Id = p.Id,
                Amount = p.Amount.Amount,
                Currency = p.Amount.Currency,
                PaymentDate = p.PaymentDate,
                Method = (int)p.Method,
                MethodDisplay = p.Method.ToDisplayString(),
                Reference = p.Reference,
                Notes = p.Notes,
                IsRefunded = p.IsRefunded,
                CreatedAt = p.CreatedAt,
                ClientWithholdingAmount = p.ClientWithholdingAmount,
                TotalAppliedTowardInvoice = p.GetTotalAppliedTowardInvoice(),
                EffetDueDate = p.EffetDueDate,
                EffetStatus = (int?)p.EffetStatus,
                EffetStatusDisplay = p.EffetStatus?.ToDisplayString()
            }).ToList(),
            TotalPaid = totalPaid,
            RemainingAmount = remainingAmount,
            TotalClientWithholding = totalClientWithholding,
            CreatedAt = invoice.CreatedAt,
            UpdatedAt = invoice.UpdatedAt
        };

        return Result.Success(dto);
    }
}
