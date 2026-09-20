namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// 4.7 suite (D-47-93) : garde défensive pour les repositories à paramètres de page bruts.
/// La couche Application borne « page » avant d'appeler ces méthodes, mais un appelant futur ou un
/// chemin interne pourrait passer <c>page ≈ int.MaxValue</c> avec <c>pageSize</c> grand : le produit
/// <c>(page - 1) * pageSize</c> déborderait alors en négatif et SQL Server rejetterait l'OFFSET
/// (500). <see cref="SafeSkip"/> borne le décalage à <see cref="int.MaxValue"/> au lieu de déborder —
/// la page demandée est alors simplement vide. Identité pour toute valeur saine.
/// </summary>
internal static class PagingBounds
{
    /// <summary>Décalage de pagination borné à <see cref="int.MaxValue"/> (jamais négatif).</summary>
    internal static int SafeSkip(int page, int pageSize)
    {
        var offset = (long)(Math.Max(1, page) - 1) * Math.Max(1, pageSize);
        return offset > int.MaxValue ? int.MaxValue : (int)offset;
    }
}
