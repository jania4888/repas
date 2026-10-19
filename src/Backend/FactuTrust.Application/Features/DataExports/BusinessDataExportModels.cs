using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.DataExports;

/// <summary>Jeux exportables. Le nom de route est l'allowlist HTTP.</summary>
public enum BusinessDataset
{
    Clients,
    Products,
    Suppliers,
    Invoices,
    CreditNotes,
    SupplierInvoices,
    Quotes,
    DeliveryNotes,
    PurchaseOrders,
    StockItems,
    StockMovements,
    PurchaseReceipts
}

public static class BusinessDataExportLimits
{
    public const int Masters = 20_000;
    public const int Documents = 8_000;
    public const int Lines = 25_000;
    public const int Movements = 25_000;
}

public static class BusinessDataExportErrors
{
    public const string TooManyRows = "Export.TooManyRows";
    public const string Forbidden = "Export.Forbidden";
    public const string UnknownDataset = "Export.UnknownDataset";
}

public sealed record CountedRows<T>(int TotalCount, IReadOnlyList<T> Rows)
{
    public static CountedRows<T> Over(int totalCount) => new(totalCount, Array.Empty<T>());

    public static CountedRows<T> Ready(IReadOnlyList<T> rows) => new(rows.Count, rows);

    public bool OverLimit(int max) => TotalCount > max;
}

public sealed record HeaderLinesExportData<TDoc, TLine>(
    int DocumentCount,
    int LineCount,
    IReadOnlyList<TDoc> Documents,
    IReadOnlyList<TLine> Lines)
{
    public static HeaderLinesExportData<TDoc, TLine> Blocked(int documents, int lines) =>
        new(documents, lines, Array.Empty<TDoc>(), Array.Empty<TLine>());

    public bool Exceeds(int documentMax, int lineMax) =>
        DocumentCount > documentMax || LineCount > lineMax;
}

public sealed record HeaderLinesPaymentsExportData<TDoc, TLine, TPay>(
    int DocumentCount,
    int LineCount,
    int PaymentCount,
    IReadOnlyList<TDoc> Documents,
    IReadOnlyList<TLine> Lines,
    IReadOnlyList<TPay> Payments)
{
    public static HeaderLinesPaymentsExportData<TDoc, TLine, TPay> Blocked(int documents, int lines, int payments) =>
        new(documents, lines, payments, Array.Empty<TDoc>(), Array.Empty<TLine>(), Array.Empty<TPay>());

    public bool Exceeds(int documentMax, int lineMax) =>
        DocumentCount > documentMax || LineCount > lineMax || PaymentCount > lineMax;
}

/// <summary>
/// Filtres d'écran. Le texte de recherche n'est jamais recopié dans le nom de fichier ni dans l'audit.
/// </summary>
public sealed record BusinessExportCriteria
{
    public string? Search { get; init; }
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public bool? IsActive { get; init; }
    public string? Governorate { get; init; }
    public Guid? CategoryId { get; init; }
    public Guid? ClientId { get; init; }
    public Guid? SupplierId { get; init; }
    public Guid? WarehouseId { get; init; }
    public bool UnpaidOnly { get; init; }
    public bool RealizedRevenueOnly { get; init; }
    public bool LowStockOnly { get; init; }
    public bool OutOfStockOnly { get; init; }
    public bool InStockOnly { get; init; }
    public bool ExcludeVariantTemplates { get; init; }
    public bool? IsVariantTemplate { get; init; }
    public bool? HasParentProduct { get; init; }
    public ClientType? ClientType { get; init; }
    public ProductType? ProductType { get; init; }
    public SupplierType? SupplierType { get; init; }
    public InvoiceStatus? InvoiceStatus { get; init; }
    public InvoiceType? DocumentType { get; init; }
    public SupplierInvoiceStatus? SupplierInvoiceStatus { get; init; }
    public QuoteStatus? QuoteStatus { get; init; }
    public DeliveryNoteStatus? DeliveryNoteStatus { get; init; }
    public PurchaseOrderStatus? PurchaseOrderStatus { get; init; }
    public PurchaseReceiptStatus? PurchaseReceiptStatus { get; init; }
    public Guid? PurchaseOrderId { get; init; }

