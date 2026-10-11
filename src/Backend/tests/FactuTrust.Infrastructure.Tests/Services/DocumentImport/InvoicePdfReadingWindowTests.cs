using FactuTrust.Application.Features.Accounting.DocumentImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

public sealed class InvoicePdfReadingWindowTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Select_non_positive_count_returns_no_page(int pageCount)
    {
        Assert.Empty(InvoicePdfReadingWindow.SelectPageNumbers(pageCount));
        Assert.False(InvoicePdfReadingWindow.RequiresWindow(pageCount));
    }

    [Theory]
    [InlineData(1, "1")]
    [InlineData(5, "1,2,3,4,5")]
    [InlineData(6, "1,2,4,5,6")]
    [InlineData(7, "1,2,5,6,7")]
    [InlineData(8, "1,2,6,7,8")]
    [InlineData(12, "1,2,10,11,12")]
    public void Select_keeps_every_page_up_to_five_and_the_head_plus_tail_from_six(int pageCount, string expected)
    {
        var pages = InvoicePdfReadingWindow.SelectPageNumbers(pageCount);

        Assert.Equal(expected, string.Join(",", pages));
        Assert.Equal(pages.Count, pages.Distinct().Count());
        Assert.Equal(pages.OrderBy(n => n).ToArray(), pages.ToArray());
        Assert.Equal(pageCount > InvoicePdfReadingWindow.MaxPagesWithoutWindow, InvoicePdfReadingWindow.RequiresWindow(pageCount));
    }

    [Fact]
    public void DescribeSkippedPages_names_the_pages_actually_read()
    {
        var warning = InvoicePdfReadingWindow.DescribeSkippedPages(12, new[] { 1, 2, 10, 11, 12 });

        Assert.Equal(
            "Cette pièce compte 12 pages. Seules les pages 1, 2, 10, 11 et 12 ont été lues. "
            + "Les pages intermédiaires n'ont pas été analysées : contrôlez le détail avant d'enregistrer.",
            warning);
    }

    [Fact]
    public void DescribeSkippedPages_uses_the_singular_when_a_single_page_is_skipped()
    {
        var warning = InvoicePdfReadingWindow.DescribeSkippedPages(6, new[] { 1, 2, 4, 5, 6 });

        Assert.Equal(
            "Cette pièce compte 6 pages. Seules les pages 1, 2, 4, 5 et 6 ont été lues. "
            + "La page 3 n'a pas été analysée : contrôlez le détail avant d'enregistrer.",
            warning);
    }
}
