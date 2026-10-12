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
}
