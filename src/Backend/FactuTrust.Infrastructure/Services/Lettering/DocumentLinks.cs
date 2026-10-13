namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Liens documentaires règlement → facture, chargés par le loader pour la règle R1 (plan v2, annexe C §2.1).
/// </summary>
/// <param name="PaymentToInvoice"><c>Payment.Id</c> → <c>Invoice.Id</c>.</param>
/// <param name="SupplierPaymentToInvoice"><c>SupplierPayment.Id</c> → <c>SupplierInvoice.Id</c>.</param>
internal sealed record DocumentLinks(
    IReadOnlyDictionary<Guid, Guid> PaymentToInvoice,
    IReadOnlyDictionary<Guid, Guid> SupplierPaymentToInvoice)
{
    internal static DocumentLinks Empty { get; } = new(new Dictionary<Guid, Guid>(), new Dictionary<Guid, Guid>());
}
