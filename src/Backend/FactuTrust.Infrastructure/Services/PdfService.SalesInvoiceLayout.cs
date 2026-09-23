using System.Globalization;
using System.Text;
using FactuTrust.Application.Common.Models;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Humanizer;
using QRCoder;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services;

public partial class PdfService
{
    private static readonly Color SalesInvoiceBlue = Color.FromHex("#1A3D82");
    private static readonly Color SalesInvoiceTeal = Color.FromHex("#28C4AC");

    private async Task<byte[]?> TryDownloadLogoAsync(string? logoUrl, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(logoUrl))
            return null;

        if (!Uri.TryCreate(logoUrl.Trim(), UriKind.Absolute, out var uri))
            return null;

        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return null;

        try
        {
            var client = _httpClientFactory.CreateClient("InvoicePdfLogo");
            using var response = await client.GetAsync(uri, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                return null;

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
            return bytes.Length > 0 ? bytes : null;
        }
        catch
        {
            return null;
        }
    }

    private static byte[]? BuildElectronicInvoiceQrPng(Invoice invoice)
    {
        if (string.IsNullOrWhiteSpace(invoice.ElectronicInvoiceTtn))
            return null;

        using var gen = new QRCodeGenerator();
        var data = gen.CreateQrCode(invoice.ElectronicInvoiceTtn.Trim(), QRCodeGenerator.ECCLevel.M);
        var png = new PngByteQRCode(data);
        return png.GetGraphic(4);
    }

    private void ComposeSalesInvoiceHeader(IContainer container, InvoicePdfContext ctx, byte[]? logoBytes)
    {
        var issuer = ctx.Issuer;
        var invoice = ctx.Invoice;

        container.BorderBottom(1).BorderColor(Colors.Grey.Lighten2).PaddingBottom(8).Row(row =>
        {
            row.RelativeItem().Row(leftRow =>
            {
                if (logoBytes is { Length: > 0 })
                {
                    leftRow.ConstantItem(56).Height(56).Image(logoBytes).FitArea();
                    leftRow.ConstantItem(8);
                }

                leftRow.RelativeItem().Column(col =>
                {
                    col.Item().Text(issuer?.Name ?? "Émetteur").FontSize(14).Bold();
                    if (!string.IsNullOrWhiteSpace(issuer?.TradeName))
                        col.Item().Text(issuer!.TradeName!).FontSize(9).FontColor(Colors.Grey.Darken1);

                    AppendAddressLines(col, issuer?.Address.ToMultiLine());
                    AppendSellerContactLines(col, issuer, invoice);
                });
            });

            row.ConstantItem(16);
            row.RelativeItem().AlignRight().AlignTop()
                .Text(invoice.IsCreditNote ? "FACTURE D'AVOIR" : "FACTURE")
                .FontSize(22).Bold()
                .FontColor(invoice.IsCreditNote ? Colors.Red.Darken2 : SalesInvoiceBlue);
        });
    }

