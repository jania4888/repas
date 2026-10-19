using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.DataExports;

public interface IBusinessExcelWorkbookBuilder
{
    byte[] Build(BusinessWorkbookModel model);
}

public sealed class BusinessDataExportCoordinator
{
    private readonly IClientRepository _clients;
    private readonly IProductRepository _products;
    private readonly ISupplierRepository _suppliers;
    private readonly IInvoiceRepository _invoices;
    private readonly ISupplierInvoiceRepository _supplierInvoices;
    private readonly IQuoteRepository _quotes;
    private readonly IDeliveryNoteRepository _deliveryNotes;
    private readonly IPurchaseOrderRepository _purchaseOrders;
    private readonly IPurchaseReceiptRepository _purchaseReceipts;
    private readonly IWarehouseRepository _warehouses;
    private readonly IStockItemRepository _stockItems;
    private readonly IStockMovementRepository _movements;
    private readonly ICompanyRepository _companies;
    private readonly ICurrentUser _currentUser;

    public BusinessDataExportCoordinator(
        IClientRepository clients,
        IProductRepository products,
        ISupplierRepository suppliers,
        IInvoiceRepository invoices,
        ISupplierInvoiceRepository supplierInvoices,
        IQuoteRepository quotes,
        IDeliveryNoteRepository deliveryNotes,
        IPurchaseOrderRepository purchaseOrders,
        IPurchaseReceiptRepository purchaseReceipts,
        IWarehouseRepository warehouses,
        IStockItemRepository stockItems,
        IStockMovementRepository movements,
        ICompanyRepository companies,
        ICurrentUser currentUser)
    {
        _clients = clients;
        _products = products;
        _suppliers = suppliers;
        _invoices = invoices;
        _supplierInvoices = supplierInvoices;
        _quotes = quotes;
        _deliveryNotes = deliveryNotes;
        _purchaseOrders = purchaseOrders;
        _purchaseReceipts = purchaseReceipts;
        _warehouses = warehouses;
        _stockItems = stockItems;
        _movements = movements;
        _companies = companies;
        _currentUser = currentUser;
    }

    public Task<Result<BusinessWorkbookModel>> BuildDatasetAsync(
        BusinessDataset dataset,
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken) =>
        BuildAsync(new[] { dataset }, criteria, BusinessDatasetCatalog.FilePrefix(dataset), bundle: false, cancellationToken);

    public Task<Result<BusinessWorkbookModel>> BuildBundleAsync(
        IReadOnlyList<BusinessDataset> datasets,
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var requested = datasets.Count == 0 ? BusinessDatasetCatalog.All : datasets;
        return BuildAsync(requested, criteria, BusinessExportFileName.BundlePrefix, bundle: true, cancellationToken);
    }

