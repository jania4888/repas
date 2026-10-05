using System.Globalization;

namespace FactuTrust.Application.Features.Reports;

/// <summary>
/// Libellés FR/AR du journal d'achats commercial. Le français reste celui déjà imprimé.
/// La culture vient de <see cref="CultureInfo.CurrentUICulture"/> (en-tête X-UI-Locale), jamais d'un paramètre libre.
/// </summary>
public static class PurchasesJournalLabels
{
    public static bool IsArabic =>
        string.Equals(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName, "ar", StringComparison.OrdinalIgnoreCase);

    public static string Title() => IsArabic ? "يومية المشتريات" : "Journal d'achats";

    public static string Source(PurchasesJournalSource source) => source switch
    {
        PurchasesJournalSource.PurchaseReceipt => IsArabic ? "وصولات الاستلام" : "Bons de réception",
        _ => IsArabic ? "فواتير المزوّدين" : "Factures fournisseur"
    };

    public static string ViewMode(SalesJournalViewMode mode) => mode switch
    {
        SalesJournalViewMode.Day => IsArabic ? "حسب اليوم" : "Par jour",
        SalesJournalViewMode.Month => IsArabic ? "حسب الشهر" : "Par mois",
        SalesJournalViewMode.Year => IsArabic ? "حسب السنة" : "Par année",
        _ => IsArabic ? "تفصيل" : "Détail"
    };

    public static string Period(DateTime from, DateTime to)
    {
        var start = from.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        var end = to.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        return IsArabic ? $"من {start} إلى {end}" : $"Du {start} au {end}";
    }

    public static string SourceLine(string sourceLabel) =>
        IsArabic ? $"المصدر : {sourceLabel}" : $"Source : {sourceLabel}";

    public static string ModeLine(string modeLabel) =>
        IsArabic ? $"الوضع : {modeLabel}" : $"Mode : {modeLabel}";

    public static string SupplierLine(string name) =>
        IsArabic ? $"المزوّد : {name}" : $"Fournisseur : {name}";

    public static string CompanyFallback() => IsArabic ? "الشركة" : "Société";

    public static string Matricule() => IsArabic ? "المعرف الجبائي" : "Matricule fiscal";

    public static string CurrencyCaption() => IsArabic ? "بالدينار التونسي" : "exprimé en Dinars";

    public static string PrintedOn() => IsArabic ? "حُرّر في" : "Édité le";

    public static string Page() => IsArabic ? "صفحة" : "Page";

    public static string DocumentKind(string kind) =>
        kind == "BR"
            ? (IsArabic ? "وصل استلام" : "Bon de réception")
            : (IsArabic ? "فاتورة" : "Facture");

    public static IReadOnlyList<string> DetailColumns() => IsArabic
        ? new[] { "التاريخ", "رقم الوثيقة", "النوع", "المزوّد", "الرمز", "المنتَج", "الكمية", "س.و.", "HT", "TVA", "TTC" }
        : new[] { "Date", "N° pièce", "Type", "Fournisseur", "Code", "Produit", "Qté", "P.U.", "HT", "TVA", "TTC" };

    public static IReadOnlyList<string> AggregatedColumns() => IsArabic
        ? new[] { "الفترة", "المزوّد", "الرمز", "المنتَج", "الكمية", "HT", "TVA", "TTC" }
        : new[] { "Période", "Fournisseur", "Code", "Produit", "Qté", "HT", "TVA", "TTC" };

    public static string TotalQuantity() => IsArabic ? "مجموع الكمية" : "Total quantité";

    public static string TotalHt() => IsArabic ? "المجموع HT" : "Total HT";

    public static string TotalVat() => IsArabic ? "المجموع TVA" : "Total TVA";

    public static string TotalTtc() => IsArabic ? "المجموع TTC" : "Total TTC";
}
