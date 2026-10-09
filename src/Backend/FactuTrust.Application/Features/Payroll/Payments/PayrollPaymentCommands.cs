using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Payroll;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Payroll.Payments;

// ── Record payroll run payment ──

public sealed record RecordPayrollRunPaymentCommand(Guid RunId, RecordPayrollRunPaymentRequest Request)
    : IRequest<Result<Guid>>;

public sealed class RecordPayrollRunPaymentCommandValidator : AbstractValidator<RecordPayrollRunPaymentCommand>
{
    public RecordPayrollRunPaymentCommandValidator()
    {
        RuleFor(x => x.RunId).NotEmpty();
        RuleFor(x => x.Request.PaymentDate).NotEmpty();
        RuleFor(x => x.Request.Method).IsInEnum();
        RuleFor(x => x.Request.Method).NotEqual(PaymentMethod.Traite)
            .WithMessage("Le paiement de la paie par traite n'est pas autorisé.");
        RuleFor(x => x.Request.BankAccountId)
            .NotEmpty()
            .When(x => x.Request.Method != PaymentMethod.Cash)
            .WithMessage("Le compte bancaire débiteur est obligatoire pour ce mode de paiement.");
        RuleForEach(x => x.Request.PayslipAmounts)
            .ChildRules(line =>
            {
                line.RuleFor(l => l.PayslipId).NotEmpty();
                line.RuleFor(l => l.Amount).GreaterThan(0);
            })
            .When(x => x.Request.PayslipAmounts is { Count: > 0 });
    }
}

