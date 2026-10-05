using System.Globalization;
using FactuTrust.Application.DTOs;

namespace FactuTrust.Application.Features.Reports;

/// <summary>
/// Libellés FR/AR de l'état de stock courant uniquement. Le français reprend les textes
/// historiques au caractère près. La langue vient de <see cref="CultureInfo.CurrentUICulture"/>
/// (en-tête X-UI-Locale), jamais d'un paramètre libre.
/// </summary>
public static class StockStatusLabels
{
    public static bool IsArabic =>
        string.Equals(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName, "ar", StringComparison.OrdinalIgnoreCase);

    public static string Title() => IsArabic ? "حالة المخزون" : "État de stock";

    public static string GroupingMode(StockStatusGroupingMode mode) =>
        mode == StockStatusGroupingMode.CategoryThenWarehouse
            ? GroupingCategoryThenWarehouse()
            : GroupingWarehouseThenCategory();

    public static string GroupingWarehouseThenCategory() =>
        IsArabic ? "حسب المستودع ثم الفئة" : "Par entrepôt puis catégorie";

    public static string GroupingCategoryThenWarehouse() =>
        IsArabic ? "حسب الفئة ثم المستودع" : "Par catégorie puis entrepôt";

    public static string Warehouse() => IsArabic ? "المستودع" : "Entrepôt";

    public static string Category() => IsArabic ? "الفئة" : "Catégorie";

    public static string Search() => IsArabic ? "البحث" : "Recherche";

    public static string IncludesZeroStock() => IsArabic ? "يشمل المخزون الصفري" : "Inclut stock à zéro";

    public static string Uncategorized() =>
        IsArabic ? "بدون فئة" : StockStatusReportConstants.UncategorizedLabel;

    public static string Code() => IsArabic ? "الرمز" : "Code";

    public static string Designation() => IsArabic ? "التسمية" : "Désignation";

    public static string Quantity() => IsArabic ? "الكمية" : "Qté";

    public static string UnitPrice() => IsArabic ? "س.و." : "P.U.";

    public static string Value() => IsArabic ? "القيمة" : "Valeur";

    public static string Subtotal() => IsArabic ? "المجموع الجزئي" : "Sous-total";

    public static string Total() => IsArabic ? "المجموع" : "Total";

    public static string GrandTotal() => IsArabic ? "المجموع العام" : "Total général";

    public static string ValuationNote() => IsArabic
        ? "التقييم حسب متوسط الكلفة المرجّح المعروض (متوسط الكلفة / طبقة FIFO-LIFO)."
        : "Valorisation au coût moyen pondéré affiché (CMUP / couche FIFO-LIFO).";

    public static string CompanyFallback() => IsArabic ? "الشركة" : "Société";

    public static string Matricule() => IsArabic ? "المعرف الجبائي" : "Matricule fiscal";

    public static string CurrencyCaption() => IsArabic ? "بالدينار التونسي" : "exprimé en Dinars";

    public static string PrintedOn() => IsArabic ? "حُرّر في" : "Édité le";

    public static string Page() => IsArabic ? "صفحة" : "Page";

    public static string AsOf(DateTime generatedAtLocal)
    {
        var stamp = generatedAtLocal.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);
        return IsArabic ? $"في {stamp}" : $"Au {stamp}";
    }

    public static string Empty() => IsArabic
        ? "لا توجد أصناف في المخزون لهذه المعايير."
        : StockStatusReportConstants.EmptyReportMessage;

    public static string TooManyLines() => IsArabic
        ? "عدد الأسطر كبير. صفّوا حسب المستودع أو الفئة قبل الطباعة."
        : StockStatusReportConstants.TooManyLinesForPdfMessage;

    public static string WarehouseDisabled() => IsArabic
        ? "هذا المستودع معطّل."
        : "Cet entrepôt est désactivé.";

    public static string SubtotalLine(string name) => $"{Subtotal()} {name}";

    public static string TotalLine(string name) => $"{Total()} {name}";
}
