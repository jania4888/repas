using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Application.Features.Accounting.Queries;

/// <summary>Fenêtre de comparaison des KPI du tableau de bord comptable du dossier.</summary>
public enum DashboardComparison
{
    /// <summary>Mois précédent (décembre de l'exercice précédent quand le mois est janvier).</summary>
    PreviousMonth = 0,
    /// <summary>Même mois de l'exercice précédent.</summary>
    PreviousYear = 1
}

/// <summary>Conversion entre l'enum et sa forme « kebab-case » exposée par l'API (<c>comparison=</c>).</summary>
public static class DashboardComparisonCodes
{
    public const string PreviousMonth = "previous-month";
    public const string PreviousYear = "previous-year";

    public static string ToCode(this DashboardComparison comparison) => comparison switch
    {
        DashboardComparison.PreviousYear => PreviousYear,
        _ => PreviousMonth
    };

    /// <summary>Null ou vide → <see cref="DashboardComparison.PreviousMonth"/> ; inconnu → null.</summary>
    public static DashboardComparison? TryParse(string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
            return DashboardComparison.PreviousMonth;
        return code.Trim().ToLowerInvariant() switch
        {
            PreviousMonth => DashboardComparison.PreviousMonth,
            PreviousYear => DashboardComparison.PreviousYear,
            _ => null
        };
    }
}

/// <summary>
/// Tableau de bord comptable du dossier (plan §3.2). Les paramètres sont optionnels : la période
/// est résolue par <see cref="IAccountingOverviewService.ResolvePeriodAsync"/>.
/// </summary>
public sealed record GetAccountingOverviewQuery(
    int? FiscalYear,
    int? Month,
    DashboardComparison Comparison = DashboardComparison.PreviousMonth)
    : IRequest<Result<AccountingOverviewDashboardDto>>;

/// <summary>
/// Orchestration : résolution de la période → cœur du tableau de bord (service, mis en cache) →
/// balances âgées clients/fournisseurs via <see cref="IMediator"/> (jamais mises en cache, à la
/// date du jour), repliées en <see cref="ThirdPartySituationDto"/>. Un échec de balance âgée ne
/// fait pas échouer le tableau de bord : le bloc est null et un avertissement est ajouté.
/// </summary>
public sealed class GetAccountingOverviewQueryHandler
    : IRequestHandler<GetAccountingOverviewQuery, Result<AccountingOverviewDashboardDto>>
{
    public const string ClientsAgingUnavailable = "La situation clients (411) est indisponible : la balance âgée n'a pas pu être calculée.";
    public const string SuppliersAgingUnavailable = "La situation fournisseurs (401) est indisponible : la balance âgée n'a pas pu être calculée.";

    private readonly IAccountingOverviewService _overview;
    private readonly IMediator _mediator;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<GetAccountingOverviewQueryHandler> _logger;

    public GetAccountingOverviewQueryHandler(
        IAccountingOverviewService overview,
        IMediator mediator,
        TimeProvider timeProvider,
        ILogger<GetAccountingOverviewQueryHandler> logger)
    {
        _overview = overview;
        _mediator = mediator;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task<Result<AccountingOverviewDashboardDto>> Handle(
        GetAccountingOverviewQuery request, CancellationToken cancellationToken)
    {
        var period = await _overview.ResolvePeriodAsync(request.FiscalYear, request.Month, cancellationToken);
        var core = await _overview.GetOverviewAsync(period, request.Comparison, cancellationToken);
        if (core.IsFailure)
            return core;

        var today = _timeProvider.GetLocalNow().Date;
        var warnings = new List<string>(core.Value.Warnings);

        var clients = await FoldAgingAsync(new GetClientAgingReportQuery(), today, ClientsAgingUnavailable, warnings, cancellationToken);
        var suppliers = await FoldAgingAsync(new GetSupplierAgingReportQuery(), today, SuppliersAgingUnavailable, warnings, cancellationToken);

        return Result.Success(core.Value with
        {
            Clients = clients,
            Suppliers = suppliers,
            Warnings = warnings
        });
    }

    private async Task<ThirdPartySituationDto?> FoldAgingAsync(
        IRequest<Result<IReadOnlyList<AgingReportRowDto>>> query,
        DateTime today,
        string warning,
        List<string> warnings,
        CancellationToken cancellationToken)
    {
        try
        {
            var aging = await _mediator.Send(query, cancellationToken);
            if (aging.IsFailure)
            {
                _logger.LogWarning("Balance âgée indisponible pour le tableau de bord : {Error}", aging.Error.Description);
                warnings.Add(warning);
                return null;
            }

            return Fold(aging.Value, today);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Balance âgée en erreur pour le tableau de bord.");
            warnings.Add(warning);
            return null;
        }
    }

    /// <summary>Agrège les lignes de balance âgée : à échéance = NotYetDue ; échus = toutes les tranches dépassées.</summary>
    public static ThirdPartySituationDto Fold(IReadOnlyList<AgingReportRowDto> rows, DateTime asOf) => new()
    {
        AsOf = asOf,
        Total = rows.Sum(r => r.Total),
        NotDue = rows.Sum(r => r.NotYetDue),
        Overdue = rows.Sum(r => r.Days0To30 + r.Days31To60 + r.Days61To90 + r.DaysOver90),
        ThirdPartyCount = rows.Count
    };
}
