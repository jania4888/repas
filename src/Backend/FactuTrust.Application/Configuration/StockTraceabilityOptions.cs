namespace FactuTrust.Application.Configuration;

/// <summary>Feature flags for stock traceability, variants and FIFO/LIFO. All default OFF.</summary>
public sealed class StockTraceabilityOptions
{
    public const string SectionName = "Features:Stock";

    public bool LotTrackingEnabled { get; set; }
    public bool SerialTrackingEnabled { get; set; }
    public bool ExpiryTrackingEnabled { get; set; }
    public bool ProductVariantsEnabled { get; set; }
    public bool FifoLifoValuationEnabled { get; set; }
    public bool BlockExpiredLotsOnExit { get; set; } = true;
    public bool StrictTrackedAllocation { get; set; } = true;

    /// <summary>
    /// Valorise une entrée d'inventaire ou de comptage sans coût par la cascade
    /// « dernier prix d'achat → prix d'achat de la fiche → 0 », au lieu de la laisser à zéro.
    ///
    /// OFF par défaut, et volontairement : sur un article CMUP, valoriser un écart positif
    /// DÉPLACE le coût moyen, ce que l'ajustement ne fait pas aujourd'hui. L'activation est une
    /// décision comptable, pas technique.
    /// </summary>
    public bool InventoryAutoValuationEnabled { get; set; }
}
