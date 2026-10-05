using System.Globalization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services;

public partial class PdfService
{
    public Task<byte[]> GenerateSalesJournalReportPdfAsync(
        SalesJournalPdfContext context,
        CancellationToken cancellationToken = default)
    {
        if (context.RightToLeft)
            return Task.FromResult(BuildArabicSalesJournal(context));

        var landscape = context.ViewMode == SalesJournalViewMode.Detail;
        var periodLines = new List<string>
        {
            $"Du {ShortDate(context.From)} au {ShortDate(context.To)}",
            $"Mode : {context.ViewModeLabel}"
        };
        if (!string.IsNullOrWhiteSpace(context.ClientName))
            periodLines.Add($"Client : {context.ClientName}");

        var header = new AccountingReportHeader(
            context.CompanyName ?? "Société",
            context.MatriculeFiscal,
            context.Title,
            string.Join(" — ", periodLines));

        var pdf = BuildReport(header, landscape, col =>
        {
            if (context.ViewMode == SalesJournalViewMode.Detail)
                ComposeSalesJournalDetailTable(col, context.DetailRows, context.Totals);
            else
                ComposeSalesJournalAggregatedTable(col, context.AggregatedRows, context.Totals);
        });

        return Task.FromResult(pdf);
    }

    private static void ComposeSalesJournalDetailTable(
        ColumnDescriptor col,
        IReadOnlyList<SalesJournalDetailRowDto> rows,
        SalesJournalTotalsDto totals)
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
                HeaderCell(h, "N° facture");
                HeaderCell(h, "Type");
                HeaderCell(h, "Client");
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
                BodyCell(table, bg, ShortDate(r.IssueDate));
                BodyCell(table, bg, r.InvoiceNumber);
                BodyCell(table, bg, r.DocumentType);
                BodyCell(table, bg, r.ClientName);
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

