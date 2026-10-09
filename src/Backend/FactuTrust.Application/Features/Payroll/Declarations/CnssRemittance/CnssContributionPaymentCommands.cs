using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Payroll.Declarations.CnssRemittance;

public sealed record RecordCnssContributionPaymentCommand(RecordCnssContributionPaymentRequest Request)
    : IRequest<Result<Guid>>;

public sealed class RecordCnssContributionPaymentCommandValidator
    : AbstractValidator<RecordCnssContributionPaymentCommand>
{
    public RecordCnssContributionPaymentCommandValidator()
    {
        RuleFor(x => x.Request.Year).InclusiveBetween(2000, 2100);
        RuleFor(x => x.Request.Month).InclusiveBetween(1, 12);
        RuleFor(x => x.Request.PaymentDate).NotEmpty();
        RuleFor(x => x.Request.Method).IsInEnum();
        RuleFor(x => x.Request.Method).NotEqual(PaymentMethod.Traite);
        RuleFor(x => x.Request.BankAccountId)
            .NotEmpty()
            .When(x => x.Request.Method != PaymentMethod.Cash);
    }
}

public sealed class RecordCnssContributionPaymentCommandHandler
    : IRequestHandler<RecordCnssContributionPaymentCommand, Result<Guid>>
{
    private readonly CnssRemittanceDataLoader _loader;
    private readonly IPayrollRunRepository _runs;
    private readonly ICnssContributionPaymentRepository _payments;
    private readonly IBankAccountRepository _bankAccounts;
    private readonly IAccountingService _accountingService;
    private readonly ITenantUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public RecordCnssContributionPaymentCommandHandler(
        CnssRemittanceDataLoader loader,
        IPayrollRunRepository runs,
        ICnssContributionPaymentRepository payments,
        IBankAccountRepository bankAccounts,
        IAccountingService accountingService,
        ITenantUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _loader = loader;
        _runs = runs;
        _payments = payments;
        _bankAccounts = bankAccounts;
        _accountingService = accountingService;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public Task<Result<Guid>> Handle(RecordCnssContributionPaymentCommand request, CancellationToken cancellationToken)
    {
        var guard = CnssRemittanceFeatureGuard.EnsureEnabled(_settings);
        if (guard.IsFailure)
            return Task.FromResult(Result.Failure<Guid>(guard.Error));

        return _unitOfWork.ExecuteAsync(async ct =>
        {
            var req = request.Request;
            var batchResult = await _loader.LoadBatchAsync(req.Year, req.Month, ct);
            if (batchResult.IsFailure)
                return Result.Failure<Guid>(batchResult.Error);

            var batch = batchResult.Value;
            if (!batch.IsEligible || !batch.PayrollRunId.HasValue)
            {
                return Result.Failure<Guid>(Error.Validation(
                    "Period",
                    "Le cycle de paie doit être validé ou clôturé pour enregistrer le versement CNSS."));
            }

            if (string.IsNullOrWhiteSpace(batch.EmployerCnssNumber))
            {
                return Result.Failure<Guid>(Error.Validation(
                    "CnssEmployerNumber",
                    "Le matricule employeur CNSS est obligatoire."));
            }

            if (await _payments.HasActivePaymentForPeriodAsync(req.Year, req.Month, ct))
            {
                return Result.Failure<Guid>(Error.Validation(
                    "Payment",
                    "Un versement CNSS actif existe déjà pour cette période."));
            }

            var run = await _runs.GetByIdWithPayslipsAsync(batch.PayrollRunId.Value, ct);
            if (run is null)
                return Result.Failure<Guid>(Error.NotFound("PayrollRun", batch.PayrollRunId.Value));

            BankAccount? bankAccount = null;
            if (req.Method != PaymentMethod.Cash)
            {
                if (!req.BankAccountId.HasValue)
                {
                    return Result.Failure<Guid>(Error.Validation(
                        "BankAccountId",
                        "Le compte bancaire débiteur est obligatoire."));
                }

                bankAccount = await _bankAccounts.GetByIdAsync(req.BankAccountId.Value, ct);
                if (bankAccount is null)
                    return Result.Failure<Guid>(Error.NotFound("BankAccount", req.BankAccountId.Value));
                var identity = bankAccount.RequireCompleteIdentity();
                if (identity.IsFailure)
                    return Result.Failure<Guid>(identity.Error);
            }

            var paymentResult = CnssContributionPayment.Create(
                run,
                batch.TotalCnssEmployee,
                batch.TotalCnssEmployer,
                batch.TotalWorkAccident,
                batch.TotalDue,
                batch.TotalDue,
                req.PaymentDate,
                req.Method,
                req.BankAccountId,
                req.Reference,
                req.Notes);

            if (paymentResult.IsFailure)
                return Result.Failure<Guid>(paymentResult.Error);

            var payment = paymentResult.Value;
            payment.SetAuditInfo(_currentUser.UserId?.ToString() ?? _currentUser.Email ?? "system", false);
            await _payments.AddAsync(payment, ct);

            var entryResult = await _accountingService.GenerateCnssContributionPaymentEntryAsync(
                payment, bankAccount, ct);
            if (entryResult.IsFailure)
                return Result.Failure<Guid>(entryResult.Error);

            return Result.Success(payment.Id);
        }, cancellationToken);
    }
}

public sealed record CancelCnssContributionPaymentCommand(Guid PaymentId, string Reason)
    : IRequest<Result>;

public sealed class CancelCnssContributionPaymentCommandValidator
    : AbstractValidator<CancelCnssContributionPaymentCommand>
{
    public CancelCnssContributionPaymentCommandValidator()
    {
        RuleFor(x => x.PaymentId).NotEmpty();
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(500);
    }
}

public sealed class CancelCnssContributionPaymentCommandHandler
    : IRequestHandler<CancelCnssContributionPaymentCommand, Result>
{
    private readonly ICnssContributionPaymentRepository _payments;
    private readonly IAccountingService _accountingService;
    private readonly ITenantUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public CancelCnssContributionPaymentCommandHandler(
        ICnssContributionPaymentRepository payments,
        IAccountingService accountingService,
        ITenantUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _payments = payments;
        _accountingService = accountingService;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public Task<Result> Handle(CancelCnssContributionPaymentCommand request, CancellationToken cancellationToken)
    {
        var guard = CnssRemittanceFeatureGuard.EnsureEnabled(_settings);
        if (guard.IsFailure)
            return Task.FromResult(guard);

        return _unitOfWork.ExecuteAsync(async ct =>
        {
            var payment = await _payments.GetByIdAsync(request.PaymentId, ct);
            if (payment is null)
                return Result.Failure(Error.NotFound("CnssContributionPayment", request.PaymentId));

            var cancelledBy = _currentUser.Email ?? _currentUser.UserId?.ToString() ?? "system";
            var cancelResult = payment.Cancel(request.Reason, cancelledBy);
            if (cancelResult.IsFailure)
                return cancelResult;

            var reverseResult = await _accountingService.ReverseCnssContributionPaymentEntryAsync(
                payment.Id, request.Reason, ct);
            if (reverseResult.IsFailure)
                return reverseResult;

            await _payments.UpdateAsync(payment, ct);
            return Result.Success();
        }, cancellationToken);
    }
}
