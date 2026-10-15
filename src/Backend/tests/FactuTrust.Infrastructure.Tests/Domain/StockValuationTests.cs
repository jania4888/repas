using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

/// <summary>
/// La règle UNIQUE « cet article est-il valorisé par couches ? ». Les six combinaisons comptent :
/// un produit marqué FIFO/LIFO en base avec le drapeau éteint doit répondre NON, sinon l'écran
/// annoncerait une valorisation que le moteur n'applique pas.
/// </summary>
public sealed class StockCostingPolicyTests
{
    [Theory]
    [InlineData(CostingMethod.Average, true, false)]
    [InlineData(CostingMethod.Average, false, false)]
    [InlineData(CostingMethod.Fifo, true, true)]
    [InlineData(CostingMethod.Fifo, false, false)]
    [InlineData(CostingMethod.Lifo, true, true)]
    [InlineData(CostingMethod.Lifo, false, false)]
    public void RequiresLayeredCosting_CoversEveryCombination(
        CostingMethod method, bool flagEnabled, bool expected)
    {
        Assert.Equal(expected, StockCostingPolicy.RequiresLayeredCosting(method, flagEnabled));
    }

    [Fact]
    public void RequiresLayeredCosting_NullProduct_IsPassthrough()
    {
        Assert.False(StockCostingPolicy.RequiresLayeredCosting(product: null, fifoLifoValuationEnabled: true));
    }
}

public sealed class StockValuationTests
{
    private static readonly DateTime T0 = new(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc);

    /// <summary>Trois couches : 10 @ 2, puis 10 @ 3, puis 10 @ 4. Valeur restante = 90.</summary>
    private static List<ValuationLayerSnapshot> ThreeLayers() =>
    [
        new(T0, Guid.Parse("00000000-0000-0000-0000-000000000001"), 10m, 2m),
        new(T0.AddDays(1), Guid.Parse("00000000-0000-0000-0000-000000000002"), 10m, 3m),
        new(T0.AddDays(2), Guid.Parse("00000000-0000-0000-0000-000000000003"), 10m, 4m)
    ];

    [Fact]
    public void Fifo_UnitCostIsOldestLayer()
    {
        var snapshot = StockValuation.FromLayers(
            CostingMethod.Fifo, layered: true, quantityOnHand: 30m, cachedAverageCost: 99m, ThreeLayers());

        Assert.Equal(2m, snapshot.UnitCost);
        Assert.Equal(90m, snapshot.StockValue);
        Assert.True(snapshot.UnitCostIsNextExit);
        Assert.False(snapshot.QuantityDrift);
    }

    [Fact]
    public void Lifo_UnitCostIsNewestLayer()
    {
        var snapshot = StockValuation.FromLayers(
            CostingMethod.Lifo, layered: true, quantityOnHand: 30m, cachedAverageCost: 99m, ThreeLayers());

        Assert.Equal(4m, snapshot.UnitCost);
        Assert.Equal(90m, snapshot.StockValue);
        Assert.True(snapshot.UnitCostIsNextExit);
    }

    /// <summary>
    /// Deux couches reçues au MÊME instant : le départage se fait par identifiant, exactement
    /// comme dans le moteur de consommation. Un tri sur la seule date les confondrait, et l'écran
    /// annoncerait une « prochaine sortie » que le moteur ne choisirait pas.
    /// </summary>
    [Fact]
    public void SameReceivedAt_IsBrokenByIdLikeTheEngine()
    {
        var low = Guid.Parse("00000000-0000-0000-0000-00000000000a");
        var high = Guid.Parse("00000000-0000-0000-0000-0000000000ff");
        var layers = new List<ValuationLayerSnapshot>
        {
            new(T0, high, 5m, 50m),
            new(T0, low, 5m, 10m)
        };

        Assert.Equal(10m, StockValuation.NextExitUnitCost(layers, CostingMethod.Fifo));
        Assert.Equal(50m, StockValuation.NextExitUnitCost(layers, CostingMethod.Lifo));
    }

    [Fact]
    public void ZeroQuantity_IsZeroEverywhere()
    {
        var snapshot = StockValuation.FromLayers(
            CostingMethod.Fifo, layered: true, quantityOnHand: 0m, cachedAverageCost: 7m, []);

        Assert.Equal(0m, snapshot.UnitCost);
        Assert.Equal(0m, snapshot.StockValue);
        Assert.False(snapshot.UnitCostIsNextExit);
    }

    /// <summary>
    /// Article FIFO sans aucune couche (drapeau activé après coup, ouverture jamais créée) :
    /// repli sur le cache plutôt qu'une valeur nulle. Faire disparaître la valeur à l'écran serait
    /// pire que d'afficher un coût approché.
    /// </summary>
    [Fact]
    public void LayeredWithoutLayers_FallsBackToCache()
    {
        var snapshot = StockValuation.FromLayers(
            CostingMethod.Fifo, layered: true, quantityOnHand: 6m, cachedAverageCost: 12m, []);

        Assert.False(snapshot.HasLayers);
        Assert.Equal(12m, snapshot.UnitCost);
        Assert.Equal(72m, snapshot.StockValue);
        Assert.False(snapshot.UnitCostIsNextExit);
    }

