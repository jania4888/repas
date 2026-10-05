using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Common;
using MediatR;

namespace FactuTrust.Application.Features.Reports.Queries;

public sealed record GetStockStatusReportQuery(
    Guid? WarehouseId,
    Guid? CategoryId,
    string? Search,
    bool IncludeZeroStock,
    StockStatusGroupingMode GroupingMode,
    int Page = 1,
    int PageSize = StockStatusReportConstants.DefaultPageSize) : IRequest<Result<StockStatusReportResultDto>>;

public sealed class GetStockStatusReportQueryHandler
    : IRequestHandler<GetStockStatusReportQuery, Result<StockStatusReportResultDto>>
{
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductCategoryRepository _productCategoryRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly ITenantContext _tenantContext;
    private readonly TimeProvider _timeProvider;

    public GetStockStatusReportQueryHandler(
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        IProductCategoryRepository productCategoryRepository,
        ICompanyRepository companyRepository,
        ITenantContext tenantContext,
        TimeProvider timeProvider)
    {
        _stockItemRepository = stockItemRepository;
        _warehouseRepository = warehouseRepository;
        _productCategoryRepository = productCategoryRepository;
        _companyRepository = companyRepository;
        _tenantContext = tenantContext;
        _timeProvider = timeProvider;
    }

    public async Task<Result<StockStatusReportResultDto>> Handle(
        GetStockStatusReportQuery request,
        CancellationToken cancellationToken)
    {
        if (_tenantContext.TenantId is null)
            return Result.Failure<StockStatusReportResultDto>(
                Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        if (request.Page < 1)
            return Result.Failure<StockStatusReportResultDto>(
                Error.Validation("Page", "Le numéro de page doit être supérieur ou égal à 1."));

        var pageSize = request.PageSize;
        if (pageSize < 1 || pageSize > StockStatusReportConstants.MaxPageSize)
            pageSize = StockStatusReportConstants.DefaultPageSize;

        string? warehouseName = null;
        if (request.WarehouseId.HasValue)
        {
            var warehouse = await _warehouseRepository.GetByIdAsync(request.WarehouseId.Value, cancellationToken);
            if (warehouse is null)
                return Result.Failure<StockStatusReportResultDto>(
                    Error.NotFound("Warehouse", request.WarehouseId.Value));
            if (!warehouse.IsActive)
                return Result.Failure<StockStatusReportResultDto>(
                    Error.Validation("Warehouse", StockStatusLabels.WarehouseDisabled()));
            warehouseName = warehouse.Name;
        }

        string? categoryName = null;
        if (request.CategoryId.HasValue)
        {
            var category = await _productCategoryRepository.GetByIdAsync(request.CategoryId.Value, cancellationToken);
            if (category is null)
                return Result.Failure<StockStatusReportResultDto>(
                    Error.NotFound("Category", request.CategoryId.Value));
            categoryName = category.Name;
        }

        var search = StockStatusReportAssembler.SanitizeSearch(request.Search);

        var (rows, totalCount) = await _stockItemRepository.GetStockStatusReportRowsAsync(
            request.WarehouseId,
            request.CategoryId,
            search,
            request.IncludeZeroStock,
            request.GroupingMode,
            request.Page,
            pageSize,
            cancellationToken);

        decimal grandQty = 0;
        decimal grandValue = 0;
        if (totalCount > 0)
        {
            var (allRows, _) = await _stockItemRepository.GetStockStatusReportRowsAsync(
                request.WarehouseId,
                request.CategoryId,
                search,
                request.IncludeZeroStock,
                request.GroupingMode,
                1,
                totalCount,
                cancellationToken);
            grandQty = allRows.Sum(r => r.QuantityOnHand);
            grandValue = allRows.Sum(r => r.StockValue);
        }

        _ = await _companyRepository.GetDefaultAsync(cancellationToken);
        const string currency = "TND";

        var filtersSummary = StockStatusReportAssembler.BuildFiltersSummary(
            warehouseName, categoryName, search, request.IncludeZeroStock);

        return Result.Success(new StockStatusReportResultDto
        {
            GroupingMode = request.GroupingMode.ToString(),
            TotalRows = totalCount,
            Page = request.Page,
            PageSize = pageSize,
            GrandTotalQuantity = grandQty,
            GrandTotalValue = grandValue,
            Currency = currency,
            GeneratedAtUtc = _timeProvider.GetUtcNow().UtcDateTime,
            FiltersSummary = filtersSummary,
            Rows = rows
        });
    }
}
