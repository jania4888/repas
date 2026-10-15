using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Services;

/// <summary>
/// Projection minimale d'une couche ouverte : ce dont la valorisation a besoin, et rien de plus.
/// Sans dépendance EF ni entité, pour que le même réducteur serve une lecture SQL agrégée, une
/// écriture sous transaction et un test unitaire.
/// </summary>
public readonly record struct ValuationLayerSnapshot(
    DateTime ReceivedAt,
    Guid Id,
    decimal RemainingQuantity,
    decimal UnitCost);

/// <summary>
/// Le résultat unique de la valorisation d'un article de stock, consommé par les écrans, par les
/// écritures et par le diagnostic.
/// </summary>
/// <param name="UnitCost">
/// Couches : le coût de la PROCHAINE SORTIE. CMUP (ou repli) : le coût moyen pondéré.
/// </param>
/// <param name="StockValue">
/// Couches : la somme des couches restantes. CMUP (ou repli) : quantité × coût moyen.
/// </param>
/// <param name="UnitCostIsNextExit">
/// Vrai ⇒ <paramref name="UnitCost"/> est un coût de prochaine sortie, donc
/// <c>UnitCost × QuantityOnHand ≠ StockValue</c>, et l'écran DOIT l'expliquer.
/// </param>
/// <param name="QuantityDrift">
/// Vrai ⇒ les couches ne totalisent pas la quantité en stock. La valeur retournée reste celle des
/// couches (le grand-livre fait foi), mais la ligne est à signaler et à réparer.
/// </param>
public sealed record StockCostSnapshot(
    CostingMethod CostingMethod,
    bool Layered,
    bool HasLayers,
    decimal QuantityOnHand,
    decimal UnitCost,
    decimal StockValue,
    decimal LayerQuantity,
    decimal CachedAverageCost,
    bool UnitCostIsNextExit,
    bool QuantityDrift);

/// <summary>
/// Le réducteur UNIQUE « couches → (coût unitaire, valeur) ».
///
/// Il existe deux chemins d'entrée parce qu'il y a deux situations, pas deux règles :
/// <see cref="FromLayers"/> quand on a les couches en main (écriture sous transaction, diagnostic
/// unitaire), <see cref="FromAggregate"/> quand le SQL a déjà agrégé (état de stock, liste) et
/// qu'il serait absurde de rapatrier les lignes. Les deux appliquent le même tableau de repli.
/// </summary>
public static class StockValuation
{
    /// <summary>Tolérance de quantité — la même constante que l'invariant, jamais une copie.</summary>
    public const decimal QuantityTolerance = ValuationLayerInvariant.Tolerance;

    /// <summary>
    /// Tolérance de valeur. Volontairement plus lâche que celle des quantités : une quantité à
    /// 4 décimales multipliée par un coût à 4 décimales ne peut pas se comparer à 0,0001.
    /// </summary>
    public const decimal ValueTolerance = ValuationLayerInvariant.ValueTolerance;

    /// <summary>
    /// L'ORDRE DE CONSOMMATION — l'unique définition dans tout le produit.
    ///
    /// LIFO : <c>ReceivedAt</c> décroissant puis <c>Id</c> décroissant.
    /// FIFO (et tout le reste) : <c>ReceivedAt</c> croissant puis <c>Id</c> croissant.
    ///
    /// Le départage par <c>Id</c> n'est pas cosmétique : deux couches reçues dans la même
    /// milliseconde sont fréquentes (import, transfert, restauration d'avoir). Un tri sur la seule
    /// date les confondrait, et l'écran annoncerait une « prochaine sortie » que le moteur ne
    /// choisirait pas.
    /// </summary>
    public static IOrderedEnumerable<T> OrderForConsumption<T>(
        IEnumerable<T> layers,
        CostingMethod method,
        Func<T, DateTime> receivedAt,
        Func<T, Guid> id)
    {
        ArgumentNullException.ThrowIfNull(layers);
        ArgumentNullException.ThrowIfNull(receivedAt);
        ArgumentNullException.ThrowIfNull(id);

        return method == CostingMethod.Lifo
            ? layers.OrderByDescending(receivedAt).ThenByDescending(id)
            : layers.OrderBy(receivedAt).ThenBy(id);
    }

    /// <summary>Le coût de la couche qui sortirait au prochain mouvement, ou null s'il n'y en a aucune.</summary>
    public static decimal? NextExitUnitCost(
        IEnumerable<ValuationLayerSnapshot> openLayers,
        CostingMethod method)
    {
        ArgumentNullException.ThrowIfNull(openLayers);

        var ordered = OrderForConsumption(openLayers, method, l => l.ReceivedAt, l => l.Id);
        foreach (var layer in ordered)
            return layer.UnitCost;

        return null;
    }

