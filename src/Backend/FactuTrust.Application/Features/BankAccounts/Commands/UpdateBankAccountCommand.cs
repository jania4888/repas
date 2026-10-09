using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Validation;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.BankAccounts;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.BankAccounts.Commands;

public sealed record UpdateBankAccountCommand(Guid Id, UpdateBankAccountRequest Request) : IRequest<Result<BankAccountDto>>;

public sealed class UpdateBankAccountCommandValidator : AbstractValidator<UpdateBankAccountCommand>
{
    public UpdateBankAccountCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Request.BankCode).NotEmpty().WithMessage("La banque est obligatoire");
        RuleFor(x => x.Request.BankName).NotEmpty().MaximumLength(TunisianValidationRules.MaxLengths.BankName);
        RuleFor(x => x.Request.Rib)
            .NotEmpty()
            .Must(r => TunisianValidationRules.IsValidRib(r.Replace(" ", "")))
            .WithMessage("Le RIB doit contenir exactement 20 chiffres");
        RuleFor(x => x.Request.Iban)
            .NotEmpty()
            .Must(r => TunisianValidationRules.IsValidTunisianIban(BankAccountNormalization.NormalizeIban(r)))
            .WithMessage("L'IBAN tunisien est invalide");
        RuleFor(x => x.Request.SwiftBic)
            .Must(TunisianValidationRules.IsValidSwiftBic)
            .When(x => !string.IsNullOrWhiteSpace(x.Request.SwiftBic));
    }
}

public sealed class UpdateBankAccountCommandHandler : IRequestHandler<UpdateBankAccountCommand, Result<BankAccountDto>>
{
    private readonly IBankAccountRepository _bankAccountRepository;
    private readonly IEnsureDefaultCompanyService _ensureDefaultCompanyService;
    private readonly IBankAccountChartProvisioningService _chartProvisioning;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;

    public UpdateBankAccountCommandHandler(
        IBankAccountRepository bankAccountRepository,
        IEnsureDefaultCompanyService ensureDefaultCompanyService,
        IBankAccountChartProvisioningService chartProvisioning,
        ICurrentUser currentUser,
        IAuditService auditService)
    {
        _bankAccountRepository = bankAccountRepository;
        _ensureDefaultCompanyService = ensureDefaultCompanyService;
        _chartProvisioning = chartProvisioning;
        _currentUser = currentUser;
        _auditService = auditService;
    }

    public async Task<Result<BankAccountDto>> Handle(UpdateBankAccountCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure<BankAccountDto>(Error.Unauthorized("Tenant manquant"));

        var companyIdResult = await _ensureDefaultCompanyService.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (companyIdResult.IsFailure)
            return Result.Failure<BankAccountDto>(companyIdResult.Error);

        var companyId = companyIdResult.Value;
        var normalizedIban = BankAccountNormalization.NormalizeIban(request.Request.Iban);

        if (await _bankAccountRepository.ExistsIbanForCompanyAsync(companyId, normalizedIban, request.Id, cancellationToken))
            return Result.Failure<BankAccountDto>(Error.Conflict("Un compte avec cet IBAN existe déjà."));

        var entity = await _bankAccountRepository.GetByIdAndCompanyAsync(request.Id, companyId, cancellationToken);
        if (entity is null)
            return Result.Failure<BankAccountDto>(Error.NotFound("BankAccount", request.Id));

        if (!string.IsNullOrWhiteSpace(request.Request.ChartOfAccountNumber))
        {
            var owner = await _bankAccountRepository.GetByCompanyAndChartNumberAsync(
                companyId, request.Request.ChartOfAccountNumber.Trim(), cancellationToken);
            if (owner is not null && owner.Id != entity.Id)
                return Result.Failure<BankAccountDto>(Error.Conflict(
                    "Ce compte comptable est déjà relié à un autre compte bancaire."));
        }

        var update = entity.Update(
            request.Request.BankCode,
            request.Request.BankName.Trim(),
            request.Request.Rib,
            request.Request.Iban,
            request.Request.Designation,
            request.Request.AgencyName,
            request.Request.SwiftBic);

        if (update.IsFailure)
            return Result.Failure<BankAccountDto>(update.Error);

        entity.SetCurrency(request.Request.Currency);

        if (!string.IsNullOrWhiteSpace(request.Request.ChartOfAccountNumber) || request.Request.AutoCreateChartAccount)
        {
            var chartResult = await _chartProvisioning.ResolveChartAccountNumberAsync(
                entity,
                request.Request.ChartOfAccountNumber,
                request.Request.AutoCreateChartAccount,
                cancellationToken);
            if (chartResult.IsFailure)
                return Result.Failure<BankAccountDto>(chartResult.Error);
            if (!string.IsNullOrEmpty(chartResult.Value))
            {
                var link = entity.SetChartOfAccountNumber(chartResult.Value);
                if (link.IsFailure)
                    return Result.Failure<BankAccountDto>(link.Error);
            }
        }

        entity.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);
        await _bankAccountRepository.UpdateAsync(entity, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.BankAccount.Updated,
            "BankAccount",
            entity.Id,
            newValues: new { bankCode = entity.BankCode, iban = entity.Iban },
            cancellationToken: cancellationToken);

        return Result.Success(entity.ToDto());
    }
}
