using System.Globalization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services;

public partial class PdfService
{
    public Task<byte[]> GeneratePurchasesJournalReportPdfAsync(
        PurchasesJournalPdfContext context,
        CancellationToken cancellationToken = default)
    {
        if (context.RightToLeft)
            return Task.FromResult(BuildArabicPurchasesJournal(context));

        var landscape = context.ViewMode == SalesJournalViewMode.Detail;
        var periodLines = new List<string>
        {
            $"Du {ShortDate(context.From)} au {ShortDate(context.To)}",
            $"Source : {context.SourceLabel}",
            $"Mode : {context.ViewModeLabel}"
        };
        if (!string.IsNullOrWhiteSpace(context.SupplierName))
            periodLines.Add($"Fournisseur : {context.SupplierName}");

        var header = new AccountingReportHeader(
            context.CompanyName ?? "Société",
            context.MatriculeFiscal,
            context.Title,
            string.Join(" — ", periodLines));

        var pdf = BuildReport(header, landscape, col =>
        {
            if (context.ViewMode == SalesJournalViewMode.Detail)
                ComposePurchasesJournalDetailTable(col, context.DetailRows, context.Totals);
            else
                ComposePurchasesJournalAggregatedTable(col, context.AggregatedRows, context.Totals);
        });

        return Task.FromResult(pdf);
    }

