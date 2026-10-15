using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>La valorisation d'un article de stock (produit × entrepôt), telle que l'écran doit la montrer.</summary>
public sealed record StockCostReading(
    Guid StockItemId,
    Guid ProductId,
    Guid WarehouseId,
    StockCostSnapshot Cost);

/// <summary>
/// Une ligne de dérive entre le cache <c>StockItems.AverageCost</c> et les couches. Ne contient que
/// des identifiants et des nombres : aucun libellé, donc aucun passage par les portes i18n.
/// </summary>
public sealed record StockValuationDriftRow(
    Guid StockItemId,
    Guid ProductId,
    string ProductCode,
    Guid WarehouseId,
    string WarehouseName,
    CostingMethod CostingMethod,
    decimal QuantityOnHand,
    decimal CachedAverageCost,
    decimal CachedValue,
    int LayerCount,
    decimal LayerQuantity,
    decimal LayerValue,
    decimal? NextExitUnitCost,
    bool QuantityDrift,
    bool ValueDrift);

/// <summary>
/// La lecture de la valorisation, ensembliste et consciente de la méthode.
///
/// Toute implémentation doit respecter trois contraintes :
/// <list type="number">
/// <item>passer par la fabrique de contexte du tenant, en <c>AsNoTracking</c> — jamais de
///       connexion brute, jamais d'identifiant de tenant venant de la requête ;</item>
/// <item>n'émettre AUCUNE requête de couches quand le drapeau FIFO/LIFO est à false, pour que
///       l'écran soit identique au bit près dans ce cas ;</item>
/// <item>rester en une requête agrégée par appel — jamais un aller-retour par article.</item>
/// </list>
///
/// Ce port est réservé aux lectures HORS transaction. Sous transaction ouverte, lire les couches
/// par <see cref="IStockTraceabilityStore"/> : un nouveau contexte ne verrait pas les couches
/// encore en attente de persistance, et risquerait un blocage sur le verrou des articles de stock.
/// </summary>
public interface IStockValuationReader
{
    /// <summary>Lot d'articles de stock. Une seule requête agrégée, restreinte aux articles à couches.</summary>
    Task<IReadOnlyDictionary<Guid, StockCostReading>> GetByStockItemIdsAsync(
        IReadOnlyCollection<Guid> stockItemIds,
        CancellationToken cancellationToken = default);

    /// <summary>Un seul couple produit × entrepôt — la fiche article.</summary>
    Task<StockCostReading?> GetByProductAndWarehouseAsync(
        Guid productId,
        Guid warehouseId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// La valeur totale du stock, couches comprises, en une passe. Remplace la somme
    /// <c>quantité × cache</c> qui ignorait la méthode.
    /// </summary>
    Task<decimal> GetTotalStockValueAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default);

    /// <summary>Diagnostic : uniquement les lignes en écart.</summary>
    Task<IReadOnlyList<StockValuationDriftRow>> ListValuationDriftAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default);
}
