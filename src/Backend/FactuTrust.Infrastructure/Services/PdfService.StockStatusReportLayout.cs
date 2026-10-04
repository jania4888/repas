using System.Globalization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services;

public partial class PdfService
{
    public Task<byte[]> GenerateStockStatusReportPdfAsync(
        StockStatusPdfContext context,
        CancellationToken cancellationToken = default)
    {
        if (context.RightToLeft)
            return Task.FromResult(BuildArabicStockStatusPdf(context));

        var periodLines = new List<string>
        {
            $"Au {context.GeneratedAtLocal:dd/MM/yyyy HH:mm}",
            context.GroupingModeLabel
        };
        if (!string.IsNullOrWhiteSpace(context.FiltersSummary))
            periodLines.Add(context.FiltersSummary);

        var header = new AccountingReportHeader(
            context.CompanyName ?? "Société",
            context.MatriculeFiscal,
            context.Title,
            string.Join(" — ", periodLines));

        var pdf = BuildReport(header, landscape: false, col =>
        {
            ComposeStockStatusReportBody(col, context);
        });

        return Task.FromResult(pdf);
    }

    private static void ComposeStockStatusReportBody(ColumnDescriptor col, StockStatusPdfContext context)
    {
        if (context.GroupingMode == StockStatusGroupingMode.CategoryThenWarehouse)
            ComposeStockStatusByCategoryThenWarehouse(col, context);
        else
            ComposeStockStatusByWarehouseThenCategory(col, context);

        col.Item().PaddingTop(12).Row(row =>
        {
            row.RelativeItem().Text("Total général").Bold();
            row.ConstantItem(80).AlignRight().Text(Amount(context.GrandTotalQuantity)).Bold();
            row.ConstantItem(100).AlignRight().Text(
                $"{Amount(context.GrandTotalValue)} {context.Currency}").Bold();
        });

        col.Item().PaddingTop(8).Text(
                "Valorisation au coût moyen pondéré affiché (CMUP / couche FIFO-LIFO).")
            .FontSize(7)
            .Italic()
            .FontColor(Colors.Grey.Darken1);
    }

    private static void ComposeStockStatusByWarehouseThenCategory(ColumnDescriptor col, StockStatusPdfContext context)
    {
        foreach (var warehouseGroup in context.Rows.GroupBy(r => (r.WarehouseId, r.WarehouseName)))
        {
            col.Item().PaddingTop(8).Text(warehouseGroup.Key.WarehouseName).FontSize(10).Bold();
            foreach (var categoryGroup in warehouseGroup.GroupBy(r => r.CategoryName))
            {
                col.Item().PaddingTop(4).Text(categoryGroup.Key).FontSize(9).SemiBold();
                ComposeStockStatusLineTable(col, categoryGroup);
                var subQty = categoryGroup.Sum(r => r.QuantityOnHand);
                var subVal = categoryGroup.Sum(r => r.StockValue);
                col.Item().PaddingBottom(4).Row(row =>
                {
                    row.RelativeItem().Text($"Sous-total {categoryGroup.Key}").FontSize(8).Italic();
                    row.ConstantItem(80).AlignRight().Text(Amount(subQty)).FontSize(8);
                    row.ConstantItem(100).AlignRight().Text(Amount(subVal)).FontSize(8);
                });
            }

            var whQty = warehouseGroup.Sum(r => r.QuantityOnHand);
            var whVal = warehouseGroup.Sum(r => r.StockValue);
            col.Item().PaddingBottom(6).Row(row =>
            {
                row.RelativeItem().Text($"Total {warehouseGroup.Key.WarehouseName}").Bold().FontSize(9);
                row.ConstantItem(80).AlignRight().Text(Amount(whQty)).Bold().FontSize(9);
                row.ConstantItem(100).AlignRight().Text(Amount(whVal)).Bold().FontSize(9);
            });
        }
    }

