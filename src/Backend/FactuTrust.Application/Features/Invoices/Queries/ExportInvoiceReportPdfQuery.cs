using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Entities;
using MediatR;

namespace FactuTrust.Application.Features.Invoices.Queries;

/// <summary>
/// Query to export the sales invoices report as PDF for a given period and optional client.
/// </summary>
public sealed record ExportInvoiceReportPdfQuery(
    DateTime? FromDate,
    DateTime? ToDate,
    Guid? ClientId = null,
    InvoiceType? Type = null,
    // When true, restricts the report to realized revenue documents (Paid + Validated).
    bool RealizedRevenueOnly = false) : IRequest<Result<InvoicePdfResult>>;

/// <summary>
/// Handler for ExportInvoiceReportPdfQuery.
/// </summary>
public sealed class ExportInvoiceReportPdfQueryHandler : IRequestHandler<ExportInvoiceReportPdfQuery, Result<InvoicePdfResult>>
{
    private const int MaxInvoicesForReport = 1000;

    private readonly IInvoiceRepository _invoiceRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IClientRepository _clientRepository;
    private readonly IPdfService _pdfService;
    private readonly IAuditService _auditService;

    public ExportInvoiceReportPdfQueryHandler(
        IInvoiceRepository invoiceRepository,
        ICompanyRepository companyRepository,
        IClientRepository clientRepository,
        IPdfService pdfService,
        IAuditService auditService)
    {
        _invoiceRepository = invoiceRepository;
        _companyRepository = companyRepository;
        _clientRepository = clientRepository;
        _pdfService = pdfService;
        _auditService = auditService;
    }

    public async Task<Result<InvoicePdfResult>> Handle(ExportInvoiceReportPdfQuery request, CancellationToken cancellationToken)
    {
        if (request.FromDate.HasValue && request.ToDate.HasValue && request.FromDate.Value > request.ToDate.Value)
            return Result.Failure<InvoicePdfResult>(Error.Validation("Period", "La date de début doit être antérieure à la date de fin."));

        var invoices = await _invoiceRepository.GetForReportAsync(
            request.FromDate, request.ToDate, request.ClientId, request.Type, request.RealizedRevenueOnly, cancellationToken);

        var nonCancelled = invoices
            .Where(i => i.Status != InvoiceStatus.Cancelled)
            .ToList();

        var isCreditNotes = request.Type == InvoiceType.CreditNote;
        var emptyMessage = isCreditNotes
            ? "Aucun avoir pour cette période."
            : "Aucune facture pour cette période.";

        if (nonCancelled.Count == 0)
            return Result.Failure<InvoicePdfResult>(new Error("NoInvoices", emptyMessage));

        if (nonCancelled.Count > MaxInvoicesForReport)
            return Result.Failure<InvoicePdfResult>(new Error("TooManyInvoices", "Trop de factures. Réduisez la période."));

        var company = await _companyRepository.GetDefaultAsync(cancellationToken);

        string? clientName = null;
        if (request.ClientId.HasValue)
        {
            var client = await _clientRepository.GetByIdAsync(request.ClientId.Value, cancellationToken);
            clientName = client?.Name;
        }

        var pdfBytes = await _pdfService.GenerateInvoiceReportPdfAsync(
            nonCancelled,
            request.FromDate,
            request.ToDate,
            company,
            clientName,
            request.Type is null ? "Rapport des factures et avoirs" : null);
        
        var filePrefix = isCreditNotes
            ? "Etat_avoirs_ventes"
            : (request.Type is null ? "Etat_factures_avoirs_ventes" : "Etat_factures_ventes");
        var fileName = request.FromDate.HasValue && request.ToDate.HasValue
            ? $"{filePrefix}_{request.FromDate.Value:yyyy-MM-dd}_{request.ToDate.Value:yyyy-MM-dd}.pdf"
            : (!request.FromDate.HasValue && !request.ToDate.HasValue
                ? $"{filePrefix}_toutes.pdf"
                : (!request.FromDate.HasValue
                    ? $"{filePrefix}_jusquau_{request.ToDate!.Value:yyyy-MM-dd}.pdf"
                    : $"{filePrefix}_depuisle_{request.FromDate!.Value:yyyy-MM-dd}.pdf"));

        await _auditService.LogAsync(
            AuditActions.Export.Pdf,
            "InvoiceReport",
            null,
            cancellationToken: cancellationToken);

        return Result.Success(new InvoicePdfResult(pdfBytes, fileName, "application/pdf"));
    }
}
