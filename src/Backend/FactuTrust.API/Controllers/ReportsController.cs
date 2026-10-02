using FactuTrust.API.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Application.Features.Reports.Queries;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

/// <summary>
/// API for report data (client/supplier payments, transactions, etc.).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ReportsController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<ReportsController> _logger;

    public ReportsController(IMediator mediator, ILogger<ReportsController> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    /// <summary>
    /// Get client payments (encaissements) for a date range.
    /// </summary>
    [HttpGet("client-payments")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ClientPaymentReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetClientPayments(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var query = new GetClientPaymentsReportQuery(from.Value, to.Value);
        var result = await _mediator.Send(query, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ClientPaymentReportRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get supplier payments (décaissements) for a date range.
    /// </summary>
    [HttpGet("supplier-payments")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SupplierPaymentReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetSupplierPayments(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var query = new GetSupplierPaymentsReportQuery(from.Value, to.Value);
        var result = await _mediator.Send(query, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<SupplierPaymentReportRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get client transactions (invoices + payments) for a date range.
    /// </summary>
    [HttpGet("client-transactions")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ClientTransactionReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetClientTransactions(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var query = new GetClientTransactionsReportQuery(from.Value, to.Value);
        var result = await _mediator.Send(query, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ClientTransactionReportRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get supplier transactions (invoices + payments) for a date range.
    /// </summary>
    [HttpGet("supplier-transactions")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SupplierTransactionReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetSupplierTransactions(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var query = new GetSupplierTransactionsReportQuery(from.Value, to.Value);
        var result = await _mediator.Send(query, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<SupplierTransactionReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("sales-by-line")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SalesByLineReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSalesByLine(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue) return BadRequest(ApiResponse<object>.Fail("from et to requis."));
        if (from.Value > to.Value) return BadRequest(ApiResponse<object>.Fail("from ne peut pas être après to."));
        var result = await _mediator.Send(new GetSalesByLineReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<SalesByLineReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("sales-vat")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SalesVatReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSalesVat(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue) return BadRequest(ApiResponse<object>.Fail("from et to requis."));
        if (from.Value > to.Value) return BadRequest(ApiResponse<object>.Fail("from ne peut pas être après to."));
        var result = await _mediator.Send(new GetSalesVatReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<SalesVatReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("sales-revenue-by-product")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SalesRevenueReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSalesRevenueByProduct(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] string? groupBy = "Product",
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue) return BadRequest(ApiResponse<object>.Fail("from et to requis."));
        if (from.Value > to.Value) return BadRequest(ApiResponse<object>.Fail("from ne peut pas être après to."));
        var g = groupBy?.ToLowerInvariant() switch
        {
            "category" => SalesRevenueGroupBy.Category,
            "productandclient" or "productAndClient" => SalesRevenueGroupBy.ProductAndClient,
            "client" => SalesRevenueGroupBy.Client,
            _ => SalesRevenueGroupBy.Product
        };
        var result = await _mediator.Send(new GetSalesRevenueByProductReportQuery(from.Value, to.Value, g), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<SalesRevenueReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("purchases-by-line")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<PurchasesByLineReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPurchasesByLine(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue) return BadRequest(ApiResponse<object>.Fail("from et to requis."));
        if (from.Value > to.Value) return BadRequest(ApiResponse<object>.Fail("from ne peut pas être après to."));
        var result = await _mediator.Send(new GetPurchasesByLineReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<PurchasesByLineReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("purchases-vat")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<PurchasesVatReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPurchasesVat(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue) return BadRequest(ApiResponse<object>.Fail("from et to requis."));
        if (from.Value > to.Value) return BadRequest(ApiResponse<object>.Fail("from ne peut pas être après to."));
        var result = await _mediator.Send(new GetPurchasesVatReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<PurchasesVatReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("client-balances")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ClientBalanceReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetClientBalances(CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new GetClientBalancesReportQuery(), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ClientBalanceReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("supplier-balances")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SupplierBalanceReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSupplierBalances(CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new GetSupplierBalancesReportQuery(), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<SupplierBalanceReportRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get client withholdings (retenues subies) aggregated by client for a payment date range.
    /// </summary>
    [HttpGet("client-withholdings")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ClientWithholdingReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetClientWithholdings(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var result = await _mediator.Send(new GetClientWithholdingsReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ClientWithholdingReportRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get supplier withholdings aggregated by supplier for a PaidAt date range.
    /// </summary>
    [HttpGet("supplier-withholdings")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<SupplierWithholdingReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetSupplierWithholdings(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var result = await _mediator.Send(new GetSupplierWithholdingsReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<SupplierWithholdingReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("commercial-profit")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<CommercialProfitReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCommercialProfit(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? groupBy = "Product",
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue) return BadRequest(ApiResponse<object>.Fail("from et to requis."));
        if (from.Value > to.Value) return BadRequest(ApiResponse<object>.Fail("from ne peut pas être après to."));
        var g = groupBy?.ToLowerInvariant() switch
        {
            "line" => CommercialProfitGroupBy.Line,
            "month" => CommercialProfitGroupBy.Month,
            "piece" or "invoice" => CommercialProfitGroupBy.Piece,
            _ => CommercialProfitGroupBy.Product
        };
        var result = await _mediator.Send(new GetCommercialProfitReportQuery(from.Value, to.Value, g), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<CommercialProfitReportRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get stock movements report (mouvement détaillé de stock), paginated.
    /// </summary>
    [HttpGet("stock-movements")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<StockMovementsReportResult>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetStockMovements(
        [FromQuery] Guid? warehouseId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 100) pageSize = 20;
        var (items, totalCount) = await _mediator.Send(
            new GetStockMovementsReportQuery(warehouseId, from, to, page, pageSize),
            cancellationToken);
        var payload = new StockMovementsReportResult(items, totalCount, page, pageSize);
        return Ok(ApiResponse<StockMovementsReportResult>.Ok(payload));
    }

    /// <summary>
    /// Get stock snapshot at a given date (état de stock à une date antérieure).
    /// </summary>
    [HttpGet("stock-snapshot")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<StockSnapshotRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetStockSnapshot(
        [FromQuery] DateTime? asOf,
        [FromQuery] Guid? warehouseId,
        CancellationToken cancellationToken = default)
    {
        if (!asOf.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Le paramètre asOf est requis (format: yyyy-MM-dd)."));
        var result = await _mediator.Send(new GetStockSnapshotAtDateQuery(asOf.Value, warehouseId), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<StockSnapshotRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Current stock status report (état de stock), grouped by warehouse and category.
    /// </summary>
    [HttpGet("stock-status")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<StockStatusReportResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetStockStatus(
        [FromQuery] Guid? warehouseId,
        [FromQuery] Guid? categoryId,
        [FromQuery] string? search,
        [FromQuery] bool includeZeroStock = false,
        [FromQuery] string? groupingMode = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = StockStatusReportConstants.DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        var mode = StockStatusReportAssembler.ParseGroupingMode(groupingMode);
        var result = await _mediator.Send(
            new GetStockStatusReportQuery(
                warehouseId,
                categoryId,
                search,
                includeZeroStock,
                mode,
                page,
                pageSize),
            cancellationToken);
        if (result.IsFailure)
        {
            if (result.Error.Code.EndsWith(".NotFound", StringComparison.Ordinal)
                || result.Error.Code == "NotFound")
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<StockStatusReportResultDto>.Ok(result.Value));
    }

    [HttpGet("stock-status/pdf")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ExportStockStatusPdf(
        [FromQuery] Guid? warehouseId,
        [FromQuery] Guid? categoryId,
        [FromQuery] string? search,
        [FromQuery] bool includeZeroStock = false,
        [FromQuery] string? groupingMode = null,
        CancellationToken cancellationToken = default)
    {
        var mode = StockStatusReportAssembler.ParseGroupingMode(groupingMode);
        var result = await _mediator.Send(
            new ExportStockStatusPdfQuery(
                warehouseId,
                categoryId,
                search,
                includeZeroStock,
                mode),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));

        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }

    /// <summary>
    /// Get product performance report (classement avec marge et part du CA).
    /// </summary>
    [HttpGet("product-performance")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ProductPerformanceReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetProductPerformance(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));
        var result = await _mediator.Send(new GetProductPerformanceReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ProductPerformanceReportRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get product sales trend report (évolution ventes par produit par mois).
    /// </summary>
    [HttpGet("product-sales-trend")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ProductSalesTrendRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetProductSalesTrend(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));
        var result = await _mediator.Send(new GetProductSalesTrendReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ProductSalesTrendRowDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get basket metrics report (panier moyen et lignes par facture).
    /// </summary>
    [HttpGet("basket-metrics")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<BasketMetricsReportDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetBasketMetrics(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));
        var result = await _mediator.Send(new GetBasketMetricsReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<BasketMetricsReportDto>.Ok(result.Value));
    }

    /// <summary>
    /// Get products never sold report (produits actifs sans vente sur la période).
    /// </summary>
    [HttpGet("products-never-sold")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ProductNeverSoldReportRowDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetProductsNeverSold(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));
        var result = await _mediator.Send(new GetProductsNeverSoldReportQuery(from.Value, to.Value), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ProductNeverSoldReportRowDto>>.Ok(result.Value));
    }

    [HttpGet("sales-journal")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<SalesJournalReportResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetSalesJournal(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? viewMode,
        [FromQuery] Guid? clientId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = SalesJournalReportConstants.DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var mode = SalesJournalReportAssembler.ParseViewMode(viewMode);
        var result = await _mediator.Send(
            new GetSalesJournalReportQuery(from.Value, to.Value, mode, clientId, page, pageSize),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<SalesJournalReportResultDto>.Ok(result.Value));
    }

    [HttpGet("sales-journal/pdf")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ExportSalesJournalPdf(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? viewMode,
        [FromQuery] Guid? clientId,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var mode = SalesJournalReportAssembler.ParseViewMode(viewMode);
        var result = await _mediator.Send(
            new ExportSalesJournalPdfQuery(from.Value, to.Value, mode, clientId),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));

        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }

    [HttpGet("purchases-journal")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(ApiResponse<PurchasesJournalReportResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetPurchasesJournal(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? viewMode,
        [FromQuery] string? source,
        [FromQuery] Guid? supplierId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = PurchasesJournalReportConstants.DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var mode = PurchasesJournalReportAssembler.ParseViewMode(viewMode);
        var src = PurchasesJournalReportAssembler.ParseSource(source);
        var result = await _mediator.Send(
            new GetPurchasesJournalReportQuery(from.Value, to.Value, mode, src, supplierId, page, pageSize),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<PurchasesJournalReportResultDto>.Ok(result.Value));
    }

    [HttpGet("purchases-journal/pdf")]
    [Authorize(Policy = PermissionPolicies.ReportsView)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ExportPurchasesJournalPdf(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? viewMode,
        [FromQuery] string? source,
        [FromQuery] Guid? supplierId,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
        if (from.Value > to.Value)
            return BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));

        var mode = PurchasesJournalReportAssembler.ParseViewMode(viewMode);
        var src = PurchasesJournalReportAssembler.ParseSource(source);
        var result = await _mediator.Send(
            new ExportPurchasesJournalPdfQuery(from.Value, to.Value, mode, src, supplierId),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));

        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }
}

/// <summary>
/// Result for stock movements report (items + pagination).
/// </summary>
public sealed record StockMovementsReportResult(
    IReadOnlyList<StockMovementReportRowDto> Items,
    int TotalCount,
    int Page,
    int PageSize);