    private async Task<Result<BusinessWorkbookModel>> BuildAsync(
        IReadOnlyList<BusinessDataset> requested,
        BusinessExportCriteria criteria,
        string filePrefix,
        bool bundle,
        CancellationToken cancellationToken)
    {
        var allowed = requested
            .Distinct()
            .Where(dataset => _currentUser.HasPermission(BusinessDatasetCatalog.Permission(dataset)))
            .ToList();

        if (allowed.Count == 0)
        {
            return Result.Failure<BusinessWorkbookModel>(new Error(
                BusinessDataExportErrors.Forbidden,
                "Vous n'avez pas le droit d'exporter ces données."));
        }

        var sheets = new List<ExcelSheetModel>();
        foreach (var dataset in allowed)
        {
            var built = await BuildSheetsAsync(dataset, criteria, bundle, cancellationToken);
            if (built.IsFailure)
                return Result.Failure<BusinessWorkbookModel>(built.Error);

            foreach (var sheet in built.Value)
            {
                if (sheets.All(existing => existing.Name != sheet.Name))
                    sheets.Add(sheet);
            }
        }

        var exportedAt = TunisiaClock.Now();
        var company = await _companies.GetDefaultAsync(cancellationToken);
        var companyName = company is null
            ? "Entreprise"
            : string.IsNullOrWhiteSpace(company.TradeName) ? company.Name : company.TradeName!;

        return Result.Success(new BusinessWorkbookModel(
            BusinessExportFileName.Build(filePrefix, exportedAt),
            companyName,
            _currentUser.Email ?? string.Empty,
            exportedAt,
            criteria.Describe(),
            sheets));
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> BuildSheetsAsync(
        BusinessDataset dataset,
        BusinessExportCriteria criteria,
        bool bundle,
        CancellationToken cancellationToken)
    {
        var effective = EffectiveCriteria(dataset, criteria, bundle);
        return dataset switch
        {
            BusinessDataset.Clients => await ClientsAsync(effective, cancellationToken),
            BusinessDataset.Products => await ProductsAsync(effective, cancellationToken),
            BusinessDataset.Suppliers => await SuppliersAsync(effective, cancellationToken),
            BusinessDataset.Invoices => await InvoicesAsync(effective, "Factures", "Lignes factures", "Paiements clients", cancellationToken),
            BusinessDataset.CreditNotes => await InvoicesAsync(effective, "Avoirs", "Lignes avoirs", "Paiements avoirs", cancellationToken),
            BusinessDataset.SupplierInvoices => await SupplierInvoicesAsync(effective, cancellationToken),
            BusinessDataset.Quotes => await QuotesAsync(effective, cancellationToken),
            BusinessDataset.DeliveryNotes => await DeliveryNotesAsync(effective, cancellationToken),
            BusinessDataset.PurchaseOrders => await PurchaseOrdersAsync(effective, cancellationToken),
            BusinessDataset.StockItems => await StockItemsAsync(effective, cancellationToken),
            BusinessDataset.StockMovements => await MovementsAsync(effective, cancellationToken),
            BusinessDataset.PurchaseReceipts => await PurchaseReceiptsAsync(effective, cancellationToken),
            _ => Result.Failure<IReadOnlyList<ExcelSheetModel>>(new Error(
                BusinessDataExportErrors.UnknownDataset,
                "Jeu de données inconnu."))
        };
    }

    private static BusinessExportCriteria EffectiveCriteria(
        BusinessDataset dataset,
        BusinessExportCriteria criteria,
        bool bundle)
    {
        if (dataset == BusinessDataset.CreditNotes)
            return criteria with { DocumentType = InvoiceType.CreditNote };

        if (dataset == BusinessDataset.Invoices && bundle && criteria.DocumentType is null)
            return criteria with { DocumentType = InvoiceType.Standard };

        return criteria;
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> ClientsAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var rows = await _clients.ListForExportAsync(
            criteria.Search, criteria.ClientType, criteria.IsActive, criteria.Governorate,
            BusinessDataExportLimits.Masters, cancellationToken);
        if (rows.OverLimit(BusinessDataExportLimits.Masters))
            return TooMany("Clients", rows.TotalCount, BusinessDataExportLimits.Masters);
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[] { BusinessExportSheets.Clients(rows.Rows) });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> ProductsAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var rows = await _products.ListForExportAsync(
            criteria.Search, criteria.ProductType, criteria.IsActive, criteria.CategoryId,
            criteria.ExcludeVariantTemplates, criteria.IsVariantTemplate, criteria.HasParentProduct,
            BusinessDataExportLimits.Masters, cancellationToken);
        if (rows.OverLimit(BusinessDataExportLimits.Masters))
            return TooMany("Produits", rows.TotalCount, BusinessDataExportLimits.Masters);
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[] { BusinessExportSheets.Products(rows.Rows) });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> SuppliersAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var rows = await _suppliers.ListForExportAsync(
            criteria.Search, criteria.SupplierType, criteria.IsActive,
            BusinessDataExportLimits.Masters, cancellationToken);
        if (rows.OverLimit(BusinessDataExportLimits.Masters))
            return TooMany("Fournisseurs", rows.TotalCount, BusinessDataExportLimits.Masters);
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[] { BusinessExportSheets.Suppliers(rows.Rows) });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> InvoicesAsync(
        BusinessExportCriteria criteria,
        string documents,
        string lines,
        string payments,
        CancellationToken cancellationToken)
    {
        var data = await _invoices.ListForExportAsync(
            criteria.Search, criteria.InvoiceStatus, criteria.FromDate, criteria.ToDate, criteria.ClientId,
            criteria.UnpaidOnly, criteria.DocumentType, criteria.RealizedRevenueOnly,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, cancellationToken);
        var blocked = FirstOverflow(data.DocumentCount, data.LineCount, data.PaymentCount, documents, lines, payments);
        if (blocked is not null)
            return blocked;
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.Invoices(data.Documents, documents),
            BusinessExportSheets.InvoiceLines(data.Lines, lines),
            BusinessExportSheets.InvoicePayments(data.Payments, payments)
        });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> SupplierInvoicesAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var data = await _supplierInvoices.ListForExportAsync(
            criteria.Search, criteria.SupplierInvoiceStatus, criteria.SupplierId,
            criteria.FromDate, criteria.ToDate, criteria.UnpaidOnly,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, cancellationToken);
        var blocked = FirstOverflow(
            data.DocumentCount, data.LineCount, data.PaymentCount,
            "Factures fourn.", "Lignes fact. fourn.", "Paiements fourn.");
        if (blocked is not null)
            return blocked;
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.SupplierInvoices(data.Documents),
            BusinessExportSheets.SupplierInvoiceLines(data.Lines),
            BusinessExportSheets.SupplierPayments(data.Payments)
        });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> QuotesAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var data = await _quotes.ListForExportAsync(
            criteria.Search, criteria.QuoteStatus, criteria.FromDate, criteria.ToDate, criteria.ClientId,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, cancellationToken);
        var blocked = FirstOverflow(data.DocumentCount, data.LineCount, 0, "Devis", "Lignes devis", "Lignes devis");
        if (blocked is not null)
            return blocked;
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.Quotes(data.Documents),
            BusinessExportSheets.QuoteLines(data.Lines)
        });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> DeliveryNotesAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var data = await _deliveryNotes.ListForExportAsync(
            criteria.Search, criteria.DeliveryNoteStatus, criteria.FromDate, criteria.ToDate, criteria.ClientId,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, cancellationToken);
        var blocked = FirstOverflow(data.DocumentCount, data.LineCount, 0, "Bons de livraison", "Lignes BL", "Lignes BL");
        if (blocked is not null)
            return blocked;
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.DeliveryNotes(data.Documents),
            BusinessExportSheets.DeliveryNoteLines(data.Lines)
        });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> PurchaseOrdersAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var data = await _purchaseOrders.ListForExportAsync(
            criteria.Search, criteria.PurchaseOrderStatus, criteria.SupplierId, criteria.FromDate, criteria.ToDate,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, cancellationToken);
        var blocked = FirstOverflow(data.DocumentCount, data.LineCount, 0, "Bons de commande", "Lignes BC", "Lignes BC");
        if (blocked is not null)
            return blocked;
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.PurchaseOrders(data.Documents),
            BusinessExportSheets.PurchaseOrderLines(data.Lines)
        });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> PurchaseReceiptsAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var data = await _purchaseReceipts.ListForExportAsync(
            criteria.Search, criteria.PurchaseReceiptStatus, criteria.SupplierId, criteria.PurchaseOrderId,
            criteria.FromDate, criteria.ToDate,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, cancellationToken);
        var blocked = FirstOverflow(data.DocumentCount, data.LineCount, 0, "Bons de réception", "Lignes BR", "Lignes BR");
        if (blocked is not null)
            return blocked;
        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.PurchaseReceipts(data.Documents),
            BusinessExportSheets.PurchaseReceiptLines(data.Lines)
        });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> StockItemsAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var warehouses = await _warehouses.ListForExportAsync(BusinessDataExportLimits.Masters, cancellationToken);
        if (warehouses.OverLimit(BusinessDataExportLimits.Masters))
            return TooMany("Entrepots", warehouses.TotalCount, BusinessDataExportLimits.Masters);

        var stock = await _stockItems.ListForExportAsync(
            criteria.Search, criteria.WarehouseId, criteria.LowStockOnly, criteria.OutOfStockOnly, criteria.InStockOnly,
            BusinessDataExportLimits.Masters, cancellationToken);
        if (stock.OverLimit(BusinessDataExportLimits.Masters))
            return TooMany("Stock", stock.TotalCount, BusinessDataExportLimits.Masters);

        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.Warehouses(warehouses.Rows),
            BusinessExportSheets.Stock(stock.Rows)
        });
    }

    private async Task<Result<IReadOnlyList<ExcelSheetModel>>> MovementsAsync(
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var warehouses = await _warehouses.ListForExportAsync(BusinessDataExportLimits.Masters, cancellationToken);
        if (warehouses.OverLimit(BusinessDataExportLimits.Masters))
            return TooMany("Entrepots", warehouses.TotalCount, BusinessDataExportLimits.Masters);

        var movements = await _movements.ListForExportAsync(
            criteria.WarehouseId, criteria.FromDate, criteria.ToDate,
            BusinessDataExportLimits.Movements, cancellationToken);
        if (movements.OverLimit(BusinessDataExportLimits.Movements))
            return TooMany("Mouvements stock", movements.TotalCount, BusinessDataExportLimits.Movements);

        return Result.Success<IReadOnlyList<ExcelSheetModel>>(new[]
        {
            BusinessExportSheets.Warehouses(warehouses.Rows),
            BusinessExportSheets.Movements(movements.Rows)
        });
    }

    private static Result<IReadOnlyList<ExcelSheetModel>>? FirstOverflow(
        int documents,
        int lines,
        int payments,
        string documentSheet,
        string lineSheet,
        string paymentSheet)
    {
        if (documents > BusinessDataExportLimits.Documents)
            return TooMany(documentSheet, documents, BusinessDataExportLimits.Documents);
        if (lines > BusinessDataExportLimits.Lines)
            return TooMany(lineSheet, lines, BusinessDataExportLimits.Lines);
        if (payments > BusinessDataExportLimits.Lines)
            return TooMany(paymentSheet, payments, BusinessDataExportLimits.Lines);
        return null;
    }

    private static Result<IReadOnlyList<ExcelSheetModel>> TooMany(string sheet, int count, int max) =>
        Result.Failure<IReadOnlyList<ExcelSheetModel>>(new Error(
            BusinessDataExportErrors.TooManyRows,
            $"La feuille « {sheet} » contient {count} lignes, au-delà du plafond de {max}. Affinez la période ou les filtres."));
}
