using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Models;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Templates;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Services.Barcodes;

/// <summary>
/// Rend une planche d'étiquettes en PDF <b>vectoriel</b>.
///
/// <para>
/// Les barres sont des rectangles, pas une image : une étiquette reste donc nette à n'importe
/// quelle résolution. C'est ce qui compte sur une thermique 203 dpi, où une image rastérisée
/// perd un demi-pixel par barre et finit par ne plus se lire à la douchette.
/// </para>
/// </summary>
public sealed class ProductLabelPdfRenderer : IProductLabelPdfRenderer
{
    /// <summary>Hauteur des barres. En deçà, l'angle de lecture d'une douchette se réduit trop.</summary>
    private const double BarcodeHeightRatio = 0.42;

    /// <summary>Marge intérieure de chaque étiquette : la découpe n'est jamais au millimètre.</summary>
    private const double LabelPaddingMm = 1.5;

    /// <summary>
    /// Marge blanche exigée de part et d'autre des barres (« quiet zone »). Sans elle, une
    /// douchette ne trouve pas le début du symbole — c'est la cause la plus fréquente d'une
    /// étiquette imprimée correctement mais illisible.
    /// </summary>
    private const double QuietZoneModules = 10;

    private readonly IBarcodeEncoder _encoder;

    public ProductLabelPdfRenderer(IBarcodeEncoder encoder)
    {
        _encoder = encoder;
        QuestPdfBootstrap.EnsureInitialized();
    }

    public byte[] Render(ProductLabelsPdfContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var layout = context.Layout;
        var perPage = Math.Max(1, layout.LabelsPerPage);
        var pages = (int)Math.Ceiling(context.Labels.Count / (double)perPage);
        if (pages == 0) pages = 1;

        var document = Document.Create(container =>
        {
            for (var page = 0; page < pages; page++)
            {
                var slice = context.Labels
                    .Skip(page * perPage)
                    .Take(perPage)
                    .ToList();

                container.Page(p => ComposePage(p, layout, slice, context.IncludeCode));
            }
        });

        return document.GeneratePdf();
    }

    private void ComposePage(
        PageDescriptor page,
        LabelSheetLayout layout,
        IReadOnlyList<ProductLabelContent> labels,
        bool includeCode)
    {
        if (layout.IsRoll)
        {
            // Sur rouleau, la page EST l'étiquette : ni marge de planche ni gouttière.
            page.Size((float)layout.LabelWidthMm, (float)layout.LabelHeightMm, Unit.Millimetre);
            page.Margin(0);
        }
        else
        {
            page.Size(PageSizes.A4);
            page.MarginTop((float)layout.MarginTopMm, Unit.Millimetre);
            page.MarginLeft((float)layout.MarginLeftMm, Unit.Millimetre);
            page.MarginRight(0);
            page.MarginBottom(0);
        }

        page.DefaultTextStyle(x => x.FontSize(7).FontColor(Colors.Black));

        page.Content().Column(column =>
        {
            if (layout.VerticalGapMm > 0)
                column.Spacing((float)layout.VerticalGapMm, Unit.Millimetre);

            for (var rowIndex = 0; rowIndex < layout.Rows; rowIndex++)
            {
                var first = rowIndex * layout.Columns;
                if (first >= labels.Count) break;

                column.Item().Row(row =>
                {
                    if (layout.HorizontalGapMm > 0)
                        row.Spacing((float)layout.HorizontalGapMm, Unit.Millimetre);

                    for (var col = 0; col < layout.Columns; col++)
                    {
                        var index = first + col;
                        var cell = row
                            .ConstantItem((float)layout.LabelWidthMm, Unit.Millimetre)
                            .Height((float)layout.LabelHeightMm, Unit.Millimetre);

                        if (index < labels.Count)
                            cell.Padding((float)LabelPaddingMm, Unit.Millimetre)
                                .Element(c => ComposeLabel(c, labels[index], layout, includeCode));
                        else
                            cell.Element(_ => { }); // Case vide : la planche garde sa grille.
                    }
                });
            }
        });
    }

