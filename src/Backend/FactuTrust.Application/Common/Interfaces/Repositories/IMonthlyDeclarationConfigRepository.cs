using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Configuration de la déclaration mensuelle du dossier : inclusion des familles, rubriques et
/// comptes sélectionnés. C'est la seule source des montants calculés.
/// </summary>
/// <remarks>
/// Les lectures destinées au moteur chargent toujours les comptes avec leurs rubriques : le
/// composeur doit connaître l'union des comptes <b>avant</b> d'interroger le journal, sous peine de
/// retomber sur une requête par rubrique.
/// </remarks>
public interface IMonthlyDeclarationConfigRepository
{
    Task<IReadOnlyList<MonthlyDeclarationFamilySetting>> GetFamilySettingsAsync(
        CancellationToken cancellationToken = default);

    Task<MonthlyDeclarationFamilySetting?> GetFamilySettingAsync(
        MonthlyDeclarationFamily family, CancellationToken cancellationToken = default);

    Task SaveFamilySettingAsync(
        MonthlyDeclarationFamilySetting setting, CancellationToken cancellationToken = default);

    /// <summary>
    /// Le catalogue de rubriques a-t-il été posé sur ce dossier ?
    /// </summary>
    /// <remarks>
    /// La pose a lieu à l'amorçage et ne peut échouer que transitoirement. Tant qu'elle n'a pas
    /// abouti, le dossier porte une configuration qui ne reproduit pas ce qu'il déclarait : écrire
    /// par-dessus, ou enregistrer une déclaration, produirait des montants faux que rien ne
    /// signalerait.
    /// </remarks>
    Task<bool> IsCatalogAppliedAsync(CancellationToken cancellationToken = default);

    /// <summary>Rubriques du dossier, comptes compris, triées par famille puis ordre d'affichage.</summary>
    Task<IReadOnlyList<MonthlyDeclarationRubric>> GetRubricsAsync(
        bool includeInactive, CancellationToken cancellationToken = default);

    Task<MonthlyDeclarationRubric?> GetRubricByIdAsync(Guid id, CancellationToken cancellationToken = default);

    Task<MonthlyDeclarationRubric?> GetRubricByCodeAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>Nombre de rubriques du dossier, pour le contrôle du plafond de cardinalité.</summary>
    Task<int> CountRubricsAsync(CancellationToken cancellationToken = default);

    Task AddRubricAsync(MonthlyDeclarationRubric rubric, CancellationToken cancellationToken = default);

    /// <summary>
    /// Met à jour la rubrique <b>et</b> remplace ses comptes. Les deux vont ensemble : une règle
    /// « sur comptes » dont les comptes n'auraient pas suivi calculerait sur l'ancienne sélection.
    /// </summary>
    Task UpdateRubricAsync(MonthlyDeclarationRubric rubric, CancellationToken cancellationToken = default);

    Task DeleteRubricAsync(MonthlyDeclarationRubric rubric, CancellationToken cancellationToken = default);
}
