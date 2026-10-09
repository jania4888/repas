namespace FactuTrust.Application.Features.Accounting.DocumentImport;

/// <summary>
/// Pages lues lorsqu'une pièce PDF est analysée pour proposer une écriture.
/// Une pièce de plus de <see cref="PageCountThreshold"/> pages n'est pas lue en entier :
/// seules les <see cref="FirstPages"/> premières et les <see cref="LastPages"/> dernières
/// pages partent à l'analyse. Le fichier d'origine n'est pas modifié.
/// </summary>
public static class InvoicePdfReadingWindow
{
    /// <summary>Jusqu'à ce nombre de pages inclus, la pièce est lue en entier.</summary>
    public const int PageCountThreshold = 6;

    /// <summary>Pages de tête conservées (en-tête, tiers, numéro, date).</summary>
    public const int FirstPages = 2;

    /// <summary>Pages de fin conservées (récapitulatif TVA, HT, TTC).</summary>
    public const int LastPages = 3;

    /// <summary>
    /// Message stable lorsqu'on sait que la pièce dépasse le seuil mais que le PDF réduit
    /// n'a pas pu être produit. Aucun détail technique : le fichier complet ne doit pas partir
    /// à la place.
    /// </summary>
    public const string ReductionFailedMessage =
        "Cette pièce dépasse 6 pages, mais sa réduction aux pages à lire a échoué. "
        + "Saisissez l'écriture manuellement.";

    /// <summary>Vrai lorsque la pièce a trop de pages pour être lue en entier.</summary>
    public static bool RequiresWindow(int pageCount) => pageCount > PageCountThreshold;

    /// <summary>
    /// Numéros de pages à lire, en base 1, dans l'ordre du document.
    /// De 1 à <see cref="PageCountThreshold"/> pages : toutes. Au-delà : 1, 2, puis les trois dernières.
    /// Un comptage non positif ne désigne aucune page.
    /// </summary>
    public static IReadOnlyList<int> SelectPageNumbers(int pageCount)
    {
        if (pageCount <= 0)
            return Array.Empty<int>();

        if (!RequiresWindow(pageCount))
        {
            var all = new int[pageCount];
            for (var i = 0; i < pageCount; i++)
                all[i] = i + 1;
            return all;
        }

        // Le plus petit document réduit (seuil + 1) doit contenir les deux plages sans doublon.
        if (pageCount < FirstPages + LastPages)
            throw new InvalidOperationException("Fenêtre de pages incohérente.");

        var pages = new int[FirstPages + LastPages];
        for (var i = 0; i < FirstPages; i++)
            pages[i] = i + 1;

        var lastStart = pageCount - LastPages + 1;
        for (var i = 0; i < LastPages; i++)
            pages[FirstPages + i] = lastStart + i;

        return pages;
    }

    /// <summary>
    /// Avertissement affiché à l'utilisateur après une réduction réussie. Les numéros sont ceux
    /// réellement lus, pas une formule. Produit par le serveur, indépendamment du modèle.
    /// </summary>
    public static string DescribeSkippedPages(int pageCount, IReadOnlyList<int> pagesRead)
    {
        ArgumentNullException.ThrowIfNull(pagesRead);

        return $"Cette pièce compte {pageCount} pages. Seules les pages {FormatPageList(pagesRead)} ont été lues. "
            + "Les pages intermédiaires n'ont pas été analysées : contrôlez le détail avant d'enregistrer.";
    }

    private static string FormatPageList(IReadOnlyList<int> pages)
    {
        if (pages.Count == 0)
            return string.Empty;
        if (pages.Count == 1)
            return pages[0].ToString(System.Globalization.CultureInfo.InvariantCulture);

        var head = string.Join(
            ", ",
            pages.Take(pages.Count - 1).Select(p => p.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        var last = pages[^1].ToString(System.Globalization.CultureInfo.InvariantCulture);
        return $"{head} et {last}";
    }
}