    private void ComposeLabel(
        IContainer container,
        ProductLabelContent label,
        LabelSheetLayout layout,
        bool includeCode)
    {
        container.Column(column =>
        {
            column.Item()
                .Text(Shorten(label.Name, layout))
                .FontSize(FontSizeForLabel(layout))
                .SemiBold()
                .LineHeight(1f);

            if (label.Barcode is not null && label.Symbology is not null)
            {
                column.Item().PaddingTop(1).Element(c => ComposeBarcode(c, label, layout));
            }
            else
            {
                // Article sans code-barres : on imprime quand même l'étiquette, avec le code
                // interne en évidence. Refuser l'impression obligerait à trier la sélection à
                // la main pour un cas parfaitement légitime.
                column.Item().PaddingTop(1)
                    .Text(label.Code)
                    .FontSize(FontSizeForLabel(layout) + 1)
                    .Bold();
            }

            var showCode = includeCode && label.Barcode is not null;
            if (showCode || label.Price is not null)
            {
                column.Item().PaddingTop(0.5f).Row(row =>
                {
                    if (showCode)
                        row.RelativeItem().Text(label.Code).FontSize(5.5f).FontColor(Colors.Grey.Darken1);

                    if (label.Price is not null)
                        row.RelativeItem().AlignRight().Text(label.Price).FontSize(6.5f).Bold();
                });
            }
        });
    }

    private void ComposeBarcode(IContainer container, ProductLabelContent label, LabelSheetLayout layout)
    {
        IReadOnlyList<int> widths;
        try
        {
            widths = _encoder.Encode(label.Barcode!, label.Symbology!.Value);
        }
        catch (ArgumentException)
        {
            // Valeur incompatible avec sa symbologie : on imprime le texte plutôt que des
            // barres fausses. Une étiquette lisible à l'œil vaut mieux qu'un symbole qu'aucune
            // douchette ne décodera.
            container.Text(label.Barcode!).FontSize(6).Bold();
            return;
        }

        var totalModules = widths.Sum() + 2 * QuietZoneModules;
        var available = layout.LabelWidthMm - 2 * LabelPaddingMm;
        var moduleMm = available / totalModules;
        var barsHeightMm = layout.LabelHeightMm * BarcodeHeightRatio;

        container.Column(column =>
        {
            column.Item()
                .Height((float)barsHeightMm, Unit.Millimetre)
                .Row(row =>
                {
                    row.ConstantItem((float)(QuietZoneModules * moduleMm), Unit.Millimetre);

                    var isBar = true; // Contrat de l'encodeur : on commence toujours par une barre.
                    foreach (var width in widths)
                    {
                        var item = row.ConstantItem((float)(width * moduleMm), Unit.Millimetre);
                        if (isBar) item.Background(Colors.Black);
                        isBar = !isBar;
                    }

                    row.ConstantItem((float)(QuietZoneModules * moduleMm), Unit.Millimetre);
                });

            column.Item()
                .AlignCenter()
                .Text(_encoder.HumanReadable(label.Barcode!, label.Symbology!.Value))
                .FontSize(FontSizeForHri(layout))
                .FontColor(Colors.Black);
        });
    }

    /// <summary>
    /// Tronque la désignation à ce que l'étiquette peut porter sur deux lignes.
    ///
    /// <para>
    /// Le découpage est fait ici plutôt que laissé au moteur de rendu : une désignation qui
    /// déborde pousserait les barres hors de l'étiquette, et ce n'est visible qu'une fois la
    /// planche imprimée. Mieux vaut une désignation abrégée qu'un code-barres tronqué.
    /// </para>
    /// </summary>
    private static string Shorten(string name, LabelSheetLayout layout)
    {
        // Deux lignes, à peu près une lettre par 0,55 mm à la taille de police retenue.
        var maxChars = (int)(layout.LabelWidthMm / 0.55 * 2);
        if (name.Length <= maxChars) return name;

        return string.Concat(name.AsSpan(0, Math.Max(1, maxChars - 1)), "…");
    }

    /// <summary>Le texte doit rester lisible sur une 38 mm comme sur une 70 mm.</summary>
    private static float FontSizeForLabel(LabelSheetLayout layout) =>
        layout.LabelWidthMm >= 60 ? 8f : layout.LabelWidthMm >= 50 ? 7f : 6f;

    private static float FontSizeForHri(LabelSheetLayout layout) =>
        layout.LabelWidthMm >= 50 ? 6.5f : 5.5f;
}
