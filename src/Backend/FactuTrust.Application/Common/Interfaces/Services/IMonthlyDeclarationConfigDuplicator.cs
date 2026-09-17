using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Copie la configuration de la déclaration mensuelle d'un autre dossier du cabinet vers le dossier
/// courant — le bouton « Dupliquer la configuration DM ».
/// </summary>
/// <remarks>
/// L'opération traverse deux bases tenant. Elle vit donc en infrastructure, derrière cette
/// interface : la couche application ne connaît ni chaînes de connexion ni base maître.
/// </remarks>
public interface IMonthlyDeclarationConfigDuplicator
{
    /// <param name="sourceCompanyTenantId">
    /// Dossier source. <b>Jamais accepté tel quel</b> : l'implémentation exige qu'il appartienne au
    /// portefeuille du cabinet appelant, et au périmètre du collaborateur. C'est ce contrôle qui
    /// tient lieu de sécurité à toute la fonction.
    /// </param>
    /// <param name="overwrite">
    /// Faux : seules les rubriques dont le code est absent sont créées. Vrai : les codes en commun
    /// sont remplacés. Dans les deux cas, rien n'est supprimé en masse.
    /// </param>
    Task<Result<MonthlyDeclarationDuplicationResultDto>> DuplicateAsync(
        Guid sourceCompanyTenantId,
        bool overwrite,
        CancellationToken cancellationToken = default);
}
