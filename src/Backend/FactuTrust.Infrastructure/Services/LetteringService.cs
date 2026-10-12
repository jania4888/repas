using System.Data;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Services.Payroll;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace FactuTrust.Infrastructure.Services;

public sealed class LetteringService : ILetteringService
{
    private const int MaxConcurrencyRetries = 3;

    /// <summary>
    /// Qui peut outrepasser le verrou de période (D9, §5.3/5.5) : les flux automatiques internes
    /// (paiements, paie) passent <see cref="Allow"/>, toute action d'origine utilisateur passe
    /// <see cref="Reject"/>.
    /// </summary>
    private enum PeriodLockPolicy { Reject, Allow }

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly TenantAmbientTransaction _ambient;
    private readonly ICurrentUser? _currentUser;
    private readonly ILogger<LetteringService> _logger;

    public LetteringService(
        ITenantDbContextFactory contextFactory,
        TenantAmbientTransaction ambient,
        ICurrentUser? currentUser = null,
        ILogger<LetteringService>? logger = null)
    {
        _contextFactory = contextFactory;
        _ambient = ambient;
        _currentUser = currentUser;
        _logger = logger ?? NullLogger<LetteringService>.Instance;
    }

    private string ActingUser => _currentUser?.Email ?? "system";

    private static PeriodLockPolicy PolicyFor(LetteringOrigin origin) =>
        origin == LetteringOrigin.Automatic ? PeriodLockPolicy.Allow : PeriodLockPolicy.Reject;

    public async Task<Result<LetteringOutcome>> ManualLetterAsync(
        IReadOnlyList<Guid> journalEntryLineIds,
        bool allowPartial = false,
        LetteringOrigin origin = LetteringOrigin.Manual,
        CancellationToken cancellationToken = default)
    {
        if (journalEntryLineIds.Count < 2)
            return Result.Failure<LetteringOutcome>(Error.Validation("Lines", "Au moins deux lignes d'écriture sont requises pour le lettrage."));

        // Doublons d'identifiants = entrée invalide (LETTERING_VALIDATION), pas « lignes
        // introuvables » : la comparaison de comptages aval ne pourrait pas les distinguer.
        if (journalEntryLineIds.Distinct().Count() != journalEntryLineIds.Count)
            return Result.Failure<LetteringOutcome>(LetteringErrors.Validation("La liste des lignes contient des doublons."));

        var lockPolicy = PolicyFor(origin);

        if (_ambient.IsActive)
        {
            await using var ctx = _contextFactory.CreateContext();
            return await LetterInContextAsync(ctx, journalEntryLineIds, allowPartial, lockPolicy, saveChanges: true, cancellationToken);
        }

        await using var strategyContext = _contextFactory.CreateIsolatedContext();
        var strategy = strategyContext.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync(async () =>
        {
            for (var attempt = 0; attempt < MaxConcurrencyRetries; attempt++)
            {
                await using var ctx = _contextFactory.CreateIsolatedContext();
                // Validation DANS la transaction Serializable (et non avant) : plus de fenêtre de
                // course entre « lignes libres » et l'écriture du lettrage (voir ValidateLinesAsync).
                await using var transaction = ctx.Database.IsRelational()
                    ? await ctx.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
                    : null;

                var validation = await ValidateLinesAsync(ctx, journalEntryLineIds, allowPartial, lockPolicy, cancellationToken);
                if (validation.IsFailure)
                {
                    if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
                    return Result.Failure<LetteringOutcome>(validation.Error);
                }

                var uniqueViolation = new UniqueViolationFlag();
                var result = await LetterInContextAsync(
                    ctx, journalEntryLineIds, allowPartial, lockPolicy, saveChanges: true, cancellationToken, validation.Value, uniqueViolation);

                if (result.IsFailure)
                {
                    if (transaction is not null) await transaction.RollbackAsync(cancellationToken);

                    // Ne retenter QUE sur une vraie violation d'index unique perdue en course
                    // (ex. fenêtre résiduelle hors transaction) — jamais sur un refus de
                    // validation déterministe, qui échouerait à l'identique à chaque essai.
                    if (uniqueViolation.Occurred && attempt < MaxConcurrencyRetries - 1)
                        continue;

                    return result;
                }

                if (transaction is not null) await transaction.CommitAsync(cancellationToken);
                return result;
            }

            return Result.Failure<LetteringOutcome>(
                LetteringErrors.AlreadyLettered("Une ou plusieurs lignes ont été lettrées entre-temps."));
        });
    }

