using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.BankAccounts.Commands;

public sealed record DeleteBankAccountCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteBankAccountCommandValidator : AbstractValidator<DeleteBankAccountCommand>
{
    public DeleteBankAccountCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
    }
}

public sealed class DeleteBankAccountCommandHandler : IRequestHandler<DeleteBankAccountCommand, Result>
{
    private readonly IBankAccountRepository _bankAccountRepository;
    private readonly IEnsureDefaultCompanyService _ensureDefaultCompanyService;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;

    public DeleteBankAccountCommandHandler(
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

    public async Task<Result> Handle(DeleteBankAccountCommand request, CancellationToken cancellationToken)
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

        var wasDefault = entity.IsDefault;

        await _bankAccountRepository.DeleteAsync(entity, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.BankAccount.Deleted,
            "BankAccount",
            request.Id,
            oldValues: new { wasDefault },
            cancellationToken: cancellationToken);

        if (wasDefault)
        {
            var remaining = await _bankAccountRepository.GetActiveByCompanyAsync(companyId, cancellationToken);
            var next = remaining.Where(b => b.HasBankingIdentity).OrderBy(b => b.CreatedAt).FirstOrDefault();
            if (next is not null)
            {
                await _bankAccountRepository.ClearDefaultFlagsForCompanyAsync(companyId, cancellationToken);
                var setDefault = next.SetAsDefault();
                if (setDefault.IsFailure)
                    return Result.Success();

                next.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);
                await _bankAccountRepository.UpdateAsync(next, cancellationToken);

                await _auditService.LogAsync(
                    AuditActions.BankAccount.DefaultChanged,
                    "BankAccount",
                    next.Id,
                    newValues: new { reason = "auto_after_delete" },
                    cancellationToken: cancellationToken);
            }
        }

        return Result.Success();
    }
}
