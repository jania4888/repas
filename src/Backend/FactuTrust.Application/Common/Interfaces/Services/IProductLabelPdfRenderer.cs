using FactuTrust.Application.Common.Models;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>Une étiquette à imprimer, déjà résolue : le rendu ne lit plus la base.</summary>
public sealed record ProductLabelContent
{
    public required string Name { get; init; }
    public required string Code { get; init; }

    /// <summary>Null si l'article n'a pas de code-barres : l'étiquette est alors en texte seul.</summary>
    public string? Barcode { get; init; }

    public BarcodeSymbology? Symbology { get; init; }

    /// <summary>Prix TTC formaté, ou null si l'impression du prix n'a pas été demandée.</summary>
    public string? Price { get; init; }
}

public sealed record ProductLabelsPdfContext
{
    public required LabelSheetLayout Layout { get; init; }
    public required IReadOnlyList<ProductLabelContent> Labels { get; init; }
    public bool IncludeCode { get; init; } = true;
}

/// <summary>
/// Rend une planche d'étiquettes.
///
/// <para>
/// Volontairement séparé de <c>IPdfService</c> : les documents commerciaux et les étiquettes
/// n'ont ni la même géométrie, ni les mêmes dépendances, et mêler les deux ferait porter à la
/// facture le risque d'une régression d'étiquette.
/// </para>
/// </summary>
public interface IProductLabelPdfRenderer
{
    byte[] Render(ProductLabelsPdfContext context);
}
