using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Rapprochement bancaire : import de relevés (CSV/Excel/PDF) et rapprochement ligne à ligne
/// avec les lignes d'écriture du journal de banque.
/// </summary>
public sealed class BankReconciliationService : IBankReconciliationService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly BankStatementImportParser _parser = new();
    private readonly OfxBankStatementParser _ofxParser = new();
    private readonly Mt940BankStatementParser _mt940Parser = new();
    private readonly IBankStatementPdfImportService _pdfImportService;
    private readonly IAccountingReportingService _reporting;
    private readonly AccountingSettings _settings;

    public BankReconciliationService(
        ITenantDbContextFactory contextFactory,
        IAuditService auditService,
        ICurrentUser currentUser,
        IBankStatementPdfImportService pdfImportService,
        IAccountingReportingService reporting,
        IOptions<AccountingSettings> settings)
    {
        _contextFactory = contextFactory;
        _auditService = auditService;
        _currentUser = currentUser;
        _pdfImportService = pdfImportService;
        _reporting = reporting;
        _settings = settings.Value;
    }

    public async Task<Result<BankStatementDto>> ImportStatementAsync(ImportBankStatementRequest request, CancellationToken cancellationToken = default)
    {
        var bankName = request.BankName?.Trim() ?? string.Empty;
        var accountNumber = request.AccountNumber?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(bankName))
            return Result.Failure<BankStatementDto>(Error.Validation("BankName", "Le nom de la banque est obligatoire."));
        if (string.IsNullOrEmpty(accountNumber))
            return Result.Failure<BankStatementDto>(Error.Validation("AccountNumber", "Le numéro de compte bancaire est obligatoire."));
        if (request.PeriodStart.Date > request.PeriodEnd.Date)
            return Result.Failure<BankStatementDto>(Error.Validation("Period", "La période du relevé est incohérente (début après fin)."));
        if (request.Lines.Count == 0)
            return Result.Failure<BankStatementDto>(Error.Validation("Lines", "Le relevé ne contient aucune ligne."));

        var currency = string.IsNullOrWhiteSpace(request.Currency) ? Money.DefaultCurrency : request.Currency.Trim();
        var user = _currentUser.Email ?? "system";

        var statement = BankStatement.Create(
            bankName,
            accountNumber,
            request.StatementDate.Date,
            request.PeriodStart.Date,
            request.PeriodEnd.Date,
            Money.Create(request.OpeningBalance, currency),
            Money.Create(request.ClosingBalance, currency));
        statement.SetAuditInfo(user, false);

        var importMethod = Enum.IsDefined(typeof(BankStatementImportMethod), request.ImportMethod)
            ? (BankStatementImportMethod)request.ImportMethod
            : BankStatementImportMethod.Manual;

        statement.SetProvenance(
            request.BankAccountId,
            request.ChartOfAccountNumber,
            request.SourceFileName,
            request.SourceFileHash,
            importMethod);

        await using var ctx = _contextFactory.CreateContext();

        // Dédoublonnage opt-in : empreintes déjà présentes pour le même compte bancaire.
        var existingFingerprints = new HashSet<string>(StringComparer.Ordinal);
        if (request.SkipAlreadyImported)
        {
            var candidateFingerprints = request.Lines
                .Select(l => BankStatementLine.ComputeFingerprint(
                    accountNumber, l.TransactionDate, l.Amount, l.IsDebit, l.Reference, l.Description))
                .Distinct()
                .ToList();
            existingFingerprints = (await ctx.BankStatementLines
                .Where(x => x.Fingerprint != null && candidateFingerprints.Contains(x.Fingerprint))
                .Select(x => x.Fingerprint!)
                .Distinct()
                .ToListAsync(cancellationToken))
                .ToHashSet(StringComparer.Ordinal);
        }

        var skippedCount = 0;
        foreach (var l in request.Lines)
        {
            if (l.Amount <= 0)
                return Result.Failure<BankStatementDto>(Error.Validation("Lines", "Chaque ligne du relevé doit avoir un montant strictement positif."));
            if (string.IsNullOrWhiteSpace(l.Description))
                return Result.Failure<BankStatementDto>(Error.Validation("Lines", "Chaque ligne du relevé doit avoir un libellé."));

            var fingerprint = BankStatementLine.ComputeFingerprint(
                accountNumber, l.TransactionDate, l.Amount, l.IsDebit, l.Reference, l.Description);
            if (request.SkipAlreadyImported && existingFingerprints.Contains(fingerprint))
            {
                skippedCount++;
                continue;
            }

            var line = BankStatementLine.Create(
                statement.Id,
                l.TransactionDate.Date,
                l.Reference?.Trim() ?? string.Empty,
                l.Description.Trim(),
                Money.Create(l.Amount, currency),
                l.IsDebit,
                l.ValueDate?.Date,
                fingerprint);
            line.SetAuditInfo(user, false);
            statement.Lines.Add(line);
        }

        if (statement.Lines.Count == 0)
            return Result.Failure<BankStatementDto>(Error.Validation("Lines",
                "Toutes les lignes de ce relevé ont déjà été importées pour ce compte."));

        ctx.BankStatements.Add(statement);
        await ctx.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.BankStatementImported,
            "BankStatement",
            statement.Id,
            newValues: new
            {
                bankName,
                accountNumber,
                LineCount = statement.Lines.Count,
                SkippedDuplicateCount = skippedCount,
                request.PeriodStart,
                request.PeriodEnd,
                request.BankAccountId,
                request.ChartOfAccountNumber,
                ImportMethod = importMethod.ToString()
            },
            cancellationToken: cancellationToken);

        return Result.Success(MapStatement(statement) with { SkippedDuplicateCount = skippedCount });
    }

    public async Task<Result<BankStatementDto>> GetStatementAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var statement = await ctx.BankStatements.AsNoTracking()
            .Include(s => s.Lines)
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (statement is null)
            return Result.Failure<BankStatementDto>(Error.NotFound("BankStatement", id));
        return Result.Success(MapStatement(statement));
    }

    public async Task<Result<IReadOnlyList<BankStatementDto>>> GetStatementsAsync(
        string? accountNumber, DateTime? from, DateTime? to, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var q = ctx.BankStatements.AsNoTracking().Include(s => s.Lines).AsQueryable();

        if (!string.IsNullOrWhiteSpace(accountNumber))
        {
            var acc = accountNumber.Trim();
            q = q.Where(s => s.AccountNumber == acc);
        }
        if (from.HasValue)
            q = q.Where(s => s.StatementDate >= from.Value.Date);
        if (to.HasValue)
            q = q.Where(s => s.StatementDate <= to.Value.Date);

        var list = await q
            .OrderByDescending(s => s.StatementDate)
            .ThenByDescending(s => s.PeriodEnd)
            .ToListAsync(cancellationToken);

        return Result.Success<IReadOnlyList<BankStatementDto>>(list.Select(MapStatement).ToList());
    }

    public async Task<Result> ReconcileLineAsync(ReconcileLineRequest request, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var line = await ctx.BankStatementLines
            .Include(l => l.BankStatement)
            .FirstOrDefaultAsync(l => l.Id == request.BankStatementLineId, cancellationToken);
        if (line is null)
            return Result.Failure(Error.NotFound("BankStatementLine", request.BankStatementLineId));

        var core = await ReconcileCoreAsync(ctx, line, request.JournalEntryLineId, cancellationToken);
        if (core.IsFailure)
            return core;

        line.SetAuditInfo(_currentUser.Email ?? "system", true);
        await ctx.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.BankLineReconciled,
            "BankStatementLine",
            line.Id,
            newValues: new { request.JournalEntryLineId },
            cancellationToken: cancellationToken);

        return Result.Success();
    }

    /// <summary>
    /// Gardes + marquage d'un rapprochement (ligne de relevé suivie ↔ ligne d'écriture), SANS
    /// <c>SaveChanges</c> (le caller persiste). Partagé entre le rapprochement unitaire et le lot.
    /// </summary>
    private static async Task<Result> ReconcileCoreAsync(
        TenantDbContext ctx, BankStatementLine line, Guid journalEntryLineId, CancellationToken cancellationToken)
    {
        if (line.IsReconciled)
            return Result.Failure(Error.Validation("Reconciliation", "Cette ligne de relevé est déjà rapprochée."));

        var journalLine = await ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .FirstOrDefaultAsync(l => l.Id == journalEntryLineId, cancellationToken);
        if (journalLine is null)
            return Result.Failure(Error.NotFound("JournalEntryLine", journalEntryLineId));

        if (journalLine.JournalEntry.Status == JournalEntryStatus.Brouillon)
            return Result.Failure(Error.Validation("Reconciliation",
                "Une écriture en brouillon ne peut pas être rapprochée. Validez-la d'abord."));

        var chartAccount = line.BankStatement.ChartOfAccountNumber;
        if (!string.IsNullOrWhiteSpace(chartAccount)
            && !AccountMatchesChart(journalLine.AccountNumber, chartAccount))
        {
            return Result.Failure(Error.Validation("Reconciliation",
                $"L'écriture doit porter sur le compte banque {chartAccount} (compte actuel : {journalLine.AccountNumber})."));
        }

        var alreadyUsed = await ctx.BankStatementLines.AsNoTracking()
            .AnyAsync(l => l.Id != line.Id && l.ReconciledJournalEntryLineId == journalEntryLineId, cancellationToken);
        if (alreadyUsed)
            return Result.Failure(Error.Validation("Reconciliation",
                "Cette ligne d'écriture est déjà rapprochée avec une autre ligne de relevé."));

        line.Reconcile(journalEntryLineId);
        return Result.Success();
    }

    public async Task<Result> UnreconcileLineAsync(Guid bankStatementLineId, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var line = await ctx.BankStatementLines
            .FirstOrDefaultAsync(l => l.Id == bankStatementLineId, cancellationToken);
        if (line is null)
            return Result.Failure(Error.NotFound("BankStatementLine", bankStatementLineId));
        if (!line.IsReconciled)
            return Result.Success();

        var previous = line.ReconciledJournalEntryLineId;
        line.Unreconcile();
        line.SetAuditInfo(_currentUser.Email ?? "system", true);
        await ctx.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.BankLineUnreconciled,
            "BankStatementLine",
            line.Id,
            oldValues: new { ReconciledJournalEntryLineId = previous },
            cancellationToken: cancellationToken);

        return Result.Success();
    }

    public async Task<Result<AutoAssociationResultDto>> AutoAssociateAsync(Guid statementId, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var statement = await ctx.BankStatements.AsNoTracking()
            .Include(s => s.Lines)
            .FirstOrDefaultAsync(s => s.Id == statementId, cancellationToken);
        if (statement is null)
            return Result.Failure<AutoAssociationResultDto>(Error.NotFound("BankStatement", statementId));

        var chartAccount = statement.ChartOfAccountNumber;
        var lines = statement.Lines.OrderBy(l => l.TransactionDate).ToList();
        var window = Math.Max(0, _settings.BankMatchWindowDays);

        // Écritures candidates : compte banque, hors brouillon, sur la fenêtre du relevé, non déjà
        // rapprochées par une autre ligne — chargées en UNE requête.
        var candidateLines = new List<CandidateLine>();
        var sourceLinked = new Dictionary<Guid, Guid>();
        if (!string.IsNullOrWhiteSpace(chartAccount) && lines.Count > 0)
        {
            var minDate = lines.Min(l => l.TransactionDate).AddDays(-window);
            var maxDate = lines.Max(l => l.TransactionDate).AddDays(window);
            var usedIds = await ctx.BankStatementLines.AsNoTracking()
                .Where(l => l.ReconciledJournalEntryLineId != null)
                .Select(l => l.ReconciledJournalEntryLineId!.Value)
                .ToListAsync(cancellationToken);
            var usedSet = new HashSet<Guid>(usedIds);

            if (!_settings.BankReconciliationMatchingV2Enabled)
            {
                candidateLines = await ctx.JournalEntryLines.AsNoTracking()
                    .Include(l => l.JournalEntry)
                    .Where(l => l.AccountNumber.StartsWith(chartAccount)
                                && l.JournalEntry.Status != JournalEntryStatus.Brouillon
                                && l.JournalEntry.EntryDate >= minDate && l.JournalEntry.EntryDate <= maxDate)
                    .Select(l => new CandidateLine(
                        l.Id, l.JournalEntry.EntryDate, l.JournalEntry.JournalCode, l.JournalEntry.EntryNumber,
                        l.AccountNumber, l.DebitAmount.Amount, l.CreditAmount.Amount))
                    .ToListAsync(cancellationToken);
            }
            else
            {
                // v2 : le compte banque peut être relié à un sous-compte (53210001) alors que les
                // paiements sont comptabilisés sur 5321 — on cherche aussi sur ses parents 532…
                var parents = BankAccountParents(chartAccount);
                candidateLines = await ctx.JournalEntryLines.AsNoTracking()
                    .Include(l => l.JournalEntry)
                    .Where(l => (l.AccountNumber.StartsWith(chartAccount) || parents.Contains(l.AccountNumber))
                                && l.JournalEntry.Status != JournalEntryStatus.Brouillon
                                && !l.JournalEntry.IsReversed
                                && l.JournalEntry.EntryDate >= minDate && l.JournalEntry.EntryDate <= maxDate)
                    .Select(l => new CandidateLine(
                        l.Id, l.JournalEntry.EntryDate, l.JournalEntry.JournalCode, l.JournalEntry.EntryNumber,
                        l.AccountNumber, l.DebitAmount.Amount, l.CreditAmount.Amount))
                    .ToListAsync(cancellationToken);

                // Lien source prioritaire : l'écriture générée DEPUIS la ligne de relevé lui revient,
                // même si d'autres lignes portent le même montant (trois commissions identiques…).
                var lineIds = lines.Select(l => l.Id).ToList();
                var linked = await ctx.JournalEntryLines.AsNoTracking()
                    .Where(l => (l.AccountNumber.StartsWith(chartAccount) || parents.Contains(l.AccountNumber))
                                && l.JournalEntry.Status != JournalEntryStatus.Brouillon
                                && !l.JournalEntry.IsReversed
                                && l.JournalEntry.SourceEntityId != null
                                && lineIds.Contains(l.JournalEntry.SourceEntityId.Value)
                                && (l.JournalEntry.SourceEntityType == "BankReconciliation"
                                    || l.JournalEntry.SourceEntityType == TenantDbContext.BankStatementLineSourceType))
                    .Select(l => new { StatementLineId = l.JournalEntry.SourceEntityId!.Value, l.Id })
                    .ToListAsync(cancellationToken);
                foreach (var link in linked.Where(k => !usedSet.Contains(k.Id)))
                    sourceLinked.TryAdd(link.StatementLineId, link.Id);
            }

            candidateLines = candidateLines.Where(c => !usedSet.Contains(c.Id)).ToList();
        }

        var associations = new List<BankLineAssociationDto>();
        var claimed = new HashSet<Guid>();
        // v2 : une écriture générée depuis une ligne lui est réservée (vide si le drapeau est éteint).
        var reservedLinks = sourceLinked.Values.ToHashSet();
        var associatedCount = 0;
        var toReconcileCount = 0;
        var notAssociatedCount = 0;

        foreach (var line in lines.Where(l => !l.IsReconciled))
        {
            // Convention 512 : ligne débit relevé (décaissement) ⇒ crédit banque ; crédit relevé
            // (encaissement) ⇒ débit banque.
            var ownLink = sourceLinked.TryGetValue(line.Id, out var own) ? own : (Guid?)null;
            var matches = candidateLines
                .Where(c => !claimed.Contains(c.Id)
                            && (!reservedLinks.Contains(c.Id) || c.Id == ownLink)
                            && Math.Abs((c.EntryDate - line.TransactionDate).TotalDays) <= window
                            && (line.IsDebit ? c.Credit == line.Amount.Amount : c.Debit == line.Amount.Amount))
                .ToList();

            // v2 : lien source d'abord (vide si le drapeau est éteint).
            if (sourceLinked.TryGetValue(line.Id, out var linkedLineId)
                && candidateLines.FirstOrDefault(c => c.Id == linkedLineId && !claimed.Contains(c.Id)) is { } linkedCandidate)
            {
                matches = new List<CandidateLine> { linkedCandidate };
            }

            int status;
            Guid? proposedId = null;
            string? proposedRef = null;
            if (matches.Count == 1)
            {
                status = (int)BankLineAssociationStatus.Associated;
                var m = matches[0];
                proposedId = m.Id;
                proposedRef = $"{m.JournalCode}/{m.EntryNumber} — {m.EntryDate:dd/MM} — {m.AccountNumber}";
                claimed.Add(m.Id);
                associatedCount++;
            }
            else if (matches.Count > 1)
            {
                status = (int)BankLineAssociationStatus.ToReconcile;
                toReconcileCount++;
            }
            else
            {
                status = (int)BankLineAssociationStatus.NotAssociated;
                notAssociatedCount++;
            }

            associations.Add(new BankLineAssociationDto
            {
                BankStatementLineId = line.Id,
                TransactionDate = line.TransactionDate,
                Description = line.Description,
                Amount = line.Amount.Amount,
                IsDebit = line.IsDebit,
                Status = status,
                ProposedJournalEntryLineId = proposedId,
                ProposedEntryRef = proposedRef,
                CandidateCount = matches.Count
            });
        }

        var reconciledCount = lines.Count(l => l.IsReconciled);
        var summary = new BankReconciliationSummaryDto
        {
            ImportedCount = lines.Count,
            AutoMatchedCount = reconciledCount + associatedCount,
            ToReconcileCount = toReconcileCount,
            NotAssociatedCount = notAssociatedCount,
            TotalCredit = lines.Where(l => !l.IsDebit).Sum(l => l.Amount.Amount),
            TotalDebit = lines.Where(l => l.IsDebit).Sum(l => l.Amount.Amount),
            StatementBalance = lines.Where(l => !l.IsDebit).Sum(l => l.Amount.Amount)
                               - lines.Where(l => l.IsDebit).Sum(l => l.Amount.Amount)
        };

        return Result.Success(new AutoAssociationResultDto { Associations = associations, Summary = summary });
    }

    /// <summary>Parents 532… d'un compte banque (53210001 ⇒ 5321, 53210, 532100, 5321000).</summary>
    private static List<string> BankAccountParents(string chartAccount) =>
        Enumerable.Range(4, Math.Max(0, chartAccount.Length - 4))
            .Select(n => chartAccount[..n])
            .Where(p => p.StartsWith("532", StringComparison.Ordinal))
            .ToList();

    private readonly record struct CandidateLine(
        Guid Id, DateTime EntryDate, string JournalCode, int EntryNumber, string AccountNumber, decimal Debit, decimal Credit);

    public async Task<Result<ApplyAssociationsResultDto>> ApplyAssociationsAsync(
        Guid statementId, ApplyAssociationsRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Pairs.Count == 0)
            return Result.Success(new ApplyAssociationsResultDto { AppliedCount = 0 });

        await using var ctx = _contextFactory.CreateContext();
        var lineIds = request.Pairs.Select(p => p.BankStatementLineId).ToList();
        var lines = await ctx.BankStatementLines
            .Include(l => l.BankStatement)
            .Where(l => l.BankStatementId == statementId && lineIds.Contains(l.Id))
            .ToListAsync(cancellationToken);

        var user = _currentUser.Email ?? "system";
        var applied = 0;
        var failures = new List<string>();
        var usedInBatch = new HashSet<Guid>();

        foreach (var pair in request.Pairs)
        {
            var line = lines.FirstOrDefault(l => l.Id == pair.BankStatementLineId);
            if (line is null)
            {
                failures.Add($"Ligne de relevé introuvable ({pair.BankStatementLineId}).");
                continue;
            }
            if (!usedInBatch.Add(pair.JournalEntryLineId))
            {
                failures.Add($"« {line.Description} » : écriture déjà utilisée par une autre ligne du lot.");
                continue;
            }

            var core = await ReconcileCoreAsync(ctx, line, pair.JournalEntryLineId, cancellationToken);
            if (core.IsFailure)
            {
                failures.Add($"« {line.Description} » : {core.Error.Description}");
                usedInBatch.Remove(pair.JournalEntryLineId);
                continue;
            }
            line.SetAuditInfo(user, true);
            applied++;
        }

        if (applied > 0)
        {
            await ctx.SaveChangesAsync(cancellationToken);
            await _auditService.LogAsync(
                AuditActions.Accounting.BankLineReconciled,
                "BankStatement",
                statementId,
                newValues: new { AppliedCount = applied, Requested = request.Pairs.Count },
                cancellationToken: cancellationToken);
        }

        return Result.Success(new ApplyAssociationsResultDto { AppliedCount = applied, Failures = failures });
    }

    public async Task<Result> CreateEntryForLineAsync(
        Guid bankStatementLineId, CreateEntryForLineRequest request, CancellationToken cancellationToken = default)
    {
        var journalCode = (request.JournalCode ?? "BQ").Trim().ToUpperInvariant();
        var counterparty = request.CounterpartyAccount?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(counterparty))
            return Result.Failure(Error.Validation("Counterparty", "Le compte de contrepartie est obligatoire."));

        await using var ctx = _contextFactory.CreateContext();
        var line = await ctx.BankStatementLines
            .Include(l => l.BankStatement)
            .FirstOrDefaultAsync(l => l.Id == bankStatementLineId, cancellationToken);
        if (line is null)
            return Result.Failure(Error.NotFound("BankStatementLine", bankStatementLineId));
        if (line.IsReconciled)
            return Result.Failure(Error.Validation("Reconciliation", "Cette ligne est déjà rapprochée."));

        // Garde-fou anti-doublon : en brouillard, la ligne n'est pas rapprochée tout de suite, si bien
        // qu'un second clic (ou la comptabilisation assistée d'un relevé importé) créait une deuxième
        // écriture pour la même ligne.
        var alreadyPosted = await ctx.JournalEntries.AsNoTracking().AnyAsync(e =>
            !e.IsReversed && e.SourceEntityId == line.Id
            && (e.SourceEntityType == "BankReconciliation" || e.SourceEntityType == TenantDbContext.BankStatementLineSourceType),
            cancellationToken);
        if (alreadyPosted)
            return Result.Failure(Error.Validation("Reconciliation", "Une écriture a déjà été créée pour cette ligne de relevé."));

        var bankAccount = line.BankStatement.ChartOfAccountNumber;
        if (string.IsNullOrWhiteSpace(bankAccount))
            return Result.Failure(Error.Validation("BankAccount",
                "Le relevé n'est pas lié à un compte banque 512x — associez le compte bancaire avant de comptabiliser."));

        // Comptes actifs.
        foreach (var acc in new[] { bankAccount, counterparty }.Distinct(StringComparer.Ordinal))
        {
            var chart = await ctx.ChartOfAccounts.AsNoTracking().FirstOrDefaultAsync(c => c.AccountNumber == acc, cancellationToken);
            if (chart is null)
                return Result.Failure(Error.Validation("AccountNumber", $"Le compte {acc} n'existe pas dans le plan comptable."));
            if (!chart.IsActive)
                return Result.Failure(Error.Validation("AccountNumber", $"Le compte {acc} est désactivé."));
        }

        var entryDate = line.TransactionDate.Date;
        var period = await EnsureOpenPeriodInContextAsync(ctx, entryDate, cancellationToken);
        if (period is null)
            return Result.Failure(Error.Validation("Period",
                $"La période {entryDate:MM/yyyy} est clôturée : impossible de comptabiliser cette ligne."));

        var amount = line.Amount.Amount;
        var label = string.IsNullOrWhiteSpace(request.Label) ? line.Description : request.Label!.Trim();
        // Décaissement (débit relevé) : D contrepartie / C banque ; encaissement : D banque / C contrepartie.
        var lineInputs = line.IsDebit
            ? new[]
            {
                new JournalLineInput(counterparty, label, amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput(bankAccount, label, 0m, amount, null, ThirdPartyKind.None)
            }
            : new[]
            {
                new JournalLineInput(bankAccount, label, amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput(counterparty, label, 0m, amount, null, ThirdPartyKind.None)
            };

        var number = await NextNumberInContextAsync(ctx, journalCode, entryDate.Year, cancellationToken);
        var initialStatus = _settings.BrouillardEnabled ? JournalEntryStatus.Brouillon : JournalEntryStatus.Validee;
        var create = JournalEntry.Create(number, journalCode, entryDate, label, period.Id,
            isAutoGenerated: false, "BankReconciliation", line.Id, lineInputs,
            Money.DefaultCurrency, reversesEntryId: null, initialStatus: initialStatus);
        if (create.IsFailure)
            return Result.Failure(create.Error);

        var user = _currentUser.Email ?? "system";
        var entry = create.Value;
        entry.SetAuditInfo(user, false);
        ctx.JournalEntries.Add(entry);

        // Rapprochement immédiat sur la ligne du compte banque — uniquement si l'écriture est
        // définitive (une écriture en brouillard doit d'abord être validée).
        var bankLineEntry = entry.Lines.First(l => l.AccountNumber == bankAccount);
        var reconciled = false;
        if (initialStatus != JournalEntryStatus.Brouillon)
        {
            line.Reconcile(bankLineEntry.Id);
            line.SetAuditInfo(user, true);
            reconciled = true;
        }

        await ctx.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Accounting.BankEntryCreatedFromLine,
            "JournalEntry",
            entry.Id,
            newValues: new { bankStatementLineId, journalCode, counterparty, amount, line.IsDebit, Reconciled = reconciled },
            cancellationToken: cancellationToken);

        return Result.Success();
    }

    private static async Task<AccountingPeriod?> EnsureOpenPeriodInContextAsync(TenantDbContext ctx, DateTime date, CancellationToken ct)
    {
        var period = await ctx.AccountingPeriods.FirstOrDefaultAsync(p => p.FiscalYear == date.Year && p.Month == date.Month, ct);
        if (period is null)
        {
            var start = new DateTime(date.Year, date.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var end = new DateTime(date.Year, date.Month, DateTime.DaysInMonth(date.Year, date.Month), 0, 0, 0, DateTimeKind.Utc);
            period = AccountingPeriod.Create(date.Year, date.Month, start, end);
            period.SetAuditInfo("system", false);
            ctx.AccountingPeriods.Add(period);
        }
        return period.IsClosed ? null : period;
    }

    private static async Task<int> NextNumberInContextAsync(TenantDbContext ctx, string journalCode, int year, CancellationToken ct)
    {
        var seq = await ctx.JournalEntrySequences.FirstOrDefaultAsync(s => s.JournalCode == journalCode && s.FiscalYear == year, ct);
        if (seq is null)
        {
            seq = JournalEntrySequence.Create(journalCode, year);
            seq.SetAuditInfo("system", false);
            ctx.JournalEntrySequences.Add(seq);
        }
        return seq.Next();
    }

    public async Task<Result<BankStatementFilePreviewDto>> PreviewStatementFileAsync(
        byte[] content,
        BankStatementFileFormat format,
        string fileName,
        string contentType,
        CancellationToken cancellationToken = default)
    {
        if (format is BankStatementFileFormat.Pdf or BankStatementFileFormat.Image)
            return await _pdfImportService.PreviewAsync(content, fileName, contentType, format, cancellationToken);

        // Formats structurés (OFX/MT940) : parser dédié + métadonnées détectées (compte, soldes).
        if (format is BankStatementFileFormat.Ofx or BankStatementFileFormat.Mt940)
        {
            var parsed = format == BankStatementFileFormat.Ofx
                ? _ofxParser.Parse(content)
                : _mt940Parser.Parse(content);
            return Result.Success(BuildFilePreview(
                parsed.Lines, parsed.Issues,
                detectedRib: parsed.DetectedRib,
                openingBalance: parsed.OpeningBalance,
                closingBalance: parsed.ClosingBalance));
        }

        var (lines, issues) = _parser.Parse(content, format);
        return Result.Success(BuildFilePreview(lines, issues));
    }

    /// <summary>Construit le DTO d'aperçu commun aux formats tabulaires (CSV/Excel) et structurés (OFX/MT940).</summary>
    private static BankStatementFilePreviewDto BuildFilePreview(
        IReadOnlyList<ImportBankStatementLineRequest> lines,
        IReadOnlyList<ImportIssueDto> issues,
        string? detectedRib = null,
        decimal? openingBalance = null,
        decimal? closingBalance = null)
    {
        var hasBlocking = issues.Any(i => i.IsBlocking);
        return new BankStatementFilePreviewDto
        {
            TotalLines = lines.Count + issues.Count(i => i.Ref.StartsWith("opération", StringComparison.OrdinalIgnoreCase)
                                                         || i.Ref.StartsWith("ligne", StringComparison.OrdinalIgnoreCase)),
            ValidLines = lines.Count,
            TotalDebit = lines.Where(l => l.IsDebit).Sum(l => l.Amount),
            TotalCredit = lines.Where(l => !l.IsDebit).Sum(l => l.Amount),
            PeriodStart = lines.Count > 0 ? lines.Min(l => l.TransactionDate) : null,
            PeriodEnd = lines.Count > 0 ? lines.Max(l => l.TransactionDate) : null,
            CanImport = !hasBlocking && lines.Count > 0,
            Issues = issues,
            Lines = lines,
            DetectedRib = detectedRib,
            SuggestedOpeningBalance = openingBalance,
            SuggestedClosingBalance = closingBalance,
            ExtractionMethod = BankStatementExtractionMethod.TextParser
        };
    }

    public async Task<Result<BankReconciliationStatementDto>> GetReconciliationStatementAsync(
        Guid statementId, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var statement = await ctx.BankStatements.AsNoTracking()
            .Include(s => s.Lines)
            .FirstOrDefaultAsync(s => s.Id == statementId, cancellationToken);
        if (statement is null)
            return Result.Failure<BankReconciliationStatementDto>(Error.NotFound("BankStatement", statementId));

        var chart = statement.ChartOfAccountNumber;
        if (string.IsNullOrWhiteSpace(chart))
            return Result.Failure<BankReconciliationStatementDto>(Error.Validation("BankAccount",
                "Le relevé n'est pas lié à un compte banque 512x — associez le compte bancaire avant d'éditer l'état de rapprochement."));

        var asOf = statement.PeriodEnd.Date;

        // Solde comptable ANCRÉ du compte banque à la date de fin : réutilise la balance générale
        // (corrigée du double comptage des à-nouveaux au lot 0) plutôt que le grand livre mono-compte,
        // dont le solde progressif n'est pas ancré.
        var balance = await _reporting.GetBalanceAsync(new DateTime(asOf.Year, 1, 1), asOf, cancellationToken);
        if (balance.IsFailure)
            return Result.Failure<BankReconciliationStatementDto>(balance.Error);
        var bankRow = balance.Value.FirstOrDefault(r => r.AccountNumber == chart);
        var accountingBalance = bankRow is null ? 0m : bankRow.ClosingDebit - bankRow.ClosingCredit;

        // Toute ligne d'écriture déjà pointée par un relevé (celui-ci ou un autre) est exclue des suspens.
        var reconciledLineIds = await ctx.BankStatementLines.AsNoTracking()
            .Where(l => l.ReconciledJournalEntryLineId != null)
            .Select(l => l.ReconciledJournalEntryLineId!.Value)
            .ToListAsync(cancellationToken);
        var reconciledSet = new HashSet<Guid>(reconciledLineIds);

        // Suspens comptables : écritures validées sur le compte banque jusqu'à la date de fin,
        // non encore pointées → chèques émis non débités, remises non créditées.
        var bookLines = await ctx.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountNumber == chart
                        && l.JournalEntry.EntryDate <= asOf
                        && l.JournalEntry.Status != JournalEntryStatus.Brouillon)
            .OrderBy(l => l.JournalEntry.EntryDate)
            .ThenBy(l => l.JournalEntry.EntryNumber)
            .ThenBy(l => l.LineNumber)
            .ToListAsync(cancellationToken);

        var unreconciledBookItems = bookLines
            .Where(l => !reconciledSet.Contains(l.Id))
            .Select(l => new BankReconciliationItemDto
            {
                Date = l.JournalEntry.EntryDate,
                Reference = l.JournalEntry.PieceRef ?? l.JournalEntry.EntryNumber.ToString(),
                Label = l.Label,
                Debit = l.DebitAmount.Amount,
                Credit = l.CreditAmount.Amount
            })
            .ToList();

        // Suspens relevé : lignes du relevé non encore comptabilisées → frais, agios.
        var unreconciledStatementItems = statement.Lines
            .Where(l => !l.IsReconciled)
            .OrderBy(l => l.TransactionDate)
            .ThenBy(l => l.Reference, StringComparer.Ordinal)
            .Select(l => new BankReconciliationItemDto
            {
                Date = l.TransactionDate,
                Reference = l.Reference,
                Label = l.Description,
                // Présentation en débit/crédit du compte banque : décaissement (IsDebit) = crédit banque.
                Debit = l.IsDebit ? 0m : l.Amount.Amount,
                Credit = l.IsDebit ? l.Amount.Amount : 0m
            })
            .ToList();

        var statementClosing = statement.ClosingBalance.Amount;

        // B_rel_corrigé = relevé + Σ impact comptable des écritures non pointées (Débit − Crédit).
        var adjustedStatement = statementClosing
            + unreconciledBookItems.Sum(i => i.Debit - i.Credit);

        // B_acc_corrigé = comptable + Σ impact des lignes de relevé non comptabilisées (Débit − Crédit banque).
        var adjustedAccounting = accountingBalance
            + unreconciledStatementItems.Sum(i => i.Debit - i.Credit);

        var difference = Math.Round(adjustedAccounting - adjustedStatement, 3);

        return Result.Success(new BankReconciliationStatementDto
        {
            StatementId = statement.Id,
            BankName = statement.BankName,
            AccountNumber = statement.AccountNumber,
            ChartOfAccountNumber = chart,
            PeriodStart = statement.PeriodStart,
            PeriodEnd = statement.PeriodEnd,
            StatementClosingBalance = statementClosing,
            AccountingBalance = accountingBalance,
            UnreconciledBookItems = unreconciledBookItems,
            UnreconciledStatementItems = unreconciledStatementItems,
            AdjustedStatementBalance = adjustedStatement,
            AdjustedAccountingBalance = adjustedAccounting,
            Difference = difference,
            IsReconciled = difference == 0m
        });
    }

    private static bool AccountMatchesChart(string journalAccount, string chartAccount) =>
        string.Equals(journalAccount, chartAccount, StringComparison.Ordinal)
        || journalAccount.StartsWith(chartAccount, StringComparison.Ordinal)
        || chartAccount.StartsWith(journalAccount, StringComparison.Ordinal);

    private static BankStatementDto MapStatement(BankStatement s) => new()
    {
        Id = s.Id,
        BankName = s.BankName,
        AccountNumber = s.AccountNumber,
        StatementDate = s.StatementDate,
        PeriodStart = s.PeriodStart,
        PeriodEnd = s.PeriodEnd,
        OpeningBalance = s.OpeningBalance.Amount,
        ClosingBalance = s.ClosingBalance.Amount,
        BankAccountId = s.BankAccountId,
        ChartOfAccountNumber = s.ChartOfAccountNumber,
        SourceFileName = s.SourceFileName,
        ImportMethod = (int)s.ImportMethod,
        Lines = s.Lines
            .OrderBy(l => l.TransactionDate)
            .ThenBy(l => l.Reference)
            .Select(l => new BankStatementLineDto
            {
                Id = l.Id,
                TransactionDate = l.TransactionDate,
                Reference = l.Reference,
                Description = l.Description,
                Amount = l.Amount.Amount,
                IsDebit = l.IsDebit,
                IsReconciled = l.IsReconciled,
                ReconciledJournalEntryLineId = l.ReconciledJournalEntryLineId
            })
            .ToList()
    };
}
