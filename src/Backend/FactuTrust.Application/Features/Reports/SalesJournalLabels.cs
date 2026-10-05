using System.Globalization;

namespace FactuTrust.Application.Features.Reports;

/// <summary>
/// Libellés FR/AR du journal de ventes commercial. Le français reste celui déjà imprimé et renvoyé par l'API.
/// La culture vient de <see cref="CultureInfo.CurrentUICulture"/> (en-tête X-UI-Locale), jamais d'un paramètre libre.
/// </summary>
public static class SalesJournalLabels
{
    public static bool IsArabic =>
        string.Equals(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName, "ar", StringComparison.OrdinalIgnoreCase);

    public static string Title() => IsArabic ? "يومية المبيعات" : "Journal de ventes";

    public static string ViewMode(SalesJournalViewMode mode) => mode switch
    {
        SalesJournalViewMode.Day => IsArabic ? "حسب اليوم" : "Par jour",
        SalesJournalViewMode.Month => IsArabic ? "حسب الشهر" : "Par mois",
        SalesJournalViewMode.Year => IsArabic ? "حسب السنة" : "Par année",
        _ => IsArabic ? "التفاصيل" : "Détail"
    };

    public static string Period(DateTime from, DateTime to)
    {
        var start = from.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        var end = to.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        return IsArabic ? $"من {start} إلى {end}" : $"Du {start} au {end}";
    }

    public static string ModeLine(string modeLabel) =>
        IsArabic ? $"الوضع : {modeLabel}" : $"Mode : {modeLabel}";

    public static string ClientLine(string name) =>
        IsArabic ? $"الحريف : {name}" : $"Client : {name}";

    public static string CompanyFallback() => IsArabic ? "المؤسسة" : "Société";

    public static string Matricule() => IsArabic ? "المعرف الجبائي" : "Matricule fiscal";

    public static string CurrencyCaption() => IsArabic ? "بالدينار التونسي" : "exprimé en Dinars";

    public static string PrintedOn() => IsArabic ? "حُرّر في" : "Édité le";

    public static string Page() => IsArabic ? "صفحة" : "Page";

    public static string EmptyPeriod() => IsArabic
        ? "لا توجد أسطر مبيعات في هذه الفترة."
        : SalesJournalReportConstants.EmptyPeriodMessage;

    public static string TooManyLines() => IsArabic
        ? "عدد الأسطر كبير. قلّصوا الفترة أو صفّوا حسب الحريف."
        : SalesJournalReportConstants.TooManyLinesForPdfMessage;

    public static string PeriodOrder() => IsArabic
        ? "يجب أن يكون تاريخ البداية قبل تاريخ النهاية."
        : "La date de début doit être antérieure à la date de fin.";

    public static string DetailPeriodTooLong() => IsArabic
        ? $"لا يمكن أن تتجاوز الفترة {SalesJournalReportConstants.MaxDetailPeriodDays} يومًا في وضع التفاصيل."
        : $"La période ne peut pas dépasser {SalesJournalReportConstants.MaxDetailPeriodDays} jours en mode détail.";

    public static string AggregatedPeriodTooLong()
    {
        var years = SalesJournalReportConstants.MaxAggregatedPeriodDays / 366;
        return IsArabic
            ? $"لا يمكن أن تتجاوز الفترة {years} سنوات في الوضع المجمّع."
            : $"La période ne peut pas dépasser {years} ans en mode agrégé.";
    }

    public static string ClientNotFound() => IsArabic ? "الحريف غير موجود." : "Client introuvable.";

    public static string MissingDates() => IsArabic
        ? "المعاملان from و to مطلوبان (الصيغة: yyyy-MM-dd)."
        : "Les paramètres from et to sont requis (format: yyyy-MM-dd).";

    public static string DateOrder() => IsArabic
        ? "لا يمكن أن يكون تاريخ البداية بعد تاريخ النهاية."
        : "La date de début ne peut pas être après la date de fin.";

    public static IReadOnlyList<string> DetailColumns() => IsArabic
        ? new[] { "التاريخ", "الفاتورة", "النوع", "الحريف", "الرمز", "المنتوج", "الكمية", "سعر الوحدة", "دون أداءات", "TVA", "شامل الضريبة" }
        : new[] { "Date", "N° facture", "Type", "Client", "Code", "Produit", "Qté", "P.U.", "HT", "TVA", "TTC" };

    public static IReadOnlyList<string> AggregatedColumns() => IsArabic
        ? new[] { "الفترة", "الحريف", "الرمز", "المنتوج", "الكمية", "دون أداءات", "TVA", "شامل الضريبة" }
        : new[] { "Période", "Client", "Code", "Produit", "Qté", "HT", "TVA", "TTC" };

    public static string TotalQuantity() => IsArabic ? "مجموع الكمية" : "Total quantité";

    public static string TotalHt() => IsArabic ? "المجموع دون أداءات" : "Total HT";

    public static string TotalVat() => IsArabic ? "مجموع TVA" : "Total TVA";

    public static string TotalTtc() => IsArabic ? "المجموع شامل الضريبة" : "Total TTC";
}
