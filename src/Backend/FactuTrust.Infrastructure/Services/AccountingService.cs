using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Application.Features.CashDesk.Services;
using FactuTrust.Application.Features.FixedAssets;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Payroll;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

public sealed class AccountingService : IAccountingService
{
    public const string SourceInvoice = "Invoice";
    public const string SourceInvoiceCreditNote = "InvoiceCreditNote";
    public const string SourcePayment = "Payment";
    public const string SourceInvoiceCancelled = "InvoiceCancelled";
    public const string SourceSupplierInvoice = "SupplierInvoice";
    public const string SourceSupplierPayment = "SupplierPayment";
    public const string SourceSupplierInvoiceWithholding = "SupplierInvoiceWithholding";
    public const string SourceBankDeposit = "BankDeposit";
    public const string SourceCashOperation = "CashOperation";
    public const string SourceOpeningBalance = "OpeningBalance";

    /// <summary>
    /// Extourne interne d'un à-nouveau contaminé (T8, réparation) — DISTINCT de
    /// <see cref="SourceOpeningBalance"/> pour ne jamais être confondu avec l'à-nouveau lui-même
    /// par <see cref="Application.Common.Interfaces.Repositories.IJournalEntryRepository.GetActiveBySourceAsync"/>.
    /// </summary>
    public const string SourceOpeningBalanceReversal = "OpeningBalanceReversal";
    public const string SourceFixedAssetAcquisition = "FixedAssetAcquisition";
    public const string SourceFixedAssetDepreciation = "FixedAssetDepreciation";
    public const string SourceFixedAssetDisposal = "FixedAssetDisposal";
    public const string SourceManualReversal = "ManualReversal";
    public const string SourcePayrollRun = "PayrollRun";
    public const string SourcePayrollRunCancelled = "PayrollRunCancelled";
    public const string SourcePayrollPayment = "PayrollPayment";
    public const string SourcePayrollPaymentCancelled = "PayrollPaymentCancelled";

    /// <summary>Décaissement d'une avance sur salaire (débit 421 / crédit trésorerie).</summary>
    public const string SourceEmployeeAdvance = "EmployeeAdvance";
    public const string SourceEmployeeAdvanceCancelled = "EmployeeAdvanceCancelled";
    /// <summary>Décaissement d'un prêt salarié (débit 421.1 / crédit trésorerie).</summary>
    public const string SourceEmployeeLoan = "EmployeeLoan";
    public const string SourceEmployeeLoanCancelled = "EmployeeLoanCancelled";
    public const string SourceCnssContributionPayment = "CnssContributionPayment";
    public const string SourceCnssContributionPaymentCancelled = "CnssContributionPaymentCancelled";

    /// <summary>Clé d'idempotence de l'OD de reclassement SCE paie (plan §5.2.1), sur l'id du cycle.</summary>
    public const string SourcePayrollReclassification = "PayrollReclassification";
    /// <summary>
    /// Extourne de l'OD de reclassement SCE. Un cycle rouvert doit perdre son reclassement en même
    /// temps que son OD d'origine : sinon la revalidation empilerait une nouvelle OD sur une
    /// correction encore active, et les taxes sur salaires seraient comptées deux fois.
    /// </summary>
    public const string SourcePayrollReclassificationCancelled = "PayrollReclassificationCancelled";

    /// <summary>Clé d'idempotence du 2ᵉ volet d'un effet (encaissement/paiement à échéance), sur l'id du paiement.</summary>
    public const string SourceEffetSettlement = "EffetSettlement";

    public const string FixedAssetJournalCode = "JIM";

    /// <summary>
    /// T10 — clé d'idempotence de l'écriture d'impôt de la finalisation de la liasse fiscale, sur
    /// l'id de la feuille de détermination du résultat fiscal. Une seule finalisation possible par
    /// exercice + idempotence par <see cref="IJournalEntryRepository.GetBySourceAsync"/> dans la même
    /// transaction : l'unicité découle du flux, pas d'un index global (cf. IFiscalResultDeclarationRepository).
    /// </summary>
    public const string SourceFiscalTax = "FiscalTaxDeclaration";
    /// <summary>Charge d'impôt sur les sociétés (classe 69) — débit du montant d'IS dû.</summary>
    public const string IncomeTaxExpenseAccountNumber = "691";
    /// <summary>
    /// Charge de contribution sociale de solidarité (sous-compte de 691 — aucun compte CSS dédié au
    /// catalogue livré §1.4 ; auto-créé via <see cref="TryAutoCreateSubAccountAsync"/> le cas échéant).
    /// </summary>
    public const string CssExpenseAccountNumber = "6912";
    /// <summary>État — impôt à liquider (crédit du montant total d'impôt dû, jamais le net à payer).</summary>
    public const string IncomeTaxLiabilityAccountNumber = "4343";

    /// <summary>Comptes d'effets de commerce (traites) — alignés sur le seed du plan comptable tenant.</summary>
    public const string ClientEffetAccountNumber = "413";   // Clients - effets à recevoir (NCT 01)
    public const string SupplierEffetAccountNumber = "403";  // Fournisseurs - effets à payer

    /// <summary>Compte FODEC collecté (dette envers l'État). Crédité à la vente, débité en avoir.</summary>
    public const string FodecAccountNumber = TunisianPostingAccounts.Fodec;

    /// <summary>Journal des Opérations Diverses : réception/acceptation d'effet et impayé (aucun mouvement de trésorerie).</summary>
    public const string MiscJournalCode = "JOD";
    /// <summary>Journal de Banque : encaissement/paiement effectif d'un effet à échéance.</summary>
    public const string BankJournalCode = "JB";

    /// <summary>
    /// Comptes de solde du résultat pour les écritures d'à-nouveau (classe 1).
    /// Alignés sur le seed du plan comptable tenant (<c>AddAccountingModule_Tenant</c>) : 131 bénéfice, 135 perte.
    /// </summary>
    public const string OpeningBalanceProfitAccountNumber = "131";

    public const string OpeningBalanceLossAccountNumber = "135";

    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAccountingPeriodService _periodService;
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IWithholdingTaxRepository _withholdingTaxTypes;
    private readonly IDepreciationRateCategoryRepository _depreciationRateCategories;
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ILogger<AccountingService> _logger;
    private readonly AccountingSettings _settings;

    /// <summary>
    /// Piste d'audit persistée de l'auto-création de sous-comptes (T16, DÉFAUT #3). Vit dans sa propre
    /// transaction isolée (cf. <see cref="ITenantUnitOfWork"/>) : l'événement survit au rollback de
    /// l'écriture mère — comportement souhaité (un compte créé reste créé même si l'écriture échoue).
    /// Optionnel en construction (null = tests sans audit) ; toujours injecté par la DI en production.
    /// </summary>
    private readonly IAuditService? _audit;

    /// <summary>
    /// Réglage d'imputation paie du dossier (profil, date de bascule, comptes, drapeaux). Optionnel
    /// en construction (null = tests sans résolveur) ; toujours injecté par la DI en production.
    /// Absent, on retombe sur la configuration globale — le comportement historique exactement.
    /// </summary>
    private readonly IPayrollAccountingProfileResolver? _payrollProfileResolver;

    public AccountingService(
        IChartOfAccountRepository chartOfAccounts,
        IAccountingPeriodService periodService,
        IJournalEntryRepository journalEntries,
        IWithholdingTaxRepository withholdingTaxTypes,
        IDepreciationRateCategoryRepository depreciationRateCategories,
        ITenantDbContextFactory contextFactory,
        ILogger<AccountingService> logger,
        IOptions<AccountingSettings> settings,
        IAuditService? audit = null,
        IPayrollAccountingProfileResolver? payrollProfileResolver = null)
    {
        _chartOfAccounts = chartOfAccounts;
        _periodService = periodService;
        _journalEntries = journalEntries;
        _withholdingTaxTypes = withholdingTaxTypes;
        _depreciationRateCategories = depreciationRateCategories;
        _contextFactory = contextFactory;
        _logger = logger;
        _settings = settings.Value;
        _audit = audit;
        _payrollProfileResolver = payrollProfileResolver;
    }

    /// <summary>
    /// Statut des écritures générées automatiquement depuis une pièce métier (facture, achat,
    /// paiement, caisse, paie, immobilisation, à-nouveau et extourne de ces pièces). Elles naissent
    /// <see cref="JournalEntryStatus.Validee"/> : équilibre, période ouverte et plan comptable sont
    /// déjà contrôlés à la création. <see cref="JournalEntry.Validate"/> n'est pas appelé : ni
    /// <c>ValidatedBy</c> ni <c>ValidatedAt</c> ne sont renseignés, comme le chemin historique
    /// « brouillard désactivé ».
    /// </summary>
    /// <remarks>
    /// <see cref="AccountingSettings.BrouillardEnabled"/> ne s'applique plus ici. Il reste réservé
    /// à la saisie manuelle, aux imports, aux relevés IA, à l'assistant d'inventaire, au
    /// rapprochement « créer écriture » et à l'extourne manuelle
    /// (<see cref="ReverseJournalEntryAsync"/>).
    /// </remarks>
    private JournalEntryStatus NewEntryStatus => JournalEntryStatus.Validee;

    /// <summary>
    /// Validates that all account numbers in the given lines exist in the Chart of Accounts.
    /// If a sub-account is missing but its parent account exists, the sub-account is
    /// auto-created to prevent data loss from a single missing configuration entry.
    /// Returns a failure result with the first missing account, or success if all accounts exist.
    /// </summary>
    /// <param name="sourceContext">
    /// T16 — provenance de l'écriture (ex. « OpeningEntries », « FixedAssetDisposal »,
    /// « FiscalTaxEntry ») tracée dans la piste d'audit lors d'une auto-création de sous-compte.
    /// Oblligatoire : aucun site d'appel sans contexte.
    /// </param>
    private async Task<Result> ValidateAccountsExistAsync(
        IEnumerable<JournalLineInput> lines,
        string sourceContext,
        CancellationToken cancellationToken)
    {
        var checkedAccounts = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in lines)
        {
            var acc = line.AccountNumber?.Trim() ?? string.Empty;
            if (string.IsNullOrEmpty(acc) || !checkedAccounts.Add(acc))
                continue;

            var account = await _chartOfAccounts.GetByAccountNumberAsync(acc, cancellationToken);
            if (account is null)
            {
                // Attempt auto-creation: find nearest parent account in the chart
                var created = await TryAutoCreateSubAccountAsync(acc, sourceContext, cancellationToken);
                if (!created)
                {
                    _logger.LogError(
                        "Account {AccountNumber} not found in chart of accounts and no parent exists for auto-creation. " +
                        "Planned journal lines: {@PlannedLines}",
                        acc, lines.Select(l => new { l.AccountNumber, l.Label, l.Debit, l.Credit }));
                    return Result.Failure(Error.Validation("AccountNumber",
                        $"Le compte {acc} n'existe pas dans le plan comptable."));
                }
            }
            else if (!account.IsActive)
            {
                _logger.LogWarning("Account {AccountNumber} is deactivated", acc);
                return Result.Failure(Error.Validation("AccountNumber",
                    $"Le compte {acc} est désactivé."));
            }
        }

