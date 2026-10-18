using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Période civile (mois, année) retenue pour le tableau de bord comptable d'un dossier délégué
/// (plan §3.4). L'exercice est l'année civile — même convention que <c>FiscalAnchorHelper</c> et les
/// autres états de synthèse.
/// </summary>
public sealed record OverviewPeriod(int FiscalYear, int Month)
{
    public DateTime Start => new(FiscalYear, Month, 1);
    public DateTime End => new(FiscalYear, Month, DateTime.DaysInMonth(FiscalYear, Month));
}

/// <summary>
/// Calcule le tableau de bord comptable d'un dossier (plan §3.4) : résolution de la période par
/// défaut puis agrégats du journal (KPI, graphiques, comptes principaux, écritures/échéances/pièces
/// récentes). N'inclut PAS la balance âgée (orchestrée par <c>GetAccountingOverviewQueryHandler</c>
/// via <see cref="MediatR.IMediator"/>, comme <c>GetAccountingDashboardQueryHandler</c>).
/// </summary>
public interface IAccountingOverviewService
{
    /// <summary>
    /// Résout la période effective à partir des paramètres optionnels de la requête (plan §3.4) :
    /// les deux fournis → utilisés tels quels ; l'exercice seul → le mois courant si l'exercice
    /// est l'année courante, sinon décembre ; aucun → la période courante, avec repli sur la
    /// dernière période ayant des écritures validées si l'année courante n'en porte aucune.
    /// </summary>
    Task<OverviewPeriod> ResolvePeriodAsync(int? fiscalYear, int? month, CancellationToken cancellationToken = default);

    /// <summary>
    /// Calcule le cœur du tableau de bord (hors balance âgée) pour la période et la comparaison
    /// données. Résultat mis en cache par tenant (plan §3.4, TTL <c>AccountingSettings.DashboardOverviewCacheSeconds</c>).
    /// </summary>
    Task<Result<AccountingOverviewDashboardDto>> GetOverviewAsync(
        OverviewPeriod period, DashboardComparison comparison, CancellationToken cancellationToken = default);
}
