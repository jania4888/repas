using System.Globalization;
using FactuTrust.Application.DTOs;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services;

public partial class PdfService
{
    private static readonly string[] MonthNamesFr =
    {
        "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
    };

    public Task<byte[]> GenerateVatDeclarationPdfAsync(VatDeclarationDto dto, string companyName, CancellationToken cancellationToken = default)
    {
        var bytes = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(32);
                page.DefaultTextStyle(t => t.FontSize(10).FontColor(Colors.Grey.Darken3));

                page.Header().Column(header =>
                {
                    header.Item().Text(string.IsNullOrWhiteSpace(companyName) ? "Société" : companyName).FontSize(15).Bold();
                    var period = dto.Month >= 1 && dto.Month <= 12 ? $"{MonthNamesFr[dto.Month]} {dto.Year}" : $"{dto.Month}/{dto.Year}";
                    header.Item().Text($"Déclaration mensuelle des impôts — {period}").FontSize(12).FontColor(Colors.Blue.Darken2);
                    if (dto.IsRectificative)
                        header.Item().Text($"RECTIFICATIVE (version {dto.Version})").FontSize(10).Bold().FontColor(Colors.Red.Darken1);
                    header.Item().PaddingBottom(6).Text($"Devise : {dto.Currency}").FontSize(9).FontColor(Colors.Grey.Darken1);
                    header.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten1);
                });

                page.Content().PaddingVertical(10).Column(col =>
                {
                    Section(col, "TVA COLLECTÉE");
                    AmountRow(col, "TVA 19 %", dto.CollectedVat19);
                    AmountRow(col, "TVA 13 %", dto.CollectedVat13);
                    AmountRow(col, "TVA 7 %", dto.CollectedVat7);
                    AmountRow(col, "Total collectée", dto.CollectedVat19 + dto.CollectedVat13 + dto.CollectedVat7, bold: true);

                    Section(col, "TVA DÉDUCTIBLE");
                    AmountRow(col, "Sur biens et services", dto.DeductibleVatGoods);
                    AmountRow(col, "Sur immobilisations", dto.DeductibleVatAssets);
                    AmountRow(col, "Total déductible", dto.DeductibleVatGoods + dto.DeductibleVatAssets, bold: true);

                    Section(col, "SOLDE TVA");
                    AmountRow(col, "Crédit antérieur", dto.PreviousCredit);
                    AmountRow(col, "TVA due", dto.VatDue, bold: true);
                    AmountRow(col, "Crédit à reporter", dto.CreditToCarry);

                    if (dto.MonthlyDeclarationV2Enabled)
                    {
                        Section(col, "AUTRES TAXES");
                        AmountRow(col, "FODEC", dto.Fodec);
                        AmountRow(col, "Droit de timbre", dto.DroitTimbre);
                        AmountRow(col, "TCL", dto.Tcl);
                        AmountRow(col, "TFP", dto.Tfp);
                        AmountRow(col, "FOPROLOS", dto.Foprolos);
                        AmountRow(col, "Retenues à la source (RS)", dto.WithholdingTax);
                        // Comprises dans le net à payer : les taire rendrait le total invérifiable.
                        // Imprimées seulement non nulles, pour que le récapitulatif d'un dépôt où elles
                        // valent 0 — tous ceux d'avant la déclaration paramétrable — reste identique.
                        if (dto.ConsumptionDuty != 0m)
                            AmountRow(col, "Droit de consommation", dto.ConsumptionDuty);
                        if (dto.HotelTax != 0m)
                            AmountRow(col, "Taxe hôtelière", dto.HotelTax);
                        if (dto.LicenceFee != 0m)
                            AmountRow(col, "Droit de licence", dto.LicenceFee);
                        AmountRow(col, "Acomptes provisionnels (déduits)", -dto.Acomptes);

                        Section(col, "TOTAL À PAYER");
                        AmountRow(col, "Net à payer (toutes taxes)", dto.TotalToPay, bold: true, highlight: true);
                    }
                });

                page.Footer().AlignCenter().Text(t =>
                {
                    t.Span("Document généré le ").FontSize(8).FontColor(Colors.Grey.Darken1);
                    t.Span(DateTime.Now.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)).FontSize(8).FontColor(Colors.Grey.Darken1);
                });
            });
        }).GeneratePdf();

        return Task.FromResult(bytes);
    }

    private static void Section(ColumnDescriptor col, string title)
    {
        col.Item().PaddingTop(12).PaddingBottom(4).Text(title).FontSize(11).Bold().FontColor(Colors.Blue.Darken2);
    }

    private static void AmountRow(ColumnDescriptor col, string label, decimal amount, bool bold = false, bool highlight = false)
    {
        col.Item().Background(highlight ? Colors.Blue.Lighten5 : Colors.White).PaddingVertical(3).Row(row =>
        {
            var labelText = row.RelativeItem().Text(label).FontSize(10);
            if (bold) labelText.Bold();
            var amountText = row.ConstantItem(140).AlignRight().Text(amount.ToString("N3", CultureInfo.InvariantCulture)).FontSize(10);
            if (bold) amountText.Bold();
        });
    }
}
