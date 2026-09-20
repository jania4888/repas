namespace FactuTrust.Application.Common.Identity;

/// <summary>
/// Résout l'instantané d'identité d'un utilisateur à impersonner par un traitement sans HTTP ni canal.
/// </summary>
public interface IImpersonationSnapshotResolver
{
    /// <summary>
    /// Relit la base maître (aucun cache) et renvoie l'instantané, ou <c>null</c> en cas de refus :
    /// utilisateur absent, inactif, appartenant à un autre tenant que <paramref name="tenantId"/>,
    /// porteur d'un rôle plateforme, ou sans rôle applicatif reconnu. Un refus ne lève jamais
    /// d'exception : l'appelant traite <c>null</c> comme « exécution interdite » (fail-closed).
    /// </summary>
    /// <param name="tenantId">Tenant attendu — l'utilisateur doit lui appartenir.</param>
    /// <param name="userId">Utilisateur à impersonner.</param>
    /// <param name="origin">Origine du traitement, recopiée dans l'instantané (ex. <c>studio-workflow:{instanceId:N}</c>).</param>
    /// <param name="ct">Jeton d'annulation.</param>
    Task<ImpersonatedUserSnapshot?> ResolveAsync(Guid tenantId, Guid userId, string origin, CancellationToken ct);
}
