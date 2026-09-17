using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

public interface IVatDeclarationRepository
{
    Task<VatDeclaration?> GetByYearMonthAsync(int year, int month, CancellationToken cancellationToken = default);

    /// <summary>
    /// Les déclarations déposées d'un exercice, triées par mois — la lecture du « Suivi DM ».
    /// </summary>
    /// <remarks>
    /// Le détail par rubrique n'est <b>pas</b> chargé : le suivi compte et date, il n'affiche aucune
    /// ligne, et tirer douze détails complets pour n'en montrer aucun coûterait une requête lourde
    /// à chaque ouverture d'écran.
    /// </remarks>
    Task<IReadOnlyList<VatDeclaration>> GetByYearAsync(int year, CancellationToken cancellationToken = default);
    Task<VatDeclaration> AddAsync(VatDeclaration entity, CancellationToken cancellationToken = default);
    Task UpdateAsync(VatDeclaration entity, CancellationToken cancellationToken = default);
}
