using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Accounting.Lettering;

/// <summary>Filtres de <c>GET api/accounting/lettering/lines</c> (plan de refonte, §4.1).</summary>
public sealed record GetLetteringLinesQuery(
    string Account,
    LetteringAccountMatch AccountMatch,
    DateTime From,
    DateTime To,
    LetteringStateFilter State,
    string? JournalCode,
    IReadOnlyList<string>? SourceCategories,
    Guid? ThirdPartyId,
    ThirdPartyKind? ThirdPartyKind,
    LetteringSideFilter Side,
    decimal? MinAmount,
    decimal? MaxAmount,
    string? Search,
    int Page = 1,
    int PageSize = 500) : IRequest<Result<LetteringLinesPageDto>>;

public sealed class GetLetteringLinesQueryHandler
    : IRequestHandler<GetLetteringLinesQuery, Result<LetteringLinesPageDto>>
{
    private readonly ILetteringQueryService _query;

    public GetLetteringLinesQueryHandler(ILetteringQueryService query) => _query = query;

    public Task<Result<LetteringLinesPageDto>> Handle(GetLetteringLinesQuery request, CancellationToken cancellationToken) =>
        _query.GetLinesAsync(request, cancellationToken);
}

/// <summary>Filtres de <c>GET api/accounting/lettering/groups/{code}</c> (plan §4.2).</summary>
public sealed record GetLetteringGroupQuery(string Code) : IRequest<Result<LetteringGroupDto>>;

public sealed class GetLetteringGroupQueryHandler
    : IRequestHandler<GetLetteringGroupQuery, Result<LetteringGroupDto>>
{
    private readonly ILetteringQueryService _query;

    public GetLetteringGroupQueryHandler(ILetteringQueryService query) => _query = query;

    public Task<Result<LetteringGroupDto>> Handle(GetLetteringGroupQuery request, CancellationToken cancellationToken) =>
        _query.GetGroupAsync(request.Code, cancellationToken);
}