public sealed class RecordPayrollRunPaymentCommandHandler
    : IRequestHandler<RecordPayrollRunPaymentCommand, Result<Guid>>
{
    private readonly IPayrollRunRepository _runs;
    private readonly IPayrollPaymentRepository _payments;
    private readonly IBankAccountRepository _bankAccounts;
    private readonly IAccountingService _accountingService;
    private readonly ILetteringService _letteringService;
    private readonly ITenantUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;
    private readonly ILogger<RecordPayrollRunPaymentCommandHandler> _logger;

    public RecordPayrollRunPaymentCommandHandler(
        IPayrollRunRepository runs,
        IPayrollPaymentRepository payments,
        IBankAccountRepository bankAccounts,
        IAccountingService accountingService,
        ILetteringService letteringService,
        ITenantUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings,
        ILogger<RecordPayrollRunPaymentCommandHandler> logger)
    {
        _runs = runs;
        _payments = payments;
        _bankAccounts = bankAccounts;
        _accountingService = accountingService;
        _letteringService = letteringService;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _settings = settings.Value;
        _logger = logger;
    }

    public Task<Result<Guid>> Handle(RecordPayrollRunPaymentCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.PayrollTreasuryLinkEnabled)
        {
            return Task.FromResult(Result.Failure<Guid>(Error.Validation(
                "Feature",
                "Le lien trésorerie paie n'est pas activé pour ce dossier.")));
        }

        return _unitOfWork.ExecuteAsync(async ct =>
        {
            var run = await _runs.GetByIdWithPayslipsForPaymentAsync(request.RunId, ct);
            if (run is null)
                return Result.Failure<Guid>(Error.NotFound("PayrollRun", request.RunId));

            BankAccount? bankAccount = null;
            if (request.Request.Method != PaymentMethod.Cash)
            {
                if (!request.Request.BankAccountId.HasValue)
                {
                    return Result.Failure<Guid>(Error.Validation(
                        "BankAccountId",
                        "Le compte bancaire débiteur est obligatoire."));
                }

                bankAccount = await _bankAccounts.GetByIdAsync(request.Request.BankAccountId.Value, ct);
                if (bankAccount is null)
                    return Result.Failure<Guid>(Error.NotFound("BankAccount", request.Request.BankAccountId.Value));
                var identity = bankAccount.RequireCompleteIdentity();
                if (identity.IsFailure)
                    return Result.Failure<Guid>(identity.Error);
            }

            var lineInputs = BuildLineInputs(run, request.Request.PayslipAmounts);
            if (lineInputs.IsFailure)
                return Result.Failure<Guid>(lineInputs.Error);

            var paymentResult = PayrollPayment.Create(
                run,
                lineInputs.Value,
                request.Request.PaymentDate,
                request.Request.Method,
                request.Request.BankAccountId,
                request.Request.Reference,
                request.Request.Notes);

            if (paymentResult.IsFailure)
                return Result.Failure<Guid>(paymentResult.Error);

            var payment = paymentResult.Value;
            var updatedPayslips = new List<Payslip>();

            foreach (var line in payment.Lines)
            {
                var payslip = run.Payslips.First(p => p.Id == line.PayslipId);
                var register = payslip.RegisterPayment(
                    line.Amount.Amount,
                    request.Request.PaymentDate,
                    line.EmployeeAuxiliaryAccount);
                if (register.IsFailure)
                    return Result.Failure<Guid>(register.Error);
                updatedPayslips.Add(payslip);
            }

            payment.SetAuditInfo(_currentUser.UserId?.ToString() ?? _currentUser.Email ?? "system", false);
            await _payments.AddAsync(payment, ct);
            await _payments.UpdatePayslipsAsync(updatedPayslips, ct);

            var entryResult = await _accountingService.GeneratePayrollPaymentEntryAsync(
                payment, run, bankAccount, ct);
            if (entryResult.IsFailure)
                return Result.Failure<Guid>(entryResult.Error);

            // Le lettrage est un confort de rapprochement : il ne doit jamais annuler un règlement
            // déjà comptabilisé. En cas d'échec on trace et on poursuit — le lettrage manuel reste
            // disponible depuis la comptabilité.
            var letterResult = await _letteringService.AutoLetterPayrollPaymentAsync(
                payment.Id, run.Id, ct);
            if (letterResult.IsFailure)
            {
                _logger.LogWarning(
                    "Lettrage automatique non posé pour le paiement {PayrollPaymentId} du cycle "
                    + "{PayrollRunId} : {Reason}. Le paiement est enregistré.",
                    payment.Id, run.Id, letterResult.Error.Description);
            }

            return Result.Success(payment.Id);
        }, cancellationToken);
    }

    private static Result<IReadOnlyList<(Payslip Payslip, decimal Amount, string AuxiliaryAccount)>> BuildLineInputs(
        PayrollRun run,
        IReadOnlyList<PayslipPaymentAmountRequest>? overrides)
    {
        var overrideMap = overrides?.ToDictionary(x => x.PayslipId, x => x.Amount)
            ?? new Dictionary<Guid, decimal>();

        var inputs = new List<(Payslip, decimal, string)>();

        if (overrideMap.Count > 0)
        {
            foreach (var (payslipId, amount) in overrideMap)
            {
                var payslip = run.Payslips.FirstOrDefault(p => p.Id == payslipId);
                if (payslip is null)
                {
                    return Result.Failure<IReadOnlyList<(Payslip, decimal, string)>>(
                        Error.Validation("PayslipId", $"Bulletin {payslipId} introuvable dans ce cycle."));
                }

                if (amount <= 0)
                    continue;

                var auxiliary = ResolveAuxiliaryAccount(payslip);
                if (auxiliary.IsFailure)
                    return Result.Failure<IReadOnlyList<(Payslip, decimal, string)>>(auxiliary.Error);

                inputs.Add((payslip, amount, auxiliary.Value));
            }
        }
        else
        {
            foreach (var payslip in run.Payslips.Where(p => p.RemainingToPay > 0))
            {
                var auxiliary = ResolveAuxiliaryAccount(payslip);
                if (auxiliary.IsFailure)
                    return Result.Failure<IReadOnlyList<(Payslip, decimal, string)>>(auxiliary.Error);

                inputs.Add((payslip, payslip.RemainingToPay, auxiliary.Value));
            }
        }

        if (inputs.Count == 0)
        {
            return Result.Failure<IReadOnlyList<(Payslip, decimal, string)>>(
                Error.Validation("Lines", "Aucun bulletin à payer."));
        }

        return Result.Success<IReadOnlyList<(Payslip, decimal, string)>>(inputs);
    }

    /// <summary>
    /// Compte auxiliaire du bulletin : celui figé à la validation, sinon dérivé du matricule. Le
    /// repli couvre les bulletins antérieurs au figeage ; il échoue proprement plutôt que de lever
    /// quand le matricule ne contient aucun chiffre, un règlement ne devant pas se solder par une
    /// erreur serveur.
    /// </summary>
    private static Result<string> ResolveAuxiliaryAccount(Payslip payslip)
    {
        if (!string.IsNullOrWhiteSpace(payslip.EmployeeAuxiliaryAccount))
            return Result.Success(payslip.EmployeeAuxiliaryAccount!);

        // Le paiement suit la maille de la dette, jamais l'inverse. Sans compte figé sur le bulletin,
        // l'OD du cycle a crédité le compte collectif : le règlement doit le débiter lui, sans quoi
        // le lettrage n'apparierait rien. L'ancien repli redérivait un numéro depuis le matricule et
        // visait un compte auxiliaire que l'écriture n'avait jamais crédité.
        return Result.Success(Employee.PersonnelPayableCollectiveAccount);
    }
}