    public string Describe()
    {
        var parts = new List<string>();
        if (FromDate.HasValue)
            parts.Add($"Du {FromDate.Value:dd/MM/yyyy}");
        if (ToDate.HasValue)
            parts.Add($"Au {ToDate.Value:dd/MM/yyyy}");
        if (UnpaidOnly)
            parts.Add("Impayés uniquement");
        if (RealizedRevenueOnly)
            parts.Add("Revenu réalisé");
        if (IsActive == true)
            parts.Add("Actifs");
        if (IsActive == false)
            parts.Add("Inactifs");
        if (LowStockOnly)
            parts.Add("Stock faible");
        if (OutOfStockOnly)
            parts.Add("Rupture de stock");
        if (InStockOnly)
            parts.Add("En stock");
        if (!string.IsNullOrWhiteSpace(Governorate))
            parts.Add($"Gouvernorat {Governorate.Trim()}");
        if (InvoiceStatus.HasValue)
            parts.Add(SafeStatus(() => InvoiceStatus.Value.ToDisplayString()));
        if (SupplierInvoiceStatus.HasValue)
            parts.Add(SafeStatus(() => SupplierInvoiceStatus.Value.ToDisplayString()));
        if (QuoteStatus.HasValue)
            parts.Add(SafeStatus(() => QuoteStatus.Value.ToDisplayString()));
        if (DeliveryNoteStatus.HasValue)
            parts.Add(SafeStatus(() => DeliveryNoteStatus.Value.ToDisplayString()));
        if (PurchaseOrderStatus.HasValue)
            parts.Add(SafeStatus(() => PurchaseOrderStatus.Value.ToDisplayString()));
        if (PurchaseReceiptStatus.HasValue)
            parts.Add(SafeStatus(() => PurchaseReceiptStatus.Value.ToDisplayString()));
        if (DocumentType == InvoiceType.CreditNote)
            parts.Add("Avoirs");
        else if (DocumentType == InvoiceType.Standard)
            parts.Add("Factures");
        return parts.Count == 0 ? "Aucun filtre de période ou de statut" : string.Join(" ; ", parts);
    }

    private static string SafeStatus(Func<string> display)
    {
        try
        {
            return display();
        }
        catch (ArgumentOutOfRangeException)
        {
            return "Statut";
        }
    }
}

public enum ExcelColumnFormat
{
    Text,
    Money,
    Quantity,
    Date,
    DateTime
}

public readonly record struct ExcelValue(string? Text, decimal? Number, DateTime? Date)
{
    public static ExcelValue FromText(string? value) => new(value, null, null);
    public static ExcelValue FromNumber(decimal? value) => new(null, value, null);
    public static ExcelValue FromDate(DateTime? value) => new(null, null, value);
    public static ExcelValue FromBool(bool value) => new(value ? "Oui" : "Non", null, null);
}

public sealed record ExcelColumn(string Header, ExcelColumnFormat Format);

public sealed record ExcelSheetModel(
    string Name,
    IReadOnlyList<ExcelColumn> Columns,
    IReadOnlyList<IReadOnlyList<ExcelValue>> Rows);

public sealed record BusinessWorkbookModel(
    string FileName,
    string CompanyName,
    string UserEmail,
    DateTime ExportedAt,
    string ScopeLabel,
    IReadOnlyList<ExcelSheetModel> Sheets);

public sealed record BusinessExportFile(byte[] Content, string FileName)
{
    public const string ExcelContentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

public static class BusinessDatasetCatalog
{
    public static IReadOnlyList<BusinessDataset> All { get; } = Enum.GetValues<BusinessDataset>();

