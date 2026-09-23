using System;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Models;
using FactuTrust.Application.Features.Stock.Queries;
using FactuTrust.Domain.Constants;
using Microsoft.Extensions.Http;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// PDF generation service using QuestPDF (open source).
/// </summary>
public partial class PdfService : IPdfService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IDocumentTemplateRegistry _templateRegistry;
    private readonly OfficialForms.OfficialFormStamper _officialFormStamper;
    private readonly IStockTraceabilityQuery? _traceability;

    public PdfService(
        IHttpClientFactory httpClientFactory,
        IDocumentTemplateRegistry templateRegistry,
        OfficialForms.OfficialFormStamper? officialFormStamper = null,
        IStockTraceabilityQuery? traceability = null)
    {
        _httpClientFactory = httpClientFactory;
        _templateRegistry = templateRegistry;
        _officialFormStamper = officialFormStamper
            ?? new OfficialForms.OfficialFormStamper(
                Microsoft.Extensions.Logging.Abstractions.NullLogger<OfficialForms.OfficialFormStamper>.Instance);
        _traceability = traceability;
    }
    // TextStyle par défaut avec fallback pour supporter les caractères Unicode (français, etc.)
    // L'ordre est important : QuestPDF essaiera chaque police dans l'ordre jusqu'à trouver celle qui supporte les glyphes nécessaires
    private static readonly TextStyle DefaultTextStyle = TextStyle.Default
        .FontFamily("Lato", "Arial", "Helvetica", "DejaVu Sans", "Liberation Sans", "Calibri", "Segoe UI")
        .FontSize(10);

    static PdfService()
    {
        QuestPDF.Settings.License = LicenseType.Community;
        
        // Désactiver la vérification stricte des glyphes pour éviter les erreurs
        // avec les caractères de contrôle et permettre le fallback automatique
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
        
        // Activer l'utilisation des polices système pour un meilleur support Unicode
        QuestPDF.Settings.UseEnvironmentFonts = true;
    }

    public async Task<byte[]> GenerateInvoicePdfAsync(InvoicePdfContext context, CancellationToken cancellationToken = default)
    {
        var logoBytes = await TryDownloadLogoAsync(context.Issuer?.LogoUrl, cancellationToken).ConfigureAwait(false);
        var qrBytes = BuildElectronicInvoiceQrPng(context.Invoice);

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(28);
                page.DefaultTextStyle(DefaultTextStyle);

                page.Header().Element(c => ComposeSalesInvoiceHeader(c, context, logoBytes));
                page.Content().Element(c => ComposeSalesInvoiceContent(c, context, qrBytes));
                page.Footer().Element(c => ComposeSalesInvoiceFooter(c, context, logoBytes));
            });
        });

        return document.GeneratePdf();
    }

    public async Task<byte[]> GenerateInvoicePdfAsync(InvoicePdfContext context, string? templateKey, CancellationToken cancellationToken = default)
    {
        // Modèle par défaut (ou clé inconnue) => rendu historique inchangé.
        if (_templateRegistry.IsDefault(templateKey))
            return await GenerateInvoicePdfAsync(context, cancellationToken).ConfigureAwait(false);

        var logoBytes = await TryDownloadLogoAsync(context.Issuer?.LogoUrl, cancellationToken).ConfigureAwait(false);
        var qrBytes = BuildElectronicInvoiceQrPng(context.Invoice);
        var model = Templates.DocumentRenderMappers.FromInvoice(context, logoBytes, qrBytes);
        return _templateRegistry.Get(templateKey).Render(model);
    }

    public async Task<byte[]> GenerateQuotePdfAsync(Quote quote, Company? issuer, string? templateKey, CancellationToken cancellationToken = default)
    {
        if (_templateRegistry.IsDefault(templateKey))
            return await GenerateQuotePdfAsync(quote, cancellationToken).ConfigureAwait(false);

        var logoBytes = await TryDownloadLogoAsync(issuer?.LogoUrl, cancellationToken).ConfigureAwait(false);
        var model = Templates.DocumentRenderMappers.FromQuote(quote, issuer, logoBytes);
        return _templateRegistry.Get(templateKey).Render(model);
    }

    public async Task<byte[]> GeneratePurchaseOrderPdfAsync(PurchaseOrder purchaseOrder, Company? issuer, string? templateKey, CancellationToken cancellationToken = default)
    {
        if (_templateRegistry.IsDefault(templateKey))
            return await GeneratePurchaseOrderPdfAsync(purchaseOrder, cancellationToken).ConfigureAwait(false);

        var logoBytes = await TryDownloadLogoAsync(issuer?.LogoUrl, cancellationToken).ConfigureAwait(false);
        var model = Templates.DocumentRenderMappers.FromPurchaseOrder(purchaseOrder, issuer, logoBytes);
        return _templateRegistry.Get(templateKey).Render(model);
    }

    public async Task<byte[]> GenerateDeliveryNotePdfAsync(DeliveryNote deliveryNote, Company? issuer, string? templateKey, CancellationToken cancellationToken = default)
    {
        // Aucun rendu historique individuel pour le BL : on passe toujours par le pipeline unifié
        // (le modèle par défaut "standard" fournit une mise en page propre).
        var logoBytes = await TryDownloadLogoAsync(issuer?.LogoUrl, cancellationToken).ConfigureAwait(false);
        IReadOnlyDictionary<Guid, string>? lotLabels = null;
        if (_traceability is not null)
        {
            lotLabels = await _traceability.GetLotLabelsAsync(
                StockDocumentKind.DeliveryNote,
                deliveryNote.Lines.Select(l => l.Id).ToList(),
                cancellationToken).ConfigureAwait(false);
        }

        var model = Templates.DocumentRenderMappers.FromDeliveryNote(deliveryNote, issuer, logoBytes, lotLabels);
        return _templateRegistry.Get(templateKey).Render(model);
    }

    public async Task<byte[]> GenerateSalesReturnNotePdfAsync(SalesReturnNote note, Company? issuer, string? templateKey, CancellationToken cancellationToken = default)
    {
        var logoBytes = await TryDownloadLogoAsync(issuer?.LogoUrl, cancellationToken).ConfigureAwait(false);
        var model = Templates.DocumentRenderMappers.FromSalesReturnNote(note, issuer, logoBytes);
        return _templateRegistry.Get(templateKey).Render(model);
    }

    public async Task<byte[]> GenerateSupplierInvoicePdfAsync(SupplierInvoice supplierInvoice, Company? issuer, string? templateKey, CancellationToken cancellationToken = default)
    {
        var logoBytes = await TryDownloadLogoAsync(issuer?.LogoUrl, cancellationToken).ConfigureAwait(false);
        var model = Templates.DocumentRenderMappers.FromSupplierInvoice(supplierInvoice, issuer, logoBytes);
        return _templateRegistry.Get(templateKey).Render(model);
    }

    public Task<byte[]> GenerateQuotePdfAsync(Quote quote, CancellationToken cancellationToken = default)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(DefaultTextStyle);

                page.Header().Element(c => ComposeQuoteHeader(c, quote));
                page.Content().Element(c => ComposeQuoteContent(c, quote));
                page.Footer().Element(c => ComposeQuoteFooter(c, quote));
            });
        });

        var bytes = document.GeneratePdf();
        return Task.FromResult(bytes);
    }

    public Task<byte[]> GenerateInvoiceReportPdfAsync(
        IEnumerable<Invoice> invoices,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        Company? company = null,
        string? clientName = null,
        CancellationToken cancellationToken = default)
    {
        var invoiceList = invoices.ToList();
        var companyName = company?.Name ?? BrandConstants.Name;
        var generatedAt = DateTime.UtcNow;

        var currency = invoiceList.First().TotalAmount.Currency;
        var totalSubTotal = invoiceList.Sum(i => i.SubTotal.Amount);
        var totalVat = invoiceList.Sum(i => i.TotalVat.Amount);
        var totalAmount = invoiceList.Sum(i => i.TotalAmount.Amount);

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(30);
                page.DefaultTextStyle(DefaultTextStyle.FontSize(9));

                page.Header().Column(column =>
                {
                    column.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(companyName).FontSize(14).Bold().FontColor(Colors.Blue.Darken2);
                        });
                        row.RelativeItem().AlignRight().Column(c =>
                        {
                            c.Item().Text("Rapport des Factures").FontSize(18).Bold().FontColor(Colors.Blue.Darken2);
                            if (fromDate.HasValue && toDate.HasValue)
                                c.Item().Text($"Du {fromDate.Value:dd/MM/yyyy} au {toDate.Value:dd/MM/yyyy}").FontSize(10).FontColor(Colors.Grey.Darken1);
                            if (!string.IsNullOrEmpty(clientName))
                                c.Item().Text($"Client : {clientName}").FontSize(10).FontColor(Colors.Grey.Darken1);
                        });
                    });
                    column.Item().PaddingTop(8).BorderBottom(2).BorderColor(Colors.Blue.Darken2);
                });

                page.Content().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(1);
                    });

                    table.Header(header =>
                    {
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Numéro").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Date").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Client").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text("Montant HT").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text("TVA").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text("Total TTC").Bold().FontColor(Colors.White);
                    });

                    var index = 0;
                    foreach (var invoice in invoiceList)
                    {
                        var bgColor = index % 2 == 0 ? Colors.Grey.Lighten4 : Colors.White;
                        table.Cell().Background(bgColor).Padding(5).Text(invoice.Number.Value);
                        table.Cell().Background(bgColor).Padding(5).Text(invoice.IssueDate.ToString("dd/MM/yyyy"));
                        table.Cell().Background(bgColor).Padding(5).Text(invoice.Client.Name);
                        table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{invoice.SubTotal.Amount:N3} {currency}");
                        table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{invoice.TotalVat.Amount:N3} {currency}");
                        table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{invoice.TotalAmount.Amount:N3} {currency}");
                        index++;
                    }

                    table.Cell().ColumnSpan(3).Background(Colors.Blue.Darken2).Padding(5).Text("TOTAL").Bold().FontColor(Colors.White);
                    table.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text($"{totalSubTotal:N3} {currency}").Bold().FontColor(Colors.White);
                    table.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text($"{totalVat:N3} {currency}").Bold().FontColor(Colors.White);
                    table.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text($"{totalAmount:N3} {currency}").Bold().FontColor(Colors.White);
                });

                page.Footer().Row(row =>
                {
                    row.RelativeItem().Text($"Généré le {generatedAt:dd/MM/yyyy à HH:mm}").FontSize(8).FontColor(Colors.Grey.Darken1);
                    row.RelativeItem().AlignCenter().Column(c =>
                    {
                        c.Item().DefaultTextStyle(DefaultTextStyle.FontSize(8)).Text(x =>
                        {
                            x.Span("Page ");
                            x.CurrentPageNumber();
                            x.Span(" / ");
                            x.TotalPages();
                        });
                    });
                    row.RelativeItem().AlignRight().Text($"{invoiceList.Count} factures").FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });
        });

        var bytes = document.GeneratePdf();
        return Task.FromResult(bytes);
    }

    public Task<byte[]> GenerateDeliveryNoteReportPdfAsync(
        IEnumerable<DeliveryNote> deliveryNotes,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        Company? company = null,
        string? clientName = null,
        CancellationToken cancellationToken = default)
    {
        var noteList = deliveryNotes.ToList();
        var companyName = company?.Name ?? BrandConstants.Name;
        var generatedAt = DateTime.UtcNow;
        const string currency = Money.DefaultCurrency;

        var totalHT = noteList.Sum(d => d.TotalHT);
        var totalVat = noteList.Sum(d => d.TotalVAT);
        var totalTTC = noteList.Sum(d => d.TotalTTC);

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(30);
                page.DefaultTextStyle(DefaultTextStyle.FontSize(9));

                page.Header().Column(column =>
                {
                    column.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(companyName).FontSize(14).Bold().FontColor(Colors.Blue.Darken2);
                        });
                        row.RelativeItem().AlignRight().Column(c =>
                        {
                            c.Item().Text("Rapport des Bons de Livraison").FontSize(18).Bold().FontColor(Colors.Blue.Darken2);
                            if (fromDate.HasValue && toDate.HasValue)
                                c.Item().Text($"Du {fromDate.Value:dd/MM/yyyy} au {toDate.Value:dd/MM/yyyy}").FontSize(10).FontColor(Colors.Grey.Darken1);
                            if (!string.IsNullOrEmpty(clientName))
                                c.Item().Text($"Client : {clientName}").FontSize(10).FontColor(Colors.Grey.Darken1);
                        });
                    });
                    column.Item().PaddingTop(8).BorderBottom(2).BorderColor(Colors.Blue.Darken2);
                });

                page.Content().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(1);
                        columns.RelativeColumn(1);
                    });

                    table.Header(header =>
                    {
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Numéro").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Date").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Client").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text("Montant HT").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text("TVA").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text("Total TTC").Bold().FontColor(Colors.White);
                        header.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Statut").Bold().FontColor(Colors.White);
                    });

                    var index = 0;
                    foreach (var note in noteList)
                    {
                        var bgColor = index % 2 == 0 ? Colors.Grey.Lighten4 : Colors.White;
                        table.Cell().Background(bgColor).Padding(5).Text(note.Number.Value);
                        table.Cell().Background(bgColor).Padding(5).Text(note.IssueDate.ToString("dd/MM/yyyy"));
                        table.Cell().Background(bgColor).Padding(5).Text(note.Client?.Name ?? "—");
                        table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{note.TotalHT:N3} {currency}");
                        table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{note.TotalVAT:N3} {currency}");
                        table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{note.TotalTTC:N3} {currency}");
                        table.Cell().Background(bgColor).Padding(5).Text(note.Status.ToDisplayString());
                        index++;
                    }

                    table.Cell().ColumnSpan(3).Background(Colors.Blue.Darken2).Padding(5).Text("TOTAL").Bold().FontColor(Colors.White);
                    table.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text($"{totalHT:N3} {currency}").Bold().FontColor(Colors.White);
                    table.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text($"{totalVat:N3} {currency}").Bold().FontColor(Colors.White);
                    table.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text($"{totalTTC:N3} {currency}").Bold().FontColor(Colors.White);
                    table.Cell().Background(Colors.Blue.Darken2).Padding(5);
                });

                page.Footer().Row(row =>
                {
                    row.RelativeItem().Text($"Généré le {generatedAt:dd/MM/yyyy à HH:mm}").FontSize(8).FontColor(Colors.Grey.Darken1);
                    row.RelativeItem().AlignCenter().Column(c =>
                    {
                        c.Item().DefaultTextStyle(DefaultTextStyle.FontSize(8)).Text(x =>
                        {
                            x.Span("Page ");
                            x.CurrentPageNumber();
                            x.Span(" / ");
                            x.TotalPages();
                        });
                    });
                    row.RelativeItem().AlignRight().Text($"{noteList.Count} bons de livraison").FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });
        });

        var bytes = document.GeneratePdf();
        return Task.FromResult(bytes);
    }

    private static void ComposeQuoteHeader(IContainer container, Quote quote)
    {
        container.Row(row =>
        {
            row.RelativeItem().Column(column =>
            {
                column.Item().Text("DEVIS").FontSize(24).Bold().FontColor(Colors.Teal.Darken2);
                column.Item().Text($"N° {quote.Number.Value}").FontSize(14);
                column.Item().PaddingTop(5).Text($"Date: {quote.IssueDate:dd/MM/yyyy}");
                column.Item().Text($"Valide jusqu'au: {quote.ExpiryDate:dd/MM/yyyy}");
            });

            row.RelativeItem().AlignRight().Column(column =>
            {
                column.Item().Text($"Statut: {quote.Status.ToDisplayString()}").Bold();
            });
        });
    }

    private static void ComposeQuoteContent(IContainer container, Quote quote)
    {
        container.PaddingVertical(20).Column(column =>
        {
            column.Item().Row(row =>
            {
                row.RelativeItem().Column(c =>
                {
                    c.Item().Text("DESTINATAIRE").Bold().FontColor(Colors.Grey.Darken1);
                    c.Item().PaddingTop(5).Text(quote.Client.Name).Bold();
                    if (quote.Client.NIF != null)
                        c.Item().Text($"NIF: {quote.Client.NIF.Value}");
                    
                    // Afficher l'adresse ligne par ligne pour éviter les problèmes avec les caractères de contrôle
                    var addressLines = quote.Client.Address.ToMultiLine()
                        .Split(new[] { Environment.NewLine, "\n", "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var addressLine in addressLines)
                    {
                        if (!string.IsNullOrWhiteSpace(addressLine))
                            c.Item().Text(addressLine.Trim());
                    }
                    
                    if (quote.Client.Email != null)
                        c.Item().Text(quote.Client.Email.Value);
                });
            });

            column.Item().PaddingTop(20).Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(3);
                    columns.RelativeColumn(1);
                    columns.RelativeColumn(1);
                    columns.RelativeColumn(1);
                    columns.RelativeColumn(1);
                    columns.RelativeColumn(1);
                });

                table.Header(header =>
                {
                    header.Cell().Background(Colors.Teal.Darken2).Padding(5).Text("Description").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Teal.Darken2).Padding(5).Text("Qté").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Teal.Darken2).Padding(5).Text("Prix U.").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Teal.Darken2).Padding(5).Text("TVA").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Teal.Darken2).Padding(5).Text("Remise").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Teal.Darken2).Padding(5).Text("Total").FontColor(Colors.White).Bold();
                });

                foreach (var line in quote.Lines.OrderBy(l => l.LineNumber))
                {
                    var bgColor = line.LineNumber % 2 == 0 ? Colors.Grey.Lighten4 : Colors.White;
                    table.Cell().Background(bgColor).Padding(5).Column(c =>
                    {
                        c.Item().Text(line.ProductName).Bold();
                        if (!string.IsNullOrEmpty(line.ProductDescription))
                        {
                            // Nettoyer les caractères de contrôle (retours à la ligne) du ProductDescription
                            var cleanDescription = CleanTextForPdf(line.ProductDescription);
                            c.Item().Text(cleanDescription).FontSize(8).FontColor(Colors.Grey.Darken1);
                        }
                    });
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{line.Quantity:N2} {line.Unit ?? ""}");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{line.UnitPrice.Amount:N3}");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{(int)line.VatRate}%");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text(line.DiscountPercent.HasValue ? $"{line.DiscountPercent:N1}%" : "-");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{line.Total.Amount:N3}");
                }
            });

            column.Item().PaddingTop(10).AlignRight().Width(200).Table(table =>
            {
                table.ColumnsDefinition(columns => { columns.RelativeColumn(1); columns.RelativeColumn(1); });
                table.Cell().Padding(5).Text("Sous-total HT:").Bold();
                table.Cell().Padding(5).AlignRight().Text($"{quote.SubTotal.Amount:N3} TND");
                var vatBreakdown = quote.GetVatBreakdown();
                foreach (var vat in vatBreakdown.OrderBy(v => (int)v.Key))
                {
                    table.Cell().Padding(5).Text($"TVA {(int)vat.Key}%:");
                    table.Cell().Padding(5).AlignRight().Text($"{vat.Value.Amount:N3} TND");
                }
                table.Cell().Background(Colors.Teal.Darken2).Padding(5).Text("TOTAL TTC:").Bold().FontColor(Colors.White);
                table.Cell().Background(Colors.Teal.Darken2).Padding(5).AlignRight().Text($"{quote.TotalAmount.Amount:N3} TND").Bold().FontColor(Colors.White);
            });

            if (!string.IsNullOrEmpty(quote.Notes))
            {
                column.Item().PaddingTop(20).Column(c =>
                {
                    c.Item().Text("Notes:").Bold();
                    // Nettoyer le texte pour supprimer les caractères de contrôle, puis l'afficher
                    var cleanNotes = CleanTextForPdf(quote.Notes);
                    c.Item().Text(cleanNotes);
                });
            }
            if (!string.IsNullOrEmpty(quote.TermsAndConditions))
            {
                column.Item().PaddingTop(10).Column(c =>
                {
                    c.Item().Text("Conditions générales:").Bold();
                    // Nettoyer le texte pour supprimer les caractères de contrôle, puis l'afficher
                    var cleanTerms = CleanTextForPdf(quote.TermsAndConditions);
                    c.Item().Text(cleanTerms);
                });
            }
        });
    }

    private static void ComposeQuoteFooter(IContainer container, Quote quote)
    {
        container.Column(column =>
        {
            column.Item().BorderTop(1).BorderColor(Colors.Grey.Lighten1).PaddingTop(10);
            column.Item().AlignCenter().Text("Ce document n'est pas une facture. Il devient caduc après la date de validité.");
            column.Item().AlignCenter().Text(x =>
            {
                x.Span("Page ");
                x.CurrentPageNumber();
                x.Span(" / ");
                x.TotalPages();
            });
        });
    }

    public Task<byte[]> GeneratePurchaseOrderPdfAsync(PurchaseOrder purchaseOrder, CancellationToken cancellationToken = default)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(DefaultTextStyle);

                page.Header().Element(c => ComposePurchaseOrderHeader(c, purchaseOrder));
                page.Content().Element(c => ComposePurchaseOrderContent(c, purchaseOrder));
                page.Footer().Element(c => ComposePurchaseOrderFooter(c, purchaseOrder));
            });
        });

        var bytes = document.GeneratePdf();
        return Task.FromResult(bytes);
    }

    private static void ComposePurchaseOrderHeader(IContainer container, PurchaseOrder po)
    {
        container.Row(row =>
        {
            row.RelativeItem().Column(column =>
            {
                column.Item().Text("BON DE COMMANDE").FontSize(24).Bold().FontColor(Colors.Orange.Darken2);
                column.Item().Text($"N° {po.Number.Value}").FontSize(14);
                column.Item().PaddingTop(5).Text($"Date : {po.OrderDate:dd/MM/yyyy}");
                if (po.ExpectedDeliveryDate.HasValue)
                    column.Item().Text($"Livraison prévue : {po.ExpectedDeliveryDate:dd/MM/yyyy}");
                if (po.Warehouse != null)
                    column.Item().Text($"Entrepôt de réception : {po.Warehouse.Name}").FontSize(9).FontColor(Colors.Grey.Darken1);
            });

            row.RelativeItem().AlignRight().Column(column =>
            {
                column.Item().Text($"Statut : {po.Status}").Bold();
                if (!string.IsNullOrEmpty(po.Reference))
                    column.Item().Text($"Réf : {po.Reference}").FontSize(9);
                if (po.ConfirmedAt.HasValue)
                    column.Item().Text($"Confirmée le : {po.ConfirmedAt:dd/MM/yyyy}").FontSize(8);
            });
        });
    }

    private static void ComposePurchaseOrderContent(IContainer container, PurchaseOrder po)
    {
        container.PaddingVertical(20).Column(column =>
        {
            // Supplier info
            column.Item().Row(row =>
            {
                row.RelativeItem().Column(c =>
                {
                    c.Item().Text("FOURNISSEUR").Bold().FontColor(Colors.Grey.Darken1);
                    c.Item().PaddingTop(5).Text(po.Supplier?.Name ?? "-").Bold();
                    if (po.Supplier?.NIF != null)
                        c.Item().Text($"NIF : {po.Supplier.NIF.Value}");
                    if (po.Supplier?.Address != null)
                    {
                        var addressLines = po.Supplier.Address.ToMultiLine()
                            .Split(new[] { Environment.NewLine, "\n", "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
                        foreach (var addressLine in addressLines)
                        {
                            if (!string.IsNullOrWhiteSpace(addressLine))
                                c.Item().Text(addressLine.Trim());
                        }
                    }
                    if (po.Supplier?.Email != null)
                        c.Item().Text(po.Supplier.Email.Value);
                });
            });

            // Lines table
            column.Item().PaddingTop(20).Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(3); // Description
                    columns.RelativeColumn(1); // Qté commandée
                    columns.RelativeColumn(1); // Qté reçue
                    columns.RelativeColumn(1); // Prix U.
                    columns.RelativeColumn(1); // TVA
                    columns.RelativeColumn(1); // Total
                });

                table.Header(header =>
                {
                    header.Cell().Background(Colors.Orange.Darken2).Padding(5).Text("Description").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Orange.Darken2).Padding(5).Text("Qté cmd").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Orange.Darken2).Padding(5).Text("Qté reçue").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Orange.Darken2).Padding(5).Text("Prix U.").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Orange.Darken2).Padding(5).Text("TVA").FontColor(Colors.White).Bold();
                    header.Cell().Background(Colors.Orange.Darken2).Padding(5).Text("Total").FontColor(Colors.White).Bold();
                });

                foreach (var line in po.Lines.OrderBy(l => l.LineNumber))
                {
                    var bgColor = line.LineNumber % 2 == 0 ? Colors.Grey.Lighten4 : Colors.White;

                    table.Cell().Background(bgColor).Padding(5).Column(c =>
                    {
                        c.Item().Text(line.ProductName).Bold();
                        if (!string.IsNullOrEmpty(line.ProductDescription))
                        {
                            var cleanDescription = CleanTextForPdf(line.ProductDescription);
                            c.Item().Text(cleanDescription).FontSize(8).FontColor(Colors.Grey.Darken1);
                        }
                    });
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{line.Quantity:N2} {line.Unit ?? ""}");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{line.ReceivedQuantity:N2}");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{line.UnitPrice.Amount:N3}");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{(int)line.VatRate}%");
                    table.Cell().Background(bgColor).Padding(5).AlignRight().Text($"{line.Total.Amount:N3}");
                }
            });

            // Totals
            column.Item().PaddingTop(10).AlignRight().Width(200).Table(table =>
            {
                table.ColumnsDefinition(columns => { columns.RelativeColumn(1); columns.RelativeColumn(1); });
                table.Cell().Padding(5).Text("Sous-total HT :").Bold();
                table.Cell().Padding(5).AlignRight().Text($"{po.SubTotal.Amount:N3} TND");

                var vatBreakdown = po.GetVatBreakdown();
                foreach (var vat in vatBreakdown.OrderBy(v => (int)v.Key))
                {
                    table.Cell().Padding(5).Text($"TVA {(int)vat.Key}% :");
                    table.Cell().Padding(5).AlignRight().Text($"{vat.Value.Amount:N3} TND");
                }

                table.Cell().Background(Colors.Orange.Darken2).Padding(5).Text("TOTAL TTC :").Bold().FontColor(Colors.White);
                table.Cell().Background(Colors.Orange.Darken2).Padding(5).AlignRight().Text($"{po.TotalAmount.Amount:N3} TND").Bold().FontColor(Colors.White);
            });

            // Notes
            if (!string.IsNullOrEmpty(po.Notes))
            {
                column.Item().PaddingTop(20).Column(c =>
                {
                    c.Item().Text("Notes :").Bold();
                    var cleanNotes = CleanTextForPdf(po.Notes);
                    c.Item().Text(cleanNotes);
                });
            }
        });
    }

    private static void ComposePurchaseOrderFooter(IContainer container, PurchaseOrder po)
    {
        container.Column(column =>
        {
            column.Item().BorderTop(1).BorderColor(Colors.Grey.Lighten1).PaddingTop(10);
            column.Item().AlignCenter().Text("Ce document est un bon de commande fournisseur.").FontSize(8).FontColor(Colors.Grey.Darken1);
            column.Item().AlignCenter().Text(x =>
            {
                x.Span("Page ");
                x.CurrentPageNumber();
                x.Span(" / ");
                x.TotalPages();
            });
        });
    }

    public async Task<byte[]> GeneratePurchaseReceiptPdfAsync(PurchaseReceipt receipt, CancellationToken cancellationToken = default)
    {
        IReadOnlyDictionary<Guid, string>? lotLabels = null;
        if (_traceability is not null)
        {
            lotLabels = await _traceability.GetLotLabelsAsync(
                StockDocumentKind.PurchaseReceipt,
                receipt.Lines.Select(l => l.Id).ToList(),
                cancellationToken).ConfigureAwait(false);
        }

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(DefaultTextStyle);

                page.Header().Row(row =>
                {
                    row.RelativeItem().Column(column =>
                    {
                        column.Item().Text("BON DE RÉCEPTION D'ACHAT").FontSize(22).Bold().FontColor(Colors.Blue.Darken2);
                        column.Item().Text($"N° {receipt.Number.Value}").FontSize(14);
                        column.Item().PaddingTop(5).Text($"Date de réception : {receipt.ReceiptDate:dd/MM/yyyy}");
                        if (receipt.Warehouse != null)
                            column.Item().Text($"Entrepôt : {receipt.Warehouse.Name}").FontSize(9).FontColor(Colors.Grey.Darken1);
                    });

                    row.RelativeItem().AlignRight().Column(column =>
                    {
                        column.Item().Text($"Statut : {receipt.Status.ToDisplayString()}").Bold();
                        if (!string.IsNullOrEmpty(receipt.SupplierReference))
                            column.Item().Text($"Réf. fournisseur : {receipt.SupplierReference}").FontSize(9);
                        if (!string.IsNullOrEmpty(receipt.DeliveryNoteNumber))
                            column.Item().Text($"N° BL : {receipt.DeliveryNoteNumber}").FontSize(9);
                        if (!string.IsNullOrEmpty(receipt.TransporterName))
                            column.Item().Text($"Transporteur : {receipt.TransporterName}").FontSize(9);
                    });
                });

                page.Content().PaddingVertical(20).Column(column =>
                {
                    column.Item().Column(c =>
                    {
                        c.Item().Text("FOURNISSEUR").Bold().FontColor(Colors.Grey.Darken1);
                        c.Item().PaddingTop(5).Text(receipt.Supplier?.Name ?? "-").Bold();
                    });

                    column.Item().PaddingTop(20).Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.ConstantColumn(30);
                            columns.RelativeColumn(2);
                            columns.RelativeColumn(3);
                            columns.RelativeColumn(1);
                            columns.RelativeColumn(1);
                            columns.RelativeColumn(1.5f);
                            columns.RelativeColumn(1.5f);
                        });

                        table.Header(header =>
                        {
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4).Text("#").FontColor(Colors.White).FontSize(8);
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4).Text("Article").FontColor(Colors.White).FontSize(8);
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4).Text("Désignation").FontColor(Colors.White).FontSize(8);
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4).AlignRight().Text("Qté reçue").FontColor(Colors.White).FontSize(8);
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4).AlignRight().Text("Remise %").FontColor(Colors.White).FontSize(8);
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4).AlignRight().Text("P.U. HT").FontColor(Colors.White).FontSize(8);
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4).AlignRight().Text("Total HT").FontColor(Colors.White).FontSize(8);
                        });

                        foreach (var line in receipt.Lines.OrderBy(l => l.LineNumber))
                        {
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).Text(line.LineNumber.ToString()).FontSize(8);
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).Text(line.ProductCode).FontSize(8);
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).Text(
                                lotLabels is not null && lotLabels.TryGetValue(line.Id, out var lot) && !string.IsNullOrWhiteSpace(lot)
                                    ? $"{line.ProductName} — {lot}"
                                    : line.ProductName).FontSize(8);
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).AlignRight().Text($"{line.ReceivedQuantity:N3}").FontSize(8);
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).AlignRight().Text(line.DiscountPercent?.ToString("N1") ?? "-").FontSize(8);
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).AlignRight().Text($"{line.UnitPrice.Amount:N3}").FontSize(8);
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).AlignRight().Text($"{line.SubTotal.Amount:N3}").FontSize(8);
                        }
                    });

                    column.Item().PaddingTop(15).AlignRight().Width(220).Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.RelativeColumn();
                            columns.RelativeColumn();
                        });
                        table.Cell().Padding(4).Text("Total HT").FontSize(9);
                        table.Cell().Padding(4).AlignRight().Text($"{receipt.SubTotal.Amount:N3} TND").FontSize(9);
                        table.Cell().Padding(4).Text("TVA").FontSize(9);
                        table.Cell().Padding(4).AlignRight().Text($"{receipt.TotalVat.Amount:N3} TND").FontSize(9);
                        table.Cell().Background(Colors.Blue.Darken2).Padding(5).Text("Total TTC").Bold().FontColor(Colors.White).FontSize(10);
                        table.Cell().Background(Colors.Blue.Darken2).Padding(5).AlignRight().Text($"{receipt.TotalAmount.Amount:N3} TND").Bold().FontColor(Colors.White).FontSize(10);
                    });

                    if (!string.IsNullOrEmpty(receipt.Notes))
                    {
                        column.Item().PaddingTop(20).Column(c =>
                        {
                            c.Item().Text("Observations :").Bold();
                            c.Item().Text(CleanTextForPdf(receipt.Notes!));
                        });
                    }
                });

                page.Footer().Column(column =>
                {
                    column.Item().AlignCenter().Text("Bon de réception d'achat").FontSize(8).FontColor(Colors.Grey.Darken1);
                    column.Item().AlignCenter().Text(x =>
                    {
                        x.Span("Page ");
                        x.CurrentPageNumber();
                        x.Span(" / ");
                        x.TotalPages();
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// Nettoie le texte en supprimant les caractères de contrôle (U-000D, U-000A, etc.)
    /// qui peuvent causer des problèmes lors du rendu PDF.
    /// </summary>
    private static string CleanTextForPdf(string text)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        // Remplacer les caractères de contrôle par des espaces ou les supprimer
        // U-000D = \r (Carriage Return)
        // U-000A = \n (Line Feed)
        // U-0009 = \t (Tab)
        return text
            .Replace("\r\n", " ")  // Retour chariot + saut de ligne → espace
            .Replace("\r", " ")    // Retour chariot seul → espace
            .Replace("\n", " ")    // Saut de ligne seul → espace
            .Replace("\t", " ")    // Tabulation → espace
            .Replace("\0", "")     // Null character → supprimé
            .Trim();
    }

    public Task<byte[]> GenerateStockTransferPdfAsync(StockTransfer stockTransfer, CancellationToken cancellationToken = default)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(DefaultTextStyle);

                page.Header().Row(row =>
                {
                    row.RelativeItem().Column(column =>
                    {
                        column.Item().Text("TRANSFERT DE STOCK").FontSize(24).Bold().FontColor(Colors.Teal.Darken2);
                        column.Item().Text($"N° {stockTransfer.Number.Value}").FontSize(14);
                        column.Item().PaddingTop(5).Text($"Date : {stockTransfer.TransferDate:dd/MM/yyyy}");
                        if (!string.IsNullOrEmpty(stockTransfer.Reference))
                            column.Item().Text($"Réf : {stockTransfer.Reference}").FontSize(9);
                    });

                    row.RelativeItem().AlignRight().Column(column =>
                    {
                        column.Item().Text($"Statut : {stockTransfer.Status.ToDisplayString()}").Bold();
                        if (stockTransfer.CompletedAt.HasValue)
                            column.Item().Text($"Terminé le : {stockTransfer.CompletedAt:dd/MM/yyyy HH:mm}").FontSize(8);
                    });
                });

                page.Content().PaddingVertical(20).Column(column =>
                {
                    column.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("ENTREPÔT SOURCE").Bold().FontColor(Colors.Grey.Darken1);
                            c.Item().PaddingTop(5).Text(stockTransfer.SourceWarehouse?.Name ?? "—").Bold();
                            if (!string.IsNullOrEmpty(stockTransfer.SourceWarehouse?.Address))
                                c.Item().Text(stockTransfer.SourceWarehouse.Address).FontSize(9);
                        });

                        row.ConstantItem(40).AlignMiddle().AlignCenter()
                            .Text("→").FontSize(20).Bold().FontColor(Colors.Teal.Darken2);

                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("ENTREPÔT DESTINATION").Bold().FontColor(Colors.Grey.Darken1);
                            c.Item().PaddingTop(5).Text(stockTransfer.DestinationWarehouse?.Name ?? "—").Bold();
                            if (!string.IsNullOrEmpty(stockTransfer.DestinationWarehouse?.Address))
                                c.Item().Text(stockTransfer.DestinationWarehouse.Address).FontSize(9);
                        });
                    });

                    column.Item().PaddingVertical(15).LineHorizontal(1).LineColor(Colors.Grey.Lighten2);

                    column.Item().Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.ConstantColumn(40);
                            columns.ConstantColumn(80);
                            columns.RelativeColumn(3);
                            columns.ConstantColumn(100);
                            columns.ConstantColumn(100);
                        });

                        table.Header(header =>
                        {
                            var headerStyle = TextStyle.Default.FontSize(9).Bold().FontColor(Colors.White);
                            var headerBg = Colors.Teal.Darken2;

                            header.Cell().Background(headerBg).Padding(5).Text("#").Style(headerStyle);
                            header.Cell().Background(headerBg).Padding(5).Text("Code").Style(headerStyle);
                            header.Cell().Background(headerBg).Padding(5).Text("Produit").Style(headerStyle);
                            header.Cell().Background(headerBg).Padding(5).AlignRight().Text("Qté demandée").Style(headerStyle);
                            header.Cell().Background(headerBg).Padding(5).AlignRight().Text("Qté transférée").Style(headerStyle);
                        });

                        foreach (var line in stockTransfer.Lines)
                        {
                            var bg = line.LineNumber % 2 == 0 ? Colors.Grey.Lighten4 : Colors.White;
                            table.Cell().Background(bg).Padding(5).Text(line.LineNumber.ToString()).FontSize(9);
                            table.Cell().Background(bg).Padding(5).Text(line.ProductCode).FontSize(9);
                            table.Cell().Background(bg).Padding(5).Text(line.ProductName).FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(line.RequestedQuantity.ToString("N3")).FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(line.TransferredQuantity.ToString("N3")).FontSize(9);
                        }
                    });

                    if (!string.IsNullOrEmpty(stockTransfer.Notes))
                    {
                        column.Item().PaddingTop(15).Text("Notes :").Bold().FontSize(9);
                        column.Item().Text(stockTransfer.Notes).FontSize(9);
                    }
                });

                page.Footer().AlignCenter().Text(text =>
                {
                    text.Span($"Transfert {stockTransfer.Number.Value} — Généré le {DateTime.UtcNow:dd/MM/yyyy HH:mm}").FontSize(8).FontColor(Colors.Grey.Medium);
                });
            });
        });

        var bytes = document.GeneratePdf();
        return Task.FromResult(bytes);
    }

    public Task<byte[]> GenerateStockVoucherPdfAsync(StockVoucher voucher, CancellationToken cancellationToken = default)
    {
        var isEntry = voucher.Kind == StockVoucherKind.Entry;
        var title = isEntry ? "BON D'ENTRÉE DE STOCK" : "BON DE SORTIE DE STOCK";
        var accent = isEntry ? Colors.Teal.Darken2 : Colors.Orange.Darken2;

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(DefaultTextStyle);

                page.Header().Row(row =>
                {
                    row.RelativeItem().Column(column =>
                    {
                        column.Item().Text(title).FontSize(22).Bold().FontColor(accent);
                        column.Item().Text($"N° {voucher.Number.Value}").FontSize(14);
                        column.Item().PaddingTop(5).Text($"Date : {voucher.VoucherDate:dd/MM/yyyy}");
                        column.Item().Text($"Motif : {voucher.Kind.ToVoucherReasonDisplay(voucher.Reason)}").FontSize(9);
                        if (!string.IsNullOrEmpty(voucher.ExternalReference))
                            column.Item().Text($"Réf : {voucher.ExternalReference}").FontSize(9);
                    });

                    row.RelativeItem().AlignRight().Column(column =>
                    {
                        column.Item().Text($"Statut : {voucher.Status.ToDisplayString()}").Bold();
                        column.Item().Text($"Dépôt : {voucher.Warehouse?.Name ?? "—"}").FontSize(10);
                        if (voucher.ValidatedAt.HasValue)
                            column.Item().Text($"Validé le : {voucher.ValidatedAt:dd/MM/yyyy HH:mm}").FontSize(8);
                    });
                });

                page.Content().PaddingVertical(20).Column(column =>
                {
                    column.Item().Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.ConstantColumn(30);
                            columns.ConstantColumn(80);
                            columns.RelativeColumn(3);
                            columns.ConstantColumn(50);
                            columns.ConstantColumn(70);
                            columns.ConstantColumn(80);
                            columns.ConstantColumn(80);
                        });

                        table.Header(header =>
                        {
                            var headerStyle = TextStyle.Default.FontSize(9).Bold().FontColor(Colors.White);
                            header.Cell().Background(accent).Padding(5).Text("#").Style(headerStyle);
                            header.Cell().Background(accent).Padding(5).Text("Code").Style(headerStyle);
                            header.Cell().Background(accent).Padding(5).Text("Produit").Style(headerStyle);
                            header.Cell().Background(accent).Padding(5).Text("Unité").Style(headerStyle);
                            header.Cell().Background(accent).Padding(5).AlignRight().Text("Qté").Style(headerStyle);
                            header.Cell().Background(accent).Padding(5).AlignRight().Text("Coût").Style(headerStyle);
                            header.Cell().Background(accent).Padding(5).AlignRight().Text("Valorisation").Style(headerStyle);
                        });

                        foreach (var line in voucher.Lines.OrderBy(l => l.LineNumber))
                        {
                            var bg = line.LineNumber % 2 == 0 ? Colors.Grey.Lighten4 : Colors.White;
                            table.Cell().Background(bg).Padding(5).Text(line.LineNumber.ToString()).FontSize(9);
                            table.Cell().Background(bg).Padding(5).Text(line.ProductCode).FontSize(9);
                            table.Cell().Background(bg).Padding(5).Text(line.ProductName).FontSize(9);
                            table.Cell().Background(bg).Padding(5).Text(line.Unit ?? "—").FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(line.Quantity.ToString("N3")).FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(line.UnitCost.ToString("N3")).FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(line.LineValue.ToString("N3")).FontSize(9);
                        }
                    });

                    column.Item().PaddingTop(10).AlignRight().Text(
                        $"Total qté : {voucher.TotalQuantity:N3}    Valorisation : {voucher.TotalValue:N3} TND")
                        .Bold().FontSize(10);

                    if (!string.IsNullOrEmpty(voucher.Notes))
                    {
                        column.Item().PaddingTop(15).Text("Notes :").Bold().FontSize(9);
                        column.Item().Text(voucher.Notes).FontSize(9);
                    }

                    if (voucher.Status == StockVoucherStatus.Cancelled && !string.IsNullOrEmpty(voucher.CancellationReason))
                    {
                        column.Item().PaddingTop(10).Text($"Annulé : {voucher.CancellationReason}")
                            .FontColor(Colors.Red.Darken2).FontSize(9);
                    }
                });

                page.Footer().AlignCenter().Text(
                    $"{voucher.Kind.ToDisplayString()} {voucher.Number.Value} — Généré le {DateTime.UtcNow:dd/MM/yyyy HH:mm}")
                    .FontSize(8).FontColor(Colors.Grey.Medium);
            });
        });

        var bytes = document.GeneratePdf();
        return Task.FromResult(bytes);
    }
}
