using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.Payroll.Advances;

// ── Create advance ──
public sealed record CreateAdvanceCommand(CreateAdvanceDto Dto) : IRequest<Result<Guid>>;

public sealed class CreateAdvanceCommandValidator : AbstractValidator<CreateAdvanceCommand>
{
    public CreateAdvanceCommandValidator()
    {
        RuleFor(x => x.Dto.EmployeeId).NotEmpty();
        RuleFor(x => x.Dto.Amount).GreaterThan(0).WithMessage("Le montant de l'avance doit être strictement positif.");
    }
}

public sealed class CreateAdvanceCommandHandler : IRequestHandler<CreateAdvanceCommand, Result<Guid>>
{
    private readonly IEmployeeAdvanceRepository _advances;
    private readonly IEmployeeRepository _employees;
    private readonly IBankAccountRepository _bankAccounts;
    private readonly IAccountingService _accounting;
    private readonly ITenantUnitOfWork _unitOfWork;

    public CreateAdvanceCommandHandler(
        IEmployeeAdvanceRepository advances,
        IEmployeeRepository employees,
        IBankAccountRepository bankAccounts,
        IAccountingService accounting,
        ITenantUnitOfWork unitOfWork)
    {
        _advances = advances;
        _employees = employees;
        _bankAccounts = bankAccounts;
        _accounting = accounting;
        _unitOfWork = unitOfWork;
    }

    public async Task<Result<Guid>> Handle(CreateAdvanceCommand request, CancellationToken cancellationToken)
    {
        // Avance et décaissement dans une seule transaction : une créance 421 sans écriture, ou une
        // écriture sans créance, seraient l'une comme l'autre irrattrapables sans intervention.
        return await _unitOfWork.ExecuteAsync(async ct =>
        {
            var dto = request.Dto;

            var employee = await _employees.GetByIdAsync(dto.EmployeeId, ct);
            if (employee is null)
                return Result.Failure<Guid>(Error.NotFound("Employee", dto.EmployeeId));

            var advanceResult = EmployeeAdvance.Create(dto.EmployeeId, dto.Date, dto.Amount, dto.Reason);
            if (advanceResult.IsFailure)
                return Result.Failure<Guid>(advanceResult.Error);

            var advance = advanceResult.Value;
            await _advances.AddAsync(advance, ct);

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

            var entry = await _accounting.GenerateEmployeeAdvanceDisbursementEntryAsync(
                advance, employee.FullName, method, bankAccount, ct);
            if (entry.IsFailure)
                return Result.Failure<Guid>(entry.Error);

            return Result.Success(advance.Id);
        }, cancellationToken);
    }
}

// ── Delete advance ──
public sealed record DeleteAdvanceCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteAdvanceCommandHandler : IRequestHandler<DeleteAdvanceCommand, Result>
{
    private readonly IEmployeeAdvanceRepository _advances;
    private readonly IAccountingService _accounting;
    private readonly ITenantUnitOfWork _unitOfWork;

    public DeleteAdvanceCommandHandler(
        IEmployeeAdvanceRepository advances,
        IAccountingService accounting,
        ITenantUnitOfWork unitOfWork)
    {
        _advances = advances;
        _accounting = accounting;
        _unitOfWork = unitOfWork;
    }

    public async Task<Result> Handle(DeleteAdvanceCommand request, CancellationToken cancellationToken)
    {
        return await _unitOfWork.ExecuteAsync(async ct =>
        {
            var advance = await _advances.GetByIdAsync(request.Id, ct);
            if (advance is null)
                return Result.Failure(Error.NotFound("EmployeeAdvance", request.Id));

            if (advance.IsSettled)
                return Result.Failure(Error.Validation("IsSettled", "Une avance déjà retenue sur un bulletin ne peut pas être supprimée."));

            // Supprimer l'avance sans extourner son décaissement laisserait un débit 421 orphelin.
            var reversal = await _accounting.ReverseEmployeeAdvanceDisbursementEntryAsync(
                advance.Id, "Suppression de l'avance", ct);
            if (reversal.IsFailure)
                return reversal;

            await _advances.DeleteAsync(advance, ct);
            return Result.Success();
        }, cancellationToken);
    }
}

// ── List advances by employee ──
public sealed record GetEmployeeAdvancesQuery(Guid EmployeeId) : IRequest<IReadOnlyList<EmployeeAdvanceDto>>;

public sealed class GetEmployeeAdvancesQueryHandler : IRequestHandler<GetEmployeeAdvancesQuery, IReadOnlyList<EmployeeAdvanceDto>>
{
    private readonly IEmployeeAdvanceRepository _advances;

    public GetEmployeeAdvancesQueryHandler(IEmployeeAdvanceRepository advances)
    {
        _advances = advances;
    }

    public async Task<IReadOnlyList<EmployeeAdvanceDto>> Handle(GetEmployeeAdvancesQuery request, CancellationToken cancellationToken)
    {
        var advances = await _advances.ListByEmployeeAsync(request.EmployeeId, cancellationToken);
        return advances.Select(a => PayrollMappings.ToDto(a)).ToList();
    }
}
