using System.Diagnostics;
using System.Text;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using PdfSharp.Pdf.IO;
using PdfPigDocument = UglyToad.PdfPig.PdfDocument;
using PdfSharpDocument = PdfSharp.Pdf.PdfDocument;

namespace FactuTrust.Infrastructure.Services.DocumentImport;

/// <summary>
/// Décide si une pièce comptable doit être réduite avant lecture (Docstrange ou IA locale)
/// et, le cas échéant, produit le PDF réduit en mémoire.
/// </summary>
internal interface IInvoicePdfPageWindow
{
    InvoicePdfReading Prepare(byte[] original);
}

/// <summary>Lecteur qui a fourni le nombre de pages. Réservé au journal.</summary>
internal enum InvoicePageCountSource
{
    None,
    PdfPig,
    PdfSharp
}

/// <summary>
/// Résultat du choix de lecture. En cas d'échec de réduction, <see cref="Bytes"/> est vide :
/// l'appelant ne doit pas envoyer le fichier d'origine à la place.
/// </summary>
internal sealed class InvoicePdfReading
{
    private InvoicePdfReading()
    {
    }

    public byte[] Bytes { get; private init; } = Array.Empty<byte>();

    /// <summary>Vrai uniquement lorsque un PDF réduit a été produit.</summary>
    public bool WindowApplied { get; private init; }

    /// <summary>
    /// Vrai lorsque les octets ressemblent à un PDF mais que le nombre de pages est illisible
    /// (pièce chiffrée ou corrompue). Le fichier d'origine est alors conservé, sans prétendre
    /// qu'une fenêtre a été appliquée.
    /// </summary>
    public bool PageCountUnavailable { get; private init; }

    public int? SourcePageCount { get; private init; }

    public IReadOnlyList<int> PagesRead { get; private init; } = Array.Empty<int>();

    /// <summary>Exception technique, réservée au journal. Jamais renvoyée à l'utilisateur.</summary>
    public Exception? Failure { get; private init; }

    /// <summary>
    /// Échec du comptage uniquement (une <see cref="AggregateException"/> des deux lecteurs).
    /// Le fichier d'origine reste lisible par l'appelant, qui décide s'il peut l'envoyer.
    /// </summary>
    public Exception? CountFailure { get; private init; }

    /// <summary>Lecteur qui a compté les pages. Réservé au journal.</summary>
    public InvoicePageCountSource PageCountSource { get; private init; }

    /// <summary>Taille de la pièce reçue, en octets. Réservé au journal.</summary>
    public int OriginalByteCount { get; private init; }

    /// <summary>Taille du PDF réduit, lorsqu'une fenêtre a été appliquée. Réservé au journal.</summary>
    public int? ReducedByteCount { get; private init; }

    /// <summary>Durée de la réduction, lorsqu'elle a été tentée. Réservé au journal.</summary>
    public TimeSpan? ReductionDuration { get; private init; }

    public bool IsFailure => Failure is not null;

    public static InvoicePdfReading Passthrough(
        byte[] original,
        int? pageCount = null,
        InvoicePageCountSource source = InvoicePageCountSource.None) => new()
    {
        Bytes = original,
        SourcePageCount = pageCount,
        PageCountSource = source,
        OriginalByteCount = original.Length
    };

    public static InvoicePdfReading Unreadable(byte[] original, Exception failure) => new()
    {
        Bytes = original,
        PageCountUnavailable = true,
        CountFailure = failure,
        OriginalByteCount = original.Length
    };

    public static InvoicePdfReading Window(
        byte[] reduced,
        int pageCount,
        IReadOnlyList<int> pages,
        InvoicePageCountSource source = InvoicePageCountSource.None,
        int originalByteCount = 0,
        TimeSpan? duration = null) => new()
    {
        Bytes = reduced,
        WindowApplied = true,
        SourcePageCount = pageCount,
        PagesRead = pages,
        PageCountSource = source,
        OriginalByteCount = originalByteCount,
        ReducedByteCount = reduced.Length,
        ReductionDuration = duration
    };

    public static InvoicePdfReading Failed(
        int pageCount,
        Exception failure,
        InvoicePageCountSource source = InvoicePageCountSource.None,
        int originalByteCount = 0,
        TimeSpan? duration = null) => new()
    {
        Bytes = Array.Empty<byte>(),
        SourcePageCount = pageCount,
        Failure = failure,
        PageCountSource = source,
        OriginalByteCount = originalByteCount,
        ReductionDuration = duration
    };
}

/// <summary>
/// Réduction PdfSharp, en mémoire uniquement. Ne crée aucun fichier et ne journalise rien :
/// l'appelant décide du message utilisateur et de ce qui part au journal.
/// </summary>
internal sealed class InvoicePdfPageWindow : IInvoicePdfPageWindow
{
    private readonly Func<byte[], IReadOnlyList<int>, int, byte[]> _extractPages;
    private readonly Func<byte[], int> _countWithPdfPig;
    private readonly Func<byte[], int> _countWithPdfSharp;

