namespace FactuTrust.Application.Common.Interfaces;

/// <summary>
/// Noms d'affichage d'utilisateurs du tenant (base master), résolus en lot pour les DTO Studio
/// (4.5a1, D-45-01). Interface dédiée : <c>ITenantMemberDirectory</c> et
/// <c>IAssignableTenantUsersSource</c> chargent tout le tenant et replient sur l'email.
/// </summary>
public interface IStudioUserNameResolver
{
    /// <summary>
    /// « Prénom Nom » des utilisateurs <paramref name="userIds"/> appartenant à <paramref name="tenantId"/>,
    /// en une requête. Absents du résultat : identifiant inconnu, utilisateur d'un autre tenant, prénom et
    /// nom vides (jamais de repli email — D-45-02). Les utilisateurs désactivés sont conservés (acteur
    /// historique d'une instance de workflow).
    /// </summary>
    Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesAsync(
        Guid tenantId, IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);
}
