using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Validation;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.BankAccounts;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Services.Accounting;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.BankAccounts.Commands;

public sealed record CreateBankAccountCommand(CreateBankAccountRequest Request) : IRequest<Result<BankAccountDto>>;

public sealed class CreateBankAccountCommandValidator : AbstractValidator<CreateBankAccountCommand>
{
    public CreateBankAccountCommandValidator()
    {
        RuleFor(x => x.Request.BankCode).NotEmpty().WithMessage("La banque est obligatoire");
        RuleFor(x => x.Request.BankName).NotEmpty().MaximumLength(TunisianValidationRules.MaxLengths.BankName)
            .WithMessage("Le nom de la banque est obligatoire");
        RuleFor(x => x.Request.Rib)
            .NotEmpty().WithMessage("Le RIB est obligatoire")
            .Must(r => TunisianValidationRules.IsValidRib(r.Replace(" ", "")))
            .WithMessage("Le RIB doit contenir exactement 20 chiffres");
        RuleFor(x => x.Request.Iban)
            .NotEmpty().WithMessage("L'IBAN est obligatoire")
            .Must(r => TunisianValidationRules.IsValidTunisianIban(BankAccountNormalization.NormalizeIban(r)))
            .WithMessage("L'IBAN tunisien est invalide");
        RuleFor(x => x.Request.Designation).MaximumLength(200).When(x => x.Request.Designation != null);
        RuleFor(x => x.Request.AgencyName).MaximumLength(200).When(x => x.Request.AgencyName != null);
        RuleFor(x => x.Request.SwiftBic)
            .Must(TunisianValidationRules.IsValidSwiftBic)
            .When(x => !string.IsNullOrWhiteSpace(x.Request.SwiftBic));
    }
}

public sealed class CreateBankAccountCommandHandler : IRequestHandler<CreateBankAccountCommand, Result<BankAccountDto>>
{
    private readonly IBankAccountRepository _bankAccountRepository;
    private readonly IEnsureDefaultCompanyService _ensureDefaultCompanyService;
    private readonly IBankAccountChartProvisioningService _chartProvisioning;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;

    public CreateBankAccountCommandHandler(
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

    public async Task<Result<BankAccountDto>> Handle(CreateBankAccountCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure<BankAccountDto>(Error.Unauthorized("Tenant manquant"));

        var companyIdResult = await _ensureDefaultCompanyService.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (companyIdResult.IsFailure)
            return Result.Failure<BankAccountDto>(companyIdResult.Error);

        var companyId = companyIdResult.Value;

        if (!string.IsNullOrWhiteSpace(request.Request.ChartOfAccountNumber))
        {
            var linked = await _bankAccountRepository.GetByCompanyAndChartNumberAsync(
                companyId, request.Request.ChartOfAccountNumber.Trim(), cancellationToken);
            if (linked is not null)
                return await EnrichExistingProjectionAsync(linked, request.Request, cancellationToken);
        }

        var normalizedIban = BankAccountNormalization.NormalizeIban(request.Request.Iban);

        if (await _bankAccountRepository.ExistsIbanForCompanyAsync(companyId, normalizedIban, null, cancellationToken))
            return Result.Failure<BankAccountDto>(Error.Conflict("Un compte avec cet IBAN existe déjà."));

        var count = await _bankAccountRepository.CountActiveByCompanyAsync(companyId, cancellationToken);
        var isDefault = count == 0 || request.Request.SetAsDefault;

        if (isDefault)
            await _bankAccountRepository.ClearDefaultFlagsForCompanyAsync(companyId, cancellationToken);

        var create = BankAccount.Create(
            companyId,
            request.Request.BankCode,
            request.Request.BankName.Trim(),
            request.Request.Rib,
            request.Request.Iban,
            request.Request.Designation,
            request.Request.AgencyName,
            request.Request.SwiftBic,
            isDefault);

        if (create.IsFailure)
            return Result.Failure<BankAccountDto>(create.Error);

        var entity = create.Value;
        entity.SetCurrency(request.Request.Currency);
        entity.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: false);

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

        var saved = await _bankAccountRepository.AddAsync(entity, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.BankAccount.Created,
            "BankAccount",
            saved.Id,
            newValues: new
            {
                bankCode = saved.BankCode,
                iban = saved.Iban,
                isDefault = saved.IsDefault
            },
            cancellationToken: cancellationToken);

        return Result.Success(saved.ToDto());
    }

    private async Task<Result<BankAccountDto>> EnrichExistingProjectionAsync(
        BankAccount existing,
        CreateBankAccountRequest request,
        CancellationToken cancellationToken)
    {
        var complete = existing.CompleteBankingIdentity(
            request.BankCode,
            request.BankName.Trim(),
            request.Rib,
            request.Iban,
            request.Designation,
            request.AgencyName,
            request.SwiftBic);
        if (complete.IsFailure)
            return Result.Failure<BankAccountDto>(complete.Error);

        var currency = BankGlAccountRules.IsDinarLeaf(existing.ChartOfAccountNumber)
            ? "TND"
            : request.Currency;
        existing.SetCurrency(currency);
        if (!existing.IsActive)
            existing.SetActive(true);

        if (request.SetAsDefault && existing.HasBankingIdentity)
        {
            await _bankAccountRepository.ClearDefaultFlagsForCompanyAsync(existing.CompanyId, cancellationToken);
            existing.SetAsDefault();
        }

        existing.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);
        await _bankAccountRepository.UpdateAsync(existing, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.BankAccount.Updated,
            "BankAccount",
            existing.Id,
            newValues: new { bankCode = existing.BankCode, chartOfAccountNumber = existing.ChartOfAccountNumber, enriched = true },
            cancellationToken: cancellationToken);

        var dto = existing.ToDto() with { LinkedExistingChartProjection = true };
        return Result.Success(dto);
    }
}
