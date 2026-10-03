namespace FactuTrust.Application.Features.CashDesk;

/// <summary>Bornes du journal de trésorerie. Lecture seule, alignée sur le journal des ventes.</summary>
public static class TreasuryJournalConstants
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;
    public const int MaxPeriodDays = 366;
    public const int MaxLinesForPdf = 3000;

    public const string PeriodTooLongMessage =
        "La période du journal de trésorerie ne peut pas dépasser 366 jours.";

    public const string InvalidMethodMessage = "Le moyen de paiement est invalide.";

    public const string TooManyLinesForPdfMessage =
        "Trop de lignes pour le PDF du journal de trésorerie. Réduisez la période.";
}
