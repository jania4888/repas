using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.FiscalSchedule;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.Commands;

public sealed record CreateSubAccountCommand(CreateSubAccountRequest Request) : IRequest<Result<Guid>>;

public sealed class CreateSubAccountCommandHandler : IRequestHandler<CreateSubAccountCommand, Result<Guid>>
{
    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;

    public CreateSubAccountCommandHandler(
        IChartOfAccountRepository chartOfAccounts,
        IAuditService auditService,
        ICurrentUser currentUser)
    {
        _chartOfAccounts = chartOfAccounts;
        _auditService = auditService;
        _currentUser = currentUser;
    }

    public async Task<Result<Guid>> Handle(CreateSubAccountCommand request, CancellationToken cancellationToken)
    {
        var r = request.Request;
        var accountNumber = (r.AccountNumber ?? string.Empty).Trim();
        var existing = await _chartOfAccounts.GetByAccountNumberAsync(accountNumber, cancellationToken);
        if (existing is not null)
            return Result.Failure<Guid>(Error.Conflict(
                $"Le compte {existing.AccountNumber} existe déjà ({existing.Label})."));

        var nature = (AccountNatureType)r.NatureType;
        var create = ChartOfAccount.Create(
            accountNumber,
            r.Label,
            r.AccountClass,
            r.ParentAccountNumber,
            nature,
            isSystem: false,
            accountType: (AccountType)r.AccountType,
            isAuxiliary: r.IsAuxiliary,
            affectationAccountNumber: r.AffectationAccountNumber);
        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var entity = create.Value;
        entity.SetAuditInfo(_currentUser.Email ?? "system", false);
        await _chartOfAccounts.AddAsync(entity, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.SubAccountCreated,
            "ChartOfAccount",
            entity.Id,
            newValues: new { r.AccountNumber, r.Label, r.AccountClass },
            cancellationToken: cancellationToken);

        return Result.Success(entity.Id);
    }
}

public sealed record CreateManualJournalEntryCommand(CreateManualJournalEntryRequest Request) : IRequest<Result<Guid>>;

public sealed class CreateManualJournalEntryCommandHandler : IRequestHandler<CreateManualJournalEntryCommand, Result<Guid>>
{
    private readonly IAccountingPeriodService _periodService;
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly IExchangeRateResolver _exchangeRates;
    private readonly AccountingSettings _settings;

    public CreateManualJournalEntryCommandHandler(
        IAccountingPeriodService periodService,
        IJournalEntryRepository journalEntries,
        IChartOfAccountRepository chartOfAccounts,
        IAuditService auditService,
        ICurrentUser currentUser,
        IExchangeRateResolver exchangeRates,
        IOptions<AccountingSettings> settings)
    {
        _periodService = periodService;
        _journalEntries = journalEntries;
        _chartOfAccounts = chartOfAccounts;
        _auditService = auditService;
        _currentUser = currentUser;
        _exchangeRates = exchangeRates;
        _settings = settings.Value;
    }

    public async Task<Result<Guid>> Handle(CreateManualJournalEntryCommand request, CancellationToken cancellationToken)
    {
        var r = request.Request;

        // Validate that all account numbers exist in the chart of accounts
        var checkedAccounts = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in r.Lines)
        {
            var acc = line.AccountNumber?.Trim() ?? string.Empty;
            if (string.IsNullOrEmpty(acc) || !checkedAccounts.Add(acc))
                continue;

            var account = await _chartOfAccounts.GetByAccountNumberAsync(acc, cancellationToken);
            if (account is null)
                return Result.Failure<Guid>(Error.Validation("AccountNumber",
                    $"Le compte {acc} n'existe pas dans le plan comptable."));

            if (!account.IsActive)
                return Result.Failure<Guid>(Error.Validation("AccountNumber",
                    $"Le compte {acc} est désactivé."));
        }

        var period = await _periodService.EnsureOpenPeriodAsync(r.EntryDate, cancellationToken);
        if (period.IsFailure)
            return Result.Failure<Guid>(period.Error);

        var mapped = ManualJournalLineMapper.Map(r.Lines);
        if (mapped.IsFailure)
            return Result.Failure<Guid>(mapped.Error);

        // Résolution serveur du taux puis conversion : les montants en devise de tenue transmis par
        // le client sont recalculés, jamais repris tels quels.
        var prepared = await ManualEntryCurrencyPreparation.PrepareAsync(
            _exchangeRates, r.CurrencyCode, r.ExchangeRate, r.EntryDate, mapped.Value, cancellationToken);
        if (prepared.IsFailure)
            return Result.Failure<Guid>(prepared.Error);

        var lines = prepared.Value.Lines;
        var rate = prepared.Value.Rate;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(r.JournalCode, r.EntryDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            r.JournalCode,
            r.EntryDate,
            r.Label,
            period.Value.Id,
            false,
            "Manual",
            null,
            lines,
            currency: rate.CurrencyCode,
            pieceRef: r.PieceRef,
            pieceDate: r.PieceDate,
            exchangeRate: rate.Rate,
            exchangeRateOverridden: rate.IsOverridden);

        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(_settings.BrouillardEnabled ? JournalEntryStatus.Brouillon : JournalEntryStatus.Validee);
        entry.SetAuditInfo(_currentUser.Email ?? "system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.ManualEntryCreated,
            "JournalEntry",
            entry.Id,
            newValues: new { r.JournalCode, r.EntryDate, r.Label, LineCount = r.Lines.Count, entry.CurrencyCode, entry.ExchangeRate },
            cancellationToken: cancellationToken);

        // Trace dédiée : une dérogation au taux de la table doit rester retrouvable pour elle-même,
        // sans avoir à relire toutes les créations d'écritures.
        if (rate.IsOverridden)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.ExchangeRateOverridden,
                "JournalEntry",
                entry.Id,
                newValues: new { rate.CurrencyCode, AppliedRate = rate.Rate, rate.ReferenceRate },
                cancellationToken: cancellationToken);
        }

        return Result.Success(entry.Id);
    }
}

public sealed record UpdateAccountLabelCommand(Guid Id, string Label) : IRequest<Result>;

public sealed class UpdateAccountLabelCommandHandler : IRequestHandler<UpdateAccountLabelCommand, Result>
{
    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAuditService _auditService;

    public UpdateAccountLabelCommandHandler(IChartOfAccountRepository chartOfAccounts, IAuditService auditService)
    {
        _chartOfAccounts = chartOfAccounts;
        _auditService = auditService;
    }

