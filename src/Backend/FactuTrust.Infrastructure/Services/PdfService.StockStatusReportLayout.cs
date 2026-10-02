using FactuTrust.Application.DTOs;
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
}
