using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Application.Features.Clients.Commands;

/// <summary>
/// Command to delete a client.
/// </summary>
public sealed record DeleteClientCommand(Guid Id) : IRequest<Result<Unit>>;

/// <summary>
/// Handler for DeleteClientCommand.
/// </summary>
public sealed class DeleteClientCommandHandler : IRequestHandler<DeleteClientCommand, Result<Unit>>
{
    private readonly IClientRepository _clientRepository;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditService _auditService;

    public DeleteClientCommandHandler(
        IClientRepository clientRepository,
        IUnitOfWork unitOfWork,
        IAuditService auditService)
    {
        _clientRepository = clientRepository;
        _unitOfWork = unitOfWork;
        _auditService = auditService;
    }

    public async Task<Result<Unit>> Handle(DeleteClientCommand request, CancellationToken cancellationToken)
    {
        var client = await _clientRepository.GetByIdAsync(request.Id, cancellationToken);
        if (client is null)
            return Result.Failure<Unit>(Error.NotFound("Client", request.Id));

        var hasInvoices = await _clientRepository.HasInvoicesAsync(request.Id, cancellationToken);
        if (hasInvoices)
            return Result.Failure<Unit>(Error.Validation("Client",
                "Ce client a des factures. Désactivez-le plutôt que de le supprimer."));

        var hasQuotes = await _clientRepository.HasQuotesAsync(request.Id, cancellationToken);
        if (hasQuotes)
            return Result.Failure<Unit>(Error.Validation("Client",
                "Ce client a des devis. Désactivez-le plutôt que de le supprimer."));

        await _clientRepository.DeleteAsync(client, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Client.Deleted,
            "Client",
            request.Id,
            oldValues: new { client.Name, Email = client.Email?.Value },
            cancellationToken: cancellationToken);

        return Result.Success(Unit.Value);
    }
}
