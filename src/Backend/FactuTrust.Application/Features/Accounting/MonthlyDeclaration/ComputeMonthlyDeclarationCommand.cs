using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// « Calcul DM » : évalue la configuration du dossier sur une période et rend le détail obtenu.
/// </summary>
/// <remarks>
/// <para>
/// La commande ne dépose rien. Elle calcule, consigne et rend — l'enregistrement reste l'affaire de
/// <c>SaveVatDeclarationCommand</c>. Séparer les deux permet de relancer un calcul autant de fois
/// qu'il le faut sans toucher au document.
/// </para>
/// <para>
/// C'est une lecture, mais une lecture <b>auditée</b> : la trace dit quels montants la configuration
/// produisait ce jour-là, et avec quels signalements. Elle garde donc le même verrou que les
/// écritures — c'est aussi ce qui évite qu'une société puisse sonder les brouillons de son dossier.
/// </para>
/// </remarks>
public sealed record ComputeMonthlyDeclarationCommand(int Year, int Month)
    : IRequest<Result<VatDeclarationDto>>;

public sealed class ComputeMonthlyDeclarationCommandHandler
    : IRequestHandler<ComputeMonthlyDeclarationCommand, Result<VatDeclarationDto>>
{
    private readonly IMediator _mediator;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public ComputeMonthlyDeclarationCommandHandler(
        IMediator mediator,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _mediator = mediator;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<VatDeclarationDto>> Handle(
        ComputeMonthlyDeclarationCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.MonthlyDeclarationV2Enabled)
            return Result.Failure<VatDeclarationDto>(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure<VatDeclarationDto>(MonthlyDeclarationGuard.WriteDenied);
        if (request.Year is < 2000 or > 2100)
            return Result.Failure<VatDeclarationDto>(Error.Validation("Year", "Exercice invalide."));
        if (request.Month is < 1 or > 12)
            return Result.Failure<VatDeclarationDto>(Error.Validation("Month", "Mois invalide."));

        // Valorisation « vivante » : le calcul doit rendre ce que la configuration produit
        // aujourd'hui, même si une déclaration est déjà déposée pour la période — c'est tout
        // l'intérêt de l'écran.
        var computed = await _mediator.Send(
            new GetVatDeclarationQuery(request.Year, request.Month, Valuation: VatDeclarationValuation.Live),
            cancellationToken);
        if (computed.IsFailure)
            return computed;

        var dto = computed.Value;

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationComputed,
            nameof(VatDeclaration), Guid.Empty,
            newValues: new
            {
                request.Year,
                request.Month,
                LineCount = dto.Lines.Count,
                FamilyTotals = FamilyTotals(dto),
                // Les codes de diagnostic, et pas seulement leur nombre : c'est la trace qui
                // expliquera, des mois plus tard, pourquoi un montant déposé diffère d'un recalcul.
                Diagnostics = dto.MonthlyDeclarationDiagnostics
                    .Select(d => new { Kind = ((RubricDiagnosticKind)d.Kind).ToString(), d.Detail })
                    .ToList()
            },
            cancellationToken: cancellationToken);

        return Result.Success(dto);
    }

    private static Dictionary<string, decimal> FamilyTotals(VatDeclarationDto dto) =>
        dto.Lines
            .GroupBy(l => (MonthlyDeclarationFamily)l.Family)
            .ToDictionary(g => g.Key.ToString(), g => g.Sum(l => l.Withheld));
}
