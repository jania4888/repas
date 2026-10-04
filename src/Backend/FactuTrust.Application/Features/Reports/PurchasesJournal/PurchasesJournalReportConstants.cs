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

    /// <summary>Gabarit français reconnu par le localiseur ({0} = nombre de jours).</summary>
    public const string DetailPeriodExceededTemplate =
        "La période ne peut pas dépasser {0} jours en mode détail.";

    /// <summary>Gabarit français reconnu par le localiseur ({0} = nombre d'années).</summary>
    public const string AggregatedPeriodExceededTemplate =
        "La période ne peut pas dépasser {0} ans en mode agrégé.";
}