    private static void AppendAddressLines(ColumnDescriptor col, string? multiLine)
    {
        if (string.IsNullOrWhiteSpace(multiLine))
            return;

        foreach (var line in multiLine.Split(new[] { Environment.NewLine, "\n", "\r\n" }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (!string.IsNullOrWhiteSpace(line))
                col.Item().Text(line.Trim()).FontSize(8).FontColor(Colors.Grey.Darken2);
        }
    }

    private static void AppendSellerContactLines(ColumnDescriptor col, Company? issuer, Invoice invoice)
    {
        var parts = new List<string>();
        if (issuer?.Phone != null)
            parts.Add(issuer.Phone.Value);
        if (issuer?.Email != null)
            parts.Add(issuer.Email.Value);

        if (parts.Count > 0)
            col.Item().Text(string.Join(" · ", parts)).FontSize(8).FontColor(Colors.Grey.Darken2);

        var mf = issuer?.Nif.Value;
        var rc = issuer?.CommerceRegistry;
        if (!string.IsNullOrEmpty(mf) || !string.IsNullOrEmpty(rc))
        {
            var taxBits = new List<string>();
            if (!string.IsNullOrEmpty(mf))
                taxBits.Add($"MF: {mf}");
            if (!string.IsNullOrEmpty(rc))
                taxBits.Add($"RC: {rc}");
            col.Item().Text(string.Join(" | ", taxBits)).FontSize(8);
        }

        var rib = issuer?.Rib ?? invoice.Rib;
        var bank = issuer?.BankName ?? invoice.BankName;
        if (!string.IsNullOrEmpty(rib))
        {
            var ribLine = string.IsNullOrEmpty(bank) ? $"RIB: {rib}" : $"RIB: {bank} {rib}";
            col.Item().Text(ribLine).FontSize(8).FontColor(Colors.Grey.Darken2);
        }
    }

    private void ComposeSalesInvoiceContent(IContainer container, InvoicePdfContext ctx, byte[]? qrBytes)
    {
        var invoice = ctx.Invoice;

        container.PaddingVertical(12).Column(column =>
        {
            column.Item().Row(row =>
            {
                row.RelativeItem().Column(left =>
                {
                    left.Item().Text("Facturé à :").FontSize(9).Bold().FontColor(Colors.Grey.Darken1);
                    left.Item().PaddingTop(4).Text(invoice.Client.Name).Bold();
                    if (invoice.Client.NIF != null)
                        left.Item().Text($"N° Fisc. : {invoice.Client.NIF.Value}").FontSize(9);

                    var addressLines = invoice.Client.Address.ToMultiLine()
                        .Split(new[] { Environment.NewLine, "\n", "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var addressLine in addressLines)
                    {
                        if (!string.IsNullOrWhiteSpace(addressLine))
                            left.Item().Text(addressLine.Trim()).FontSize(9);
                    }

                    if (invoice.Client.Email != null)
                        left.Item().Text(invoice.Client.Email.Value).FontSize(9);
                });

                row.RelativeItem().AlignRight().Column(right =>
                {
                    var docKind = invoice.IsCreditNote ? "AVOIR" : "FACTURE";
                    right.Item().Text($"{docKind} n° : {invoice.Number.Value}").Bold().FontSize(10);
                    right.Item().PaddingTop(4).Text($"Date {docKind.ToLowerInvariant()} : {invoice.IssueDate:dd/MM/yyyy}").FontSize(10);
                    if (invoice.DueDate.HasValue)
                        right.Item().Text($"Échéance : {invoice.DueDate:dd/MM/yyyy}").FontSize(9).FontColor(Colors.Grey.Darken1);
                    right.Item().Text($"Statut : {invoice.Status.ToDisplayString()}").FontSize(8).FontColor(Colors.Grey.Darken1);
                    if (invoice.Warehouse != null)
                        right.Item().Text($"Entrepôt : {invoice.Warehouse.Name}").FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });

            if (qrBytes is { Length: > 0 } &&
                !string.IsNullOrWhiteSpace(invoice.ElectronicInvoiceTtn))
            {
                column.Item().PaddingTop(12).Row(qrRow =>
                {
                    qrRow.ConstantItem(88).Height(88).Image(qrBytes).FitArea();
                    qrRow.ConstantItem(12);
                    qrRow.RelativeItem().Column(qc =>
                    {
                        qc.Item().Text("E-Facture").Bold().FontSize(10).FontColor(SalesInvoiceBlue);
                        qc.Item().Text($"Réf TTN : {invoice.ElectronicInvoiceTtn}").FontSize(9);
                        if (invoice.ElectronicInvoiceSentAt.HasValue)
                            qc.Item().Text($"Envoyé le : {invoice.ElectronicInvoiceSentAt.Value:dd/MM/yyyy}").FontSize(9);
                    });
                });
            }

            column.Item().PaddingTop(14).Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.ConstantColumn(22);
                    columns.ConstantColumn(48);
                    columns.RelativeColumn(2.2f);
                    columns.ConstantColumn(36);
                    columns.ConstantColumn(36);
                    columns.ConstantColumn(44);
                    columns.ConstantColumn(44);
                    columns.ConstantColumn(36);
                    columns.ConstantColumn(52);
                });

                table.Header(header =>
                {
                    void H(IContainer c, string t) =>
                        c.Background(SalesInvoiceBlue).Padding(4).Text(t).FontColor(Colors.White).Bold().FontSize(8);

                    header.Cell().Element(c => H(c, "N°"));
                    header.Cell().Element(c => H(c, "RÉF."));
                    header.Cell().Element(c => H(c, "DESCRIPTION"));
                    header.Cell().Element(c => H(c, "QTÉ"));
                    header.Cell().Element(c => H(c, "UNITÉ"));
                    header.Cell().Element(c => H(c, "PRIX U."));
                    header.Cell().Element(c => H(c, "TAXES"));
                    header.Cell().Element(c => H(c, "REMISE"));
                    header.Cell().Element(c => H(c, "TOTAL"));
                });

                foreach (var line in invoice.Lines.OrderBy(l => l.LineNumber))
                {
                    var bg = line.LineNumber % 2 == 0 ? Colors.Grey.Lighten4 : Colors.White;
                    var refText = string.Equals(line.ProductCode, "CUSTOM", StringComparison.OrdinalIgnoreCase)
                        ? "—"
                        : line.ProductCode;

                    table.Cell().Background(bg).Padding(4).AlignMiddle().Text(line.LineNumber.ToString()).FontSize(8);
                    table.Cell().Background(bg).Padding(4).AlignMiddle().Text(refText).FontSize(7);
                    table.Cell().Background(bg).Padding(4).Column(c =>
                    {
                        c.Item().Text(line.ProductName).Bold().FontSize(8);
                        if (!string.IsNullOrEmpty(line.ProductDescription))
                            c.Item().Text(CleanTextForPdf(line.ProductDescription)).FontSize(7).FontColor(Colors.Grey.Darken1);
                        if (ctx.LotLabelsByLineId is not null
                            && ctx.LotLabelsByLineId.TryGetValue(line.Id, out var lotLabel)
                            && !string.IsNullOrWhiteSpace(lotLabel))
                            c.Item().Text(lotLabel).FontSize(7).FontColor(Colors.Grey.Darken2);
                    });
                    table.Cell().Background(bg).Padding(4).AlignRight().AlignMiddle()
                        .Text($"{line.Quantity:N2}").FontSize(8);
                    table.Cell().Background(bg).Padding(4).AlignMiddle().Text(line.Unit ?? "—").FontSize(7);
                    table.Cell().Background(bg).Padding(4).AlignRight().AlignMiddle()
                        .Text($"{line.UnitPrice.Amount:N3}").FontSize(8);
                    table.Cell().Background(bg).Padding(4).AlignRight().AlignMiddle()
                        .Text(line.VatRate == VatRate.Exempt ? "Exo." : $"TVA {(int)line.VatRate}%").FontSize(7);
                    table.Cell().Background(bg).Padding(4).AlignRight().AlignMiddle()
                        .Text(line.DiscountPercent is > 0 ? $"{line.DiscountPercent:N1}%" : "—").FontSize(7);
                    table.Cell().Background(bg).Padding(4).AlignRight().AlignMiddle()
                        .Text($"{line.Total.Amount:N3}").FontSize(8);
                }
            });

            var vatRows = invoice.Lines
                .GroupBy(l => l.VatRate)
                .OrderBy(g => (int)g.Key)
                .Select(g => (
                    Label: g.Key == VatRate.Exempt ? "TVA exonérée" : $"TVA {(int)g.Key}%",
                    Base: g.Sum(x => x.SubTotal.Amount + x.FodecAmount.Amount),
                    Tax: g.Sum(x => x.VatAmount.Amount)))
                .ToList();

            column.Item().PaddingTop(12).Row(totalsRow =>
            {
                totalsRow.RelativeItem().Table(taxTable =>
                {
                    taxTable.ColumnsDefinition(c =>
                    {
                        c.RelativeColumn(1.2f);
                        c.RelativeColumn(1);
                        c.RelativeColumn(1);
                    });

                    taxTable.Header(h =>
                    {
                        void Th(IContainer c, string t) =>
                            c.Background(SalesInvoiceBlue).Padding(4).Text(t).FontColor(Colors.White).Bold().FontSize(8);
                        h.Cell().Element(c => Th(c, "Taxe"));
                        h.Cell().Element(c => Th(c, "Base imposable"));
                        h.Cell().Element(c => Th(c, "Montant"));
                    });

                    foreach (var vr in vatRows)
                    {
                        taxTable.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).Text(vr.Label).FontSize(8);
                        taxTable.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).AlignRight()
                            .Text($"{vr.Base:N3}").FontSize(8);
                        taxTable.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).AlignRight()
                            .Text($"{vr.Tax:N3}").FontSize(8);
                    }
                });

                totalsRow.ConstantItem(16);

                totalsRow.RelativeItem().AlignRight().Width(220).Column(sumCol =>
                {
                    var htLabel = invoice.IsCreditNote ? "Total HT à rembourser :" : "Total HT :";
                    sumCol.Item().Row(r =>
                    {
                        r.RelativeItem().Text(htLabel).FontSize(9);
                        r.ConstantItem(100).AlignRight()
                            .Text($"{invoice.SubTotal.Amount:+0.000;-0.000;0.000} TND").FontSize(9);
                    });
                    foreach (var vr in vatRows.Where(v => v.Tax > 0))
                    {
                        var sign = invoice.IsCreditNote ? -1m : 1m;
                        sumCol.Item().PaddingTop(2).Row(r =>
                        {
                            r.RelativeItem().Text($"{vr.Label} :").FontSize(9);
                            r.ConstantItem(100).AlignRight()
                                .Text($"{(sign * vr.Tax):+0.000;-0.000;0.000} TND").FontSize(9);
                        });
                    }

                    var fodecAmt = invoice.FodecAmount.Amount;
                    if (Math.Abs(fodecAmt) > 0.0005m)
                    {
                        sumCol.Item().PaddingTop(2).Row(r =>
                        {
                            r.RelativeItem().Text("FODEC :").FontSize(9);
                            r.ConstantItem(100).AlignRight()
                                .Text($"{fodecAmt:+0.000;-0.000;0.000} TND").FontSize(9);
                        });
                    }

                    var stampAmt = invoice.FiscalStampAmount.Amount;
                    if (Math.Abs(stampAmt) > 0.0005m)
                    {
                        sumCol.Item().PaddingTop(2).Row(r =>
                        {
                            r.RelativeItem().Text("Timbre fiscal :").FontSize(9);
                            r.ConstantItem(100).AlignRight()
                                .Text($"{stampAmt:+0.000;-0.000;0.000} TND").FontSize(9);
                        });
                    }
                });
            });

            var grandBg = invoice.IsCreditNote ? Colors.Red.Darken2 : SalesInvoiceBlue;
            var grandLabel = invoice.IsCreditNote ? "TOTAL TTC À REMBOURSER :" : "TOTAL TTC :";
            column.Item().PaddingTop(8).Background(grandBg).Padding(10).Row(r =>
            {
                r.RelativeItem().Text(grandLabel).Bold().FontColor(Colors.White).FontSize(11);
                r.RelativeItem().AlignRight()
                    .Text($"{invoice.TotalAmount.Amount:+0.000;-0.000;0.000} TND")
                    .Bold().FontColor(Colors.White).FontSize(11);
            });

            // FormatAmountInFrench operates on a positive magnitude (the words are read aloud);
            // the sign is conveyed by the surrounding sentence ("À REMBOURSER" vs "ARRÊTÉ LA PRÉSENTE FACTURE").
            var amountWords = FormatAmountInFrench(Math.Abs(invoice.TotalAmount.Amount));
            column.Item().PaddingTop(10).Text(text =>
            {
                text.DefaultTextStyle(x => x.FontSize(9).Italic());
                text.Span(invoice.IsCreditNote
                    ? "À REMBOURSER LA SOMME DE "
                    : "ARRÊTÉ LA PRÉSENTE FACTURE À LA SOMME DE ");
                text.Span(amountWords).Bold();
                text.Span(".");
            });

            if (!string.IsNullOrEmpty(ctx.SourceQuoteNumber))
            {
                column.Item().PaddingTop(8).Text($"Note : Basé sur devis : {ctx.SourceQuoteNumber}").FontSize(9);
            }

            if (!string.IsNullOrEmpty(invoice.Notes))
            {
                column.Item().PaddingTop(8).Column(c =>
                {
                    c.Item().Text("Notes :").Bold().FontSize(9);
                    c.Item().Text(CleanTextForPdf(invoice.Notes!)).FontSize(9);
                });
            }

            if (!string.IsNullOrEmpty(invoice.PaymentTerms))
            {
                column.Item().PaddingTop(6).Column(c =>
                {
                    c.Item().Text("Conditions de paiement :").Bold().FontSize(9);
                    c.Item().Text(CleanTextForPdf(invoice.PaymentTerms!)).FontSize(9);
                });
            }

            column.Item().PaddingTop(12).Text("Merci de votre confiance.").FontSize(9).FontColor(Colors.Grey.Darken1);
        });
    }

    private static string FormatAmountInFrench(decimal amount)
    {
        // Defensive: words are read aloud; sign belongs to the surrounding sentence.
        amount = Math.Abs(amount);
        var culture = new CultureInfo("fr-FR");
        var dinars = (long)Math.Floor(amount);
        var milli = (int)Math.Round((amount - dinars) * 1000m, MidpointRounding.AwayFromZero);
        if (milli >= 1000)
        {
            dinars++;
            milli = 0;
        }

        var sb = new StringBuilder();
        sb.Append(dinars.ToWords(culture));
        sb.Append(dinars == 1 ? " dinar" : " dinars");
        if (milli > 0)
        {
            sb.Append(" et ");
            sb.Append(milli.ToWords(culture));
            sb.Append(milli == 1 ? " millime" : " millimes");
        }

        return sb.ToString();
    }

    private void ComposeSalesInvoiceFooter(IContainer container, InvoicePdfContext ctx, byte[]? logoBytes)
    {
        var invoice = ctx.Invoice;
        var issuer = ctx.Issuer;

        container.Column(column =>
        {
            column.Item().BorderTop(1).BorderColor(SalesInvoiceTeal).PaddingTop(6);

            if (!string.IsNullOrEmpty(invoice.SignatureHash))
            {
                column.Item().Text(
                        $"Signature électronique : {invoice.SignatureHash[..Math.Min(32, invoice.SignatureHash.Length)]}...")
                    .FontSize(7).FontColor(Colors.Grey.Darken1);
            }

            column.Item().PaddingTop(4).Background(Colors.Grey.Lighten4).Padding(6).Row(row =>
            {
                if (logoBytes is { Length: > 0 })
                {
                    row.ConstantItem(24).Height(24).Image(logoBytes).FitArea();
                    row.ConstantItem(8);
                }

                row.RelativeItem().Column(fc =>
                {
                    fc.Item().Text(issuer?.Name ?? string.Empty).FontSize(8).Bold();
                    var foot = FormatFooterOneLiner(issuer, invoice);
                    if (!string.IsNullOrEmpty(foot))
                        fc.Item().Text(foot).FontSize(7).FontColor(Colors.Grey.Darken2);
                });

                row.ConstantItem(120).AlignRight().AlignMiddle().Text(x =>
                {
                    x.DefaultTextStyle(DefaultTextStyle.FontSize(8));
                    x.Span("Page ");
                    x.CurrentPageNumber();
                    x.Span(" / ");
                    x.TotalPages();
                });
            });
        });
    }

    private static string FormatFooterOneLiner(Company? issuer, Invoice invoice)
    {
        var parts = new List<string>();
        if (issuer?.Phone != null)
            parts.Add(issuer.Phone.Value);
        if (issuer?.Email != null)
            parts.Add(issuer.Email.Value);
        if (parts.Count == 0 && !string.IsNullOrEmpty(invoice.Rib))
            parts.Add($"RIB {invoice.Rib}");
        return string.Join(" · ", parts);
    }
}
