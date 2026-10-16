using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using MediatR;

namespace FactuTrust.Application.Features.Accounting.Queries;

public sealed record GetChartOfAccountsQuery : IRequest<Result<IReadOnlyList<ChartOfAccountDto>>>;

public sealed class GetChartOfAccountsQueryHandler
    : IRequestHandler<GetChartOfAccountsQuery, Result<IReadOnlyList<ChartOfAccountDto>>>
{
    private readonly IAccountingReportingService _reporting;

    public GetChartOfAccountsQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<IReadOnlyList<ChartOfAccountDto>>> Handle(GetChartOfAccountsQuery request, CancellationToken cancellationToken)
        => _reporting.GetChartOfAccountsAsync(cancellationToken);
}

public sealed record GetJournalEntriesQuery(string? JournalCode, DateTime From, DateTime To, int? Take = null)
    : IRequest<Result<IReadOnlyList<JournalEntryDto>>>;

public sealed class GetJournalEntriesQueryHandler
    : IRequestHandler<GetJournalEntriesQuery, Result<IReadOnlyList<JournalEntryDto>>>
{
    private readonly IAccountingReportingService _reporting;

    public GetJournalEntriesQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<IReadOnlyList<JournalEntryDto>>> Handle(GetJournalEntriesQuery request, CancellationToken cancellationToken)
        => _reporting.GetJournalEntriesAsync(
            request.JournalCode, request.From, request.To, cancellationToken, request.Take);
}

public sealed record GetJournalEntryByIdQuery(Guid Id) : IRequest<Result<JournalEntryDto>>;

public sealed class GetJournalEntryByIdQueryHandler
    : IRequestHandler<GetJournalEntryByIdQuery, Result<JournalEntryDto>>
{
    private readonly IAccountingReportingService _reporting;

    public GetJournalEntryByIdQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<JournalEntryDto>> Handle(GetJournalEntryByIdQuery request, CancellationToken cancellationToken)
        => _reporting.GetJournalEntryByIdAsync(request.Id, cancellationToken);
}

public sealed record GetJournalSummaryQuery(
    DateTime From,
    DateTime To,
    JournalSummaryGrouping Grouping,
    string? JournalCode = null) : IRequest<Result<JournalSummaryDto>>;

public sealed class GetJournalSummaryQueryHandler
    : IRequestHandler<GetJournalSummaryQuery, Result<JournalSummaryDto>>
{
    private readonly IAccountingReportingService _reporting;

    public GetJournalSummaryQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<JournalSummaryDto>> Handle(GetJournalSummaryQuery request, CancellationToken cancellationToken)
        => _reporting.GetJournalSummaryAsync(
            request.From, request.To, request.Grouping, request.JournalCode, cancellationToken);
}

public sealed record GetLedgerQuery(string AccountNumber, DateTime From, DateTime To)
    : IRequest<Result<IReadOnlyList<LedgerRowDto>>>;

public sealed class GetLedgerQueryHandler : IRequestHandler<GetLedgerQuery, Result<IReadOnlyList<LedgerRowDto>>>
{
    private readonly IAccountingReportingService _reporting;

    public GetLedgerQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<IReadOnlyList<LedgerRowDto>>> Handle(GetLedgerQuery request, CancellationToken cancellationToken)
        => _reporting.GetLedgerAsync(request.AccountNumber, request.From, request.To, cancellationToken);
}

public sealed record GetGeneralLedgerQuery(
    string? AccountFrom,
    string? AccountTo,
    DateTime From,
    DateTime To,
    bool IncludeUnmoved = false) : IRequest<Result<GeneralLedgerDto>>;

public sealed class GetGeneralLedgerQueryHandler
    : IRequestHandler<GetGeneralLedgerQuery, Result<GeneralLedgerDto>>
{
    private readonly IAccountingReportingService _reporting;

    public GetGeneralLedgerQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<GeneralLedgerDto>> Handle(GetGeneralLedgerQuery request, CancellationToken cancellationToken)
        => _reporting.GetLedgerRangeAsync(
            request.AccountFrom, request.AccountTo, request.From, request.To, request.IncludeUnmoved, cancellationToken);
}

public sealed record GetLedgerRecapQuery(int Level, DateTime From, DateTime To)
    : IRequest<Result<IReadOnlyList<BalanceRowDto>>>;

