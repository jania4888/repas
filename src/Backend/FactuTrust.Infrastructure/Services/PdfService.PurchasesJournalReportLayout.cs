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
}
