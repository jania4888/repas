using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.ValueObjects;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.Clients.Commands;

/// <summary>
/// Command to update an existing client.
/// </summary>
public sealed record UpdateClientCommand(Guid Id, UpdateClientDto Dto) : IRequest<Result<ClientDetailDto>>;

/// <summary>
/// Validator for UpdateClientCommand.
/// </summary>
public sealed class UpdateClientCommandValidator : AbstractValidator<UpdateClientCommand>
{
    public UpdateClientCommandValidator()
    {
        RuleFor(x => x.Id).NotEqual(Guid.Empty).WithMessage("Identifiant client invalide.");
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
/// Handler for UpdateClientCommand.
/// </summary>
public sealed class UpdateClientCommandHandler : IRequestHandler<UpdateClientCommand, Result<ClientDetailDto>>
{
    private readonly IClientRepository _clientRepository;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;

    public UpdateClientCommandHandler(
        IClientRepository clientRepository,
        IUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IAuditService auditService)
    {
        _clientRepository = clientRepository;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _auditService = auditService;
    }

    public async Task<Result<ClientDetailDto>> Handle(UpdateClientCommand request, CancellationToken cancellationToken)
    {
        var client = await _clientRepository.GetByIdAsync(request.Id, cancellationToken);
        if (client is null)
            return Result.Failure<ClientDetailDto>(Error.NotFound("Client", request.Id));

        var dto = request.Dto;

        var emailResult = Email.CreateOptional(dto.Email);
        if (emailResult.IsFailure)
            return Result.Failure<ClientDetailDto>(emailResult.Error);

        var email = emailResult.Value;
        if (email is not null)
        {
            var existingByEmail = await _clientRepository.GetByEmailExcludingIdAsync(email.Value, request.Id, cancellationToken);
            if (existingByEmail is not null)
                return Result.Failure<ClientDetailDto>(Error.Conflict("Un client existe déjà avec cet email."));
        }

        var addressResult = Address.Create(dto.Street, dto.City, dto.Governorate, dto.StreetLine2, dto.PostalCode);
        if (addressResult.IsFailure)
            return Result.Failure<ClientDetailDto>(addressResult.Error);

        PhoneNumber? phone = null;
        if (!string.IsNullOrWhiteSpace(dto.Phone))
        {
            var phoneResult = PhoneNumber.Create(dto.Phone.Trim());
            if (phoneResult.IsFailure)
                return Result.Failure<ClientDetailDto>(phoneResult.Error);
            phone = phoneResult.Value;
        }

        client.Update(
            dto.Name.Trim(),
            addressResult.Value,
            email,
            phone,
            dto.ContactPerson?.Trim(),
            dto.Notes?.Trim());

        var creditResult = client.SetCreditTerms(dto.CreditLimit, dto.DefaultPaymentTermDays);
        if (creditResult.IsFailure)
            return Result.Failure<ClientDetailDto>(creditResult.Error);

        if (dto.IsActive != client.IsActive)
        {
            if (dto.IsActive) client.Reactivate();
            else client.Deactivate();
        }

        client.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);

        await _clientRepository.UpdateAsync(client, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Client.Updated,
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

        return Result.Success(ClientDtoMapper.ToDetailDto(client));
    }
}
