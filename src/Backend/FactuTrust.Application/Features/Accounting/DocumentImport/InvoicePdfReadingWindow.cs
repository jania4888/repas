namespace FactuTrust.Application.Features.Accounting.DocumentImport;

/// <summary>
/// Pages lues lorsqu'une pièce PDF est analysée pour proposer une écriture.
/// Une pièce de plus de <see cref="MaxPagesWithoutWindow"/> pages (donc à partir de 6 pages)
/// n'est pas lue en entier :
/// seules les <see cref="FirstPages"/> premières et les <see cref="LastPages"/> dernières
/// pages partent à l'analyse. Le fichier d'origine n'est pas modifié.
/// </summary>
public static class InvoicePdfReadingWindow
{
    /// <summary>
    /// Nombre maximal de pages lues en entier. Au-delà (à partir de 6 pages), la fenêtre
    /// <see cref="FirstPages"/> + <see cref="LastPages"/> s'applique. Cette valeur ne doit pas
    /// dépasser le seuil de la voie synchrone Docstrange (<c>DocStrange:SyncPageThreshold</c>) :
    /// un test d'invariant le vérifie.
    /// </summary>
    public const int MaxPagesWithoutWindow = 5;

    /// <summary>Pages de tête conservées (en-tête, tiers, numéro, date).</summary>
    public const int FirstPages = 2;

    /// <summary>Pages de fin conservées (récapitulatif TVA, HT, TTC).</summary>
    public const int LastPages = 3;

    /// <summary>
    /// Message stable lorsqu'on sait que la pièce dépasse le seuil mais que le PDF réduit
    /// n'a pas pu être produit. Aucun détail technique : le fichier complet ne doit pas partir
    /// à la place.
    /// </summary>
    public static readonly string ReductionFailedMessage =
        $"Cette pièce compte {MaxPagesWithoutWindow + 1} pages ou plus, mais sa réduction aux pages à lire a échoué. "
        + "Saisissez l'écriture manuellement.";

    /// <summary>
    /// Message stable lorsque le nombre de pages d'un PDF est illisible (pièce protégée par mot de
    /// passe ou endommagée) alors que le service d'extraction documentaire est actif : rien n'est
    /// envoyé, car on ne peut pas garantir que seules les pages autorisées partiraient.
    /// </summary>
    public const string PageCountUnavailableMessage =
        "Le nombre de pages de cette pièce n'a pas pu être lu : elle est peut-être protégée par mot de passe "
        + "ou endommagée. Le service d'extraction documentaire ne reçoit que des pièces dont la pagination "
        + "est connue. Fournissez un PDF non protégé ou saisissez l'écriture manuellement.";

    /// <summary>Message stable lorsque le budget de délai propre à l'import de pièce est épuisé.</summary>
    public const string ExternalBudgetExceededMessage =
        "Le service d'extraction documentaire n'a pas répondu dans le délai imparti. "
        + "Réessayez, ou saisissez l'écriture manuellement.";

    /// <summary>Vrai lorsque la pièce a trop de pages pour être lue en entier.</summary>
    public static bool RequiresWindow(int pageCount) => pageCount > MaxPagesWithoutWindow;

    /// <summary>
    /// Numéros de pages à lire, en base 1, dans l'ordre du document.
    /// De 1 à <see cref="MaxPagesWithoutWindow"/> pages : toutes. Au-delà : 1, 2, puis les trois dernières.
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

        // Filet de sécurité : le plus petit document réduit (MaxPagesWithoutWindow + 1) doit
        // contenir les deux plages sans doublon, même si FirstPages/LastPages changent un jour.
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

        var read = new HashSet<int>(pagesRead);
        var skipped = Enumerable.Range(1, Math.Max(pageCount, 0)).Where(p => !read.Contains(p)).ToList();
        var skippedSentence = skipped.Count == 1
            ? $"La page {FormatPageList(skipped)} n'a pas été analysée : contrôlez le détail avant d'enregistrer."
            : "Les pages intermédiaires n'ont pas été analysées : contrôlez le détail avant d'enregistrer.";

        return $"Cette pièce compte {pageCount} pages. Seules les pages {FormatPageList(pagesRead)} ont été lues. "
            + skippedSentence;
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
