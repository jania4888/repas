using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using MediatR;

namespace FactuTrust.Application.Features.Reports.Queries;

public sealed record GetPurchasesJournalReportQuery(
    DateTime FromDate,
    DateTime ToDate,
    SalesJournalViewMode ViewMode,
    PurchasesJournalSource Source,
    Guid? SupplierId = null,
    int Page = 1,
    int PageSize = PurchasesJournalReportConstants.DefaultPageSize) : IRequest<Result<PurchasesJournalReportResultDto>>;

public sealed class GetPurchasesJournalReportQueryHandler
    : IRequestHandler<GetPurchasesJournalReportQuery, Result<PurchasesJournalReportResultDto>>
{
    private readonly ISupplierInvoiceRepository _supplierInvoiceRepository;
    private readonly IPurchaseReceiptRepository _purchaseReceiptRepository;
    private readonly ISupplierRepository _supplierRepository;

    public GetPurchasesJournalReportQueryHandler(
        ISupplierInvoiceRepository supplierInvoiceRepository,
        IPurchaseReceiptRepository purchaseReceiptRepository,
        ISupplierRepository supplierRepository)
    {
        _supplierInvoiceRepository = supplierInvoiceRepository;
        _purchaseReceiptRepository = purchaseReceiptRepository;
        _supplierRepository = supplierRepository;
    }

    public async Task<Result<PurchasesJournalReportResultDto>> Handle(
        GetPurchasesJournalReportQuery request,
        CancellationToken cancellationToken)
    {
        var from = request.FromDate.Date;
        var to = request.ToDate.Date;

        var periodCheck = PurchasesJournalReportAssembler.ValidatePeriod(from, to, request.ViewMode);
        if (periodCheck.IsFailure)
            return Result.Failure<PurchasesJournalReportResultDto>(periodCheck.Error);

        if (request.SupplierId.HasValue)
        {
            var supplier = await _supplierRepository.GetByIdAsync(request.SupplierId.Value, cancellationToken);
            if (supplier is null)
                return Result.Failure<PurchasesJournalReportResultDto>(Error.Validation("Supplier", "Fournisseur introuvable."));
        }

        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, PurchasesJournalReportConstants.MaxPageSize);
        var sourceWire = PurchasesJournalReportAssembler.SourceWire(request.Source);
        var viewWire = PurchasesJournalReportAssembler.ViewModeWire(request.ViewMode);

        if (request.ViewMode == SalesJournalViewMode.Detail)
        {
            var (rows, totalCount) = request.Source == PurchasesJournalSource.PurchaseReceipt
                ? await _purchaseReceiptRepository.GetPurchasesJournalDetailPagedAsync(
                    from, to, request.SupplierId, page, pageSize, cancellationToken)
                : await _supplierInvoiceRepository.GetPurchasesJournalDetailPagedAsync(
                    from, to, request.SupplierId, page, pageSize, cancellationToken);

            var totals = request.Source == PurchasesJournalSource.PurchaseReceipt
                ? await _purchaseReceiptRepository.GetPurchasesJournalDetailTotalsAsync(
                    from, to, request.SupplierId, cancellationToken)
                : await _supplierInvoiceRepository.GetPurchasesJournalDetailTotalsAsync(
                    from, to, request.SupplierId, cancellationToken);

            return Result.Success(new PurchasesJournalReportResultDto
            {
                Source = sourceWire,
                ViewMode = viewWire,
                From = from,
                To = to,
                SupplierId = request.SupplierId,
                TotalRows = totalCount,
                Page = page,
                PageSize = pageSize,
                Totals = totals,
                DetailRows = rows
            });
        }

        var aggregated = request.Source == PurchasesJournalSource.PurchaseReceipt
            ? await _purchaseReceiptRepository.GetPurchasesJournalAggregatedAsync(
                from, to, request.SupplierId, request.ViewMode, cancellationToken)
            : await _supplierInvoiceRepository.GetPurchasesJournalAggregatedAsync(
                from, to, request.SupplierId, request.ViewMode, cancellationToken);

        var totalsAgg = PurchasesJournalReportAssembler.ComputeAggregatedTotals(aggregated);
        var totalRows = aggregated.Count;
        var paged = aggregated
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();

        return Result.Success(new PurchasesJournalReportResultDto
        {
            Source = sourceWire,
            ViewMode = viewWire,
            From = from,
            To = to,
            SupplierId = request.SupplierId,
            TotalRows = totalRows,
            Page = page,
            PageSize = pageSize,
            Totals = totalsAgg,
            AggregatedRows = paged
        });
    }
}
