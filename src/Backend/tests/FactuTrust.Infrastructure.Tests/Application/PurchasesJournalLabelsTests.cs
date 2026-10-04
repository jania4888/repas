using System.Globalization;
using FactuTrust.Application.Features.Reports;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class PurchasesJournalLabelsTests
{
    [Fact]
    public void FrenchLabels_MatchTheExistingPdfCopy()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
        try
        {
            Assert.Equal("Journal d'achats", PurchasesJournalLabels.Title());
            Assert.Equal("Factures fournisseur", PurchasesJournalLabels.Source(PurchasesJournalSource.SupplierInvoice));
            Assert.Equal("Bons de réception", PurchasesJournalLabels.Source(PurchasesJournalSource.PurchaseReceipt));
            Assert.Equal("Du 01/04/2026 au 10/04/2026", PurchasesJournalLabels.Period(new DateTime(2026, 4, 1), new DateTime(2026, 4, 10)));
            Assert.Equal("Source : Factures fournisseur", PurchasesJournalLabels.SourceLine("Factures fournisseur"));
            Assert.False(PurchasesJournalLabels.IsArabic);

            foreach (var mode in Enum.GetValues<SalesJournalViewMode>())
                Assert.Equal(SalesJournalReportAssembler.ViewModeDisplayLabel(mode), PurchasesJournalLabels.ViewMode(mode));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void ArabicLabels_UseThePurchasesGlossary()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar-TN");
        try
        {
            Assert.True(PurchasesJournalLabels.IsArabic);
            Assert.Equal("يومية المشتريات", PurchasesJournalLabels.Title());
            Assert.Equal("فواتير المزوّدين", PurchasesJournalLabels.Source(PurchasesJournalSource.SupplierInvoice));
            Assert.Equal("وصولات الاستلام", PurchasesJournalLabels.Source(PurchasesJournalSource.PurchaseReceipt));
            Assert.Equal("تفصيل", PurchasesJournalLabels.ViewMode(SalesJournalViewMode.Detail));
            Assert.Equal("حسب اليوم", PurchasesJournalLabels.ViewMode(SalesJournalViewMode.Day));
            Assert.Equal("حسب الشهر", PurchasesJournalLabels.ViewMode(SalesJournalViewMode.Month));
            Assert.Equal("حسب السنة", PurchasesJournalLabels.ViewMode(SalesJournalViewMode.Year));
            Assert.Equal("من 01/04/2026 إلى 10/04/2026", PurchasesJournalLabels.Period(new DateTime(2026, 4, 1), new DateTime(2026, 4, 10)));
            Assert.Equal("وصل استلام", PurchasesJournalLabels.DocumentKind("BR"));
            Assert.Equal("فاتورة", PurchasesJournalLabels.DocumentKind("FAC"));
            Assert.Contains("HT", PurchasesJournalLabels.DetailColumns());
            Assert.Contains("التاريخ", PurchasesJournalLabels.DetailColumns());
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public void PeriodTemplates_RenderTheFrenchSentencesTheLocalizerMatches()
    {
        var detail = string.Format(
            CultureInfo.InvariantCulture,
            PurchasesJournalReportConstants.DetailPeriodExceededTemplate,
            PurchasesJournalReportConstants.MaxDetailPeriodDays);
        var aggregated = string.Format(
            CultureInfo.InvariantCulture,
            PurchasesJournalReportConstants.AggregatedPeriodExceededTemplate,
            PurchasesJournalReportConstants.MaxAggregatedPeriodDays / 366);

        Assert.Equal("La période ne peut pas dépasser 366 jours en mode détail.", detail);
        Assert.Equal("La période ne peut pas dépasser 5 ans en mode agrégé.", aggregated);
    }
}