    /// <summary>La valeur restante : la somme des couches. Jamais quantité × coût moyen.</summary>
    public static decimal RemainingValue(IEnumerable<ValuationLayerSnapshot> openLayers)
    {
        ArgumentNullException.ThrowIfNull(openLayers);
        return openLayers.Sum(l => l.RemainingQuantity * l.UnitCost);
    }

    /// <summary>
    /// Chemin « j'ai les couches en main » : écritures sous transaction ambiante, diagnostic unitaire.
    /// </summary>
    public static StockCostSnapshot FromLayers(
        CostingMethod method,
        bool layered,
        decimal quantityOnHand,
        decimal cachedAverageCost,
        IEnumerable<ValuationLayerSnapshot> openLayers)
    {
        ArgumentNullException.ThrowIfNull(openLayers);

        var materialized = openLayers as IReadOnlyCollection<ValuationLayerSnapshot> ?? openLayers.ToList();
        var layerQuantity = materialized.Sum(l => l.RemainingQuantity);
        var layerValue = materialized.Sum(l => l.RemainingQuantity * l.UnitCost);
        var nextExit = materialized.Count == 0 ? null : NextExitUnitCost(materialized, method);

        return Build(method, layered, quantityOnHand, cachedAverageCost, materialized.Count > 0,
            layerQuantity, layerValue, nextExit);
    }

    /// <summary>
    /// Chemin « le SQL a déjà agrégé » : état de stock, liste de stock. Évite de rapatrier les
    /// couches ligne à ligne. Les deux frontières sont fournies ensemble pour qu'un seul
    /// aller-retour serve FIFO et LIFO — le choix se fait ici, où la méthode est connue.
    /// </summary>
    /// <param name="firstInUnitCost">Coût de la couche la plus ancienne — la frontière FIFO.</param>
    /// <param name="lastInUnitCost">Coût de la couche la plus récente — la frontière LIFO.</param>
    public static StockCostSnapshot FromAggregate(
        CostingMethod method,
        bool layered,
        decimal quantityOnHand,
        decimal cachedAverageCost,
        decimal layerQuantity,
        decimal layerValue,
        decimal? firstInUnitCost,
        decimal? lastInUnitCost,
        bool hasLayers)
    {
        var nextExit = method == CostingMethod.Lifo ? lastInUnitCost : firstInUnitCost;
        return Build(method, layered, quantityOnHand, cachedAverageCost, hasLayers,
            layerQuantity, layerValue, nextExit);
    }

    /// <summary>
    /// Le tableau de repli, appliqué identiquement par les deux chemins d'entrée. C'est la décision
    /// qui évite de faire disparaître de la valeur à l'écran :
    ///
    /// <list type="bullet">
    /// <item>non « layered » (CMUP, ou drapeau à false) ⇒ le cache, comme aujourd'hui ;</item>
    /// <item>« layered » avec des couches ⇒ la frontière et la somme des couches ;</item>
    /// <item>« layered » SANS couche (drapeau activé après coup, ouverture jamais créée)
    ///       ⇒ repli sur le cache plutôt qu'une valeur nulle, et <c>HasLayers = false</c> ;</item>
    /// <item>quantité nulle ⇒ tout à zéro ;</item>
    /// <item>couches partielles ⇒ la valeur des couches l'emporte (le grand-livre fait foi) et
    ///       l'écart est signalé par <c>QuantityDrift</c>, puis réparé par le runbook.</item>
    /// </list>
    /// </summary>
    private static StockCostSnapshot Build(
        CostingMethod method,
        bool layered,
        decimal quantityOnHand,
        decimal cachedAverageCost,
        bool hasLayers,
        decimal layerQuantity,
        decimal layerValue,
        decimal? nextExitUnitCost)
    {
        if (quantityOnHand <= 0)
        {
            return new StockCostSnapshot(
                method, layered, hasLayers, quantityOnHand,
                UnitCost: 0m, StockValue: 0m,
                LayerQuantity: layerQuantity,
                CachedAverageCost: cachedAverageCost,
                UnitCostIsNextExit: false,
                QuantityDrift: false);
        }

        if (!layered || !hasLayers)
        {
            return new StockCostSnapshot(
                method, layered, hasLayers, quantityOnHand,
                UnitCost: cachedAverageCost,
                StockValue: quantityOnHand * cachedAverageCost,
                LayerQuantity: layerQuantity,
                CachedAverageCost: cachedAverageCost,
                UnitCostIsNextExit: false,
                QuantityDrift: false);
        }

        return new StockCostSnapshot(
            method, layered, hasLayers, quantityOnHand,
            UnitCost: nextExitUnitCost ?? cachedAverageCost,
            StockValue: layerValue,
            LayerQuantity: layerQuantity,
            CachedAverageCost: cachedAverageCost,
            UnitCostIsNextExit: nextExitUnitCost.HasValue,
            QuantityDrift: Math.Abs(layerQuantity - quantityOnHand) > QuantityTolerance);
    }
}