    /// <summary>
    /// Marqueur interne (jamais exposé) : vrai uniquement quand l'échec vient d'une violation
    /// d'index unique interceptée au <c>SaveChanges</c> — seul cas où retenter l'opération a un
    /// sens. Distingue ce cas du refus de validation « déjà lettrée / déjà membre », qui porte le
    /// même code <see cref="LetteringErrorCodes.AlreadyLettered"/> mais est déterministe.
    /// </summary>
    private sealed class UniqueViolationFlag
    {
        public bool Occurred { get; set; }
    }

    public async Task<Result<LetteringOutcome>> CompletePartialAsync(
        string code,
        IReadOnlyList<Guid> newLineIds,
        bool allowPartial,
        LetteringOrigin origin = LetteringOrigin.Manual,
        CancellationToken cancellationToken = default)
    {
        code = code?.Trim().ToUpperInvariant() ?? string.Empty;
        if (string.IsNullOrEmpty(code))
            return Result.Failure<LetteringOutcome>(Error.Validation("Code", "Le code du groupe partiel est obligatoire."));

        if (newLineIds.Count == 0)
            return Result.Failure<LetteringOutcome>(Error.Validation("Lines", "Au moins une nouvelle ligne est requise."));

        // Doublons d'identifiants = entrée invalide (LETTERING_VALIDATION), pas « lignes
        // introuvables » (même règle que ManualLetterAsync).
        if (newLineIds.Distinct().Count() != newLineIds.Count)
            return Result.Failure<LetteringOutcome>(LetteringErrors.Validation("La liste des lignes contient des doublons."));

        // Complément : toujours d'origine utilisateur côté verrou de période (D9) — l'auto-lettrage
        // ne passe jamais par cette action.
        const PeriodLockPolicy lockPolicy = PeriodLockPolicy.Reject;

        // Transaction ambiante active (ex. flux interne englobant) : on la rejoint, comme
        // ManualLetterAsync — jamais de contexte isolé en parallèle de la transaction englobante.
        if (_ambient.IsActive)
        {
            await using var ambientCtx = _contextFactory.CreateContext();
            return await CompleteInContextAsync(ambientCtx, code, newLineIds, allowPartial, lockPolicy, null, cancellationToken);
        }

        await using var strategyContext = _contextFactory.CreateIsolatedContext();
        var strategy = strategyContext.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync(async () =>
        {
            for (var attempt = 0; attempt < MaxConcurrencyRetries; attempt++)
            {
                await using var ctx = _contextFactory.CreateIsolatedContext();
                await using var transaction = ctx.Database.IsRelational()
                    ? await ctx.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
                    : null;

                var uniqueViolation = new UniqueViolationFlag();
                var result = await CompleteInContextAsync(ctx, code, newLineIds, allowPartial, lockPolicy, uniqueViolation, cancellationToken);

                if (result.IsFailure)
                {
                    if (transaction is not null) await transaction.RollbackAsync(cancellationToken);

                    // Ne retenter QUE sur une vraie violation d'index unique perdue en course —
                    // jamais sur un refus de validation déterministe (« déjà lettrée »,
                    // « déjà membre »…), qui échouerait à l'identique à chaque essai.
                    if (uniqueViolation.Occurred && attempt < MaxConcurrencyRetries - 1)
                        continue;

                    return result;
                }

                if (transaction is not null) await transaction.CommitAsync(cancellationToken);
                return result;
            }

            return Result.Failure<LetteringOutcome>(
                LetteringErrors.AlreadyLettered("Une ou plusieurs lignes ont été lettrées entre-temps."));
        });
    }

