using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Payroll;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.Payroll.EmployeeLoans;

public sealed record ListEmployeeLoansQuery(Guid EmployeeId) : IRequest<IReadOnlyList<EmployeeLoanDto>>;

public sealed class ListEmployeeLoansQueryHandler : IRequestHandler<ListEmployeeLoansQuery, IReadOnlyList<EmployeeLoanDto>>
{
    private readonly IEmployeeLoanRepository _loans;
    private readonly IEmployeeRepository _employees;

    public ListEmployeeLoansQueryHandler(IEmployeeLoanRepository loans, IEmployeeRepository employees)
    {
        _loans = loans;
        _employees = employees;
    }

    public async Task<IReadOnlyList<EmployeeLoanDto>> Handle(ListEmployeeLoansQuery request, CancellationToken cancellationToken)
    {
        var loans = await _loans.ListByEmployeeAsync(request.EmployeeId, cancellationToken);
        var employee = await _employees.GetByIdAsync(request.EmployeeId, cancellationToken);
        return loans.Select(l => PayrollMappings.ToEmployeeLoanDto(l, employee?.FullName)).ToList();
    }
}

public sealed record GetEmployeeLoanByIdQuery(Guid Id) : IRequest<Result<EmployeeLoanDto>>;

public sealed class GetEmployeeLoanByIdQueryHandler : IRequestHandler<GetEmployeeLoanByIdQuery, Result<EmployeeLoanDto>>
{
    private readonly IEmployeeLoanRepository _loans;
    private readonly IEmployeeRepository _employees;

    public GetEmployeeLoanByIdQueryHandler(IEmployeeLoanRepository loans, IEmployeeRepository employees)
    {
        _loans = loans;
        _employees = employees;
    }

    public async Task<Result<EmployeeLoanDto>> Handle(GetEmployeeLoanByIdQuery request, CancellationToken cancellationToken)
    {
        var loan = await _loans.GetByIdWithInstallmentsAsync(request.Id, cancellationToken);
        if (loan is null)
            return Result.Failure<EmployeeLoanDto>(Error.NotFound("EmployeeLoan", request.Id));

        var employee = await _employees.GetByIdAsync(loan.EmployeeId, cancellationToken);
        return Result.Success(PayrollMappings.ToEmployeeLoanDto(loan, employee?.FullName));
    }
}

public sealed record CreateEmployeeLoanCommand(CreateEmployeeLoanDto Dto) : IRequest<Result<Guid>>;

public sealed class CreateEmployeeLoanCommandValidator : AbstractValidator<CreateEmployeeLoanCommand>
{
    public CreateEmployeeLoanCommandValidator()
    {
        RuleFor(x => x.Dto.EmployeeId).NotEmpty();
        RuleFor(x => x.Dto.Reference).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Dto.Principal).GreaterThan(0);
        RuleFor(x => x.Dto.InstallmentCount).GreaterThan(0);
        RuleFor(x => x.Dto.StartMonth).InclusiveBetween(1, 12);
    }
}

public sealed class CreateEmployeeLoanCommandHandler : IRequestHandler<CreateEmployeeLoanCommand, Result<Guid>>
{
    private readonly IEmployeeLoanRepository _loans;
    private readonly IEmployeeRepository _employees;
    private readonly IBankAccountRepository _bankAccounts;
    private readonly IAccountingService _accounting;
    private readonly ITenantUnitOfWork _unitOfWork;

    public CreateEmployeeLoanCommandHandler(
        IEmployeeLoanRepository loans,
        IEmployeeRepository employees,
        IBankAccountRepository bankAccounts,
        IAccountingService accounting,
        ITenantUnitOfWork unitOfWork)
    {
        _loans = loans;
        _employees = employees;
        _bankAccounts = bankAccounts;
        _accounting = accounting;
        _unitOfWork = unitOfWork;
    }

    public async Task<Result<Guid>> Handle(CreateEmployeeLoanCommand request, CancellationToken cancellationToken)
    {
        // Prêt et décaissement dans une seule transaction : un échéancier sans écriture, ou une
        // écriture sans échéancier, seraient l'un comme l'autre irrattrapables sans intervention.
        return await _unitOfWork.ExecuteAsync(async ct =>
        {
            var dto = request.Dto;
            var employee = await _employees.GetByIdAsync(dto.EmployeeId, ct);
            if (employee is null)
                return Result.Failure<Guid>(Error.NotFound("Employee", dto.EmployeeId));

            var result = EmployeeLoan.Create(
                dto.EmployeeId, dto.Reference, dto.Principal, dto.InstallmentCount,
                dto.StartYear, dto.StartMonth, dto.Notes);

            if (result.IsFailure)
                return Result.Failure<Guid>(result.Error);

            var loan = result.Value;
            await _loans.AddAsync(loan, ct);

            var method = dto.Method ?? PaymentMethod.BankTransfer;
            BankAccount? bankAccount = null;
            if (dto.BankAccountId is { } bankAccountId)
            {
                bankAccount = await _bankAccounts.GetByIdAsync(bankAccountId, ct);
                if (bankAccount is null)
                    return Result.Failure<Guid>(Error.NotFound("BankAccount", bankAccountId));
                var identity = bankAccount.RequireCompleteIdentity();
                if (identity.IsFailure)
                    return Result.Failure<Guid>(identity.Error);
            }

            var entry = await _accounting.GenerateEmployeeLoanDisbursementEntryAsync(
                loan,
                employee.FullName,
                dto.DisbursementDate ?? DateTime.UtcNow.Date,
                method,
                bankAccount,
                ct);
            if (entry.IsFailure)
                return Result.Failure<Guid>(entry.Error);

            return Result.Success(loan.Id);
        }, cancellationToken);
    }
}

public sealed record CancelEmployeeLoanCommand(Guid Id) : IRequest<Result>;

public sealed class CancelEmployeeLoanCommandHandler : IRequestHandler<CancelEmployeeLoanCommand, Result>
{
    private readonly IEmployeeLoanRepository _loans;
    private readonly IAccountingService _accounting;
    private readonly ITenantUnitOfWork _unitOfWork;

    public CancelEmployeeLoanCommandHandler(
        IEmployeeLoanRepository loans,
        IAccountingService accounting,
        ITenantUnitOfWork unitOfWork)
    {
        _loans = loans;
        _accounting = accounting;
        _unitOfWork = unitOfWork;
    }

    public async Task<Result> Handle(CancelEmployeeLoanCommand request, CancellationToken cancellationToken)
    {
        return await _unitOfWork.ExecuteAsync(async ct =>
        {
            var loan = await _loans.GetByIdWithInstallmentsAsync(request.Id, ct);
            if (loan is null)
                return Result.Failure(Error.NotFound("EmployeeLoan", request.Id));

            try
            {
                loan.Cancel();
            }
            catch (InvalidOperationException ex)
            {
                return Result.Failure(Error.Validation("Status", ex.Message));
            }

            // Annuler le prêt sans extourner son décaissement laisserait un débit 421.1 orphelin.
            var reversal = await _accounting.ReverseEmployeeLoanDisbursementEntryAsync(
                loan.Id, "Annulation du prêt salarié", ct);
            if (reversal.IsFailure)
                return reversal;

            await _loans.UpdateAsync(loan, ct);
            return Result.Success();
        }, cancellationToken);
    }
}