    private static void ComposeStockStatusByCategoryThenWarehouse(ColumnDescriptor col, StockStatusPdfContext context)
    {
        foreach (var categoryGroup in context.Rows.GroupBy(r => r.CategoryName))
        {
            col.Item().PaddingTop(8).Text(categoryGroup.Key).FontSize(10).Bold();
            foreach (var warehouseGroup in categoryGroup.GroupBy(r => (r.WarehouseId, r.WarehouseName)))
            {
                col.Item().PaddingTop(4).Text(warehouseGroup.Key.WarehouseName).FontSize(9).SemiBold();
                ComposeStockStatusLineTable(col, warehouseGroup);
                var subQty = warehouseGroup.Sum(r => r.QuantityOnHand);
                var subVal = warehouseGroup.Sum(r => r.StockValue);
                col.Item().PaddingBottom(4).Row(row =>
                {
                    row.RelativeItem().Text($"Sous-total {warehouseGroup.Key.WarehouseName}").FontSize(8).Italic();
                    row.ConstantItem(80).AlignRight().Text(Amount(subQty)).FontSize(8);
                    row.ConstantItem(100).AlignRight().Text(Amount(subVal)).FontSize(8);
                });
            }

            var catQty = categoryGroup.Sum(r => r.QuantityOnHand);
            var catVal = categoryGroup.Sum(r => r.StockValue);
            col.Item().PaddingBottom(6).Row(row =>
            {
                row.RelativeItem().Text($"Total {categoryGroup.Key}").Bold().FontSize(9);
                row.ConstantItem(80).AlignRight().Text(Amount(catQty)).Bold().FontSize(9);
                row.ConstantItem(100).AlignRight().Text(Amount(catVal)).Bold().FontSize(9);
            });
        }
    }

