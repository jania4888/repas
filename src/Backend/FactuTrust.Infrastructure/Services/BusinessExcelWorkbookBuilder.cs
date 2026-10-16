using ClosedXML.Excel;
using FactuTrust.Application.Features.DataExports;

namespace FactuTrust.Infrastructure.Services;

public sealed class BusinessExcelWorkbookBuilder : IBusinessExcelWorkbookBuilder
{
    public byte[] Build(BusinessWorkbookModel model)
    {
        using var workbook = new XLWorkbook();
        WriteSummary(workbook, model);
        foreach (var sheet in model.Sheets)
            WriteSheet(workbook, sheet);

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteSummary(XLWorkbook workbook, BusinessWorkbookModel model)
    {
        var sheet = workbook.Worksheets.Add("Sommaire");
        var rows = new (string Label, string Value)[]
        {
            ("Société", model.CompanyName),
            ("Exporté le", model.ExportedAt.ToString("dd/MM/yyyy HH:mm")),
            ("Fuseau", "Africa/Tunis"),
            ("Utilisateur", model.UserEmail),
            ("Périmètre", model.ScopeLabel),
            ("Mention", "Copie de consultation. Ce fichier n'est pas un document fiscal.")
        };

        sheet.Cell(1, 1).Value = "Libellé";
        sheet.Cell(1, 2).Value = "Valeur";
        StyleHeader(sheet, 2);

        for (var i = 0; i < rows.Length; i++)
        {
            sheet.Cell(i + 2, 1).SetValue(rows[i].Label);
            sheet.Cell(i + 2, 2).SetValue(ExcelFormulaGuard.Apply(rows[i].Value) ?? string.Empty);
        }

        var tableHeader = rows.Length + 3;
        sheet.Cell(tableHeader, 1).Value = "Feuille";
        sheet.Cell(tableHeader, 2).Value = "Lignes";
        StyleHeader(sheet, 2, tableHeader);
        for (var i = 0; i < model.Sheets.Count; i++)
        {
            sheet.Cell(tableHeader + 1 + i, 1).SetValue(model.Sheets[i].Name);
            sheet.Cell(tableHeader + 1 + i, 2).SetValue(model.Sheets[i].Rows.Count);
        }

        sheet.Column(1).Width = 28;
        sheet.Column(2).Width = 72;
    }

    private static void WriteSheet(XLWorkbook workbook, ExcelSheetModel model)
    {
        var sheet = workbook.Worksheets.Add(ExcelSheetNames.Clamp(model.Name));
        for (var column = 0; column < model.Columns.Count; column++)
            sheet.Cell(1, column + 1).SetValue(model.Columns[column].Header);
        StyleHeader(sheet, model.Columns.Count);

        for (var rowIndex = 0; rowIndex < model.Rows.Count; rowIndex++)
        {
            var row = model.Rows[rowIndex];
            if (row.Count != model.Columns.Count)
            {
                throw new InvalidOperationException(
                    $"La feuille {model.Name} a {model.Columns.Count} colonnes et une ligne de {row.Count} cellules.");
            }

            for (var column = 0; column < row.Count; column++)
                WriteCell(sheet.Cell(rowIndex + 2, column + 1), row[column], model.Columns[column].Format);
        }

        sheet.SheetView.FreezeRows(1);
        for (var column = 0; column < model.Columns.Count; column++)
        {
            var width = Math.Clamp(model.Columns[column].Header.Length + 2, 12, 42);
            sheet.Column(column + 1).Width = width;
        }
    }

    private static void WriteCell(IXLCell cell, ExcelValue value, ExcelColumnFormat format)
    {
        if (value.Date.HasValue && format is ExcelColumnFormat.Date or ExcelColumnFormat.DateTime)
        {
            cell.SetValue(value.Date.Value);
            cell.Style.NumberFormat.Format = format == ExcelColumnFormat.DateTime
                ? "dd/MM/yyyy HH:mm"
                : "dd/MM/yyyy";
            return;
        }

        if (value.Number.HasValue && format is ExcelColumnFormat.Money or ExcelColumnFormat.Quantity)
        {
            cell.SetValue(value.Number.Value);
            cell.Style.NumberFormat.Format = "#,##0.000";
            return;
        }

        if (value.Number.HasValue && value.Text is null && value.Date is null)
        {
            cell.SetValue(value.Number.Value);
            cell.Style.NumberFormat.Format = "#,##0.000";
            return;
        }

        cell.SetValue(ExcelFormulaGuard.Apply(value.Text) ?? string.Empty);
    }

    private static void StyleHeader(IXLWorksheet sheet, int columnCount, int headerRow = 1)
    {
        for (var column = 1; column <= columnCount; column++)
        {
            var cell = sheet.Cell(headerRow, column);
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#E2E8F0");
        }
    }
}
