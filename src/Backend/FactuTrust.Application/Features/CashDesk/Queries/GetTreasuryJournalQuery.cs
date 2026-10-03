using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using MediatR;

namespace FactuTrust.Application.Features.CashDesk.Queries;

public sealed record GetTreasuryJournalQuery(
    DateTime From,
    DateTime To,
    PaymentMethod? Method,
    int Page = 1,
    int PageSize = TreasuryJournalConstants.DefaultPageSize) : IRequest<Result<TreasuryJournalResultDto>>;

public sealed class GetTreasuryJournalQueryHandler
    : IRequestHandler<GetTreasuryJournalQuery, Result<TreasuryJournalResultDto>>
{
    private readonly ICashOperationRepository _cashOperationRepository;
    private readonly IPaymentRepository _paymentRepository;
    private readonly ISupplierPaymentRepository _supplierPaymentRepository;

    public GetTreasuryJournalQueryHandler(
        ICashOperationRepository cashOperationRepository,
        IPaymentRepository paymentRepository,
        ISupplierPaymentRepository supplierPaymentRepository)
    {
        _cashOperationRepository = cashOperationRepository;
        _paymentRepository = paymentRepository;
        _supplierPaymentRepository = supplierPaymentRepository;
    }

    public async Task<Result<TreasuryJournalResultDto>> Handle(
        GetTreasuryJournalQuery request,
        CancellationToken cancellationToken)
    {
        var from = request.From.Date;
        var to = request.To.Date;
        var period = TreasuryJournalAssembler.Validate(from, to, request.Method);
        if (period.IsFailure)
            return Result.Failure<TreasuryJournalResultDto>(period.Error);

        var page = TreasuryJournalAssembler.ClampPage(request.Page);
        var pageSize = TreasuryJournalAssembler.ClampPageSize(request.PageSize);

        var totals = await _cashOperationRepository.GetNonCancelledJournalCategoryTotalsAsync(
            from, to, request.Method, cancellationToken);
        var (items, totalCount) = await _cashOperationRepository.GetNonCancelledJournalLinesAsync(
            from, to, request.Method, page, pageSize, cancellationToken);

        var lines = await CashOperationJournalLineMapper.MapAsync(
            items, _paymentRepository, _supplierPaymentRepository, cancellationToken);

        var (credits, debits, count) = TreasuryJournalAssembler.Summarize(totals);

        return Result.Success(new TreasuryJournalResultDto
        {
            From = from,
            To = to,
            Currency = Money.DefaultCurrency,
            TotalCredits = credits,
            TotalDebits = debits,
            Balance = credits - debits,
            OperationCount = count,
            Groups = TreasuryJournalAssembler.BuildGroups(totals),
            Lines = PagedResult<CashOperationListItemDto>.Create(lines, page, pageSize, totalCount)
        });
    }
}
