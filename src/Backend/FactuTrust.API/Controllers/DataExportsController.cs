using FactuTrust.API.Authorization;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Application.Features.Invoices;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/data-exports")]
[Authorize]
[EnableRateLimiting("data-export")]
public class DataExportsController : ControllerBase
{
    private readonly IMediator _mediator;

    public DataExportsController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpGet("clients")]
    [Authorize(Policy = PermissionPolicies.ClientsRead)]
    public Task<IActionResult> ExportClients(
        [FromQuery] string? search,
        [FromQuery] ClientType? type,
        [FromQuery] bool? isActive,
        [FromQuery] string? governorate,
        CancellationToken cancellationToken) =>
        Send(BusinessDataset.Clients, Criteria(search: search, isActive: isActive, governorate: governorate, clientType: type), cancellationToken);

    [HttpGet("products")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    public Task<IActionResult> ExportProducts(
        [FromQuery] string? search,
        [FromQuery] ProductType? type,
        [FromQuery] bool? isActive,
        [FromQuery] Guid? categoryId,
        [FromQuery] bool excludeVariantTemplates = false,
        [FromQuery] bool? isVariantTemplate = null,
        [FromQuery] bool? hasParentProduct = null,
        CancellationToken cancellationToken = default) =>
        Send(BusinessDataset.Products, Criteria(
            search: search,
            isActive: isActive,
            categoryId: categoryId,
            productType: type,
            excludeVariantTemplates: excludeVariantTemplates,
            isVariantTemplate: isVariantTemplate,
            hasParentProduct: hasParentProduct), cancellationToken);

    [HttpGet("suppliers")]
    [Authorize(Policy = PermissionPolicies.SuppliersRead)]
    public Task<IActionResult> ExportSuppliers(
        [FromQuery] string? search,
        [FromQuery] SupplierType? type,
        [FromQuery] bool? isActive,
        CancellationToken cancellationToken) =>
        Send(BusinessDataset.Suppliers, Criteria(search: search, isActive: isActive, supplierType: type), cancellationToken);

    [HttpGet("invoices")]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    public Task<IActionResult> ExportInvoices(
        [FromQuery] string? search,
        [FromQuery] InvoiceStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        [FromQuery] bool unpaidOnly = false,
        [FromQuery] string? type = null,
        [FromQuery] bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default)
    {
        if (!InvoiceListTypeParser.TryParse(type, out var documentType, out var error))
            return Task.FromResult<IActionResult>(BadRequest(ApiResponse<object>.FailWithCode(error!, BusinessDataExportErrors.UnknownDataset)));

        return Send(BusinessDataset.Invoices, Criteria(
            search: search, fromDate: fromDate, toDate: toDate, clientId: clientId, unpaidOnly: unpaidOnly,
            realizedRevenueOnly: realizedRevenueOnly, invoiceStatus: status, documentType: documentType), cancellationToken);
    }

    [HttpGet("credit-notes")]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    public Task<IActionResult> ExportCreditNotes(
        [FromQuery] string? search,
        [FromQuery] InvoiceStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        [FromQuery] bool unpaidOnly = false,
        [FromQuery] bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default) =>
        Send(BusinessDataset.CreditNotes, Criteria(
            search: search, fromDate: fromDate, toDate: toDate, clientId: clientId, unpaidOnly: unpaidOnly,
            realizedRevenueOnly: realizedRevenueOnly, invoiceStatus: status,
            documentType: InvoiceType.CreditNote), cancellationToken);

    [HttpGet("supplier-invoices")]
    [Authorize(Policy = PermissionPolicies.SupplierInvoicesRead)]
    public Task<IActionResult> ExportSupplierInvoices(
        [FromQuery] string? search,
        [FromQuery] SupplierInvoiceStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? supplierId,
        [FromQuery] bool unpaidOnly = false,
        CancellationToken cancellationToken = default) =>
        Send(BusinessDataset.SupplierInvoices, Criteria(
            search: search, fromDate: fromDate, toDate: toDate, supplierId: supplierId, unpaidOnly: unpaidOnly,
            supplierInvoiceStatus: status), cancellationToken);

    [HttpGet("quotes")]
    [Authorize(Policy = PermissionPolicies.QuotesRead)]
    public Task<IActionResult> ExportQuotes(
        [FromQuery] string? search,
        [FromQuery] QuoteStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        CancellationToken cancellationToken) =>
        Send(BusinessDataset.Quotes, Criteria(
            search: search, fromDate: fromDate, toDate: toDate, clientId: clientId, quoteStatus: status), cancellationToken);

    [HttpGet("delivery-notes")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesRead)]
    public Task<IActionResult> ExportDeliveryNotes(
        [FromQuery] string? search,
        [FromQuery] DeliveryNoteStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        CancellationToken cancellationToken) =>
        Send(BusinessDataset.DeliveryNotes, Criteria(
            search: search, fromDate: fromDate, toDate: toDate, clientId: clientId, deliveryNoteStatus: status), cancellationToken);

    [HttpGet("purchase-orders")]
    [Authorize(Policy = PermissionPolicies.PurchaseOrdersRead)]
    public Task<IActionResult> ExportPurchaseOrders(
        [FromQuery] string? search,
        [FromQuery] PurchaseOrderStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? supplierId,
        CancellationToken cancellationToken) =>
        Send(BusinessDataset.PurchaseOrders, Criteria(
            search: search, fromDate: fromDate, toDate: toDate, supplierId: supplierId, purchaseOrderStatus: status), cancellationToken);

    [HttpGet("stock-items")]
    [Authorize(Policy = PermissionPolicies.StockRead)]
    public Task<IActionResult> ExportStockItems(
        [FromQuery] string? search,
        [FromQuery] Guid? warehouseId,
        [FromQuery] bool lowStockOnly = false,
        [FromQuery] bool outOfStockOnly = false,
        [FromQuery] bool inStockOnly = false,
        CancellationToken cancellationToken = default) =>
        Send(BusinessDataset.StockItems, Criteria(
            search: search, warehouseId: warehouseId, lowStockOnly: lowStockOnly, outOfStockOnly: outOfStockOnly,
            inStockOnly: inStockOnly), cancellationToken);

    [HttpGet("stock-movements")]
    [Authorize(Policy = PermissionPolicies.StockRead)]
    public Task<IActionResult> ExportStockMovements(
        [FromQuery] Guid? warehouseId,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        CancellationToken cancellationToken) =>
        Send(BusinessDataset.StockMovements, Criteria(
            fromDate: fromDate, toDate: toDate, warehouseId: warehouseId), cancellationToken);

    [HttpGet("bundle")]
    public async Task<IActionResult> ExportBundle(
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] string? datasets,
        CancellationToken cancellationToken)
    {
        if (!TryParseDatasets(datasets, out var parsed, out var error))
            return BadRequest(ApiResponse<object>.FailWithCode(error, BusinessDataExportErrors.UnknownDataset));

        var result = await _mediator.Send(
            new ExportBusinessDataBundleQuery(parsed, Criteria(fromDate: fromDate, toDate: toDate)),
            cancellationToken);
        return ToFile(result);
    }

    private async Task<IActionResult> Send(
        BusinessDataset dataset,
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ExportBusinessDatasetQuery(dataset, criteria), cancellationToken);
        return ToFile(result);
    }

    private static IActionResult ToFile(Result<BusinessExportFile> result)
    {
        if (result.IsFailure)
        {
            var body = ApiResponse<object>.FailWithCode(result.Error.Description, result.Error.Code);
            if (result.Error.Code == BusinessDataExportErrors.Forbidden)
                return new ObjectResult(body) { StatusCode = StatusCodes.Status403Forbidden };
            return new BadRequestObjectResult(body);
        }

        return new FileContentResult(result.Value.Content, BusinessExportFile.ExcelContentType)
        {
            FileDownloadName = result.Value.FileName
        };
    }

    private static bool TryParseDatasets(string? datasets, out IReadOnlyList<BusinessDataset> parsed, out string error)
    {
        parsed = Array.Empty<BusinessDataset>();
        error = string.Empty;
        if (string.IsNullOrWhiteSpace(datasets))
            return true;

        var items = new List<BusinessDataset>();
        foreach (var token in datasets.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!BusinessDatasetCatalog.TryParse(token, out var dataset))
            {
                error = "Jeu de données inconnu.";
                return false;
            }

            if (!items.Contains(dataset))
                items.Add(dataset);
        }

        parsed = items;
        return true;
    }

    private static BusinessExportCriteria Criteria(
        string? search = null,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        bool? isActive = null,
        string? governorate = null,
        Guid? categoryId = null,
        Guid? clientId = null,
        Guid? supplierId = null,
        Guid? warehouseId = null,
        bool unpaidOnly = false,
        bool realizedRevenueOnly = false,
        bool lowStockOnly = false,
        bool outOfStockOnly = false,
        bool inStockOnly = false,
        bool excludeVariantTemplates = false,
        bool? isVariantTemplate = null,
        bool? hasParentProduct = null,
        ClientType? clientType = null,
        ProductType? productType = null,
        SupplierType? supplierType = null,
        InvoiceStatus? invoiceStatus = null,
        InvoiceType? documentType = null,
        SupplierInvoiceStatus? supplierInvoiceStatus = null,
        QuoteStatus? quoteStatus = null,
        DeliveryNoteStatus? deliveryNoteStatus = null,
        PurchaseOrderStatus? purchaseOrderStatus = null) =>
        new()
        {
            Search = search,
            FromDate = fromDate,
            ToDate = toDate,
            IsActive = isActive,
            Governorate = governorate,
            CategoryId = categoryId,
            ClientId = clientId,
            SupplierId = supplierId,
            WarehouseId = warehouseId,
            UnpaidOnly = unpaidOnly,
            RealizedRevenueOnly = realizedRevenueOnly,
            LowStockOnly = lowStockOnly,
            OutOfStockOnly = outOfStockOnly,
            InStockOnly = inStockOnly,
            ExcludeVariantTemplates = excludeVariantTemplates,
            IsVariantTemplate = isVariantTemplate,
            HasParentProduct = hasParentProduct,
            ClientType = clientType,
            ProductType = productType,
            SupplierType = supplierType,
            InvoiceStatus = invoiceStatus,
            DocumentType = documentType,
            SupplierInvoiceStatus = supplierInvoiceStatus,
            QuoteStatus = quoteStatus,
            DeliveryNoteStatus = deliveryNoteStatus,
            PurchaseOrderStatus = purchaseOrderStatus
        };
}
