using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.DataExports;

public static class BusinessExportSheets
{
    public static ExcelSheetModel Clients(IReadOnlyList<ClientExportRow> rows) =>
        Sheet("Clients", ClientColumns(), rows.Select(r => Line(
            Text(r.Code), Text(r.Name), Text(Label(() => r.Type.ToDisplayString())), Text(r.Nif), Text(r.Email),
            Text(r.Phone), Text(r.ContactPerson), Text(r.Street), Text(r.StreetLine2), Text(r.PostalCode),
            Text(r.City), Text(r.Governorate), Text(r.Country), ExcelValue.FromBool(r.IsActive),
            Money(r.CreditLimit), Qty(r.DefaultPaymentTermDays), Text(r.Notes), Qty(r.TotalInvoices),
            Money(r.TotalRevenue), Text(r.Id))));

    public static ExcelSheetModel Products(IReadOnlyList<ProductExportRow> rows) =>
        Sheet("Produits", ProductColumns(), rows.Select(r => Line(
            Text(r.Code), Text(r.Name), Text(r.Description), Text(Label(() => r.Type.ToDisplayString())),
            Text(r.CategoryName), Money(r.UnitPrice), Money(r.PurchasePrice), Money(r.LastPurchasePrice),
            Money(r.WeightedAverageCost), Text(r.VatRate.ToShortString()), Text(r.Unit), Text(r.Barcode),
            ExcelValue.FromBool(r.IsActive), ExcelValue.FromBool(r.IsStockManaged),
            ExcelValue.FromBool(r.IsFodecApplicable), ExcelValue.FromBool(r.IsDiscountEnabled),
            Qty(r.MaxDiscountPercent), Text(r.Id))));

    public static ExcelSheetModel Suppliers(IReadOnlyList<SupplierExportRow> rows) =>
        Sheet("Fournisseurs", SupplierColumns(), rows.Select(r => Line(
            Text(r.Name), Text(Label(() => r.Type.ToDisplayString())), Text(r.Nif), Text(r.Email), Text(r.Phone),
            Text(r.ContactPerson), Text(r.Street), Text(r.StreetLine2), Text(r.PostalCode), Text(r.City),
            Text(r.Governorate), Text(r.Country), Qty(r.PaymentTermDays), ExcelValue.FromBool(r.IsActive),
            ExcelValue.FromBool(r.IsResident), Text(r.Activity), ExcelValue.FromBool(r.IsSubjectToWithholding),
            Qty(r.DefaultWithholdingRate), Text(r.Notes), Text(r.Id))));

    public static ExcelSheetModel Invoices(IReadOnlyList<InvoiceExportRow> rows, string sheetName) =>
        Sheet(sheetName, InvoiceColumns(), rows.Select(InvoiceLine));

    public static ExcelSheetModel InvoiceLines(IReadOnlyList<InvoiceLineExportRow> rows, string sheetName) =>
        Sheet(sheetName, InvoiceLineColumns(), rows.Select(r => Line(
            Text(r.DocumentNumber), Qty(r.LineNumber), Text(r.ProductCode), Text(r.ProductName), Qty(r.Quantity),
            Text(r.Unit), Money(r.UnitPrice), Text(r.VatRate.ToShortString()), Qty(r.DiscountPercent),
            Money(r.SubTotal), Money(r.VatAmount), Money(r.Total), ExcelValue.FromBool(r.IsFodecApplicable),
            Text(r.Id))));

    public static ExcelSheetModel InvoicePayments(IReadOnlyList<InvoicePaymentExportRow> rows, string sheetName) =>
        Sheet(sheetName, PaymentColumns(), rows.Select(r => Line(
            Text(r.DocumentNumber), Date(r.PaymentDate), Money(r.Amount),
            Text(Label(() => r.Method.ToDisplayString())), Text(r.Reference), ExcelValue.FromBool(r.IsRefunded),
            Text(r.Id))));