// ── Record single payslip payment ──

public sealed record RecordPayslipPaymentCommand(Guid PayslipId, RecordPayslipPaymentRequest Request)
    : IRequest<Result<Guid>>;

public sealed class RecordPayslipPaymentCommandValidator : AbstractValidator<RecordPayslipPaymentCommand>
{
    public RecordPayslipPaymentCommandValidator()
    {
        RuleFor(x => x.PayslipId).NotEmpty();
        RuleFor(x => x.Request.PaymentDate).NotEmpty();
        RuleFor(x => x.Request.Amount).GreaterThan(0);
        RuleFor(x => x.Request.Method).IsInEnum().NotEqual(PaymentMethod.Traite);
        RuleFor(x => x.Request.BankAccountId)
            .NotEmpty()
            .When(x => x.Request.Method != PaymentMethod.Cash);
    }
}

public sealed class RecordPayslipPaymentCommandHandler
    : IRequestHandler<RecordPayslipPaymentCommand, Result<Guid>>
{
    private readonly IPayrollRunRepository _runs;
    private readonly IMediator _mediator;

    public RecordPayslipPaymentCommandHandler(IPayrollRunRepository runs, IMediator mediator)
    {
        _runs = runs;
        _mediator = mediator;
    }

    public async Task<Result<Guid>> Handle(RecordPayslipPaymentCommand request, CancellationToken cancellationToken)
    {
        var payslip = await _runs.GetPayslipByIdAsync(request.PayslipId, cancellationToken);
        if (payslip is null)
            return Result.Failure<Guid>(Error.NotFound("Payslip", request.PayslipId));

        return await _mediator.Send(new RecordPayrollRunPaymentCommand(
            payslip.PayrollRunId,
            new RecordPayrollRunPaymentRequest
            {
                PaymentDate = request.Request.PaymentDate,
                Method = request.Request.Method,
                BankAccountId = request.Request.BankAccountId,
                Reference = request.Request.Reference,
                Notes = request.Request.Notes,
                PayslipAmounts = new[]
                {
                    new PayslipPaymentAmountRequest
                    {
                        PayslipId = payslip.Id,
                        Amount = request.Request.Amount
                    }
                }
            }), cancellationToken);
    }
}

// ── Cancel payment ──

public sealed record CancelPayrollPaymentCommand(Guid PaymentId, string Reason) : IRequest<Result>;

public sealed class CancelPayrollPaymentCommandValidator : AbstractValidator<CancelPayrollPaymentCommand>
{
    public CancelPayrollPaymentCommandValidator()
    {
        RuleFor(x => x.PaymentId).NotEmpty();
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(500);
    }
}

