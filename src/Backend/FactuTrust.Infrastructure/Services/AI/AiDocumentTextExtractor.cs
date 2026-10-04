using System.Text;
using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI;
using Microsoft.Extensions.Logging;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.DocumentLayoutAnalysis.PageSegmenter;
using UglyToad.PdfPig.DocumentLayoutAnalysis.WordExtractor;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Extrait le texte de pièces jointes (TXT/CSV/PDF/images/DOCX/XLSX) pour l'Assistant IA.
/// PDF : pipeline layout-aware (NearestNeighbourWordExtractor + DocstrumBoundingBoxes)
/// avec fallback OCR (Tesseract) pour les pages scannées.
/// Images : OCR Tesseract direct.
/// DOCX : DocumentFormat.OpenXml.
/// XLSX : ClosedXML.
/// </summary>
public sealed class AiDocumentTextExtractor : IAiDocumentTextExtractor
{
    private const int MaxChars = 200_000;
    /// <summary>Limite de pages par défaut ; surchargeable par <see cref="AiDocumentExtractOptions.MaxPages"/>.</summary>
    internal const int DefaultMaxPages = 50;
    private const string OcrLanguages = "fra+eng+ara";

    private readonly ILogger<AiDocumentTextExtractor> _logger;
    private readonly IAiPdfRenderer _pdfRenderer;
    private readonly IAiOcrService _ocr;
    private readonly IImagePreprocessingService _imagePreprocessing;

    public AiDocumentTextExtractor(
        ILogger<AiDocumentTextExtractor> logger,
        IAiPdfRenderer pdfRenderer,
        IAiOcrService ocr,
        IImagePreprocessingService imagePreprocessing)
    {
        _logger = logger;
        _pdfRenderer = pdfRenderer;
        _ocr = ocr;
        _imagePreprocessing = imagePreprocessing;
    }

    public Task<AiDocumentExtractionResult> ExtractAsync(
        Stream stream, string fileName, string contentType, CancellationToken cancellationToken = default)
        => ExtractAsync(stream, fileName, contentType, AiDocumentExtractOptions.Default, cancellationToken);

    public async Task<AiDocumentExtractionResult> ExtractAsync(
        Stream stream,
        string fileName,
        string contentType,
        AiDocumentExtractOptions options,
        CancellationToken cancellationToken = default)
    {
        var safeFileName = fileName ?? string.Empty;
        var ct = (contentType ?? "").ToLowerInvariant();
        var ext = Path.GetExtension(safeFileName).ToLowerInvariant();
        var opts = options ?? AiDocumentExtractOptions.Default;
        var dpi = Math.Clamp(opts.RenderDpi, 72, 300);
        var ocrDpi = Math.Clamp(Math.Min(dpi, 150), 72, 150);

        try
        {
            if (ct.StartsWith("text/", StringComparison.Ordinal) || ext is ".txt" or ".csv")
            {
                using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
                var text = await reader.ReadToEndAsync(cancellationToken);
                return BuildSimpleTextResult(text, ext == ".csv" ? "csv" : "txt");
            }

            if (IsImage(ct, ext))
            {
                using var ms = new MemoryStream();
                await stream.CopyToAsync(ms, cancellationToken);
                return await ExtractImageAsync(ms.ToArray(), safeFileName, opts.RenderPagesAsImages, cancellationToken);
            }

            if (ct.Contains("pdf", StringComparison.Ordinal) || ext == ".pdf")
            {
                using var ms = new MemoryStream();
                await stream.CopyToAsync(ms, cancellationToken);
                var bytes = ms.ToArray();
                var maxPages = opts.MaxPages is > 0 ? opts.MaxPages.Value : DefaultMaxPages;
                return await ExtractPdfAsync(
                    bytes, safeFileName, opts.RenderPagesAsImages, opts.KeepOcrRenderedImages,
                    dpi, ocrDpi, maxPages, opts.SkipOcrWhenRendering, cancellationToken);
            }

            if (IsDocx(ct, ext))
            {
                using var ms = new MemoryStream();
                await stream.CopyToAsync(ms, cancellationToken);
                return ExtractDocx(ms, safeFileName);
            }

            if (IsXlsx(ct, ext))
            {
                using var ms = new MemoryStream();
                await stream.CopyToAsync(ms, cancellationToken);
                return ExtractXlsx(ms, safeFileName);
            }

            return AiDocumentExtractionResult.Fail(
                "Format non pris en charge. Formats acceptés : .txt, .csv, .pdf, .png, .jpg, .jpeg, .webp, .docx, .xlsx.");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Document text extraction failed for {FileName}", safeFileName);
            return AiDocumentExtractionResult.Fail("Impossible d'extraire le texte de ce document.");
        }
    }

