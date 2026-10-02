namespace FactuTrust.Application.Features.Reports;

public static class StockStatusReportConstants
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;
    public const int MaxLinesForPdf = 3000;
    public const int MaxSearchLength = 100;

    public const string EmptyReportMessage = "Aucun article en stock pour ces critères.";
    public const string TooManyLinesForPdfMessage =
        "Trop de lignes. Filtrez par entrepôt ou par catégorie avant d'imprimer.";

    public const string UncategorizedLabel = "Sans catégorie";
}
