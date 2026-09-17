using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// « Dupliquer la configuration DM » : reprend le paramétrage d'un autre dossier du cabinet.
/// </summary>
public sealed record DuplicateMonthlyDeclarationConfigCommand(
    DuplicateMonthlyDeclarationConfigRequest Request)
    : IRequest<Result<MonthlyDeclarationDuplicationResultDto>>;

public sealed class DuplicateMonthlyDeclarationConfigCommandHandler
    : IRequestHandler<DuplicateMonthlyDeclarationConfigCommand, Result<MonthlyDeclarationDuplicationResultDto>>
{
    private readonly IMonthlyDeclarationConfigDuplicator _duplicator;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public DuplicateMonthlyDeclarationConfigCommandHandler(
        IMonthlyDeclarationConfigDuplicator duplicator,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _duplicator = duplicator;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<MonthlyDeclarationDuplicationResultDto>> Handle(
        DuplicateMonthlyDeclarationConfigCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure<MonthlyDeclarationDuplicationResultDto>(MonthlyDeclarationGuard.WriteDenied);

        var result = await _duplicator.DuplicateAsync(
            request.Request.SourceCompanyTenantId, request.Request.Overwrite, cancellationToken);
        if (result.IsFailure)
            return result;

        // Journalisé dans la DESTINATION uniquement : la source n'a pas été modifiée, et y inscrire
        // une trace reviendrait à écrire dans un dossier qu'on s'est contenté de lire.
        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationConfigDuplicated,
            nameof(MonthlyDeclarationRubric), Guid.Empty,
            newValues: new
            {
                request.Request.SourceCompanyTenantId,
                request.Request.Overwrite,
                result.Value.Inserted,
                result.Value.Replaced,
                Skipped = result.Value.SkippedCodes,
                result.Value.UnknownAccounts
            },
            cancellationToken: cancellationToken);

        return result;
    }
}
