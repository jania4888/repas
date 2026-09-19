namespace FactuTrust.Application.DTOs;

/// <summary>Un article et le nombre d'étiquettes à en tirer.</summary>
public sealed record ProductLabelItemDto
{
    public Guid ProductId { get; init; }
    public int Quantity { get; init; } = 1;
}

/// <summary>Demande d'impression d'une planche d'étiquettes.</summary>
public sealed record ProductLabelRequestDto
{
    /// <summary>Clé de gabarit (voir <c>GET /api/products/label-layouts</c>).</summary>
    public string Layout { get; init; } = "A4_65";

    /// <summary>
    /// Imprimer le prix TTC. Éteint par défaut : un prix imprimé est un engagement, et une
    /// étiquette survit à un changement de tarif.
    /// </summary>
    public bool IncludePrice { get; init; }

    /// <summary>Imprimer le code interne sous le nom.</summary>
    public bool IncludeCode { get; init; } = true;

    public IReadOnlyList<ProductLabelItemDto> Items { get; init; } = Array.Empty<ProductLabelItemDto>();
}

/// <summary>Gabarit exposé au front pour alimenter le choix de planche.</summary>
public sealed record LabelLayoutDto
{
    public string Key { get; init; } = null!;
    public string Label { get; init; } = null!;
    public int LabelsPerPage { get; init; }
    public bool IsRoll { get; init; }
}

/// <summary>PDF engendré.</summary>
public sealed record ProductLabelsPdfResult(byte[] Content, string FileName, string ContentType);
