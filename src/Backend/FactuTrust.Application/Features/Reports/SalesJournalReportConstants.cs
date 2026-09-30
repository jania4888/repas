namespace FactuTrust.Application.Features.Reports;

public static class SalesJournalReportConstants
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;
    public const int MaxDetailPeriodDays = 366;
    public const int MaxAggregatedPeriodDays = 366 * 5;
    public const int MaxLinesForPdf = 3000;

    public const string EmptyPeriodMessage = "Aucune ligne de vente pour cette période.";
    public const string TooManyLinesForPdfMessage =
        "Trop de lignes. Réduisez la période ou filtrez par client.";
}