    private static void ComposePurchasesJournalDetailTable(
        ColumnDescriptor col,
        IReadOnlyList<PurchasesJournalDetailRowDto> rows,
        PurchasesJournalTotalsDto totals)
    {
        col.Item().Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(0.9f);
                c.RelativeColumn(1f);
                c.RelativeColumn(0.6f);
                c.RelativeColumn(1.2f);
                c.RelativeColumn(0.8f);
                c.RelativeColumn(1.4f);
                c.RelativeColumn(0.7f);
                c.RelativeColumn(0.8f);
                c.RelativeColumn(0.8f);
                c.RelativeColumn(0.8f);
                c.RelativeColumn(0.8f);
            });

            table.Header(h =>
            {
                HeaderCell(h, "Date");
                HeaderCell(h, "N° pièce");
                HeaderCell(h, "Type");
                HeaderCell(h, "Fournisseur");
                HeaderCell(h, "Code");
                HeaderCell(h, "Produit");
                HeaderCellRight(h, "Qté");
                HeaderCellRight(h, "P.U.");
                HeaderCellRight(h, "HT");
                HeaderCellRight(h, "TVA");
                HeaderCellRight(h, "TTC");
            });

            var alt = false;
            foreach (var r in rows)
            {
                var bg = alt ? Colors.Grey.Lighten4 : Colors.White;
                BodyCell(table, bg, ShortDate(r.EntryDate));
                BodyCell(table, bg, r.DocumentNumber);
                BodyCell(table, bg, r.DocumentKind);
                BodyCell(table, bg, r.SupplierName);
                BodyCell(table, bg, r.ProductCode);
                BodyCell(table, bg, r.ProductName);
                BodyCellRight(table, bg, Amount(r.Quantity));
                BodyCellRight(table, bg, Amount(r.UnitPrice));
                BodyCellRight(table, bg, Amount(r.LineSubTotal));
                BodyCellRight(table, bg, Amount(r.VatAmount));
                BodyCellRight(table, bg, Amount(r.LineTotal));
                alt = !alt;
            }
        });

        col.Item().PaddingTop(8).Element(c => ComposePurchasesJournalTotalsBox(c, totals));
    }

    private static void ComposePurchasesJournalAggregatedTable(
        ColumnDescriptor col,
        IReadOnlyList<PurchasesJournalAggregatedRowDto> rows,
        PurchasesJournalTotalsDto totals)
    {
        col.Item().Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(0.9f);
                c.RelativeColumn(1.3f);
                c.RelativeColumn(0.8f);
                c.RelativeColumn(1.5f);
                c.RelativeColumn(0.7f);
                c.RelativeColumn(0.9f);
                c.RelativeColumn(0.9f);
                c.RelativeColumn(0.9f);
            });

            table.Header(h =>
            {
                HeaderCell(h, "Période");
                HeaderCell(h, "Fournisseur");
                HeaderCell(h, "Code");
                HeaderCell(h, "Produit");
                HeaderCellRight(h, "Qté");
                HeaderCellRight(h, "HT");
                HeaderCellRight(h, "TVA");
                HeaderCellRight(h, "TTC");
            });

            var alt = false;
            foreach (var r in rows)
            {
                var bg = alt ? Colors.Grey.Lighten4 : Colors.White;
                BodyCell(table, bg, r.PeriodKey);
                BodyCell(table, bg, r.SupplierName);
                BodyCell(table, bg, r.ProductCode);
                BodyCell(table, bg, r.ProductName);
                BodyCellRight(table, bg, Amount(r.Quantity));
                BodyCellRight(table, bg, Amount(r.LineSubTotal));
                BodyCellRight(table, bg, Amount(r.VatAmount));
                BodyCellRight(table, bg, Amount(r.LineTotal));
                alt = !alt;
            }
        });

        col.Item().PaddingTop(8).Element(c => ComposePurchasesJournalTotalsBox(c, totals));
    }

    private static void ComposePurchasesJournalTotalsBox(IContainer container, PurchasesJournalTotalsDto totals)
    {
        container.AlignRight().Width(280).Background(Colors.Blue.Darken2).Padding(8).Column(c =>
        {
            TotalRow(c, "Total quantité", Amount(totals.Quantity));
            TotalRow(c, "Total HT", $"{Amount(totals.LineSubTotal)} {totals.Currency}");
            TotalRow(c, "Total TVA", $"{Amount(totals.VatAmount)} {totals.Currency}");
            TotalRow(c, "Total TTC", $"{Amount(totals.LineTotal)} {totals.Currency}");
        });
    }

    /// <summary>
    /// PDF arabe isolé de <see cref="BuildReport"/> : les autres états gardent leur en-tête français.
    /// </summary>
    private static byte[] BuildArabicPurchasesJournal(PurchasesJournalPdfContext context)
    {
        EnsureTreasuryJournalArabicFont();

        var textStyle = TextStyle.Default.FontFamily(TreasuryJournalArabicFontFamily, "DejaVu Sans").FontSize(9);
        var landscape = context.ViewMode == SalesJournalViewMode.Detail;
        var periodLines = new List<string>
        {
            PurchasesJournalLabels.Period(context.From, context.To),
            PurchasesJournalLabels.SourceLine(context.SourceLabel),
            PurchasesJournalLabels.ModeLine(context.ViewModeLabel)
        };
        if (!string.IsNullOrWhiteSpace(context.SupplierName))
            periodLines.Add(PurchasesJournalLabels.SupplierLine(context.SupplierName!));

        var company = string.IsNullOrWhiteSpace(context.CompanyName)
            ? PurchasesJournalLabels.CompanyFallback()
            : context.CompanyName;

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(landscape ? PageSizes.A4.Landscape() : PageSizes.A4);
                page.Margin(24);
                page.DefaultTextStyle(textStyle);
                page.Header().Element(c => ComposeArabicPurchasesHeader(c, context, company, string.Join(" — ", periodLines)));
                page.Content().PaddingVertical(8).Column(col =>
                {
                    if (context.ViewMode == SalesJournalViewMode.Detail)
                        ComposeArabicPurchasesDetailTable(col, context);
                    else
                        ComposeArabicPurchasesAggregatedTable(col, context);
                });
                page.Footer().Element(c => ComposeArabicPurchasesFooter(c));
            });
        }).GeneratePdf();
    }

    private static void ComposeArabicPurchasesHeader(
        IContainer container,
        PurchasesJournalPdfContext context,
        string company,
        string period)
    {
        container.Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().AlignRight().Text(PurchasesJournalLabels.CurrencyCaption())
                    .FontSize(8).Italic().FontColor(Colors.Grey.Darken1);
                row.RelativeItem().AlignRight().Column(c =>
                {
                    c.Item().AlignRight().Text(company).FontSize(14).Bold();
                    if (!string.IsNullOrWhiteSpace(context.MatriculeFiscal))
                    {
                        c.Item().AlignRight()
                            .Text($"{PurchasesJournalLabels.Matricule()} : {context.MatriculeFiscal}")
                            .FontSize(8).FontColor(Colors.Grey.Darken1);
                    }
                });
            });
            col.Item().PaddingTop(6).AlignRight().Text(context.Title).FontSize(13).Bold().FontColor(Colors.Blue.Darken2);
            col.Item().AlignRight().Text(period).FontSize(9).FontColor(Colors.Grey.Darken2);
            col.Item().PaddingTop(4).LineHorizontal(1).LineColor(Colors.Grey.Medium);
        });
    }

    private static void ComposeArabicPurchasesDetailTable(ColumnDescriptor col, PurchasesJournalPdfContext context)
    {
        var widths = new[] { 0.9f, 1f, 0.6f, 1.2f, 0.8f, 1.4f, 0.7f, 0.8f, 0.8f, 0.8f, 0.8f };
        col.Item().Element(c => ComposeArabicPurchasesTable(c, PurchasesJournalLabels.DetailColumns(), widths, 6, context.DetailRows.Select(r => new[]
        {
            ShortDate(r.EntryDate),
            r.DocumentNumber,
            PurchasesJournalLabels.DocumentKind(r.DocumentKind),
            r.SupplierName,
            r.ProductCode,
            r.ProductName,
            Amount(r.Quantity),
            Amount(r.UnitPrice),
            Amount(r.LineSubTotal),
            Amount(r.VatAmount),
            Amount(r.LineTotal)
        })));

        col.Item().PaddingTop(8).Element(c => ComposeArabicPurchasesTotalsBox(c, context.Totals));
    }

    private static void ComposeArabicPurchasesAggregatedTable(ColumnDescriptor col, PurchasesJournalPdfContext context)
    {
        var widths = new[] { 0.9f, 1.3f, 0.8f, 1.5f, 0.7f, 0.9f, 0.9f, 0.9f };
        col.Item().Element(c => ComposeArabicPurchasesTable(c, PurchasesJournalLabels.AggregatedColumns(), widths, 4, context.AggregatedRows.Select(r => new[]
        {
            r.PeriodKey,
            r.SupplierName,
            r.ProductCode,
            r.ProductName,
            Amount(r.Quantity),
            Amount(r.LineSubTotal),
            Amount(r.VatAmount),
            Amount(r.LineTotal)
        })));

        col.Item().PaddingTop(8).Element(c => ComposeArabicPurchasesTotalsBox(c, context.Totals));
    }

    private static void ComposeArabicPurchasesTable(
        IContainer container,
        IReadOnlyList<string> columns,
        float[] widths,
        int firstAmountIndex,
        IEnumerable<string[]> rows)
    {
        var headers = columns.Select((text, index) => (text, amount: index >= firstAmountIndex)).Reverse().ToList();
        var columnWidths = widths.Reverse().ToArray();

        container.Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                foreach (var width in columnWidths)
                    c.RelativeColumn(width);
            });

            table.Header(h =>
            {
                foreach (var header in headers)
                {
                    var cell = h.Cell().Background(Colors.Blue.Darken2).Padding(4);
                    var aligned = header.amount ? cell.AlignLeft() : cell.AlignRight();
                    aligned.Text(header.text).FontSize(8).Bold().FontColor(Colors.White);
                }
            });

            var alt = false;
            foreach (var row in rows)
            {
                var bg = alt ? Colors.Grey.Lighten4 : Colors.White;
                var cells = row.Select((text, index) => (text, amount: index >= firstAmountIndex)).Reverse();
                foreach (var cell in cells)
                {
                    var box = table.Cell().Background(bg).Padding(3);
                    var aligned = cell.amount ? box.AlignLeft() : box.AlignRight();
                    aligned.Text(cell.text ?? string.Empty).FontSize(8);
                }

                alt = !alt;
            }
        });
    }

    private static void ComposeArabicPurchasesTotalsBox(IContainer container, PurchasesJournalTotalsDto totals)
    {
        container.AlignLeft().Width(280).Background(Colors.Blue.Darken2).Padding(8).Column(c =>
        {
            ArabicTotalRow(c, PurchasesJournalLabels.TotalQuantity(), Amount(totals.Quantity));
            ArabicTotalRow(c, PurchasesJournalLabels.TotalHt(), $"{Amount(totals.LineSubTotal)} {totals.Currency}");
            ArabicTotalRow(c, PurchasesJournalLabels.TotalVat(), $"{Amount(totals.VatAmount)} {totals.Currency}");
            ArabicTotalRow(c, PurchasesJournalLabels.TotalTtc(), $"{Amount(totals.LineTotal)} {totals.Currency}");
        });
    }

    private static void ArabicTotalRow(ColumnDescriptor col, string label, string value)
    {
        col.Item().Row(r =>
        {
            r.ConstantItem(140).AlignLeft().Text(value).FontSize(8).Bold().FontColor(Colors.White);
            r.RelativeItem().AlignRight().Text(label).FontSize(8).FontColor(Colors.White);
        });
    }

    private static void ComposeArabicPurchasesFooter(IContainer container)
    {
        container.Column(col =>
        {
            col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
            col.Item().PaddingTop(2).Row(row =>
            {
                row.RelativeItem().AlignRight().Text(t =>
                {
                    t.Span(PurchasesJournalLabels.PrintedOn() + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.Span(DateTime.Now.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture))
                        .FontSize(8).FontColor(Colors.Grey.Darken1);
                });
                row.ConstantItem(120).AlignLeft().Text(t =>
                {
                    t.Span(PurchasesJournalLabels.Page() + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.CurrentPageNumber().FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.Span(" / ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.TotalPages().FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });
        });
    }
}
