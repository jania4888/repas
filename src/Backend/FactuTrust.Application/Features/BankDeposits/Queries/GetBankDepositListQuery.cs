using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.BankDeposits.Queries;

public sealed record GetBankDepositListQuery(
    int Year,
    int Month,
    int Page = 1,
    int PageSize = 20) : IRequest<PagedResult<BankDepositListItemDto>>;

public sealed class GetBankDepositListQueryHandler
    : IRequestHandler<GetBankDepositListQuery, PagedResult<BankDepositListItemDto>>
{
    private readonly IBankDepositRepository _bankDepositRepository;
    private readonly IBankAccountRepository _bankAccountRepository;
    private readonly ICashOperationRepository _cashOperationRepository;

    public GetBankDepositListQueryHandler(
        IBankDepositRepository bankDepositRepository,
        IBankAccountRepository bankAccountRepository,
        ICashOperationRepository cashOperationRepository)
    {
        _bankDepositRepository = bankDepositRepository;
        _bankAccountRepository = bankAccountRepository;
        _cashOperationRepository = cashOperationRepository;
    }

    public async Task<PagedResult<BankDepositListItemDto>> Handle(
        GetBankDepositListQuery request,
        CancellationToken cancellationToken)
    {
        var from = new DateTime(request.Year, request.Month, 1);
        var to = from.AddMonths(1).AddDays(-1);

        var (items, totalCount) = await _bankDepositRepository.GetNonCancelledByDateRangeAsync(
            from, to, request.Page, request.PageSize, cancellationToken);

        var dtos = new List<BankDepositListItemDto>();
        foreach (var d in items)
        {
            var account = await _bankAccountRepository.GetByIdAsync(d.BankAccountId, cancellationToken);
            var op = await _cashOperationRepository.GetByIdAsync(d.CashOperationId, cancellationToken);
            if (account is null || op is null)
                continue;

            dtos.Add(new BankDepositListItemDto
            {
                Id = d.Id,
                Number = d.Number.Value,
                DepositType = d.DepositType,
                DepositTypeDisplay = d.DepositType.ToDisplayString(),
                DepositDate = d.DepositDate,
                BankAccountId = d.BankAccountId,
                BankName = account.BankName,
                AccountDesignation = account.Designation,
                BankCode = account.BankCode,
                Iban = account.Iban ?? string.Empty,
                Amount = d.Amount.Amount,
                Currency = d.Amount.Currency,
                Quantity = d.Quantity,
                DepositSlipReference = d.DepositSlipReference,
                Notes = d.Notes,
                Status = d.Status,
                CashOperationNumber = op.Number.Value
            });
        }

        return PagedResult<BankDepositListItemDto>.Create(
            dtos,
            request.Page,
            request.PageSize,
            totalCount);
    }
}
