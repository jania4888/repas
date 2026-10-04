using System.Globalization;
using FactuTrust.Application.Features.Reports;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class SalesJournalLabelsTests
{
    [Fact]
    public void FrenchLabels_MatchTheExistingCopy()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
        try
        {
            Assert.False(SalesJournalLabels.IsArabic);
            Assert.Equal("Journal de ventes", SalesJournalLabels.Title());
            Assert.Equal("Détail", SalesJournalLabels.ViewMode(SalesJournalViewMode.Detail));
            Assert.Equal("Par jour", SalesJournalLabels.ViewMode(SalesJournalViewMode.Day));
            Assert.Equal("Par mois", SalesJournalLabels.ViewMode(SalesJournalViewMode.Month));
            Assert.Equal("Par année", SalesJournalLabels.ViewMode(SalesJournalViewMode.Year));
            Assert.Equal("Du 01/04/2026 au 10/04/2026", SalesJournalLabels.Period(new DateTime(2026, 4, 1), new DateTime(2026, 4, 10)));
            Assert.Equal("Mode : Détail", SalesJournalLabels.ModeLine("Détail"));
            Assert.Equal("Client : Ste Test", SalesJournalLabels.ClientLine("Ste Test"));
            Assert.Equal(SalesJournalReportConstants.EmptyPeriodMessage, SalesJournalLabels.EmptyPeriod());
            Assert.Equal(SalesJournalReportConstants.TooManyLinesForPdfMessage, SalesJournalLabels.TooManyLines());
            Assert.Equal("La date de début doit être antérieure à la date de fin.", SalesJournalLabels.PeriodOrder());
            Assert.Equal(
                $"La période ne peut pas dépasser {SalesJournalReportConstants.MaxDetailPeriodDays} jours en mode détail.",
                SalesJournalLabels.DetailPeriodTooLong());
            Assert.Equal(
                $"La période ne peut pas dépasser {SalesJournalReportConstants.MaxAggregatedPeriodDays / 366} ans en mode agrégé.",
                SalesJournalLabels.AggregatedPeriodTooLong());
            Assert.Equal("Client introuvable.", SalesJournalLabels.ClientNotFound());
            Assert.Equal("Les paramètres from et to sont requis (format: yyyy-MM-dd).", SalesJournalLabels.MissingDates());
            Assert.Equal("La date de début ne peut pas être après la date de fin.", SalesJournalLabels.DateOrder());
            Assert.Equal("N° facture", SalesJournalLabels.DetailColumns()[1]);
            Assert.Equal("Total HT", SalesJournalLabels.TotalHt());
            Assert.Equal("Par mois", SalesJournalReportAssembler.ViewModeDisplayLabel(SalesJournalViewMode.Month));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void ArabicLabels_UseTheSalesGlossary()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar-TN");
        try
        {
            Assert.True(SalesJournalLabels.IsArabic);
            Assert.Equal("يومية المبيعات", SalesJournalLabels.Title());
            Assert.Equal("التفاصيل", SalesJournalLabels.ViewMode(SalesJournalViewMode.Detail));
            Assert.Equal("حسب اليوم", SalesJournalLabels.ViewMode(SalesJournalViewMode.Day));
            Assert.Equal("حسب الشهر", SalesJournalLabels.ViewMode(SalesJournalViewMode.Month));
            Assert.Equal("حسب السنة", SalesJournalLabels.ViewMode(SalesJournalViewMode.Year));
            Assert.Equal("من 01/04/2026 إلى 10/04/2026", SalesJournalLabels.Period(new DateTime(2026, 4, 1), new DateTime(2026, 4, 10)));
            Assert.NotEqual(SalesJournalReportConstants.EmptyPeriodMessage, SalesJournalLabels.EmptyPeriod());
            Assert.Contains("التاريخ", SalesJournalLabels.DetailColumns());
            Assert.Contains("دون أداءات", SalesJournalLabels.DetailColumns());
            Assert.Contains("شامل الضريبة", SalesJournalLabels.DetailColumns());
            Assert.Contains("TVA", SalesJournalLabels.DetailColumns());
            Assert.Equal("مجموع الكمية", SalesJournalLabels.TotalQuantity());
            Assert.Equal("الحريف غير موجود.", SalesJournalLabels.ClientNotFound());
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }
}
