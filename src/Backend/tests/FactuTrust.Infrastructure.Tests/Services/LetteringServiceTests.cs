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
}
