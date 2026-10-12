using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Lot A : lettrage — équilibre exigé par défaut, lettrage partiel explicite (code « P »),
/// délettrage qui libère les lignes, et génération de code robuste à la suppression de groupes.
/// </summary>
public sealed class LetteringServiceTests
{
    private readonly string _dbName = $"LetteringDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;
    private readonly Guid _accountingPeriodId;

    public LetteringServiceTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);

        // Une AccountingPeriod réelle est requise : JournalEntry.AccountingPeriod est une relation
        // requise (FK non-nullable). Un Guid orphelin « marchait » par accident avec le provider
        // InMemory sur un .Count()/.Any(), mais le fait échouer silencieusement (0 ligne matérialisée)
        // dès qu'une requête fait .Include(JournalEntry).ThenInclude(AccountingPeriod) + ToListAsync —
        // le provider InMemory traite la relation requise comme une jointure interne.
        using var ctx = _factory.CreateContext();
        var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
        ctx.AccountingPeriods.Add(period);
        ctx.SaveChanges();
        _accountingPeriodId = period.Id;
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;
        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    /// <summary>Crée une écriture (débit 4111 / crédit 707 ou l'inverse) et renvoie l'id de sa ligne 4111.</summary>
    private Guid SeedClientLine(int number, decimal amount, bool clientIsDebit)
    {
        var lines = clientIsDebit
            ? new[]
            {
                new JournalLineInput("4111", "Client", amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("707", "Vente", 0m, amount, null, ThirdPartyKind.None)
            }
            : new[]
            {
                new JournalLineInput("532", "Banque", amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 0m, amount, null, ThirdPartyKind.None)
            };

        var entry = JournalEntry.Create(number, clientIsDebit ? "JV" : "JB",
            new DateTime(2026, 5, 10), $"Écriture {number}", _accountingPeriodId,
            false, "Manual", null, lines).Value;
        entry.SetAuditInfo("test", false);

        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == "4111").Id;
    }

    private LetteringService BuildService(TenantAmbientTransaction? ambient = null)
        => new(_factory, ambient ?? new TenantAmbientTransaction());

    private (string? Code, LetteringGroup? Group) LoadState(Guid lineId)
    {
        using var ctx = _factory.CreateContext();
        var code = ctx.JournalEntryLines.AsNoTracking().Single(l => l.Id == lineId).LetteringCode;
        var group = code is null
            ? null
            : ctx.LetteringGroups.AsNoTracking().Include(g => g.Members).FirstOrDefault(g => g.Code == code);
        return (code, group);
    }

    [Fact]
    public async Task Letter_Balanced_CreatesDefinitiveGroup()
    {
        var debit = SeedClientLine(1, 100m, clientIsDebit: true);
        var credit = SeedClientLine(2, 100m, clientIsDebit: false);

        var result = await BuildService().ManualLetterAsync(new[] { debit, credit });

        Assert.True(result.IsSuccess);
        var (code, group) = LoadState(debit);
        Assert.NotNull(code);
        Assert.StartsWith("L", code);
        Assert.NotNull(group);
        Assert.False(group!.IsPartial);
        Assert.Equal(100m, group.Amount.Amount);
    }

    [Fact]
    public async Task Letter_Unbalanced_WithoutAllowPartial_Fails()
    {
        var debit = SeedClientLine(1, 100m, clientIsDebit: true);
        var credit = SeedClientLine(2, 60m, clientIsDebit: false);

        var result = await BuildService().ManualLetterAsync(new[] { debit, credit });

        Assert.True(result.IsFailure);
        Assert.Contains("partiel", result.Error.Description);
        Assert.Null(LoadState(debit).Code);
    }

    [Fact]
    public async Task Letter_Unbalanced_WithAllowPartial_CreatesPartialGroup()
    {
        var debit = SeedClientLine(1, 100m, clientIsDebit: true);
        var credit = SeedClientLine(2, 60m, clientIsDebit: false);

        var result = await BuildService().ManualLetterAsync(new[] { debit, credit }, allowPartial: true);

        Assert.True(result.IsSuccess);
        var (code, group) = LoadState(debit);
        Assert.NotNull(code);
        Assert.StartsWith("P", code);
        Assert.NotNull(group);
        Assert.True(group!.IsPartial);
        Assert.Equal(60m, group.Amount.Amount); // partie couverte = min(débit, crédit)
    }

    [Fact]
    public async Task Letter_Balanced_WithAllowPartial_StaysDefinitive()
    {
        // Un « partiel » équilibré est un lettrage ordinaire (code L).
        var debit = SeedClientLine(1, 100m, clientIsDebit: true);
        var credit = SeedClientLine(2, 100m, clientIsDebit: false);

        var result = await BuildService().ManualLetterAsync(new[] { debit, credit }, allowPartial: true);

        Assert.True(result.IsSuccess);
        var (code, group) = LoadState(debit);
        Assert.StartsWith("L", code);
        Assert.False(group!.IsPartial);
    }

    [Fact]
    public async Task Unletter_ReleasesLinesAndDeletesGroup()
    {
        var debit = SeedClientLine(1, 100m, clientIsDebit: true);
        var credit = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { debit, credit })).IsSuccess);
        var code = LoadState(debit).Code!;

        var result = await service.UnletterAsync(code);

        Assert.True(result.IsSuccess);
        Assert.Null(LoadState(debit).Code);
        Assert.Null(LoadState(credit).Code);
        using var ctx = _factory.CreateContext();
        Assert.False(ctx.LetteringGroups.AsNoTracking().Any(g => g.Code == code));
        Assert.Empty(ctx.LetteringGroupMembers.AsNoTracking().ToList());
    }

    [Fact]
    public async Task Unletter_ThenRelettering_DoesNotCollideCodes()
    {
        // L'ancien schéma « Count + 1 » régénérait un code déjà attribué après une suppression.
        var d1 = SeedClientLine(1, 100m, clientIsDebit: true);
        var c1 = SeedClientLine(2, 100m, clientIsDebit: false);
        var d2 = SeedClientLine(3, 50m, clientIsDebit: true);
        var c2 = SeedClientLine(4, 50m, clientIsDebit: false);
        var service = BuildService();

        Assert.True((await service.ManualLetterAsync(new[] { d1, c1 })).IsSuccess);   // L00001
        Assert.True((await service.ManualLetterAsync(new[] { d2, c2 })).IsSuccess);   // L00002
        Assert.True((await service.UnletterAsync("L00001")).IsSuccess);               // supprime L00001

        var d3 = SeedClientLine(5, 30m, clientIsDebit: true);
        var c3 = SeedClientLine(6, 30m, clientIsDebit: false);
        Assert.True((await service.ManualLetterAsync(new[] { d3, c3 })).IsSuccess);

        var newCode = LoadState(d3).Code;
        Assert.Equal("L00003", newCode); // max(2) + 1 — jamais L00002 déjà pris
    }

    [Fact]
    public async Task Unletter_UnknownCode_Fails()
    {
        var result = await BuildService().UnletterAsync("L99999");

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Letter_AlreadyLetteredLine_Fails()
    {
        var debit = SeedClientLine(1, 100m, clientIsDebit: true);
        var credit = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { debit, credit })).IsSuccess);

        var again = await service.ManualLetterAsync(new[] { debit, credit }, allowPartial: true);

        Assert.True(again.IsFailure);
        Assert.Contains("déjà lettrées", again.Error.Description);
    }

    /// <summary>
    /// Plan §5.5 (D9) : <c>AutoLetterPaymentAsync</c> doit TOUJOURS pouvoir lettrer un règlement
    /// (période ouverte) avec sa facture, même si la facture appartient à une période déjà
    /// clôturée — c'est l'exception "Allow" du verrou (flux automatique interne, pas d'origine
    /// HTTP possible pour cette valeur, cf. <c>LetterAccountEntriesCommandValidator</c>).
    /// </summary>
    [Fact]
    public async Task AutoLetterPaymentAsync_InvoiceInClosedPeriod_StillLetters()
    {
        var closedPeriod = AccountingPeriod.Create(2026, 4, new DateTime(2026, 4, 1), new DateTime(2026, 4, 30));
        closedPeriod.Close("test");

        using (var ctx = _factory.CreateContext())
        {
            ctx.AccountingPeriods.Add(closedPeriod);
            ctx.SaveChanges();
        }

        var clientId = Guid.NewGuid();
        var invoiceId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();

        var invoiceEntry = JournalEntry.Create(
            10, "JV", new DateTime(2026, 4, 15), "Facture avril (clôturée)",
            closedPeriod.Id, false, "Invoice", invoiceId,
            new[]
            {
                new JournalLineInput("4111", "Client", 500m, 0m, clientId, ThirdPartyKind.Client),
                new JournalLineInput("707", "Vente", 0m, 500m, null, ThirdPartyKind.None)
            }).Value;
        invoiceEntry.SetAuditInfo("test", false);

        var paymentEntry = JournalEntry.Create(
            11, "JB", new DateTime(2026, 5, 20), "Règlement mai (ouverte)",
            _accountingPeriodId, false, "Payment", paymentId,
            new[]
            {
                new JournalLineInput("532", "Banque", 500m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 0m, 500m, clientId, ThirdPartyKind.Client)
            }).Value;
        paymentEntry.SetAuditInfo("test", false);

        using (var ctx = _factory.CreateContext())
        {
            ctx.JournalEntries.AddRange(invoiceEntry, paymentEntry);
            ctx.SaveChanges();
        }

        var result = await BuildService().AutoLetterPaymentAsync("Payment", paymentId, "Invoice", invoiceId);

        Assert.True(result.IsSuccess);

        using var verify = _factory.CreateContext();
        var invoiceLine = verify.JournalEntryLines.AsNoTracking().Single(l => l.JournalEntryId == invoiceEntry.Id && l.AccountNumber == "4111");
        var paymentLine = verify.JournalEntryLines.AsNoTracking().Single(l => l.JournalEntryId == paymentEntry.Id && l.AccountNumber == "4111");

        Assert.NotNull(invoiceLine.LetteringCode);
        Assert.Equal(invoiceLine.LetteringCode, paymentLine.LetteringCode);
    }

    // ════════════════════════════════════════════════════════════════════════════════════════
    // Revue backend (PR 1, 2e passe) : délettrage transactionnel + filtre « code du groupe »,
    // complétion (membres cohérents, montant recalculé), doublons d'ids, normalisation du code,
    // refus de période verrouillée (D8, trois causes) pour lettrage ET délettrage.
    // ════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>Compte les contextes isolés créés : preuve qu'aucune tentative superflue n'a lieu.</summary>
    private sealed class CountingTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly ITenantDbContextFactory _inner;
        public int IsolatedContextsCreated;
        public CountingTenantDbContextFactory(ITenantDbContextFactory inner) => _inner = inner;
        public TenantDbContext CreateContext() => _inner.CreateContext();
        public TenantDbContext CreateIsolatedContext()
        {
            Interlocked.Increment(ref IsolatedContextsCreated);
            return _inner.CreateIsolatedContext();
        }
    }

    private void MarkLineEntryPeriodClosed(Guid lineId)
    {
        using var ctx = _factory.CreateContext();
        var line = ctx.JournalEntryLines.Include(l => l.JournalEntry).Single(l => l.Id == lineId);
        line.JournalEntry.MarkPeriodClosed();
        ctx.SaveChanges();
    }

    private void CloseSharedPeriod()
    {
        using var ctx = _factory.CreateContext();
        ctx.AccountingPeriods.Single(p => p.Id == _accountingPeriodId).Close("test");
        ctx.SaveChanges();
    }

    private void LockFiscalYear2026()
    {
        using var ctx = _factory.CreateContext();
        ctx.AccountingYearLocks.Add(AccountingYearLock.Create(2026, "test"));
        ctx.SaveChanges();
    }

    // ── M1 : UnletterAsync ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Une ligne membre qui porte un AUTRE code (donnée historique incohérente, pré-index unique)
    /// appartient à un autre lettrage : le délettrage du groupe ne doit JAMAIS l'effacer.
    /// </summary>
    [Fact]
    public async Task Unletter_MemberWithForeignCode_IsNotCleared()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { a, b })).IsSuccess);
        var code = LoadState(a).Code!;

        using (var ctx = _factory.CreateContext())
        {
            ctx.JournalEntryLines.Single(l => l.Id == b).SetLetteringCode("L77777");
            ctx.SaveChanges();
        }

        var result = await service.UnletterAsync(code);

        Assert.True(result.IsSuccess);
        Assert.Null(LoadState(a).Code);              // libérée : elle portait le code du groupe
        Assert.Equal("L77777", LoadState(b).Code);   // préservée : code étranger
        using var verify = _factory.CreateContext();
        Assert.False(verify.LetteringGroups.AsNoTracking().Any(g => g.Code == code));
    }

    /// <summary>Le code est normalisé (majuscules) côté service, comme GetGroupAsync.</summary>
    [Fact]
    public async Task Unletter_LowercaseCode_Succeeds()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { a, b })).IsSuccess);

        var result = await service.UnletterAsync("  l00001  ");

        Assert.True(result.IsSuccess);
        Assert.Null(LoadState(a).Code);
    }

    /// <summary>D8, cause « statut Cloturee » : délettrage refusé, groupe et codes intacts.</summary>
    [Fact]
    public async Task Unletter_EntryStatusCloturee_FailsAndKeepsEverything()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { a, b })).IsSuccess);
        var code = LoadState(a).Code!;
        MarkLineEntryPeriodClosed(a);

        var result = await service.UnletterAsync(code);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        Assert.Equal(code, LoadState(a).Code);
        Assert.Equal(code, LoadState(b).Code);
        using var ctx = _factory.CreateContext();
        Assert.True(ctx.LetteringGroups.AsNoTracking().Any(g => g.Code == code));
    }

    /// <summary>D8, cause « période IsClosed » : délettrage refusé, rien d'écrit.</summary>
    [Fact]
    public async Task Unletter_PeriodClosed_FailsAndKeepsEverything()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { a, b })).IsSuccess);
        var code = LoadState(a).Code!;
        CloseSharedPeriod();

        var result = await service.UnletterAsync(code);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        Assert.Equal(code, LoadState(a).Code);
    }

    /// <summary>D8, cause « exercice verrouillé » : délettrage refusé, rien d'écrit.</summary>
    [Fact]
    public async Task Unletter_FiscalYearLocked_FailsAndKeepsEverything()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { a, b })).IsSuccess);
        var code = LoadState(a).Code!;
        LockFiscalYear2026();

        var result = await service.UnletterAsync(code);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        Assert.Equal(code, LoadState(a).Code);
    }

    // ── Verrou de période (D8) côté lettrage manuel : les trois causes, aucune écriture ────────

    [Fact]
    public async Task Letter_EntryStatusCloturee_FailsWithPeriodLocked_NoWrite()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        MarkLineEntryPeriodClosed(a);

        var result = await BuildService().ManualLetterAsync(new[] { a, b });

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        Assert.Null(LoadState(a).Code);
        using var ctx = _factory.CreateContext();
        Assert.False(ctx.LetteringGroups.AsNoTracking().Any());
    }

    [Fact]
    public async Task Letter_PeriodClosed_FailsWithPeriodLocked_NoWrite()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        CloseSharedPeriod();

        var result = await BuildService().ManualLetterAsync(new[] { a, b });

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        using var ctx = _factory.CreateContext();
        Assert.False(ctx.LetteringGroups.AsNoTracking().Any());
    }

    [Fact]
    public async Task Letter_FiscalYearLocked_FailsWithPeriodLocked_NoWrite()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        LockFiscalYear2026();

        var result = await BuildService().ManualLetterAsync(new[] { a, b });

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        using var ctx = _factory.CreateContext();
        Assert.False(ctx.LetteringGroups.AsNoTracking().Any());
    }

    // ── Doublons d'identifiants : erreur de validation, jamais « lignes introuvables » ─────────

    [Fact]
    public async Task Letter_DuplicateLineIds_FailsWithValidation()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);

        var result = await BuildService().ManualLetterAsync(new[] { a, b, a });

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.Validation, result.Error.Code);
    }

    // ── M2 : CompletePartialAsync ─────────────────────────────────────────────────────────────

    /// <summary>Crée un groupe partiel « P » (débit 4111 = <paramref name="debitAmount"/>, crédit 4111 = <paramref name="creditAmount"/>).</summary>
    private async Task<(string Code, Guid DebitLine, Guid CreditLine)> SeedPartialGroup(
        int number, decimal debitAmount, decimal creditAmount)
    {
        var debit = SeedClientLine(number, debitAmount, clientIsDebit: true);
        var credit = SeedClientLine(number + 1000, creditAmount, clientIsDebit: false);
        var result = await BuildService().ManualLetterAsync(new[] { debit, credit }, allowPartial: true);
        Assert.True(result.IsSuccess);
        return (result.Value.Code, debit, credit);
    }

    /// <summary>P → L : la complétion équilibrée finalise le groupe (même numéro) et met à jour le montant.</summary>
    [Fact]
    public async Task Complete_Balanced_FinalizesPartialGroup()
    {
        var (code, debit, _) = await SeedPartialGroup(1, 100m, 60m);
        var newCredit = SeedClientLine(3, 40m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code, new[] { newCredit }, allowPartial: false);

        Assert.True(result.IsSuccess);
        Assert.Equal($"L{code.AsSpan(1)}", result.Value.Code);
        Assert.Equal(code, result.Value.PreviousCode);
        Assert.False(result.Value.IsPartial);
        Assert.Equal(100m, result.Value.Amount);

        var (lineCode, group) = LoadState(newCredit);
        Assert.Equal($"L{code.AsSpan(1)}", lineCode);
        Assert.NotNull(group);
        Assert.False(group!.IsPartial);
        Assert.Equal(100m, group.Amount.Amount);
        Assert.Equal(3, group.Members.Count);
        // Les lignes historiques sont rebasculées sur le code définitif.
        Assert.Equal($"L{code.AsSpan(1)}", LoadState(debit).Code);
    }

    /// <summary>P qui reste P (allowPartial, toujours déséquilibré) : le montant suit la règle min(débit, crédit).</summary>
    [Fact]
    public async Task Complete_StillPartial_WithAllowPartial_RecomputesAmount()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m); // montant initial : 60
        var newCredit = SeedClientLine(3, 20m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code, new[] { newCredit }, allowPartial: true);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsPartial);
        Assert.Equal(code, result.Value.Code);
        // Avant : min(100, 60) = 60. Après ajout de 20 : min(100, 80) = 80.
        Assert.Equal(80m, result.Value.Amount);
        var (_, group) = LoadState(newCredit);
        Assert.NotNull(group);
        Assert.Equal(80m, group!.Amount.Amount);
        Assert.Equal(code, LoadState(newCredit).Code);
    }

    [Fact]
    public async Task Complete_Unbalanced_WithoutAllowPartial_Fails()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m);
        var newCredit = SeedClientLine(3, 20m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code, new[] { newCredit }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.Unbalanced, result.Error.Code);
        Assert.Null(LoadState(newCredit).Code);
        using var ctx = _factory.CreateContext();
        var persisted = ctx.LetteringGroups.AsNoTracking().Single(g => g.Code == code);
        Assert.True(persisted.IsPartial);
        Assert.Equal(60m, persisted.Amount.Amount); // montant inchangé
    }

    [Fact]
    public async Task Complete_DefinitiveGroup_FailsNotPartial()
    {
        var a = SeedClientLine(1, 100m, clientIsDebit: true);
        var b = SeedClientLine(2, 100m, clientIsDebit: false);
        var service = BuildService();
        Assert.True((await service.ManualLetterAsync(new[] { a, b })).IsSuccess);
        var code = LoadState(a).Code!;
        var extra = SeedClientLine(3, 50m, clientIsDebit: false);

        var result = await service.CompletePartialAsync(code, new[] { extra }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.GroupNotPartial, result.Error.Code);
    }

    [Fact]
    public async Task Complete_NewLineAlreadyLettered_FailsAlreadyLettered()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m);
        var x = SeedClientLine(3, 50m, clientIsDebit: true);
        var y = SeedClientLine(4, 50m, clientIsDebit: false);
        Assert.True((await BuildService().ManualLetterAsync(new[] { x, y })).IsSuccess);

        var result = await BuildService().CompletePartialAsync(code, new[] { x }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.AlreadyLettered, result.Error.Code);
    }

    /// <summary>
    /// « Déjà membre » est un refus de validation DÉTERMINISTE : aucune tentative ne doit être
    /// rejouée (seule une vraie violation d'index unique au SaveChanges justifie un retry).
    /// 2 contextes isolés = 1 pour la stratégie d'exécution + 1 pour l'unique essai.
    /// </summary>
    [Fact]
    public async Task Complete_NewLineAlreadyMember_FailsAlreadyLettered_WithoutRetry()
    {
        var (code, debit, _) = await SeedPartialGroup(1, 100m, 60m);
        var counting = new CountingTenantDbContextFactory(_factory);
        var service = new LetteringService(counting, new TenantAmbientTransaction());

        var result = await service.CompletePartialAsync(code, new[] { debit }, allowPartial: true);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.AlreadyLettered, result.Error.Code);
        Assert.Contains("déjà membres", result.Error.Description);
        Assert.Equal(2, counting.IsolatedContextsCreated);
    }

    [Fact]
    public async Task Complete_DuplicateNewLineIds_FailsWithValidation()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m);
        var extra = SeedClientLine(3, 40m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code, new[] { extra, extra }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.Validation, result.Error.Code);
    }

    [Fact]
    public async Task Complete_OtherAccount_FailsAccountMismatch()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m);
        // Ligne sur un autre compte (707) que le groupe (4111).
        var otherAccountLine = SeedOtherAccountLine(3, "707", 40m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code, new[] { otherAccountLine }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.AccountMismatch, result.Error.Code);
    }

    /// <summary>Crée une écriture dont la ligne utile est sur <paramref name="account"/> (crédit si <paramref name="accountIsDebit"/> faux).</summary>
    private Guid SeedOtherAccountLine(int number, string account, decimal amount, bool clientIsDebit)
    {
        var lines = clientIsDebit
            ? new[]
            {
                new JournalLineInput(account, "Débit", amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("532", "Banque", 0m, amount, null, ThirdPartyKind.None)
            }
            : new[]
            {
                new JournalLineInput("532", "Banque", amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput(account, "Crédit", 0m, amount, null, ThirdPartyKind.None)
            };
        var entry = JournalEntry.Create(number, "JV", new DateTime(2026, 5, 10), $"Écriture {number}",
            _accountingPeriodId, false, "Manual", null, lines).Value;
        entry.SetAuditInfo("test", false);
        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == account).Id;
    }

    /// <summary>Crée une écriture EUR (taux <paramref name="rate"/>) et renvoie sa ligne 4111 au crédit.</summary>
    private Guid SeedEuroClientLine(int number, decimal creditEur, decimal rate)
    {
        var entry = JournalEntry.Create(number, "JV", new DateTime(2026, 5, 10), $"EUR {number}",
            _accountingPeriodId, false, "Manual", null,
            new[]
            {
                new JournalLineInput("532", "Banque", creditEur * rate, 0m, null, ThirdPartyKind.None, creditEur, 0m),
                new JournalLineInput("4111", "Règlement", 0m, creditEur * rate, null, ThirdPartyKind.None, 0m, creditEur)
            },
            currency: "EUR", exchangeRate: rate).Value;
        entry.SetAuditInfo("test", false);
        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == "4111").Id;
    }

    [Fact]
    public async Task Complete_OtherCurrency_FailsCurrencyMismatch()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m); // groupe en TND
        var euroLine = SeedEuroClientLine(3, 40m, 3.0m);   // nouvelle ligne en EUR

        var result = await BuildService().CompletePartialAsync(code, new[] { euroLine }, allowPartial: true);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.CurrencyMismatch, result.Error.Code);
    }

    /// <summary>Un membre qui ne porte plus le code du groupe = donnée incohérente : refus clair, rien d'écrit.</summary>
    [Fact]
    public async Task Complete_MemberCarryingForeignCode_FailsGroupInconsistent()
    {
        var (code, _, credit) = await SeedPartialGroup(1, 100m, 60m);
        using (var ctx = _factory.CreateContext())
        {
            ctx.JournalEntryLines.Single(l => l.Id == credit).SetLetteringCode("L99999");
            ctx.SaveChanges();
        }
        var extra = SeedClientLine(3, 40m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code, new[] { extra }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.GroupInconsistent, result.Error.Code);
        Assert.Null(LoadState(extra).Code);
    }

    [Fact]
    public async Task Complete_LockedMember_FailsPeriodLocked()
    {
        var (code, debit, _) = await SeedPartialGroup(1, 100m, 60m);
        MarkLineEntryPeriodClosed(debit);
        var extra = SeedClientLine(3, 40m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code, new[] { extra }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        Assert.Null(LoadState(extra).Code);
    }

    [Fact]
    public async Task Complete_LockedNewLine_FailsPeriodLocked()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m);
        var extra = SeedClientLine(3, 40m, clientIsDebit: false);
        MarkLineEntryPeriodClosed(extra);

        var result = await BuildService().CompletePartialAsync(code, new[] { extra }, allowPartial: false);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, result.Error.Code);
        Assert.Null(LoadState(extra).Code);
    }

    /// <summary>Le code est normalisé (majuscules) côté service avant recherche du groupe.</summary>
    [Fact]
    public async Task Complete_LowercaseCode_Succeeds()
    {
        var (code, _, _) = await SeedPartialGroup(1, 100m, 60m);
        var extra = SeedClientLine(3, 40m, clientIsDebit: false);

        var result = await BuildService().CompletePartialAsync(code.ToLowerInvariant(), new[] { extra }, allowPartial: false);

        Assert.True(result.IsSuccess);
        Assert.Equal($"L{code.AsSpan(1)}", result.Value.Code);
    }
}
