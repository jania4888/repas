using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Reports;

/// <summary>Commercial sign for FAC vs AVO on journal quantities and amounts.</summary>
public static class SalesJournalCommercialSign
{
    public static decimal ForDocumentType(InvoiceType type) =>
        type == InvoiceType.CreditNote ? -1m : 1m;

    public static decimal Apply(InvoiceType type, decimal value) =>
        value * ForDocumentType(type);
}
