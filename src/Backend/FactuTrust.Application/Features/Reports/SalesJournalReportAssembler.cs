using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Features.Reports;

public static class SalesJournalReportAssembler
{
    public static Result ValidatePeriod(DateTime from, DateTime to, SalesJournalViewMode viewMode)
    {
        if (from > to)
            return Result.Failure(Error.Validation("Period", "La date de début doit être antérieure à la date de fin."));

        var days = (to.Date - from.Date).Days + 1;
        if (viewMode == SalesJournalViewMode.Detail && days > SalesJournalReportConstants.MaxDetailPeriodDays)
            return Result.Failure(Error.Validation("Period",
                $"La période ne peut pas dépasser {SalesJournalReportConstants.MaxDetailPeriodDays} jours en mode détail."));

        if (viewMode != SalesJournalViewMode.Detail && days > SalesJournalReportConstants.MaxAggregatedPeriodDays)
            return Result.Failure(Error.Validation("Period",
                $"La période ne peut pas dépasser {SalesJournalReportConstants.MaxAggregatedPeriodDays / 366} ans en mode agrégé."));

        return Result.Success();
    }

    public static SalesJournalTotalsDto ComputeDetailTotals(IEnumerable<SalesJournalDetailRowDto> rows)
    {
        var list = rows.ToList();
        if (list.Count == 0)
            return new SalesJournalTotalsDto { Currency = "TND" };

        return new SalesJournalTotalsDto
        {
            Quantity = list.Sum(r => r.Quantity),
            LineSubTotal = list.Sum(r => r.LineSubTotal),
            LineTotal = list.Sum(r => r.LineTotal),
            VatAmount = list.Sum(r => r.VatAmount),
            Currency = list[0].Currency
        };
    }

    public static SalesJournalTotalsDto ComputeAggregatedTotals(IEnumerable<SalesJournalAggregatedRowDto> rows)
    {
        var list = rows.ToList();
        if (list.Count == 0)
            return new SalesJournalTotalsDto { Currency = "TND" };

        return new SalesJournalTotalsDto
        {
            Quantity = list.Sum(r => r.Quantity),
            LineSubTotal = list.Sum(r => r.LineSubTotal),
            LineTotal = list.Sum(r => r.LineTotal),
            VatAmount = list.Sum(r => r.VatAmount),
            Currency = list[0].Currency
        };
    }

    public static string ViewModeWire(SalesJournalViewMode mode) => mode switch
    {
        SalesJournalViewMode.Detail => "Detail",
        SalesJournalViewMode.Day => "Day",
        SalesJournalViewMode.Month => "Month",
        SalesJournalViewMode.Year => "Year",
        _ => "Detail"
    };

    public static SalesJournalViewMode ParseViewMode(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "day" => SalesJournalViewMode.Day,
            "month" => SalesJournalViewMode.Month,
            "year" => SalesJournalViewMode.Year,
            _ => SalesJournalViewMode.Detail
        };

    public static string ViewModeDisplayLabel(SalesJournalViewMode mode) => mode switch
    {
        SalesJournalViewMode.Detail => "Détail",
        SalesJournalViewMode.Day => "Par jour",
        SalesJournalViewMode.Month => "Par mois",
        SalesJournalViewMode.Year => "Par année",
        _ => "Détail"
    };
}
