using FactuTrust.Application.Common.Models;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Services.Templates;

/// <summary>
/// Projette les entités du domaine vers le <see cref="DocumentRenderModel"/> neutre consommé par les
/// modèles visuels. Centralise les différences entre types de documents.
/// </summary>
public static class DocumentRenderMappers
{
    private static string VatLineLabel(VatRate rate) =>
        rate == VatRate.Exempt ? "Exo." : $"TVA {(int)rate}%";

    private static string VatGroupLabel(VatRate rate) =>
        rate == VatRate.Exempt ? "TVA exonérée" : $"TVA {(int)rate}%";

    private static string VatLineLabel(int percent) => percent == 0 ? "Exo." : $"TVA {percent}%";
    private static string VatGroupLabel(int percent) => percent == 0 ? "TVA exonérée" : $"TVA {percent}%";

    private static PartyRenderInfo MapClientParty(Client client) => new()
    {
        Name = client.Name,
        TaxId = client.NIF?.Value,
        AddressLines = PdfRenderHelpers.SplitAddressLines(client.Address.ToMultiLine()),
        Email = client.Email?.Value,
        Phone = client.Phone?.Value
    };

    private static PartyRenderInfo MapSupplierParty(Supplier supplier) => new()
    {
        Name = supplier.Name,
        TaxId = supplier.NIF?.Value,
        AddressLines = PdfRenderHelpers.SplitAddressLines(supplier.Address.ToMultiLine()),
        Email = supplier.Email?.Value,
        Phone = supplier.Phone?.Value
    };

    private static PartyRenderInfo MapIssuer(Company? issuer, string? fallbackRib, string? fallbackBank)
    {
        if (issuer is null)
        {
            return new PartyRenderInfo
            {
                Name = "Émetteur",
                Rib = fallbackRib,
                BankName = fallbackBank
            };
        }

        return new PartyRenderInfo
        {
            Name = issuer.Name,
            TradeName = issuer.TradeName,
            TaxId = issuer.Nif.Value,
            CommerceRegistry = issuer.CommerceRegistry,
            AddressLines = PdfRenderHelpers.SplitAddressLines(issuer.Address.ToMultiLine()),
            Phone = issuer.Phone?.Value,
            Email = issuer.Email?.Value,
            Rib = issuer.Rib ?? fallbackRib,
            BankName = issuer.BankName ?? fallbackBank
        };
    }

