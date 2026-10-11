using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

/// <summary>
/// Invariants de conception entre la fenêtre de pages, le seuil synchrone Docstrange
/// et le budget de l'import comptable.
/// </summary>
public sealed class InvoicePdfReadingWindowInvariantTests
{
    [Fact]
    public void The_window_fits_under_the_threshold_and_the_synchronous_limit()
    {
        var pagesSent = InvoicePdfReadingWindow.FirstPages + InvoicePdfReadingWindow.LastPages;

        Assert.True(pagesSent <= InvoicePdfReadingWindow.MaxPagesWithoutWindow);
        Assert.True(InvoicePdfReadingWindow.MaxPagesWithoutWindow <= new DocStrangeSettings().SyncPageThreshold);
    }

    [Fact]
    public void Every_long_document_sends_at_most_the_window()
    {
        for (var pageCount = 1; pageCount <= 500; pageCount++)
        {
            var pages = InvoicePdfReadingWindow.SelectPageNumbers(pageCount);
            Assert.True(pages.Count <= InvoicePdfReadingWindow.MaxPagesWithoutWindow, $"{pageCount} pages");
            Assert.All(pages, n => Assert.InRange(n, 1, pageCount));
        }
    }

    [Theory]
    [InlineData(170, 170)]
    [InlineData(5, 30)]
    [InlineData(180, 180)]
    [InlineData(280, 180)]
    [InlineData(10_000, 180)]
    public void The_external_budget_is_clamped(int configured, int expected)
    {
        var settings = new AccountingSettings { DocumentImportExternalBudgetSeconds = configured };

        Assert.Equal(expected, settings.EffectiveDocumentImportExternalBudgetSeconds);
    }

    [Fact]
    public void Every_allowed_budget_stays_below_the_front_timeout_of_190_seconds()
    {
        Assert.True(new AccountingSettings().EffectiveDocumentImportExternalBudgetSeconds < 190);
        Assert.True(AccountingSettings.MaxDocumentImportExternalBudgetSeconds < 190);
    }
}