    private static bool IsImage(string contentType, string extension)
    {
        if (contentType.StartsWith("image/", StringComparison.Ordinal))
        {
            return true;
        }
        return extension is ".png" or ".jpg" or ".jpeg" or ".webp" or ".bmp" or ".tif" or ".tiff";
    }

    private static bool IsDocx(string contentType, string extension)
    {
        return extension == ".docx"
            || contentType.Contains("openxmlformats-officedocument.wordprocessingml", StringComparison.Ordinal);
    }

    private static bool IsXlsx(string contentType, string extension)
    {
        return extension is ".xlsx" or ".xlsm"
            || contentType.Contains("openxmlformats-officedocument.spreadsheetml", StringComparison.Ordinal);
    }

    private async Task<AiDocumentExtractionResult> ExtractImageAsync(
        byte[] bytes, string fileName, bool renderImages, CancellationToken cancellationToken)
    {
        var preprocessed = _imagePreprocessing.PreprocessForOcr(bytes);
        var imageBase64 = Convert.ToBase64String(preprocessed);

        var warnings = new List<string>();
        var ocrApplied = false;
        string safeText;

        if (!_ocr.IsAvailable)
        {
            _logger.LogInformation(
                "OCR indisponible pour image {FileName} ; l'image sera transmise au fallback vision si configuré.",
                fileName);
            warnings.Add(
                "Reconnaissance optique indisponible sur le serveur (tessdata manquant). "
                + "Un modèle vision d'import sera utilisé si configuré.");
            safeText = string.Empty;
        }
        else
        {
            var text = await _ocr.RecognizeAsync(preprocessed, OcrLanguages, cancellationToken);
            ocrApplied = true;
            _logger.LogDebug(
                "OCR image {FileName} : {CharCount} caractères, score={Score:F2}",
                fileName, text.Length, InvoiceImportOcrQuality.Score(text));

            if (string.IsNullOrWhiteSpace(text))
            {
                warnings.Add(
                    "Aucun texte détecté par OCR sur cette photo. Un modèle vision d'import sera utilisé si configuré.");
                safeText = string.Empty;
            }
            else
            {
                var truncated = TruncateString(text, out safeText);
                var pages = BuildImagePages(safeText, imageBase64, ocrApplied);
                return new AiDocumentExtractionResult
                {
                    Success = true,
                    Text = safeText,
                    Truncated = truncated,
                    Format = "image",
                    OcrApplied = ocrApplied,
                    PageCount = 1,
                    Pages = pages,
                    Warnings = warnings
                };
            }
        }

        var emptyPages = BuildImagePages(string.Empty, imageBase64, ocrApplied);
        return new AiDocumentExtractionResult
        {
            Success = true,
            Text = string.Empty,
            Truncated = false,
            Format = "image",
            OcrApplied = ocrApplied,
            PageCount = 1,
            Pages = emptyPages,
            Warnings = warnings
        };
    }

    private static List<AiDocumentExtractedPage> BuildImagePages(
        string safeText, string imageBase64, bool ocrApplied) =>
    [
        new()
        {
            PageIndex = 0,
            Text = safeText,
            ImageBase64 = imageBase64,
            OcrApplied = ocrApplied
        }
    ];

    /// <summary>
    /// Décide si le PNG d'une page doit être conservé en base64.
    ///
    /// <para><paramref name="png"/> n'est non nul que dans deux cas : la vision a été demandée, ou
    /// la page était sans couche texte et a dû être rasterisée pour l'OCR. Sur le chemin nominal
    /// (PDF à couche texte, vision non demandée), rien n'est rendu, donc rien n'est encodé : c'est
    /// la garantie de performance du cas courant.</para>
    ///
    /// <para>La qualité est un compromis assumé : l'image récupérée via l'OCR a été rendue à
    /// <c>ocrDpi</c> (150) et non à <c>dpi</c> (200). La rerendre coûterait une seconde
    /// rasterisation de chaque page scannée pour un gain nul — les modèles vision redimensionnent
    /// l'entrée de toute façon.</para>
    /// </summary>
    internal static string? BuildPageImageBase64(byte[]? png, bool renderImages, bool keepOcrImages) =>
        png is not null && (renderImages || keepOcrImages) ? Convert.ToBase64String(png) : null;

