using System.Globalization;
using FactuTrust.Application.DTOs;
using QuestPDF.Drawing;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Journal de trésorerie imprimable. Isolé de <see cref="BuildReport"/> : les factures
/// et les autres états gardent leur en-tête français et leurs polices.
/// </summary>
public partial class PdfService
{
    private const string TreasuryJournalArabicFontFamily = "Noto Naskh Arabic";
    private static readonly object ArabicFontGate = new();
    private static bool _arabicFontRegistered;

    public Task<byte[]> GenerateTreasuryJournalPdfAsync(
        TreasuryJournalPdfDocument document,
        CancellationToken cancellationToken = default)
    {
        if (document.RightToLeft)
            EnsureTreasuryJournalArabicFont();

        var textStyle = document.RightToLeft
            ? TextStyle.Default.FontFamily(TreasuryJournalArabicFontFamily, "DejaVu Sans").FontSize(9)
            : ReportTextStyle;

        var pdf = Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(24);
                page.DefaultTextStyle(textStyle);
                page.Header().Element(c => ComposeTreasuryJournalHeader(c, document));
                page.Content().PaddingVertical(8).Column(col => ComposeTreasuryJournalBody(col, document));
                page.Footer().Element(c => ComposeTreasuryJournalFooter(c, document));
            });
        }).GeneratePdf();

        return Task.FromResult(pdf);
    }

    private static void EnsureTreasuryJournalArabicFont()
    {
        if (_arabicFontRegistered)
            return;

        lock (ArabicFontGate)
        {
            if (_arabicFontRegistered)
                return;

            var assembly = typeof(PdfService).Assembly;
            var resourceName = Array.Find(
                assembly.GetManifestResourceNames(),
                name => name.EndsWith("NotoNaskhArabic-Regular.ttf", StringComparison.Ordinal));
            if (resourceName is null)
                throw new InvalidOperationException("Police arabe du journal de trésorerie introuvable.");

            using var input = assembly.GetManifestResourceStream(resourceName);
            if (input is null)
                throw new InvalidOperationException("Police arabe du journal de trésorerie introuvable.");

            var buffer = new MemoryStream();
            input.CopyTo(buffer);
            buffer.Position = 0;
            FontManager.RegisterFont(buffer);
            _arabicFontRegistered = true;
        }
    }

    private static void ComposeTreasuryJournalHeader(IContainer container, TreasuryJournalPdfDocument document)
    {
        container.Column(col =>
        {
            col.Item().Row(row =>
            {
                if (document.RightToLeft)
                {
                    row.RelativeItem().AlignRight().Text(document.CurrencyCaption).FontSize(8).Italic().FontColor(Colors.Grey.Darken1);
                    row.RelativeItem().AlignRight().Column(c => ComposeTreasuryJournalCompany(c, document));
                }
                else
                {
                    row.RelativeItem().Column(c => ComposeTreasuryJournalCompany(c, document));
                    row.ConstantItem(160).AlignRight().Text(document.CurrencyCaption).FontSize(8).Italic().FontColor(Colors.Grey.Darken1);
                }
            });

            AlignTreasuryText(col.Item().PaddingTop(6), document.RightToLeft)
                .Text(document.Title).FontSize(13).Bold().FontColor(Colors.Blue.Darken2);

            if (!string.IsNullOrWhiteSpace(document.PeriodLabel))
            {
                AlignTreasuryText(col.Item(), document.RightToLeft)
                    .Text(document.PeriodLabel).FontSize(9).FontColor(Colors.Grey.Darken2);
            }

            col.Item().PaddingTop(4).LineHorizontal(1).LineColor(Colors.Grey.Medium);
        });
    }

    private static void ComposeTreasuryJournalCompany(ColumnDescriptor column, TreasuryJournalPdfDocument document)
    {
        AlignTreasuryText(column.Item(), document.RightToLeft)
            .Text(document.CompanyName).FontSize(14).Bold();

        if (string.IsNullOrWhiteSpace(document.MatriculeFiscal))
            return;

        AlignTreasuryText(column.Item(), document.RightToLeft)
            .Text($"{document.MatriculeLabel} : {document.MatriculeFiscal}")
            .FontSize(8)
            .FontColor(Colors.Grey.Darken1);
    }

    private static void ComposeTreasuryJournalBody(ColumnDescriptor column, TreasuryJournalPdfDocument document)
    {
        if (document.Sections.Count == 0)
            column.Item().PaddingTop(16).Text(document.EmptyLabel).Italic().FontColor(Colors.Grey.Darken1);

        foreach (var section in document.Sections)
        {
            AlignTreasuryText(column.Item().PaddingTop(10), document.RightToLeft)
                .Text(section.Title).FontSize(12).Bold().FontColor(Colors.Blue.Darken2);

            foreach (var group in section.Groups)
            {
                AlignTreasuryText(column.Item().PaddingTop(6), document.RightToLeft)
                    .Text(group.Category).FontSize(10).SemiBold();

                column.Item().PaddingTop(2).Element(c => ComposeTreasuryJournalTable(c, document, group.Lines));

                var subtotal = $"{document.SubtotalLabel}  {Amount(group.Subtotal)} {document.Currency}  ({group.Count})";
                column.Item().PaddingTop(2).AlignRight().Text(subtotal).FontSize(8).SemiBold();
            }
        }

        column.Item().PaddingTop(12).AlignRight().Width(320).Background(Colors.Blue.Darken2).Padding(8).Column(box =>
        {
            TreasuryJournalTotalRow(box, document.TotalCreditsLabel, document.TotalCredits, document.Currency);
            TreasuryJournalTotalRow(box, document.TotalDebitsLabel, document.TotalDebits, document.Currency);
            TreasuryJournalTotalRow(box, document.BalanceLabel, document.Balance, document.Currency);
            box.Item().Row(row =>
            {
                row.RelativeItem().Text(document.CountLabel).FontSize(8).FontColor(Colors.White);
                row.ConstantItem(140).AlignRight().Text(document.OperationCount.ToString(CultureInfo.InvariantCulture))
                    .FontSize(8).Bold().FontColor(Colors.White);
            });
        });
    }

    private static void ComposeTreasuryJournalTable(
        IContainer container,
        TreasuryJournalPdfDocument document,
        IReadOnlyList<TreasuryJournalPdfLine> lines)
    {
        var headers = document.Columns.ToList();
        if (document.RightToLeft)
            headers.Reverse();

        container.Table(table =>
        {
            table.ColumnsDefinition(columns =>
            {
                columns.RelativeColumn(0.9f);
                columns.RelativeColumn(0.7f);
                columns.RelativeColumn(1.1f);
                columns.RelativeColumn(1.6f);
                columns.RelativeColumn(1.8f);
                columns.RelativeColumn(1.1f);
                columns.RelativeColumn(0.9f);
                columns.RelativeColumn(0.9f);
            });

            table.Header(header =>
            {
                foreach (var text in headers)
                {
                    AlignTreasuryText(header.Cell().Background(Colors.Blue.Darken2).Padding(4), document.RightToLeft)
                        .Text(text).FontSize(8).Bold().FontColor(Colors.White);
                }
            });

            var alt = false;
            foreach (var line in lines)
            {
                var bg = alt ? Colors.Grey.Lighten4 : Colors.White;
                var values = new[]
                {
                    ShortDate(line.Date),
                    line.Type,
                    line.Method,
                    line.Category,
                    line.Label,
                    line.Document,
                    line.Debit is null ? "" : Amount(line.Debit.Value),
                    line.Credit is null ? "" : Amount(line.Credit.Value)
                };
                if (document.RightToLeft)
                    Array.Reverse(values);

                foreach (var value in values)
                {
                    AlignTreasuryText(table.Cell().Background(bg).Padding(3), document.RightToLeft)
                        .Text(value).FontSize(8);
                }

                alt = !alt;
            }
        });
    }

    private static void ComposeTreasuryJournalFooter(IContainer container, TreasuryJournalPdfDocument document)
    {
        container.Column(col =>
        {
            col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
            col.Item().PaddingTop(2).Row(row =>
            {
                row.RelativeItem().Text(text =>
                {
                    text.Span(document.PrintedOnLabel + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.Span(DateTime.Now.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture))
                        .FontSize(8).FontColor(Colors.Grey.Darken1);
                });
                row.ConstantItem(120).AlignRight().Text(text =>
                {
                    text.Span(document.PageLabel + " ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.CurrentPageNumber().FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.Span(" / ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    text.TotalPages().FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });
        });
    }

    private static IContainer AlignTreasuryText(IContainer container, bool rightToLeft) =>
        rightToLeft ? container.AlignRight() : container;

    private static void TreasuryJournalTotalRow(ColumnDescriptor column, string label, decimal amount, string currency)
    {
        column.Item().Row(row =>
        {
            row.RelativeItem().Text(label).FontSize(8).FontColor(Colors.White);
            row.ConstantItem(140).AlignRight().Text($"{Amount(amount)} {currency}").FontSize(8).Bold().FontColor(Colors.White);
        });
    }
}
