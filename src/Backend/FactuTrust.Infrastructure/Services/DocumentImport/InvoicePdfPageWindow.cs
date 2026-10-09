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

    /// <summary>Échec du comptage uniquement. Le fichier d'origine reste lisible par l'appelant.</summary>
    public Exception? CountFailure { get; private init; }

    public bool IsFailure => Failure is not null;

    public static InvoicePdfReading Passthrough(byte[] original, int? pageCount = null) => new()
    {
        Bytes = original,
        SourcePageCount = pageCount
    };

    public static InvoicePdfReading Unreadable(byte[] original, Exception failure) => new()
    {
        Bytes = original,
        PageCountUnavailable = true,
        CountFailure = failure
    };

    public static InvoicePdfReading Window(byte[] reduced, int pageCount, IReadOnlyList<int> pages) => new()
    {
        Bytes = reduced,
        WindowApplied = true,
        SourcePageCount = pageCount,
        PagesRead = pages
    };

    public static InvoicePdfReading Failed(int pageCount, Exception failure) => new()
    {
        Bytes = Array.Empty<byte>(),
        SourcePageCount = pageCount,
        Failure = failure
    };
}

/// <summary>
/// Réduction PdfSharp, en mémoire uniquement. Ne crée aucun fichier et ne journalise rien :
/// l'appelant décide du message utilisateur et de ce qui part au journal.
/// </summary>
internal sealed class InvoicePdfPageWindow : IInvoicePdfPageWindow
{
    private readonly Func<byte[], IReadOnlyList<int>, int, byte[]> _extractPages;

    public InvoicePdfPageWindow()
        : this(extractPages: null)
    {
    }

    /// <param name="extractPages">
    /// Substitut de test. La production laisse <c>null</c> et utilise <see cref="ExtractPages"/>.
    /// </param>
    internal InvoicePdfPageWindow(Func<byte[], IReadOnlyList<int>, int, byte[]>? extractPages)
    {
        _extractPages = extractPages ?? ExtractPages;
    }

    public InvoicePdfReading Prepare(byte[] original)
    {
        ArgumentNullException.ThrowIfNull(original);

        if (!LooksLikePdf(original))
            return InvoicePdfReading.Passthrough(original);

        int pageCount;
        try
        {
            pageCount = CountPages(original);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return InvoicePdfReading.Unreadable(original, ex);
        }

        if (!InvoicePdfReadingWindow.RequiresWindow(pageCount))
            return InvoicePdfReading.Passthrough(original, pageCount);

        var pages = InvoicePdfReadingWindow.SelectPageNumbers(pageCount);
        try
        {
            var reduced = _extractPages(original, pages, pageCount);
            return InvoicePdfReading.Window(reduced, pageCount, pages);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return InvoicePdfReading.Failed(pageCount, ex);
        }
    }

    private static int CountPages(byte[] pdf)
    {
        using var document = PdfPigDocument.Open(pdf);
        return document.NumberOfPages;
    }

    /// <summary>
    /// Copie les pages demandées dans un nouveau PDF. Le tableau d'origine n'est pas modifié :
    /// PdfSharp reçoit une copie du flux.
    /// </summary>
    private static byte[] ExtractPages(byte[] pdf, IReadOnlyList<int> pageNumbers, int expectedPageCount)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

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
