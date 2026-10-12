using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Accounting;
using FactuTrust.Domain.ValueObjects;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.Commands;

/// <summary>
/// Apure l'écart de change d'une sélection de lettrage, puis lettre l'ensemble.
///
/// <para>
/// Cas visé : une dette de 1 000 EUR comptabilisée à 3,31420 puis réglée à 3,30200 solde le compte
/// <b>en euros</b> mais laisse 12,200 TND. Le lettrage, qui s'apprécie en devise, est possible ;
/// c'est la comptabilité en dinars qui reste déséquilibrée. Une écriture d'ajustement en devise de
/// tenue apure ce résidu.
/// </para>
///
/// <para>
/// Le compte d'imputation est <b>choisi à chaque équilibrage</b>, sans valeur par défaut : le
/// catalogue NCT 01 fournit 655 <i>Pertes de change</i> et 756 <i>Gains de change</i>, mais un
/// dossier non migré n'a encore que 6613 et aucun compte de gain.
/// </para>
/// </summary>
/// <param name="JournalEntryLineIds">Lignes sélectionnées sur l'écran de lettrage.</param>
/// <param name="AccountNumber">Compte d'imputation de l'écart, saisi par l'utilisateur.</param>
public sealed record SettleExchangeDifferenceCommand(
    IReadOnlyList<Guid> JournalEntryLineIds,
    string AccountNumber) : IRequest<Result<Guid>>;

