using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using MediatR;

namespace FactuTrust.Application.Features.Accounting.Commands;

public sealed record EnsureBankGlProjectionsCommand : IRequest<Result<BankGlProjectionEnsureResult>>;

public sealed class EnsureBankGlProjectionsCommandHandler
    : IRequestHandler<EnsureBankGlProjectionsCommand, Result<BankGlProjectionEnsureResult>>
{
    private readonly IBankGlTreasuryProjectionService _projection;

    public EnsureBankGlProjectionsCommandHandler(IBankGlTreasuryProjectionService projection)
    {
        _projection = projection;
    }

    public Task<Result<BankGlProjectionEnsureResult>> Handle(
        EnsureBankGlProjectionsCommand request,
        CancellationToken cancellationToken) =>
        _projection.EnsureMissingAsync(cancellationToken);
}

public sealed record GetImportableBankAccountsQuery : IRequest<Result<IReadOnlyList<ImportableBankAccountDto>>>;

public sealed class GetImportableBankAccountsQueryHandler
    : IRequestHandler<GetImportableBankAccountsQuery, Result<IReadOnlyList<ImportableBankAccountDto>>>
{
    private readonly IBankGlTreasuryProjectionService _projection;

    public GetImportableBankAccountsQueryHandler(IBankGlTreasuryProjectionService projection)
    {
        _projection = projection;
    }

    public Task<Result<IReadOnlyList<ImportableBankAccountDto>>> Handle(
        GetImportableBankAccountsQuery request,
        CancellationToken cancellationToken) =>
        _projection.ListImportableAsync(cancellationToken);
}
