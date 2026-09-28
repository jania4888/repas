namespace FactuTrust.Application.Features.Products;

/// <summary>
/// Codes d'erreur produit stables, lus par le client web à la place du texte du message
/// (le message peut être traduit, le code jamais).
/// </summary>
public static class ProductErrorCodes
{
    /// <summary>Champ de <see cref="Domain.Common.Error.Validation"/> du passage CMUP → FIFO/LIFO refusé.</summary>
    public const string OpeningLayerRequiredField = "CostingMethod.OpeningLayerRequired";

    /// <summary>Code émis : le passage CMUP → FIFO/LIFO exige une couche d'ouverture (stock non nul).</summary>
    public const string OpeningLayerRequired = "Validation." + OpeningLayerRequiredField;
}