    public static ExcelSheetModel SupplierInvoices(IReadOnlyList<SupplierInvoiceExportRow> rows) =>
        Sheet("Factures fourn.", SupplierInvoiceColumns(), rows.Select(r => Line(
            Text(r.InvoiceNumber), Date(r.InvoiceDate), Date(r.DueDate),
            Text(Label(() => r.Status.ToDisplayString())), Text(r.SupplierName), Money(r.SubTotal),
            Money(r.TotalVat), Money(r.TotalAmount), Money(r.TotalPaid), Money(r.TotalAmount - r.TotalPaid),
            Text(r.ExternalReference), Text(r.PurchaseOrderNumber), Text(r.WarehouseName),
            Qty(r.WithholdingRate), Money(r.WithholdingAmount), Date(r.PaidAt), Text(r.Id))));

    public static ExcelSheetModel SupplierInvoiceLines(IReadOnlyList<SupplierInvoiceLineExportRow> rows) =>
        Sheet("Lignes fact. fourn.", CommercialLineColumns(), rows.Select(r => Line(
            Text(r.DocumentNumber), Qty(r.LineNumber), Text(r.ProductCode), Text(r.ProductName), Qty(r.Quantity),
            Text(r.Unit), Money(r.UnitPrice), Text(r.VatRate.ToShortString()), Money(r.SubTotal),
            Money(r.VatAmount), Money(r.Total), Text(r.Id))));