    private async Task<Result<LetteringOutcome>> CompleteInContextAsync(
        TenantDbContext ctx,
        string code,
        IReadOnlyList<Guid> newLineIds,
        bool allowPartial,
        PeriodLockPolicy lockPolicy,
        UniqueViolationFlag? uniqueViolation,
        CancellationToken cancellationToken)
    {
        var group = await ctx.LetteringGroups
            .Include(g => g.Members)
            .FirstOrDefaultAsync(g => g.Code == code, cancellationToken);
        if (group is null)
            return Result.Failure<LetteringOutcome>(LetteringErrors.GroupNotFound($"Aucun groupe de lettrage « {code} » n'existe."));

        if (!group.IsPartial)
            return Result.Failure<LetteringOutcome>(LetteringErrors.GroupNotPartial("Seul un groupe partiel peut être complété."));

        var existingIds = group.Members.Select(m => m.JournalEntryLineId).ToList();
        if (newLineIds.Any(existingIds.Contains))
            return Result.Failure<LetteringOutcome>(LetteringErrors.AlreadyLettered("Une ou plusieurs lignes sont déjà membres de ce groupe."));

        var existingLines = await ctx.JournalEntryLines
            .AsTracking()
            .Include(l => l.JournalEntry).ThenInclude(e => e!.AccountingPeriod)
            .Where(l => existingIds.Contains(l.Id))
            .ToListAsync(cancellationToken);

        // Les membres actuels doivent encore porter le code du groupe : sinon la donnée est
        // incohérente (état historique corrompu, pré-index unique, ou réparation runbook en
        // cours) et compléter masquerait le problème au lieu de le signaler.
        var mismatchedLine = existingLines.FirstOrDefault(l =>
            !string.Equals(l.LetteringCode, group.Code, StringComparison.Ordinal));
        if (mismatchedLine is not null)
        {
            return Result.Failure<LetteringOutcome>(LetteringErrors.GroupInconsistent(
                $"Le groupe « {group.Code} » est incohérent : la ligne {LetteringPeriodLock.DescribeLine(mismatchedLine)} ne porte plus son code. Réparer via le runbook docs/runbooks/lettering-integrity.md."));
        }

        var newLoaded = await LoadUnletteredLinesAsync(ctx, newLineIds, cancellationToken);
        if (newLoaded.IsFailure)
            return Result.Failure<LetteringOutcome>(newLoaded.Error);
        var newLines = newLoaded.Value;

        if (newLines.Any(l => l.AccountNumber != group.AccountNumber))
            return Result.Failure<LetteringOutcome>(LetteringErrors.AccountMismatch("Les nouvelles lignes doivent être sur le même compte que le groupe."));

        var currency = existingLines.Count > 0
            ? existingLines[0].JournalEntry?.CurrencyCode ?? Money.DefaultCurrency
            : newLines[0].JournalEntry?.CurrencyCode ?? Money.DefaultCurrency;
        if (newLines.Any(l => (l.JournalEntry?.CurrencyCode ?? Money.DefaultCurrency) != currency))
            return Result.Failure<LetteringOutcome>(LetteringErrors.CurrencyMismatch("Les nouvelles lignes doivent partager la devise du groupe."));

        var allLines = existingLines.Concat(newLines).ToList();

        if (lockPolicy == PeriodLockPolicy.Reject)
        {
            var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
            var lockedLine = allLines.FirstOrDefault(l => LetteringPeriodLock.IsLocked(l, lockedYears));
            if (lockedLine is not null)
            {
                return Result.Failure<LetteringOutcome>(LetteringErrors.PeriodLocked(
                    $"Lettrage impossible : la ligne {LetteringPeriodLock.DescribeLine(lockedLine)} appartient à une période clôturée."));
            }
        }

        var debit = allLines.Sum(l => l.DebitAmount.Amount);
        var credit = allLines.Sum(l => l.CreditAmount.Amount);
        var foreign = currency != Money.DefaultCurrency;
        var debitForBalance = foreign ? allLines.Sum(l => l.DebitAmountInCurrency) : debit;
        var creditForBalance = foreign ? allLines.Sum(l => l.CreditAmountInCurrency) : credit;
        var balanced = Math.Round(debitForBalance, 3) == Math.Round(creditForBalance, 3);

        if (!balanced && !allowPartial)
            return Result.Failure<LetteringOutcome>(LetteringErrors.Unbalanced(
                "Le lettrage nécessite une égalité débit / crédit (ou cochez « lettrage partiel »)."));

        var previousCode = group.Code;
        string finalCode;
        if (balanced)
        {
            // Même numéro, préfixe définitif (D7) : traçabilité P -> L conservée par PreviousCode.
            finalCode = $"L{previousCode.AsSpan(1)}";
            var finalizeResult = group.Finalize(finalCode, Money.Create(debit, Money.DefaultCurrency));
            if (finalizeResult.IsFailure)
                return Result.Failure<LetteringOutcome>(finalizeResult.Error);
        }
        else
        {
            finalCode = previousCode;
            // Le groupe reste partiel : son montant doit refléter la partie couverte APRÈS ajout,
            // avec la même règle qu'à la création (LetterInContextAsync : min(débit, crédit) en
            // devise de tenue). Sans ce recalcul, le groupe « P » garderait son ancien montant.
            var partialAmount = group.UpdatePartialAmount(Money.Create(Math.Min(debit, credit), Money.DefaultCurrency));
            if (partialAmount.IsFailure)
                return Result.Failure<LetteringOutcome>(partialAmount.Error);
        }

        var addResult = group.AddMembers(newLineIds);
        if (addResult.IsFailure)
            return Result.Failure<LetteringOutcome>(addResult.Error);

        group.SetAuditInfo(ActingUser, true);
        foreach (var line in newLines)
            line.SetLetteringCode(finalCode);

        if (balanced)
        {
            foreach (var line in existingLines)
                line.SetLetteringCode(finalCode);
        }

        try
        {
            await ctx.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            if (uniqueViolation is not null)
                uniqueViolation.Occurred = true;
            return Result.Failure<LetteringOutcome>(
                LetteringErrors.AlreadyLettered("Une ou plusieurs lignes ont été lettrées entre-temps."));
        }

        var lineIds = allLines.Select(l => l.Id).ToList();
        return Result.Success(new LetteringOutcome(
            group.Id, finalCode, group.AccountNumber, group.Amount.Amount, currency, !balanced, lineIds, previousCode));
    }