    public static DocumentRenderModel FromInvoice(InvoicePdfContext ctx, byte[]? logoBytes, byte[]? qrBytes)
    {
        var invoice = ctx.Invoice;
        var isCredit = invoice.IsCreditNote;

        var lines = invoice.Lines.OrderBy(l => l.LineNumber).Select(l => new DocumentLineModel
        {
            LineNumber = l.LineNumber,
            Reference = string.Equals(l.ProductCode, "CUSTOM", StringComparison.OrdinalIgnoreCase) ? null : l.ProductCode,
            Name = l.ProductName,
            Description = l.ProductDescription,
            Quantity = l.Quantity,
            Unit = l.Unit,
            UnitPriceHt = l.UnitPrice.Amount,
            VatLabel = VatLineLabel(l.VatRate),
            VatRatePercent = (int)l.VatRate,
            DiscountPercent = l.DiscountPercent,
            LineTotalHt = l.SubTotal.Amount // SubTotal = HT après remise (Total = TTC)
        }).ToList();

        var vatBreakdown = invoice.Lines
            .GroupBy(l => l.VatRate)
            .OrderBy(g => (int)g.Key)
            .Select(g => new VatBreakdownLine(
                VatGroupLabel(g.Key),
                (int)g.Key,
                g.Sum(x => x.SubTotal.Amount + x.FodecAmount.Amount),
                g.Sum(x => x.VatAmount.Amount)))
            .ToList();

        var meta = new List<DocumentMetaItem>
        {
            new(isCredit ? "Avoir n°" : "Facture n°", invoice.Number.Value),
            new("Date", invoice.IssueDate.ToString("dd/MM/yyyy"))
        };
        if (invoice.DueDate.HasValue)
            meta.Add(new("Échéance", invoice.DueDate.Value.ToString("dd/MM/yyyy")));
        meta.Add(new("Statut", invoice.Status.ToDisplayString()));
        if (invoice.Warehouse != null)
            meta.Add(new("Entrepôt", invoice.Warehouse.Name));

        var eInvoice = new List<DocumentMetaItem>();
        if (!string.IsNullOrWhiteSpace(invoice.ElectronicInvoiceTtn))
        {
            eInvoice.Add(new("Réf TTN", invoice.ElectronicInvoiceTtn!));
            if (invoice.ElectronicInvoiceSentAt.HasValue)
                eInvoice.Add(new("Envoyé le", invoice.ElectronicInvoiceSentAt.Value.ToString("dd/MM/yyyy")));
        }

        var notes = new List<string>();
        if (!string.IsNullOrWhiteSpace(ctx.SourceQuoteNumber))
            notes.Add($"Basé sur devis : {ctx.SourceQuoteNumber}");

        // Mention obligatoire sur un avoir : la facture qu'il rectifie.
        if (isCredit && !string.IsNullOrWhiteSpace(ctx.LinkedInvoiceNumber))
            meta.Add(new("Facture rectifiée", ctx.LinkedInvoiceNumber!));

        return new DocumentRenderModel
        {
            DocumentType = isCredit ? PrintableDocumentType.CreditNote : PrintableDocumentType.SalesInvoice,
            TitleLabel = isCredit ? "FACTURE D'AVOIR" : "FACTURE",
            DocumentNumber = invoice.Number.Value,
            IsCreditNote = isCredit,
            Issuer = MapIssuer(ctx.Issuer, invoice.Rib, invoice.BankName),
            LogoBytes = logoBytes,
            PartyLabel = "Facturé à",
            Party = new PartyRenderInfo
            {
                Name = invoice.Client.Name,
                TaxId = invoice.Client.NIF?.Value,
                AddressLines = PdfRenderHelpers.SplitAddressLines(invoice.Client.Address.ToMultiLine()),
                Email = invoice.Client.Email?.Value
            },
            MetaItems = meta,
            Lines = lines,
            ShowDiscountColumn = lines.Any(l => l.DiscountPercent is > 0),
            SubTotal = invoice.SubTotal.Amount,
            VatBreakdown = vatBreakdown,
            Fodec = invoice.FodecAmount.Amount,
            FiscalStamp = invoice.FiscalStampAmount.Amount,
            Total = invoice.TotalAmount.Amount,
            Currency = invoice.TotalAmount.Currency,
            AmountInWords = PdfRenderHelpers.FormatAmountInFrench(Math.Abs(invoice.TotalAmount.Amount)),
            QrBytes = qrBytes,
            EInvoiceItems = eInvoice,
            Notes = string.IsNullOrWhiteSpace(invoice.Notes) ? (notes.Count > 0 ? string.Join(" — ", notes) : null) : invoice.Notes,
            Terms = invoice.PaymentTerms,
            ClosingNote = "Merci de votre confiance.",
            SignatureHash = invoice.SignatureHash
        };
    }

    public static DocumentRenderModel FromQuote(Quote quote, Company? issuer, byte[]? logoBytes)
    {
        var lines = quote.Lines.OrderBy(l => l.LineNumber).Select(l => new DocumentLineModel
        {
            LineNumber = l.LineNumber,
            Reference = string.Equals(l.ProductCode, "CUSTOM", StringComparison.OrdinalIgnoreCase) ? null : l.ProductCode,
            Name = l.ProductName,
            Description = l.ProductDescription,
            Quantity = l.Quantity,
            Unit = l.Unit,
            UnitPriceHt = l.UnitPrice.Amount,
            VatLabel = VatLineLabel(l.VatRate),
            VatRatePercent = (int)l.VatRate,
            DiscountPercent = l.DiscountPercent,
            LineTotalHt = l.SubTotal.Amount
        }).ToList();

        // Assiette TVA = HT après remise + FODEC, comme sur la facture (cf. FromInvoice).
        var vatBreakdown = quote.Lines
            .GroupBy(l => l.VatRate).OrderBy(g => (int)g.Key)
            .Select(g => new VatBreakdownLine(
                VatGroupLabel(g.Key),
                (int)g.Key,
                g.Sum(x => x.SubTotal.Amount + x.FodecAmount.Amount),
                g.Sum(x => x.VatAmount.Amount)))
            .ToList();

        return new DocumentRenderModel
        {
            DocumentType = PrintableDocumentType.Quote,
            TitleLabel = "DEVIS",
            DocumentNumber = quote.Number.Value,
            Issuer = MapIssuer(issuer, null, null),
            LogoBytes = logoBytes,
            PartyLabel = "Destinataire",
            Party = MapClientParty(quote.Client),
            MetaItems = new List<DocumentMetaItem>
            {
                new("Devis n°", quote.Number.Value),
                new("Date", quote.IssueDate.ToString("dd/MM/yyyy")),
                new("Valide jusqu'au", quote.ExpiryDate.ToString("dd/MM/yyyy")),
                new("Statut", quote.Status.ToDisplayString())
            },
            Lines = lines,
            ShowDiscountColumn = lines.Any(l => l.DiscountPercent is > 0),
            SubTotal = quote.SubTotal.Amount,
            VatBreakdown = vatBreakdown,
            Fodec = quote.FodecAmount.Amount,
            FiscalStamp = quote.FiscalStampAmount.Amount,
            Total = quote.TotalAmount.Amount,
            Currency = quote.TotalAmount.Currency,
            AmountInWords = PdfRenderHelpers.FormatAmountInFrench(quote.TotalAmount.Amount),
            Notes = quote.Notes,
            Terms = quote.TermsAndConditions,
            ClosingNote = "Ce document n'est pas une facture. Il devient caduc après la date de validité.",
            LegalMentions = quote.LegalMentions.ToList()
        };
    }

