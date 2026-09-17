using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// « Suivi DM » — les douze mois d'un exercice en une lecture : ce qui est déposé, ce qui ne l'est
/// pas, sous quel régime, et où en est la rampe du dossier.
/// </summary>
/// <remarks>
/// <para>
/// Lecture sous <c>accounting:read</c>, et ouverte à la société : le suivi ne dit rien qu'un
/// dossier ne puisse savoir de ses propres dépôts.
/// </para>
/// <para>
/// Disponible <b>drapeau éteint</b>. Les colonnes propres à la déclaration paramétrable valent
/// alors « calcul historique » partout, ce qui est exactement la vérité : l'écran sert d'abord à
/// voir les trous de dépôt, et ce besoin-là ne dépend d'aucun drapeau.
/// </para>
/// </remarks>
public sealed record GetMonthlyDeclarationTrackingQuery(int Year)
    : IRequest<Result<MonthlyDeclarationTrackingDto>>;

public sealed class GetMonthlyDeclarationTrackingQueryHandler
    : IRequestHandler<GetMonthlyDeclarationTrackingQuery, Result<MonthlyDeclarationTrackingDto>>
{
    private readonly IVatDeclarationRepository _declarations;
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly AccountingSettings _settings;

    public GetMonthlyDeclarationTrackingQueryHandler(
        IVatDeclarationRepository declarations,
        IMonthlyDeclarationConfigRepository config,
        IOptions<AccountingSettings> settings)
    {
        _declarations = declarations;
        _config = config;
        _settings = settings.Value;
    }

    public async Task<Result<MonthlyDeclarationTrackingDto>> Handle(
        GetMonthlyDeclarationTrackingQuery request, CancellationToken cancellationToken)
    {
        if (request.Year is < 2000 or > 2100)
            return Result.Failure<MonthlyDeclarationTrackingDto>(Error.Validation("Year", "Exercice invalide."));

        var declarations = await _declarations.GetByYearAsync(request.Year, cancellationToken);
        var byMonth = declarations.ToDictionary(d => d.Month);

        var settings = await _config.GetSettingsAsync(cancellationToken);
        var v2 = _settings.MonthlyDeclarationV2Enabled;

        var months = new List<MonthlyDeclarationTrackingRowDto>(12);
        for (var month = 1; month <= 12; month++)
        {
            // Le régime est celui de la période, pas celui du dossier aujourd'hui : un dossier
            // basculé en juillet a des mois de janvier à juin restés au calcul historique, et les
            // afficher tous « paramétrés » raconterait une histoire fausse.
            var mode = settings?.ResolveModeFor(request.Year, month)
                       ?? Domain.Enums.MonthlyDeclarationMode.Legacy;

            months.Add(byMonth.TryGetValue(month, out var declaration)
                ? Map(declaration, mode, v2)
                : Missing(request.Year, month, mode));
        }

        return Result.Success(new MonthlyDeclarationTrackingDto
        {
            Year = request.Year,
            Settings = MonthlyDeclarationConfigMapper.Map(settings, _settings.ConfigurableLinesActive),
            Months = months
        });
    }

    /// <summary>
    /// Une période sans dépôt reste une ligne, avec son échéance. C'est le trou que l'écran doit
    /// montrer ; l'omettre le rendrait invisible au moment où il compte le plus.
    /// </summary>
    private static MonthlyDeclarationTrackingRowDto Missing(
        int year, int month, Domain.Enums.MonthlyDeclarationMode mode) => new()
    {
        Month = month,
        Exists = false,
        FilingDeadline = VatFilingDeadline.ForPeriod(year, month),
        Mode = (int)mode
    };

    private static MonthlyDeclarationTrackingRowDto Map(
        VatDeclaration d, Domain.Enums.MonthlyDeclarationMode mode, bool v2) => new()
    {
        Month = d.Month,
        Exists = true,
        Status = (int)d.Status,
        SubmittedAt = d.SubmittedAt,
        UpdatedAt = d.UpdatedAt,
        // Même expression que l'écran de déclaration, et non une copie : deux formules du total à
        // payer finiraient par donner deux chiffres pour la même période.
        TotalToPay = GetVatDeclarationQueryHandler.TotalToPay(
            GetVatDeclarationQueryHandler.TaxAmounts.FromEntity(d), v2),
        VatDue = d.VatDue.Amount,
        RevisionNumber = d.RevisionNumber,
        IsRectificative = d.IsRectificative,
        FilingDeadline = VatFilingDeadline.ForPeriod(d.Year, d.Month),
        Mode = (int)mode
    };
}