    public static ExcelSheetModel SupplierPayments(IReadOnlyList<SupplierPaymentExportRow> rows) =>
        Sheet("Paiements fourn.", new[]
        {
            Col("Numéro document"), Col("Date", ExcelColumnFormat.Date), Col("Montant", ExcelColumnFormat.Money),
            Col("Mode"), Col("Référence"), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.DocumentNumber), Date(r.PaymentDate), Money(r.Amount),
            Text(Label(() => r.Method.ToDisplayString())), Text(r.Reference), Text(r.Id))));

    public static ExcelSheetModel Quotes(IReadOnlyList<QuoteExportRow> rows) =>
        Sheet("Devis", new[]
        {
            Col("Numéro"), Col("Date", ExcelColumnFormat.Date), Col("Expiration", ExcelColumnFormat.Date),
            Col("Statut"), Col("Client"), Col("Total HT", ExcelColumnFormat.Money),
            Col("TVA", ExcelColumnFormat.Money), Col("Total TTC", ExcelColumnFormat.Money),
            Col("Référence"), Col("Notes"), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.Number), Date(r.IssueDate), Date(r.ExpiryDate), Text(Label(() => r.Status.ToDisplayString())),
            Text(r.ClientName), Money(r.SubTotal), Money(r.TotalVat), Money(r.TotalAmount), Text(r.Reference),
            Text(r.Notes), Text(r.Id))));

    public static ExcelSheetModel QuoteLines(IReadOnlyList<QuoteLineExportRow> rows) =>
        Sheet("Lignes devis", CommercialLineColumns(), rows.Select(r => Line(
            Text(r.DocumentNumber), Qty(r.LineNumber), Text(r.ProductCode), Text(r.ProductName), Qty(r.Quantity),
            Text(r.Unit), Money(r.UnitPrice), Text(r.VatRate.ToShortString()), Money(r.SubTotal),
            Money(r.VatAmount), Money(r.Total), Text(r.Id))));

    public static ExcelSheetModel DeliveryNotes(IReadOnlyList<DeliveryNoteExportRow> rows) =>
        Sheet("Bons de livraison", new[]
        {
            Col("Numéro"), Col("Date", ExcelColumnFormat.Date), Col("Date de livraison", ExcelColumnFormat.Date),
            Col("Statut"), Col("Client"), Col("Adresse de livraison"), Col("Ville"), Col("Entrepôt"),
            Col("Référence"), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.Number), Date(r.IssueDate), Date(r.DeliveryDate), Text(Label(() => r.Status.ToDisplayString())),
            Text(r.ClientName), Text(r.DeliveryAddress), Text(r.DeliveryCity), Text(r.WarehouseName),
            Text(r.Reference), Text(r.Id))));

    public static ExcelSheetModel DeliveryNoteLines(IReadOnlyList<DeliveryNoteLineExportRow> rows) =>
        Sheet("Lignes BL", new[]
        {
            Col("Numéro"), Col("N° ligne", ExcelColumnFormat.Quantity), Col("Code"), Col("Désignation"),
            Col("Qté commandée", ExcelColumnFormat.Quantity), Col("Qté livrée", ExcelColumnFormat.Quantity),
            Col("Qté rejetée", ExcelColumnFormat.Quantity), Col("Qté retournée", ExcelColumnFormat.Quantity),
            Col("Unité"), Col("Prix unitaire HT", ExcelColumnFormat.Money), Col("TVA %", ExcelColumnFormat.Quantity),
            Col("Remise %", ExcelColumnFormat.Quantity), Col("FODEC"), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.DocumentNumber), Qty(r.LineNumber), Text(r.ProductCode), Text(r.Designation),
            Qty(r.OrderedQuantity), Qty(r.DeliveredQuantity), Qty(r.RejectedQuantity), Qty(r.ReturnedQuantity),
            Text(r.Unit), Money(r.UnitPrice), Qty(r.VatRatePercent), Qty(r.DiscountPercent),
            ExcelValue.FromBool(r.IsFodecApplicable), Text(r.Id))));

    public static ExcelSheetModel PurchaseOrders(IReadOnlyList<PurchaseOrderExportRow> rows) =>
        Sheet("Bons de commande", new[]
        {
            Col("Numéro"), Col("Date", ExcelColumnFormat.Date), Col("Livraison prévue", ExcelColumnFormat.Date),
            Col("Statut"), Col("Fournisseur"), Col("Total HT", ExcelColumnFormat.Money),
            Col("TVA", ExcelColumnFormat.Money), Col("Total TTC", ExcelColumnFormat.Money),
            Col("Référence"), Col("Entrepôt"), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.Number), Date(r.OrderDate), Date(r.ExpectedDeliveryDate),
            Text(Label(() => r.Status.ToDisplayString())), Text(r.SupplierName), Money(r.SubTotal),
            Money(r.TotalVat), Money(r.TotalAmount), Text(r.Reference), Text(r.WarehouseName), Text(r.Id))));

    public static ExcelSheetModel PurchaseOrderLines(IReadOnlyList<PurchaseOrderLineExportRow> rows) =>
        Sheet("Lignes BC", new[]
        {
            Col("Numéro"), Col("N° ligne", ExcelColumnFormat.Quantity), Col("Code"), Col("Désignation"),
            Col("Qté commandée", ExcelColumnFormat.Quantity), Col("Qté reçue", ExcelColumnFormat.Quantity),
            Col("Qté facturée", ExcelColumnFormat.Quantity), Col("Unité"),
            Col("Prix unitaire HT", ExcelColumnFormat.Money), Col("Total HT", ExcelColumnFormat.Money),
            Col("TVA", ExcelColumnFormat.Money), Col("Total TTC", ExcelColumnFormat.Money), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.DocumentNumber), Qty(r.LineNumber), Text(r.ProductCode), Text(r.ProductName), Qty(r.Quantity),
            Qty(r.ReceivedQuantity), Qty(r.InvoicedQuantity), Text(r.Unit), Money(r.UnitPrice), Money(r.SubTotal),
            Money(r.VatAmount), Money(r.Total), Text(r.Id))));

    public static ExcelSheetModel PurchaseReceipts(IReadOnlyList<PurchaseReceiptExportRow> rows) =>
        Sheet("Bons de réception", new[]
        {
            Col("Numéro"), Col("Date", ExcelColumnFormat.Date), Col("Statut"), Col("Fournisseur"),
            Col("Bon de commande"), Col("Entrepôt"), Col("Réf. fournisseur"), Col("N° BL fournisseur"),
            Col("Transporteur"), Col("Nb lignes", ExcelColumnFormat.Quantity), Col("Total HT", ExcelColumnFormat.Money),
            Col("TVA", ExcelColumnFormat.Money), Col("Total TTC", ExcelColumnFormat.Money),
            Col("Validé le", ExcelColumnFormat.DateTime), Col("Annulé le", ExcelColumnFormat.DateTime),
            Col("Motif d'annulation"), Col("Notes"), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.Number), Date(r.ReceiptDate), Text(Label(() => r.Status.ToDisplayString())), Text(r.SupplierName),
            Text(r.PurchaseOrderNumber), Text(r.WarehouseName), Text(r.SupplierReference), Text(r.DeliveryNoteNumber),
            Text(r.TransporterName), Qty(r.LineCount), Money(r.SubTotal), Money(r.TotalVat), Money(r.TotalAmount),
            Date(r.ValidatedAt), Date(r.CancelledAt), Text(r.CancellationReason), Text(r.Notes), Text(r.Id))));

    public static ExcelSheetModel PurchaseReceiptLines(IReadOnlyList<PurchaseReceiptLineExportRow> rows) =>
        Sheet("Lignes BR", new[]
        {
            Col("Numéro"), Col("N° ligne", ExcelColumnFormat.Quantity), Col("Code"), Col("Désignation"), Col("Unité"),
            Col("Qté commandée", ExcelColumnFormat.Quantity), Col("Qté reçue", ExcelColumnFormat.Quantity),
            Col("Qté facturée", ExcelColumnFormat.Quantity), Col("Reste à facturer", ExcelColumnFormat.Quantity),
            Col("PU HT", ExcelColumnFormat.Money), Col("Remise %", ExcelColumnFormat.Quantity), Col("TVA"),
            Col("Total HT", ExcelColumnFormat.Money), Col("Montant TVA", ExcelColumnFormat.Money),
            Col("Total TTC", ExcelColumnFormat.Money), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.DocumentNumber), Qty(r.LineNumber), Text(r.ProductCode), Text(r.ProductName), Text(r.Unit),
            Qty(r.OrderedQuantity), Qty(r.ReceivedQuantity), Qty(r.InvoicedQuantity),
            Qty(Math.Max(0m, r.ReceivedQuantity - r.InvoicedQuantity)), Money(r.UnitPrice), Qty(r.DiscountPercent),
            Text(r.VatRate.ToShortString()), Money(r.SubTotal), Money(r.VatAmount), Money(r.Total), Text(r.Id))));

    public static ExcelSheetModel Warehouses(IReadOnlyList<WarehouseExportRow> rows) =>
        Sheet("Entrepots", new[]
        {
            Col("Code"), Col("Nom"), Col("Adresse"), Col("Entrepôt par défaut"), Col("Actif"), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.Code), Text(r.Name), Text(r.Address), ExcelValue.FromBool(r.IsDefault),
            ExcelValue.FromBool(r.IsActive), Text(r.Id))));

    public static ExcelSheetModel Stock(IReadOnlyList<StockPositionExportRow> rows) =>
        Sheet("Stock", new[]
        {
            Col("Code produit"), Col("Produit"), Col("Entrepôt"),
            Col("Qté en stock", ExcelColumnFormat.Quantity), Col("Qté disponible", ExcelColumnFormat.Quantity),
            Col("Qté réservée", ExcelColumnFormat.Quantity), Col("Seuil mini", ExcelColumnFormat.Quantity),
            Col("Seuil maxi", ExcelColumnFormat.Quantity), Col("CUMP", ExcelColumnFormat.Money),
            Col("Valeur (qté × CUMP)", ExcelColumnFormat.Money), Col("Identifiant")
        }, rows.Select(r => Line(
            Text(r.ProductCode), Text(r.ProductName), Text(r.WarehouseName), Qty(r.QuantityOnHand),
            Qty(r.QuantityOnHand - r.QuantityReserved), Qty(r.QuantityReserved), Qty(r.MinimumStock),
            Qty(r.MaximumStock), Money(r.AverageCost), Money(r.QuantityOnHand * r.AverageCost), Text(r.Id))));

    public static ExcelSheetModel Movements(IReadOnlyList<StockMovementExportRow> rows) =>
        Sheet("Mouvements stock", new[]
        {
            Col("Date", ExcelColumnFormat.DateTime), Col("Code produit"), Col("Produit"), Col("Entrepôt"),
            Col("Type"), Col("Motif"), Col("Quantité", ExcelColumnFormat.Quantity),
            Col("Coût unitaire", ExcelColumnFormat.Money), Col("Solde après", ExcelColumnFormat.Quantity),
            Col("Référence"), Col("Identifiant")
        }, rows.Select(r => Line(
            Date(r.OccurredAt), Text(r.ProductCode), Text(r.ProductName), Text(r.WarehouseName),
            Text(MovementTypeLabel(r.Type)), Text(Label(() => r.Reason.ToDisplayString())), Qty(r.Quantity),
            Money(r.UnitCost), Qty(r.BalanceAfter), Text(r.Reference), Text(r.Id))));

    private static IReadOnlyList<ExcelValue> InvoiceLine(InvoiceExportRow r) => Line(
        Text(r.Number), Text(r.Type == InvoiceType.CreditNote ? "Avoir" : "Facture"), Date(r.IssueDate),
        Date(r.DueDate), Text(Label(() => r.Status.ToDisplayString())), Text(r.ClientName), Money(r.SubTotal),
        Money(r.TotalVat), Money(r.TotalAmount), Money(r.TotalPaid), Money(r.TotalAmount - r.TotalPaid),
        Text(r.Reference), Text(r.Notes), Text(r.PaymentTerms), Text(r.WarehouseName),
        Text(r.LinkedInvoiceNumber), Date(r.PaidAt), Text(r.Id));

    private static ExcelColumn[] ClientColumns() => new[]
    {
        Col("Code"), Col("Nom"), Col("Type"), Col("NIF"), Col("E-mail"), Col("Téléphone"), Col("Contact"),
        Col("Adresse"), Col("Complément"), Col("Code postal"), Col("Ville"), Col("Gouvernorat"), Col("Pays"),
        Col("Actif"), Col("Plafond de crédit", ExcelColumnFormat.Money),
        Col("Délai de paiement (jours)", ExcelColumnFormat.Quantity), Col("Notes"),
        Col("Nombre de factures", ExcelColumnFormat.Quantity),
        Col("Chiffre d'affaires TTC", ExcelColumnFormat.Money), Col("Identifiant")
    };

    private static ExcelColumn[] ProductColumns() => new[]
    {
        Col("Code"), Col("Désignation"), Col("Description"), Col("Type"), Col("Catégorie"),
        Col("Prix vente HT", ExcelColumnFormat.Money), Col("Prix achat HT", ExcelColumnFormat.Money),
        Col("Dernier prix d'achat", ExcelColumnFormat.Money), Col("CUMP", ExcelColumnFormat.Money),
        Col("TVA"), Col("Unité"), Col("Code-barres"), Col("Actif"), Col("Géré en stock"), Col("FODEC"),
        Col("Remise autorisée"), Col("Remise max %", ExcelColumnFormat.Quantity), Col("Identifiant")
    };

    private static ExcelColumn[] SupplierColumns() => new[]
    {
        Col("Nom"), Col("Type"), Col("NIF"), Col("E-mail"), Col("Téléphone"), Col("Contact"), Col("Adresse"),
        Col("Complément"), Col("Code postal"), Col("Ville"), Col("Gouvernorat"), Col("Pays"),
        Col("Délai de paiement (jours)", ExcelColumnFormat.Quantity), Col("Actif"), Col("Résident"),
        Col("Activité"), Col("Soumis à la retenue"), Col("Taux de retenue", ExcelColumnFormat.Quantity),
        Col("Notes"), Col("Identifiant")
    };

    private static ExcelColumn[] InvoiceColumns() => new[]
    {
        Col("Numéro"), Col("Type"), Col("Date", ExcelColumnFormat.Date), Col("Échéance", ExcelColumnFormat.Date),
        Col("Statut"), Col("Client"), Col("Total HT", ExcelColumnFormat.Money), Col("TVA", ExcelColumnFormat.Money),
        Col("Total TTC", ExcelColumnFormat.Money), Col("Payé", ExcelColumnFormat.Money),
        Col("Reste", ExcelColumnFormat.Money), Col("Référence"), Col("Notes"), Col("Conditions de paiement"),
        Col("Entrepôt"), Col("Facture liée"), Col("Payée le", ExcelColumnFormat.Date), Col("Identifiant")
    };

    private static ExcelColumn[] InvoiceLineColumns() => new[]
    {
        Col("Numéro document"), Col("N° ligne", ExcelColumnFormat.Quantity), Col("Code"), Col("Désignation"),
        Col("Quantité", ExcelColumnFormat.Quantity), Col("Unité"), Col("Prix unitaire HT", ExcelColumnFormat.Money),
        Col("TVA"), Col("Remise %", ExcelColumnFormat.Quantity), Col("Total HT", ExcelColumnFormat.Money),
        Col("Montant TVA", ExcelColumnFormat.Money), Col("Total TTC", ExcelColumnFormat.Money), Col("FODEC"),
        Col("Identifiant")
    };

    private static ExcelColumn[] PaymentColumns() => new[]
    {
        Col("Numéro document"), Col("Date", ExcelColumnFormat.Date), Col("Montant", ExcelColumnFormat.Money),
        Col("Mode"), Col("Référence"), Col("Remboursé"), Col("Identifiant")
    };

    private static ExcelColumn[] SupplierInvoiceColumns() => new[]
    {
        Col("Numéro"), Col("Date", ExcelColumnFormat.Date), Col("Échéance", ExcelColumnFormat.Date), Col("Statut"),
        Col("Fournisseur"), Col("Total HT", ExcelColumnFormat.Money), Col("TVA", ExcelColumnFormat.Money),
        Col("Total TTC", ExcelColumnFormat.Money), Col("Payé", ExcelColumnFormat.Money),
        Col("Reste", ExcelColumnFormat.Money), Col("Référence externe"), Col("Bon de commande"), Col("Entrepôt"),
        Col("Taux de retenue", ExcelColumnFormat.Quantity), Col("Retenue", ExcelColumnFormat.Money),
        Col("Payée le", ExcelColumnFormat.Date), Col("Identifiant")
    };

    private static ExcelColumn[] CommercialLineColumns() => new[]
    {
        Col("Numéro document"), Col("N° ligne", ExcelColumnFormat.Quantity), Col("Code"), Col("Désignation"),
        Col("Quantité", ExcelColumnFormat.Quantity), Col("Unité"), Col("Prix unitaire HT", ExcelColumnFormat.Money),
        Col("TVA"), Col("Total HT", ExcelColumnFormat.Money), Col("Montant TVA", ExcelColumnFormat.Money),
        Col("Total TTC", ExcelColumnFormat.Money), Col("Identifiant")
    };

    private static string MovementTypeLabel(MovementType type) => type switch
    {
        MovementType.Entry => "Entrée",
        MovementType.Exit => "Sortie",
        MovementType.Adjustment => "Ajustement",
        _ => type.ToString()
    };

    private static ExcelSheetModel Sheet(
        string name,
        IReadOnlyList<ExcelColumn> columns,
        IEnumerable<IReadOnlyList<ExcelValue>> rows) =>
        new(ExcelSheetNames.Clamp(name), columns, rows.Select(r => (IReadOnlyList<ExcelValue>)r.ToArray()).ToArray());

    private static ExcelColumn Col(string header, ExcelColumnFormat format = ExcelColumnFormat.Text) =>
        new(header, format);

    private static IReadOnlyList<ExcelValue> Line(params ExcelValue[] cells) => cells;

    private static ExcelValue Text(string? value) => ExcelValue.FromText(value);
    private static ExcelValue Text(Guid id) => ExcelValue.FromText(id.ToString("D"));
    private static ExcelValue Money(decimal? value) => ExcelValue.FromNumber(value);
    private static ExcelValue Qty(decimal? value) => ExcelValue.FromNumber(value);
    private static ExcelValue Qty(int? value) => ExcelValue.FromNumber(value);
    private static ExcelValue Date(DateTime? value) => ExcelValue.FromDate(value);

    private static string Label(Func<string> display)
    {
        try
        {
            return display();
        }
        catch (ArgumentOutOfRangeException)
        {
            return string.Empty;
        }
    }
}
