using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Services;

/// <summary>
/// La règle UNIQUE « cet article est-il valorisé par couches ? ».
///
/// Elle est partagée par le moteur de mutation (le grand-livre), par les lectures d'écran et par
/// le diagnostic. C'est la condition pour que l'écran et le grand-livre ne puissent pas diverger :
/// si une lecture appliquait une règle différente du moteur — ne serait-ce que sur l'état du
/// drapeau — elle afficherait une valeur que le stock réel ne porte pas.
///
/// Toute copie locale de ce test est un bug en attente. Un test d'architecture interdit d'ailleurs
/// <see cref="CostingMethod.Fifo"/> hors de ce fichier, de <see cref="StockValuation"/> et de
/// <see cref="ProductTraceabilityRules"/>.
/// </summary>
public static class StockCostingPolicy
{
    /// <summary>La méthode est-elle « à couches » dans l'absolu, drapeau mis à part ?</summary>
    public static bool IsLayeredMethod(CostingMethod method)
        => method is CostingMethod.Fifo or CostingMethod.Lifo;

    /// <summary>
    /// La valorisation par couches s'applique-t-elle RÉELLEMENT ?
    ///
    /// Drapeau à false sur un produit marqué FIFO/LIFO en base : la réponse est NON, et c'est
    /// volontaire. Le moteur bascule alors en CMUP sans créer de couche ; la lecture doit retomber
    /// sur le cache de la même manière, sinon l'écran annoncerait une valorisation qui n'a pas eu lieu.
    /// </summary>
    public static bool RequiresLayeredCosting(CostingMethod method, bool fifoLifoValuationEnabled)
        => fifoLifoValuationEnabled && IsLayeredMethod(method);

    /// <inheritdoc cref="RequiresLayeredCosting(CostingMethod, bool)"/>
    /// <remarks>Produit inconnu (null) ⇒ passthrough CMUP, comme le moteur.</remarks>
    public static bool RequiresLayeredCosting(Product? product, bool fifoLifoValuationEnabled)
        => product is not null && RequiresLayeredCosting(product.CostingMethod, fifoLifoValuationEnabled);
}
