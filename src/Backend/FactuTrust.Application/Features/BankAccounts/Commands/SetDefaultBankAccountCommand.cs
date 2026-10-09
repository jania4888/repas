using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.BankAccounts.Commands;

public sealed record SetDefaultBankAccountCommand(Guid Id) : IRequest<Result>;

public sealed class SetDefaultBankAccountCommandValidator : AbstractValidator<SetDefaultBankAccountCommand>
{
    public SetDefaultBankAccountCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
    }
}

public sealed class SetDefaultBankAccountCommandHandler : IRequestHandler<SetDefaultBankAccountCommand, Result>
{
    private readonly IBankAccountRepository _bankAccountRepository;
    private readonly IEnsureDefaultCompanyService _ensureDefaultCompanyService;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;

    public SetDefaultBankAccountCommandHandler(
        IBankAccountRepository bankAccountRepository,
        IEnsureDefaultCompanyService ensureDefaultCompanyService,
        ICurrentUser currentUser,
        IAuditService auditService)
    {
        _bankAccountRepository = bankAccountRepository;
        _ensureDefaultCompanyService = ensureDefaultCompanyService;
        _currentUser = currentUser;
        _auditService = auditService;
    }

    public async Task<Result> Handle(SetDefaultBankAccountCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure(Error.Unauthorized("Tenant manquant"));

        var companyIdResult = await _ensureDefaultCompanyService.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (companyIdResult.IsFailure)
            return Result.Failure(companyIdResult.Error);

        var companyId = companyIdResult.Value;
        var entity = await _bankAccountRepository.GetByIdAndCompanyAsync(request.Id, companyId, cancellationToken);
        if (entity is null)
            return Result.Failure(Error.NotFound("BankAccount", request.Id));

        await _bankAccountRepository.ClearDefaultFlagsForCompanyAsync(companyId, cancellationToken);

        var setDefault = entity.SetAsDefault();
        if (setDefault.IsFailure)
            return setDefault;

        entity.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);
        await _bankAccountRepository.UpdateAsync(entity, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.BankAccount.DefaultChanged,
            "BankAccount",
            entity.Id,
            newValues: new { iban = entity.Iban },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}
