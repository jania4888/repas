using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Notifications;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Application.Features.BankDeposits.Commands;

public sealed record CreateBankDepositCommand(CreateBankDepositRequest Request) : IRequest<Result<BankDepositListItemDto>>;

public sealed class CreateBankDepositCommandHandler
    : IRequestHandler<CreateBankDepositCommand, Result<BankDepositListItemDto>>
{
    private readonly IBankDepositRepository _bankDepositRepository;
    private readonly IBankAccountRepository _bankAccountRepository;
    private readonly ICashOperationRepository _cashOperationRepository;
    private readonly ICashOperationNumberGenerator _cashOperationNumberGenerator;
    private readonly IBankDepositNumberGenerator _bankDepositNumberGenerator;
    private readonly IEnsureDefaultCompanyService _ensureDefaultCompanyService;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly IPublisher _publisher;

    public CreateBankDepositCommandHandler(
        IBankDepositRepository bankDepositRepository,
        IBankAccountRepository bankAccountRepository,
        ICashOperationRepository cashOperationRepository,
        ICashOperationNumberGenerator cashOperationNumberGenerator,
        IBankDepositNumberGenerator bankDepositNumberGenerator,
        IEnsureDefaultCompanyService ensureDefaultCompanyService,
        ICurrentUser currentUser,
        IAuditService auditService,
        IPublisher publisher)
    {
        _bankDepositRepository = bankDepositRepository;
        _bankAccountRepository = bankAccountRepository;
        _cashOperationRepository = cashOperationRepository;
        _cashOperationNumberGenerator = cashOperationNumberGenerator;
        _bankDepositNumberGenerator = bankDepositNumberGenerator;
        _ensureDefaultCompanyService = ensureDefaultCompanyService;
        _currentUser = currentUser;
        _auditService = auditService;
        _publisher = publisher;
    }

    public async Task<Result<BankDepositListItemDto>> Handle(
        CreateBankDepositCommand command,
        CancellationToken cancellationToken)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure<BankDepositListItemDto>(Error.Unauthorized("Tenant manquant"));

        var req = command.Request;
        var companyIdResult = await _ensureDefaultCompanyService.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (companyIdResult.IsFailure)
            return Result.Failure<BankDepositListItemDto>(companyIdResult.Error);

        var companyId = companyIdResult.Value;

        var bankAccount = await _bankAccountRepository.GetByIdAndCompanyAsync(req.BankAccountId, companyId, cancellationToken);
        if (bankAccount is null)
            return Result.Failure<BankDepositListItemDto>(Error.NotFound("BankAccount", req.BankAccountId));
        var identity = bankAccount.RequireCompleteIdentity();
        if (identity.IsFailure)
            return Result.Failure<BankDepositListItemDto>(identity.Error);

        var paymentMethod = req.DepositType.ToPaymentMethod();
        var balance = await _cashOperationRepository.GetNetBalanceForMethodUpToDateAsync(
            paymentMethod,
            req.DepositDate,
            cancellationToken);

        if (req.Amount > balance)
        {
            return Result.Failure<BankDepositListItemDto>(Error.Validation(
                "Amount",
                $"Le montant dépasse le solde disponible pour ce type ({balance:N3} TND)."));
        }

        var tenantId = _currentUser.TenantId.Value;
        var fiscalYear = req.DepositDate.Year;

        var cashNumber = await _cashOperationNumberGenerator.ReserveNextNumberAsync(
            tenantId,
            fiscalYear,
            CashOperationType.Debit,
            cancellationToken);

        var depositNumber = await _bankDepositNumberGenerator.ReserveNextNumberAsync(
            tenantId,
            fiscalYear,
            cancellationToken);

        var money = Money.Create(req.Amount, Money.DefaultCurrency);

        var label = $"Remise en banque - {bankAccount.BankName} - {depositNumber.Value}";

        var cashCreate = CashOperation.Create(
            number: cashNumber,
            operationType: CashOperationType.Debit,
            operationDate: req.DepositDate,
            method: paymentMethod,
            amount: money,
            label: label,
            category: CashExpenseCategory.BankDeposit,
            revenueCategory: null,
            reference: string.IsNullOrWhiteSpace(req.DepositSlipReference) ? null : req.DepositSlipReference.Trim(),
            notes: null);

        if (cashCreate.IsFailure)
            return Result.Failure<BankDepositListItemDto>(cashCreate.Error);

        var cashOperation = cashCreate.Value;

        var depositCreate = BankDeposit.Create(
            number: depositNumber,
            depositType: req.DepositType,
            depositDate: req.DepositDate,
            bankAccountId: req.BankAccountId,
            amount: money,
            quantity: req.Quantity,
            cashOperationId: cashOperation.Id,
            depositSlipReference: req.DepositSlipReference,
            notes: req.Notes);

        if (depositCreate.IsFailure)
            return Result.Failure<BankDepositListItemDto>(depositCreate.Error);

        var bankDeposit = depositCreate.Value;

        var userId = _currentUser.UserId?.ToString() ?? "system";
        cashOperation.SetAuditInfo(userId, isUpdate: false);
        bankDeposit.SetAuditInfo(userId, isUpdate: false);

        await _bankDepositRepository.AddWithCashOperationAsync(bankDeposit, cashOperation, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.CashOperation.Created,
            "CashOperation",
            cashOperation.Id,
            newValues: new
            {
                number = cashOperation.Number.Value,
                operationType = cashOperation.OperationType.ToString(),
                amount = cashOperation.Amount.Amount,
                operationDate = cashOperation.OperationDate,
                method = cashOperation.Method.ToString(),
                category = cashOperation.Category?.ToString(),
                label = cashOperation.Label,
                reference = cashOperation.Reference
            },
            cancellationToken: cancellationToken);

        await _auditService.LogAsync(
            AuditActions.BankDeposit.Created,
            "BankDeposit",
            bankDeposit.Id,
            newValues: new
            {
                number = bankDeposit.Number.Value,
                depositType = bankDeposit.DepositType.ToString(),
                amount = bankDeposit.Amount.Amount,
                depositDate = bankDeposit.DepositDate,
                bankAccountId = bankDeposit.BankAccountId,
                cashOperationId = bankDeposit.CashOperationId
            },
            cancellationToken: cancellationToken);

        await _publisher.Publish(new BankDepositCreatedForAccountingNotification(bankDeposit.Id), cancellationToken);

        return Result.Success(MapDto(bankDeposit, bankAccount, cashOperation));
    }

    private static BankDepositListItemDto MapDto(BankDeposit d, BankAccount account, CashOperation op) => new()
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
    };
}
