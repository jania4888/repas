namespace FactuTrust.Application.Common.Models;

/// <summary>
/// Gabarit d'une planche d'étiquettes : géométrie en millimètres, telle que l'imprime le
/// fabricant du support.
///
/// <para>
/// Ces valeurs ne sont pas des réglages d'affichage : elles doivent correspondre au millimètre
/// près aux planches adhésives achetées, sinon le contenu dérive de rangée en rangée et la
/// dernière ligne tombe à côté. C'est la raison pour laquelle elles sont une table figée et
/// non des paramètres libres.
/// </para>
/// </summary>
public sealed record LabelSheetLayout
{
    /// <summary>Clé stable, utilisée par le front et par le contrat d'API.</summary>
    public required string Key { get; init; }

    /// <summary>Libellé destiné à l'utilisateur.</summary>
    public required string Label { get; init; }

    public required double LabelWidthMm { get; init; }
    public required double LabelHeightMm { get; init; }

    public required int Columns { get; init; }
    public required int Rows { get; init; }

    /// <summary>Marges de la planche.</summary>
    public required double MarginTopMm { get; init; }
    public required double MarginLeftMm { get; init; }

    /// <summary>Gouttières entre étiquettes.</summary>
    public double HorizontalGapMm { get; init; }
    public double VerticalGapMm { get; init; }

    /// <summary>
    /// Vrai pour un rouleau thermique : la page EST l'étiquette, il n'y a ni marge de planche
    /// ni gouttière, et le format de page suit la dimension de l'étiquette.
    /// </summary>
    public bool IsRoll { get; init; }

    public int LabelsPerPage => Columns * Rows;

    /// <summary>
    /// Gabarits disponibles. En ajouter un tient en une ligne — c'est délibéré : le parc
    /// d'imprimantes et de supports varie d'un dossier à l'autre.
    /// </summary>
    public static IReadOnlyList<LabelSheetLayout> All { get; } = new[]
    {
        new LabelSheetLayout
        {
            Key = "A4_65", Label = "A4 — 65 étiquettes (38,1 × 21,2 mm)",
            LabelWidthMm = 38.1, LabelHeightMm = 21.2,
            Columns = 5, Rows = 13,
            MarginTopMm = 10.7, MarginLeftMm = 4.7,
            HorizontalGapMm = 2.5, VerticalGapMm = 0
        },
        new LabelSheetLayout
        {
            Key = "A4_40", Label = "A4 — 40 étiquettes (52,5 × 29,7 mm)",
            LabelWidthMm = 52.5, LabelHeightMm = 29.7,
            Columns = 4, Rows = 10,
            MarginTopMm = 0, MarginLeftMm = 0
        },
        new LabelSheetLayout
        {
            Key = "A4_24", Label = "A4 — 24 étiquettes (70 × 37 mm)",
            LabelWidthMm = 70, LabelHeightMm = 37,
            Columns = 3, Rows = 8,
            MarginTopMm = 0, MarginLeftMm = 0
        },
        new LabelSheetLayout
        {
            Key = "A4_21", Label = "A4 — 21 étiquettes (70 × 42,3 mm)",
            LabelWidthMm = 70, LabelHeightMm = 42.3,
            Columns = 3, Rows = 7,
            MarginTopMm = 4.5, MarginLeftMm = 0
        },
        new LabelSheetLayout
        {
            Key = "Roll_58x40", Label = "Rouleau thermique — 58 × 40 mm",
            LabelWidthMm = 58, LabelHeightMm = 40,
            Columns = 1, Rows = 1,
            MarginTopMm = 0, MarginLeftMm = 0,
            IsRoll = true
        },
        new LabelSheetLayout
        {
            Key = "Roll_40x30", Label = "Rouleau thermique — 40 × 30 mm",
            LabelWidthMm = 40, LabelHeightMm = 30,
            Columns = 1, Rows = 1,
            MarginTopMm = 0, MarginLeftMm = 0,
            IsRoll = true
        }
    };

    public static LabelSheetLayout? Find(string? key) =>
        string.IsNullOrWhiteSpace(key)
            ? null
            : All.FirstOrDefault(l => string.Equals(l.Key, key.Trim(), StringComparison.OrdinalIgnoreCase));
}
