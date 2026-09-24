using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

// Configuration DM : le paramétrage, par dossier, du calcul de chaque rubrique de la déclaration
// mensuelle. Les ÉCRITURES sont gardées par AccountingSettings.ConfigurableLinesActive et par le
// contexte cabinet délégué ; la LECTURE reste ouverte drapeau éteint, et se contente de le signaler
// — un écran qui explique « fonctionnalité non activée » vaut mieux qu'un écran en erreur, et la
// configuration amorcée n'est que de la donnée de référence inerte.

internal static class MonthlyDeclarationGuard
{
    /// <summary>
    /// Refus quand l'interrupteur serveur est éteint. Il est global à la plateforme, pas propre au
    /// dossier : le message le dit, sans nommer la clé de configuration à l'utilisateur final.
    /// </summary>
    public static Error Disabled { get; } = Error.Validation(
        "MonthlyDeclaration",
        "La déclaration mensuelle paramétrable est désactivée sur la plateforme : aucun dossier ne "
        + "peut l'utiliser. Contactez l'administrateur de la plateforme.");

    /// <summary>
    /// Même verrou que l'enregistrement de la déclaration elle-même : une société ne doit pas plus
    /// modifier la configuration fiscale de son dossier qu'y déposer une déclaration.
    /// </summary>
    public static Error WriteDenied { get; } = Error.Forbidden(
        "Seul le cabinet comptable, en contexte dossier client, peut modifier la configuration de "
        + "la déclaration mensuelle.");

    /// <summary>
    /// Plafond de rubriques par dossier. Il borne l'union des comptes que le moteur interroge en une
    /// requête : sans lui, le nombre de paramètres de cette requête n'aurait aucune limite connue.
    /// </summary>
    public const int MaxRubricsPerTenant = 300;
}

// ── Mapping ────────────────────────────────────────────────────────────────

internal static class MonthlyDeclarationConfigMapper
{
    public static MonthlyDeclarationRubricDto Map(MonthlyDeclarationRubric r) => new()
    {
        Id = r.Id,
        Family = (int)r.Family,
        Code = r.Code,
        Label = r.Label,
        ReportCode = r.ReportCode,
        GrossKind = (int)r.GrossKind,
        WithheldKind = (int)r.WithheldKind,
        GrossSide = (int)r.GrossSide,
        WithheldSide = (int)r.WithheldSide,
        RatePercent = r.RatePercent,
        FixedGrossAmount = r.FixedGrossAmount,
        FixedWithheldAmount = r.FixedWithheldAmount,
        PayrollComponent = r.PayrollComponent is { } c ? (int)c : null,
        WithheldPayrollComponent = r.WithheldPayrollComponent is { } wc ? (int)wc : null,
        EffectiveFrom = r.EffectiveFrom,
        EffectiveTo = r.EffectiveTo,
        IsActive = r.IsActive,
        DisplayOrder = r.DisplayOrder,
        Accounts = r.Accounts
            .Select(a => new MonthlyDeclarationRubricAccountDto
            {
                Role = (int)a.Role,
                AccountNumber = a.AccountNumber,
                MatchMode = (int)a.MatchMode
            })
            .ToList()
    };

    public static MonthlyDeclarationSettingsDto Map(MonthlyDeclarationSettings? s, bool enabled)
    {
        var settings = s ?? MonthlyDeclarationSettings.CreateDefault();
        return new MonthlyDeclarationSettingsDto
        {
            Mode = (int)settings.Mode,
            ConfiguredSince = settings.ConfiguredSince,
            LastParityRunAt = settings.LastParityRunAt,
            LastParityMaxGapMillimes = settings.LastParityMaxGapMillimes,
            ParityCleanStreak = settings.ParityCleanStreak,
            RequiredCleanParityPeriods = MonthlyDeclarationSettings.RequiredCleanParityPeriods,
            CanSwitchToConfigured = settings.CanSwitchToConfigured,
            ParityOverrideBy = settings.ParityOverrideBy,
            ParityOverrideReason = settings.ParityOverrideReason,
            ConfigurableLinesEnabled = enabled
        };
    }