    public static DocumentRenderModel FromPurchaseOrder(PurchaseOrder po, Company? issuer, byte[]? logoBytes)
    {
        var lines = po.Lines.OrderBy(l => l.LineNumber).Select(l => new DocumentLineModel
        {
            LineNumber = l.LineNumber,
            Reference = string.Equals(l.ProductCode, "CUSTOM", StringComparison.OrdinalIgnoreCase) ? null : l.ProductCode,
            Name = l.ProductName,
            Description = l.ProductDescription,
            Quantity = l.Quantity,
            Unit = l.Unit,
            UnitPriceHt = l.UnitPrice.Amount,
            VatLabel = VatLineLabel(l.VatRate),
            VatRatePercent = (int)l.VatRate,
            LineTotalHt = l.SubTotal.Amount
        }).ToList();

        var vatBreakdown = po.Lines
            .GroupBy(l => l.VatRate).OrderBy(g => (int)g.Key)
            .Select(g => new VatBreakdownLine(VatGroupLabel(g.Key), (int)g.Key, g.Sum(x => x.SubTotal.Amount), g.Sum(x => x.VatAmount.Amount)))
            .ToList();

        var meta = new List<DocumentMetaItem>
        {
            new("Commande n°", po.Number.Value),
            new("Date", po.OrderDate.ToString("dd/MM/yyyy"))
        };
        if (po.ExpectedDeliveryDate.HasValue)
            meta.Add(new("Livraison prévue", po.ExpectedDeliveryDate.Value.ToString("dd/MM/yyyy")));
        meta.Add(new("Statut", po.Status.ToString()));

        return new DocumentRenderModel
        {
            DocumentType = PrintableDocumentType.PurchaseOrder,
            TitleLabel = "BON DE COMMANDE",
            DocumentNumber = po.Number.Value,
            Issuer = MapIssuer(issuer, null, null),
            LogoBytes = logoBytes,
            PartyLabel = "Fournisseur",
            Party = MapSupplierParty(po.Supplier),
            MetaItems = meta,
            Lines = lines,
            SubTotal = po.SubTotal.Amount,
            VatBreakdown = vatBreakdown,
            Total = po.TotalAmount.Amount,
            Currency = po.TotalAmount.Currency,
            AmountInWords = PdfRenderHelpers.FormatAmountInFrench(po.TotalAmount.Amount),
            Notes = po.Notes,
            ClosingNote = "Ce document est un bon de commande fournisseur."
        };
    }

