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
/// Command to create a new supplier.
/// </summary>
public sealed record CreateSupplierCommand(CreateSupplierDto Dto) : IRequest<Result<Guid>>;

/// <summary>
/// Validator for CreateSupplierCommand.
/// </summary>
public sealed class CreateSupplierCommandValidator : AbstractValidator<CreateSupplierCommand>
{
    public CreateSupplierCommandValidator()
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
/// Handler for CreateSupplierCommand.
/// </summary>
public sealed class CreateSupplierCommandHandler : IRequestHandler<CreateSupplierCommand, Result<Guid>>
{
    private readonly ISupplierRepository _supplierRepository;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly ITenantContext _tenantContext;
    private readonly IWithholdingTaxRepository _withholdingTaxRepository;

    public CreateSupplierCommandHandler(
        ISupplierRepository supplierRepository,
        ICurrentUser currentUser,
        IAuditService auditService,
        ITenantContext tenantContext,
        IWithholdingTaxRepository withholdingTaxRepository)
    {
        _supplierRepository = supplierRepository;
        _currentUser = currentUser;
        _auditService = auditService;
        _tenantContext = tenantContext;
        _withholdingTaxRepository = withholdingTaxRepository;
    }

    public async Task<Result<Guid>> Handle(CreateSupplierCommand request, CancellationToken cancellationToken)
    {
        var dto = request.Dto;
        if (dto is null)
            return Result.Failure<Guid>(Error.Validation("Dto", "Les données du fournisseur sont obligatoires."));

        if (_tenantContext.TenantId is null)
            return Result.Failure<Guid>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        var emailResult = Email.CreateOptional(dto.Email);
        if (emailResult.IsFailure)
            return Result.Failure<Guid>(emailResult.Error);

        var email = emailResult.Value;
        if (email is not null)
        {
            var existingByEmail = await _supplierRepository.GetByEmailAsync(email.Value, cancellationToken);
            if (existingByEmail is not null)
                return DuplicateConflict(existingByEmail.Id, "email", "Un fournisseur existe déjà avec cet email.");
        }

        NIF? nif = null;
        if (!string.IsNullOrWhiteSpace(dto.Nif))
        {
            var nifResult = NIF.Create(dto.Nif.Trim());
            if (nifResult.IsFailure)
                return Result.Failure<Guid>(nifResult.Error);
            nif = nifResult.Value;

            var existingByNif = await _supplierRepository.GetByNifAsync(nif.Value, cancellationToken);
            if (existingByNif is not null)
                return DuplicateConflict(existingByNif.Id, "nif", "Un fournisseur existe déjà avec ce matricule fiscal.");
        }
        else if (dto.Type == SupplierType.Business)
        {
            return Result.Failure<Guid>(Error.Validation("NIF", "Le matricule fiscal est obligatoire pour un fournisseur entreprise."));
        }

        if (string.IsNullOrWhiteSpace(dto.Street))
            return Result.Failure<Guid>(Error.Validation("Street", "L'adresse (rue) est obligatoire."));
        if (string.IsNullOrWhiteSpace(dto.City))
            return Result.Failure<Guid>(Error.Validation("City", "La ville est obligatoire."));
        if (string.IsNullOrWhiteSpace(dto.Governorate))
            return Result.Failure<Guid>(Error.Validation("Governorate", "Le gouvernorat est obligatoire."));
        var addressResult = Address.Create(dto.Street!, dto.City!, dto.Governorate!, dto.StreetLine2, dto.PostalCode);
        if (addressResult.IsFailure)
            return Result.Failure<Guid>(addressResult.Error);

        PhoneNumber? phone = null;
        if (!string.IsNullOrWhiteSpace(dto.Phone))
        {
            var phoneResult = PhoneNumber.Create(dto.Phone.Trim());
            if (phoneResult.IsFailure)
                return Result.Failure<Guid>(phoneResult.Error);
            phone = phoneResult.Value;
        }

        var name = dto.Name?.Trim();
        if (string.IsNullOrEmpty(name))
            return Result.Failure<Guid>(Error.Validation("Name", "Le nom du fournisseur est obligatoire."));

        if (!dto.IsResident && string.IsNullOrWhiteSpace(dto.CountryCode))
            return Result.Failure<Guid>(Error.Validation("CountryCode", "Le code pays est obligatoire pour un fournisseur non résident."));

        var supplierResult = Supplier.Create(
            name,
            dto.Type,
            addressResult.Value,
            email,
            nif,
            phone,
            dto.ContactPerson?.Trim(),
            dto.PaymentTermDays,
            dto.Notes?.Trim());

        if (supplierResult.IsFailure)
            return Result.Failure<Guid>(supplierResult.Error);

        var supplier = supplierResult.Value;
        supplier.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");

        var resolveResult = await SupplierWithholdingDefaultsResolver.ResolveWithResultAsync(
            dto.DefaultWithholdingTaxTypeId,
            dto.Rs7IsBracket,
            _withholdingTaxRepository,
            cancellationToken);
        if (resolveResult.IsFailure)
            return Result.Failure<Guid>(resolveResult.Error);

        var resolvedTypeId = resolveResult.Value;

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

        await _supplierRepository.AddAsync(supplier, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Supplier.Created,
            "Supplier",
            supplier.Id,
            newValues: new { supplier.Name, Email = supplier.Email?.Value },
            cancellationToken: cancellationToken);

        return Result.Success(supplier.Id);
    }

    private static Result<Guid> DuplicateConflict(Guid existingSupplierId, string field, string message) =>
        Result.Failure<Guid>(Error.Conflict(
            message,
            new Dictionary<string, object?>
            {
                ["existingSupplierId"] = existingSupplierId.ToString(),
                ["field"] = field
            }));
}
