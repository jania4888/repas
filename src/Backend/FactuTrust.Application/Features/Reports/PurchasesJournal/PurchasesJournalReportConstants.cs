namespace FactuTrust.Application.Features.Reports;

public static class PurchasesJournalReportConstants
{
    public const int DefaultPageSize = SalesJournalReportConstants.DefaultPageSize;
    public const int MaxPageSize = SalesJournalReportConstants.MaxPageSize;
    public const int MaxDetailPeriodDays = SalesJournalReportConstants.MaxDetailPeriodDays;
    public const int MaxAggregatedPeriodDays = SalesJournalReportConstants.MaxAggregatedPeriodDays;
    public const int MaxLinesForPdf = SalesJournalReportConstants.MaxLinesForPdf;

    public const string EmptyPeriodMessage = "Aucune ligne d'achat pour cette période.";
    public const string TooManyLinesForPdfMessage =
        "Trop de lignes. Réduisez la période ou filtrez par fournisseur.";
}