    private async Task<AiDocumentExtractionResult> ExtractPdfAsync(
        byte[] bytes, string fileName, bool renderImages, bool keepOcrImages,
        int dpi, int ocrDpi, int maxPages, bool skipOcrWhenRendering, CancellationToken cancellationToken)
    {
        // L'OCR Tesseract ne sert à rien quand l'appelant rend les pages pour un modèle vision et
        // ne consomme pas le texte OCR : on l'évite (une rastérisation par page au lieu de deux).
        var ocrEnabled = !(skipOcrWhenRendering && renderImages);
        PdfDocument document;
        try
        {
            document = PdfDocument.Open(bytes);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to open PDF {FileName}", fileName);
            return AiDocumentExtractionResult.Fail(
                "PDF illisible : fichier corrompu, protégé par mot de passe ou format non supporté.");
        }

        using (document)
        {
            var sb = new StringBuilder();
            var pageCount = document.NumberOfPages;
            var pagesToProcess = Math.Min(pageCount, maxPages);
            var truncatedByPageLimit = pageCount > maxPages;
            var ocrAppliedAtLeastOnce = false;
            var warnings = new List<string>();
            var pages = new List<AiDocumentExtractedPage>(pagesToProcess);

            for (var i = 1; i <= pagesToProcess; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                string pageText;
                bool ocrThisPage = false;
                AiRenderedPage? rendered = null;

                try
                {
                    var page = document.GetPage(i);
                    pageText = ExtractPageTextLayoutAware(page);

                    if (ocrEnabled && string.IsNullOrWhiteSpace(pageText) && _pdfRenderer.IsAvailable && _ocr.IsAvailable)
                    {
                        rendered = await _pdfRenderer.RenderPageAsync(bytes, i - 1, ocrDpi, cancellationToken);
                        if (rendered is not null)
                        {
                            var ocrText = await _ocr.RecognizeAsync(rendered.PngBytes, OcrLanguages, cancellationToken);
                            if (!string.IsNullOrWhiteSpace(ocrText))
                            {
                                pageText = ocrText;
                                ocrThisPage = true;
                                ocrAppliedAtLeastOnce = true;
                            }
                        }
                    }

                    // Si vision demandée et qu'on n'a pas encore rendu la page : la rendre maintenant
                    if (renderImages && rendered is null && _pdfRenderer.IsAvailable)
                    {
                        rendered = await _pdfRenderer.RenderPageAsync(bytes, i - 1, dpi, cancellationToken);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to extract page {PageIndex} of {FileName}", i, fileName);
                    pageText = string.Empty;
                    warnings.Add($"Page {i} : extraction échouée.");
                }

                pages.Add(new AiDocumentExtractedPage
                {
                    PageIndex = i - 1,
                    Text = pageText ?? string.Empty,
                    OcrApplied = ocrThisPage,
                    ImageBase64 = BuildPageImageBase64(rendered?.PngBytes, renderImages, keepOcrImages),
                    Width = rendered?.Width,
                    Height = rendered?.Height
                });

                if (pagesToProcess > 1)
                {
                    if (sb.Length > 0) sb.AppendLine();
                    sb.Append("--- Page ").Append(i);
                    if (ocrThisPage) sb.Append(" (OCR)");
                    sb.AppendLine(" ---");
                }

                if (!string.IsNullOrWhiteSpace(pageText))
                {
                    sb.AppendLine(pageText);
                }
            }

            if (truncatedByPageLimit)
            {
                var msg = $"Document tronqué : {pageCount} pages au total, seules les {maxPages} premières ont été lues.";
                warnings.Add(msg);
                sb.AppendLine();
                sb.Append('[').Append(msg).AppendLine("]");
            }

            if (ocrAppliedAtLeastOnce)
            {
                warnings.Add("OCR appliqué sur au moins une page scannée — la précision peut être réduite.");
                sb.Insert(0, "[OCR appliqué sur au moins une page scannée]\n\n");
            }

            var truncatedByChars = TruncateString(sb.ToString(), out var fullText);
            if (truncatedByChars)
            {
                warnings.Add($"Texte tronqué à {MaxChars} caractères.");
            }

            return new AiDocumentExtractionResult
            {
                Success = true,
                Text = fullText,
                Truncated = truncatedByChars || truncatedByPageLimit,
                Format = "pdf",
                OcrApplied = ocrAppliedAtLeastOnce,
                PageCount = pagesToProcess,
                Pages = pages,
                Warnings = warnings
            };
        }
    }

    /// <summary>
    /// Extrait le texte d'une page en réinsérant correctement les espaces entre glyphes
    /// (NearestNeighbourWordExtractor) puis en ordonnant les blocs en ordre de lecture
    /// humain (DocstrumBoundingBoxes). En dernier recours, fallback sur page.Text.
    /// </summary>
    private string ExtractPageTextLayoutAware(Page page)
    {
        try
        {
            var letters = page.Letters;
            if (letters is null || letters.Count == 0)
            {
                return string.Empty;
            }

            var words = NearestNeighbourWordExtractor.Instance.GetWords(letters);
            var blocks = DocstrumBoundingBoxes.Instance.GetBlocks(words);

            if (blocks is null || blocks.Count == 0)
            {
                return string.Join(" ", words.Select(w => w.Text));
            }

            var sb = new StringBuilder();
            foreach (var block in blocks)
            {
                if (sb.Length > 0) sb.Append("\n\n");
                sb.Append(block.Text);
            }
            return sb.ToString();
        }
        catch (Exception)
        {
            return page.Text ?? string.Empty;
        }
    }

    private AiDocumentExtractionResult ExtractDocx(MemoryStream ms, string fileName)
    {
        try
        {
            ms.Position = 0;
            using var doc = WordprocessingDocument.Open(ms, false);
            var body = doc.MainDocumentPart?.Document?.Body;
            if (body is null)
            {
                return AiDocumentExtractionResult.Fail("Document Word vide ou illisible.");
            }

            var sb = new StringBuilder();
            foreach (var element in body.ChildElements)
            {
                switch (element)
                {
                    case Paragraph p:
                        AppendParagraph(sb, p);
                        break;
                    case Table t:
                        AppendTable(sb, t);
                        break;
                }
            }
            return BuildSimpleTextResult(sb.ToString(), "docx");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DOCX extraction failed for {FileName}", fileName);
            return AiDocumentExtractionResult.Fail("Impossible de lire ce document Word.");
        }
    }

    private static void AppendParagraph(StringBuilder sb, Paragraph p)
    {
        var text = p.InnerText;
        if (!string.IsNullOrWhiteSpace(text))
        {
            sb.AppendLine(text);
        }
        else
        {
            sb.AppendLine();
        }
    }

    private static void AppendTable(StringBuilder sb, Table table)
    {
        foreach (var row in table.Elements<TableRow>())
        {
            var cells = row.Elements<TableCell>()
                .Select(c => (c.InnerText ?? string.Empty).Replace('\t', ' ').Trim());
            sb.AppendLine(string.Join("\t", cells));
        }
        sb.AppendLine();
    }

    private AiDocumentExtractionResult ExtractXlsx(MemoryStream ms, string fileName)
    {
        try
        {
            ms.Position = 0;
            using var workbook = new XLWorkbook(ms);
            var sb = new StringBuilder();
            foreach (var ws in workbook.Worksheets)
            {
                sb.Append("=== Feuille : ").Append(ws.Name).AppendLine(" ===");
                var used = ws.RangeUsed();
                if (used is null)
                {
                    sb.AppendLine("(feuille vide)");
                    continue;
                }
                foreach (var row in used.RowsUsed())
                {
                    var cells = row.Cells().Select(c =>
                    {
                        var v = c.GetFormattedString();
                        return (v ?? string.Empty).Replace('\t', ' ').Replace('\n', ' ').Trim();
                    });
                    sb.AppendLine(string.Join("\t", cells));
                }
                sb.AppendLine();
            }
            return BuildSimpleTextResult(sb.ToString(), "xlsx");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "XLSX extraction failed for {FileName}", fileName);
            return AiDocumentExtractionResult.Fail("Impossible de lire ce classeur Excel.");
        }
    }

    private static AiDocumentExtractionResult BuildSimpleTextResult(string text, string format)
    {
        var truncated = TruncateString(text, out var safeText);
        return new AiDocumentExtractionResult
        {
            Success = true,
            Text = safeText,
            Truncated = truncated,
            Format = format,
            PageCount = 1,
            Pages = new[]
            {
                new AiDocumentExtractedPage { PageIndex = 0, Text = safeText }
            }
        };
    }

    private static bool TruncateString(string text, out string result)
    {
        var t = (text ?? string.Empty).Trim();
        if (t.Length <= MaxChars)
        {
            result = t;
            return false;
        }
        result = t[..MaxChars] + "\n…";
        return true;
    }
}
