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

namespace FactuTrust.Application.Features.Clients.Commands;

/// <summary>
/// Command to create a new client.
/// </summary>
public sealed record CreateClientCommand(CreateClientDto Dto) : IRequest<Result<Guid>>;

/// <summary>
/// Validator for CreateClientCommand.
/// </summary>
public sealed class CreateClientCommandValidator : AbstractValidator<CreateClientCommand>
{
    public CreateClientCommandValidator()
    {
        RuleFor(x => x.Dto.Name).NotEmpty().WithMessage("Le nom ou la raison sociale est obligatoire");
        RuleFor(x => x.Dto.Street).NotEmpty().WithMessage("L'adresse est obligatoire");
        RuleFor(x => x.Dto.City).NotEmpty().WithMessage("La ville est obligatoire");
        RuleFor(x => x.Dto.Governorate).NotEmpty().WithMessage("Le gouvernorat est obligatoire");

        RuleFor(x => x.Dto.CreditLimit)
            .GreaterThanOrEqualTo(0)
            .When(x => x.Dto.CreditLimit.HasValue)
            .WithMessage("Le plafond d'encours ne peut pas être négatif");

        RuleFor(x => x.Dto.DefaultPaymentTermDays)
            .InclusiveBetween(0, 365)
            .When(x => x.Dto.DefaultPaymentTermDays.HasValue)
            .WithMessage("Le délai doit être compris entre 0 et 365 jours");
    }
}

/// <summary>
/// Handler for CreateClientCommand.
/// </summary>
public sealed class CreateClientCommandHandler : IRequestHandler<CreateClientCommand, Result<Guid>>
{
    private readonly IClientRepository _clientRepository;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly ITenantContext _tenantContext;

    public CreateClientCommandHandler(
        IClientRepository clientRepository,
        IUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IAuditService auditService,
        ITenantContext tenantContext)
    {
        _clientRepository = clientRepository;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _auditService = auditService;
        _tenantContext = tenantContext;
    }

    public async Task<Result<Guid>> Handle(CreateClientCommand request, CancellationToken cancellationToken)
    {
        var dto = request.Dto;

        if (_tenantContext.TenantId is null)
            return Result.Failure<Guid>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        var emailResult = Email.CreateOptional(dto.Email);
        if (emailResult.IsFailure)
            return Result.Failure<Guid>(emailResult.Error);

        var email = emailResult.Value;
        if (email is not null)
        {
            var existingByEmail = await _clientRepository.GetByEmailAsync(email.Value, cancellationToken);
            if (existingByEmail is not null)
                return Result.Failure<Guid>(Error.Conflict("Un client existe déjà avec cet email. Souhaitez-vous l'utiliser ?"));
        }

        NIF? nif = null;
        if (!string.IsNullOrWhiteSpace(dto.Nif))
        {
            var nifResult = NIF.Create(dto.Nif.Trim());
            if (nifResult.IsFailure)
                return Result.Failure<Guid>(nifResult.Error);
            nif = nifResult.Value;

            var existingByNif = await _clientRepository.GetByNifAsync(nif.Value, cancellationToken);
            if (existingByNif is not null)
                return Result.Failure<Guid>(Error.Conflict("Un client existe déjà avec ce matricule fiscal."));
        }
        else if (dto.Type == ClientType.Business)
        {
            return Result.Failure<Guid>(Error.Validation("NIF", "Le matricule fiscal est obligatoire pour un client entreprise."));
        }

        var addressResult = Address.Create(dto.Street, dto.City, dto.Governorate, dto.StreetLine2, dto.PostalCode);
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

        var clientResult = Client.Create(
            dto.Name.Trim(),
            dto.Type,
            addressResult.Value,
            email,
            nif,
            phone,
            dto.ContactPerson?.Trim(),
            dto.Notes?.Trim());

        if (clientResult.IsFailure)
            return Result.Failure<Guid>(clientResult.Error);

        var client = clientResult.Value;

        var creditResult = client.SetCreditTerms(dto.CreditLimit, dto.DefaultPaymentTermDays);
        if (creditResult.IsFailure)
            return Result.Failure<Guid>(creditResult.Error);

        client.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");

        await _clientRepository.AddAsync(client, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Client.Created,
            "Client",
            client.Id,
            newValues: new
            {
                client.Name,
                Email = client.Email?.Value,
                client.CreditLimit,
                client.DefaultPaymentTermDays
            },
            cancellationToken: cancellationToken);

        return Result.Success(client.Id);
    }
}
