using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Services;

namespace FactuTrust.Application.Features.Stock.Services;

/// <summary>D'où vient le coût retenu. Journalisé sur les chemins d'inventaire, pour que le choix soit traçable.</summary>
public enum StockEntryCostOrigin
{
    /// <summary>Saisi par l'utilisateur ou porté par le document.</summary>
    Explicit,

    /// <summary>Dérivé des couches de valorisation (valeur restante ÷ quantité restante).</summary>
    Layers,

    /// <summary>Dernier prix d'achat, puis prix d'achat de la fiche.</summary>
    PurchasePriceCascade,

    /// <summary>Coût moyen pondéré de l'article — le chemin CMUP normal.</summary>
    Cache,

    /// <summary>Aucune source : l'entrée est valorisée à zéro.</summary>
    Zero
}

/// <summary>Le coût retenu, et pourquoi.</summary>
public sealed record StockEntryCost(decimal UnitCost, StockEntryCostOrigin Origin);

/// <summary>
/// La cascade UNIQUE de résolution du coût d'une entrée de stock.
///
/// Sept chemins d'écriture lisaient directement <c>StockItem.AverageCost</c> pour valoriser un
/// nouveau mouvement. Sur un article FIFO/LIFO, ce champ n'est qu'un cache d'affichage arrondi :
/// l'utiliser comme source gravait une valeur dérivée dans les couches, de façon permanente. D'où
/// ce résolveur : une seule cascade, et sur un article à couches, la vérité vient des couches.
///
/// Deux surcharges, pour deux situations — pas deux règles :
/// <list type="bullet">
/// <item><b>sous transaction</b> : les couches sont lues par le magasin ambiant, qui voit celles
///       qui ne sont pas encore persistées. Ouvrir un second contexte les rendrait invisibles et
///       risquerait un blocage sur le verrou pris sur l'article de stock ;</item>
/// <item><b>hors transaction</b> : les couches ont déjà été lues en lot par
///       <see cref="IStockValuationReader"/>, avant la boucle d'appel.</item>
/// </list>
/// </summary>
public static class StockEntryCostResolver
{
    /// <summary>
    /// Chemin SOUS TRANSACTION : <paramref name="store"/> est le magasin ambiant, jamais un nouveau contexte.
    /// </summary>
    public static StockEntryCost Resolve(
        StockItem stockItem,
        Product? product,
        IStockTraceabilityStore? store,
        StockTraceabilityOptions options,
        decimal? explicitUnitCost = null,
        bool allowPurchasePriceCascade = false)
    {
        ArgumentNullException.ThrowIfNull(stockItem);
        ArgumentNullException.ThrowIfNull(options);

        if (TryExplicit(explicitUnitCost, out var explicitCost))
            return explicitCost;

        if (options.RequiresLayeredCosting(product) && store is not null)
        {
            var layers = store.ListOpenLayers(stockItem.Id);
            var snapshot = StockValuation.FromLayers(
                product!.CostingMethod,
                layered: true,
                stockItem.QuantityOnHand,
                stockItem.AverageCost,
                layers.Select(l => new ValuationLayerSnapshot(
                    l.ReceivedAt, l.Id, l.RemainingQuantity, l.UnitCost)));

            if (TryFromLayers(snapshot, out var layerCost))
                return layerCost;
        }

        return Fallback(product, stockItem.AverageCost, allowPurchasePriceCascade);
    }

    /// <summary>
    /// Chemin HORS TRANSACTION : <paramref name="reading"/> vient d'une lecture en lot faite AVANT
    /// la boucle d'appel. Ne jamais appeler <see cref="IStockValuationReader"/> par ligne.
    /// </summary>
    /// <param name="cachedAverageCost">
    /// Le CMUP de l'article, quand l'appelant l'a déjà en main. Sert de repli lorsque la lecture
    /// de valorisation n'a rien renvoyé — sans lui, un appelant qui possède l'article mais pas sa
    /// valorisation retomberait à zéro au lieu de son coût moyen.
    /// </param>
    public static StockEntryCost Resolve(
        StockCostReading? reading,
        Product? product,
        decimal? explicitUnitCost = null,
        bool allowPurchasePriceCascade = false,
        decimal? cachedAverageCost = null)
    {
        if (TryExplicit(explicitUnitCost, out var explicitCost))
            return explicitCost;

        if (reading is not null && TryFromLayers(reading.Cost, out var layerCost))
            return layerCost;

        return Fallback(
            product,
            reading?.Cost.CachedAverageCost ?? cachedAverageCost ?? 0m,
            allowPurchasePriceCascade);
    }

    private static bool TryExplicit(decimal? explicitUnitCost, out StockEntryCost cost)
    {
        if (explicitUnitCost is { } value && value > 0m)
        {
            cost = new StockEntryCost(value, StockEntryCostOrigin.Explicit);
            return true;
        }

        cost = default!;
        return false;
    }

    /// <summary>
    /// Le coût moyen des couches RESTANTES — et non le coût de la prochaine sortie.
    ///
    /// Distinction volontaire : le coût de la prochaine sortie est une information d'affichage,
    /// alors qu'une entrée dont on ignore le prix représente une moyenne de ce qui est déjà là.
    /// Valoriser une entrée au coût de la plus récente couche ferait dériver le stock à la hausse
    /// à chaque ajustement.
    /// </summary>
    private static bool TryFromLayers(StockCostSnapshot snapshot, out StockEntryCost cost)
    {
        if (snapshot.Layered && snapshot.HasLayers && snapshot.LayerQuantity > 0m)
        {
            cost = new StockEntryCost(
                snapshot.StockValue / snapshot.LayerQuantity,
                StockEntryCostOrigin.Layers);
            return true;
        }

        cost = default!;
        return false;
    }

    private static StockEntryCost Fallback(
        Product? product,
        decimal cachedAverageCost,
        bool allowPurchasePriceCascade)
    {
        if (cachedAverageCost > 0m)
            return new StockEntryCost(cachedAverageCost, StockEntryCostOrigin.Cache);

        if (allowPurchasePriceCascade && product is not null)
        {
            var lastPurchase = product.LastPurchasePrice?.Amount ?? 0m;
            if (lastPurchase > 0m)
                return new StockEntryCost(lastPurchase, StockEntryCostOrigin.PurchasePriceCascade);

            var purchase = product.GetPurchasePrice().Amount;
            if (purchase > 0m)
                return new StockEntryCost(purchase, StockEntryCostOrigin.PurchasePriceCascade);
        }

        return new StockEntryCost(0m, StockEntryCostOrigin.Zero);
    }
}
