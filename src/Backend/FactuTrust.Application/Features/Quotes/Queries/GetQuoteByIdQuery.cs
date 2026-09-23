using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Quotes.Queries;

/// <summary>
/// Query to get quote details by ID.
/// </summary>
public sealed record GetQuoteByIdQuery(Guid Id) : IRequest<Result<QuoteDetailDto>>;

/// <summary>
/// Handler for GetQuoteByIdQuery.
/// </summary>
public sealed class GetQuoteByIdQueryHandler : IRequestHandler<GetQuoteByIdQuery, Result<QuoteDetailDto>>
{
    private readonly IQuoteRepository _quoteRepository;

    public GetQuoteByIdQueryHandler(IQuoteRepository quoteRepository)
    {
        _quoteRepository = quoteRepository;
    }

    public async Task<Result<QuoteDetailDto>> Handle(GetQuoteByIdQuery request, CancellationToken cancellationToken)
    {
        var quote = await _quoteRepository.GetByIdWithLinesAsync(request.Id, cancellationToken);

        if (quote is null)
            return Result.Failure<QuoteDetailDto>(Error.NotFound("Devis", request.Id));

        var vatBreakdown = quote.GetVatBreakdown();

        var dto = new QuoteDetailDto
        {
            Id = quote.Id,
            Number = quote.Number.Value,
            IssueDate = quote.IssueDate,
            ExpiryDate = quote.ExpiryDate,
            Status = quote.Status,
            StatusDisplay = quote.Status.ToDisplayString(),
            ClientId = quote.ClientId,
            Client = new ClientSummaryDto
            {
                Id = quote.Client.Id,
                Name = quote.Client.Name,
                Nif = quote.Client.NIF?.Value,
                Email = quote.Client.Email?.Value,
                Address = quote.Client.Address.ToSingleLine()
            },
            Reference = quote.Reference,
            Notes = quote.Notes,
            TermsAndConditions = quote.TermsAndConditions,
            Lines = quote.Lines.Select(l => new QuoteLineDto
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
                SubTotal = l.SubTotal.Amount,
                IsFodecApplicable = l.IsFodecApplicable,
                FodecRatePercent = l.FodecRatePercent,
                FodecAmount = l.FodecAmount.Amount,
                VatAmount = l.VatAmount.Amount,
                Total = l.Total.Amount
            }).ToList(),
            SubTotal = quote.SubTotal.Amount,
            FodecAmount = quote.FodecAmount.Amount,
            TotalVat = quote.TotalVat.Amount,
            FiscalStampAmount = quote.FiscalStampAmount.Amount,
            TotalAmount = quote.TotalAmount.Amount,
            Currency = quote.TotalAmount.Currency,
            VatBreakdown = vatBreakdown.Select(kv => new VatBreakdownDto
            {
                Rate = (int)kv.Key,
                RateDisplay = kv.Key.ToDisplayString(),
                BaseAmount = quote.Lines
                    .Where(l => l.VatRate == kv.Key)
                    .Sum(l => l.SubTotal.Amount),
                VatAmount = kv.Value.Amount
            }).ToList(),
            SentAt = quote.SentAt,
            AcceptedAt = quote.AcceptedAt,
            RejectedAt = quote.RejectedAt,
            RejectionReason = quote.RejectionReason,
            CancelledAt = quote.CancelledAt,
            CancellationReason = quote.CancellationReason,
            ConvertedInvoiceId = quote.ConvertedInvoiceId,
            ConvertedSalesOrderId = quote.ConvertedSalesOrderId,
            ConvertedAt = quote.ConvertedAt,
            CreatedAt = quote.CreatedAt,
            UpdatedAt = quote.UpdatedAt
        };

        return Result.Success(dto);
    }
}