public sealed class CancelPayrollPaymentCommandHandler : IRequestHandler<CancelPayrollPaymentCommand, Result>
{
    private readonly IPayrollPaymentRepository _payments;
    private readonly IPayrollRunRepository _runs;
    private readonly IAccountingService _accountingService;
    private readonly ILetteringService _letteringService;
    private readonly ITenantUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public CancelPayrollPaymentCommandHandler(
        IPayrollPaymentRepository payments,
        IPayrollRunRepository runs,
        IAccountingService accountingService,
        ILetteringService letteringService,
        ITenantUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _payments = payments;
        _runs = runs;
        _accountingService = accountingService;
        _letteringService = letteringService;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public Task<Result> Handle(CancelPayrollPaymentCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.PayrollTreasuryLinkEnabled)
        {
            return Task.FromResult(Result.Failure(Error.Validation(
                "Feature",
                "Le lien trésorerie paie n'est pas activé pour ce dossier.")));
        }

        return _unitOfWork.ExecuteAsync(async ct =>
        {
            var payment = await _payments.GetByIdWithLinesAsync(request.PaymentId, ct);
            if (payment is null)
                return Result.Failure(Error.NotFound("PayrollPayment", request.PaymentId));

            if (payment.IsCancelled)
                return Result.Failure(Error.Validation("Payment", "Ce paiement est déjà annulé."));

            var run = await _runs.GetByIdWithPayslipsForPaymentAsync(payment.PayrollRunId, ct);
            if (run is null)
                return Result.Failure(Error.NotFound("PayrollRun", payment.PayrollRunId));

            var cancelledBy = _currentUser.Email ?? _currentUser.UserId?.ToString() ?? "system";
            var cancelResult = payment.Cancel(request.Reason, cancelledBy);
            if (cancelResult.IsFailure)
                return cancelResult;

            var updatedPayslips = new List<Payslip>();
            foreach (var line in payment.Lines)
            {
                var payslip = run.Payslips.First(p => p.Id == line.PayslipId);
                var unregister = payslip.UnregisterPayment(line.Amount.Amount);
                if (unregister.IsFailure)
                    return unregister;
                updatedPayslips.Add(payslip);
            }

            await _letteringService.UnletterPayrollPaymentAsync(payment.Id, ct);

            var reverseResult = await _accountingService.ReversePayrollPaymentEntryAsync(
                payment.Id, request.Reason, ct);
            if (reverseResult.IsFailure)
                return reverseResult;

            await _payments.UpdateAsync(payment, ct);
            await _payments.UpdatePayslipsAsync(updatedPayslips, ct);
            return Result.Success();
        }, cancellationToken);
    }
}

// ── Cancel all payments for a run ──

public sealed record CancelAllPayrollRunPaymentsCommand(Guid RunId, string Reason) : IRequest<Result>;

public sealed class CancelAllPayrollRunPaymentsCommandValidator : AbstractValidator<CancelAllPayrollRunPaymentsCommand>
{
    public CancelAllPayrollRunPaymentsCommandValidator()
    {
        RuleFor(x => x.RunId).NotEmpty();
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(500);
    }
}

public sealed class CancelAllPayrollRunPaymentsCommandHandler
    : IRequestHandler<CancelAllPayrollRunPaymentsCommand, Result>
{
    private readonly IPayrollPaymentRepository _payments;
    private readonly IMediator _mediator;

    public CancelAllPayrollRunPaymentsCommandHandler(IPayrollPaymentRepository payments, IMediator mediator)
    {
        _payments = payments;
        _mediator = mediator;
    }

    public async Task<Result> Handle(CancelAllPayrollRunPaymentsCommand request, CancellationToken cancellationToken)
    {
        var payments = await _payments.ListByPayrollRunAsync(request.RunId, includeCancelled: false, cancellationToken);
        foreach (var payment in payments)
        {
            var result = await _mediator.Send(
                new CancelPayrollPaymentCommand(payment.Id, request.Reason),
                cancellationToken);
            if (result.IsFailure)
                return result;
        }

        return Result.Success();
    }
}