public sealed class GetLedgerRecapQueryHandler
    : IRequestHandler<GetLedgerRecapQuery, Result<IReadOnlyList<BalanceRowDto>>>
{
    private readonly IAccountingReportingService _reporting;

    public GetLedgerRecapQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<IReadOnlyList<BalanceRowDto>>> Handle(GetLedgerRecapQuery request, CancellationToken cancellationToken)
        => _reporting.GetLedgerRecapAsync(request.Level, request.From, request.To, cancellationToken);
}

public sealed record GetBalanceQuery(DateTime From, DateTime To)
    : IRequest<Result<IReadOnlyList<BalanceRowDto>>>;

public sealed class GetBalanceQueryHandler : IRequestHandler<GetBalanceQuery, Result<IReadOnlyList<BalanceRowDto>>>
{
    private readonly IAccountingReportingService _reporting;

    public GetBalanceQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<IReadOnlyList<BalanceRowDto>>> Handle(GetBalanceQuery request, CancellationToken cancellationToken)
        => _reporting.GetBalanceAsync(request.From, request.To, cancellationToken);
}

public sealed record GetDetailedBalanceQuery(string? AccountFrom, string? AccountTo, DateTime From, DateTime To)
    : IRequest<Result<DetailedBalanceDto>>;

public sealed class GetDetailedBalanceQueryHandler
    : IRequestHandler<GetDetailedBalanceQuery, Result<DetailedBalanceDto>>
{
    private readonly IAccountingReportingService _reporting;

    public GetDetailedBalanceQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<DetailedBalanceDto>> Handle(GetDetailedBalanceQuery request, CancellationToken cancellationToken)
        => _reporting.GetDetailedBalanceAsync(
            request.AccountFrom, request.AccountTo, request.From, request.To, cancellationToken);
}

public sealed record GetPeriodicBalanceQuery(int FiscalYear) : IRequest<Result<PeriodicBalanceDto>>;

public sealed class GetPeriodicBalanceQueryHandler
    : IRequestHandler<GetPeriodicBalanceQuery, Result<PeriodicBalanceDto>>
{
    private readonly IAccountingReportingService _reporting;

    public GetPeriodicBalanceQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<PeriodicBalanceDto>> Handle(GetPeriodicBalanceQuery request, CancellationToken cancellationToken)
        => _reporting.GetBalanceByPeriodAsync(request.FiscalYear, cancellationToken);
}

public sealed record GetAccountingDashboardQuery : IRequest<Result<AccountingDashboardDto>>;

public sealed class GetAccountingDashboardQueryHandler
    : IRequestHandler<GetAccountingDashboardQuery, Result<AccountingDashboardDto>>
{
    private readonly IAccountingReportingService _reporting;
    private readonly IMediator _mediator;

    public GetAccountingDashboardQueryHandler(IAccountingReportingService reporting, IMediator mediator)
    {
        _reporting = reporting;
        _mediator = mediator;
    }

    public async Task<Result<AccountingDashboardDto>> Handle(GetAccountingDashboardQuery request, CancellationToken cancellationToken)
    {
        var dashboard = await _reporting.GetDashboardAsync(cancellationToken);
        if (dashboard.IsFailure)
            return dashboard;

        // Single source of truth: the dashboard "TVA due" estimate must match the dedicated
        // VAT declaration page exactly (same invoice/purchase source + carried-over credit) for
        // the current month — instead of the parallel journal-based approximation.
        var now = DateTime.UtcNow;
        // Estimation : elle doit suivre les écritures du mois en cours, pas le dernier dépôt.
        var vat = await _mediator.Send(
            new GetVatDeclarationQuery(now.Year, now.Month, Valuation: VatDeclarationValuation.Live),
            cancellationToken);
        if (vat.IsSuccess)
            return Result.Success(dashboard.Value with { VatDueEstimate = vat.Value.VatDue });

        // Fallback: keep the service's journal-based estimate if the declaration cannot be computed.
        return dashboard;
    }
}

public sealed record GetAccountingPeriodsQuery : IRequest<Result<IReadOnlyList<AccountingPeriodDto>>>;

public sealed class GetAccountingPeriodsQueryHandler
    : IRequestHandler<GetAccountingPeriodsQuery, Result<IReadOnlyList<AccountingPeriodDto>>>
{
    private readonly IAccountingReportingService _reporting;

    public GetAccountingPeriodsQueryHandler(IAccountingReportingService reporting)
    {
        _reporting = reporting;
    }

    public Task<Result<IReadOnlyList<AccountingPeriodDto>>> Handle(GetAccountingPeriodsQuery request, CancellationToken cancellationToken)
        => _reporting.GetPeriodsAsync(cancellationToken);
}