    private static void ComposeStockStatusLineTable(
        ColumnDescriptor col,
        IEnumerable<StockStatusReportRowDto> rows)
    {
        col.Item().Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(1f);
                c.RelativeColumn(2f);
                c.RelativeColumn(0.8f);
                c.RelativeColumn(0.9f);
                c.RelativeColumn(1f);
            });

            table.Header(header =>
            {
                header.Cell().Element(CellHeader).Text("Code");
                header.Cell().Element(CellHeader).Text("Désignation");
                header.Cell().Element(CellHeader).AlignRight().Text("Qté");
                header.Cell().Element(CellHeader).AlignRight().Text("P.U.");
                header.Cell().Element(CellHeader).AlignRight().Text("Valeur");
            });

            foreach (var row in rows)
            {
                table.Cell().Element(CellBody).Text(row.ProductCode);
                table.Cell().Element(CellBody).Text(row.ProductName);
                table.Cell().Element(CellBody).AlignRight().Text(Amount(row.QuantityOnHand));
                table.Cell().Element(CellBody).AlignRight().Text(Amount(row.UnitCost));
                table.Cell().Element(CellBody).AlignRight().Text(Amount(row.StockValue));
            }
        });
    }

    private static IContainer CellHeader(IContainer c) =>
        c.DefaultTextStyle(x => x.SemiBold().FontSize(8))
            .PaddingVertical(3)
            .BorderBottom(0.5f)
            .BorderColor(Colors.Grey.Medium);

    private static IContainer CellBody(IContainer c) =>
        c.PaddingVertical(2).BorderBottom(0.25f).BorderColor(Colors.Grey.Lighten2);

    /// <summary>
    /// Document isolé de <see cref="BuildReport"/> : l'en-tête comptable français et ses polices
    /// ne changent pas. Les colonnes sont posées de gauche à droite dans l'ordre visuel arabe
    /// (comme le journal de trésorerie). <c>ContentFromRightToLeft</c> inverserait une seconde
    /// fois les rangées QuestPDF.
    /// </summary>
    private static byte[] BuildArabicStockStatusPdf(StockStatusPdfContext context)
    {
        EnsureTreasuryJournalArabicFont();
        var textStyle = TextStyle.Default.FontFamily(TreasuryJournalArabicFontFamily, "DejaVu Sans").FontSize(9);

        var periodLines = new List<string>
        {
            StockStatusLabels.AsOf(context.GeneratedAtLocal),
            context.GroupingModeLabel
        };
        if (!string.IsNullOrWhiteSpace(context.FiltersSummary))
            periodLines.Add(context.FiltersSummary);

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(24);
                page.DefaultTextStyle(textStyle);
                page.Header().Element(c => ComposeArabicStockStatusHeader(c, context, string.Join(" — ", periodLines)));
                page.Content().PaddingVertical(8).Column(col => ComposeArabicStockStatusBody(col, context));
                page.Footer().Element(ComposeArabicStockStatusFooter);
            });
        }).GeneratePdf();
    }

    private static void ComposeArabicStockStatusHeader(
        IContainer container,
        StockStatusPdfContext context,
        string periodLabel)
    {
        container.Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().AlignRight().Text(StockStatusLabels.CurrencyCaption())
                    .FontSize(8).Italic().FontColor(Colors.Grey.Darken1);
                row.RelativeItem().AlignRight().Column(c =>
                {
                    c.Item().AlignRight().Text(context.CompanyName ?? StockStatusLabels.CompanyFallback())
                        .FontSize(14).Bold();
                    if (!string.IsNullOrWhiteSpace(context.MatriculeFiscal))
                    {
                        c.Item().AlignRight()
                            .Text($"{StockStatusLabels.Matricule()} : {context.MatriculeFiscal}")
                            .FontSize(8).FontColor(Colors.Grey.Darken1);
                    }
                });
            });
            col.Item().PaddingTop(6).AlignRight().Text(context.Title).FontSize(13).Bold().FontColor(Colors.Blue.Darken2);
            if (!string.IsNullOrWhiteSpace(periodLabel))
                col.Item().AlignRight().Text(periodLabel).FontSize(9).FontColor(Colors.Grey.Darken2);
            col.Item().PaddingTop(4).LineHorizontal(1).LineColor(Colors.Grey.Medium);
        });
    }

    private static void ComposeArabicStockStatusFooter(IContainer container)
    {
        container.Column(col =>
        {
            col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
            col.Item().PaddingTop(2).Row(row =>
            {
                row.ConstantItem(120).AlignRight().Text(text =>
                {
                    text.Span(StockStatusLabels.Page() + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.CurrentPageNumber().FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.Span(" / ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.TotalPages().FontSize(8).FontColor(Colors.Grey.Darken1);
                });
                row.RelativeItem().AlignRight().Text(text =>
                {
                    text.Span(StockStatusLabels.PrintedOn() + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.Span(DateTime.Now.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture))
                        .FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });
        });
    }

    private static void ComposeArabicStockStatusBody(ColumnDescriptor col, StockStatusPdfContext context)
    {
        if (context.GroupingMode == StockStatusGroupingMode.CategoryThenWarehouse)
            ComposeArabicStockStatusByCategoryThenWarehouse(col, context);
        else
            ComposeArabicStockStatusByWarehouseThenCategory(col, context);

        col.Item().PaddingTop(12).Row(row =>
        {
            row.ConstantItem(100).AlignRight().Text($"{Amount(context.GrandTotalValue)} {context.Currency}").Bold();
            row.ConstantItem(80).AlignRight().Text(Amount(context.GrandTotalQuantity)).Bold();
            row.RelativeItem().AlignRight().Text(StockStatusLabels.GrandTotal()).Bold();
        });

        col.Item().PaddingTop(8).AlignRight().Text(StockStatusLabels.ValuationNote())
            .FontSize(7)
            .Italic()
            .FontColor(Colors.Grey.Darken1);
    }

    private static void ComposeArabicStockStatusByWarehouseThenCategory(ColumnDescriptor col, StockStatusPdfContext context)
    {
        foreach (var warehouseGroup in context.Rows.GroupBy(r => (r.WarehouseId, r.WarehouseName)))
        {
            col.Item().PaddingTop(8).AlignRight().Text(warehouseGroup.Key.WarehouseName).FontSize(10).Bold();
            foreach (var categoryGroup in warehouseGroup.GroupBy(r => r.CategoryName))
            {
                col.Item().PaddingTop(4).AlignRight().Text(categoryGroup.Key).FontSize(9).SemiBold();
                ComposeArabicStockStatusLineTable(col, categoryGroup);
                ComposeArabicStockStatusSubtotal(
                    col,
                    StockStatusLabels.SubtotalLine(categoryGroup.Key),
                    categoryGroup.Sum(r => r.QuantityOnHand),
                    categoryGroup.Sum(r => r.StockValue),
                    bold: false);
            }

            ComposeArabicStockStatusSubtotal(
                col,
                StockStatusLabels.TotalLine(warehouseGroup.Key.WarehouseName),
                warehouseGroup.Sum(r => r.QuantityOnHand),
                warehouseGroup.Sum(r => r.StockValue),
                bold: true);
        }
    }

    private static void ComposeArabicStockStatusByCategoryThenWarehouse(ColumnDescriptor col, StockStatusPdfContext context)
    {
        foreach (var categoryGroup in context.Rows.GroupBy(r => r.CategoryName))
        {
            col.Item().PaddingTop(8).AlignRight().Text(categoryGroup.Key).FontSize(10).Bold();
            foreach (var warehouseGroup in categoryGroup.GroupBy(r => (r.WarehouseId, r.WarehouseName)))
            {
                col.Item().PaddingTop(4).AlignRight().Text(warehouseGroup.Key.WarehouseName).FontSize(9).SemiBold();
                ComposeArabicStockStatusLineTable(col, warehouseGroup);
                ComposeArabicStockStatusSubtotal(
                    col,
                    StockStatusLabels.SubtotalLine(warehouseGroup.Key.WarehouseName),
                    warehouseGroup.Sum(r => r.QuantityOnHand),
                    warehouseGroup.Sum(r => r.StockValue),
                    bold: false);
            }

            ComposeArabicStockStatusSubtotal(
                col,
                StockStatusLabels.TotalLine(categoryGroup.Key),
                categoryGroup.Sum(r => r.QuantityOnHand),
                categoryGroup.Sum(r => r.StockValue),
                bold: true);
        }
    }

    private static void ComposeArabicStockStatusSubtotal(
        ColumnDescriptor col,
        string label,
        decimal quantity,
        decimal value,
        bool bold)
    {
        col.Item().PaddingBottom(bold ? 6 : 4).Row(row =>
        {
            if (bold)
            {
                row.ConstantItem(100).AlignRight().Text(Amount(value)).FontSize(9).Bold();
                row.ConstantItem(80).AlignRight().Text(Amount(quantity)).FontSize(9).Bold();
                row.RelativeItem().AlignRight().Text(label).FontSize(9).Bold();
            }
            else
            {
                row.ConstantItem(100).AlignRight().Text(Amount(value)).FontSize(8);
                row.ConstantItem(80).AlignRight().Text(Amount(quantity)).FontSize(8);
                row.RelativeItem().AlignRight().Text(label).FontSize(8).Italic();
            }
        });
    }

    private static void ComposeArabicStockStatusLineTable(
        ColumnDescriptor col,
        IEnumerable<StockStatusReportRowDto> rows)
    {
        col.Item().Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(1f);
                c.RelativeColumn(0.9f);
                c.RelativeColumn(0.8f);
                c.RelativeColumn(2f);
                c.RelativeColumn(1f);
            });

            table.Header(header =>
            {
                header.Cell().Element(CellHeader).AlignRight().Text(StockStatusLabels.Value());
                header.Cell().Element(CellHeader).AlignRight().Text(StockStatusLabels.UnitPrice());
                header.Cell().Element(CellHeader).AlignRight().Text(StockStatusLabels.Quantity());
                header.Cell().Element(CellHeader).AlignRight().Text(StockStatusLabels.Designation());
                header.Cell().Element(CellHeader).AlignRight().Text(StockStatusLabels.Code());
            });

            foreach (var row in rows)
            {
                table.Cell().Element(CellBody).AlignRight().Text(Amount(row.StockValue));
                table.Cell().Element(CellBody).AlignRight().Text(Amount(row.UnitCost));
                table.Cell().Element(CellBody).AlignRight().Text(Amount(row.QuantityOnHand));
                table.Cell().Element(CellBody).AlignRight().Text(row.ProductName);
                table.Cell().Element(CellBody).AlignRight().Text(row.ProductCode);
            }
        });
    }
}
