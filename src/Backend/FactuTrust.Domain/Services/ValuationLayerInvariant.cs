using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Services;

public static class ValuationLayerInvariant
{
    public const decimal Tolerance = 0.0001m;

    public static Result AssertMatchesOnHand(decimal quantityOnHand, IEnumerable<decimal> remainingQuantities)
    {
        var sum = remainingQuantities.Sum();
        if (Math.Abs(quantityOnHand - sum) > Tolerance)
        {
            return Result.Failure(Error.Validation(
                "ValuationLayer",
                $"Incohérence couches/stock: on-hand {quantityOnHand} ≠ somme couches {sum}"));
        }

        return Result.Success();
    }

    /// <summary>
    /// Constat de dérive, SANS jugement : renvoie l'écart, ne fait échouer personne.
    ///
    /// Volontairement distinct de <see cref="AssertMatchesOnHand"/> : faire échouer une facture
    /// parce qu'une donnée historique a dérivé est inacceptable. Le constat sert à journaliser et
    /// à alimenter le diagnostic ; la réparation est une opération à part.
    /// </summary>
    public static StockValuationDrift Inspect(
        decimal quantityOnHand,
        decimal cachedAverageCost,
        decimal layerQuantity,
        decimal layerValue)
    {
        var quantityDelta = layerQuantity - quantityOnHand;
        var valueDelta = layerValue - (quantityOnHand * cachedAverageCost);

        return new StockValuationDrift(
            QuantityDrift: Math.Abs(quantityDelta) > Tolerance,
            // Tolérance de valeur plus lâche : une quantité à 4 décimales multipliée par un coût à
            // 4 décimales ne peut pas se comparer à 0,0001.
            ValueDrift: Math.Abs(valueDelta) > ValueTolerance,
            QuantityDelta: quantityDelta,
            ValueDelta: valueDelta);
    }

    /// <summary>Tolérance de comparaison des valeurs. Voir <see cref="Inspect"/>.</summary>
    public const decimal ValueTolerance = 0.001m;
}

/// <summary>Écart constaté entre le cache d'affichage et les couches. Purement descriptif.</summary>
public readonly record struct StockValuationDrift(
    bool QuantityDrift,
    bool ValueDrift,
    decimal QuantityDelta,
    decimal ValueDelta);