        return Result.Success();
    }

    /// <summary>
    /// Libellé d'un sous-compte auto-créé : libellé du parent, débarrassé de ses propres suffixes
    /// numériques, suivi du numéro du compte.
    /// </summary>
    /// <remarks>
    /// L'ancienne formule concaténait le libellé parent tel quel. Sur une chaîne d'auto-créations
    /// (42 → 421 → 4218744456), les suffixes s'empilaient et produisaient
    /// « Personnel et comptes rattachés — 421 — 4218744456 » : un libellé qui cite un numéro de
    /// compte différent de celui qu'il désigne, et d'autant plus trompeur après un remap de plan
    /// comptable, qui réécrit les numéros mais pas les libellés.
    /// </remarks>
    internal static string BuildAutoSubAccountLabel(string parentLabel, string accountNumber)
    {
        var label = (parentLabel ?? string.Empty).Trim();

        // Retire les segments terminaux « — <chiffres> » hérités d'une auto-création précédente.
        while (true)
        {
            var separator = label.LastIndexOf(" — ", StringComparison.Ordinal);
            if (separator < 0)
                break;

            var tail = label[(separator + 3)..].Trim();
            if (tail.Length == 0 || !tail.All(char.IsAsciiDigit))
                break;

            label = label[..separator].TrimEnd();
        }

        // Un libellé parent réduit à un numéro n'apporte rien et propagerait un numéro de plus.
        if (label.Length == 0 || label.All(char.IsAsciiDigit))
            return accountNumber;

        return $"{label} — {accountNumber}";
    }

    /// <summary>
    /// Attempts to auto-create a missing sub-account by finding its nearest parent
    /// in the chart of accounts hierarchy. This follows standard ERP practice for
    /// Tunisian SCE where sub-accounts are created as needed.
    /// </summary>
    /// <param name="sourceContext">T16 — provenance de l'écriture, tracée dans la piste d'audit.</param>
    /// <returns>True if the sub-account was successfully created, false otherwise.</returns>
    private async Task<bool> TryAutoCreateSubAccountAsync(string accountNumber, string sourceContext, CancellationToken cancellationToken)
    {
        // Try progressively shorter prefixes to find a parent account
        // e.g., for "4371": try "437", then "43", then "4"
        for (var len = accountNumber.Length - 1; len >= 1; len--)
        {
            var parentNumber = accountNumber[..len];
            var parent = await _chartOfAccounts.GetByAccountNumberAsync(parentNumber, cancellationToken);
            if (parent is null || !parent.IsActive)
                continue;

            // Found a valid parent — create the sub-account
            var accountClass = int.Parse(accountNumber[..1].ToString());
            var label = BuildAutoSubAccountLabel(parent.Label, accountNumber);
            var createResult = ChartOfAccount.Create(
                accountNumber,
                label,
                accountClass,
                parentNumber,
                parent.NatureType,
                isSystem: false);

            if (createResult.IsFailure)
            {
                _logger.LogWarning(
                    "Failed to auto-create sub-account {AccountNumber} under parent {ParentNumber}: {Error}",
                    accountNumber, parentNumber, createResult.Error.Description);
                return false;
            }

            var newAccount = createResult.Value;
            newAccount.SetAuditInfo("system");
            await _chartOfAccounts.AddAsync(newAccount, cancellationToken);

            _logger.LogInformation(
                "Auto-created missing sub-account {AccountNumber} under parent {ParentNumber} (class {AccountClass})",
                accountNumber, parentNumber, accountClass);

            // T16 — piste d'audit persistée de l'auto-création avec la provenance de l'écriture.
            // Transaction isolée (cf. IAuditService / ITenantUnitOfWork) : survit au rollback mère.
            if (_audit is not null)
            {
                try
                {
                    await _audit.LogAsync(
                        action: "AccountAutoCreated",
                        entityType: "ChartOfAccount",
                        entityId: newAccount.Id,
                        oldValues: null,
                        newValues: new { accountNumber, parentNumber, label, sourceContext },
                        cancellationToken: cancellationToken);
                }
                catch (Exception ex)
                {
                    // L'audit ne doit jamais faire échouer l'écriture comptable.
                    _logger.LogError(ex,
                        "Failed to log audit event for auto-created sub-account {AccountNumber}", accountNumber);
                }
            }

            return true;
        }

        return false;
    }


    public async Task<Result> GenerateInvoiceSaleEntryAsync(Invoice invoice, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
        {
            _logger.LogDebug("Chart of accounts empty — skip accounting for tenant");
            return Result.Success();
        }

        var existing = await _journalEntries.GetBySourceAsync(SourceInvoice, invoice.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var periodResult = await _periodService.EnsureOpenPeriodAsync(invoice.IssueDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = invoice.TotalAmount.Currency;
        var lines = new List<JournalLineInput>();

        lines.Add(new JournalLineInput(
            TunisianPostingAccounts.Client,
            $"Client — {invoice.Number.Value}",
            invoice.TotalAmount.Amount,
            0,
            invoice.ClientId,
            ThirdPartyKind.Client));

        var htByRevenue = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var line in invoice.Lines)
        {
            var acc = RevenueAccountForLine(line);
            var ht = line.SubTotal.Amount;
            if (!htByRevenue.TryGetValue(acc, out var sum))
                sum = 0;
            htByRevenue[acc] = sum + ht;
        }

        foreach (var kv in htByRevenue.OrderBy(k => k.Key))
        {
            if (kv.Value <= 0)
                continue;
            lines.Add(new JournalLineInput(
                kv.Key,
                $"Ventes {invoice.Number.Value}",
                0,
                kv.Value,
                null,
                ThirdPartyKind.None));
        }

        var vatByRate = new Dictionary<int, decimal>();
        foreach (var line in invoice.Lines)
        {
            var rate = (int)line.VatRate;
            if (rate == 0)
                continue;
            if (!vatByRate.TryGetValue(rate, out var v))
                v = 0;
            vatByRate[rate] = v + line.VatAmount.Amount;
        }

        foreach (var kv in vatByRate.OrderBy(k => k.Key))
        {
            if (kv.Value <= 0)
                continue;
            lines.Add(new JournalLineInput(
                TunisianPostingAccounts.VatCollected,
                $"TVA collectée {kv.Key}% — {invoice.Number.Value}",
                0,
                kv.Value,
                null,
                ThirdPartyKind.None));
        }

        var fodec = invoice.FodecAmount.Amount;
        if (Math.Abs(fodec) > 0.0005m)
        {
            lines.Add(new JournalLineInput(
                FodecAccountNumber,
                $"FODEC — {invoice.Number.Value}",
                0,
                fodec,
                null,
                ThirdPartyKind.None));
        }

        var stamp = invoice.FiscalStampAmount.Amount;
        if (Math.Abs(stamp) > 0.0005m)
        {
            const string stampAccount = TunisianPostingAccounts.FiscalStampOnSale;
            if (stamp > 0)
            {
                lines.Add(new JournalLineInput(
                    stampAccount,
                    $"Timbre fiscal — {invoice.Number.Value}",
                    0,
                    stamp,
                    null,
                    ThirdPartyKind.None));
            }
            else
            {
                lines.Add(new JournalLineInput(
                    stampAccount,
                    $"Timbre fiscal — {invoice.Number.Value}",
                    Math.Abs(stamp),
                    0,
                    null,
                    ThirdPartyKind.None));
            }
        }

        var accountValidation = await ValidateAccountsExistAsync(lines, "InvoiceSale", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(
            TunisianPostingAccounts.SalesJournalCode, invoice.IssueDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            TunisianPostingAccounts.SalesJournalCode,
            invoice.IssueDate,
            $"Facture vente {invoice.Number.Value}",
            period.Id,
            true,
            SourceInvoice,
            invoice.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// Posts the credit-note journal entry. Mirrors <see cref="GenerateInvoiceSaleEntryAsync"/>
    /// with debit/credit reversed, and uses absolute magnitudes for journal-line scalars
    /// (debit and credit are always positive — direction is the column).
    /// </summary>
    public async Task<Result> GenerateInvoiceCreditNoteEntryAsync(Invoice invoice, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
        {
            _logger.LogDebug("Chart of accounts empty — skip accounting for tenant");
            return Result.Success();
        }

        var existing = await _journalEntries.GetBySourceAsync(SourceInvoiceCreditNote, invoice.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var periodResult = await _periodService.EnsureOpenPeriodAsync(invoice.IssueDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = invoice.TotalAmount.Currency;
        var lines = new List<JournalLineInput>();

        // CREDIT 4111 (Client) for the absolute total — we owe the client this amount.
        lines.Add(new JournalLineInput(
            TunisianPostingAccounts.Client,
            $"Avoir client — {invoice.Number.Value}",
            0,
            Math.Abs(invoice.TotalAmount.Amount),
            invoice.ClientId,
            ThirdPartyKind.Client));

        var htByRevenue = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var line in invoice.Lines)
        {
            var acc = RevenueAccountForLine(line);
            var ht = line.SubTotal.Amount;
            if (!htByRevenue.TryGetValue(acc, out var sum))
                sum = 0;
            htByRevenue[acc] = sum + ht;
        }

        // DEBIT the original revenue accounts — we reverse the previously-recognised revenue.
        foreach (var kv in htByRevenue.OrderBy(k => k.Key))
        {
            if (kv.Value <= 0)
                continue;
            lines.Add(new JournalLineInput(
                kv.Key,
                $"Avoir ventes {invoice.Number.Value}",
                kv.Value,
                0,
                null,
                ThirdPartyKind.None));
        }

        var vatByRate = new Dictionary<int, decimal>();
        foreach (var line in invoice.Lines)
        {
            var rate = (int)line.VatRate;
            if (rate == 0)
                continue;
            if (!vatByRate.TryGetValue(rate, out var v))
                v = 0;
            vatByRate[rate] = v + line.VatAmount.Amount;
        }

        // DEBIT TVA collectée — we cancel the previously-collected VAT.
        foreach (var kv in vatByRate.OrderBy(k => k.Key))
        {
            if (kv.Value <= 0)
                continue;
            lines.Add(new JournalLineInput(
                TunisianPostingAccounts.VatCollected,
                $"TVA collectée {kv.Key}% — Avoir {invoice.Number.Value}",
                kv.Value,
                0,
                null,
                ThirdPartyKind.None));
        }

        var fodec = invoice.FodecAmount.Amount;
        if (Math.Abs(fodec) > 0.0005m)
        {
            lines.Add(new JournalLineInput(
                FodecAccountNumber,
                $"FODEC — Avoir {invoice.Number.Value}",
                Math.Abs(fodec),
                0,
                null,
                ThirdPartyKind.None));
        }

        // Fiscal stamp — for AVO it is stored as negative; reverse direction vs sale.
        var stamp = invoice.FiscalStampAmount.Amount;
        if (Math.Abs(stamp) > 0.0005m)
        {
            const string stampAccount = TunisianPostingAccounts.FiscalStampOnSale;
            if (stamp < 0)
            {
                // Negative stamp (typical for AVO) = we owe back the stamp = DEBIT 4371.
                lines.Add(new JournalLineInput(
                    stampAccount,
                    $"Timbre fiscal — Avoir {invoice.Number.Value}",
                    Math.Abs(stamp),
                    0,
                    null,
                    ThirdPartyKind.None));
            }
            else
            {
                lines.Add(new JournalLineInput(
                    stampAccount,
                    $"Timbre fiscal — Avoir {invoice.Number.Value}",
                    0,
                    stamp,
                    null,
                    ThirdPartyKind.None));
            }
        }

        var accountValidation = await ValidateAccountsExistAsync(lines, "InvoiceCreditNote", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(
            TunisianPostingAccounts.SalesJournalCode, invoice.IssueDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            TunisianPostingAccounts.SalesJournalCode,
            invoice.IssueDate,
            $"Avoir vente {invoice.Number.Value}",
            period.Id,
            true,
            SourceInvoiceCreditNote,
            invoice.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateClientPaymentEntryAsync(Payment payment, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourcePayment, payment.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var invoice = payment.Invoice;
        var date = payment.PaymentDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(date, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = payment.Amount.Currency;
        // Traite (effet de commerce) : la créance client n'est pas encaissée mais transformée en
        // effet à recevoir (413), sans mouvement de trésorerie → journal des opérations diverses.
        var isEffet = payment.Method == PaymentMethod.Traite;
        var debitAccount = isEffet ? ClientEffetAccountNumber : TreasuryAccount(payment.Method);
        var debitLabel = isEffet ? $"Effet à recevoir — {invoice.Number.Value}" : $"Encaissement — {invoice.Number.Value}";
        var netAmount = payment.Amount.Amount;
        var withholding = payment.ClientWithholdingAmount ?? 0m;
        var totalApplied = netAmount + withholding;

        var lines = new List<JournalLineInput>
        {
            new(debitAccount, debitLabel, netAmount, 0, null, ThirdPartyKind.None),
        };

        if (withholding > 0)
        {
            lines.Add(new JournalLineInput("4341", $"Retenue à la source subie — {invoice.Number.Value}", withholding, 0, null, ThirdPartyKind.None));
        }

        lines.Add(new JournalLineInput(TunisianPostingAccounts.Client, $"Client — {invoice.Number.Value}", 0, totalApplied, invoice.ClientId, ThirdPartyKind.Client));

        var accountValidation = await ValidateAccountsExistAsync(lines, "ClientPayment", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var journal = isEffet ? MiscJournalCode : (payment.Method == PaymentMethod.Cash ? "JC" : "JB");
        var description = isEffet
            ? $"Effet à recevoir facture {invoice.Number.Value}"
            : $"Encaissement facture {invoice.Number.Value}";
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, date.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            date,
            description,
            period.Id,
            true,
            SourcePayment,
            payment.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReverseInvoiceSaleEntryAsync(Guid invoiceId, string invoiceNumber, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var reversalType = SourceInvoiceCancelled;
        var existingReversal = await _journalEntries.GetBySourceAsync(reversalType, invoiceId, cancellationToken);
        if (existingReversal is not null)
            return Result.Success();

        // The original entry can be either a regular sale (FAC → SourceInvoice)
        // or a credit note (AVO → SourceInvoiceCreditNote). Check both.
        var original = await _journalEntries.GetBySourceAsync(SourceInvoice, invoiceId, cancellationToken)
                    ?? await _journalEntries.GetBySourceAsync(SourceInvoiceCreditNote, invoiceId, cancellationToken);
        if (original is null)
            return Result.Success();

        // Brouillard (C5) : une écriture encore en brouillon se supprime au lieu de s'extourner
        // (même règle que l'extourne manuelle) — l'annulation de la facture retire la pièce
        // provisoire sans générer de contre-passation.
        if (original.IsDraft)
        {
            await _journalEntries.RemoveAsync(original, cancellationToken);
            _logger.LogInformation(
                "Invoice {InvoiceNumber} cancelled: draft journal entry {EntryId} deleted instead of reversed",
                invoiceNumber, original.Id);
            return Result.Success();
        }

        // Contre-passer dans la période de l'écriture d'origine si elle est encore ouverte ;
        // sinon, repli sur la date du jour (une période clôturée ne peut recevoir d'écriture).
        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = original.Lines.First().DebitAmount.Amount > 0
            ? original.Lines.First().DebitAmount.Currency
            : original.Lines.First().CreditAmount.Currency;

        var revLines = new List<JournalLineInput>();
        foreach (var line in original.Lines.OrderBy(l => l.LineNumber))
        {
            revLines.Add(new JournalLineInput(
                line.AccountNumber,
                line.Label,
                line.CreditAmount.Amount,
                line.DebitAmount.Amount,
                line.ThirdPartyId,
                line.ThirdPartyKind));
        }

        var n = await _journalEntries.ReserveNextEntryNumberAsync(original.JournalCode, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            original.JournalCode,
            reversalDate,
            $"Contre-passation facture {invoiceNumber}",
            period.Id,
            true,
            reversalType,
            invoiceId,
            revLines,
            currency,
            original.Id);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var reversal = create.Value;
        reversal.MarkInitialStatus(NewEntryStatus);
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);

        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<Guid>> ReverseJournalEntryAsync(Guid entryId, string reason, CancellationToken cancellationToken = default)
    {
        if (!_settings.ManualReversalEnabled)
            return Result.Failure<Guid>(Error.Validation("Extourne", "La contre-passation manuelle n'est pas activée."));

        var original = await _journalEntries.GetByIdAsync(entryId, cancellationToken);
        if (original is null)
            return Result.Failure<Guid>(Error.NotFound("JournalEntry", entryId));

        if (original.IsDraft)
            return Result.Failure<Guid>(Error.Validation("Extourne",
                "Une écriture en brouillon se corrige ou se supprime directement, sans extourne."));

        if (original.IsReversed)
            return Result.Failure<Guid>(Error.Validation("Extourne", "Cette écriture a déjà été extournée."));

        // R-07/R-08 : une écriture générée par le module Paie ne s'extourne pas manuellement —
        // elle se corrige via le workflow paie (« Rouvrir le cycle » / « Annuler le paiement »).
        if (PayrollSourcedEntryGuard.IsSystemSource(original.SourceEntityType))
        {
            return Result.Failure<Guid>(Error.Validation("Extourne",
                "Cette écriture est générée par le module Paie — utilisez « Rouvrir le cycle » ou « Annuler le paiement »."));
        }

        // Contre-passer dans la période de l'écriture d'origine si elle est encore ouverte ;
        // sinon, repli sur la date du jour (une période clôturée ne peut recevoir d'écriture).
        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }
        if (periodResult.IsFailure)
            return Result.Failure<Guid>(periodResult.Error);

        var period = periodResult.Value;
        var firstLine = original.Lines.First();
        var currency = firstLine.DebitAmount.Amount > 0 ? firstLine.DebitAmount.Currency : firstLine.CreditAmount.Currency;

        var revLines = original.Lines
            .OrderBy(l => l.LineNumber)
            .Select(l => new JournalLineInput(
                l.AccountNumber,
                l.Label,
                l.CreditAmount.Amount,
                l.DebitAmount.Amount,
                l.ThirdPartyId,
                l.ThirdPartyKind))
            .ToList();

        var trimmedReason = string.IsNullOrWhiteSpace(reason) ? "correction" : reason.Trim();
        var label = $"Extourne {original.JournalCode}-{original.EntryNumber} : {trimmedReason}";
        if (label.Length > 500)
            label = label[..500];

        // Extourne saisie par l'utilisateur : elle suit le brouillard. Les extournes des pièces
        // métier passent par NewEntryStatus et naissent Validée.
        var manualReversalStatus = _settings.BrouillardEnabled
            ? JournalEntryStatus.Brouillon
            : JournalEntryStatus.Validee;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(original.JournalCode, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            original.JournalCode,
            reversalDate,
            label,
            period.Id,
            false,
            SourceManualReversal,
            original.Id,
            revLines,
            currency,
            original.Id,
            manualReversalStatus);

        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var reversal = create.Value;
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);

        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);

        return Result.Success(reversal.Id);
    }

    public async Task<Result> GenerateSupplierInvoiceEntryAsync(SupplierInvoice invoice, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourceSupplierInvoice, invoice.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var periodResult = await _periodService.EnsureOpenPeriodAsync(invoice.InvoiceDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = invoice.TotalAmount.Currency;
        var productTypes = await TryLoadStandaloneProductTypesAsync(invoice, cancellationToken);
        var fixedAssetClassifications = await BuildFixedAssetClassificationsAsync(invoice, cancellationToken);
        var (lines, _) = SupplierInvoiceJournalLineBuilder.Build(invoice, productTypes, fixedAssetClassifications);

        var accountValidation = await ValidateAccountsExistAsync(lines, "SupplierInvoice", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(
            TunisianPostingAccounts.PurchaseJournalCode, invoice.InvoiceDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            TunisianPostingAccounts.PurchaseJournalCode,
            invoice.InvoiceDate,
            $"Facture fournisseur {invoice.InvoiceNumber}",
            period.Id,
            true,
            SourceSupplierInvoice,
            invoice.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// Loads catalog product types only for standalone invoices (no PO / receipt).
    /// BC/BR invoices keep the historic 607 posting by returning null.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, ProductType>?> TryLoadStandaloneProductTypesAsync(
        SupplierInvoice invoice,
        CancellationToken cancellationToken)
    {
        if (invoice.PurchaseOrderId is not null || invoice.SourcePurchaseReceiptId is not null)
            return null;

        var productIds = invoice.Lines.Select(l => l.ProductId).Distinct().ToList();
        if (productIds.Count == 0)
            return null;

        await using var context = _contextFactory.CreateContext();
        return await context.Products.AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Type, cancellationToken);
    }

    /// <summary>
    /// Resolves, for every fixed-asset line of a supplier invoice, the effective (category-resolved)
    /// asset account and the "TVA capitalisée" decision (<see cref="FixedAssetVatRules"/>) — the same
    /// resolution used by <c>CreateFixedAssetsFromSupplierInvoiceHandler</c> when creating the draft,
    /// so the posted journal entry and the created <see cref="FixedAsset"/> stay consistent.
    /// Lines without a resolvable category are omitted: the builder falls back to its prior
    /// (non-regressed) behavior for them.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, SupplierInvoiceJournalLineBuilder.FixedAssetLineClassification>?>
        BuildFixedAssetClassificationsAsync(SupplierInvoice invoice, CancellationToken cancellationToken)
    {
        var assetLines = invoice.Lines.Where(l => l.IsFixedAsset).ToList();
        if (assetLines.Count == 0)
            return null;

        var result = new Dictionary<Guid, SupplierInvoiceJournalLineBuilder.FixedAssetLineClassification>();
        foreach (var line in assetLines)
        {
            var category = line.DepreciationRateCategoryId.HasValue
                ? await _depreciationRateCategories.GetByIdAsync(line.DepreciationRateCategoryId.Value, cancellationToken)
                : await _depreciationRateCategories.GetByCodeAsync("OTHER", cancellationToken);

            if (category is null)
            {
                _logger.LogWarning("No depreciation category for supplier line {Line}", line.LineNumber);
                continue;
            }

            var assetAccount = string.IsNullOrWhiteSpace(line.AssetAccountNumber)
                ? category.DefaultAssetAccount
                : line.AssetAccountNumber;
            var vatCapitalized = FixedAssetVatRules.IsVatCapitalized(category.Code, assetAccount);
            result[line.Id] = new SupplierInvoiceJournalLineBuilder.FixedAssetLineClassification(assetAccount, vatCapitalized);
        }

        return result;
    }

    public async Task<Result> GenerateSupplierPaymentEntryAsync(SupplierPayment payment, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourceSupplierPayment, payment.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var inv = payment.SupplierInvoice;
        var date = payment.PaymentDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(date, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = payment.Amount.Currency;
        // Traite (effet de commerce) : la dette fournisseur n'est pas décaissée mais transformée en
        // effet à payer (403), sans mouvement de trésorerie → journal des opérations diverses.
        var isEffet = payment.Method == PaymentMethod.Traite;
        var creditAccount = isEffet ? SupplierEffetAccountNumber : TreasuryAccount(payment.Method);
        var creditLabel = isEffet ? $"Effet à payer — {inv.InvoiceNumber}" : $"Paiement fournisseur — {inv.InvoiceNumber}";
        var amount = payment.Amount.Amount;

        var lines = new List<JournalLineInput>
        {
            new(TunisianPostingAccounts.Supplier, $"Fournisseur — {inv.InvoiceNumber}", amount, 0, inv.SupplierId, ThirdPartyKind.Supplier),
            new(creditAccount, creditLabel, 0, amount, null, ThirdPartyKind.None)
        };

        var accountValidation = await ValidateAccountsExistAsync(lines, "SupplierPayment", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var journal = isEffet ? MiscJournalCode : (payment.Method == PaymentMethod.Cash ? "JC" : "JB");
        var description = isEffet
            ? $"Effet à payer fournisseur {inv.InvoiceNumber}"
            : $"Paiement fournisseur {inv.InvoiceNumber}";
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, date.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            date,
            description,
            period.Id,
            true,
            SourceSupplierPayment,
            payment.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateClientEffetSettlementEntryAsync(Payment payment, EffetStatus outcome, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        if (payment.Method != PaymentMethod.Traite)
            return Result.Success();

        if (outcome != EffetStatus.Encaisse && outcome != EffetStatus.Impaye)
            return Result.Failure(Error.Validation("Effet", "L'issue de règlement de l'effet est invalide"));

        var existing = await _journalEntries.GetBySourceAsync(SourceEffetSettlement, payment.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var invoice = payment.Invoice;
        var date = (payment.EffetSettledAt ?? DateTime.UtcNow).Date;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(date, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = payment.Amount.Currency;
        // Le compte 413 porte le net reçu à la réception de l'effet ; c'est ce montant qui bouge à échéance.
        var net = payment.Amount.Amount;

        List<JournalLineInput> lines;
        string journal;
        string description;
        if (outcome == EffetStatus.Encaisse)
        {
            // Encaissement : la banque reçoit les fonds, l'effet à recevoir est soldé.
            lines = new List<JournalLineInput>
            {
                new("5321", $"Encaissement effet — {invoice.Number.Value}", net, 0, null, ThirdPartyKind.None),
                new(ClientEffetAccountNumber, $"Effet à recevoir soldé — {invoice.Number.Value}", 0, net, null, ThirdPartyKind.None)
            };
            journal = BankJournalCode;
            description = $"Encaissement effet facture {invoice.Number.Value}";
        }
        else
        {
            // Impayé : l'effet revient impayé, la créance client est réouverte.
            lines = new List<JournalLineInput>
            {
                new(TunisianPostingAccounts.Client, $"Effet impayé — {invoice.Number.Value}", net, 0, invoice.ClientId, ThirdPartyKind.Client),
                new(ClientEffetAccountNumber, $"Effet à recevoir impayé — {invoice.Number.Value}", 0, net, null, ThirdPartyKind.None)
            };
            journal = MiscJournalCode;
            description = $"Effet impayé facture {invoice.Number.Value}";
        }

        var accountValidation = await ValidateAccountsExistAsync(lines, "ClientEffetSettlement", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, date.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            date,
            description,
            period.Id,
            true,
            SourceEffetSettlement,
            payment.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateSupplierEffetSettlementEntryAsync(SupplierPayment payment, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        if (payment.Method != PaymentMethod.Traite)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourceEffetSettlement, payment.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var inv = payment.SupplierInvoice;
        var date = (payment.EffetSettledAt ?? DateTime.UtcNow).Date;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(date, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = payment.Amount.Currency;
        var amount = payment.Amount.Amount;

        // Paiement de l'effet à échéance : l'effet à payer est soldé, la banque est décaissée.
        var lines = new List<JournalLineInput>
        {
            new(SupplierEffetAccountNumber, $"Effet à payer soldé — {inv.InvoiceNumber}", amount, 0, null, ThirdPartyKind.None),
            new("5321", $"Paiement effet — {inv.InvoiceNumber}", 0, amount, null, ThirdPartyKind.None)
        };

        var accountValidation = await ValidateAccountsExistAsync(lines, "SupplierEffetSettlement", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(BankJournalCode, date.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            BankJournalCode,
            date,
            $"Paiement effet fournisseur {inv.InvoiceNumber}",
            period.Id,
            true,
            SourceEffetSettlement,
            payment.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateBankDepositEntryAsync(BankDeposit deposit, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourceBankDeposit, deposit.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var periodResult = await _periodService.EnsureOpenPeriodAsync(deposit.DepositDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = deposit.Amount.Currency;
        var amount = deposit.Amount.Amount;

        var lines = new List<JournalLineInput>
        {
            new("5321", $"Remise en banque {deposit.Number.Value}", amount, 0, null, ThirdPartyKind.None),
            new("5411", $"Sortie caisse — remise {deposit.Number.Value}", 0, amount, null, ThirdPartyKind.None)
        };

        var accountValidation = await ValidateAccountsExistAsync(lines, "BankDeposit", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync("JB", deposit.DepositDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            "JB",
            deposit.DepositDate,
            $"Remise en banque {deposit.Number.Value}",
            period.Id,
            true,
            SourceBankDeposit,
            deposit.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateCashOperationEntryAsync(CashOperation operation, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        if (operation.Category == CashExpenseCategory.BankDeposit)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourceCashOperation, operation.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var periodResult = await _periodService.EnsureOpenPeriodAsync(operation.OperationDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = operation.Amount.Currency;
        var amount = operation.Amount.Amount;
        var journalLabel = CashOperationJournalLabelBuilder.BuildJournalLabel(operation);
        var lines = new List<JournalLineInput>();

        var treasuryAccount = CashDeskPostingAccounts.TreasuryAccount(operation.Method);

        if (operation.OperationType == CashOperationType.Debit)
        {
            var payrollCycleExists = operation.Category == CashExpenseCategory.NetSalaries
                && await _journalEntries.ExistsActiveBySourceTypeAsync(SourcePayrollRun, cancellationToken);
            var expense = CashDeskPostingAccounts.ExpenseAccount(operation.Category!.Value, payrollCycleExists);
            lines.Add(new JournalLineInput(expense, journalLabel, amount, 0, null, ThirdPartyKind.None));
            lines.Add(new JournalLineInput(treasuryAccount, journalLabel, 0, amount, null, ThirdPartyKind.None));
        }
        else
        {
            var revenue = CashDeskPostingAccounts.RevenueAccount(operation.RevenueCategory!.Value);
            var vatSplit = ResolveCashSalesVatSplit(operation, amount);

            lines.Add(new JournalLineInput(treasuryAccount, journalLabel, amount, 0, null, ThirdPartyKind.None));

            if (vatSplit is { } split)
            {
                var revenueLabel = CashOperationJournalLabelBuilder.BuildLineLabel(journalLabel, " — HT");
                var vatLabel = CashOperationJournalLabelBuilder.BuildLineLabel(
                    journalLabel, $" — TVA {(int)operation.VatRate!.Value}%");

                lines.Add(new JournalLineInput(revenue, revenueLabel, 0, split.Ht, null, ThirdPartyKind.None));
                lines.Add(new JournalLineInput(TunisianPostingAccounts.VatCollected, vatLabel, 0, split.Vat, null, ThirdPartyKind.None));
            }
            else
            {
                lines.Add(new JournalLineInput(revenue, journalLabel, 0, amount, null, ThirdPartyKind.None));
            }
        }

        var accountValidation = await ValidateAccountsExistAsync(lines, "CashOperation", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync("JC", operation.OperationDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            "JC",
            operation.OperationDate,
            journalLabel,
            period.Id,
            true,
            SourceCashOperation,
            operation.Id,
            lines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateSupplierInvoiceWithholdingEntryAsync(
        SupplierInvoice invoice,
        CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        if (!invoice.IsSubjectToWithholding || invoice.WithholdingAmount is not > 0)
            return Result.Success();

        // Une seule écriture RS par FF : si le montant change après coup, un ajustement manuel ou une écriture complémentaire est requis.
        // Le recalcul RS à la solde s’exécute avant la première génération (notification après paiement).
        var existing = await _journalEntries.GetBySourceAsync(SourceSupplierInvoiceWithholding, invoice.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var paymentDate = invoice.PaidAt?.Date ?? invoice.InvoiceDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(paymentDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var totalWithheld = invoice.WithholdingAmount!.Value;

        var operationCode = "RS7_000001";
        if (invoice.WithholdingTaxTypeId.HasValue)
        {
            var wt = await _withholdingTaxTypes.GetTypeByIdAsync(invoice.WithholdingTaxTypeId.Value, cancellationToken);
            if (wt is not null)
                operationCode = wt.Code;
        }

        var withholdingAccount = WithholdingAccountForOperationCode(operationCode);
        var label = $"RS facture fournisseur {invoice.InvoiceNumber}";

        // L'écriture de paiement (GenerateSupplierPaymentEntryAsync) solde déjà le compte 4011
        // pour le TTC et crédite la trésorerie du TTC. Cette écriture RS reclasse la seule part
        // retenue : elle n'a pas été décaissée au fournisseur mais reste due à l'État.
        //   Débit 5321  : la retenue n'est pas sortie de la trésorerie ;
        //   Crédit 445x : dette de retenue à la source envers l'État.
        var lines = new List<JournalLineInput>
        {
            new(
                "5321",
                $"Retenue à la source non décaissée — {label}",
                totalWithheld,
                0,
                null,
                ThirdPartyKind.None),
            new(
                withholdingAccount,
                $"Retenue à la source à reverser à l'État — {label}",
                0,
                totalWithheld,
                null,
                ThirdPartyKind.None)
        };

        var accountValidation = await ValidateAccountsExistAsync(lines, "SupplierInvoiceWithholding", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync("JOD", paymentDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            "JOD",
            paymentDate,
            label,
            period.Id,
            true,
            SourceSupplierInvoiceWithholding,
            invoice.Id,
            lines);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReverseSupplierInvoiceEntryAsync(Guid supplierInvoiceId, string invoiceNumber, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        const string reversalType = "SupplierInvoiceCancelled";
        var existingReversal = await _journalEntries.GetBySourceAsync(reversalType, supplierInvoiceId, cancellationToken);
        if (existingReversal is not null)
            return Result.Success();

        var original = await _journalEntries.GetBySourceAsync(SourceSupplierInvoice, supplierInvoiceId, cancellationToken);
        if (original is null)
            return Result.Success();

        // Contre-passer dans la période de l'écriture d'origine si elle est encore ouverte ;
        // sinon, repli sur la date du jour (une période clôturée ne peut recevoir d'écriture).
        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = original.Lines.First().DebitAmount.Amount > 0
            ? original.Lines.First().DebitAmount.Currency
            : original.Lines.First().CreditAmount.Currency;

        var revLines = new List<JournalLineInput>();
        foreach (var line in original.Lines.OrderBy(l => l.LineNumber))
        {
            revLines.Add(new JournalLineInput(
                line.AccountNumber,
                line.Label,
                line.CreditAmount.Amount,
                line.DebitAmount.Amount,
                line.ThirdPartyId,
                line.ThirdPartyKind));
        }

        var n = await _journalEntries.ReserveNextEntryNumberAsync(original.JournalCode, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            original.JournalCode,
            reversalDate,
            $"Contre-passation facture fournisseur {invoiceNumber}",
            period.Id,
            true,
            reversalType,
            supplierInvoiceId,
            revLines,
            currency,
            original.Id);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var reversal = create.Value;
        reversal.MarkInitialStatus(NewEntryStatus);
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);

        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<Guid>> GenerateOpeningEntriesAsync(int closedFiscalYear, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Failure<Guid>(Error.Validation("ChartOfAccounts", "Le plan comptable est vide."));

        var newYear = closedFiscalYear + 1;

        // Idempotency: check if opening entries already exist for this year. GetActiveBySourceAsync
        // (et non GetBySourceAsync) : ignore les à-nouveaux EXTOURNÉS — indispensable pour que la
        // réparation (RepairOpeningEntriesAsync, T8) puisse régénérer après avoir extourné un
        // à-nouveau contaminé, sans se heurter à un faux conflit sur l'écriture désormais inactive.
        var existingSourceId = GuidFromFiscalYear(closedFiscalYear);
        var existing = await _journalEntries.GetActiveBySourceAsync(SourceOpeningBalance, existingSourceId, cancellationToken);
        if (existing is not null)
            return Result.Failure<Guid>(Error.Conflict($"Les écritures d'à-nouveau pour l'exercice {closedFiscalYear} ont déjà été générées."));

        // Garde-fou légal : les à-nouveaux figent les soldes de l'exercice — aucun brouillon
        // ne doit subsister (même wording que la clôture annuelle). Sans effet quand le
        // workflow brouillard est désactivé.
        var drafts = await _journalEntries.CountDraftsByFiscalYearAsync(closedFiscalYear, cancellationToken);
        if (drafts > 0)
            return Result.Failure<Guid>(Error.Validation("Brouillard",
                $"{drafts} écriture(s) en brouillard sur l'exercice {closedFiscalYear}. Validez-les avant de générer les à-nouveaux."));

        // Ensure Jan 1st of the new year has an open period
        var jan1 = new DateTime(newYear, 1, 1);
        var periodResult = await _periodService.EnsureOpenPeriodAsync(jan1, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure<Guid>(periodResult.Error);

        var period = periodResult.Value;

        // Soldes de clôture ancrés sur l'à-nouveau de l'exercice s'il existe (T8) : corrige le
        // double comptage historique (Bug D-bis) qui cumulait tout l'historique antérieur SANS
        // exclure les à-nouveaux déjà posés — à partir du 2ᵉ exercice clôturé, les soldes reportés
        // étaient doublés. Voir FiscalAnchorHelper.ComputeAnchoredClosingBalancesAsync.
        await using var ctx = _contextFactory.CreateContext();
        var balances = await FiscalAnchorHelper.ComputeAnchoredClosingBalancesAsync(ctx, closedFiscalYear, cancellationToken);
        var lines = BuildOpeningLines(balances, closedFiscalYear);

        if (lines.Count < 2)
        {
            _logger.LogInformation("No opening balance entries to generate for fiscal year {Year}", closedFiscalYear);
            return Result.Failure<Guid>(Error.Validation("OpeningBalance",
                "Aucune écriture d'à-nouveau à générer (pas de soldes sur les comptes de bilan)."));
        }

        // Validate all accounts exist
        var accountValidation = await ValidateAccountsExistAsync(lines, "OpeningEntries", cancellationToken);
        if (accountValidation.IsFailure)
            return Result.Failure<Guid>(accountValidation.Error);

        var n = await _journalEntries.ReserveNextEntryNumberAsync("JAN", newYear, cancellationToken);
        var create = JournalEntry.Create(
            n,
            "JAN",
            jan1,
            $"Écritures d'à-nouveau — Exercice {closedFiscalYear}",
            period.Id,
            true,
            SourceOpeningBalance,
            existingSourceId,
            lines);

        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);

        _logger.LogInformation("Generated {LineCount} opening balance lines for fiscal year {NewYear} from {ClosedYear}",
            lines.Count, newYear, closedFiscalYear);

        return Result.Success(entry.Id);
    }

    /// <summary>
    /// Construit les lignes d'à-nouveau attendues à partir des soldes ancrés (T8) : report des
    /// comptes de bilan (classes 1-5, un par compte + tiers, montants non nuls) puis transfert du
    /// résultat net de l'exercice (classes 6-7, mouvements seuls) vers 131 (bénéfice) ou 135
    /// (perte). Factorisée pour être exploitée à l'identique par la génération
    /// (<see cref="GenerateOpeningEntriesAsync"/>) et le diagnostic (<see cref="DiagnoseOpeningEntriesAsync"/>).
    /// </summary>
    private static List<JournalLineInput> BuildOpeningLines(
        IReadOnlyList<FiscalAnchorHelper.AnchoredBalance> balances, int closedFiscalYear)
    {
        var lines = new List<JournalLineInput>();

        foreach (var ab in balances
            .Where(a => a.AccountNumber.Length > 0 &&
                        a.AccountNumber[0] >= '1' && a.AccountNumber[0] <= '5')
            .OrderBy(a => a.AccountNumber, StringComparer.Ordinal)
            .ThenBy(a => a.ThirdPartyId))
        {
            var balance = Math.Round(ab.TotalDebit - ab.TotalCredit, 3);
            if (balance == 0) continue;

            var lineLabel = $"À-nouveau {closedFiscalYear} — {ab.AccountNumber}";
            lines.Add(balance > 0
                ? new JournalLineInput(ab.AccountNumber, lineLabel, balance, 0, ab.ThirdPartyId, ab.ThirdPartyKind)
                : new JournalLineInput(ab.AccountNumber, lineLabel, 0, Math.Abs(balance), ab.ThirdPartyId, ab.ThirdPartyKind));
        }

        // Classes 6 (charges, nature débit) et 7 (produits, nature crédit) : le résultat net de
        // l'exercice — les mouvements seuls, jamais d'ouverture, cf. ComputeAnchoredClosingBalancesAsync.
        var pnlBalance = balances
            .Where(a => a.AccountNumber.Length > 0 && (a.AccountNumber[0] == '6' || a.AccountNumber[0] == '7'))
            .Sum(a => a.TotalCredit - a.TotalDebit);
        var netResult = Math.Round(pnlBalance, 3);

        if (netResult != 0)
        {
            var resultAccount = netResult > 0 ? OpeningBalanceProfitAccountNumber : OpeningBalanceLossAccountNumber;
            var label = $"Résultat net exercice {closedFiscalYear}";
            lines.Add(netResult > 0
                ? new JournalLineInput(resultAccount, label, 0, netResult, null, ThirdPartyKind.None)
                : new JournalLineInput(resultAccount, label, Math.Abs(netResult), 0, null, ThirdPartyKind.None));
        }

        return lines;
    }

    /// <summary>Solde signé (débit − crédit) attendu par compte + tiers, agrégeant les lignes attendues.</summary>
    private static Dictionary<(string AccountNumber, Guid? ThirdPartyId), decimal> ExpectedSignedBalances(
        IEnumerable<JournalLineInput> lines)
    {
        var dict = new Dictionary<(string, Guid?), decimal>();
        foreach (var l in lines)
        {
            var key = (l.AccountNumber, l.ThirdPartyId);
            dict.TryGetValue(key, out var cur);
            dict[key] = cur + l.Debit - l.Credit;
        }
        return dict;
    }

    /// <summary>
    /// Diagnostique une écriture d'à-nouveau active donnée : recalcule les soldes attendus pour
    /// son exercice clôturé et rend les écarts ligne à ligne avec les montants réellement portés.
    /// </summary>
    private static async Task<OpeningEntryDiagnosticDto> DiagnoseOneAsync(
        Persistence.TenantDbContext ctx, JournalEntry openingEntry, int closedFiscalYear, CancellationToken ct)
    {
        var balances = await FiscalAnchorHelper.ComputeAnchoredClosingBalancesAsync(ctx, closedFiscalYear, ct);
        var expected = ExpectedSignedBalances(BuildOpeningLines(balances, closedFiscalYear));

        var actual = ExpectedSignedBalances(openingEntry.Lines.Select(l =>
            new JournalLineInput(l.AccountNumber, l.Label, l.DebitAmount.Amount, l.CreditAmount.Amount, l.ThirdPartyId, l.ThirdPartyKind)));

        var keys = new HashSet<(string, Guid?)>(expected.Keys);
        keys.UnionWith(actual.Keys);

        var discrepancies = new List<OpeningEntryLineDiscrepancyDto>();
        foreach (var key in keys.OrderBy(k => k.Item1, StringComparer.Ordinal))
        {
            var exp = expected.TryGetValue(key, out var e) ? e : 0m;
            var act = actual.TryGetValue(key, out var a) ? a : 0m;
            if (Math.Abs(exp - act) >= 0.01m)
                discrepancies.Add(new OpeningEntryLineDiscrepancyDto(key.Item1, key.Item2, exp, act, exp - act));
        }

        return new OpeningEntryDiagnosticDto(closedFiscalYear, openingEntry.Id, discrepancies.Count > 0, discrepancies);
    }

    public async Task<Result<IReadOnlyList<OpeningEntryDiagnosticDto>>> DiagnoseOpeningEntriesAsync(
        CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();

        var activeEntries = await ctx.JournalEntries.AsNoTracking()
            .Include(e => e.Lines)
            .Where(e => e.SourceEntityType == SourceOpeningBalance && !e.IsReversed)
            .OrderBy(e => e.EntryDate)
            .ToListAsync(cancellationToken);

        var diagnostics = new List<OpeningEntryDiagnosticDto>();
        foreach (var entry in activeEntries)
        {
            // L'à-nouveau de l'exercice clôturé N est daté du 1er janvier de N+1.
            var closedFiscalYear = entry.EntryDate.Year - 1;
            diagnostics.Add(await DiagnoseOneAsync(ctx, entry, closedFiscalYear, cancellationToken));
        }

        return Result.Success<IReadOnlyList<OpeningEntryDiagnosticDto>>(diagnostics);
    }

    public async Task<Result> RepairOpeningEntriesAsync(int closedFiscalYear, CancellationToken cancellationToken = default)
    {
        var existing = await _journalEntries.GetActiveBySourceAsync(
            SourceOpeningBalance, GuidFromFiscalYear(closedFiscalYear), cancellationToken);
        if (existing is null)
            return Result.Success(); // Rien à réparer : aucun à-nouveau actif pour cet exercice.

        await using var ctx = _contextFactory.CreateContext();
        var diagnostic = await DiagnoseOneAsync(ctx, existing, closedFiscalYear, cancellationToken);
        if (!diagnostic.HasDiscrepancy)
            return Result.Success(); // Idempotence : aucun écart, no-op succès.

        if (existing.Status == JournalEntryStatus.Brouillon)
        {
            await _journalEntries.RemoveAsync(existing, cancellationToken);
        }
        else
        {
            // Extourne interne (patron ReverseSupplierInvoiceEntryAsync) : NE PAS utiliser
            // ReverseJournalEntryAsync (parcours utilisateur conditionné au réglage d'extourne
            // manuelle) — la réparation doit fonctionner quel que soit ce réglage (T8, point 4).
            var reversalDate = existing.EntryDate;
            var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
            if (periodResult.IsFailure)
            {
                reversalDate = DateTime.UtcNow.Date;
                periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
            }
            if (periodResult.IsFailure)
                return Result.Failure(periodResult.Error);

            var period = periodResult.Value;
            var currency = existing.Lines.First().DebitAmount.Amount > 0
                ? existing.Lines.First().DebitAmount.Currency
                : existing.Lines.First().CreditAmount.Currency;

            var revLines = existing.Lines
                .OrderBy(l => l.LineNumber)
                .Select(l => new JournalLineInput(
                    l.AccountNumber, l.Label, l.CreditAmount.Amount, l.DebitAmount.Amount, l.ThirdPartyId, l.ThirdPartyKind))
                .ToList();

            var n = await _journalEntries.ReserveNextEntryNumberAsync(existing.JournalCode, reversalDate.Year, cancellationToken);
            var create = JournalEntry.Create(
                n,
                existing.JournalCode,
                reversalDate,
                $"Extourne (réparation à-nouveau contaminé) — Exercice {closedFiscalYear}",
                period.Id,
                true,
                SourceOpeningBalanceReversal,
                existing.Id,
                revLines,
                currency,
                existing.Id);

            if (create.IsFailure)
                return Result.Failure(create.Error);

            var reversal = create.Value;
            // Statut forcé Validee (jamais NewEntryStatus) : la réparation figure les soldes ;
            // un brouillon serait invisible des états NCT et laisserait l'écart en place.
            reversal.MarkInitialStatus(JournalEntryStatus.Validee);
            reversal.SetAuditInfo("system", false);
            await _journalEntries.AddAsync(reversal, cancellationToken);

            existing.MarkReversedBy(reversal.Id);
            await _journalEntries.UpdateAsync(existing, cancellationToken);
        }

        // Régénère : GetActiveBySourceAsync (T8, point 2) ne voit plus l'écriture d'origine
        // (supprimée, ou extournée) — la génération ne court-circuite plus en conflit.
        var regenerate = await GenerateOpeningEntriesAsync(closedFiscalYear, cancellationToken);
        return regenerate.IsSuccess ? Result.Success() : Result.Failure(regenerate.Error);
    }

    /// <summary>
    /// Generates a deterministic GUID from a fiscal year integer for idempotency checking.
    /// </summary>
    private static Guid GuidFromFiscalYear(int fiscalYear)
    {
        var bytes = new byte[16];
        BitConverter.GetBytes(fiscalYear).CopyTo(bytes, 0);
        // Marker bytes to make this identifiable as an opening balance source
        bytes[4] = 0xA0;
        bytes[5] = 0x0B; // "A-Nouveau Opening Balance"
        return new Guid(bytes);
    }

    private static string WithholdingAccountForOperationCode(string operationCode)
    {
        return operationCode switch
        {
            var c when c.StartsWith("RS1", StringComparison.OrdinalIgnoreCase) => "4321",
            var c when c.StartsWith("RS2", StringComparison.OrdinalIgnoreCase) => "4322",
            var c when c.StartsWith("RS3", StringComparison.OrdinalIgnoreCase) => "4323",
            var c when c.StartsWith("RS4", StringComparison.OrdinalIgnoreCase) => "4324",
            var c when c.StartsWith("RS5", StringComparison.OrdinalIgnoreCase) => "4325",
            var c when c.StartsWith("RS6", StringComparison.OrdinalIgnoreCase) => "4326",
            var c when c.StartsWith("RS7", StringComparison.OrdinalIgnoreCase) => "4327",
            var c when c.StartsWith("RS8", StringComparison.OrdinalIgnoreCase) => "4320",
            var c when c.StartsWith("RS9", StringComparison.OrdinalIgnoreCase) => "4320",
            _ => "4320"
        };
    }

    private static string TreasuryAccount(PaymentMethod method) =>
        method == PaymentMethod.Cash ? "5411" : "5321";

    /// <summary>
    /// Décompose la TVA d'un encaissement « ventes au comptant » quand la décomposition à 3 lignes
    /// s'applique : flag <see cref="AccountingSettings.CashDeskVatEnabled"/> actif, taux renseigné,
    /// non exonéré, et TVA calculée strictement positive (une TVA nulle par arrondi ne produit
    /// jamais de ligne 436711 — <c>JournalEntry</c> rejette les lignes débit = crédit = 0).
    /// Retourne <c>null</c> sinon : l'écriture reste à 2 lignes (C 707 TTC intégral).
    /// </summary>
    private (decimal Ht, decimal Vat)? ResolveCashSalesVatSplit(CashOperation operation, decimal amount)
    {
        if (!_settings.CashDeskVatEnabled)
            return null;

        if (operation.RevenueCategory != CashRevenueCategory.CashSalesReceipt)
            return null;

        if (operation.VatRate is not { } rate || rate == VatRate.Exempt)
            return null;

        var split = CashOperationVatCalculator.SplitTtc(amount, rate);
        return split.Vat > 0 ? split : null;
    }

    private static string RevenueAccountForLine(InvoiceLine line)
    {
        if (!line.ProductId.HasValue || line.Product is null)
            return TunisianPostingAccounts.SalesOfGoods;
        return line.Product.Type == ProductType.Service
            ? TunisianPostingAccounts.SalesOfServices
            : TunisianPostingAccounts.SalesOfGoods;
    }

    public async Task<Result> GenerateFixedAssetAcquisitionEntryAsync(FixedAsset asset, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourceFixedAssetAcquisition, asset.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        if (asset.InServiceDate is null || string.IsNullOrWhiteSpace(asset.CreditAccountNumber))
            return Result.Failure(Error.Validation("FixedAsset", "Mise en service incomplète pour l'écriture d'acquisition."));

        var entryDate = asset.InServiceDate.Value;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(entryDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        // Débit actif : HT normalement, ou TTC (TVA incluse) pour les véhicules de tourisme
        // (VatCapitalized) — TotalCapitalizedCost suit déjà cette règle. TVA déductible non
        // capitalisée (véhicules utilitaires, matériel…) est postée au débit du 43662 ; véhicules
        // de tourisme n'ont pas de ligne 43662 (TVA non récupérable, capitalisée dans le prix de
        // revient) ; TVA nulle → comportement historique à 2 lignes, inchangé.
        var debitAssetAmount = asset.TotalCapitalizedCost;
        var creditAmount = debitAssetAmount;
        var lines = new List<JournalLineInput>
        {
            new(asset.AssetAccountNumber, $"Acquisition — {asset.InventoryNumber}", debitAssetAmount, 0, null, ThirdPartyKind.None)
        };

        if (asset.VatAmount > 0 && !asset.VatCapitalized)
        {
            lines.Add(new(TunisianPostingAccounts.VatDeductibleFixedAssets, $"TVA déductible immo — {asset.InventoryNumber}", asset.VatAmount, 0, null, ThirdPartyKind.None));
            creditAmount += asset.VatAmount;
        }

        lines.Add(new(asset.CreditAccountNumber!, $"Acquisition — {asset.Label}", 0, creditAmount, null, ThirdPartyKind.None));

        var accountValidation = await ValidateAccountsExistAsync(lines, "FixedAssetAcquisition", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(FixedAssetJournalCode, entryDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            FixedAssetJournalCode,
            entryDate,
            $"Immobilisation {asset.InventoryNumber}",
            periodResult.Value.Id,
            true,
            SourceFixedAssetAcquisition,
            asset.Id,
            lines);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateFixedAssetDepreciationEntryAsync(
        FixedAsset asset,
        DepreciationScheduleLine scheduleLine,
        DateTime? entryDate = null,
        CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        if (scheduleLine.IsPosted)
            return Result.Success();

        // Garde « écriture active » (T13, C6) : une écriture extournée n'est plus bloquante —
        // GetActiveBySourceAsync filtre !IsReversed. Une écriture active l'est toujours (idempotence).
        var existing = await _journalEntries.GetActiveBySourceAsync(SourceFixedAssetDepreciation, scheduleLine.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        if (scheduleLine.DepreciationAmount <= 0)
            return Result.Success();

        // Défaut civil (repli) : 31/12 de l'exercice (clé) de la ligne. Le run annuel décalé (P3)
        // passe une date explicite (fin d'exercice, ex. 30/06/N+1) — ce défaut n'est atteint que
        // pour l'exercice civil ou les appelants ne fournissant pas de date (test, repli).
        var effectiveDate = entryDate ?? new DateTime(scheduleLine.FiscalYear, 12, 31);
        var periodResult = await _periodService.EnsureOpenPeriodAsync(effectiveDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var amount = scheduleLine.DepreciationAmount;
        var lines = new List<JournalLineInput>
        {
            new(asset.ExpenseAccountNumber, $"Dotation {scheduleLine.FiscalYear} — {asset.InventoryNumber}", amount, 0, null, ThirdPartyKind.None),
            new(asset.DepreciationAccountNumber, $"Amort. {scheduleLine.FiscalYear} — {asset.InventoryNumber}", 0, amount, null, ThirdPartyKind.None)
        };

        var accountValidation = await ValidateAccountsExistAsync(lines, "FixedAssetDepreciation", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(FixedAssetJournalCode, scheduleLine.FiscalYear, cancellationToken);
        var create = JournalEntry.Create(
            n,
            FixedAssetJournalCode,
            effectiveDate,
            $"Dotation amortissement {asset.InventoryNumber} ({scheduleLine.FiscalYear})",
            periodResult.Value.Id,
            true,
            SourceFixedAssetDepreciation,
            scheduleLine.Id,
            lines);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);

        scheduleLine.MarkPosted(entry.Id, periodResult.Value.Id);
        asset.ApplyDepreciation(amount, scheduleLine.AccumulatedDepreciation, scheduleLine.ClosingNbv);

        return Result.Success();
    }

    public async Task<Result> GenerateFixedAssetDisposalEntryAsync(FixedAsset asset, CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        // Garde « écriture active » (T13, C6) : une écriture de cession extournée n'est plus
        // bloquante — GetActiveBySourceAsync filtre !IsReversed (cohérence avec la dotation).
        var existing = await _journalEntries.GetActiveBySourceAsync(SourceFixedAssetDisposal, asset.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        if (asset.DisposalDate is null)
            return Result.Failure(Error.Validation("FixedAsset", "Cession incomplète pour l'écriture comptable."));

        var entryDate = asset.DisposalDate.Value;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(entryDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var gross = asset.TotalCapitalizedCost;
        var accumulated = asset.AccumulatedDepreciation;
        var proceeds = asset.DisposalProceeds ?? 0m;
        var nbv = asset.NetBookValue;
        var gainOrLoss = proceeds - nbv;

        var hasTreasury = !string.IsNullOrWhiteSpace(asset.DisposalTreasuryAccount);
        var hasReceivable = !string.IsNullOrWhiteSpace(asset.DisposalReceivableAccount);
        // Un compte de règlement n'est requis que pour un produit de cession positif ; la mise au
        // rebut / cession gratuite (produit = 0) ne génère aucune ligne de règlement (T4, A6).
        if (proceeds > 0 && !hasTreasury && !hasReceivable)
            return Result.Failure(Error.Validation("FixedAsset", "Cession incomplète pour l'écriture comptable."));

        var lines = new List<JournalLineInput>();

        if (accumulated > 0)
        {
            lines.Add(new JournalLineInput(
                asset.DepreciationAccountNumber,
                $"Reprise amort. cession — {asset.InventoryNumber}",
                accumulated,
                0,
                null,
                ThirdPartyKind.None));
        }

        if (proceeds > 0)
        {
            // Règlement comptant (trésorerie) ou à terme (créance 452 sur cession).
            var settlementAccount = hasReceivable ? asset.DisposalReceivableAccount! : asset.DisposalTreasuryAccount!;
            lines.Add(new JournalLineInput(
                settlementAccount,
                $"Produit cession — {asset.InventoryNumber}",
                proceeds,
                0,
                null,
                ThirdPartyKind.None));
        }

        lines.Add(new JournalLineInput(
            asset.AssetAccountNumber,
            $"Sortie immobilisation — {asset.InventoryNumber}",
            0,
            gross,
            null,
            ThirdPartyKind.None));

        if (gainOrLoss > 0)
        {
            lines.Add(new JournalLineInput(
                "736",
                $"Plus-value cession — {asset.InventoryNumber}",
                0,
                gainOrLoss,
                null,
                ThirdPartyKind.None));
        }
        else if (gainOrLoss < 0)
        {
            lines.Add(new JournalLineInput(
                "636",
                $"Moins-value cession — {asset.InventoryNumber}",
                Math.Abs(gainOrLoss),
                0,
                null,
                ThirdPartyKind.None));
        }

        var accountValidation = await ValidateAccountsExistAsync(lines, "FixedAssetDisposal", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync(FixedAssetJournalCode, entryDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            FixedAssetJournalCode,
            entryDate,
            $"Cession immobilisation {asset.InventoryNumber}",
            periodResult.Value.Id,
            true,
            SourceFixedAssetDisposal,
            asset.Id,
            lines);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    // ── T10 : écriture d'impôt de la finalisation de la liasse fiscale (Bug E) ───────────────

    public async Task<Result<Guid>> GenerateFiscalTaxEntryAsync(
        int fiscalYear, decimal taxDue, decimal cssDue, Guid declarationId, CancellationToken cancellationToken = default)
    {
        // Garde-fous : montants négatifs refusés.
        if (taxDue < 0m)
            return Result.Failure<Guid>(Error.Validation("TaxDue", "Le montant d'impôt dû ne peut pas être négatif."));
        if (cssDue < 0m)
            return Result.Failure<Guid>(Error.Validation("CssDue", "Le montant de CSS ne peut pas être négatif."));

        // Impôt total nul → rien à comptabiliser (no-op succès sûr pour la finalisation).
        if (taxDue + cssDue == 0m)
            return Result.Success(Guid.Empty);

        if (declarationId == Guid.Empty)
            return Result.Failure<Guid>(Error.Validation("DeclarationId", "L'identifiant de la déclaration est obligatoire."));

        // Idempotence : un rejeu rend l'Id de l'écriture existante (jamais de doublon).
        var existing = await _journalEntries.GetBySourceAsync(SourceFiscalTax, declarationId, cancellationToken);
        if (existing is not null)
            return Result.Success(existing.Id);

        var entryDate = new DateTime(fiscalYear, 12, 31);
        var periodResult = await _periodService.EnsureOpenPeriodAsync(entryDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure<Guid>(periodResult.Error);

        var totalDue = taxDue + cssDue;
        var lines = new List<JournalLineInput>();

        // Débit 691 = impôt dû (charge d'IS).
        if (taxDue > 0m)
            lines.Add(new JournalLineInput(IncomeTaxExpenseAccountNumber, "Impôt sur les sociétés — exercice", taxDue, 0m, null, ThirdPartyKind.None));

        // Débit 6912 = CSS (omise si 0 ; sous-compte auto-créé le cas échéant).
        if (cssDue > 0m)
            lines.Add(new JournalLineInput(CssExpenseAccountNumber, "Contribution sociale de solidarité — exercice", cssDue, 0m, null, ThirdPartyKind.None));

        // Crédit 4343 = impôt total dû (jamais le net à payer — acomptes/RAS restent en 4341/4342).
        lines.Add(new JournalLineInput(IncomeTaxLiabilityAccountNumber, "Impôt à liquider — exercice", 0m, totalDue, null, ThirdPartyKind.None));

        var accountValidation = await ValidateAccountsExistAsync(lines, "FiscalTaxEntry", cancellationToken);
        if (accountValidation.IsFailure)
            return Result.Failure<Guid>(accountValidation.Error);

        var n = await _journalEntries.ReserveNextEntryNumberAsync(MiscJournalCode, entryDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            MiscJournalCode,
            entryDate,
            $"Comptabilisation de l'impôt sur le résultat — exercice {fiscalYear}",
            periodResult.Value.Id,
            true,
            SourceFiscalTax,
            declarationId,
            lines);

        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var entry = create.Value;
        // T10 — statut Validee écrit explicitement, même si NewEntryStatus vaut déjà Validee :
        // un retour du brouillard sur les pièces métier ne doit pas pouvoir cacher l'impôt des
        // états NCT (Status != Brouillon) ni casser la réconciliation feuille/livres.
        entry.MarkInitialStatus(JournalEntryStatus.Validee);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success(entry.Id);
    }

    public async Task<int> CountReplaceableLinesAsync(string accountNumber, CancellationToken cancellationToken = default)
    {
        var acc = accountNumber?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(acc))
            return 0;

        await using var ctx = _contextFactory.CreateContext();
        return await ctx.JournalEntryLines
            .Where(l => l.AccountNumber == acc && !l.JournalEntry.AccountingPeriod!.IsClosed)
            .CountAsync(cancellationToken);
    }

    public async Task<Result<int>> ReplaceAccountAsync(string oldAccountNumber, string newAccountNumber, CancellationToken cancellationToken = default)
    {
        var oldAcc = oldAccountNumber?.Trim() ?? string.Empty;
        var newAcc = newAccountNumber?.Trim() ?? string.Empty;

        if (string.IsNullOrEmpty(oldAcc) || string.IsNullOrEmpty(newAcc))
            return Result.Failure<int>(Error.Validation("Account", "Les deux comptes sont obligatoires."));
        if (string.Equals(oldAcc, newAcc, StringComparison.Ordinal))
            return Result.Failure<int>(Error.Validation("Account", "Le nouveau compte doit être différent de l'ancien."));

        var oldAccount = await _chartOfAccounts.GetByAccountNumberAsync(oldAcc, cancellationToken);
        if (oldAccount is null)
            return Result.Failure<int>(Error.Validation("Account", $"Le compte {oldAcc} n'existe pas."));
        if (oldAccount.IsSystem)
            return Result.Failure<int>(Error.Validation("Account", $"Le compte système {oldAcc} ne peut pas être remplacé."));

        var newAccount = await _chartOfAccounts.GetByAccountNumberAsync(newAcc, cancellationToken);
        if (newAccount is null)
            return Result.Failure<int>(Error.Validation("Account", $"Le compte {newAcc} n'existe pas."));
        if (!newAccount.IsActive)
            return Result.Failure<int>(Error.Validation("Account", $"Le compte {newAcc} est désactivé."));

        await using var ctx = _contextFactory.CreateContext();
        // Périodes OUVERTES uniquement (une écriture clôturée ne peut pas être modifiée).
        var affected = await ctx.JournalEntryLines
            .Where(l => l.AccountNumber == oldAcc && !l.JournalEntry.AccountingPeriod!.IsClosed)
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.AccountNumber, newAcc), cancellationToken);

        return Result.Success(affected);
    }

    /// <summary>
    /// Résout le profil d'imputation comptable d'un cycle paie (plan §5.3). Avant la date de bascule
    /// (<see cref="AccountingSettings.PayrollAccountProfileEffectiveDate"/>) → <c>Legacy</c> (la
    /// réouverture→revalidation régénère les mêmes comptes qu'à l'origine) ; à partir de la date →
    /// le profil du dossier. Sans date de bascule, le profil configuré s'applique à tous les cycles.
    /// Délégué à <see cref="PayrollAccountingProfileSnapshot.ResolveForPeriod"/> (source unique
    /// partagée avec la simulation du journal de paie et l'écran de paramètres).
    /// </summary>
    private async Task<PayrollAccountingProfileSnapshot> GetPayrollProfileAsync(CancellationToken cancellationToken)
        => _payrollProfileResolver is null
            ? _settings.ToPayrollProfileSnapshot()
            : await _payrollProfileResolver.GetAsync(cancellationToken);

    public async Task<Result> GeneratePayrollRunEntryAsync(PayrollRun payrollRun, CancellationToken cancellationToken = default)
    {
        // R-18 (lifecycle) : un cycle validé sans écriture est pire qu'un échec explicite. On bloque
        // plutôt que de laisser une validation muette (le semis NCT01 rend le cas marginal).
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
        {
            return Result.Failure(Error.Validation(
                "ChartOfAccounts",
                "Aucun plan comptable — impossible de générer l'écriture de paie."));
        }

        // Idempotence : une écriture active suffit. Une écriture extournée (cycle rouvert) ne doit
        // pas bloquer la régénération, sinon la comptabilité resterait figée sur les anciens montants.
        var existing = await _journalEntries.GetActiveBySourceAsync(SourcePayrollRun, payrollRun.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var entryDate = new DateTime(payrollRun.Year, payrollRun.Month, 1).AddMonths(1).AddDays(-1);
        var periodResult = await _periodService.EnsureOpenPeriodAsync(entryDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var label = $"Paie {payrollRun.Month:D2}/{payrollRun.Year}";
        var currency = Money.DefaultCurrency;

        // Prefer payslip sum when loaded (covers cycles calculated before TotalOtherDeductions).
        var otherDeductions = payrollRun.Payslips.Count > 0
            ? Math.Round(payrollRun.Payslips.Sum(p => p.OtherDeductions), 3, MidpointRounding.AwayFromZero)
            : payrollRun.TotalOtherDeductions;

        var hasTypedDeductions = payrollRun.Payslips.Any(p =>
            p.Lines.Any(l => l.Kind == PayslipLineKind.Deduction && l.DeductionKind.HasValue));

        // Profil d'imputation par cycle (plan §5.3) : avant la date de bascule → Legacy (la
        // réouverture→revalidation régénère les mêmes comptes), à partir de la date → profil configuré.
        var payrollProfile = await GetPayrollProfileAsync(cancellationToken);
        var profile = payrollProfile.ResolveForPeriod(payrollRun.Year, payrollRun.Month);

        // B8 : une OD de reclassement corrige une écriture Legacy vers la cartographie SCE. En
        // régénérer une directement en SCE alors que la correction est encore active compterait
        // TFP/FOPROLOS deux fois. La réouverture extourne normalement le reclassement ; ce garde-fou
        // couvre le cas où il a été recréé entre-temps.
        if (profile == PayrollAccountProfile.Sce2026)
        {
            var activeReclassification = await _journalEntries.GetActiveBySourceAsync(
                SourcePayrollReclassification, payrollRun.Id, cancellationToken);
            if (activeReclassification is not null)
            {
                return Result.Failure(Error.Validation(
                    "PayrollReclassification",
                    $"Le cycle {payrollRun.Month:D2}/{payrollRun.Year} porte une OD de reclassement SCE active "
                    + $"(écriture #{activeReclassification.EntryNumber}). Extournez-la avant de régénérer "
                    + "l'écriture de paie : cumuler les deux compterait les taxes sur salaires deux fois."));
            }
        }

        var accountMap = payrollProfile.BuildAccountMap(profile);

        // H2 : la ventilation des gains par nature (rupture → 64602, avantage en nature → 6404) ne doit
        // pas dépendre de la présence de retenues typées. Un cycle de rupture (ou d'avantage en nature)
        // sans avance/prêt/saisie/mutuelle tombait auparavant sur le chemin agrégé qui passait
        // totalTerminationIndemnities = 0 → indemnité de rupture au 640. On dérive désormais les
        // montants des lignes figées des bulletins et on les passe aussi au chemin agrégé. Pour un
        // vrai cycle Legacy (EarningKind null) les résolveurs renvoient 0 → comportement historique
        // préservé byte-à-byte.
        var terminationFromRun = payrollRun.Payslips.Count > 0
            ? PayrollJournalEntryBuilder.ResolveTerminationIndemnities(payrollRun, profile)
            : 0m;
        var inKindFromRun = payrollRun.Payslips.Count > 0
            ? PayrollJournalEntryBuilder.ResolveInKindBenefits(payrollRun)
            : 0m;

        // Ventilation optionnelle du débit 640 en 6400/6401/6402/6409 (R-31). Éteinte, la liste est
        // nulle et le débit reste sur le compte collectif — comportement par défaut inchangé.
        var salaryDebits = payrollProfile.DetailedSalarySplitEnabled && payrollRun.Payslips.Count > 0
            ? PayrollJournalEntryBuilder.ResolveSalaryDebits(payrollRun)
            : null;

        // Le compte auxiliaire est figé sur le bulletin à la validation du cycle. S'il manque — cycle
        // antérieur au figeage, ou dossier dont la renumérotation des comptes trop longs est restée
        // bloquée — on retombe sur la **ligne 425 agrégée** plutôt que de dériver un numéro du
        // matricule : la dérivation produisait 10 chiffres et pouvait confondre deux salariés.
        // L'agrégat reste une imputation juste, et le règlement suit la maille de la dette.
        var auxiliaryCredits = payrollProfile.EmployeeAuxiliaryEnabled && payrollRun.Payslips.Count > 0
            ? payrollRun.Payslips
                .Where(p => p.NetSalary > 0)
                .Select(p => new PayrollJournalEntryBuilder.EmployeeAuxiliaryCredit(
                    p.EmployeeId,
                    p.EmployeeName,
                    p.EmployeeAuxiliaryAccount ?? string.Empty,
                    p.NetSalary))
                .ToList()
            : null;

        if (auxiliaryCredits is { Count: > 0 }
            && auxiliaryCredits.Any(c => string.IsNullOrWhiteSpace(c.AuxiliaryAccount)))
        {
            _logger.LogWarning(
                "Cycle de paie {Year}-{Month:D2} : {Count} bulletin(s) sans compte auxiliaire figé — "
                + "l'écriture crédite le compte collectif {Account} au lieu d'un compte par salarié.",
                payrollRun.Year,
                payrollRun.Month,
                auxiliaryCredits.Count(c => string.IsNullOrWhiteSpace(c.AuxiliaryAccount)),
                PayrollJournalEntryBuilder.PersonnelPayableAccount);

            auxiliaryCredits = null;
        }

        var linesResult = hasTypedDeductions
            ? PayrollJournalEntryBuilder.BuildLinesFromRun(payrollRun, label, accountMap, auxiliaryCredits, profile, salaryDebits)
            : payrollProfile.EmployeeAuxiliaryEnabled && auxiliaryCredits is { Count: > 0 }
                ? PayrollJournalEntryBuilder.BuildLines(
                    payrollRun.TotalGross,
                    payrollRun.TotalNet,
                    payrollRun.TotalCnssEmployee,
                    payrollRun.TotalCnssEmployer,
                    payrollRun.TotalIrpp,
                    payrollRun.TotalCss,
                    payrollRun.TotalTfp,
                    payrollRun.TotalFoprolos,
                    payrollRun.TotalWorkAccident,
                    otherDeductions,
                    label,
                    auxiliaryCredits,
                    payrollRun.TotalIrppRegularization,
                    payrollRun.TotalCssRegularization,
                    payrollRun.TotalCssEmployer,
                    terminationFromRun,
                    inKindFromRun,
                    profile,
                    salaryDebits)
                : PayrollJournalEntryBuilder.BuildLines(
                    payrollRun.TotalGross,
                    payrollRun.TotalNet,
                    payrollRun.TotalCnssEmployee,
                    payrollRun.TotalCnssEmployer,
                    payrollRun.TotalIrpp,
                    payrollRun.TotalCss,
                    payrollRun.TotalTfp,
                    payrollRun.TotalFoprolos,
                    payrollRun.TotalWorkAccident,
                    otherDeductions,
                    label,
                    payrollRun.TotalIrppRegularization,
                    payrollRun.TotalCssRegularization,
                    payrollRun.TotalCssEmployer,
                    terminationFromRun,
                    inKindFromRun,
                    profile,
                    salaryDebits);
        if (linesResult.IsFailure)
            return Result.Failure(linesResult.Error);

        var lines = linesResult.Value;

        // Les comptes auxiliaires salariés sont créés ici, typés et nommés, avant le filet générique
        // d'auto-création : celui-ci les produirait en comptes généraux au libellé « <parent> — <numéro> »,
        // inexploitables comme tiers (plan tiers, FEC, états auxiliaires).
        if (auxiliaryCredits is { Count: > 0 })
            await EnsureEmployeeAuxiliaryAccountsAsync(auxiliaryCredits, cancellationToken);

        var accountValidation = await ValidateAccountsExistAsync(lines, "PayrollRun", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var n = await _journalEntries.ReserveNextEntryNumberAsync("JOD", payrollRun.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            "JOD",
            entryDate,
            label,
            period.Id,
            true,
            SourcePayrollRun,
            payrollRun.Id,
            lines,
            currency,
            pieceRef: $"PAIE-{payrollRun.Year}-{payrollRun.Month:D2}",
            pieceDate: entryDate);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// Crée les comptes auxiliaires 425xxxx manquants, marqués auxiliaires et rattachés au collectif
    /// 425, avec le nom du salarié pour libellé.
    /// </summary>
    /// <remarks>
    /// Sans cela, <see cref="TryAutoCreateSubAccountAsync"/> les crée en comptes généraux au libellé
    /// « Personnel - rémunérations dues — 4256854545 » : le plan tiers ne les reconnaît pas, le FEC
    /// n'a pas de nom de tiers à exporter et la balance auxiliaire reste muette. Les comptes déjà
    /// présents ne sont pas modifiés — un compte mouvementé ne se requalifie pas au passage d'une
    /// écriture ; le runbook <c>docs/runbooks/sql/RequalifyPayrollAuxiliaryAccounts.idempotent.sql</c>
    /// s'en charge à la demande.
    /// </remarks>
    private async Task EnsureEmployeeAuxiliaryAccountsAsync(
        IReadOnlyList<PayrollJournalEntryBuilder.EmployeeAuxiliaryCredit> credits,
        CancellationToken cancellationToken)
    {
        var parent = await _chartOfAccounts.GetByAccountNumberAsync(
            PayrollJournalEntryBuilder.PersonnelPayableAccount, cancellationToken);

        // Sans compte collectif 425, rien à rattacher : on laisse le filet générique opérer.
        if (parent is null || !parent.IsActive)
            return;

        foreach (var credit in credits.DistinctBy(c => c.AuxiliaryAccount, StringComparer.Ordinal))
        {
            var account = credit.AuxiliaryAccount?.Trim();
            if (string.IsNullOrEmpty(account)
                || string.Equals(account, parent.AccountNumber, StringComparison.Ordinal))
            {
                continue;
            }

            if (await _chartOfAccounts.GetByAccountNumberAsync(account, cancellationToken) is not null)
                continue;

            var label = string.IsNullOrWhiteSpace(credit.EmployeeName)
                ? $"{parent.Label} — {account}"
                : credit.EmployeeName.Trim();

            var created = ChartOfAccount.Create(
                account,
                label,
                parent.AccountClass,
                parent.AccountNumber,
                parent.NatureType,
                isSystem: false,
                accountType: AccountType.Other,
                isAuxiliary: true,
                affectationAccountNumber: parent.AccountNumber);

            if (created.IsFailure)
            {
                // On n'échoue pas ici : le filet générique reprendra la main à la validation des
                // comptes, et c'est lui qui produira l'erreur si le compte reste introuvable.
                _logger.LogWarning(
                    "Compte auxiliaire salarié {AccountNumber} non créé : {Error}",
                    account, created.Error.Description);
                continue;
            }

            created.Value.SetAuditInfo("system");
            await _chartOfAccounts.AddAsync(created.Value, cancellationToken);

            _logger.LogInformation(
                "Created employee auxiliary account {AccountNumber} ({Label}) under {Parent}",
                account, label, parent.AccountNumber);
        }
    }

    public async Task<Result> ReversePayrollRunEntryAsync(
        Guid payrollRunId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        // R-18 (lifecycle) : symétrique de la génération — on échoue plutôt que de silencieusement
        // ignorer une réouverture sur un dossier sans plan comptable.
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
        {
            return Result.Failure(Error.Validation(
                "ChartOfAccounts",
                "Aucun plan comptable — impossible d'extourner l'écriture de paie."));
        }

        // R-19 : anti-double-extourne. Une écriture d'annulation active (cycle rouvert) ne doit pas
        // être recréée — sinon une double réouverture produirait deux écritures d'annulation.
        var existingReversal = await _journalEntries.GetBySourceAsync(
            SourcePayrollRunCancelled, payrollRunId, cancellationToken);
        if (existingReversal is not null)
            return Result.Success();

        // B8 : le reclassement corrige l'OD d'origine. Il doit disparaître avec elle, sinon la
        // revalidation produirait une OD (éventuellement déjà conforme) par-dessus une correction
        // toujours active — TFP/FOPROLOS reclassés deux fois.
        var reclassReversal = await ReversePayrollReclassificationEntryAsync(payrollRunId, reason, cancellationToken);
        if (reclassReversal.IsFailure)
            return reclassReversal;

        var original = await _journalEntries.GetActiveBySourceAsync(SourcePayrollRun, payrollRunId, cancellationToken);
        if (original is null)
            return Result.Success();

        // Brouillon : suppression pure, la revalidation régénérera une écriture propre.
        if (original.IsDraft)
        {
            await _journalEntries.RemoveAsync(original, cancellationToken);
            return Result.Success();
        }

        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }

        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var firstLine = original.Lines.First();
        var currency = firstLine.DebitAmount.Amount > 0
            ? firstLine.DebitAmount.Currency
            : firstLine.CreditAmount.Currency;

        var revLines = original.Lines
            .OrderBy(l => l.LineNumber)
            .Select(l => new JournalLineInput(
                l.AccountNumber,
                l.Label,
                l.CreditAmount.Amount,
                l.DebitAmount.Amount,
                l.ThirdPartyId,
                l.ThirdPartyKind))
            .ToList();

        var journal = original.JournalCode;
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            reversalDate,
            $"Annulation écriture de paie — {reason.Trim()}",
            period.Id,
            true,
            SourcePayrollRunCancelled,
            payrollRunId,
            revLines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var reversal = create.Value;
        reversal.MarkInitialStatus(NewEntryStatus);
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);
        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);
        return Result.Success();
    }

    // ── Décaissement des avances et prêts salariés ──────────────────────────────────────────────
    // Sans ces écritures, le versement d'une avance ne laisse aucune trace comptable : la retenue
    // opérée le mois suivant crédite 421 sans contrepartie, et ce compte d'actif reste durablement
    // créditeur. Les deux générateurs sont derrière le drapeau de décaissement du dossier (éteint
    // par défaut) : un dossier qui saisit ses OD à la main ne voit strictement aucun changement.

    public Task<Result> GenerateEmployeeAdvanceDisbursementEntryAsync(
        EmployeeAdvance advance,
        string? employeeName,
        PaymentMethod method,
        BankAccount? bankAccount,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(advance);

        var who = string.IsNullOrWhiteSpace(employeeName) ? string.Empty : $" — {employeeName.Trim()}";
        return GeneratePayrollDisbursementEntryAsync(
            SourceEmployeeAdvance,
            advance.Id,
            debitAccount: PayrollJournalEntryBuilder.AdvancesAccount,
            amount: advance.Amount,
            entryDate: advance.Date.Date,
            label: $"Avance sur salaire{who}",
            pieceRef: $"AVANCE-{advance.Date:yyyyMMdd}-{advance.Id.ToString("N")[..8].ToUpperInvariant()}",
            method,
            bankAccount,
            cancellationToken);
    }

    public Task<Result> ReverseEmployeeAdvanceDisbursementEntryAsync(
        Guid advanceId,
        string reason,
        CancellationToken cancellationToken = default) =>
        ReversePayrollDisbursementEntryAsync(
            SourceEmployeeAdvance, SourceEmployeeAdvanceCancelled, advanceId,
            "Annulation du décaissement d'avance", reason, cancellationToken);

    public async Task<Result> GenerateEmployeeLoanDisbursementEntryAsync(
        EmployeeLoan loan,
        string? employeeName,
        DateTime disbursementDate,
        PaymentMethod method,
        BankAccount? bankAccount,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(loan);

        // Le compte de prêts est paramétrable par dossier (421.1 par défaut) : on le lit sur la
        // carte de comptes plutôt que de figer une constante.
        var payrollProfile = await GetPayrollProfileAsync(cancellationToken);
        var loansAccount = payrollProfile
            .BuildAccountMap(payrollProfile.Profile)
            .LoansAccount;

        var who = string.IsNullOrWhiteSpace(employeeName) ? string.Empty : $" — {employeeName.Trim()}";
        return await GeneratePayrollDisbursementEntryAsync(
            SourceEmployeeLoan,
            loan.Id,
            debitAccount: loansAccount,
            amount: loan.Principal,
            entryDate: disbursementDate.Date,
            label: $"Prêt salarié {loan.Reference}{who}",
            pieceRef: $"PRET-{loan.Reference}",
            method,
            bankAccount,
            cancellationToken);
    }

    public Task<Result> ReverseEmployeeLoanDisbursementEntryAsync(
        Guid loanId,
        string reason,
        CancellationToken cancellationToken = default) =>
        ReversePayrollDisbursementEntryAsync(
            SourceEmployeeLoan, SourceEmployeeLoanCancelled, loanId,
            "Annulation du décaissement de prêt salarié", reason, cancellationToken);

    /// <summary>
    /// Noyau commun des décaissements avance / prêt : débit du compte de créance sur le salarié,
    /// crédit de la trésorerie. Idempotent par source, no-op quand le drapeau du dossier est éteint.
    /// </summary>
    private async Task<Result> GeneratePayrollDisbursementEntryAsync(
        string sourceType,
        Guid sourceId,
        string debitAccount,
        decimal amount,
        DateTime entryDate,
        string label,
        string pieceRef,
        PaymentMethod method,
        BankAccount? bankAccount,
        CancellationToken cancellationToken)
    {
        var payrollProfile = await GetPayrollProfileAsync(cancellationToken);
        if (!payrollProfile.DisbursementEntriesEnabled)
            return Result.Success();

        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        // Idempotence : une écriture existante (même extournée) suffit à ne pas en recréer une.
        var existing = await _journalEntries.GetBySourceAsync(sourceType, sourceId, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var rounded = Math.Round(amount, 3, MidpointRounding.AwayFromZero);
        if (rounded <= 0)
            return Result.Success();

        var periodResult = await _periodService.EnsureOpenPeriodAsync(entryDate, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var creditAccount = method == PaymentMethod.Cash
            ? TreasuryAccount(PaymentMethod.Cash)
            : (bankAccount?.ChartOfAccountNumber ?? TreasuryAccount(method));

        // ThirdPartyKind.None, comme le crédit 421 de l'OD de paie : 421 et 421.1 sont des comptes
        // collectifs, sans auxiliaire par salarié. Les deux jambes se rapprochent donc sur le même
        // compte, et le FEC n'exporte pas un code auxiliaire qui n'existe pas.
        var lines = new List<JournalLineInput>
        {
            new(debitAccount, label, rounded, 0, null, ThirdPartyKind.None),
            new(creditAccount, label, 0, rounded, null, ThirdPartyKind.None)
        };

        var accountValidation = await ValidateAccountsExistAsync(lines, sourceType, cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var journal = method == PaymentMethod.Cash ? "JC" : BankJournalCode;
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, entryDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            entryDate,
            label,
            periodResult.Value.Id,
            true,
            sourceType,
            sourceId,
            lines,
            Money.DefaultCurrency,
            pieceRef: pieceRef,
            pieceDate: entryDate);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// Extourne commune des décaissements avance / prêt : suppression si l'écriture est encore au
    /// brouillon, contre-passation sinon. Anti-double-extourne par type source d'annulation.
    /// </summary>
    private async Task<Result> ReversePayrollDisbursementEntryAsync(
        string sourceType,
        string cancelledSourceType,
        Guid sourceId,
        string labelPrefix,
        string reason,
        CancellationToken cancellationToken)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existingReversal = await _journalEntries.GetBySourceAsync(
            cancelledSourceType, sourceId, cancellationToken);
        if (existingReversal is not null)
            return Result.Success();

        var original = await _journalEntries.GetActiveBySourceAsync(sourceType, sourceId, cancellationToken);
        if (original is null)
            return Result.Success();

        if (original.IsDraft)
        {
            await _journalEntries.RemoveAsync(original, cancellationToken);
            return Result.Success();
        }

        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }

        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var firstLine = original.Lines.First();
        var currency = firstLine.DebitAmount.Amount > 0
            ? firstLine.DebitAmount.Currency
            : firstLine.CreditAmount.Currency;

        var revLines = original.Lines
            .OrderBy(l => l.LineNumber)
            .Select(l => new JournalLineInput(
                l.AccountNumber,
                l.Label,
                l.CreditAmount.Amount,
                l.DebitAmount.Amount,
                l.ThirdPartyId,
                l.ThirdPartyKind))
            .ToList();

        var n = await _journalEntries.ReserveNextEntryNumberAsync(
            original.JournalCode, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            original.JournalCode,
            reversalDate,
            $"{labelPrefix} — {reason.Trim()}",
            periodResult.Value.Id,
            true,
            cancelledSourceType,
            sourceId,
            revLines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var reversal = create.Value;
        reversal.MarkInitialStatus(NewEntryStatus);
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);
        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// Extourne l'OD de reclassement SCE active d'un cycle, s'il en existe une. Appelée à la
    /// réouverture, avant l'extourne de l'OD d'origine. Sans effet (succès) quand le cycle n'a
    /// jamais été reclassé — le cas de très loin le plus fréquent.
    /// </summary>
    private async Task<Result> ReversePayrollReclassificationEntryAsync(
        Guid payrollRunId,
        string reason,
        CancellationToken cancellationToken)
    {
        // Anti-double-extourne, symétrique de celle de l'OD de paie.
        var existingReversal = await _journalEntries.GetBySourceAsync(
            SourcePayrollReclassificationCancelled, payrollRunId, cancellationToken);
        if (existingReversal is not null)
            return Result.Success();

        var original = await _journalEntries.GetActiveBySourceAsync(
            SourcePayrollReclassification, payrollRunId, cancellationToken);
        if (original is null)
            return Result.Success();

        if (original.IsDraft)
        {
            await _journalEntries.RemoveAsync(original, cancellationToken);
            return Result.Success();
        }

        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }

        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var firstLine = original.Lines.First();
        var currency = firstLine.DebitAmount.Amount > 0
            ? firstLine.DebitAmount.Currency
            : firstLine.CreditAmount.Currency;

        var revLines = original.Lines
            .OrderBy(l => l.LineNumber)
            .Select(l => new JournalLineInput(
                l.AccountNumber,
                l.Label,
                l.CreditAmount.Amount,
                l.DebitAmount.Amount,
                l.ThirdPartyId,
                l.ThirdPartyKind))
            .ToList();

        var n = await _journalEntries.ReserveNextEntryNumberAsync(
            original.JournalCode, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            original.JournalCode,
            reversalDate,
            $"Annulation du reclassement de paie — {reason.Trim()}",
            periodResult.Value.Id,
            true,
            SourcePayrollReclassificationCancelled,
            payrollRunId,
            revLines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var reversal = create.Value;
        reversal.MarkInitialStatus(NewEntryStatus);
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);
        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> EnsurePayrollRunEntryPostedAsync(
        Guid payrollRunId,
        string validatedBy,
        CancellationToken cancellationToken = default)
    {
        // R-33 (lifecycle) : à la clôture d'un cycle en mode Brouillard, l'OD encore au brouillon est
        // validée — un cycle clôturé ne doit pas laisser une écriture brouillon modifiable et dont le
        // cycle n'est plus reopenable. No-op si l'écriture est déjà validée ou inexistante.
        var entry = await _journalEntries.GetActiveBySourceAsync(SourcePayrollRun, payrollRunId, cancellationToken);
        if (entry is null || !entry.IsDraft)
            return Result.Success();

        var result = entry.Validate(validatedBy);
        if (result.IsFailure)
            return result;

        await _journalEntries.UpdateAsync(entry, cancellationToken);

        if (_audit is not null)
        {
            try
            {
                await _audit.LogAsync(
                    action: "PayrollRunEntryAutoPosted",
                    entityType: "JournalEntry",
                    entityId: entry.Id,
                    oldValues: null,
                    newValues: new { entry.JournalCode, entry.EntryNumber, payrollRunId },
                    cancellationToken: cancellationToken);
            }
            catch (Exception ex)
            {
                // L'audit ne doit jamais faire échouer la clôture.
                _logger.LogError(ex, "Failed to log audit event for auto-posted payroll run OD {EntryId}", entry.Id);
            }
        }

        return Result.Success();
    }

    public async Task<Result> GeneratePayrollPaymentEntryAsync(
        PayrollPayment payment,
        PayrollRun payrollRun,
        BankAccount? bankAccount,
        CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(SourcePayrollPayment, payment.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var date = payment.PaymentDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(date, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = payment.Amount.Currency;
        var creditAccount = payment.Method == PaymentMethod.Cash
            ? TreasuryAccount(PaymentMethod.Cash)
            : (bankAccount?.ChartOfAccountNumber ?? TreasuryAccount(payment.Method));
        var label = $"Paiement paie {payrollRun.Month:D2}/{payrollRun.Year}";
        var total = payment.Amount.Amount;

        // Le règlement doit débiter le compte sur lequel la dette a été constatée. Les cycles
        // validés avant les comptes auxiliaires portent un crédit 425 agrégé (sans tiers) : y
        // opposer des débits 425xxxx rendrait le lettrage impossible (groupe multi-comptes).
        var runEntry = await _journalEntries.GetActiveBySourceAsync(SourcePayrollRun, payrollRun.Id, cancellationToken);

        var hasAuxiliaryCredits = runEntry?.Lines.Any(l =>
            l.CreditAmount.Amount > 0 && l.ThirdPartyKind == ThirdPartyKind.Employee) == true;

        var aggregatedCredit = hasAuxiliaryCredits
            ? null
            : runEntry?.Lines.FirstOrDefault(l =>
                l.AccountNumber.StartsWith(PayrollJournalEntryBuilder.PersonnelPayableAccount, StringComparison.Ordinal)
                && l.CreditAmount.Amount > 0
                && l.ThirdPartyKind == ThirdPartyKind.None);

        var lines = new List<JournalLineInput>();

        if (aggregatedCredit is not null)
        {
            // Miroir du format historique : une seule ligne de débit, sur le compte exact de l'OD.
            lines.Add(new JournalLineInput(
                aggregatedCredit.AccountNumber,
                label,
                total,
                0,
                null,
                ThirdPartyKind.None));
        }
        else
        {
            // Le règlement porte le nom du salarié, comme l'OD d'engagement : un même tiers doit
            // apparaître sous le même libellé des deux côtés du lettrage et dans le FEC. Repli sur
            // le numéro de compte si le bulletin n'est pas chargé.
            var employeeNames = payrollRun.Payslips
                .GroupBy(p => p.EmployeeId)
                .ToDictionary(g => g.Key, g => g.First().EmployeeName);

            foreach (var line in payment.Lines)
            {
                var who = employeeNames.TryGetValue(line.EmployeeId, out var name) && !string.IsNullOrWhiteSpace(name)
                    ? name
                    : line.EmployeeAuxiliaryAccount;

                lines.Add(new JournalLineInput(
                    line.EmployeeAuxiliaryAccount,
                    $"{label} — {who}",
                    line.Amount.Amount,
                    0,
                    line.EmployeeId,
                    ThirdPartyKind.Employee));
            }
        }

        lines.Add(new JournalLineInput(
            creditAccount,
            label,
            0,
            total,
            null,
            ThirdPartyKind.None));

        var accountValidation = await ValidateAccountsExistAsync(lines, "PayrollPayment", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var journal = payment.Method == PaymentMethod.Cash ? "JC" : BankJournalCode;
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, date.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            date,
            label,
            period.Id,
            true,
            SourcePayrollPayment,
            payment.Id,
            lines,
            currency,
            pieceRef: $"PAIE-PAY-{payrollRun.Year}-{payrollRun.Month:D2}",
            pieceDate: date);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReversePayrollPaymentEntryAsync(
        Guid payrollPaymentId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existingReversal = await _journalEntries.GetBySourceAsync(
            SourcePayrollPaymentCancelled, payrollPaymentId, cancellationToken);
        if (existingReversal is not null)
            return Result.Success();

        var original = await _journalEntries.GetBySourceAsync(SourcePayrollPayment, payrollPaymentId, cancellationToken);
        if (original is null)
            return Result.Success();

        if (original.IsDraft)
        {
            await _journalEntries.RemoveAsync(original, cancellationToken);
            return Result.Success();
        }

        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }

        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var firstLine = original.Lines.First();
        var currency = firstLine.DebitAmount.Amount > 0
            ? firstLine.DebitAmount.Currency
            : firstLine.CreditAmount.Currency;

        var revLines = original.Lines
            .OrderBy(l => l.LineNumber)
            .Select(l => new JournalLineInput(
                l.AccountNumber,
                l.Label,
                l.CreditAmount.Amount,
                l.DebitAmount.Amount,
                l.ThirdPartyId,
                l.ThirdPartyKind))
            .ToList();

        var journal = original.JournalCode;
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            reversalDate,
            $"Annulation paiement paie — {reason.Trim()}",
            period.Id,
            true,
            SourcePayrollPaymentCancelled,
            payrollPaymentId,
            revLines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var reversal = create.Value;
        reversal.MarkInitialStatus(NewEntryStatus);
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);
        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GenerateCnssContributionPaymentEntryAsync(
        CnssContributionPayment payment,
        BankAccount? bankAccount,
        CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existing = await _journalEntries.GetBySourceAsync(
            SourceCnssContributionPayment, payment.Id, cancellationToken);
        if (existing is not null)
            return Result.Success();

        var date = payment.PaymentDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(date, cancellationToken);
        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var currency = payment.Amount.Currency;
        var creditAccount = payment.Method == PaymentMethod.Cash
            ? TreasuryAccount(PaymentMethod.Cash)
            : (bankAccount?.ChartOfAccountNumber ?? TreasuryAccount(payment.Method));
        var label = $"Versement CNSS {payment.Month:D2}/{payment.Year}";

        var linesResult = CnssContributionPaymentJournalBuilder.BuildPaymentLines(
            payment.Amount.Amount, label, creditAccount);
        if (linesResult.IsFailure)
            return Result.Failure(linesResult.Error);

        var accountValidation = await ValidateAccountsExistAsync(linesResult.Value, "CnssContributionPayment", cancellationToken);
        if (accountValidation.IsFailure)
            return accountValidation;

        var journal = payment.Method == PaymentMethod.Cash ? "JC" : BankJournalCode;
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, date.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            date,
            label,
            period.Id,
            true,
            SourceCnssContributionPayment,
            payment.Id,
            linesResult.Value,
            currency,
            pieceRef: $"CNSS-{payment.Year}-{payment.Month:D2}",
            pieceDate: date);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReverseCnssContributionPaymentEntryAsync(
        Guid cnssContributionPaymentId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
            return Result.Success();

        var existingReversal = await _journalEntries.GetBySourceAsync(
            SourceCnssContributionPaymentCancelled, cnssContributionPaymentId, cancellationToken);
        if (existingReversal is not null)
            return Result.Success();

        var original = await _journalEntries.GetBySourceAsync(
            SourceCnssContributionPayment, cnssContributionPaymentId, cancellationToken);
        if (original is null)
            return Result.Success();

        if (original.IsDraft)
        {
            await _journalEntries.RemoveAsync(original, cancellationToken);
            return Result.Success();
        }

        var reversalDate = original.EntryDate;
        var periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            reversalDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(reversalDate, cancellationToken);
        }

        if (periodResult.IsFailure)
            return Result.Failure(periodResult.Error);

        var period = periodResult.Value;
        var firstLine = original.Lines.First();
        var currency = firstLine.DebitAmount.Amount > 0
            ? firstLine.DebitAmount.Currency
            : firstLine.CreditAmount.Currency;

        var revLines = original.Lines
            .OrderBy(l => l.LineNumber)
            .Select(l => new JournalLineInput(
                l.AccountNumber,
                l.Label,
                l.CreditAmount.Amount,
                l.DebitAmount.Amount,
                l.ThirdPartyId,
                l.ThirdPartyKind))
            .ToList();

        var journal = original.JournalCode;
        var n = await _journalEntries.ReserveNextEntryNumberAsync(journal, reversalDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            journal,
            reversalDate,
            $"Annulation versement CNSS — {reason.Trim()}",
            period.Id,
            true,
            SourceCnssContributionPaymentCancelled,
            cnssContributionPaymentId,
            revLines,
            currency);

        if (create.IsFailure)
            return Result.Failure(create.Error);

        var reversal = create.Value;
        reversal.MarkInitialStatus(NewEntryStatus);
        reversal.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(reversal, cancellationToken);
        original.MarkReversedBy(reversal.Id);
        await _journalEntries.UpdateAsync(original, cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// OD de reclassement SCE paie (plan §5.2.1 / WS-5). Une seule écriture de correction par cycle,
    /// déterministe depuis les totaux figés + lignes de l'OD legacy. Idempotente : refuse de
    /// s'exécuter deux fois tant qu'une écriture active existe.
    /// </summary>
    public async Task<Result<Guid>> GeneratePayrollReclassificationEntryAsync(
        PayrollRun payrollRun,
        CancellationToken cancellationToken = default)
    {
        if (await _chartOfAccounts.CountAsync(cancellationToken) == 0)
        {
            return Result.Failure<Guid>(Error.Validation(
                "ChartOfAccounts",
                "Aucun plan comptable — impossible de générer l'OD de reclassement."));
        }

        static decimal R(decimal v) => Math.Round(v, 3, MidpointRounding.AwayFromZero);

        // Idempotence / refus du double reclassement : une écriture active suffit à refuser.
        var existing = await _journalEntries.GetActiveBySourceAsync(
            SourcePayrollReclassification, payrollRun.Id, cancellationToken);
        if (existing is not null)
        {
            return Result.Failure<Guid>(Error.Validation(
                "ReclassementPayrollRun",
                $"Un reclassement existe déjà pour le cycle {payrollRun.Month:D2}/{payrollRun.Year} (écriture #{existing.EntryNumber}). " +
                "Extournez-le d'abord pour en générer un nouveau."));
        }

        // L'OD legacy (SourcePayrollRun) est la source de vérité pour les montants effectivement
        // comptabilisés sur 641 (indemnités) et 421 (compensation AN) — non portés par les totaux.
        var legacy = await _journalEntries.GetActiveBySourceAsync(
            SourcePayrollRun, payrollRun.Id, cancellationToken);
        if (legacy is null)
        {
            return Result.Failure<Guid>(Error.Validation(
                "PayrollRunEntry",
                $"Aucune écriture de paie active pour le cycle {payrollRun.Month:D2}/{payrollRun.Year} — " +
                "rien à reclasser. Génère d'abord l'écriture manquante si besoin."));
        }

        var tfp = R(payrollRun.TotalTfp);
        var foprolos = R(payrollRun.TotalFoprolos);
        var cssPat = R(payrollRun.TotalCssEmployer);

        // M1 : les montants à reclasser se déduisent des lignes figées des bulletins (EarningKind),
        // non des sommes brutes des comptes legacy. Sous Legacy, le 641 mêlait indemnités ordinaires
        // ET indemnités de rupture, et le 421 mêlait la compensation d'avantage en nature ET les
        // avances (« autres retenues »). Reclasser l'intégralité du 641 → 640 laissait la rupture au
        // 640 (au lieu de 64602) ; reclasser l'intégralité du 421 → 4386 corrompait la créance d'avance.
        // On sépare donc à partir des bulletins :
        //  - rupture (EarningKind.TerminationIndemnity, repli libellé « Indemnité ») : 641 → 64602 ;
        //  - indemnités ordinaires (le reliquat du 641) : 641 → 640 ;
        //  - compensation AN (retenue typée InKindBenefitOffset) : 421 → 4386, les avances restent au 421.
        var indemnites641 = R(legacy.Lines.Where(l => l.AccountNumber == PayrollJournalEntryBuilder.IndemnityAccount)
            .Sum(l => l.DebitAmount.Amount));
        var posted421Credits = R(legacy.Lines.Where(l => l.AccountNumber == PayrollJournalEntryBuilder.AdvancesAccount)
            .Sum(l => l.CreditAmount.Amount));

        var terminationFromRun = payrollRun.Payslips.Count > 0
            ? R(PayrollJournalEntryBuilder.ResolveTerminationIndemnities(payrollRun, PayrollAccountProfile.Sce2026))
            : 0m;
        var inKindOffsetFromRun = payrollRun.Payslips.Count > 0
            ? R(PayrollJournalEntryBuilder.ResolveInKindBenefitOffset(payrollRun))
            : 0m;

        // Le reclassement doit viser le compte de compensation réellement configuré pour le dossier,
        // sinon un dossier ayant surchargé PayrollInKindOffsetAccount verrait la correction atterrir
        // sur un compte qu'il n'utilise pas.
        var reclassProfile = await GetPayrollProfileAsync(cancellationToken);
        var inKindOffsetAccount = reclassProfile
            .BuildAccountMap(PayrollAccountProfile.Sce2026)
            .InKindBenefitOffsetAccount;

        // On ne peut pas reclasser plus que ce qui est effectivement comptabilisé au 641 / au 421.
        var terminationToReclass = R(Math.Min(terminationFromRun, indemnites641));
        var ordinaryToReclass = R(Math.Max(0m, indemnites641 - terminationToReclass));
        var inKindOffsetToReclass = R(Math.Min(inKindOffsetFromRun, posted421Credits));

        var label = $"Reclassement paie {payrollRun.Month:D2}/{payrollRun.Year} (migration SCE)";
        var lines = new List<JournalLineInput>();
        var suffix = $"{payrollRun.Month:D2}/{payrollRun.Year}";

        void Pair(string debitAccount, string creditAccount, decimal amount, string lineLabel)
        {
            if (amount == 0m) return;
            lines.Add(new JournalLineInput(debitAccount, $"{lineLabel} — Reclassement {suffix}", amount, 0, null, ThirdPartyKind.None));
            lines.Add(new JournalLineInput(creditAccount, $"{lineLabel} — Reclassement {suffix}", 0, amount, null, ThirdPartyKind.None));
        }

        // TFP/FOPROLOS : 647 → 6611/6612 (charges) et 432 → 437 (dette).
        Pair(PayrollJournalEntryBuilder.TfpExpenseAccount, PayrollJournalEntryBuilder.EmployerChargesAccount, tfp, "TFP");
        Pair(PayrollJournalEntryBuilder.FoprolosExpenseAccount, PayrollJournalEntryBuilder.EmployerChargesAccount, foprolos, "FOPROLOS");
        Pair(PayrollJournalEntryBuilder.StateWithholdingAccount, PayrollJournalEntryBuilder.PayrollTaxesPayableAccount,
            R(tfp + foprolos + cssPat), "Taxes sur salaires + CSS patronale");

        // Indemnités ordinaires : 641 → 640.
        Pair(PayrollJournalEntryBuilder.SalaryAccount, PayrollJournalEntryBuilder.IndemnityAccount, ordinaryToReclass, "Indemnités ordinaires");

        // Indemnités de rupture : 641 → 64602.
        Pair(PayrollJournalEntryBuilder.TerminationIndemnityAccount, PayrollJournalEntryBuilder.IndemnityAccount,
            terminationToReclass, "Indemnités de rupture");

        // Compensation avantage en nature : 421 (crédit fictif) → 4386 (à payer). Les avances restent au 421.
        Pair(PayrollJournalEntryBuilder.AdvancesAccount, inKindOffsetAccount,
            inKindOffsetToReclass, "Compensation avantage en nature");

        if (lines.Count < 2)
        {
            return Result.Failure<Guid>(Error.Validation(
                "ReclassementPayrollRun",
                $"Aucun écart d'imputation à reclasser pour le cycle {payrollRun.Month:D2}/{payrollRun.Year}."));
        }

        var accountValidation = await ValidateAccountsExistAsync(lines, "PayrollReclassification", cancellationToken);
        if (accountValidation.IsFailure)
            return Result.Failure<Guid>(accountValidation.Error);

        var entryDate = new DateTime(payrollRun.Year, payrollRun.Month, 1).AddMonths(1).AddDays(-1);
        var periodResult = await _periodService.EnsureOpenPeriodAsync(entryDate, cancellationToken);
        if (periodResult.IsFailure)
        {
            // Période close : on date la correction au premier jour ouvert (pratique « exercice antérieur »).
            entryDate = DateTime.UtcNow.Date;
            periodResult = await _periodService.EnsureOpenPeriodAsync(entryDate, cancellationToken);
        }
        if (periodResult.IsFailure)
            return Result.Failure<Guid>(periodResult.Error);

        var period = periodResult.Value;
        var currency = Money.DefaultCurrency;
        var pieceRef = $"RECLASS-{payrollRun.Year}-{payrollRun.Month:D2}";

        var n = await _journalEntries.ReserveNextEntryNumberAsync("JOD", entryDate.Year, cancellationToken);
        var create = JournalEntry.Create(
            n,
            "JOD",
            entryDate,
            label,
            period.Id,
            true,
            SourcePayrollReclassification,
            payrollRun.Id,
            lines,
            currency,
            pieceRef: pieceRef,
            pieceDate: new DateTime(payrollRun.Year, payrollRun.Month, 1).AddMonths(1).AddDays(-1));

        if (create.IsFailure)
            return Result.Failure<Guid>(create.Error);

        var entry = create.Value;
        entry.MarkInitialStatus(NewEntryStatus);
        entry.SetAuditInfo("system", false);
        await _journalEntries.AddAsync(entry, cancellationToken);

        _logger.LogInformation(
            "Generated payroll reclassification entry #{EntryNumber} for run {Year}-{Month:D2} ({LineCount} lines)",
            entry.EntryNumber, payrollRun.Year, payrollRun.Month, lines.Count);

        return Result.Success(entry.Id);
    }
}