public sealed class SettleExchangeDifferenceCommandHandler
    : IRequestHandler<SettleExchangeDifferenceCommand, Result<Guid>>
{
    /// <summary>Journal des opérations diverses : l'ajustement n'appartient à aucun journal métier.</summary>
    private const string AdjustmentJournalCode = "JOD";

    private const string AdjustmentLabel = "DIFFERENCE DE CHANGE";

    private readonly IJournalEntryRepository _journalEntries;
    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAccountingPeriodService _periodService;
    private readonly ILetteringService _lettering;
    private readonly ITenantUnitOfWork _unitOfWork;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public SettleExchangeDifferenceCommandHandler(
        IJournalEntryRepository journalEntries,
        IChartOfAccountRepository chartOfAccounts,
        IAccountingPeriodService periodService,
        ILetteringService lettering,
        ITenantUnitOfWork unitOfWork,
        IAuditService auditService,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _journalEntries = journalEntries;
        _chartOfAccounts = chartOfAccounts;
        _periodService = periodService;
        _lettering = lettering;
        _unitOfWork = unitOfWork;
        _auditService = auditService;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<Guid>> Handle(SettleExchangeDifferenceCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.MultiCurrencyEnabled)
            return Result.Failure<Guid>(Error.Validation("Currency", "La gestion multi-devises n'est pas activée."));

        if (request.JournalEntryLineIds.Count < 2)
            return Result.Failure<Guid>(Error.Validation("Lines", "Au moins deux lignes sont requises."));

        // Le compte est validé hors transaction, avant tout verrou.
        var accountNumber = (request.AccountNumber ?? string.Empty).Trim();
        var accountCheck = await ValidateAdjustmentAccountAsync(accountNumber, cancellationToken);
        if (accountCheck.IsFailure)
            return Result.Failure<Guid>(accountCheck.Error);

        var lines = await _journalEntries.GetLinesByIdsAsync(request.JournalEntryLineIds, cancellationToken);
        var analysis = Analyze(lines, request.JournalEntryLineIds.Count);
        if (analysis.IsFailure)
            return Result.Failure<Guid>(analysis.Error);

        // Verrou de période (D8/D9) : contrôlé AVANT la création de l'écriture d'ajustement, pour
        // qu'aucune écriture d'écart orpheline ne soit jamais même construite. Prédicat unique
        // partagé (LetteringPeriodLock) — ne jamais le dupliquer ici.
        var lockedYears = await _journalEntries.GetLockedFiscalYearsAsync(cancellationToken);
        var lockedLine = lines.FirstOrDefault(l => LetteringPeriodLock.IsLocked(l, lockedYears));
        if (lockedLine is not null)
        {
            return Result.Failure<Guid>(FactuTrust.Application.Features.Accounting.Lettering.LetteringErrors.PeriodLocked(
                $"Lettrage impossible : la ligne {LetteringPeriodLock.DescribeLine(lockedLine)} appartient à une période clôturée."));
        }

        var (thirdPartyAccount, gap, entryDate) = analysis.Value;

        Guid createdEntryId = Guid.Empty;

        var result = await _unitOfWork.ExecuteAsync(async ct =>
        {
            var period = await _periodService.EnsureOpenPeriodAsync(entryDate, ct);
            if (period.IsFailure)
                return Result.Failure(period.Error);

            // Le sens dépend du signe de l'écart — voir ExchangeDifferenceLines, où il est
            // documenté et testé pour lui-même.
            var adjustmentLines = ExchangeDifferenceLines.Build(
                thirdPartyAccount, accountNumber, gap, AdjustmentLabel);

            var number = await _journalEntries.ReserveNextEntryNumberAsync(AdjustmentJournalCode, entryDate.Year, ct);
            var create = JournalEntry.Create(
                number,
                AdjustmentJournalCode,
                entryDate,
                AdjustmentLabel,
                period.Value.Id,
                isAutoGenerated: true,
                sourceEntityType: "ExchangeDifference",
                sourceEntityId: null,
                adjustmentLines);

            if (create.IsFailure)
                return Result.Failure(create.Error);

            var entry = create.Value;
            entry.SetAuditInfo(_currentUser.Email ?? "system", false);
            await _journalEntries.AddAsync(entry, ct);
            createdEntryId = entry.Id;

            // La ligne d'ajustement portée par le compte lettré rejoint le groupe : c'est elle qui
            // rend la sélection équilibrée en dinars.
            var adjustmentLine = entry.Lines.First(l => l.AccountNumber == thirdPartyAccount);
            var toLetter = request.JournalEntryLineIds.Append(adjustmentLine.Id).ToList();

            var letterResult = await _lettering.ManualLetterAsync(
                toLetter, allowPartial: false, FactuTrust.Application.Features.Accounting.Lettering.LetteringOrigin.ExchangeDifference, ct);
            return letterResult.IsFailure ? Result.Failure(letterResult.Error) : Result.Success();
        }, cancellationToken);

        if (result.IsFailure)
            return Result.Failure<Guid>(result.Error);

        await _auditService.LogAsync(
            AuditActions.Accounting.ExchangeDifferenceSettled,
            "JournalEntry",
            createdEntryId,
            newValues: new { Account = thirdPartyAccount, AdjustmentAccount = accountNumber, Gap = gap },
            cancellationToken: cancellationToken);

        return Result.Success(createdEntryId);
    }

    /// <summary>
    /// Un écart de change s'impute en charge ou en produit financier, ou en écart de conversion.
    /// Sans cette borne, l'utilisateur pourrait déplacer une dette vers n'importe quel compte —
    /// un compte de trésorerie ou un autre tiers — et faire disparaître le déséquilibre sans le
    /// constater.
    /// </summary>
    private async Task<Result> ValidateAdjustmentAccountAsync(string accountNumber, CancellationToken cancellationToken)
    {
        if (accountNumber.Length == 0)
            return Result.Failure(Error.Validation("AccountNumber", "Le compte d'imputation de l'écart est obligatoire."));

        var account = await _chartOfAccounts.GetByAccountNumberAsync(accountNumber, cancellationToken);
        if (account is null)
            return Result.Failure(Error.Validation("AccountNumber", $"Le compte {accountNumber} n'existe pas dans le plan comptable."));

        if (!account.IsActive)
            return Result.Failure(Error.Validation("AccountNumber", $"Le compte {accountNumber} est désactivé."));

        var isProfitOrLoss = accountNumber.StartsWith('6') || accountNumber.StartsWith('7');
        var isConversionDifference = accountNumber.StartsWith("185") || accountNumber.StartsWith("275");

        if (!isProfitOrLoss && !isConversionDifference)
            return Result.Failure(Error.Validation("AccountNumber",
                "L'écart de change s'impute sur un compte de charges ou de produits (classe 6 ou 7), "
                + "ou sur un compte d'écarts de conversion (185 / 275)."));

        return Result.Success();
    }

    private static Result<(string Account, decimal Gap, DateTime EntryDate)> Analyze(
        IReadOnlyList<JournalEntryLine> lines,
        int expectedCount)
    {
        if (lines.Count != expectedCount)
            return Result.Failure<(string, decimal, DateTime)>(
                Error.Validation("JournalEntryLine", "Une ou plusieurs lignes sont introuvables."));

        if (lines.Any(l => !string.IsNullOrEmpty(l.LetteringCode)))
            return Result.Failure<(string, decimal, DateTime)>(
                Error.Validation("Lettering", "Une ou plusieurs lignes sont déjà lettrées."));

        var account = lines[0].AccountNumber;
        if (lines.Any(l => l.AccountNumber != account))
            return Result.Failure<(string, decimal, DateTime)>(
                Error.Validation("AccountNumber", "Toutes les lignes doivent être sur le même compte."));

        var currency = lines[0].JournalEntry?.CurrencyCode ?? Money.DefaultCurrency;
        if (lines.Any(l => (l.JournalEntry?.CurrencyCode ?? Money.DefaultCurrency) != currency))
            return Result.Failure<(string, decimal, DateTime)>(
                Error.Validation("Currency", "Les lignes doivent partager la même devise."));

        if (currency == Money.DefaultCurrency)
            return Result.Failure<(string, decimal, DateTime)>(Error.Validation("Currency",
                "Ces lignes sont déjà en devise de tenue : elles n'ont pas d'écart de change."));

        // Défense en profondeur : la sélection cliente est intégralement revérifiée.
        var debitCurrency = lines.Sum(l => l.DebitAmountInCurrency);
        var creditCurrency = lines.Sum(l => l.CreditAmountInCurrency);
        if (Math.Round(debitCurrency, 3) != Math.Round(creditCurrency, 3))
            return Result.Failure<(string, decimal, DateTime)>(Error.Validation("Balance",
                "La sélection n'est pas soldée en devise : l'écart n'est pas un écart de change."));

        var gap = Math.Round(lines.Sum(l => l.DebitAmount.Amount) - lines.Sum(l => l.CreditAmount.Amount), 3);
        if (gap == 0)
            return Result.Failure<(string, decimal, DateTime)>(Error.Validation("Balance",
                "La sélection est déjà équilibrée : aucun écart à apurer."));

        // L'ajustement se rattache à la plus récente des opérations lettrées : c'est le règlement
        // qui révèle l'écart, pas la dette d'origine.
        var entryDate = lines.Max(l => l.JournalEntry?.EntryDate ?? DateTime.UtcNow.Date);

        return Result.Success((account, gap, entryDate));
    }
}
