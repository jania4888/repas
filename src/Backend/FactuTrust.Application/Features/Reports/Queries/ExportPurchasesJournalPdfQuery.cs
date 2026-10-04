using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;

namespace FactuTrust.Application.Features.Reports.Queries;

public sealed record ExportPurchasesJournalPdfQuery(
    DateTime FromDate,
    DateTime ToDate,
    SalesJournalViewMode ViewMode,
    PurchasesJournalSource Source,
    Guid? SupplierId = null) : IRequest<Result<InvoicePdfResult>>;

public sealed class ExportPurchasesJournalPdfQueryHandler
    : IRequestHandler<ExportPurchasesJournalPdfQuery, Result<InvoicePdfResult>>
{
    private readonly ISupplierInvoiceRepository _supplierInvoiceRepository;
    private readonly IPurchaseReceiptRepository _purchaseReceiptRepository;
    private readonly ISupplierRepository _supplierRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IPdfService _pdfService;
    private readonly IAuditService _auditService;

    public ExportPurchasesJournalPdfQueryHandler(
        ISupplierInvoiceRepository supplierInvoiceRepository,
        IPurchaseReceiptRepository purchaseReceiptRepository,
        ISupplierRepository supplierRepository,
        ICompanyRepository companyRepository,
        IPdfService pdfService,
        IAuditService auditService)
    {
        _supplierInvoiceRepository = supplierInvoiceRepository;
        _purchaseReceiptRepository = purchaseReceiptRepository;
        _supplierRepository = supplierRepository;
        _companyRepository = companyRepository;
        _pdfService = pdfService;
        _auditService = auditService;
    }

    public async Task<Result<InvoicePdfResult>> Handle(
        ExportPurchasesJournalPdfQuery request,
        CancellationToken cancellationToken)
    {
        var from = request.FromDate.Date;
        var to = request.ToDate.Date;

        var periodCheck = PurchasesJournalReportAssembler.ValidatePeriod(from, to, request.ViewMode);
        if (periodCheck.IsFailure)
            return Result.Failure<InvoicePdfResult>(periodCheck.Error);

        string? supplierName = null;
        if (request.SupplierId.HasValue)
        {
            var supplier = await _supplierRepository.GetByIdAsync(request.SupplierId.Value, cancellationToken);
            if (supplier is null)
                return Result.Failure<InvoicePdfResult>(Error.Validation("Supplier", "Fournisseur introuvable."));
            supplierName = supplier.Name;
        }

        var isReceipt = request.Source == PurchasesJournalSource.PurchaseReceipt;
        IReadOnlyList<PurchasesJournalDetailRowDto> detailRows = Array.Empty<PurchasesJournalDetailRowDto>();
        IReadOnlyList<PurchasesJournalAggregatedRowDto> aggregatedRows = Array.Empty<PurchasesJournalAggregatedRowDto>();
        PurchasesJournalTotalsDto totals;

        if (request.ViewMode == SalesJournalViewMode.Detail)
        {
            var count = isReceipt
                ? await _purchaseReceiptRepository.CountPurchasesJournalDetailAsync(from, to, request.SupplierId, cancellationToken)
                : await _supplierInvoiceRepository.CountPurchasesJournalDetailAsync(from, to, request.SupplierId, cancellationToken);

            if (count == 0)
                return Result.Failure<InvoicePdfResult>(new Error("NoData", PurchasesJournalReportConstants.EmptyPeriodMessage));
            if (count > PurchasesJournalReportConstants.MaxLinesForPdf)
                return Result.Failure<InvoicePdfResult>(new Error("TooManyLines", PurchasesJournalReportConstants.TooManyLinesForPdfMessage));

            detailRows = isReceipt
                ? await _purchaseReceiptRepository.GetPurchasesJournalDetailAllAsync(
                    from, to, request.SupplierId, PurchasesJournalReportConstants.MaxLinesForPdf, cancellationToken)
                : await _supplierInvoiceRepository.GetPurchasesJournalDetailAllAsync(
                    from, to, request.SupplierId, PurchasesJournalReportConstants.MaxLinesForPdf, cancellationToken);

            totals = isReceipt
                ? await _purchaseReceiptRepository.GetPurchasesJournalDetailTotalsAsync(from, to, request.SupplierId, cancellationToken)
                : await _supplierInvoiceRepository.GetPurchasesJournalDetailTotalsAsync(from, to, request.SupplierId, cancellationToken);
        }
        else
        {
            aggregatedRows = isReceipt
                ? await _purchaseReceiptRepository.GetPurchasesJournalAggregatedAsync(
                    from, to, request.SupplierId, request.ViewMode, cancellationToken)
                : await _supplierInvoiceRepository.GetPurchasesJournalAggregatedAsync(
                    from, to, request.SupplierId, request.ViewMode, cancellationToken);

            if (aggregatedRows.Count == 0)
                return Result.Failure<InvoicePdfResult>(new Error("NoData", PurchasesJournalReportConstants.EmptyPeriodMessage));
            if (aggregatedRows.Count > PurchasesJournalReportConstants.MaxLinesForPdf)
                return Result.Failure<InvoicePdfResult>(new Error("TooManyLines", PurchasesJournalReportConstants.TooManyLinesForPdfMessage));

            totals = PurchasesJournalReportAssembler.ComputeAggregatedTotals(aggregatedRows);
        }

        var company = await _companyRepository.GetDefaultAsync(cancellationToken);
        var context = new PurchasesJournalPdfContext(
            Title: PurchasesJournalLabels.Title(),
            ViewModeLabel: PurchasesJournalReportAssembler.ViewModeDisplayLabel(request.ViewMode),
            SourceLabel: PurchasesJournalReportAssembler.SourceDisplayLabel(request.Source),
            From: from,
            To: to,
            SupplierName: supplierName,
            CompanyName: company?.Name,
            MatriculeFiscal: company?.Nif.Value,
            ViewMode: request.ViewMode,
            DetailRows: detailRows,
            AggregatedRows: aggregatedRows,
            Totals: totals,
            RightToLeft: PurchasesJournalLabels.IsArabic);

        var pdfBytes = await _pdfService.GeneratePurchasesJournalReportPdfAsync(context, cancellationToken);

        var sourceSuffix = isReceipt ? "receptions" : "factures";
        var fileName = request.SupplierId.HasValue
            ? $"Journal_achats_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}_{sourceSuffix}_fournisseur.pdf"
            : $"Journal_achats_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}_{sourceSuffix}.pdf";

        await _auditService.LogAsync(
            AuditActions.Export.Pdf,
            "PurchasesJournalReport",
            null,
            cancellationToken: cancellationToken);

        return Result.Success(new InvoicePdfResult(pdfBytes, fileName, "application/pdf"));
    }
}
