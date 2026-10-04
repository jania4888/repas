namespace FactuTrust.Application.Common.Interfaces.Services;

public sealed record AiDocumentExtractedPage
{
    public int PageIndex { get; init; }
    public string Text { get; init; } = "";
    public string? ImageBase64 { get; init; }
    public int? Width { get; init; }
    public int? Height { get; init; }
    public bool OcrApplied { get; init; }
}

public sealed record AiDocumentExtractionResult
{
    public bool Success { get; init; }
    public string Text { get; init; } = "";
    public bool Truncated { get; init; }
    public string? ErrorMessage { get; init; }

    /// <summary>Format détecté ("pdf" | "image" | "docx" | "xlsx" | "csv" | "txt").</summary>
    public string Format { get; init; } = "";
    public bool OcrApplied { get; init; }
    public int PageCount { get; init; }
    public IReadOnlyList<AiDocumentExtractedPage> Pages { get; init; } = Array.Empty<AiDocumentExtractedPage>();
    public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();

    public static AiDocumentExtractionResult Ok(string text, bool truncated) =>
        new() { Success = true, Text = text, Truncated = truncated };

    public static AiDocumentExtractionResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}

public sealed record AiDocumentExtractOptions
{
    /// <summary>Si vrai, rend les pages PDF/image en PNG base64 dans la réponse (pour modèles vision).</summary>
    public bool RenderPagesAsImages { get; init; }

    /// <summary>
    /// Conserve le PNG que l'OCR a DÉJÀ dû rasteriser faute de couche texte, sans en produire de
    /// nouveau. Coût de rendu supplémentaire : zéro — l'image existe en mémoire, elle était
    /// simplement jetée.
    ///
    /// <para>Sans cela, un PDF scanné ressort avec zéro image et la politique de repli vision
    /// court-circuite avant même d'être consultée : la vision est alors structurellement
    /// inatteignable sur un scan, cas pourtant majoritaire des factures fournisseurs.</para>
    /// </summary>
    public bool KeepOcrRenderedImages { get; init; }

    /// <summary>DPI de rendu (par défaut 200, max 300).</summary>
    public int RenderDpi { get; init; } = 200;

    /// <summary>
    /// Quand les pages sont rendues en images (<see cref="RenderPagesAsImages"/>), ne lance pas
    /// l'OCR Tesseract sur les pages sans couche texte : la page est rendue une seule fois, au
    /// DPI demandé, et c'est le modèle vision qui la lit. Évite un passage OCR inutile (et lent)
    /// par page scannée lorsque l'appelant n'exploite pas le texte OCR.
    /// </summary>
    public bool SkipOcrWhenRendering { get; init; }

    /// <summary>
    /// Nombre maximal de pages PDF lues (null = limite par défaut de l'extracteur). Les pages
    /// au-delà sont ignorées et signalées dans <see cref="AiDocumentExtractionResult.Warnings"/>.
    /// </summary>
    public int? MaxPages { get; init; }

    public static AiDocumentExtractOptions Default { get; } = new();
}

public interface IAiDocumentTextExtractor
{
    /// <summary>Extracts plain text from supported formats (text/plain, PDF, images, DOCX, XLSX).</summary>
    Task<AiDocumentExtractionResult> ExtractAsync(
        Stream stream,
        string fileName,
        string contentType,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Surcharge étendue avec options (rendu des pages en PNG base64 pour les modèles vision).
    /// </summary>
    Task<AiDocumentExtractionResult> ExtractAsync(
        Stream stream,
        string fileName,
        string contentType,
        AiDocumentExtractOptions options,
        CancellationToken cancellationToken = default);
}
