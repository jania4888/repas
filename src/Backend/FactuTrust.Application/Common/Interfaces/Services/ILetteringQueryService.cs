using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Lecture filtrée/paginée dédiée à l'écran de lettrage (plan de refonte, §4.1/4.2). Service
/// séparé d'<see cref="IAccountingReportingService"/> (déjà volumineux) : il se teste isolément et
/// sera réutilisé par le moteur de propositions (Phase 3).
/// </summary>
public interface ILetteringQueryService
{
    Task<Result<LetteringLinesPageDto>> GetLinesAsync(GetLetteringLinesQuery query, CancellationToken cancellationToken = default);

    Task<Result<LetteringGroupDto>> GetGroupAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>
    /// Code de lettrage actuel de chaque ligne demandée (null si la ligne est libre). Une ligne
    /// introuvable est absente du résultat. Sert au lettrage en masse pour distinguer « déjà lettré
    /// en un seul groupe » d'un rejet (annexe C §4).
    /// </summary>
    Task<IReadOnlyDictionary<Guid, string?>> GetLineCodesAsync(
        IReadOnlyCollection<Guid> lineIds, CancellationToken cancellationToken = default);
}