    /// <summary>Couches insuffisantes : le grand-livre l'emporte, et l'écart est SIGNALÉ.</summary>
    [Fact]
    public void PartialLayers_KeepLedgerValueAndFlagDrift()
    {
        var layers = new List<ValuationLayerSnapshot>
        {
            new(T0, Guid.NewGuid(), 4m, 10m)
        };

        var snapshot = StockValuation.FromLayers(
            CostingMethod.Fifo, layered: true, quantityOnHand: 10m, cachedAverageCost: 99m, layers);

        Assert.Equal(40m, snapshot.StockValue);
        Assert.True(snapshot.QuantityDrift);
    }

    /// <summary>
    /// Drapeau éteint sur un produit FIFO : comportement du cache, STRICTEMENT. C'est la garantie
    /// de non-régression de la livraison « drapeau off ».
    /// </summary>
    [Fact]
    public void FlagOff_BehavesExactlyLikeTheCache()
    {
        var snapshot = StockValuation.FromLayers(
            CostingMethod.Fifo, layered: false, quantityOnHand: 30m, cachedAverageCost: 5m, ThreeLayers());

        Assert.Equal(5m, snapshot.UnitCost);
        Assert.Equal(150m, snapshot.StockValue);
        Assert.False(snapshot.UnitCostIsNextExit);
        Assert.False(snapshot.QuantityDrift);
    }

    /// <summary>
    /// Le contrat assumé : en FIFO/LIFO, P.U. × Qté ≠ Valeur. Ce test l'ÉPINGLE — si quelqu'un
    /// « corrige » un jour la valeur en la recalculant à partir du P.U., il échouera.
    /// </summary>
    [Fact]
    public void UnitCostTimesQuantity_IsNotTheValue_AndThatIsTheContract()
    {
        var snapshot = StockValuation.FromLayers(
            CostingMethod.Lifo, layered: true, quantityOnHand: 30m, cachedAverageCost: 0m, ThreeLayers());

        Assert.Equal(90m, snapshot.StockValue);
        Assert.NotEqual(snapshot.StockValue, snapshot.UnitCost * snapshot.QuantityOnHand);
    }

    [Fact]
    public void Rounding_ValueIsTheSumOfLayers_NotAQuantizedAverage()
    {
        var layers = new List<ValuationLayerSnapshot>
        {
            new(T0, Guid.NewGuid(), 3m, 0.3333m)
        };

        var snapshot = StockValuation.FromLayers(
            CostingMethod.Fifo, layered: true, quantityOnHand: 3m, cachedAverageCost: 0m, layers);

        Assert.Equal(0.9999m, snapshot.StockValue);
    }

    [Fact]
    public void FromAggregate_PicksTheBoundaryMatchingTheMethod()
    {
        var fifo = StockValuation.FromAggregate(
            CostingMethod.Fifo, layered: true, quantityOnHand: 30m, cachedAverageCost: 0m,
            layerQuantity: 30m, layerValue: 90m,
            firstInUnitCost: 2m, lastInUnitCost: 4m, hasLayers: true);

        var lifo = StockValuation.FromAggregate(
            CostingMethod.Lifo, layered: true, quantityOnHand: 30m, cachedAverageCost: 0m,
            layerQuantity: 30m, layerValue: 90m,
            firstInUnitCost: 2m, lastInUnitCost: 4m, hasLayers: true);

        Assert.Equal(2m, fifo.UnitCost);
        Assert.Equal(4m, lifo.UnitCost);
        Assert.Equal(90m, fifo.StockValue);
        Assert.Equal(90m, lifo.StockValue);
    }
}

public sealed class ValuationLayerDriftTests
{
    [Fact]
    public void Inspect_ReportsHealthyState()
    {
        var drift = ValuationLayerInvariant.Inspect(
            quantityOnHand: 10m, cachedAverageCost: 5m, layerQuantity: 10m, layerValue: 50m);

        Assert.False(drift.QuantityDrift);
        Assert.False(drift.ValueDrift);
    }

    [Fact]
    public void Inspect_DetectsQuantityDrift()
    {
        var drift = ValuationLayerInvariant.Inspect(
            quantityOnHand: 10m, cachedAverageCost: 5m, layerQuantity: 7m, layerValue: 35m);

        Assert.True(drift.QuantityDrift);
        Assert.Equal(-3m, drift.QuantityDelta);
    }

    [Fact]
    public void Inspect_DetectsValueDrift()
    {
        var drift = ValuationLayerInvariant.Inspect(
            quantityOnHand: 10m, cachedAverageCost: 5m, layerQuantity: 10m, layerValue: 61m);

        Assert.False(drift.QuantityDrift);
        Assert.True(drift.ValueDrift);
        Assert.Equal(11m, drift.ValueDelta);
    }
}
