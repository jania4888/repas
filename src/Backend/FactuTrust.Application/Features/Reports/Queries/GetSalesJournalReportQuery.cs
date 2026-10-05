using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Common;
using MediatR;

namespace FactuTrust.Application.Features.Reports.Queries;

public sealed record GetSalesJournalReportQuery(
    DateTime FromDate,
    DateTime ToDate,
    SalesJournalViewMode ViewMode,
    Guid? ClientId = null,
    int Page = 1,
    int PageSize = SalesJournalReportConstants.DefaultPageSize) : IRequest<Result<SalesJournalReportResultDto>>;

public sealed class GetSalesJournalReportQueryHandler
    : IRequestHandler<GetSalesJournalReportQuery, Result<SalesJournalReportResultDto>>
{
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IClientRepository _clientRepository;

    public GetSalesJournalReportQueryHandler(
        IInvoiceRepository invoiceRepository,
        IClientRepository clientRepository)
    {
        _invoiceRepository = invoiceRepository;
        _clientRepository = clientRepository;
    }

    public async Task<Result<SalesJournalReportResultDto>> Handle(
        GetSalesJournalReportQuery request,
        CancellationToken cancellationToken)
    {
        var from = request.FromDate.Date;
        var to = request.ToDate.Date;

        var periodCheck = SalesJournalReportAssembler.ValidatePeriod(from, to, request.ViewMode);
        if (periodCheck.IsFailure)
            return Result.Failure<SalesJournalReportResultDto>(periodCheck.Error);

        if (request.ClientId.HasValue)
        {
            var client = await _clientRepository.GetByIdAsync(request.ClientId.Value, cancellationToken);
            if (client is null)
                return Result.Failure<SalesJournalReportResultDto>(Error.Validation("Client", SalesJournalLabels.ClientNotFound()));
        }

        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, SalesJournalReportConstants.MaxPageSize);

        if (request.ViewMode == SalesJournalViewMode.Detail)
        {
            var totals = await _invoiceRepository.GetSalesJournalDetailTotalsAsync(from, to, request.ClientId, cancellationToken);
            var (rows, totalCount) = await _invoiceRepository.GetSalesJournalDetailPagedAsync(
                from, to, request.ClientId, page, pageSize, cancellationToken);

            return Result.Success(new SalesJournalReportResultDto
            {
                ViewMode = SalesJournalReportAssembler.ViewModeWire(request.ViewMode),
                From = from,
                To = to,
                ClientId = request.ClientId,
                TotalRows = totalCount,
                Page = page,
                PageSize = pageSize,
                Totals = totals,
                DetailRows = rows
            });
        }

        var aggregated = await _invoiceRepository.GetSalesJournalAggregatedAsync(
            from, to, request.ClientId, request.ViewMode, cancellationToken);
        var totalsAgg = SalesJournalReportAssembler.ComputeAggregatedTotals(aggregated);
        var totalRows = aggregated.Count;
        var paged = aggregated
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();

        return Result.Success(new SalesJournalReportResultDto
        {
            ViewMode = SalesJournalReportAssembler.ViewModeWire(request.ViewMode),
            From = from,
            To = to,
            ClientId = request.ClientId,
            TotalRows = totalRows,
            Page = page,
            PageSize = pageSize,
            Totals = totalsAgg,
            AggregatedRows = paged
        });
    }
}
