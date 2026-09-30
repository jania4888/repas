using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Features.Reports;

public static class PurchasesJournalReportAssembler
{
    public static Result ValidatePeriod(DateTime from, DateTime to, SalesJournalViewMode viewMode)
    {
        if (from > to)
            return Result.Failure(Error.Validation("Period", "La date de début doit être antérieure à la date de fin."));

        var days = (to.Date - from.Date).Days + 1;
        if (viewMode == SalesJournalViewMode.Detail && days > PurchasesJournalReportConstants.MaxDetailPeriodDays)
            return Result.Failure(Error.Validation("Period",
                $"La période ne peut pas dépasser {PurchasesJournalReportConstants.MaxDetailPeriodDays} jours en mode détail."));

        if (viewMode != SalesJournalViewMode.Detail && days > PurchasesJournalReportConstants.MaxAggregatedPeriodDays)
            return Result.Failure(Error.Validation("Period",
                $"La période ne peut pas dépasser {PurchasesJournalReportConstants.MaxAggregatedPeriodDays / 366} ans en mode agrégé."));

        return Result.Success();
    }

    public static PurchasesJournalTotalsDto ComputeDetailTotals(IEnumerable<PurchasesJournalDetailRowDto> rows)
    {
        var list = rows.ToList();
        if (list.Count == 0)
            return new PurchasesJournalTotalsDto { Currency = "TND" };

        return new PurchasesJournalTotalsDto
        {
            Quantity = list.Sum(r => r.Quantity),
            LineSubTotal = list.Sum(r => r.LineSubTotal),
            LineTotal = list.Sum(r => r.LineTotal),
            VatAmount = list.Sum(r => r.VatAmount),
            Currency = list[0].Currency
        };
    }

    public static PurchasesJournalTotalsDto ComputeAggregatedTotals(IEnumerable<PurchasesJournalAggregatedRowDto> rows)
    {
        var list = rows.ToList();
        if (list.Count == 0)
            return new PurchasesJournalTotalsDto { Currency = "TND" };

        return new PurchasesJournalTotalsDto
        {
            Quantity = list.Sum(r => r.Quantity),
            LineSubTotal = list.Sum(r => r.LineSubTotal),
            LineTotal = list.Sum(r => r.LineTotal),
            VatAmount = list.Sum(r => r.VatAmount),
            Currency = list[0].Currency
        };
    }

    public static string ViewModeWire(SalesJournalViewMode mode) => SalesJournalReportAssembler.ViewModeWire(mode);

    public static SalesJournalViewMode ParseViewMode(string? value) => SalesJournalReportAssembler.ParseViewMode(value);

    public static string ViewModeDisplayLabel(SalesJournalViewMode mode) => SalesJournalReportAssembler.ViewModeDisplayLabel(mode);

    public static PurchasesJournalSource ParseSource(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "receipt" => PurchasesJournalSource.PurchaseReceipt,
            _ => PurchasesJournalSource.SupplierInvoice
        };

    public static string SourceWire(PurchasesJournalSource source) => source switch
    {
        PurchasesJournalSource.PurchaseReceipt => "Receipt",
        _ => "Invoice"
    };

    public static string SourceDisplayLabel(PurchasesJournalSource source) => source switch
    {
        PurchasesJournalSource.PurchaseReceipt => "Bons de réception",
        _ => "Factures fournisseur"
    };
}