    private async Task<Result<LetteringOutcome>> LetterInContextAsync(
        TenantDbContext ctx,
        IReadOnlyList<Guid> journalEntryLineIds,
        bool allowPartial,
        PeriodLockPolicy lockPolicy,
        bool saveChanges,
        CancellationToken cancellationToken,
        LetteringValidation? prevalidated = null,
        UniqueViolationFlag? uniqueViolation = null)
    {
        LetteringValidation validation;
        if (prevalidated is not null)
        {
            validation = prevalidated;
        }
        else
        {
            var validationResult = await ValidateLinesAsync(ctx, journalEntryLineIds, allowPartial, lockPolicy, cancellationToken);
            if (validationResult.IsFailure)
                return Result.Failure<LetteringOutcome>(validationResult.Error);
            validation = validationResult.Value;
        }

        var (lines, account, isPartial, currency, debit, credit, transactionCurrency, _) = validation;

        var code = await NextCodeAsync(ctx, isPartial, cancellationToken);
        var amount = isPartial ? Math.Min(debit, credit) : debit;
        var create = LetteringGroup.Create(
            code,
            account,
            Money.Create(amount, currency),
            journalEntryLineIds.ToList(),
            isPartial);

        if (create.IsFailure)
            return Result.Failure<LetteringOutcome>(create.Error);

        var group = create.Value;
        group.SetAuditInfo(ActingUser, false);
        ctx.LetteringGroups.Add(group);

        foreach (var line in lines)
            line.SetLetteringCode(code);

        if (saveChanges)
        {
            try
            {
                await ctx.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                if (uniqueViolation is not null)
                    uniqueViolation.Occurred = true;
                return Result.Failure<LetteringOutcome>(
                    LetteringErrors.AlreadyLettered("Une ou plusieurs lignes ont été lettrées entre-temps."));
            }
        }

        return Result.Success(new LetteringOutcome(
            group.Id, code, account, amount, transactionCurrency, isPartial, journalEntryLineIds.ToList()));
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.GetBaseException() is SqlException { Number: 2601 or 2627 };

    private static async Task<Result<List<JournalEntryLine>>> LoadUnletteredLinesAsync(
        TenantDbContext ctx, IReadOnlyList<Guid> lineIds, CancellationToken cancellationToken)
    {
        // Doublons d'identifiants = entrée invalide (LETTERING_VALIDATION) : la comparaison de
        // comptages ci-dessous répondrait sinon « introuvable », un message trompeur.
        if (lineIds.Distinct().Count() != lineIds.Count)
            return Result.Failure<List<JournalEntryLine>>(LetteringErrors.Validation("La liste des lignes contient des doublons."));

        var lines = await ctx.JournalEntryLines
            .AsTracking()
            .Include(l => l.JournalEntry).ThenInclude(e => e!.AccountingPeriod)
            .Where(l => lineIds.Contains(l.Id))
            .ToListAsync(cancellationToken);

        if (lines.Count != lineIds.Count)
            return Result.Failure<List<JournalEntryLine>>(LetteringErrors.LinesNotFound("Une ou plusieurs lignes sont introuvables."));

        if (lines.Any(l => !string.IsNullOrEmpty(l.LetteringCode)))
            return Result.Failure<List<JournalEntryLine>>(LetteringErrors.AlreadyLettered("Une ou plusieurs lignes sont déjà lettrées."));

        return Result.Success(lines);
    }

    private static async Task<Result<LetteringValidation>> ValidateLinesAsync(
        TenantDbContext ctx,
        IReadOnlyList<Guid> journalEntryLineIds,
        bool allowPartial,
        PeriodLockPolicy lockPolicy,
        CancellationToken cancellationToken)
    {
        var loaded = await LoadUnletteredLinesAsync(ctx, journalEntryLineIds, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<LetteringValidation>(loaded.Error);
        var lines = loaded.Value;

        var account = lines[0].AccountNumber;
        if (lines.Any(l => l.AccountNumber != account))
            return Result.Failure<LetteringValidation>(LetteringErrors.AccountMismatch("Toutes les lignes doivent être sur le même compte."));

        // Unicité de devise contrôlée AVANT l'équilibre : dans l'ordre inverse, un groupe
        // multi-devises échouait d'abord sur « Balance », avec un message trompeur.
        var currency = lines[0].JournalEntry?.CurrencyCode ?? Money.DefaultCurrency;
        if (lines.Any(l => (l.JournalEntry?.CurrencyCode ?? Money.DefaultCurrency) != currency))
            return Result.Failure<LetteringValidation>(LetteringErrors.CurrencyMismatch("Les lignes doivent partager la même devise."));

        // Verrou de période (D8/D9) : contrôlé dans la transaction, avant toute écriture.
        if (lockPolicy == PeriodLockPolicy.Reject)
        {
            var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
            var lockedLine = lines.FirstOrDefault(l => LetteringPeriodLock.IsLocked(l, lockedYears));
            if (lockedLine is not null)
            {
                return Result.Failure<LetteringValidation>(LetteringErrors.PeriodLocked(
                    $"Lettrage impossible : la ligne {LetteringPeriodLock.DescribeLine(lockedLine)} appartient à une période clôturée."));
            }
        }

        // Montants en devise de tenue : ils alimentent le groupe de lettrage et révèlent l'écart de
        // change quand le compte est soldé en devise mais pas en dinar.
        var debit = lines.Sum(l => l.DebitAmount.Amount);
        var credit = lines.Sum(l => l.CreditAmount.Amount);

        // L'équilibre s'apprécie sur la devise de l'opération : deux règlements de 1 000 EUR à des
        // taux différents soldent le compte en euros, tout en laissant un écart en dinars.
        var foreign = currency != Money.DefaultCurrency;
        var debitForBalance = foreign ? lines.Sum(l => l.DebitAmountInCurrency) : debit;
        var creditForBalance = foreign ? lines.Sum(l => l.CreditAmountInCurrency) : credit;

        var balanced = Math.Round(debitForBalance, 3) == Math.Round(creditForBalance, 3);
        if (!balanced && !allowPartial)
        {
            return Result.Failure<LetteringValidation>(LetteringErrors.Unbalanced(
                "Le lettrage nécessite une égalité débit / crédit (ou cochez « lettrage partiel »)."));
        }

        var isPartial = !balanced;

        return Result.Success(new LetteringValidation(
            lines, account, isPartial, Money.DefaultCurrency, debit, credit,
            currency, Math.Round(debit - credit, 3)));
    }

    /// <param name="Currency">Devise du groupe de lettrage, toujours la devise de tenue (les montants du groupe le sont).</param>
    /// <param name="TransactionCurrency">Devise des opérations lettrées.</param>
    /// <param name="LocalGap">
    /// Écart en devise de tenue. Non nul alors que le groupe est équilibré en devise = écart de
    /// change, à apurer par une écriture d'ajustement.
    /// </param>
    private sealed record LetteringValidation(
        List<JournalEntryLine> Lines,
        string Account,
        bool IsPartial,
        string Currency,
        decimal Debit,
        decimal Credit,
        string TransactionCurrency,
        decimal LocalGap);

    public async Task<Result<UnletteringOutcome>> UnletterAsync(
        string code,
        LetteringOrigin origin = LetteringOrigin.Manual,
        CancellationToken cancellationToken = default)
    {
        code = code?.Trim().ToUpperInvariant() ?? string.Empty;
        if (string.IsNullOrEmpty(code))
            return Result.Failure<UnletteringOutcome>(Error.Validation("Code", "Le code de lettrage est obligatoire."));

        // Même forme que ManualLetterAsync : transaction ambiante si elle existe (édition de
        // brouillon, annulation de paie), sinon contexte ISOLÉ + transaction Serializable. Sans
        // cela, le délettrage HTTP lisait le groupe hors de toute transaction : un lettrage ou
        // une complétion concurrente pouvait se glisser entre la lecture et l'écriture.
        if (_ambient.IsActive)
        {
            await using var ambientCtx = _contextFactory.CreateContext();
            return await UnletterInContextAsync(ambientCtx, code, cancellationToken);
        }

        await using var strategyContext = _contextFactory.CreateIsolatedContext();
        var strategy = strategyContext.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync(async () =>
        {
            await using var ctx = _contextFactory.CreateIsolatedContext();
            await using var transaction = ctx.Database.IsRelational()
                ? await ctx.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
                : null;

            var result = await UnletterInContextAsync(ctx, code, cancellationToken);
            if (result.IsFailure)
            {
                if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
                return result;
            }

            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return result;
        });
    }

    private async Task<Result<UnletteringOutcome>> UnletterInContextAsync(
        TenantDbContext ctx, string code, CancellationToken cancellationToken)
    {
        var group = await ctx.LetteringGroups
            .Include(g => g.Members)
            .FirstOrDefaultAsync(g => g.Code == code, cancellationToken);
        if (group is null)
            return Result.Failure<UnletteringOutcome>(LetteringErrors.GroupNotFound($"Aucun groupe de lettrage « {code} » n'existe."));

        var lineIds = group.Members.Select(m => m.JournalEntryLineId).ToList();

        // Ne libère QUE les lignes qui portent encore le code du groupe : une ligne membre qui
        // porte un AUTRE code (donnée historique incohérente, pré-index unique) appartient à un
        // autre lettrage et ne doit jamais être délettrée ici.
        var lines = await ctx.JournalEntryLines
            .AsTracking()
            .Include(l => l.JournalEntry).ThenInclude(e => e!.AccountingPeriod)
            .Where(l => lineIds.Contains(l.Id) && l.LetteringCode == group.Code)
            .ToListAsync(cancellationToken);

        // Délettrage interdit en période verrouillée, quelle que soit l'origine (D8).
        var lockedYears = await LetteringLockedYears.LoadAsync(ctx, cancellationToken);
        var lockedLine = lines.FirstOrDefault(l => LetteringPeriodLock.IsLocked(l, lockedYears));
        if (lockedLine is not null)
        {
            return Result.Failure<UnletteringOutcome>(LetteringErrors.PeriodLocked(
                $"Délettrage impossible : la ligne {LetteringPeriodLock.DescribeLine(lockedLine)} appartient à une période clôturée."));
        }

        var currency = lines.Count > 0 ? lines[0].JournalEntry?.CurrencyCode ?? Money.DefaultCurrency : Money.DefaultCurrency;

        foreach (var line in lines)
            line.SetLetteringCode(null);

        ctx.LetteringGroups.Remove(group);
        await ctx.SaveChangesAsync(cancellationToken);

        return Result.Success(new UnletteringOutcome(
            group.Id, group.Code, group.AccountNumber, group.Amount.Amount, currency, group.IsPartial, lineIds));
    }

    /// <summary>
    /// Prochain code de lettrage : max de la partie numérique des codes existants + 1 (préfixe
    /// « L » définitif, « P » partiel). Verrouille les lignes existantes (UPDLOCK/HOLDLOCK) sous
    /// SQL Server pour éviter deux groupes avec le même numéro sous forte concurrence ; repli en
    /// mémoire pour les fournisseurs non relationnels (InMemory, tests). Inclut les groupes ajoutés
    /// dans le contexte courant mais pas encore persistés (lettrage batch dans une transaction
    /// ambiante).
    /// </summary>
    private static async Task<string> NextCodeAsync(TenantDbContext ctx, bool isPartial, CancellationToken cancellationToken)
    {
        var pendingCodes = ctx.ChangeTracker.Entries<LetteringGroup>()
            .Where(e => e.State == EntityState.Added)
            .Select(e => e.Entity.Code)
            .ToList();

        if (ctx.Database.IsRelational())
        {
            var maxRows = await ctx.Database.SqlQueryRaw<int?>(
                "SELECT MAX(TRY_CAST(SUBSTRING([Code], 2, 15) AS int)) AS [Value] "
                + "FROM [LetteringGroups] WITH (UPDLOCK, HOLDLOCK)").ToListAsync(cancellationToken);
            var maxFromDb = maxRows.Single();

            var maxPending = pendingCodes
                .Select(c => c.Length > 1 && int.TryParse(c.AsSpan(1), out var n) ? n : 0)
                .DefaultIfEmpty(0)
                .Max();

            var next = Math.Max(maxFromDb ?? 0, maxPending) + 1;
            return $"{(isPartial ? 'P' : 'L')}{next:D5}";
        }

        var codes = await ctx.LetteringGroups
            .AsNoTracking()
            .Select(g => g.Code)
            .ToListAsync(cancellationToken);

        var nextInMemory = codes.Concat(pendingCodes)
            .Select(c => c.Length > 1 && int.TryParse(c.AsSpan(1), out var n) ? n : 0)
            .DefaultIfEmpty(0)
            .Max() + 1;

        return $"{(isPartial ? 'P' : 'L')}{nextInMemory:D5}";
    }

    public async Task<Result> AutoLetterPaymentAsync(
        string sourceEntityType,
        Guid sourceEntityId,
        string invoiceSourceType,
        Guid invoiceSourceId,
        CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var paymentEntry = await ctx.JournalEntries
            .AsNoTracking()
            .Include(j => j.Lines)
            .FirstOrDefaultAsync(j => j.SourceEntityType == sourceEntityType && j.SourceEntityId == sourceEntityId, cancellationToken);

        if (paymentEntry is null)
            return Result.Success();

        var invoiceEntry = await ctx.JournalEntries
            .AsNoTracking()
            .Include(j => j.Lines)
            .FirstOrDefaultAsync(j => j.SourceEntityType == invoiceSourceType && j.SourceEntityId == invoiceSourceId, cancellationToken);

        if (invoiceEntry is null)
            return Result.Success();

        var invoiceThirdPartyLines = invoiceEntry.Lines
            .Where(l => l.ThirdPartyId.HasValue && string.IsNullOrEmpty(l.LetteringCode))
            .ToList();

        var paymentThirdPartyLines = paymentEntry.Lines
            .Where(l => l.ThirdPartyId.HasValue && string.IsNullOrEmpty(l.LetteringCode))
            .ToList();

        foreach (var invoiceLine in invoiceThirdPartyLines)
        {
            var matchingPaymentLine = paymentThirdPartyLines
                .FirstOrDefault(p => p.AccountNumber == invoiceLine.AccountNumber);

            if (matchingPaymentLine is null)
                continue;

            var totalDebit = invoiceLine.DebitAmount.Amount + matchingPaymentLine.DebitAmount.Amount;
            var totalCredit = invoiceLine.CreditAmount.Amount + matchingPaymentLine.CreditAmount.Amount;

            if (Math.Round(totalDebit, 3) != Math.Round(totalCredit, 3))
                continue;

            var lineIds = new List<Guid> { invoiceLine.Id, matchingPaymentLine.Id };
            // Allow : un règlement en période ouverte doit pouvoir se lettrer avec une facture d'un
            // mois déjà clôturé (D9, flux automatiques internes).
            var result = await ManualLetterAsync(lineIds, allowPartial: false, LetteringOrigin.Automatic, cancellationToken);
            if (result.IsFailure)
                continue;
        }

        return Result.Success();
    }

    public async Task<Result> AutoLetterPayrollPaymentAsync(
        Guid payrollPaymentId,
        Guid payrollRunId,
        CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var paymentEntry = await ctx.JournalEntries
            .AsNoTracking()
            .Include(j => j.Lines)
            .FirstOrDefaultAsync(
                j => j.SourceEntityType == AccountingService.SourcePayrollPayment
                     && j.SourceEntityId == payrollPaymentId,
                cancellationToken);

        if (paymentEntry is null)
            return Result.Success();

        // Écriture ACTIVE du cycle : une OD extournée (cycle rouvert puis revalidé) ne doit jamais
        // être choisie à la place de l'écriture courante.
        var payrollEntry = await ctx.JournalEntries
            .AsNoTracking()
            .Include(j => j.Lines)
            .Where(j => j.SourceEntityType == AccountingService.SourcePayrollRun
                        && j.SourceEntityId == payrollRunId
                        && !j.IsReversed)
            .OrderByDescending(j => j.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (payrollEntry is null)
            return Result.Success();

        // Les groupes sont indexés par numéro de compte : un groupe de lettrage porte un compte
        // unique (invariant de LetteringGroup, vérifié par ValidateLinesAsync). Construire les
        // groupes à partir du compte rend cet invariant vrai par construction, et couvre
        // indifféremment l'OD ventilée par salarié (425xxxx) et l'OD agrégée (425) des cycles
        // validés avant les comptes auxiliaires.
        var runCredits = payrollEntry.Lines
            .Where(l => IsPersonnelPayable(l.AccountNumber)
                        && l.CreditAmount.Amount > 0
                        && string.IsNullOrEmpty(l.LetteringCode))
            .GroupBy(l => l.AccountNumber, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        var paymentDebits = paymentEntry.Lines
            .Where(l => IsPersonnelPayable(l.AccountNumber)
                        && l.DebitAmount.Amount > 0
                        && string.IsNullOrEmpty(l.LetteringCode))
            .GroupBy(l => l.AccountNumber, StringComparer.Ordinal);

        var letterRequests = new List<(IReadOnlyList<Guid> LineIds, bool AllowPartial)>();

        foreach (var debitGroup in paymentDebits)
        {
            if (!runCredits.TryGetValue(debitGroup.Key, out var credits) || credits.Count == 0)
            {
                _logger.LogWarning(
                    "Lettrage paie : aucune contrepartie non lettrée sur le compte {Account} pour le "
                    + "cycle {PayrollRunId} (paiement {PayrollPaymentId}). Rapprochement à faire manuellement.",
                    debitGroup.Key, payrollRunId, payrollPaymentId);
                continue;
            }

            var group = credits.Concat(debitGroup).ToList();
            var debit = group.Sum(l => l.DebitAmount.Amount);
            var credit = group.Sum(l => l.CreditAmount.Amount);
            var balanced = Math.Round(debit, 3) == Math.Round(credit, 3);

            letterRequests.Add((group.Select(l => l.Id).ToList(), !balanced));
        }

        if (letterRequests.Count == 0)
            return Result.Success();

        // Best-effort, comme AutoLetterPaymentAsync : le rapprochement est un confort comptable,
        // il ne doit jamais faire échouer — donc annuler — un règlement déjà comptabilisé.
        if (_ambient.IsActive)
        {
            await using var letterCtx = _contextFactory.CreateContext();
            foreach (var (lineIds, allowPartial) in letterRequests)
            {
                // ValidateLinesAsync échoue avant toute mutation du contexte : passer au groupe
                // suivant laisse intactes les mutations déjà enregistrées, et le SaveChanges final
                // reste atteint.
                var result = await LetterInContextAsync(
                    letterCtx, lineIds, allowPartial, PeriodLockPolicy.Allow, saveChanges: false, cancellationToken);
                if (result.IsFailure)
                    LogSkippedLettering(result, payrollPaymentId, payrollRunId);
            }

            await letterCtx.SaveChangesAsync(cancellationToken);
            return Result.Success();
        }

        foreach (var (lineIds, allowPartial) in letterRequests)
        {
            var result = await ManualLetterAsync(lineIds, allowPartial, LetteringOrigin.Automatic, cancellationToken);
            if (result.IsFailure)
                LogSkippedLettering(result, payrollPaymentId, payrollRunId);
        }

        return Result.Success();
    }

    /// <summary>Vrai pour le compte de dettes envers le personnel (425) et ses auxiliaires 425xxxx.</summary>
    private static bool IsPersonnelPayable(string accountNumber) =>
        accountNumber.StartsWith(PayrollJournalEntryBuilder.PersonnelPayableAccount, StringComparison.Ordinal);

    private void LogSkippedLettering(Result result, Guid payrollPaymentId, Guid payrollRunId) =>
        _logger.LogWarning(
            "Lettrage paie non posé pour le paiement {PayrollPaymentId} (cycle {PayrollRunId}) : {Reason}. "
            + "Le paiement reste enregistré ; le rapprochement peut être fait manuellement.",
            payrollPaymentId, payrollRunId, result.Error.Description);

    public async Task<Result> UnletterPayrollPaymentAsync(Guid payrollPaymentId, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var paymentEntry = await ctx.JournalEntries
            .AsNoTracking()
            .Include(j => j.Lines)
            .FirstOrDefaultAsync(
                j => j.SourceEntityType == AccountingService.SourcePayrollPayment
                     && j.SourceEntityId == payrollPaymentId,
                cancellationToken);

        if (paymentEntry is null)
            return Result.Success();

        var codes = paymentEntry.Lines
            .Select(l => l.LetteringCode)
            .Where(c => !string.IsNullOrEmpty(c))
            .Distinct()
            .ToList();

        foreach (var code in codes)
        {
            var result = await UnletterAsync(code!, LetteringOrigin.PayrollCancellation, cancellationToken);
            if (result.IsFailure)
            {
                // Best-effort (comme avant D8) : une période verrouillée depuis le lettrage ne doit
                // pas bloquer l'annulation du paiement, déjà engagée côté paie.
                _logger.LogWarning(
                    "Délettrage paie non abouti pour le groupe {Code} (paiement {PayrollPaymentId}) : {Reason}. "
                    + "L'annulation du paiement se poursuit ; le groupe reste lettré.",
                    code, payrollPaymentId, result.Error.Description);
                continue;
            }
        }

        return Result.Success();
    }
}