        col.Item().PaddingTop(8).Element(c => ComposeSalesJournalTotalsBox(c, totals));
    }

    private static void ComposeSalesJournalAggregatedTable(
        ColumnDescriptor col,
        IReadOnlyList<SalesJournalAggregatedRowDto> rows,
        SalesJournalTotalsDto totals)
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
                HeaderCell(h, "Client");
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
                BodyCell(table, bg, r.ClientName);
                BodyCell(table, bg, r.ProductCode);
                BodyCell(table, bg, r.ProductName);
                BodyCellRight(table, bg, Amount(r.Quantity));
                BodyCellRight(table, bg, Amount(r.LineSubTotal));
                BodyCellRight(table, bg, Amount(r.VatAmount));
                BodyCellRight(table, bg, Amount(r.LineTotal));
                alt = !alt;
            }
        });

        col.Item().PaddingTop(8).Element(c => ComposeSalesJournalTotalsBox(c, totals));
    }

    private static void ComposeSalesJournalTotalsBox(IContainer container, SalesJournalTotalsDto totals)
    {
        container.AlignRight().Width(280).Background(Colors.Blue.Darken2).Padding(8).Column(c =>
        {
            TotalRow(c, "Total quantité", Amount(totals.Quantity));
            TotalRow(c, "Total HT", $"{Amount(totals.LineSubTotal)} {totals.Currency}");
            TotalRow(c, "Total TVA", $"{Amount(totals.VatAmount)} {totals.Currency}");
            TotalRow(c, "Total TTC", $"{Amount(totals.LineTotal)} {totals.Currency}");
        });
    }

    private static void TotalRow(ColumnDescriptor col, string label, string value)
    {
        col.Item().Row(r =>
        {
            r.RelativeItem().Text(label).FontSize(8).FontColor(Colors.White);
            r.ConstantItem(120).AlignRight().Text(value).FontSize(8).Bold().FontColor(Colors.White);
        });
    }

    private static void HeaderCell(TableCellDescriptor h, string text) =>
        h.Cell().Background(Colors.Blue.Darken2).Padding(4)
            .Text(text).FontSize(8).Bold().FontColor(Colors.White);

    private static void HeaderCellRight(TableCellDescriptor h, string text) =>
        h.Cell().Background(Colors.Blue.Darken2).Padding(4).AlignRight()
            .Text(text).FontSize(8).Bold().FontColor(Colors.White);

    private static void BodyCell(TableDescriptor table, string bg, string text) =>
        table.Cell().Background(bg).Padding(3).Text(text).FontSize(8);

    private static void BodyCellRight(TableDescriptor table, string bg, string text) =>
        table.Cell().Background(bg).Padding(3).AlignRight().Text(text).FontSize(8);

    /// <summary>
    /// PDF arabe isolé de <see cref="BuildReport"/> : les autres états gardent leur en-tête français.
    /// </summary>
    private static byte[] BuildArabicSalesJournal(SalesJournalPdfContext context)
    {
        EnsureTreasuryJournalArabicFont();

        var textStyle = TextStyle.Default.FontFamily(TreasuryJournalArabicFontFamily, "DejaVu Sans").FontSize(9);
        var landscape = context.ViewMode == SalesJournalViewMode.Detail;
        var periodLines = new List<string>
        {
            SalesJournalLabels.Period(context.From, context.To),
            SalesJournalLabels.ModeLine(context.ViewModeLabel)
        };
        if (!string.IsNullOrWhiteSpace(context.ClientName))
            periodLines.Add(SalesJournalLabels.ClientLine(context.ClientName!));

        var company = string.IsNullOrWhiteSpace(context.CompanyName)
            ? SalesJournalLabels.CompanyFallback()
            : context.CompanyName;

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(landscape ? PageSizes.A4.Landscape() : PageSizes.A4);
                page.Margin(24);
                page.DefaultTextStyle(textStyle);
                page.Header().Element(c => ComposeArabicSalesHeader(c, context, company, string.Join(" — ", periodLines)));
                page.Content().PaddingVertical(8).Column(col =>
                {
                    if (context.ViewMode == SalesJournalViewMode.Detail)
                        ComposeArabicSalesDetailTable(col, context);
                    else
                        ComposeArabicSalesAggregatedTable(col, context);
                });
                page.Footer().Element(c => ComposeArabicSalesFooter(c));
            });
        }).GeneratePdf();
    }

    private static void ComposeArabicSalesHeader(
        IContainer container,
        SalesJournalPdfContext context,
        string company,
        string period)
    {
        container.Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().AlignRight().Text(SalesJournalLabels.CurrencyCaption())
                    .FontSize(8).Italic().FontColor(Colors.Grey.Darken1);
                row.RelativeItem().AlignRight().Column(c =>
                {
                    c.Item().AlignRight().Text(company).FontSize(14).Bold();
                    if (!string.IsNullOrWhiteSpace(context.MatriculeFiscal))
                    {
                        c.Item().AlignRight()
                            .Text($"{SalesJournalLabels.Matricule()} : {context.MatriculeFiscal}")
                            .FontSize(8).FontColor(Colors.Grey.Darken1);
                    }
                });
            });
            col.Item().PaddingTop(6).AlignRight().Text(context.Title).FontSize(13).Bold().FontColor(Colors.Blue.Darken2);
            col.Item().AlignRight().Text(period).FontSize(9).FontColor(Colors.Grey.Darken2);
            col.Item().PaddingTop(4).LineHorizontal(1).LineColor(Colors.Grey.Medium);
        });
    }

    private static void ComposeArabicSalesDetailTable(ColumnDescriptor col, SalesJournalPdfContext context)
    {
        var widths = new[] { 0.9f, 1f, 0.6f, 1.2f, 0.8f, 1.4f, 0.7f, 0.9f, 1.1f, 0.7f, 1.1f };
        col.Item().Element(c => ComposeArabicSalesTable(c, SalesJournalLabels.DetailColumns(), widths, 6, context.DetailRows.Select(r => new[]
        {
            ShortDate(r.IssueDate),
            r.InvoiceNumber,
            r.DocumentType,
            r.ClientName,
            r.ProductCode,
            r.ProductName,
            Amount(r.Quantity),
            Amount(r.UnitPrice),
            Amount(r.LineSubTotal),
            Amount(r.VatAmount),
            Amount(r.LineTotal)
        })));

        col.Item().PaddingTop(8).Element(c => ComposeArabicSalesTotalsBox(c, context.Totals));
    }

    private static void ComposeArabicSalesAggregatedTable(ColumnDescriptor col, SalesJournalPdfContext context)
    {
        var widths = new[] { 0.9f, 1.3f, 0.8f, 1.5f, 0.7f, 1.1f, 0.7f, 1.1f };
        col.Item().Element(c => ComposeArabicSalesTable(c, SalesJournalLabels.AggregatedColumns(), widths, 4, context.AggregatedRows.Select(r => new[]
        {
            r.PeriodKey,
            r.ClientName,
            r.ProductCode,
            r.ProductName,
            Amount(r.Quantity),
            Amount(r.LineSubTotal),
            Amount(r.VatAmount),
            Amount(r.LineTotal)
        })));

        col.Item().PaddingTop(8).Element(c => ComposeArabicSalesTotalsBox(c, context.Totals));
    }

    private static void ComposeArabicSalesTable(
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

    private static void ComposeArabicSalesTotalsBox(IContainer container, SalesJournalTotalsDto totals)
    {
        container.AlignLeft().Width(280).Background(Colors.Blue.Darken2).Padding(8).Column(c =>
        {
            ArabicTotalRow(c, SalesJournalLabels.TotalQuantity(), Amount(totals.Quantity));
            ArabicTotalRow(c, SalesJournalLabels.TotalHt(), $"{Amount(totals.LineSubTotal)} {totals.Currency}");
            ArabicTotalRow(c, SalesJournalLabels.TotalVat(), $"{Amount(totals.VatAmount)} {totals.Currency}");
            ArabicTotalRow(c, SalesJournalLabels.TotalTtc(), $"{Amount(totals.LineTotal)} {totals.Currency}");
        });
    }

    private static void ComposeArabicSalesFooter(IContainer container)
    {
        container.Column(col =>
        {
            col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
            col.Item().PaddingTop(2).Row(row =>
            {
                row.RelativeItem().AlignRight().Text(t =>
                {
                    t.Span(SalesJournalLabels.PrintedOn() + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.Span(DateTime.Now.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture))
                        .FontSize(8).FontColor(Colors.Grey.Darken1);
                });
                row.ConstantItem(120).AlignLeft().Text(t =>
                {
                    t.Span(SalesJournalLabels.Page() + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.CurrentPageNumber().FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.Span(" / ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.TotalPages().FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });
        });
    }
}
