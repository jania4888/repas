using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.CashDesk.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.CashDesk;

/// <summary>
/// Projection des lignes du journal. Copie le mapping de la liste caisse sans le modifier,
/// pour garder les liens facture et le découpage TVA.
/// </summary>
internal static class CashOperationJournalLineMapper
{
    public static async Task<IReadOnlyList<CashOperationListItemDto>> MapAsync(
        IReadOnlyList<CashOperation> items,
        IPaymentRepository paymentRepository,
        ISupplierPaymentRepository supplierPaymentRepository,
        CancellationToken cancellationToken)
    {
        var paymentSourceIds = items
            .Where(op => op.SourceType == "Payment" && op.SourceId.HasValue)
            .Select(op => op.SourceId!.Value)
            .Distinct()
            .ToList();

        var paymentSourceMap = new Dictionary<Guid, (Guid InvoiceId, string InvoiceNumber)>();
        foreach (var paymentId in paymentSourceIds)
        {
            var payment = await paymentRepository.GetByIdAsync(paymentId, cancellationToken);
            if (payment?.Invoice is null)
                continue;

            paymentSourceMap[paymentId] = (payment.InvoiceId, payment.Invoice.Number.Value);
        }

        var supplierPaymentSourceIds = items
            .Where(op => op.SourceType == "SupplierPayment" && op.SourceId.HasValue)
            .Select(op => op.SourceId!.Value)
            .Distinct()
            .ToList();

        var supplierPaymentSourceMap = new Dictionary<Guid, (Guid SupplierInvoiceId, string InvoiceNumber)>();
        if (supplierPaymentSourceIds.Count > 0)
        {
            var supplierPayments = await supplierPaymentRepository.GetByIdsWithInvoiceAsync(
                supplierPaymentSourceIds,
                cancellationToken);

            foreach (var payment in supplierPayments)
            {
                if (payment.SupplierInvoice is null)
                    continue;

                supplierPaymentSourceMap[payment.Id] = (payment.SupplierInvoiceId, payment.SupplierInvoice.InvoiceNumber);
            }
        }

        return items.Select(op => MapOne(op, paymentSourceMap, supplierPaymentSourceMap)).ToList();
    }

    private static CashOperationListItemDto MapOne(
        CashOperation op,
        IReadOnlyDictionary<Guid, (Guid InvoiceId, string InvoiceNumber)> paymentSourceMap,
        IReadOnlyDictionary<Guid, (Guid SupplierInvoiceId, string InvoiceNumber)> supplierPaymentSourceMap)
    {
        Guid? sourceInvoiceId = null;
        string? sourceInvoiceNumber = null;
        if (op.SourceType == "Payment" &&
            op.SourceId.HasValue &&
            paymentSourceMap.TryGetValue(op.SourceId.Value, out var sourceInvoice))
        {
            sourceInvoiceId = sourceInvoice.InvoiceId;
            sourceInvoiceNumber = sourceInvoice.InvoiceNumber;
        }

        Guid? sourceSupplierInvoiceId = null;
        string? sourceSupplierInvoiceNumber = null;
        if (op.SourceType == "SupplierPayment" &&
            op.SourceId.HasValue &&
            supplierPaymentSourceMap.TryGetValue(op.SourceId.Value, out var supplierSrc))
        {
            sourceSupplierInvoiceId = supplierSrc.SupplierInvoiceId;
            sourceSupplierInvoiceNumber = supplierSrc.InvoiceNumber;
        }

        var vatSplit = CashOperationVatCalculator.TrySplitTtc(op.Amount.Amount, op.VatRate);

        return new CashOperationListItemDto
        {
            Id = op.Id,
            OperationType = op.OperationType,
            OperationTypeDisplay = op.OperationType == CashOperationType.Debit ? "Débit" : "Crédit",
            OperationDate = op.OperationDate,
            Method = op.Method,
            MethodDisplay = op.Method.ToDisplayString(),
            Label = op.Label,
            Category = op.Category,
            CategoryDisplay = op.Category?.ToDisplayString(),
            RevenueCategory = op.RevenueCategory,
            RevenueCategoryDisplay = op.RevenueCategory?.ToDisplayString(),
            Document = op.Number.Value,
            Amount = op.Amount.Amount,
            Currency = op.Amount.Currency,
            Reference = op.Reference,
            Notes = op.Notes,
            Status = op.Status,
            Origin = op.Origin,
            SourceType = op.SourceType,
            SourceId = op.SourceId,
            SourceInvoiceId = sourceInvoiceId,
            SourceInvoiceNumber = sourceInvoiceNumber,
            SourceSupplierInvoiceId = sourceSupplierInvoiceId,
            SourceSupplierInvoiceNumber = sourceSupplierInvoiceNumber,
            VatRatePercent = vatSplit?.RatePercent,
            HtAmount = vatSplit?.Ht,
            VatAmount = vatSplit?.Vat
        };
    }
}