    /// <summary>
    /// Traduit les comptes reçus de l'écran. Les valeurs d'énumération hors bornes sont refusées
    /// ici, avant l'entité : un cast direct d'un entier arbitraire produirait une valeur
    /// d'énumération que rien ne détecterait ensuite.
    /// </summary>
    public static Result<IReadOnlyList<RubricAccountInput>> MapAccounts(
        IReadOnlyList<MonthlyDeclarationRubricAccountDto>? accounts)
    {
        var inputs = new List<RubricAccountInput>();
        foreach (var account in accounts ?? Array.Empty<MonthlyDeclarationRubricAccountDto>())
        {
            if (!Enum.IsDefined((RubricAccountRole)account.Role))
            {
                return Result.Failure<IReadOnlyList<RubricAccountInput>>(
                    Error.Validation("Accounts", $"Rôle de compte inconnu : {account.Role}."));
            }

            if (!Enum.IsDefined((RubricAccountMatchMode)account.MatchMode))
            {
                return Result.Failure<IReadOnlyList<RubricAccountInput>>(
                    Error.Validation("Accounts", $"Mode de rapprochement inconnu : {account.MatchMode}."));
            }

            inputs.Add(new RubricAccountInput(
                (RubricAccountRole)account.Role,
                account.AccountNumber ?? string.Empty,
                (RubricAccountMatchMode)account.MatchMode));
        }

        return Result.Success<IReadOnlyList<RubricAccountInput>>(inputs);
    }

    /// <summary>Valide les énumérations de la rubrique avant de les confier au domaine.</summary>
    public static Result ValidateEnums(
        int family, int grossKind, int withheldKind, int grossSide, int withheldSide,
        int? payrollComponent, int? withheldPayrollComponent)
    {
        if (!Enum.IsDefined((MonthlyDeclarationFamily)family))
            return Result.Failure(Error.Validation("Family", $"Famille inconnue : {family}."));
        if (!Enum.IsDefined((RubricGrossKind)grossKind))
            return Result.Failure(Error.Validation("GrossKind", $"Type de calcul du brut inconnu : {grossKind}."));
        if (!Enum.IsDefined((RubricWithheldKind)withheldKind))
            return Result.Failure(Error.Validation("WithheldKind", $"Type de calcul de la retenue inconnu : {withheldKind}."));
        if (!Enum.IsDefined((AccountBalanceSide)grossSide))
            return Result.Failure(Error.Validation("GrossSide", $"Sens inconnu : {grossSide}."));
        if (!Enum.IsDefined((AccountBalanceSide)withheldSide))
            return Result.Failure(Error.Validation("WithheldSide", $"Sens inconnu : {withheldSide}."));
        if (payrollComponent is { } p && !Enum.IsDefined((PayrollContributionComponent)p))
            return Result.Failure(Error.Validation("PayrollComponent", $"Valeur de paie inconnue : {p}."));
        if (withheldPayrollComponent is { } wp && !Enum.IsDefined((PayrollContributionComponent)wp))
            return Result.Failure(Error.Validation("WithheldPayrollComponent", $"Valeur de paie inconnue : {wp}."));

        return Result.Success();
    }
}

// ── Query ──────────────────────────────────────────────────────────────────

/// <param name="IncludeInactive">Inclut les rubriques désactivées (écran de configuration).</param>
public sealed record GetMonthlyDeclarationConfigurationQuery(bool IncludeInactive = true)
    : IRequest<Result<MonthlyDeclarationConfigurationDto>>;

