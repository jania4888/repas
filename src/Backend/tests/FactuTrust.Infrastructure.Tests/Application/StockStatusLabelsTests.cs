using System.Globalization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class StockStatusLabelsTests
{
    [Fact]
    public void FrenchLabels_MatchTheHistoricalSentences()
    {
        using var _ = new UiCulture("fr-FR");

        Assert.False(StockStatusLabels.IsArabic);
        Assert.Equal("État de stock", StockStatusLabels.Title());
        Assert.Equal("Par entrepôt puis catégorie", StockStatusLabels.GroupingWarehouseThenCategory());
        Assert.Equal("Par catégorie puis entrepôt", StockStatusLabels.GroupingCategoryThenWarehouse());
        Assert.Equal(StockStatusReportConstants.UncategorizedLabel, StockStatusLabels.Uncategorized());
        Assert.Equal(StockStatusReportConstants.EmptyReportMessage, StockStatusLabels.Empty());
        Assert.Equal(StockStatusReportConstants.TooManyLinesForPdfMessage, StockStatusLabels.TooManyLines());
        Assert.Equal("Cet entrepôt est désactivé.", StockStatusLabels.WarehouseDisabled());
        Assert.Equal("Total général", StockStatusLabels.GrandTotal());
        Assert.Equal(
            "Valorisation au coût moyen pondéré affiché (CMUP / couche FIFO-LIFO).",
            StockStatusLabels.ValuationNote());
        Assert.Equal(
            "Entrepôt : Magasin — Catégorie : Boissons — Recherche : eau[%] — Inclut stock à zéro",
            StockStatusReportAssembler.BuildFiltersSummary("Magasin", "Boissons", "eau[%]", true));
    }

    [Fact]
    public void ArabicLabels_UseTheStockGlossary()
    {
        using var _ = new UiCulture("ar-TN");

        Assert.True(StockStatusLabels.IsArabic);
        Assert.Equal("حالة المخزون", StockStatusLabels.Title());
        Assert.Equal("حسب المستودع ثم الفئة", StockStatusLabels.GroupingMode(StockStatusGroupingMode.WarehouseThenCategory));
        Assert.Equal("حسب الفئة ثم المستودع", StockStatusLabels.GroupingMode(StockStatusGroupingMode.CategoryThenWarehouse));
        Assert.Equal("بدون فئة", StockStatusLabels.Uncategorized());
        Assert.Equal("لا توجد أصناف في المخزون لهذه المعايير.", StockStatusLabels.Empty());
        Assert.Equal("عدد الأسطر كبير. صفّوا حسب المستودع أو الفئة قبل الطباعة.", StockStatusLabels.TooManyLines());
        Assert.Equal("هذا المستودع معطّل.", StockStatusLabels.WarehouseDisabled());
        Assert.Equal("في 04/10/2026 11:30", StockStatusLabels.AsOf(new DateTime(2026, 10, 4, 11, 30, 0)));
        Assert.Equal(
            "المستودع : Magasin — الفئة : Boissons — البحث : ماء[%][_] — يشمل المخزون الصفري",
            StockStatusReportAssembler.BuildFiltersSummary("Magasin", "Boissons", "ماء[%][_]", true));
    }

    [Fact]
    public void SanitizeSearch_EscapesLikeWildcardsAndKeepsArabic()
    {
        Assert.Equal("ماء 100[%] [_]test", StockStatusReportAssembler.SanitizeSearch("ماء 100% _test"));
        Assert.Null(StockStatusReportAssembler.SanitizeSearch("   "));
    }

    private sealed class UiCulture : IDisposable
    {
        private readonly CultureInfo _previous;

        public UiCulture(string name)
        {
            _previous = CultureInfo.CurrentUICulture;
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(name);
        }

        public void Dispose() => CultureInfo.CurrentUICulture = _previous;
    }
}
