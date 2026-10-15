using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;

namespace FactuTrust.Application.Configuration;

/// <summary>
/// Le liant entre le drapeau de configuration et la règle de domaine.
///
/// Le domaine ne connaît pas <see cref="StockTraceabilityOptions"/> ; les appelants, eux, ont
/// presque toujours les options sous la main. Ces extensions évitent que chacun réécrive
/// « options.FifoLifoValuationEnabled &amp;&amp; méthode est FIFO ou LIFO » — la duplication
/// exacte qui avait laissé trois copies de la règle diverger.
/// </summary>
public static class StockCostingRules
{
    /// <inheritdoc cref="StockCostingPolicy.RequiresLayeredCosting(Product?, bool)"/>
    public static bool RequiresLayeredCosting(this StockTraceabilityOptions options, Product? product)
    {
        ArgumentNullException.ThrowIfNull(options);
        return StockCostingPolicy.RequiresLayeredCosting(product, options.FifoLifoValuationEnabled);
    }

    /// <inheritdoc cref="StockCostingPolicy.RequiresLayeredCosting(CostingMethod, bool)"/>
    public static bool RequiresLayeredCosting(this StockTraceabilityOptions options, CostingMethod method)
    {
        ArgumentNullException.ThrowIfNull(options);
        return StockCostingPolicy.RequiresLayeredCosting(method, options.FifoLifoValuationEnabled);
    }
}
