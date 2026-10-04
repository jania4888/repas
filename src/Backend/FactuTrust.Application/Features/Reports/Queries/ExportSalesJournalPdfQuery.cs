using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;

namespace FactuTrust.Application.Features.Reports.Queries;

public sealed record ExportSalesJournalPdfQuery(
    DateTime FromDate,
    DateTime ToDate,
    SalesJournalViewMode ViewMode,
    Guid? ClientId = null) : IRequest<Result<InvoicePdfResult>>;

public sealed class ExportSalesJournalPdfQueryHandler
    : IRequestHandler<ExportSalesJournalPdfQuery, Result<InvoicePdfResult>>
{
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IClientRepository _clientRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IPdfService _pdfService;
    private readonly IAuditService _auditService;

    public ExportSalesJournalPdfQueryHandler(
        IInvoiceRepository invoiceRepository,
        IClientRepository clientRepository,
        ICompanyRepository companyRepository,
        IPdfService pdfService,
        IAuditService auditService)
    {
        _invoiceRepository = invoiceRepository;
        _clientRepository = clientRepository;
        _companyRepository = companyRepository;
        _pdfService = pdfService;
        _auditService = auditService;
    }

    public async Task<Result<InvoicePdfResult>> Handle(
        ExportSalesJournalPdfQuery request,
        CancellationToken cancellationToken)
    {
        var from = request.FromDate.Date;
        var to = request.ToDate.Date;

        var periodCheck = SalesJournalReportAssembler.ValidatePeriod(from, to, request.ViewMode);
        if (periodCheck.IsFailure)
            return Result.Failure<InvoicePdfResult>(periodCheck.Error);

        string? clientName = null;
        if (request.ClientId.HasValue)
        {
            var client = await _clientRepository.GetByIdAsync(request.ClientId.Value, cancellationToken);
            if (client is null)
                return Result.Failure<InvoicePdfResult>(Error.Validation("Client", SalesJournalLabels.ClientNotFound()));
            clientName = client.Name;
        }

        IReadOnlyList<SalesJournalDetailRowDto> detailRows = Array.Empty<SalesJournalDetailRowDto>();
        IReadOnlyList<SalesJournalAggregatedRowDto> aggregatedRows = Array.Empty<SalesJournalAggregatedRowDto>();
        SalesJournalTotalsDto totals;

        if (request.ViewMode == SalesJournalViewMode.Detail)
        {
            var count = await _invoiceRepository.CountSalesJournalDetailAsync(from, to, request.ClientId, cancellationToken);
            if (count == 0)
                return Result.Failure<InvoicePdfResult>(new Error("NoData", SalesJournalLabels.EmptyPeriod()));
            if (count > SalesJournalReportConstants.MaxLinesForPdf)
                return Result.Failure<InvoicePdfResult>(new Error("TooManyLines", SalesJournalLabels.TooManyLines()));

            detailRows = await _invoiceRepository.GetSalesJournalDetailAllAsync(
                from, to, request.ClientId, SalesJournalReportConstants.MaxLinesForPdf, cancellationToken);
            totals = await _invoiceRepository.GetSalesJournalDetailTotalsAsync(from, to, request.ClientId, cancellationToken);
        }
        else
        {
            aggregatedRows = await _invoiceRepository.GetSalesJournalAggregatedAsync(
                from, to, request.ClientId, request.ViewMode, cancellationToken);
            if (aggregatedRows.Count == 0)
                return Result.Failure<InvoicePdfResult>(new Error("NoData", SalesJournalLabels.EmptyPeriod()));
            if (aggregatedRows.Count > SalesJournalReportConstants.MaxLinesForPdf)
                return Result.Failure<InvoicePdfResult>(new Error("TooManyLines", SalesJournalLabels.TooManyLines()));

            totals = SalesJournalReportAssembler.ComputeAggregatedTotals(aggregatedRows);
        }

        var company = await _companyRepository.GetDefaultAsync(cancellationToken);
        var context = new SalesJournalPdfContext(
            Title: SalesJournalLabels.Title(),
            ViewModeLabel: SalesJournalReportAssembler.ViewModeDisplayLabel(request.ViewMode),
            From: from,
            To: to,
            ClientName: clientName,
            CompanyName: company?.Name,
            MatriculeFiscal: company?.Nif.Value,
            ViewMode: request.ViewMode,
            DetailRows: detailRows,
            AggregatedRows: aggregatedRows,
            Totals: totals,
            RightToLeft: SalesJournalLabels.IsArabic);

        var pdfBytes = await _pdfService.GenerateSalesJournalReportPdfAsync(context, cancellationToken);

        var fileName = request.ClientId.HasValue
            ? $"Journal_ventes_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}_client.pdf"
            : $"Journal_ventes_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.pdf";

        await _auditService.LogAsync(
            AuditActions.Export.Pdf,
            "SalesJournalReport",
            null,
            cancellationToken: cancellationToken);

        return Result.Success(new InvoicePdfResult(pdfBytes, fileName, "application/pdf"));
    }
}
