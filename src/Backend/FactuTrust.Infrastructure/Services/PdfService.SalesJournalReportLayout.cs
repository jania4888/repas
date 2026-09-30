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
}