    static InvoicePdfPageWindow()
    {
        // PdfSharp lit certains PDF (WinDev, polices anciennes) avec des pages de code Windows.
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public InvoicePdfPageWindow()
        : this(extractPages: null)
    {
    }

    /// <param name="extractPages">
    /// Substitut de test. La production laisse <c>null</c> et utilise <see cref="ExtractPages"/>.
    /// </param>
    /// <param name="countWithPdfPig">Substitut de test du premier lecteur de comptage.</param>
    /// <param name="countWithPdfSharp">Substitut de test du second lecteur de comptage.</param>
    internal InvoicePdfPageWindow(
        Func<byte[], IReadOnlyList<int>, int, byte[]>? extractPages,
        Func<byte[], int>? countWithPdfPig = null,
        Func<byte[], int>? countWithPdfSharp = null)
    {
        _extractPages = extractPages ?? ExtractPages;
        _countWithPdfPig = countWithPdfPig ?? CountWithPdfPig;
        _countWithPdfSharp = countWithPdfSharp ?? CountWithPdfSharp;
    }

    public InvoicePdfReading Prepare(byte[] original)
    {
        ArgumentNullException.ThrowIfNull(original);

        if (!LooksLikePdf(original))
            return InvoicePdfReading.Passthrough(original);

        if (!TryCountPages(original, out var pageCount, out var source, out var countFailure))
            return InvoicePdfReading.Unreadable(original, countFailure!);

        if (!InvoicePdfReadingWindow.RequiresWindow(pageCount))
            return InvoicePdfReading.Passthrough(original, pageCount, source);

        var pages = InvoicePdfReadingWindow.SelectPageNumbers(pageCount);
        var stopwatch = Stopwatch.StartNew();
        try
        {
            var reduced = _extractPages(original, pages, pageCount);
            stopwatch.Stop();
            return InvoicePdfReading.Window(reduced, pageCount, pages, source, original.Length, stopwatch.Elapsed);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            stopwatch.Stop();
            return InvoicePdfReading.Failed(pageCount, ex, source, original.Length, stopwatch.Elapsed);
        }
    }

    /// <summary>
    /// Compte les pages avec PdfPig, puis avec PdfSharp si PdfPig échoue. Un seul succès suffit.
    /// Un comptage non positif est traité comme un échec : on ne sait pas ce qui partirait.
    /// </summary>
    private bool TryCountPages(
        byte[] pdf,
        out int pageCount,
        out InvoicePageCountSource source,
        out Exception? failure)
    {
        Exception? pdfPigFailure;
        try
        {
            pageCount = _countWithPdfPig(pdf);
            if (pageCount > 0)
            {
                source = InvoicePageCountSource.PdfPig;
                failure = null;
                return true;
            }

            pdfPigFailure = new InvoicePdfWindowException("Comptage PdfPig non positif.");
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            pdfPigFailure = ex;
        }

        Exception? pdfSharpFailure;
        try
        {
            pageCount = _countWithPdfSharp(pdf);
            if (pageCount > 0)
            {
                source = InvoicePageCountSource.PdfSharp;
                failure = null;
                return true;
            }

            pdfSharpFailure = new InvoicePdfWindowException("Comptage PdfSharp non positif.");
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            pdfSharpFailure = ex;
        }

        pageCount = 0;
        source = InvoicePageCountSource.None;
        failure = new AggregateException("Nombre de pages illisible.", pdfPigFailure, pdfSharpFailure);
        return false;
    }

    private static int CountWithPdfPig(byte[] pdf)
    {
        using var document = PdfPigDocument.Open(pdf);
        return document.NumberOfPages;
    }

    /// <summary>Second lecteur. Flux en lecture seule : le tableau d'origine reste intact.</summary>
    private static int CountWithPdfSharp(byte[] pdf)
    {
        using var stream = new MemoryStream(pdf, writable: false);
        using var document = PdfReader.Open(stream, PdfDocumentOpenMode.Import);
        return document.PageCount;
    }

    /// <summary>
    /// Copie les pages demandées dans un nouveau PDF. Le tableau d'origine n'est pas modifié :
    /// PdfSharp reçoit une copie du flux.
    /// </summary>
    private static byte[] ExtractPages(byte[] pdf, IReadOnlyList<int> pageNumbers, int expectedPageCount)
    {
        using var inputStream = new MemoryStream(pdf.Length);
        inputStream.Write(pdf, 0, pdf.Length);
        inputStream.Position = 0;

        using var input = PdfReader.Open(inputStream, PdfDocumentOpenMode.Import);
        if (input.PageCount != expectedPageCount)
        {
            throw new InvoicePdfWindowException(
                $"Comptage de pages divergent (lecture {expectedPageCount}, ouverture {input.PageCount}).");
        }

        using var output = new PdfSharpDocument();
        foreach (var pageNumber in pageNumbers)
        {
            if (pageNumber < 1 || pageNumber > input.PageCount)
            {
                throw new InvoicePdfWindowException(
                    $"Page {pageNumber} hors document de {input.PageCount} pages.");
            }

            output.AddPage(input.Pages[pageNumber - 1]);
        }

        using var buffer = new MemoryStream();
        output.Save(buffer, closeStream: false);
        return buffer.ToArray();
    }

    private static bool LooksLikePdf(byte[] bytes) =>
        bytes.Length >= 5
        && bytes[0] == 0x25 && bytes[1] == 0x50 && bytes[2] == 0x44 && bytes[3] == 0x46;

    private sealed class InvoicePdfWindowException : Exception
    {
        public InvoicePdfWindowException(string safeDetail)
            : base(safeDetail)
        {
        }
    }
}
