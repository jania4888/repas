using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.ValueObjects;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.Suppliers.Commands;

/// <summary>
/// Command to update an existing supplier.
/// </summary>
public sealed record UpdateSupplierCommand(Guid Id, UpdateSupplierDto Dto) : IRequest<Result<SupplierDetailDto>>;

/// <summary>
/// Validator for UpdateSupplierCommand.
/// </summary>
public sealed class UpdateSupplierCommandValidator : AbstractValidator<UpdateSupplierCommand>
{
    public UpdateSupplierCommandValidator()
    {
        RuleFor(x => x.Dto).NotNull().WithMessage("Les données du fournisseur sont obligatoires.");

        When(x => x.Dto is not null, () =>
        {
            RuleFor(x => x.Dto!.Name).NotEmpty().WithMessage("Le nom du fournisseur est obligatoire.");
            RuleFor(x => x.Dto!.Name).MaximumLength(200).WithMessage("Le nom ne peut pas dépasser 200 caractères.");
            RuleFor(x => x.Dto!.Street).NotEmpty().WithMessage("L'adresse (rue) est obligatoire.");
            RuleFor(x => x.Dto!.City).NotEmpty().WithMessage("La ville est obligatoire.");
            RuleFor(x => x.Dto!.Governorate).NotEmpty().WithMessage("Le gouvernorat est obligatoire.");
            RuleFor(x => x.Dto!.PaymentTermDays)
                .InclusiveBetween(0, 365)
                .WithMessage("Le délai de paiement doit être entre 0 et 365 jours.");

            RuleFor(x => x.Dto!.DefaultWithholdingRate)
                .InclusiveBetween(0m, 100m)
                .When(x => x.Dto!.DefaultWithholdingRate.HasValue)
                .WithMessage("Le taux RS par défaut doit être compris entre 0 et 100 %.");
        });
    }
}

/// <summary>
/// Handler for UpdateSupplierCommand.
/// </summary>
public sealed class UpdateSupplierCommandHandler : IRequestHandler<UpdateSupplierCommand, Result<SupplierDetailDto>>
{
    private readonly ISupplierRepository _supplierRepository;
    private readonly ISupplierInvoiceRepository _supplierInvoiceRepository;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly IWithholdingTaxRepository _withholdingTaxRepository;
    private readonly IWithholdingTaxService _withholdingTaxService;
    private readonly IWithholdingFiscalYearParameterRepository _fiscalYearParameters;

    public UpdateSupplierCommandHandler(
        ISupplierRepository supplierRepository,
        ISupplierInvoiceRepository supplierInvoiceRepository,
        ICurrentUser currentUser,
        IAuditService auditService,
        IWithholdingTaxRepository withholdingTaxRepository,
        IWithholdingTaxService withholdingTaxService,
        IWithholdingFiscalYearParameterRepository fiscalYearParameters)
    {
        _supplierRepository = supplierRepository;
        _supplierInvoiceRepository = supplierInvoiceRepository;
        _currentUser = currentUser;
        _auditService = auditService;
        _withholdingTaxRepository = withholdingTaxRepository;
        _withholdingTaxService = withholdingTaxService;
        _fiscalYearParameters = fiscalYearParameters;
    }

    public async Task<Result<SupplierDetailDto>> Handle(UpdateSupplierCommand request, CancellationToken cancellationToken)
    {
        var supplier = await _supplierRepository.GetByIdAsync(request.Id, cancellationToken);
        if (supplier is null)
            return Result.Failure<SupplierDetailDto>(Error.NotFound("Supplier", request.Id));

        var dto = request.Dto;

        if (!dto.IsResident && string.IsNullOrWhiteSpace(dto.CountryCode))
            return Result.Failure<SupplierDetailDto>(Error.Validation("CountryCode", "Le code pays est obligatoire pour un fournisseur non résident."));

        var emailResult = Email.CreateOptional(dto.Email);
        if (emailResult.IsFailure)
            return Result.Failure<SupplierDetailDto>(emailResult.Error);

        var email = emailResult.Value;

        var addressResult = Address.Create(dto.Street, dto.City, dto.Governorate, dto.StreetLine2, dto.PostalCode);
        if (addressResult.IsFailure)
            return Result.Failure<SupplierDetailDto>(addressResult.Error);

        PhoneNumber? phone = null;
        if (!string.IsNullOrWhiteSpace(dto.Phone))
        {
            var phoneResult = PhoneNumber.Create(dto.Phone.Trim());
            if (phoneResult.IsFailure)
                return Result.Failure<SupplierDetailDto>(phoneResult.Error);
            phone = phoneResult.Value;
        }

        supplier.Update(
            dto.Name,
            addressResult.Value,
            email,
            phone,
            dto.ContactPerson,
            dto.PaymentTermDays,
            dto.Notes);

        var resolveResult = await SupplierWithholdingDefaultsResolver.ResolveWithResultAsync(
            dto.DefaultWithholdingTaxTypeId,
            dto.Rs7IsBracket,
            _withholdingTaxRepository,
            cancellationToken);
        if (resolveResult.IsFailure)
            return Result.Failure<SupplierDetailDto>(resolveResult.Error);

        var resolvedTypeId = resolveResult.Value;

        var prevSubject = supplier.IsSubjectToWithholding;
        var prevTypeId = supplier.DefaultWithholdingTaxTypeId;
        var prevRate = supplier.DefaultWithholdingRate;

        supplier.UpdateTejInfo(
            dto.TejIdentificationType,
            dto.DateOfBirth,
            string.IsNullOrWhiteSpace(dto.CountryCode) ? "TN" : dto.CountryCode.Trim(),
            dto.IsResident,
            dto.Activity);

        supplier.SetWithholdingDefaults(
            resolvedTypeId,
            dto.DefaultWithholdingRate,
            dto.IsSubjectToWithholding);

        var withholdingParamsChanged =
            prevSubject != dto.IsSubjectToWithholding
            || prevTypeId != resolvedTypeId
            || prevRate != dto.DefaultWithholdingRate;

        supplier.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);

        await _supplierRepository.UpdateAsync(supplier, cancellationToken);

        if (withholdingParamsChanged)
        {
            var openInvoices = await _supplierInvoiceRepository.GetOpenInvoicesForSupplierAsync(supplier.Id, cancellationToken);
            foreach (var inv in openInvoices)
            {
                await SupplierInvoiceWithholdingComputation.ApplyWithholdingPreviewAsync(
                    inv,
                    _withholdingTaxRepository,
                    _withholdingTaxService,
                    _fiscalYearParameters,
                    cancellationToken);
                await _supplierInvoiceRepository.UpdateAsync(inv, cancellationToken);
            }
        }

        await _auditService.LogAsync(
            AuditActions.Supplier.Updated,
            "Supplier",
            supplier.Id,
            newValues: new { supplier.Name },
            cancellationToken: cancellationToken);

        var detail = await SupplierDetailMapper.ToDetailDtoAsync(supplier, _withholdingTaxRepository, cancellationToken);
        return Result.Success(detail);
    }
}
