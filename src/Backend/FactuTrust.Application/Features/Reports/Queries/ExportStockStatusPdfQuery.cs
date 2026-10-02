using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;

namespace FactuTrust.Application.Features.Reports.Queries;

public sealed record ExportStockStatusPdfQuery(
    Guid? WarehouseId,
    Guid? CategoryId,
    string? Search,
    bool IncludeZeroStock,
    StockStatusGroupingMode GroupingMode) : IRequest<Result<InvoicePdfResult>>;

public sealed class ExportStockStatusPdfQueryHandler
    : IRequestHandler<ExportStockStatusPdfQuery, Result<InvoicePdfResult>>
{
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductCategoryRepository _productCategoryRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IPdfService _pdfService;
    private readonly IAuditService _auditService;
    private readonly TimeProvider _timeProvider;

    public ExportStockStatusPdfQueryHandler(
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        IProductCategoryRepository productCategoryRepository,
        ICompanyRepository companyRepository,
        IPdfService pdfService,
        IAuditService auditService,
        TimeProvider timeProvider)
    {
        _stockItemRepository = stockItemRepository;
        _warehouseRepository = warehouseRepository;
        _productCategoryRepository = productCategoryRepository;
        _companyRepository = companyRepository;
        _pdfService = pdfService;
        _auditService = auditService;
        _timeProvider = timeProvider;
    }

    public async Task<Result<InvoicePdfResult>> Handle(
        ExportStockStatusPdfQuery request,
        CancellationToken cancellationToken)
    {
        string? warehouseName = null;
        if (request.WarehouseId.HasValue)
        {
            var warehouse = await _warehouseRepository.GetByIdAsync(request.WarehouseId.Value, cancellationToken);
            if (warehouse is null)
                return Result.Failure<InvoicePdfResult>(Error.NotFound("Warehouse", request.WarehouseId.Value));
            if (!warehouse.IsActive)
                return Result.Failure<InvoicePdfResult>(
                    Error.Validation("Warehouse", "Cet entrepôt est désactivé."));
            warehouseName = warehouse.Name;
        }

        string? categoryName = null;
        if (request.CategoryId.HasValue)
        {
            var category = await _productCategoryRepository.GetByIdAsync(request.CategoryId.Value, cancellationToken);
            if (category is null)
                return Result.Failure<InvoicePdfResult>(Error.NotFound("Category", request.CategoryId.Value));
            categoryName = category.Name;
        }

        var search = StockStatusReportAssembler.SanitizeSearch(request.Search);

        var count = await _stockItemRepository.CountStockStatusReportRowsAsync(
            request.WarehouseId,
            request.CategoryId,
            search,
            request.IncludeZeroStock,
            cancellationToken);

        if (count == 0)
            return Result.Failure<InvoicePdfResult>(
                new Error("NoData", StockStatusReportConstants.EmptyReportMessage));

        if (count > StockStatusReportConstants.MaxLinesForPdf)
            return Result.Failure<InvoicePdfResult>(
                new Error("TooManyLines", StockStatusReportConstants.TooManyLinesForPdfMessage));

        var (rows, _) = await _stockItemRepository.GetStockStatusReportRowsAsync(
            request.WarehouseId,
            request.CategoryId,
            search,
            request.IncludeZeroStock,
            request.GroupingMode,
            1,
            count,
            cancellationToken);

        var grandQty = rows.Sum(r => r.QuantityOnHand);
        var grandValue = rows.Sum(r => r.StockValue);

        var company = await _companyRepository.GetDefaultAsync(cancellationToken);
        var filtersSummary = BuildFiltersSummary(warehouseName, categoryName, search, request.IncludeZeroStock);
        var generatedLocal = _timeProvider.GetUtcNow().ToOffset(TimeSpan.FromHours(1)).DateTime;

        var context = new StockStatusPdfContext(
            Title: "État de stock",
            GroupingModeLabel: StockStatusReportAssembler.GroupingModeDisplayLabel(request.GroupingMode),
            CompanyName: company?.Name,
            MatriculeFiscal: company?.Nif.Value,
            GeneratedAtLocal: generatedLocal,
            FiltersSummary: filtersSummary,
            GroupingMode: request.GroupingMode,
            Rows: rows,
            GrandTotalQuantity: grandQty,
            GrandTotalValue: grandValue,
            Currency: "TND");

        var pdfBytes = await _pdfService.GenerateStockStatusReportPdfAsync(context, cancellationToken);
        var fileName = $"Etat_stock_{generatedLocal:yyyy-MM-dd_HHmm}.pdf";

        await _auditService.LogAsync(
            AuditActions.Export.Pdf,
            "StockStatusReport",
            null,
            cancellationToken: cancellationToken);

        return Result.Success(new InvoicePdfResult(pdfBytes, fileName, "application/pdf"));
    }

    private static string? BuildFiltersSummary(
        string? warehouseName,
        string? categoryName,
        string? search,
        bool includeZeroStock)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(warehouseName))
            parts.Add($"Entrepôt : {warehouseName}");
        if (!string.IsNullOrWhiteSpace(categoryName))
            parts.Add($"Catégorie : {categoryName}");
        if (!string.IsNullOrWhiteSpace(search))
            parts.Add($"Recherche : {search}");
        if (includeZeroStock)
            parts.Add("Inclut stock à zéro");
        return parts.Count == 0 ? null : string.Join(" — ", parts);
    }
}
