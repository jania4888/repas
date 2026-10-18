using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class AccountingDomainTests
{
    private const string Tnd = Money.DefaultCurrency;
    private static readonly Guid PeriodId = Guid.NewGuid();

    private static IReadOnlyList<JournalLineInput> BalancedLines(decimal amount = 100m) =>
        new[]
        {
            new JournalLineInput("4111", "Client", amount, 0, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Ventes", 0, amount, null, ThirdPartyKind.None)
        };

    #region JournalEntry

    [Fact]
    public void JournalEntry_Create_WithValidInput_ShouldSucceed()
    {
        var result = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Facture vente",
            PeriodId, true, "Invoice", Guid.NewGuid(), BalancedLines(), Tnd);

        Assert.True(result.IsSuccess);
        Assert.Equal("JV", result.Value.JournalCode);
        Assert.Equal(2, result.Value.Lines.Count);
    }

    [Fact]
    public void JournalEntry_Create_WithUnbalancedLines_ShouldFail()
    {
        var lines = new[]
        {
            new JournalLineInput("4111", "Client", 100m, 0, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Ventes", 0, 50m, null, ThirdPartyKind.None)
        };

        var result = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, lines);

        Assert.True(result.IsFailure);
        Assert.Contains("équilibrée", result.Error.Description);
    }

    [Fact]
    public void JournalEntry_Create_WithSingleLine_ShouldFail()
    {
        var lines = new[]
        {
            new JournalLineInput("4111", "Client", 100m, 0, null, ThirdPartyKind.None)
        };

        var result = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, lines);

        Assert.True(result.IsFailure);
        Assert.Contains("deux lignes", result.Error.Description);
    }

    [Fact]
    public void JournalEntry_Create_WithEmptyJournalCode_ShouldFail()
    {
        var result = JournalEntry.Create(1, "", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, BalancedLines());

        Assert.True(result.IsFailure);
        Assert.Contains("journal", result.Error.Description);
    }

    [Fact]
    public void JournalEntry_Create_WithEmptyLabel_ShouldFail()
    {
        var result = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "", PeriodId, false, null, null, BalancedLines());

        Assert.True(result.IsFailure);
        Assert.Contains("libellé", result.Error.Description);
    }

    [Fact]
    public void JournalEntry_Create_WithEmptyAccountNumber_ShouldFail()
    {
        var lines = new[]
        {
            new JournalLineInput("", "Client", 100m, 0, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Ventes", 0, 100m, null, ThirdPartyKind.None)
        };

        var result = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, lines);

        Assert.True(result.IsFailure);
        Assert.Contains("Compte", result.Error.Description);
    }

    [Fact]
    public void JournalEntry_Create_WithBothDebitAndCredit_ShouldFail()
    {
        var lines = new[]
        {
            new JournalLineInput("4111", "Client", 100m, 50m, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Ventes", 0, 50m, null, ThirdPartyKind.None)
        };

        var result = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, lines);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void JournalEntry_MarkReversedBy_SetsFlag()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, BalancedLines());
        Assert.True(entry.IsSuccess);

        var reversalId = Guid.NewGuid();
        entry.Value.MarkReversedBy(reversalId);

        Assert.True(entry.Value.IsReversed);
        Assert.Equal(reversalId, entry.Value.ReversedByEntryId);
    }

    #endregion

    #region Brouillard / validation (Phase 1)

    [Fact]
    public void JournalEntry_Create_DefaultStatus_IsValidee()
    {
        // Non-régression : sans initialStatus explicite, une écriture naît validée (comportement historique).
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, BalancedLines()).Value;

        Assert.Equal(JournalEntryStatus.Validee, entry.Status);
        Assert.False(entry.IsDraft);
    }

    [Fact]
    public void JournalEntry_Create_WithBrouillonStatus_IsDraft()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, true, null, null,
            BalancedLines(), Tnd, null, JournalEntryStatus.Brouillon).Value;

        Assert.Equal(JournalEntryStatus.Brouillon, entry.Status);
        Assert.True(entry.IsDraft);
    }

    [Fact]
    public void JournalEntry_MarkInitialStatus_SetsBrouillon()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, true, null, null, BalancedLines()).Value;

        entry.MarkInitialStatus(JournalEntryStatus.Brouillon);

        Assert.True(entry.IsDraft);
    }

    [Fact]
    public void JournalEntry_Validate_TransitionsDraftToValidee()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, true, null, null,
            BalancedLines(), Tnd, null, JournalEntryStatus.Brouillon).Value;

        var result = entry.Validate("expert@cabinet.tn");

        Assert.True(result.IsSuccess);
        Assert.Equal(JournalEntryStatus.Validee, entry.Status);
        Assert.NotNull(entry.ValidatedAt);
        Assert.Equal("expert@cabinet.tn", entry.ValidatedBy);
    }

    [Fact]
    public void JournalEntry_Validate_WhenAlreadyValidee_IsIdempotent()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, BalancedLines()).Value;

        var result = entry.Validate("expert@cabinet.tn");

        Assert.True(result.IsSuccess);
        Assert.Equal(JournalEntryStatus.Validee, entry.Status);
    }

    [Fact]
    public void JournalEntry_UpdateDraftLines_OnDraft_ReplacesLinesAndLabel()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Ancien", PeriodId, true, null, null,
            BalancedLines(100m), Tnd, null, JournalEntryStatus.Brouillon).Value;

        var result = entry.UpdateDraftLines("Nouveau", BalancedLines(250m));

        Assert.True(result.IsSuccess);
        Assert.Equal("Nouveau", entry.Label);
        Assert.Equal(250m, entry.Lines.First().DebitAmount.Amount);
    }

    [Fact]
    public void JournalEntry_UpdateDraftLines_OnValidee_Fails()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, false, null, null, BalancedLines()).Value;

        var result = entry.UpdateDraftLines("Nouveau", BalancedLines(250m));

        Assert.True(result.IsFailure);
        Assert.Contains("brouillon", result.Error.Description);
    }

    [Fact]
    public void JournalEntry_UpdateDraftLines_WithUnbalancedLines_Fails()
    {
        var entry = JournalEntry.Create(1, "JV", DateTime.UtcNow.Date, "Test", PeriodId, true, null, null,
            BalancedLines(), Tnd, null, JournalEntryStatus.Brouillon).Value;

        var unbalanced = new[]
        {
            new JournalLineInput("4111", "Client", 100m, 0, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Ventes", 0, 50m, null, ThirdPartyKind.None)
        };

        var result = entry.UpdateDraftLines("Test", unbalanced);

        Assert.True(result.IsFailure);
        Assert.Contains("équilibrée", result.Error.Description);
    }

    #endregion

    #region Journal (catalogue)

    [Fact]
    public void Journal_Create_Valid_Succeeds()
    {
        var result = Journal.Create("JX", "Journal test", null, isSystem: false);
        Assert.True(result.IsSuccess);
        Assert.Equal("JX", result.Value.Code);
        Assert.True(result.Value.IsActive);
        Assert.False(result.Value.IsSystem);
    }

    [Fact]
    public void Journal_Create_EmptyCode_Fails()
    {
        var result = Journal.Create("", "Journal test", null);
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Journal_Deactivate_System_StaysActive()
    {
        var journal = Journal.Create("JV", "Ventes", null, isSystem: true).Value;
        journal.Deactivate();
        Assert.True(journal.IsActive);
    }

    [Fact]
    public void Journal_Deactivate_NonSystem_Deactivates()
    {
        var journal = Journal.Create("JX", "Custom", null, isSystem: false).Value;
        journal.Deactivate();
        Assert.False(journal.IsActive);
    }

    #endregion

    #region ChartOfAccount

    [Fact]
    public void ChartOfAccount_Create_WithValidInput_ShouldSucceed()
    {
        var result = ChartOfAccount.Create("4111", "Clients", 4, "411", AccountNatureType.Debit, isSystem: false);

        Assert.True(result.IsSuccess);
        Assert.Equal("4111", result.Value.AccountNumber);
        Assert.True(result.Value.IsActive);
        Assert.False(result.Value.IsSystem);
    }

    [Fact]
    public void ChartOfAccount_Create_WithClassOutOfRange_ShouldFail()
    {
        var result = ChartOfAccount.Create("8001", "Invalid", 8, null, AccountNatureType.Debit);

        Assert.True(result.IsFailure);
        Assert.Contains("classe", result.Error.Description);
    }

    [Fact]
    public void ChartOfAccount_Create_WithEmptyNumber_ShouldFail()
    {
        var result = ChartOfAccount.Create("", "Label", 1, null, AccountNatureType.Debit);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void ChartOfAccount_Create_AsSystem_SetsFlag()
    {
        var result = ChartOfAccount.Create("101", "Capital", 1, null, AccountNatureType.Credit, isSystem: true);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsSystem);
    }

    [Fact]
    public void ChartOfAccount_UpdateLabel_NonSystem_ShouldSucceed()
    {
        var account = ChartOfAccount.Create("4111", "Old Label", 4, "411", AccountNatureType.Debit, isSystem: false).Value;

        var result = account.UpdateLabel("New Label");

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void ChartOfAccount_UpdateLabel_System_ShouldFail()
    {
        var account = ChartOfAccount.Create("4111", "System", 4, "411", AccountNatureType.Debit, isSystem: true).Value;

        var result = account.UpdateLabel("New Label");

        Assert.True(result.IsFailure);
        Assert.Contains("système", result.Error.Description);
    }

    [Fact]
    public void ChartOfAccount_ToggleActive_NonSystem_SetsInactive()
    {
        var account = ChartOfAccount.Create("4111", "Test", 4, "411", AccountNatureType.Debit, isSystem: false).Value;

        account.ToggleActive();

        Assert.False(account.IsActive);
    }

    [Fact]
    public void ChartOfAccount_ToggleActive_Twice_ReactivatesAccount()
    {
        // C6 : un compte désactivé doit pouvoir être réactivé (l'ancien Deactivate était à sens unique).
        var account = ChartOfAccount.Create("4111", "Test", 4, "411", AccountNatureType.Debit, isSystem: false).Value;

        account.ToggleActive();
        Assert.False(account.IsActive);

        account.ToggleActive();
        Assert.True(account.IsActive);
    }

    [Fact]
    public void ChartOfAccount_ToggleActive_System_StaysActive()
    {
        var account = ChartOfAccount.Create("4111", "Test", 4, "411", AccountNatureType.Debit, isSystem: true).Value;

        account.ToggleActive();

        Assert.True(account.IsActive);
    }

    [Fact]
    public void ChartOfAccount_Create_DefaultsToGeneralNonAuxiliary()
    {
        // Non-régression : sans les nouveaux paramètres, un compte est Général, non auxiliaire, sans affectation.
        var account = ChartOfAccount.Create("4111", "Clients", 4, "411", AccountNatureType.Debit).Value;

        Assert.Equal(AccountType.General, account.AccountType);
        Assert.False(account.IsAuxiliary);
        Assert.Null(account.AffectationAccountNumber);
    }

    [Fact]
    public void ChartOfAccount_Create_AuxiliaryClientAccount_SetsAxeaneFields()
    {
        var account = ChartOfAccount.Create(
            "41100001", "Client Société X", 4, "411", AccountNatureType.Debit,
            isSystem: false, accountType: AccountType.Client, isAuxiliary: true,
            affectationAccountNumber: "41110000").Value;

        Assert.Equal(AccountType.Client, account.AccountType);
        Assert.True(account.IsAuxiliary);
        Assert.Equal("41110000", account.AffectationAccountNumber);
        Assert.Equal("411", account.ParentAccountNumber);
    }

    // ── Matricule fiscal (plan « Matricule fiscal sur les comptes auxiliaires »). ──

    private static ChartOfAccount AuxiliaryClientAccount(string number = "41105", bool isSystem = false) =>
        ChartOfAccount.Create(
            number, "STE SLIMEN", int.Parse(number[..1].ToString()), null, AccountNatureType.Debit,
            isSystem: isSystem, accountType: AccountType.Client, isAuxiliary: true).Value;

    private static ChartOfAccount AuxiliarySupplierAccount(string number = "40105") =>
        ChartOfAccount.Create(
            number, "Fournisseur X", int.Parse(number[..1].ToString()), null, AccountNatureType.Credit,
            accountType: AccountType.Supplier, isAuxiliary: true).Value;

    [Fact]
    public void SetFiscalId_OnEligibleClientAccount_StoresCanonicalAndNormalizedForms()
    {
        var account = AuxiliaryClientAccount();

        var result = account.SetFiscalId("1525071P/B/M/000");

        Assert.True(result.IsSuccess);
        Assert.Equal("1525071P/B/M/000", account.FiscalId);
        Assert.Equal("1525071PBM000", account.FiscalIdNormalized);
    }

    [Fact]
    public void SetFiscalId_AcceptsTheLegacySpellingAndNormalizesItTheSameWay()
    {
        var account = AuxiliaryClientAccount();

        var result = account.SetFiscalId("1525071/P/B/M/000");

        Assert.True(result.IsSuccess);
        Assert.Equal("1525071PBM000", account.FiscalIdNormalized);
    }

    [Fact]
    public void SetFiscalId_OnEligibleSupplierAccount_Succeeds()
    {
        var account = AuxiliarySupplierAccount();

        var result = account.SetFiscalId("1772793W/A/M/000");

        Assert.True(result.IsSuccess);
        Assert.Equal(AccountType.Supplier, account.AccountType);
    }

    [Fact]
    public void SetFiscalId_WithANullOrBlankValue_ClearsBothColumns()
    {
        var account = AuxiliaryClientAccount();
        account.SetFiscalId("1525071P/B/M/000");

        var result = account.SetFiscalId("   ");

        Assert.True(result.IsSuccess);
        Assert.Null(account.FiscalId);
        Assert.Null(account.FiscalIdNormalized);
    }

    [Fact]
    public void SetFiscalId_OnASystemAccount_Fails()
    {
        var account = AuxiliaryClientAccount(isSystem: true);

        var result = account.SetFiscalId("1525071P/B/M/000");

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.FiscalId", result.Error.Code);
    }

    [Fact]
    public void SetFiscalId_OnANonAuxiliaryAccount_Fails()
    {
        var account = ChartOfAccount.Create(
            "4111", "Clients", 4, null, AccountNatureType.Debit, accountType: AccountType.Client).Value;

        var result = account.SetFiscalId("1525071P/B/M/000");

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void SetFiscalId_OnAnAuxiliaryAccountOfTypeOther_Fails()
    {
        var account = ChartOfAccount.Create(
            "41105", "Autre", 4, null, AccountNatureType.Debit,
            accountType: AccountType.Other, isAuxiliary: true).Value;

        var result = account.SetFiscalId("1525071P/B/M/000");

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void SetFiscalId_OnAClientAccountWithTheSupplierPrefix_FailsCitingTheAccountNumber()
    {
        // Un compte Client doit commencer par "41" pour être retrouvé par le rapprochement à
        // l'import ; "40105" est le préfixe Fournisseur.
        var account = ChartOfAccount.Create(
            "40105", "Mal classé", 4, null, AccountNatureType.Debit,
            accountType: AccountType.Client, isAuxiliary: true).Value;

        var result = account.SetFiscalId("1525071P/B/M/000");

        Assert.True(result.IsFailure);
        Assert.Contains("40105", result.Error.Description);
    }

    [Fact]
    public void SetFiscalId_WithAnInvalidFormat_FailsWithTheNifFormatError()
    {
        var account = AuxiliaryClientAccount();

        var result = account.SetFiscalId("not-a-nif");

        Assert.True(result.IsFailure);
        Assert.Equal(NIF.FormatError, result.Error.Description);
    }

    [Fact]
    public void Create_WithAFiscalIdOnAnEligibleAccount_SetsItAtomically()
    {
        var result = ChartOfAccount.Create(
            "41105", "STE SLIMEN", 4, null, AccountNatureType.Debit,
            accountType: AccountType.Client, isAuxiliary: true, fiscalId: "1525071P/B/M/000");

        Assert.True(result.IsSuccess);
        Assert.Equal("1525071P/B/M/000", result.Value.FiscalId);
    }

    [Fact]
    public void Create_WithAFiscalIdOnAnIneligibleAccount_RefusesTheWholeCreation()
    {
        // Un MF fourni sur un compte qui ne le supporte pas est refusé, jamais ignoré en silence.
        var result = ChartOfAccount.Create(
            "4111", "Clients", 4, null, AccountNatureType.Debit, fiscalId: "1525071P/B/M/000");

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void NormalizeFiscalId_StripsSeparatorsAndUppercases()
    {
        Assert.Equal("1525071PBM000", ChartOfAccount.NormalizeFiscalId("1525071p/b/m/000"));
    }

    #endregion


    #region AccountingPeriod

    [Fact]
    public void AccountingPeriod_Create_SetsCorrectValues()
    {
        var start = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2026, 3, 31, 0, 0, 0, DateTimeKind.Utc);

        var period = AccountingPeriod.Create(2026, 3, start, end);

        Assert.Equal(2026, period.FiscalYear);
        Assert.Equal(3, period.Month);
        Assert.Equal(start, period.StartDate);
        Assert.Equal(end, period.EndDate);
        Assert.False(period.IsClosed);
    }

    [Fact]
    public void AccountingPeriod_Close_SetsClosedState()
    {
        var period = AccountingPeriod.Create(2026, 3,
            new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 3, 31, 0, 0, 0, DateTimeKind.Utc));

        period.Close("admin");

        Assert.True(period.IsClosed);
        Assert.NotNull(period.ClosedAt);
        Assert.Equal("admin", period.ClosedBy);
    }

    [Fact]
    public void AccountingPeriod_Reopen_ClearsClosedState()
    {
        var period = AccountingPeriod.Create(2026, 3,
            new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 3, 31, 0, 0, 0, DateTimeKind.Utc));

        period.Close("admin");
        period.Reopen();

        Assert.False(period.IsClosed);
        Assert.Null(period.ClosedAt);
        Assert.Null(period.ClosedBy);
    }

    [Fact]
    public void AccountingPeriod_Close_WhenAlreadyClosed_NoOp()
    {
        var period = AccountingPeriod.Create(2026, 3,
            new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 3, 31, 0, 0, 0, DateTimeKind.Utc));

        period.Close("admin");
        var firstClosedAt = period.ClosedAt;
        period.Close("other");

        Assert.Equal(firstClosedAt, period.ClosedAt);
        Assert.Equal("admin", period.ClosedBy);
    }

    #endregion

    #region VatDeclaration

    [Fact]
    public void VatDeclaration_CreateDraft_CalculatesVatDue_WhenPositive()
    {
        var draft = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd),
            Money.Create(200m, Tnd),
            Money.Create(100m, Tnd),
            Money.Create(500m, Tnd),
            Money.Create(0m, Tnd),
            Money.Create(0m, Tnd),
            Tnd);

        Assert.Equal(800m, draft.VatDue.Amount);
        Assert.Equal(0m, draft.CreditToCarry.Amount);
        Assert.Equal(VatDeclarationStatus.Draft, draft.Status);
    }

    [Fact]
    public void VatDeclaration_CreateDraft_SetsCreditToCarry_WhenNegative()
    {
        var draft = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(100m, Tnd),
            Money.Create(0m, Tnd),
            Money.Create(0m, Tnd),
            Money.Create(500m, Tnd),
            Money.Create(0m, Tnd),
            Money.Create(100m, Tnd),
            Tnd);

        Assert.Equal(0m, draft.VatDue.Amount);
        Assert.Equal(500m, draft.CreditToCarry.Amount);
    }

    [Fact]
    public void VatDeclaration_Submit_ChangesStatusToSubmitted()
    {
        var draft = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Create(0m, Tnd), Money.Create(0m, Tnd),
            Money.Create(0m, Tnd), Money.Create(0m, Tnd), Money.Create(0m, Tnd), Tnd);

        draft.Submit();

        Assert.Equal(VatDeclarationStatus.Submitted, draft.Status);
        Assert.NotNull(draft.SubmittedAt);
    }

    [Fact]
    public void VatDeclaration_Submit_WhenNotDraft_NoOp()
    {
        var draft = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Create(0m, Tnd), Money.Create(0m, Tnd),
            Money.Create(0m, Tnd), Money.Create(0m, Tnd), Money.Create(0m, Tnd), Tnd);

        draft.Submit();
        var submittedAt = draft.SubmittedAt;
        draft.Submit();

        Assert.Equal(submittedAt, draft.SubmittedAt);
    }

    [Fact]
    public void VatDeclaration_Lock_ChangesStatusToLocked()
    {
        var draft = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Create(0m, Tnd), Money.Create(0m, Tnd),
            Money.Create(0m, Tnd), Money.Create(0m, Tnd), Money.Create(0m, Tnd), Tnd);

        draft.Submit();
        draft.Lock();

        Assert.Equal(VatDeclarationStatus.Locked, draft.Status);
        Assert.NotNull(draft.LockedAt);
    }

    [Fact]
    public void VatDeclaration_NewV2Fields_DefaultToZeroAndVersionOne()
    {
        var d = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Zero(Tnd), Money.Zero(Tnd), Money.Zero(Tnd), Tnd);

        Assert.Equal(0m, d.Fodec);
        Assert.Equal(0m, d.WithholdingTax);
        Assert.Equal(0m, d.Acomptes);
        Assert.Equal(1, d.RevisionNumber);
        Assert.False(d.IsRectificative);
    }

    [Fact]
    public void VatDeclaration_SetAdditionalTaxes_ClampsNegativesToZero()
    {
        var d = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Zero(Tnd), Money.Zero(Tnd), Money.Zero(Tnd), Tnd);

        d.SetAdditionalTaxes(fodec: 10m, droitTimbre: 5m, tcl: 2m, tfp: -3m, foprolos: 0m, withholdingTax: 50m, acomptes: 20m);

        Assert.Equal(10m, d.Fodec);
        Assert.Equal(50m, d.WithholdingTax);
        Assert.Equal(0m, d.Tfp); // négatif ramené à 0
        Assert.Equal(20m, d.Acomptes);
    }

    [Fact]
    public void VatDeclaration_ApplyRevision_BumpsVersionRecomputesAndResetsToDraft()
    {
        var d = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Create(200m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd), Tnd);
        d.Submit();

        d.ApplyRevision(
            Money.Create(1200m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Create(200m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            fodec: 12m, droitTimbre: 0m, tcl: 0m, tfp: 0m, foprolos: 0m, withholdingTax: 0m, acomptes: 0m);

        Assert.Equal(2, d.RevisionNumber);
        Assert.True(d.IsRectificative);
        Assert.Equal(VatDeclarationStatus.Draft, d.Status);
        Assert.Equal(1000m, d.VatDue.Amount); // 1200 collectée - 200 déductible
        Assert.Equal(12m, d.Fodec);
    }

    [Fact]
    public void VatDeclaration_UpdateDraft_RecomputesWithoutRectificativeSemantics()
    {
        var d = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Create(200m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd), Tnd);

        var result = d.UpdateDraft(
            Money.Create(1500m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Create(300m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd));

        Assert.True(result.IsSuccess);
        Assert.Equal(1200m, d.VatDue.Amount); // 1500 - 300, recalculé
        Assert.Equal(1, d.RevisionNumber);    // PAS de bump
        Assert.False(d.IsRectificative);      // PAS une rectificative
        Assert.Equal(VatDeclarationStatus.Draft, d.Status);
    }

    [Fact]
    public void VatDeclaration_UpdateDraft_WhenSubmitted_Fails()
    {
        var d = VatDeclaration.CreateDraft(2026, 3,
            Money.Create(1000m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Zero(Tnd), Money.Zero(Tnd), Money.Zero(Tnd), Tnd);
        d.Submit();

        var result = d.UpdateDraft(
            Money.Create(1500m, Tnd), Money.Zero(Tnd), Money.Zero(Tnd),
            Money.Zero(Tnd), Money.Zero(Tnd), Money.Zero(Tnd));

        Assert.True(result.IsFailure);
        Assert.Equal(1000m, d.VatDue.Amount); // inchangé
    }

    #endregion
}
