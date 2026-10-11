using System.Collections.Frozen;

namespace FactuTrust.Application.Features.Accounting.Lettering;

/// <summary>
/// Catégorie stable d'une écriture, dérivée de <c>JournalEntry.SourceEntityType</c> (plan de
/// refonte du lettrage, §1.3 / Annexe A §1.3). Le brut n'est jamais exposé à l'API : seule la
/// catégorie l'est, pour que le front puisse la traduire avec <c>$localize</c> sans dépendre d'une
/// liste de types internes.
/// </summary>
public static class LetteringSourceCategories
{
    public const string Invoice = "invoice";
    public const string CreditNote = "credit_note";
    public const string Payment = "payment";
    public const string Payroll = "payroll";
    public const string Opening = "opening";
    public const string Reversal = "reversal";
    public const string Exchange = "exchange";
    public const string Manual = "manual";
    public const string Other = "other";

    /// <summary>Toutes les catégories, dans l'ordre d'affichage recommandé.</summary>
    public static readonly IReadOnlyList<string> All = new[]
    {
        Invoice, CreditNote, Payment, Payroll, Opening, Reversal, Exchange, Manual, Other
    };

    /// <summary>
    /// Tous les <c>SourceEntityType</c> connus (mappés vers une catégorie autre que « other »).
    /// Utilisé par le filtre « other » du lettrage (§1.3) : <c>NOT IN (tous les types connus)</c>.
    /// </summary>
    public static readonly IReadOnlyList<string> KnownSourceEntityTypes = new[]
    {
        "Invoice", "SupplierInvoice",
        "InvoiceCreditNote", "InvoiceCancelled",
        "Payment", "SupplierPayment", "EffetSettlement", "BankDeposit", "CashOperation", "SupplierInvoiceWithholding",
        "PayrollRun", "PayrollPayment", "CnssContributionPayment", "PayrollReclassification",
        "OpeningBalance",
        "ManualReversal",
        "ExchangeDifference"
    };

    // Correspondance explicite demandée par le plan. Toute valeur de SourceEntityType qui n'y
    // figure pas tombe dans « other » (comportement voulu pour les types non listés : actifs
    // immobilisés, avances/prêts salariés, déclarations fiscales, annulations de paie, etc.).
    private static readonly FrozenDictionary<string, string> Map = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["Invoice"] = Invoice,
        ["SupplierInvoice"] = Invoice,

        ["InvoiceCreditNote"] = CreditNote,
        ["InvoiceCancelled"] = CreditNote,

        ["Payment"] = Payment,
        ["SupplierPayment"] = Payment,
        ["EffetSettlement"] = Payment,
        ["BankDeposit"] = Payment,
        ["CashOperation"] = Payment,
        ["SupplierInvoiceWithholding"] = Payment,

        ["PayrollRun"] = Payroll,
        ["PayrollPayment"] = Payroll,
        ["CnssContributionPayment"] = Payroll,
        ["PayrollReclassification"] = Payroll,

        ["OpeningBalance"] = Opening,

        ["ManualReversal"] = Reversal,

        ["ExchangeDifference"] = Exchange
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>
    /// Catégorie d'un <c>SourceEntityType</c> brut (<c>null</c>/vide → <see cref="Manual"/>, type
    /// connu → sa catégorie, type inconnu → <see cref="Other"/>).
    /// </summary>
    public static string Resolve(string? sourceEntityType)
    {
        if (string.IsNullOrEmpty(sourceEntityType))
            return Manual;

        return Map.TryGetValue(sourceEntityType, out var category) ? category : Other;
    }

    /// <summary>
    /// Traduit une liste de catégories demandées en liste de <c>SourceEntityType</c> à filtrer, et
    /// indique si « manual » (type <c>NULL</c>) et/ou « other » (tout le reste) sont demandés.
    /// </summary>
    public static (IReadOnlyList<string> SourceEntityTypes, bool IncludeManual, bool IncludeOther) ResolveFilter(
        IReadOnlyList<string>? sourceCategories)
    {
        if (sourceCategories is null || sourceCategories.Count == 0)
            return (Array.Empty<string>(), false, false);

        var requested = sourceCategories
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c.Trim().ToLowerInvariant())
            .ToHashSet(StringComparer.Ordinal);

        var includeManual = requested.Contains(Manual);
        var includeOther = requested.Contains(Other);

        var types = Map
            .Where(kv => requested.Contains(kv.Value))
            .Select(kv => kv.Key)
            .ToList();

        return (types, includeManual, includeOther);
    }
}