    public async Task<Result> Handle(UpdateAccountLabelCommand request, CancellationToken cancellationToken)
    {
        var account = await _chartOfAccounts.GetByIdAsync(request.Id, cancellationToken);
        if (account is null)
            return Result.Failure(Error.NotFound("ChartOfAccount", request.Id));

        var oldLabel = account.Label;
        var result = account.UpdateLabel(request.Label);
        if (result.IsFailure)
            return result;

        await _chartOfAccounts.UpdateAsync(account, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.AccountLabelUpdated,
            "ChartOfAccount",
            account.Id,
            oldValues: new { Label = oldLabel },
            newValues: new { account.AccountNumber, Label = request.Label },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record ToggleAccountActiveCommand(Guid Id) : IRequest<Result>;

public sealed class ToggleAccountActiveCommandHandler : IRequestHandler<ToggleAccountActiveCommand, Result>
{
    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAuditService _auditService;

    public ToggleAccountActiveCommandHandler(IChartOfAccountRepository chartOfAccounts, IAuditService auditService)
    {
        _chartOfAccounts = chartOfAccounts;
        _auditService = auditService;
    }

    public async Task<Result> Handle(ToggleAccountActiveCommand request, CancellationToken cancellationToken)
    {
        var account = await _chartOfAccounts.GetByIdAsync(request.Id, cancellationToken);
        if (account is null)
            return Result.Failure(Error.NotFound("ChartOfAccount", request.Id));

        if (account.IsSystem)
            return Result.Failure(Error.Validation("ChartOfAccount", "Impossible de modifier un compte système."));

        var wasActive = account.IsActive;
        account.ToggleActive();
        await _chartOfAccounts.UpdateAsync(account, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.AccountToggled,
            "ChartOfAccount",
            account.Id,
            oldValues: new { IsActive = wasActive },
            newValues: new { account.AccountNumber, account.IsActive },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record ClosePeriodCommand(Guid PeriodId) : IRequest<Result>;

public sealed class ClosePeriodCommandHandler : IRequestHandler<ClosePeriodCommand, Result>
{
    private readonly IAccountingPeriodRepository _periods;
    private readonly IAccountingPeriodService _periodService;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;

    public ClosePeriodCommandHandler(
        IAccountingPeriodRepository periods,
        IAccountingPeriodService periodService,
        IAuditService auditService,
        ICurrentUser currentUser)
    {
        _periods = periods;
        _periodService = periodService;
        _auditService = auditService;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(ClosePeriodCommand request, CancellationToken cancellationToken)
    {
        var closedBy = _currentUser.Email ?? "system";

        // Use serializable transaction to prevent concurrent entry creation during close
        var result = await _periodService.ClosePeriodWithLockAsync(request.PeriodId, closedBy, cancellationToken);
        if (result.IsFailure)
            return result;

        await _auditService.LogAsync(
            AuditActions.Accounting.PeriodClosed,
            "AccountingPeriod",
            request.PeriodId,
            newValues: new { ClosedBy = closedBy },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record ReopenPeriodCommand(Guid PeriodId) : IRequest<Result>;

public sealed class ReopenPeriodCommandHandler : IRequestHandler<ReopenPeriodCommand, Result>
{
    private readonly IAccountingPeriodService _periodService;
    private readonly IAuditService _auditService;

    public ReopenPeriodCommandHandler(IAccountingPeriodService periodService, IAuditService auditService)
    {
        _periodService = periodService;
        _auditService = auditService;
    }

    public async Task<Result> Handle(ReopenPeriodCommand request, CancellationToken cancellationToken)
    {
        // La réouverture rebascule aussi les écritures Cloturee → Validee (symétrie de la clôture).
        var result = await _periodService.ReopenPeriodAsync(request.PeriodId, cancellationToken);
        if (result.IsFailure)
            return Result.Failure(result.Error);

        var p = result.Value;
        await _auditService.LogAsync(
            AuditActions.Accounting.PeriodReopened,
            "AccountingPeriod",
            p.Id,
            newValues: new { p.FiscalYear, p.Month },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record SaveVatDeclarationCommand(SaveVatDeclarationRequest Request) : IRequest<Result<Guid>>;

public sealed class SaveVatDeclarationCommandHandler : IRequestHandler<SaveVatDeclarationCommand, Result<Guid>>
{
    private readonly IVatDeclarationRepository _vatDecl;
    private readonly IMediator _mediator;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;
    private readonly DeclarationScheduleSynchronizer _scheduleSync;
    private readonly ILogger<SaveVatDeclarationCommandHandler> _logger;

    public SaveVatDeclarationCommandHandler(
        IVatDeclarationRepository vatDecl,
        IMediator mediator,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings,
        DeclarationScheduleSynchronizer scheduleSync,
        ILogger<SaveVatDeclarationCommandHandler> logger)
    {
        _vatDecl = vatDecl;
        _mediator = mediator;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
        _scheduleSync = scheduleSync;
        _logger = logger;
    }

    /// <summary>
    /// Total à payer de la déclaration telle qu'elle vient d'être enregistrée — montants écrêtés
    /// compris — par l'expression PARTAGÉE avec l'écran et le suivi : une seconde formule finirait
    /// par donner deux chiffres pour la même période.
    /// </summary>
    private decimal SavedTotalToPay(VatDeclaration saved) =>
        GetVatDeclarationQueryHandler.TotalToPay(
            GetVatDeclarationQueryHandler.TaxAmounts.FromEntity(saved),
            _settings.MonthlyDeclarationV2Enabled);

    /// <summary>
    /// Calcul qui vient de produire les montants enregistrés : paramétré si la période est en mode
    /// configuré, historique sinon — y compris en contrôle de parité, où les montants restent ceux
    /// du calcul historique.
    /// </summary>
    private static DeclarationCalculationOrigin CalculationOriginOf(VatDeclarationDto dto) =>
        (MonthlyDeclarationMode)dto.MonthlyDeclarationMode == MonthlyDeclarationMode.Configured
            ? DeclarationCalculationOrigin.Configured
            : DeclarationCalculationOrigin.Historic;

    /// <summary>
    /// Refus d'une période configurée dont la configuration produirait un montant faux sans que
    /// rien ne le signale une fois la déclaration déposée : famille incluse sans rubrique applicable
    /// (un zéro), ou même source reprise par deux rubriques (un double).
    /// </summary>
    private static Error? ConfiguredPeriodRefusal(VatDeclarationDto dto)
    {
        if ((MonthlyDeclarationMode)dto.MonthlyDeclarationMode != MonthlyDeclarationMode.Configured)
            return null;

        var duplicate = dto.MonthlyDeclarationDiagnostics
            .FirstOrDefault(d => d.Kind == (int)RubricDiagnosticKind.DuplicateSourceRead);
        if (duplicate is not null)
            return Error.Validation("MonthlyDeclaration", $"Enregistrement refusé : {duplicate.Detail}");

        var families = dto.MonthlyDeclarationDiagnostics
            .Where(d => d.Kind == (int)RubricDiagnosticKind.MissingRubricForFamily)
            .Select(d => Enum.TryParse<MonthlyDeclarationFamily>(d.Detail, ignoreCase: false, out var family)
                         && Enum.IsDefined(family)
                ? family.ToDisplayString()
                : d.Detail ?? string.Empty)
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (families.Count == 0)
            return null;

        return Error.Validation(
            "MonthlyDeclaration",
            $"Enregistrement refusé : {(families.Count == 1 ? "la famille" : "les familles")} "
            + $"« {string.Join(" », « ", families)} » "
            + $"{(families.Count == 1 ? "est incluse" : "sont incluses")} dans la déclaration sans "
            + "aucune rubrique applicable à cette période. Ajoutez une rubrique dans Configuration DM, "
            + "ou décochez la famille si le dossier ne la déclare pas.");
    }

    /// <summary>Synchro échéancier best-effort : ne fait JAMAIS échouer la sauvegarde.</summary>
    private async Task TrySyncScheduleAsync(VatDeclaration declaration, decimal totalToPay, CancellationToken ct)
    {
        try
        {
            await _scheduleSync.SyncAsync(declaration, totalToPay, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Declaration→schedule sync failed for {Year}-{Month}",
                declaration.Year, declaration.Month);
        }
    }

    public async Task<Result<Guid>> Handle(SaveVatDeclarationCommand request, CancellationToken cancellationToken)
    {
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure<Guid>(Error.Forbidden(VatDeclarationAccess.WriteDeniedMessage));

        var r = request.Request;
        // Valorisation LIVE explicite : l'enregistrement rafraîchit la TVA depuis les écritures.
        // En mode « déclaré » (défaut), la query renverrait le dépôt existant et la TVA d'un
        // brouillon ne se mettrait plus jamais à jour.
        var computed = await _mediator.Send(
            new GetVatDeclarationQuery(r.Year, r.Month, Valuation: VatDeclarationValuation.Live),
            cancellationToken);
        if (computed.IsFailure)
            return Result.Failure<Guid>(computed.Error);

        var dto = computed.Value;
        var currency = dto.Currency;
        var v2 = _settings.MonthlyDeclarationV2Enabled;
        var user = _currentUser.Email ?? "system";

        if (v2 && ConfiguredPeriodRefusal(dto) is { } refusal)
            return Result.Failure<Guid>(refusal);

        var existing = await _vatDecl.GetByYearMonthAsync(r.Year, r.Month, cancellationToken);
        if (existing is not null)
        {
            // Brouillon existant : mise à jour EN PLACE (TVA recalculée depuis les écritures) puis
            // soumission éventuelle — ce n'est PAS une rectificative (RevisionNumber inchangé).
            if (existing.Status == VatDeclarationStatus.Draft)
            {
                var upd = existing.UpdateDraft(
                    // Mouvements signés caisse (plan §6.7 / v2.1) : le DTO recalculé peut porter une
                    // TVA collectée négative (extourne sans TVA facturière compensatrice) — Money.Create
                    // rejetterait ce cas, FromSignedAmount le préserve tel que recalculé.
                    Money.FromSignedAmount(dto.CollectedVat19, currency),
                    Money.FromSignedAmount(dto.CollectedVat13, currency),
                    Money.FromSignedAmount(dto.CollectedVat7, currency),
                    Money.Create(dto.DeductibleVatGoods, currency),
                    Money.Create(dto.DeductibleVatAssets, currency),
                    Money.Create(dto.PreviousCredit, currency));
                if (upd.IsFailure)
                    return Result.Failure<Guid>(upd.Error);

                if (v2)
                {
                    existing.SetAdditionalTaxes(r.Fodec, r.DroitTimbre, r.Tcl, r.Tfp, r.Foprolos, r.WithholdingTax, r.Acomptes);
                    // Droit de consommation, taxe hôtelière et droit de licence n'ont pas de champ
                    // de saisie : leur seule source est le moteur paramétré, donc le recalcul en
                    // direct — comme la TVA. Valent 0 pour un dossier en calcul historique.
                    existing.SetConfiguredFamilyTaxes(dto.ConsumptionDuty, dto.HotelTax, dto.LicenceFee);
                    existing.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(dto.Lines));
            existing.SetCalculationOrigin(CalculationOriginOf(dto));
                    existing.SetCalculationOrigin(CalculationOriginOf(dto));
                }

                if (r.Submit)
                    existing.Submit();
                existing.SetAuditInfo(user, isUpdate: true);
                await _vatDecl.UpdateAsync(existing, cancellationToken);

                await _auditService.LogAsync(
                    r.Submit ? AuditActions.Accounting.VatDeclarationSubmitted : AuditActions.Accounting.VatDeclarationSaved,
                    "VatDeclaration",
                    existing.Id,
                    newValues: new { r.Year, r.Month, dto.VatDue, r.Submit },
                    cancellationToken: cancellationToken);

                await TrySyncScheduleAsync(existing, SavedTotalToPay(existing), cancellationToken);

                return Result.Success(existing.Id);
            }

            // Déclaration déjà soumise / verrouillée : seule une rectificative (V2) est autorisée.
            if (!v2 || !r.IsRectificative)
                return Result.Failure<Guid>(Error.Conflict(
                    "La déclaration de cette période est déjà soumise. Utilisez « Rectificative » pour la corriger."));

            existing.ApplyRevision(
                // Mouvements signés caisse (plan §6.7 / v2.1) : cf. commentaire UpdateDraft ci-dessus.
                Money.FromSignedAmount(dto.CollectedVat19, currency),
                Money.FromSignedAmount(dto.CollectedVat13, currency),
                Money.FromSignedAmount(dto.CollectedVat7, currency),
                Money.Create(dto.DeductibleVatGoods, currency),
                Money.Create(dto.DeductibleVatAssets, currency),
                Money.Create(dto.PreviousCredit, currency),
                r.Fodec, r.DroitTimbre, r.Tcl, r.Tfp, r.Foprolos, r.WithholdingTax, r.Acomptes);
            existing.SetConfiguredFamilyTaxes(dto.ConsumptionDuty, dto.HotelTax, dto.LicenceFee);
            // Une rectificative produit un NOUVEAU détail : les lignes de la version précédente
            // sont remplacées, la version étant portée par RevisionNumber.
            existing.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(dto.Lines));
            if (r.Submit)
                existing.Submit();
            existing.SetAuditInfo(user, isUpdate: true);
            await _vatDecl.UpdateAsync(existing, cancellationToken);

            await _auditService.LogAsync(
                AuditActions.Accounting.VatDeclarationRectified,
                "VatDeclaration",
                existing.Id,
                newValues: new { r.Year, r.Month, existing.RevisionNumber, dto.VatDue, r.Submit },
                cancellationToken: cancellationToken);

            await TrySyncScheduleAsync(existing, SavedTotalToPay(existing), cancellationToken);

            return Result.Success(existing.Id);
        }

        var draft = VatDeclaration.CreateDraft(
            r.Year,
            r.Month,
            // Mouvements signés caisse (plan §6.7 / v2.1) : cf. commentaire UpdateDraft ci-dessus.
            Money.FromSignedAmount(dto.CollectedVat19, currency),
            Money.FromSignedAmount(dto.CollectedVat13, currency),
            Money.FromSignedAmount(dto.CollectedVat7, currency),
            Money.Create(dto.DeductibleVatGoods, currency),
            Money.Create(dto.DeductibleVatAssets, currency),
            Money.Create(dto.PreviousCredit, currency),
            currency);

        if (v2)
        {
            draft.SetAdditionalTaxes(r.Fodec, r.DroitTimbre, r.Tcl, r.Tfp, r.Foprolos, r.WithholdingTax, r.Acomptes);
            draft.SetConfiguredFamilyTaxes(dto.ConsumptionDuty, dto.HotelTax, dto.LicenceFee);
            draft.ReplaceLines(MonthlyDeclarationLineSnapshot.Freeze(dto.Lines));
            draft.SetCalculationOrigin(CalculationOriginOf(dto));
        }

        draft.SetAuditInfo(user, false);
        if (r.Submit)
            draft.Submit();

        await _vatDecl.AddAsync(draft, cancellationToken);

        await _auditService.LogAsync(
            r.Submit ? AuditActions.Accounting.VatDeclarationSubmitted : AuditActions.Accounting.VatDeclarationSaved,
            "VatDeclaration",
            draft.Id,
            newValues: new { r.Year, r.Month, dto.VatDue, r.Submit },
            cancellationToken: cancellationToken);

        await TrySyncScheduleAsync(draft, SavedTotalToPay(draft), cancellationToken);

        return Result.Success(draft.Id);
    }
}

public sealed record LetterAccountEntriesCommand(IReadOnlyList<Guid> JournalEntryLineIds, bool AllowPartial = false) : IRequest<Result>;

public sealed class LetterAccountEntriesCommandHandler : IRequestHandler<LetterAccountEntriesCommand, Result>
{
    private readonly ILetteringService _lettering;
    private readonly IAuditService _auditService;

    public LetterAccountEntriesCommandHandler(ILetteringService lettering, IAuditService auditService)
    {
        _lettering = lettering;
        _auditService = auditService;
    }

    public async Task<Result> Handle(LetterAccountEntriesCommand request, CancellationToken cancellationToken)
    {
        var result = await _lettering.ManualLetterAsync(request.JournalEntryLineIds, request.AllowPartial, cancellationToken);
        if (result.IsSuccess)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.Lettered,
                "LetteringGroup",
                newValues: new { LineCount = request.JournalEntryLineIds.Count, request.AllowPartial },
                cancellationToken: cancellationToken);
        }

        return result;
    }
}

public sealed record UnletterAccountEntriesCommand(string Code) : IRequest<Result>;

public sealed class UnletterAccountEntriesCommandHandler : IRequestHandler<UnletterAccountEntriesCommand, Result>
{
    private readonly ILetteringService _lettering;
    private readonly IAuditService _auditService;

    public UnletterAccountEntriesCommandHandler(ILetteringService lettering, IAuditService auditService)
    {
        _lettering = lettering;
        _auditService = auditService;
    }

    public async Task<Result> Handle(UnletterAccountEntriesCommand request, CancellationToken cancellationToken)
    {
        var result = await _lettering.UnletterAsync(request.Code, cancellationToken);
        if (result.IsSuccess)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.Unlettered,
                "LetteringGroup",
                newValues: new { request.Code },
                cancellationToken: cancellationToken);
        }

        return result;
    }
}

public sealed record CloseAnnualPeriodCommand(int FiscalYear) : IRequest<Result>;

public sealed class CloseAnnualPeriodCommandHandler : IRequestHandler<CloseAnnualPeriodCommand, Result>
{
    private readonly IAccountingPeriodRepository _periods;
    private readonly IAccountingPeriodService _periodService;
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IPreClosingControlService _preClosing;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public CloseAnnualPeriodCommandHandler(
        IAccountingPeriodRepository periods,
        IAccountingPeriodService periodService,
        IJournalEntryRepository journalEntries,
        IPreClosingControlService preClosing,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _periods = periods;
        _periodService = periodService;
        _journalEntries = journalEntries;
        _preClosing = preClosing;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result> Handle(CloseAnnualPeriodCommand request, CancellationToken cancellationToken)
    {
        var list = await _periods.GetByFiscalYearAsync(request.FiscalYear, cancellationToken);
        if (list.Count == 0)
            return Result.Failure(Error.Validation("FiscalYear", "Aucune période comptable pour cet exercice."));

        // Garde-fou légal : une clôture ne peut pas laisser des écritures en brouillard non validées.
        // Sans effet quand le workflow brouillard est désactivé (aucune écriture en brouillon).
        var drafts = await _journalEntries.CountDraftsByFiscalYearAsync(request.FiscalYear, cancellationToken);
        if (drafts > 0)
            return Result.Failure(Error.Validation("Brouillard",
                $"{drafts} écriture(s) en brouillard sur l'exercice {request.FiscalYear}. Validez-les avant la clôture annuelle."));

        // Contrôles de pré-clôture (Lot F) : refus si un contrôle BLOQUANT subsiste. Additif et
        // conditionné au flag — comportement historique préservé quand désactivé.
        if (_settings.PreClosingControlsEnabled)
        {
            var checklist = await _preClosing.RunAsync(request.FiscalYear, cancellationToken);
            if (checklist.IsFailure)
                return Result.Failure(checklist.Error);
            if (checklist.Value.HasBlocking)
            {
                var blocking = checklist.Value.Checks
                    .Where(c => c.Severity == (int)PreClosingSeverity.Blocking && c.Count > 0)
                    .Select(c => c.Title);
                return Result.Failure(Error.Validation("PreClosing",
                    $"Contrôles de pré-clôture bloquants : {string.Join(" ; ", blocking)}. Résolvez-les avant la clôture."));
            }
        }

        // Chaque période passe par la clôture verrouillée du service : mêmes gardes que la
        // clôture mensuelle + bascule des écritures Validee → Cloturee.
        var closedBy = _currentUser.Email ?? "system";
        foreach (var p in list)
        {
            if (p.IsClosed)
                continue;
            var close = await _periodService.ClosePeriodWithLockAsync(p.Id, closedBy, cancellationToken);
            if (close.IsFailure)
                return close;
        }

        await _auditService.LogAsync(
            AuditActions.Accounting.FiscalYearClosed,
            "AccountingPeriod",
            newValues: new { request.FiscalYear, PeriodsCount = list.Count },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record GenerateOpeningEntriesCommand(int ClosedFiscalYear) : IRequest<Result<Guid>>;

public sealed class GenerateOpeningEntriesCommandHandler : IRequestHandler<GenerateOpeningEntriesCommand, Result<Guid>>
{
    private readonly IAccountingService _accountingService;
    private readonly IAuditService _auditService;

    public GenerateOpeningEntriesCommandHandler(IAccountingService accountingService, IAuditService auditService)
    {
        _accountingService = accountingService;
        _auditService = auditService;
    }

    public async Task<Result<Guid>> Handle(GenerateOpeningEntriesCommand request, CancellationToken cancellationToken)
    {
        var result = await _accountingService.GenerateOpeningEntriesAsync(request.ClosedFiscalYear, cancellationToken);
        if (result.IsSuccess)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.FiscalYearClosed,
                "JournalEntry",
                result.Value,
                newValues: new { request.ClosedFiscalYear, NewFiscalYear = request.ClosedFiscalYear + 1 },
                cancellationToken: cancellationToken);
        }

        return result;
    }
}

// ── Phase 1 : brouillard & validation ─────────────────────────────────────────────

public sealed record ValidateJournalEntryCommand(Guid Id) : IRequest<Result>;

public sealed class ValidateJournalEntryCommandHandler : IRequestHandler<ValidateJournalEntryCommand, Result>
{
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;

    public ValidateJournalEntryCommandHandler(
        IJournalEntryRepository journalEntries,
        IAuditService auditService,
        ICurrentUser currentUser)
    {
        _journalEntries = journalEntries;
        _auditService = auditService;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(ValidateJournalEntryCommand request, CancellationToken cancellationToken)
    {
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure(Error.Forbidden(AccountingValidationAccess.DeniedMessage));

        var entry = await _journalEntries.GetByIdAsync(request.Id, cancellationToken);
        if (entry is null)
            return Result.Failure(Error.NotFound("JournalEntry", request.Id));

        if (entry.AccountingPeriod?.IsClosed == true)
            return Result.Failure(Error.Validation("Period", "La période de cette écriture est clôturée."));

        var result = entry.Validate(_currentUser.Email ?? "system");
        if (result.IsFailure)
            return result;

        await _journalEntries.UpdateAsync(entry, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.EntryValidated,
            "JournalEntry",
            entry.Id,
            newValues: new { entry.JournalCode, entry.EntryNumber },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

public sealed record ValidateJournalEntriesBatchCommand(ValidateJournalEntriesBatchRequest Request) : IRequest<Result<int>>;

public sealed class ValidateJournalEntriesBatchCommandHandler : IRequestHandler<ValidateJournalEntriesBatchCommand, Result<int>>
{
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;

    public ValidateJournalEntriesBatchCommandHandler(
        IJournalEntryRepository journalEntries,
        IAuditService auditService,
        ICurrentUser currentUser)
    {
        _journalEntries = journalEntries;
        _auditService = auditService;
        _currentUser = currentUser;
    }

    public async Task<Result<int>> Handle(ValidateJournalEntriesBatchCommand request, CancellationToken cancellationToken)
    {
        if (!_currentUser.IsAccountingFirmDelegatedContext)
            return Result.Failure<int>(Error.Forbidden(AccountingValidationAccess.DeniedMessage));

        var drafts = await _journalEntries.GetDraftsByPeriodAsync(
            request.Request.PeriodId, request.Request.JournalCode, cancellationToken);

        var user = _currentUser.Email ?? "system";
        var count = 0;
        foreach (var entry in drafts)
        {
            var result = entry.Validate(user);
            if (result.IsFailure)
                continue;
            await _journalEntries.UpdateAsync(entry, cancellationToken);
            count++;
        }

        if (count > 0)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.EntriesBatchValidated,
                "AccountingPeriod",
                request.Request.PeriodId,
                newValues: new { request.Request.PeriodId, request.Request.JournalCode, Count = count },
                cancellationToken: cancellationToken);
        }

        return Result.Success(count);
    }
}

public sealed record UpdateDraftJournalEntryCommand(Guid Id, UpdateDraftJournalEntryRequest Request) : IRequest<Result>;

public sealed class UpdateDraftJournalEntryCommandHandler : IRequestHandler<UpdateDraftJournalEntryCommand, Result>
{
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly ILetteringService _lettering;
    private readonly ITenantUnitOfWork _unitOfWork;
    private readonly IExchangeRateResolver _exchangeRates;
    private readonly ILogger<UpdateDraftJournalEntryCommandHandler> _logger;

    public UpdateDraftJournalEntryCommandHandler(
        IJournalEntryRepository journalEntries,
        IChartOfAccountRepository chartOfAccounts,
        IAuditService auditService,
        ICurrentUser currentUser,
        ILetteringService lettering,
        ITenantUnitOfWork unitOfWork,
        IExchangeRateResolver exchangeRates,
        ILogger<UpdateDraftJournalEntryCommandHandler> logger)
    {
        _journalEntries = journalEntries;
        _chartOfAccounts = chartOfAccounts;
        _auditService = auditService;
        _currentUser = currentUser;
        _lettering = lettering;
        _unitOfWork = unitOfWork;
        _exchangeRates = exchangeRates;
        _logger = logger;
    }

    public async Task<Result> Handle(UpdateDraftJournalEntryCommand request, CancellationToken cancellationToken)
    {
        // Contrôle des comptes (asynchrone) AVANT la mutation suivie — même contrôle que la saisie manuelle.
        // Toujours exécuté, quel que soit le contexte (cabinet ou client) : hors transaction, avant tout verrou.
        var checkedAccounts = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in request.Request.Lines)
        {
            var acc = line.AccountNumber?.Trim() ?? string.Empty;
            if (string.IsNullOrEmpty(acc) || !checkedAccounts.Add(acc))
                continue;

            var account = await _chartOfAccounts.GetByAccountNumberAsync(acc, cancellationToken);
            if (account is null)
                return Result.Failure(Error.Validation("AccountNumber",
                    $"Le compte {acc} n'existe pas dans le plan comptable."));
            if (!account.IsActive)
                return Result.Failure(Error.Validation("AccountNumber", $"Le compte {acc} est désactivé."));
        }

        var mappedLines = ManualJournalLineMapper.Map(request.Request.Lines);
        if (mappedLines.IsFailure)
            return Result.Failure(mappedLines.Error);

        // Le taux se résout sur la date de l'écriture, que la modification d'un brouillon ne change
        // pas (le champ est verrouillé en édition). Lecture hors transaction, comme le contrôle des
        // comptes ci-dessus ; l'existence réelle et les garde-fous sont revérifiés sous verrou.
        var existing = await _journalEntries.GetByIdAsync(request.Id, cancellationToken);
        if (existing is null)
            return Result.Failure(Error.NotFound("JournalEntry", request.Id));

        var prepared = await ManualEntryCurrencyPreparation.PrepareAsync(
            _exchangeRates, request.Request.CurrencyCode, request.Request.ExchangeRate,
            existing.EntryDate, mappedLines.Value, cancellationToken);
        if (prepared.IsFailure)
            return Result.Failure(prepared.Error);

        var lines = prepared.Value.Lines;
        var resolvedRate = prepared.Value.Rate;

        // D1 (plan) : le cabinet comptable en contexte délégué peut modifier TOUT brouillon
        // (caisse, extourne, lettré, natures combinées) ; un utilisateur hors cabinet reste
        // soumis aux garde-fous G3/G4/G5 à l'identique (mêmes messages, même ordre, aucun effet
        // de bord en cas de refus). G1/G2 restent absolus pour tout le monde.
        var isFirm = _currentUser.IsAccountingFirmDelegatedContext;

        // Sortie de la lecture de décision, capturée pour l'audit best-effort après commit (D6).
        decimal oldTotalDebit = 0m;
        string? sourceEntityType = null;
        var isReversal = false;
        var wasLettered = false;
        var letteringCodes = new List<string>();

        // D7 : toute la séquence (lecture de décision → délettrage automatique → remplacement des
        // lignes) s'exécute dans UNE unité de travail, sous le verrou EXCLUSIF (XLOCK/HOLDLOCK) pris
        // par GetByIdForUpdateAsync — voir la doc XML de cette méthode pour la justification détaillée
        // (UPDLOCK laisserait passer les lectures de décision ordinaires de la validation et du
        // lettrage concurrents ; XLOCK les force à attendre notre commit puis à relire l'état
        // commité). Le verrou est tenu jusqu'au commit/rollback de cette unité de travail.
        var result = await _unitOfWork.ExecuteAsync(async ct =>
        {
            // (a) Lecture de décision VERROUILLÉE : G1/G2 (absolus) puis, si non-cabinet, G3→G4→G5
            // dans cet ordre, avec les messages actuels à l'identique — retour immédiat sans AUCUN
            // effet de bord (pas de délettrage) dès le premier garde-fou déclenché.
            var entry = await _journalEntries.GetByIdForUpdateAsync(request.Id, ct);
            if (entry is null)
                return Result.Failure(Error.NotFound("JournalEntry", request.Id));

            var guardResult = CheckEditGuards(entry, isFirm);
            if (guardResult is not null)
                return guardResult;

            sourceEntityType = entry.SourceEntityType;
            isReversal = entry.ReversesEntryId is not null;
            oldTotalDebit = entry.Lines.Sum(l => l.DebitAmount.Amount);
            letteringCodes = entry.Lines
                .Select(l => l.LetteringCode)
                .Where(code => !string.IsNullOrEmpty(code))
                .Select(code => code!)
                .Distinct()
                .ToList();
            wasLettered = letteringCodes.Count > 0;

            // (b) Délettrage automatique (cabinet uniquement, D3) : chaque groupe référencé par les
            // lignes du brouillon est délettré via le contexte AMBIANT (CreateContext() de
            // LetteringService rejoint la même transaction/connexion) — un échec ici fait échouer
            // toute l'unité de travail (rollback global, y compris de rien s'il n'y a encore rien eu
            // d'autre) avant même la mutation des lignes.
            if (isFirm)
            {
                foreach (var code in letteringCodes)
                {
                    var unletter = await _lettering.UnletterAsync(code, ct);
                    if (unletter.IsFailure)
                        return unletter;
                }
            }

            // (c) Mutation sur l'entité SUIVIE : le remplacement des lignes est reconcilié proprement
            // (anciennes lignes supprimées, nouvelles insérées) — pas de lignes orphelines. Les
            // garde-fous sont RELUS ici en défense en profondeur (le contexte de MutateAsync voit,
            // sur la même connexion/transaction, l'état déjà délettré et les verrous déjà tenus).
            return await _journalEntries.MutateAsync(request.Id, e =>
            {
                var guardResult = CheckEditGuards(e, isFirm);
                if (guardResult is not null)
                    return guardResult;
                return e.UpdateDraftLines(
                    request.Request.Label,
                    lines,
                    currency: resolvedRate.CurrencyCode,
                    pieceRef: request.Request.PieceRef,
                    pieceDate: request.Request.PieceDate,
                    exchangeRate: resolvedRate.Rate,
                    exchangeRateOverridden: resolvedRate.IsOverridden);
            }, ct);
        }, cancellationToken);

        if (result.IsFailure)
            return result;

        // Audit après commit (D6), best-effort mais AUTO-SUFFISANT : ce seul enregistrement porte
        // toute la trace utile (natures combinées, override cabinet, groupes délettrés, totaux)
        // même si l'audit complémentaire ci-dessous échoue. Comme tous les handlers de ce fichier,
        // l'exception de LogAsync (chaîne hash-chaînée) REMONTE : la modification métier est déjà
        // commitée (transaction ambiante refermée ci-dessus), donc l'API répond en erreur alors que
        // le changement a bien eu lieu — trade-off documenté (D6), cohérent avec l'existant, plutôt
        // que de casser l'intégrité de la chaîne d'audit ou d'élargir la transaction métier.
        var newTotalDebit = lines.Sum(l => l.Debit);
        await _auditService.LogAsync(
            AuditActions.Accounting.DraftUpdated,
            "JournalEntry",
            request.Id,
            newValues: new
            {
                LineCount = lines.Count,
                SourceEntityType = sourceEntityType,
                IsReversal = isReversal,
                WasLettered = wasLettered,
                UnletteredGroups = letteringCodes,
                OldTotalDebit = oldTotalDebit,
                NewTotalDebit = newTotalDebit,
                FirmDelegatedOverride = isFirm && (isReversal || sourceEntityType == "CashOperation" || wasLettered),
                resolvedRate.CurrencyCode,
                ExchangeRate = resolvedRate.Rate
            },
            cancellationToken: cancellationToken);

        // Trace dédiée de la dérogation au taux, comme à la création.
        if (resolvedRate.IsOverridden)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.ExchangeRateOverridden,
                "JournalEntry",
                request.Id,
                newValues: new { resolvedRate.CurrencyCode, AppliedRate = resolvedRate.Rate, resolvedRate.ReferenceRate },
                cancellationToken: cancellationToken);
        }

        // Audits complémentaires par groupe délettré : doublons de confort pour les consommateurs
        // de l'écran lettrage. NON bloquants (try/catch + LogWarning) — le seul enregistrement qui
        // fait foi est DraftUpdated ci-dessus (UnletteredGroups).
        foreach (var code in letteringCodes)
        {
            try
            {
                await _auditService.LogAsync(
                    AuditActions.Accounting.Unlettered,
                    "LetteringGroup",
                    newValues: new { Code = code, TriggeredBy = "DraftUpdate", JournalEntryId = request.Id },
                    cancellationToken: cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Audit Accounting.Unlettered (délettrage automatique) échoué pour le groupe {Code} de l'écriture {JournalEntryId} — non bloquant, DraftUpdated fait foi.",
                    code, request.Id);
            }
        }

        return Result.Success();
    }

    /// <summary>
    /// Évalue les garde-fous G1→G5 dans l'ordre défini par le plan. G1 (brouillon) et G2 (période close)
    /// sont absolus ; G3 (extourne), G4 (caisse) et G5 (lettré) ne s'appliquent qu'aux utilisateurs
    /// non-cabinet. Retourne null si tous les garde-fous passent, ou le Result d'erreur du premier
    /// garde-fou déclenché — sans aucun effet de bord. Les messages sont les textes exacts de la v1,
    /// conservés à l'octet près pour les utilisateurs hors cabinet.
    /// </summary>
    private static Result? CheckEditGuards(
        JournalEntry entry,
        bool isAccountingFirm)
    {
        // G1 : absolu
        if (!entry.IsDraft)
            return Result.Failure(Error.Validation("Status",
                "Seule une écriture en brouillon peut être modifiée."));

        // G2 : absolu — un brouillon résiduel d'une période close ne doit plus pouvoir modifier
        // les chiffres de la période.
        if (entry.AccountingPeriod?.IsClosed == true)
            return Result.Failure(Error.Validation("Period",
                "La période de cette écriture est clôturée."));

        // G2b (R-07/R-08) : absolu, y compris pour le cabinet — une écriture générée par le module
        // Paie se corrige via le workflow paie (« Rouvrir le cycle » / « Annuler le paiement »),
        // jamais par édition manuelle du brouillon.
        if (PayrollSourcedEntryGuard.IsSystemSource(entry.SourceEntityType))
            return Result.Failure(Error.Validation("Source",
                "Cette écriture est générée par le module Paie ; elle ne peut pas être modifiée manuellement. Utilisez « Rouvrir le cycle » ou « Annuler le paiement »."));

        if (isAccountingFirm)
            return null;

        // G3 : une extourne est générée comme miroir exact de l'écriture d'origine — l'éditer
        // casserait silencieusement cette symétrie. Levé pour le cabinet délégué (D4).
        if (entry.ReversesEntryId is not null)
            return Result.Failure(Error.Validation("Extourne",
                "Une extourne doit rester le miroir exact de l'écriture d'origine : validez-la ou supprimez-la."));

        // G4 : écriture générée depuis une opération de caisse — levé pour le cabinet (D2).
        if (entry.SourceEntityType == "CashOperation")
            return Result.Failure(Error.Validation("Source",
                "Cette écriture a été générée automatiquement depuis une opération de caisse ; elle ne peut pas être modifiée manuellement. Extournez-la ou annulez l'opération."));

        // G5 : écriture lettrée — levé pour le cabinet (D3, délettrage automatique transactionnel).
        if (entry.Lines.Any(l => !string.IsNullOrEmpty(l.LetteringCode)))
            return Result.Failure(Error.Validation("Lettering",
                "Délettrez cette écriture avant de la modifier."));

        return null;
    }
}

public sealed record DeleteDraftJournalEntryCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteDraftJournalEntryCommandHandler : IRequestHandler<DeleteDraftJournalEntryCommand, Result>
{
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IAuditService _auditService;

    public DeleteDraftJournalEntryCommandHandler(
        IJournalEntryRepository journalEntries,
        IAuditService auditService)
    {
        _journalEntries = journalEntries;
        _auditService = auditService;
    }

    public async Task<Result> Handle(DeleteDraftJournalEntryCommand request, CancellationToken cancellationToken)
    {
        var entry = await _journalEntries.GetByIdAsync(request.Id, cancellationToken);
        if (entry is null)
            return Result.Failure(Error.NotFound("JournalEntry", request.Id));

        if (!entry.IsDraft)
            return Result.Failure(Error.Validation("Status", "Seule une écriture en brouillon peut être supprimée."));

        // C4 : même verrou que la modification — la période close fige aussi ses brouillons résiduels.
        if (entry.AccountingPeriod?.IsClosed == true)
            return Result.Failure(Error.Validation("Period", "La période de cette écriture est clôturée."));

        // C4b (R-07/R-08) : absolu, y compris pour le cabinet — un brouillon d'écriture paie se
        // supprime via le workflow (réouverture du cycle), jamais directement.
        if (PayrollSourcedEntryGuard.IsSystemSource(entry.SourceEntityType))
            return Result.Failure(Error.Validation("Source",
                "Cette écriture est générée par le module Paie ; elle ne peut pas être supprimée manuellement. Utilisez « Rouvrir le cycle » ou « Annuler le paiement »."));

        // C5 : la suppression d'un brouillon d'extourne doit restaurer l'écriture d'origine
        // (marquée IsReversed dès la création de l'extourne), sinon elle resterait verrouillée
        // avec une référence d'extourne orpheline.
        JournalEntry? reversedOriginal = null;
        if (entry.ReversesEntryId is Guid originalId)
        {
            reversedOriginal = await _journalEntries.GetByIdAsync(originalId, cancellationToken);
            if (reversedOriginal is not null && reversedOriginal.ReversedByEntryId == entry.Id)
            {
                reversedOriginal.ClearReversalMark();
                await _journalEntries.UpdateAsync(reversedOriginal, cancellationToken);
            }
        }

        await _journalEntries.RemoveAsync(entry, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.DraftDeleted,
            "JournalEntry",
            entry.Id,
            oldValues: new { entry.JournalCode, entry.EntryNumber, entry.ReversesEntryId, RestoredOriginalId = reversedOriginal?.Id },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}

// ── Phase 2 : extourne manuelle ───────────────────────────────────────────────────

public sealed record ReverseJournalEntryCommand(Guid Id, string Reason) : IRequest<Result<Guid>>;

public sealed class ReverseJournalEntryCommandHandler : IRequestHandler<ReverseJournalEntryCommand, Result<Guid>>
{
    private readonly IAccountingService _accountingService;
    private readonly IAuditService _auditService;

    public ReverseJournalEntryCommandHandler(
        IAccountingService accountingService,
        IAuditService auditService)
    {
        _accountingService = accountingService;
        _auditService = auditService;
    }

    public async Task<Result<Guid>> Handle(ReverseJournalEntryCommand request, CancellationToken cancellationToken)
    {
        var result = await _accountingService.ReverseJournalEntryAsync(request.Id, request.Reason, cancellationToken);
        if (result.IsSuccess)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.EntryReversed,
                "JournalEntry",
                request.Id,
                newValues: new { ReversalEntryId = result.Value, request.Reason },
                cancellationToken: cancellationToken);
        }

        return result;
    }
}

// ── Phase 3 : reprise de dossier par import ────────────────────────────────────────

public sealed record PreviewJournalImportCommand(
    byte[] Content, JournalImportFormat Format, byte[]? AccountMappingContent = null)
    : IRequest<Result<JournalImportPreviewDto>>;

public sealed class PreviewJournalImportCommandHandler : IRequestHandler<PreviewJournalImportCommand, Result<JournalImportPreviewDto>>
{
    private readonly IJournalImportService _importService;

    public PreviewJournalImportCommandHandler(IJournalImportService importService)
    {
        _importService = importService;
    }

    public Task<Result<JournalImportPreviewDto>> Handle(PreviewJournalImportCommand request, CancellationToken cancellationToken)
        => _importService.PreviewAsync(request.Content, request.Format, request.AccountMappingContent, cancellationToken);
}

public sealed record CommitJournalImportCommand(
    byte[] Content, JournalImportFormat Format, byte[]? AccountMappingContent = null)
    : IRequest<Result<JournalImportCommitResultDto>>;

public sealed class CommitJournalImportCommandHandler : IRequestHandler<CommitJournalImportCommand, Result<JournalImportCommitResultDto>>
{
    private readonly IJournalImportService _importService;
    private readonly IAuditService _auditService;

    public CommitJournalImportCommandHandler(IJournalImportService importService, IAuditService auditService)
    {
        _importService = importService;
        _auditService = auditService;
    }

    public async Task<Result<JournalImportCommitResultDto>> Handle(CommitJournalImportCommand request, CancellationToken cancellationToken)
    {
        var result = await _importService.CommitAsync(request.Content, request.Format, request.AccountMappingContent, cancellationToken);
        if (result.IsSuccess)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.DossierImported,
                "JournalEntry",
                newValues: new { request.Format, result.Value.ImportedEntries, result.Value.ImportedLines },
                cancellationToken: cancellationToken);
        }

        return result;
    }
}

// ── Remplacement de compte (traitement de maintenance) ─────────────────────────────

public sealed record PreviewAccountReplacementQuery(string Account) : IRequest<Result<int>>;

public sealed class PreviewAccountReplacementQueryHandler : IRequestHandler<PreviewAccountReplacementQuery, Result<int>>
{
    private readonly IAccountingService _accountingService;

    public PreviewAccountReplacementQueryHandler(IAccountingService accountingService)
    {
        _accountingService = accountingService;
    }

    public async Task<Result<int>> Handle(PreviewAccountReplacementQuery request, CancellationToken cancellationToken)
        => Result.Success(await _accountingService.CountReplaceableLinesAsync(request.Account, cancellationToken));
}

public sealed record ReplaceAccountCommand(string OldAccount, string NewAccount) : IRequest<Result<int>>;

public sealed class ReplaceAccountCommandHandler : IRequestHandler<ReplaceAccountCommand, Result<int>>
{
    private readonly IAccountingService _accountingService;
    private readonly IAuditService _auditService;
    private readonly AccountingSettings _settings;

    public ReplaceAccountCommandHandler(
        IAccountingService accountingService,
        IAuditService auditService,
        IOptions<AccountingSettings> settings)
    {
        _accountingService = accountingService;
        _auditService = auditService;
        _settings = settings.Value;
    }

    public async Task<Result<int>> Handle(ReplaceAccountCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.AccountReplacementEnabled)
            return Result.Failure<int>(Error.Validation("Account", "Le remplacement de compte n'est pas activé."));

        var result = await _accountingService.ReplaceAccountAsync(request.OldAccount, request.NewAccount, cancellationToken);
        if (result.IsSuccess)
        {
            await _auditService.LogAsync(
                AuditActions.Accounting.AccountReplaced,
                "ChartOfAccount",
                newValues: new { request.OldAccount, request.NewAccount, LinesAffected = result.Value },
                cancellationToken: cancellationToken);
        }

        return result;
    }
}

/// <summary>
/// Mapping des lignes de saisie manuelle vers le domaine, avec tiers optionnel (plan tiers) :
/// un ThirdPartyId fourni exige un kind valide (1 = client, 2 = fournisseur) ; sans tiers,
/// comportement historique strict (null / ThirdPartyKind.None).
/// </summary>
public static class ManualJournalLineMapper
{
    public static Result<List<JournalLineInput>> Map(IReadOnlyList<ManualJournalLineRequest> lines)
    {
        var mapped = new List<JournalLineInput>(lines.Count);
        foreach (var l in lines)
        {
            Guid? thirdPartyId = null;
            var kind = ThirdPartyKind.None;
            if (l.ThirdPartyId is { } id && id != Guid.Empty)
            {
                if (l.ThirdPartyKind is not ((int)ThirdPartyKind.Client or (int)ThirdPartyKind.Supplier))
                    return Result.Failure<List<JournalLineInput>>(Error.Validation(
                        "ThirdPartyKind", "Type de tiers obligatoire (1 = client, 2 = fournisseur) quand un tiers est fourni."));
                thirdPartyId = id;
                kind = (ThirdPartyKind)l.ThirdPartyKind!.Value;
            }
            mapped.Add(new JournalLineInput(l.AccountNumber, l.LineLabel, l.Debit, l.Credit, thirdPartyId, kind,
                l.DebitInCurrency, l.CreditInCurrency));
        }
        return Result.Success(mapped);
    }
}