    public static bool TryParse(string? value, out BusinessDataset dataset)
    {
        dataset = default;
        if (string.IsNullOrWhiteSpace(value))
            return false;

        switch (value.Trim().ToLowerInvariant())
        {
            case "clients": dataset = BusinessDataset.Clients; return true;
            case "products": dataset = BusinessDataset.Products; return true;
            case "suppliers": dataset = BusinessDataset.Suppliers; return true;
            case "invoices": dataset = BusinessDataset.Invoices; return true;
            case "credit-notes": dataset = BusinessDataset.CreditNotes; return true;
            case "supplier-invoices": dataset = BusinessDataset.SupplierInvoices; return true;
            case "quotes": dataset = BusinessDataset.Quotes; return true;
            case "delivery-notes": dataset = BusinessDataset.DeliveryNotes; return true;
            case "purchase-orders": dataset = BusinessDataset.PurchaseOrders; return true;
            case "stock-items": dataset = BusinessDataset.StockItems; return true;
            case "stock-movements": dataset = BusinessDataset.StockMovements; return true;
            case "purchase-receipts": dataset = BusinessDataset.PurchaseReceipts; return true;
            default: return false;
        }
    }

    public static string Permission(BusinessDataset dataset) => dataset switch
    {
        BusinessDataset.Clients => Permissions.Clients.Read,
        BusinessDataset.Products => Permissions.Products.Read,
        BusinessDataset.Suppliers => Permissions.Suppliers.Read,
        BusinessDataset.Invoices => Permissions.Invoices.Read,
        BusinessDataset.CreditNotes => Permissions.Invoices.Read,
        BusinessDataset.SupplierInvoices => Permissions.SupplierInvoices.Read,
        BusinessDataset.Quotes => Permissions.Quotes.Read,
        BusinessDataset.DeliveryNotes => Permissions.DeliveryNotes.Read,
        BusinessDataset.PurchaseOrders => Permissions.PurchaseOrders.Read,
        BusinessDataset.StockItems => Permissions.Stock.Read,
        BusinessDataset.StockMovements => Permissions.Stock.Read,
        BusinessDataset.PurchaseReceipts => Permissions.PurchaseReceipts.Read,
        _ => throw new ArgumentOutOfRangeException(nameof(dataset))
    };

    public static string FilePrefix(BusinessDataset dataset) => dataset switch
    {
        BusinessDataset.Clients => "Clients",
        BusinessDataset.Products => "Produits",
        BusinessDataset.Suppliers => "Fournisseurs",
        BusinessDataset.Invoices => "Factures",
        BusinessDataset.CreditNotes => "Avoirs",
        BusinessDataset.SupplierInvoices => "Factures_fournisseurs",
        BusinessDataset.Quotes => "Devis",
        BusinessDataset.DeliveryNotes => "Bons_de_livraison",
        BusinessDataset.PurchaseOrders => "Bons_de_commande",
        BusinessDataset.StockItems => "Stock",
        BusinessDataset.StockMovements => "Mouvements_stock",
        BusinessDataset.PurchaseReceipts => "Bons_de_reception",
        _ => "Export"
    };
}

public static class BusinessExportFileName
{
    public const string BundlePrefix = "Mes_donnees";

    public static string Build(string prefix, DateTime exportedAt)
    {
        var safe = new string(prefix.Where(c => char.IsLetterOrDigit(c) || c is '_' or '-').ToArray());
        if (string.IsNullOrEmpty(safe))
            safe = "Export";
        return $"{safe}_{exportedAt:yyyyMMdd_HHmm}.xlsx";
    }
}

public static class ExcelFormulaGuard
{
    public static string? Apply(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        var first = value[0];
        if (first is '=' or '+' or '-' or '@' or '\t' or '\r')
            return "'" + value;

        return value;
    }
}

public static class TunisiaClock
{
    public static DateTime Now()
    {
        var zone = Resolve();
        return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone);
    }

    private static TimeZoneInfo Resolve()
    {
        foreach (var id in new[] { "Africa/Tunis", "Tunisia Standard Time" })
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        return TimeZoneInfo.Utc;
    }
}

public static class ExcelSheetNames
{
    public static string Clamp(string name)
    {
        var cleaned = name
            .Replace('\\', ' ')
            .Replace('/', ' ')
            .Replace('*', ' ')
            .Replace('?', ' ')
            .Replace(':', ' ')
            .Replace('[', ' ')
            .Replace(']', ' ');
        var trimmed = cleaned.Trim();
        if (trimmed.Length == 0)
            trimmed = "Feuille";
        return trimmed.Length <= 31 ? trimmed : trimmed[..31];
    }
}