public sealed class GetMonthlyDeclarationConfigurationQueryHandler
    : IRequestHandler<GetMonthlyDeclarationConfigurationQuery, Result<MonthlyDeclarationConfigurationDto>>
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly AccountingSettings _settings;

    public GetMonthlyDeclarationConfigurationQueryHandler(
        IMonthlyDeclarationConfigRepository config, IOptions<AccountingSettings> settings)
    {
        _config = config;
        _settings = settings.Value;
    }

    public async Task<Result<MonthlyDeclarationConfigurationDto>> Handle(
        GetMonthlyDeclarationConfigurationQuery request, CancellationToken cancellationToken)
    {
        var settings = await _config.GetSettingsAsync(cancellationToken);
        var families = await _config.GetFamilySettingsAsync(cancellationToken);
        var rubrics = await _config.GetRubricsAsync(request.IncludeInactive, cancellationToken);

        // Les familles jamais amorcées sont rendues explicitement à « non incluse » : l'écran doit
        // afficher onze onglets, qu'une ligne existe en base ou non.
        var byFamily = families.ToDictionary(f => f.Family, f => f.IsIncluded);
        var allFamilies = Enum.GetValues<MonthlyDeclarationFamily>()
            .Select(family => new MonthlyDeclarationFamilySettingDto
            {
                Family = (int)family,
                IsIncluded = byFamily.TryGetValue(family, out var included) && included
            })
            .ToList();

        return Result.Success(new MonthlyDeclarationConfigurationDto
        {
            Settings = MonthlyDeclarationConfigMapper.Map(settings, _settings.ConfigurableLinesActive),
            Families = allFamilies,
            Rubrics = rubrics.Select(MonthlyDeclarationConfigMapper.Map).ToList()
        });
    }
}

// ── Commands ───────────────────────────────────────────────────────────────

public sealed record CreateMonthlyDeclarationRubricCommand(CreateMonthlyDeclarationRubricRequest Request)
    : IRequest<Result<Guid>>;