    public static DocumentRenderModel FromDeliveryNote(
        DeliveryNote dn,
        Company? issuer,
        byte[]? logoBytes,
        IReadOnlyDictionary<Guid, string>? lotLabels = null)
    {
        var lines = dn.Lines.OrderBy(l => l.LineNumber).Select(l => new DocumentLineModel
        {
            LineNumber = l.LineNumber,
            Reference = string.Equals(l.ProductCode, "CUSTOM", StringComparison.OrdinalIgnoreCase) ? null : l.ProductCode,
            Name = lotLabels is not null && lotLabels.TryGetValue(l.Id, out var lot) && !string.IsNullOrWhiteSpace(lot)
                ? $"{l.Designation} — {lot}"
                : l.Designation,
            Description = l.Description,
            Quantity = l.OrderedQuantity,
            Unit = l.Unit,
            UnitPriceHt = l.UnitPriceHT,
            VatLabel = VatLineLabel(l.VatRatePercent),
            VatRatePercent = l.VatRatePercent,
            DiscountPercent = l.DiscountPercent,
            LineTotalHt = l.TotalHT,
            OrderedQuantity = l.OrderedQuantity,
            DeliveredQuantity = l.DeliveredQuantity
        }).ToList();

        // Assiette TVA = HT après remise + FODEC, comme sur la facture (cf. FromInvoice).
        var vatBreakdown = dn.Lines
            .GroupBy(l => l.VatRatePercent).OrderBy(g => g.Key)
            .Select(g => new VatBreakdownLine(
                VatGroupLabel(g.Key),
                g.Key,
                g.Sum(x => x.TotalHT + x.FodecAmount),
                g.Sum(x => x.TotalVAT)))
            .ToList();

        var meta = new List<DocumentMetaItem>
        {
            new("BL n°", dn.Number.Value),
            new("Date", dn.IssueDate.ToString("dd/MM/yyyy"))
        };
        if (dn.DeliveryDate.HasValue)
            meta.Add(new("Livraison", dn.DeliveryDate.Value.ToString("dd/MM/yyyy")));
        meta.Add(new("Statut", dn.Status.ToDisplayString()));

        var deliveryAddress = string.Join(" ", new[] { dn.DeliveryAddress, dn.DeliveryPostalCode, dn.DeliveryCity }
            .Where(s => !string.IsNullOrWhiteSpace(s)));

        return new DocumentRenderModel
        {
            DocumentType = PrintableDocumentType.DeliveryNote,
            TitleLabel = "BON DE LIVRAISON",
            DocumentNumber = dn.Number.Value,
            Issuer = MapIssuer(issuer, null, null),
            LogoBytes = logoBytes,
            PartyLabel = "Destinataire",
            Party = MapClientParty(dn.Client),
            MetaItems = meta,
            Lines = lines,
            ShowDeliveryQuantities = true,
            ShowDiscountColumn = lines.Any(l => l.DiscountPercent is > 0),
            SubTotal = dn.TotalHT,
            VatBreakdown = vatBreakdown,
            Fodec = dn.TotalFodec,
            Total = dn.TotalTTC,
            Currency = "TND",
            AmountInWords = PdfRenderHelpers.FormatAmountInFrench(dn.TotalTTC),
            Notes = string.IsNullOrWhiteSpace(deliveryAddress) ? dn.Notes : $"Adresse de livraison : {deliveryAddress}",
            ClosingNote = string.IsNullOrWhiteSpace(dn.RecipientName) ? null : $"Réceptionné par : {dn.RecipientName}"
        };
    }

