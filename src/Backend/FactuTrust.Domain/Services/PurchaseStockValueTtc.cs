using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Services;

/// <summary>
/// Valeur de stock TTC d'achat : la valeur HT déjà calculée, multipliée par le taux de TVA
/// actuel de la fiche article. Ce calcul ne passe pas par <see cref="StockValuation"/> :
/// le HT (couches FIFO/LIFO ou CMUP) reste inchangé, et un taux inconnu ne fait pas échouer le rapport.
/// </summary>
public static class PurchaseStockValueTtc
{
    /// <summary>
    /// <paramref name="stockValueHt"/> × (1 + taux / 100) pour un taux tunisien connu.
    /// Taux hors enum : la valeur HT, telle quelle. Valeur HT nulle : 0.
    /// </summary>
    public static decimal FromHt(decimal stockValueHt, VatRate rate)
    {
        if (stockValueHt == 0m || !Enum.IsDefined(rate))
            return stockValueHt;

        return stockValueHt * (1m + rate.ToPercentage());
    }

    /// <summary>Pourcentage entier du taux (0, 7, 13, 19), ou 0 si le taux stocké n'est pas connu.</summary>
    public static int Percent(VatRate rate) => Enum.IsDefined(rate) ? (int)rate : 0;
}