public sealed class CreateMonthlyDeclarationRubricCommandHandler
    : IRequestHandler<CreateMonthlyDeclarationRubricCommand, Result<Guid>>
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public CreateMonthlyDeclarationRubricCommandHandler(
        IMonthlyDeclarationConfigRepository config,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _config = config;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<Guid>> Handle(
        CreateMonthlyDeclarationRubricCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure<Guid>(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure<Guid>(MonthlyDeclarationGuard.WriteDenied);

        var r = request.Request;

        var enums = MonthlyDeclarationConfigMapper.ValidateEnums(
            r.Family, r.GrossKind, r.WithheldKind, r.GrossSide, r.WithheldSide,
            r.PayrollComponent, r.WithheldPayrollComponent);
        if (enums.IsFailure)
            return Result.Failure<Guid>(enums.Error);

        var accounts = MonthlyDeclarationConfigMapper.MapAccounts(r.Accounts);
        if (accounts.IsFailure)
            return Result.Failure<Guid>(accounts.Error);

        var existing = await _config.GetRubricByCodeAsync(r.Code ?? string.Empty, cancellationToken);
        if (existing is not null)
            return Result.Failure<Guid>(Error.Conflict($"La rubrique {r.Code} existe déjà."));

        var count = await _config.CountRubricsAsync(cancellationToken);
        if (count >= MonthlyDeclarationGuard.MaxRubricsPerTenant)
        {
            return Result.Failure<Guid>(Error.Validation(
                "Rubrics",
                $"Un dossier ne peut pas porter plus de {MonthlyDeclarationGuard.MaxRubricsPerTenant} rubriques."));
        }

        var create = MonthlyDeclarationRubric.Create(
            (MonthlyDeclarationFamily)r.Family, r.Code, r.Label, r.ReportCode,
            (RubricGrossKind)r.GrossKind, (RubricWithheldKind)r.WithheldKind,
            (AccountBalanceSide)r.GrossSide, (AccountBalanceSide)r.WithheldSide,
            r.RatePercent, r.FixedGrossAmount, r.FixedWithheldAmount,
            r.PayrollComponent is { } p ? (PayrollContributionComponent)p : null,
            r.WithheldPayrollComponent is { } wp ? (PayrollContributionComponent)wp : null,
            r.EffectiveFrom, r.EffectiveTo, accounts.Value, r.DisplayOrder);
        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var rubric = create.Value;
        rubric.SetAuditInfo(_currentUser.Email ?? "system");
        await _config.AddRubricAsync(rubric, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationRubricCreated,
            nameof(MonthlyDeclarationRubric), rubric.Id,
            newValues: new { rubric.Code, rubric.Label, Family = rubric.Family.ToString(), rubric.ReportCode },
            cancellationToken: cancellationToken);

        return Result.Success(rubric.Id);
    }
}

public sealed record UpdateMonthlyDeclarationRubricCommand(
    Guid Id, UpdateMonthlyDeclarationRubricRequest Request) : IRequest<Result>;

public sealed class UpdateMonthlyDeclarationRubricCommandHandler
    : IRequestHandler<UpdateMonthlyDeclarationRubricCommand, Result>
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public UpdateMonthlyDeclarationRubricCommandHandler(
        IMonthlyDeclarationConfigRepository config,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _config = config;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result> Handle(
        UpdateMonthlyDeclarationRubricCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure(MonthlyDeclarationGuard.WriteDenied);

        var rubric = await _config.GetRubricByIdAsync(request.Id, cancellationToken);
        if (rubric is null)
            return Result.Failure(Error.NotFound(nameof(MonthlyDeclarationRubric), request.Id));

        var r = request.Request;

        var enums = MonthlyDeclarationConfigMapper.ValidateEnums(
            (int)rubric.Family, r.GrossKind, r.WithheldKind, r.GrossSide, r.WithheldSide,
            r.PayrollComponent, r.WithheldPayrollComponent);
        if (enums.IsFailure)
            return enums;

        var accounts = MonthlyDeclarationConfigMapper.MapAccounts(r.Accounts);
        if (accounts.IsFailure)
            return Result.Failure(accounts.Error);

        var before = new { rubric.Label, rubric.ReportCode, rubric.RatePercent, rubric.EffectiveTo };

        var update = rubric.Update(
            r.Label, r.ReportCode,
            (RubricGrossKind)r.GrossKind, (RubricWithheldKind)r.WithheldKind,
            (AccountBalanceSide)r.GrossSide, (AccountBalanceSide)r.WithheldSide,
            r.RatePercent, r.FixedGrossAmount, r.FixedWithheldAmount,
            r.PayrollComponent is { } p ? (PayrollContributionComponent)p : null,
            r.WithheldPayrollComponent is { } wp ? (PayrollContributionComponent)wp : null,
            r.EffectiveFrom, r.EffectiveTo, accounts.Value, r.DisplayOrder);
        if (update.IsFailure)
            return update;

        rubric.SetAuditInfo(_currentUser.Email ?? "system", isUpdate: true);
        await _config.UpdateRubricAsync(rubric, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationRubricUpdated,
            nameof(MonthlyDeclarationRubric), rubric.Id,
            oldValues: before,
            newValues: new { rubric.Label, rubric.ReportCode, rubric.RatePercent, rubric.EffectiveTo },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record ToggleMonthlyDeclarationRubricCommand(Guid Id) : IRequest<Result>;

public sealed class ToggleMonthlyDeclarationRubricCommandHandler
    : IRequestHandler<ToggleMonthlyDeclarationRubricCommand, Result>
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public ToggleMonthlyDeclarationRubricCommandHandler(
        IMonthlyDeclarationConfigRepository config,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _config = config;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result> Handle(
        ToggleMonthlyDeclarationRubricCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure(MonthlyDeclarationGuard.WriteDenied);

        var rubric = await _config.GetRubricByIdAsync(request.Id, cancellationToken);
        if (rubric is null)
            return Result.Failure(Error.NotFound(nameof(MonthlyDeclarationRubric), request.Id));

        rubric.ToggleActive();
        rubric.SetAuditInfo(_currentUser.Email ?? "system", isUpdate: true);
        await _config.UpdateRubricAsync(rubric, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationRubricToggled,
            nameof(MonthlyDeclarationRubric), rubric.Id,
            newValues: new { rubric.Code, rubric.IsActive },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record DeleteMonthlyDeclarationRubricCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteMonthlyDeclarationRubricCommandHandler
    : IRequestHandler<DeleteMonthlyDeclarationRubricCommand, Result>
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public DeleteMonthlyDeclarationRubricCommandHandler(
        IMonthlyDeclarationConfigRepository config,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _config = config;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result> Handle(
        DeleteMonthlyDeclarationRubricCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure(MonthlyDeclarationGuard.WriteDenied);

        var rubric = await _config.GetRubricByIdAsync(request.Id, cancellationToken);
        if (rubric is null)
            return Result.Failure(Error.NotFound(nameof(MonthlyDeclarationRubric), request.Id));

        // La suppression n'atteint pas les déclarations déjà déposées : leurs lignes conservent le
        // code, le libellé et le code rapport figés au dépôt, sans contrainte vers la rubrique.
        await _config.DeleteRubricAsync(rubric, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationRubricDeleted,
            nameof(MonthlyDeclarationRubric), rubric.Id,
            oldValues: new { rubric.Code, rubric.Label, Family = rubric.Family.ToString() },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record SetMonthlyDeclarationFamilyCommand(SetMonthlyDeclarationFamilyRequest Request)
    : IRequest<Result>;

public sealed class SetMonthlyDeclarationFamilyCommandHandler
    : IRequestHandler<SetMonthlyDeclarationFamilyCommand, Result>
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public SetMonthlyDeclarationFamilyCommandHandler(
        IMonthlyDeclarationConfigRepository config,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _config = config;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result> Handle(
        SetMonthlyDeclarationFamilyCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure(MonthlyDeclarationGuard.WriteDenied);

        var familyValue = request.Request.Family;
        if (!Enum.IsDefined((MonthlyDeclarationFamily)familyValue))
            return Result.Failure(Error.Validation("Family", $"Famille inconnue : {familyValue}."));

        var family = (MonthlyDeclarationFamily)familyValue;
        var setting = await _config.GetFamilySettingAsync(family, cancellationToken);

        if (setting is null)
        {
            var created = MonthlyDeclarationFamilySetting.Create(family, request.Request.IsIncluded);
            if (created.IsFailure)
                return Result.Failure(created.Error);

            setting = created.Value;
            setting.SetAuditInfo(_currentUser.Email ?? "system");
        }
        else
        {
            setting.SetIncluded(request.Request.IsIncluded);
            setting.SetAuditInfo(_currentUser.Email ?? "system", isUpdate: true);
        }

        await _config.SaveFamilySettingAsync(setting, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationFamilyToggled,
            nameof(MonthlyDeclarationFamilySetting), setting.Id,
            newValues: new { Family = family.ToString(), setting.IsIncluded },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record SetMonthlyDeclarationModeCommand(SetMonthlyDeclarationModeRequest Request)
    : IRequest<Result>;

/// <summary>
/// Change le régime de calcul du dossier. C'est la seule commande qui déplace des montants : elle
/// décide si la déclaration est produite par le calcul historique ou par la configuration.
/// </summary>
public sealed class SetMonthlyDeclarationModeCommandHandler
    : IRequestHandler<SetMonthlyDeclarationModeCommand, Result>
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public SetMonthlyDeclarationModeCommandHandler(
        IMonthlyDeclarationConfigRepository config,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _config = config;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result> Handle(
        SetMonthlyDeclarationModeCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.ConfigurableLinesActive)
            return Result.Failure(MonthlyDeclarationGuard.Disabled);
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure(MonthlyDeclarationGuard.WriteDenied);

        var requested = request.Request.Mode;
        if (!Enum.IsDefined((MonthlyDeclarationMode)requested))
            return Result.Failure(Error.Validation("Mode", $"Régime inconnu : {requested}."));

        var mode = (MonthlyDeclarationMode)requested;
        var settings = await _config.GetSettingsAsync(cancellationToken)
                       ?? MonthlyDeclarationSettings.CreateDefault();
        var previousMode = settings.Mode;

        var user = _currentUser.Email ?? "system";
        var applied = mode switch
        {
            MonthlyDeclarationMode.Legacy => settings.SwitchToLegacy(),
            MonthlyDeclarationMode.Parity => settings.SwitchToParity(),
            _ => settings.SwitchToConfigured(
                request.Request.ConfiguredSince ?? default,
                user,
                request.Request.OverrideReason)
        };

        if (applied.IsFailure)
            return applied;

        settings.SetAuditInfo(user, isUpdate: settings.CreatedBy is not null);
        await _config.SaveSettingsAsync(settings, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.MonthlyDeclarationModeChanged,
            nameof(MonthlyDeclarationSettings), settings.Id,
            oldValues: new { Mode = previousMode.ToString() },
            newValues: new
            {
                Mode = settings.Mode.ToString(),
                settings.ConfiguredSince,
                settings.ParityCleanStreak,
                settings.ParityOverrideReason
            },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}