    public static DocumentRenderModel FromSalesReturnNote(SalesReturnNote note, Company? issuer, byte[]? logoBytes)
    {
        var lines = note.Lines.OrderBy(l => l.LineNumber).Select(l => new DocumentLineModel
        {
            LineNumber = l.LineNumber,
            Reference = string.Equals(l.ProductCode, "CUSTOM", StringComparison.OrdinalIgnoreCase) ? null : l.ProductCode,
            Name = l.Designation,
            Description = l.Description,
            Quantity = l.ReturnedQuantity,
            Unit = l.Unit,
            UnitPriceHt = l.UnitPriceHT,
            VatLabel = VatLineLabel(l.VatRatePercent),
            VatRatePercent = l.VatRatePercent,
            DiscountPercent = l.DiscountPercent,
            LineTotalHt = l.TotalHT,
            OrderedQuantity = l.ReturnedQuantity,
            DeliveredQuantity = l.ReturnedQuantity
        }).ToList();

        var vatBreakdown = note.Lines
            .GroupBy(l => l.VatRatePercent).OrderBy(g => g.Key)
            .Select(g => new VatBreakdownLine(
                VatGroupLabel(g.Key),
                g.Key,
                g.Sum(x => x.TotalHT + x.FodecAmount),
                g.Sum(x => x.TotalVAT)))
            .ToList();

        var blNumber = note.DeliveryNote?.Number.Value;
        var meta = new List<DocumentMetaItem>
        {
            new("BRT n°", note.Number.Value),
            new("Date", note.ReturnDate.ToString("dd/MM/yyyy")),
            new("Statut", note.Status.ToDisplayString())
        };
        if (!string.IsNullOrWhiteSpace(blNumber))
            meta.Add(new("BL d'origine", blNumber));
        meta.Add(new("Motif", note.Reason));

        return new DocumentRenderModel
        {
            DocumentType = PrintableDocumentType.SalesReturnNote,
            TitleLabel = "BON DE RETOUR",
            DocumentNumber = note.Number.Value,
            Issuer = MapIssuer(issuer, null, null),
            LogoBytes = logoBytes,
            PartyLabel = "Client",
            Party = MapClientParty(note.Client),
            MetaItems = meta,
            Lines = lines,
            ShowDeliveryQuantities = false,
            ShowDiscountColumn = lines.Any(l => l.DiscountPercent is > 0),
            SubTotal = note.TotalHT,
            VatBreakdown = vatBreakdown,
            Fodec = note.TotalFodec,
            Total = note.TotalTTC,
            Currency = "TND",
            AmountInWords = PdfRenderHelpers.FormatAmountInFrench(note.TotalTTC),
            Notes = note.Notes,
            ClosingNote = string.IsNullOrWhiteSpace(blNumber)
                ? "Document logistique — ce bon de retour n'est pas un avoir fiscal."
                : $"Retour rattaché au bon de livraison {blNumber}. Ce document n'est pas un avoir fiscal."
        };
    }

    public static DocumentRenderModel FromSupplierInvoice(SupplierInvoice si, Company? issuer, byte[]? logoBytes)
    {
        var lines = si.Lines.OrderBy(l => l.LineNumber).Select(l => new DocumentLineModel
        {
            LineNumber = l.LineNumber,
            Reference = string.Equals(l.ProductCode, "CUSTOM", StringComparison.OrdinalIgnoreCase) ? null : l.ProductCode,
            Name = l.ProductName,
            Description = l.ProductDescription,
            Quantity = l.Quantity,
            Unit = l.Unit,
            UnitPriceHt = l.UnitPrice.Amount,
            VatLabel = VatLineLabel(l.VatRate),
            VatRatePercent = (int)l.VatRate,
            LineTotalHt = l.SubTotal.Amount
        }).ToList();

        var vatBreakdown = si.Lines
            .GroupBy(l => l.VatRate).OrderBy(g => (int)g.Key)
            .Select(g => new VatBreakdownLine(VatGroupLabel(g.Key), (int)g.Key, g.Sum(x => x.SubTotal.Amount), g.Sum(x => x.VatAmount.Amount)))
            .ToList();

        return new DocumentRenderModel
        {
            DocumentType = PrintableDocumentType.SupplierInvoice,
            TitleLabel = "FACTURE D'ACHAT",
            DocumentNumber = si.InvoiceNumber,
            Issuer = MapIssuer(issuer, null, null),
            LogoBytes = logoBytes,
            PartyLabel = "Fournisseur",
            Party = MapSupplierParty(si.Supplier),
            MetaItems = new List<DocumentMetaItem>
            {
                new("Facture n°", si.InvoiceNumber),
                new("Date", si.InvoiceDate.ToString("dd/MM/yyyy")),
                new("Échéance", si.DueDate.ToString("dd/MM/yyyy")),
                new("Statut", si.Status.ToString())
            },
            Lines = lines,
            SubTotal = si.SubTotal.Amount,
            VatBreakdown = vatBreakdown,
            FiscalStamp = si.FiscalStampAmount.Amount,
            WithholdingAmount = si.WithholdingAmount,
            NetAfterWithholding = si.NetAmountAfterWithholding,
            Total = si.TotalAmount.Amount,
            Currency = si.TotalAmount.Currency,
            AmountInWords = PdfRenderHelpers.FormatAmountInFrench(si.TotalAmount.Amount),
            Notes = si.Notes,
            Terms = string.IsNullOrWhiteSpace(si.ExternalReference) ? null : $"Référence externe : {si.ExternalReference}"
        };
    }
}
