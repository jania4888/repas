using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Lot A (plan de refonte du lettrage, Annexe A §1) : <see cref="LetteringQueryService.GetGroupAsync"/>
/// calcule <c>CanUnletter</c>/<c>UnletterBlockedReason</c> à l'affichage uniquement (le serveur
/// revérifie tout à l'action de délettrage réelle) selon deux causes indépendantes — permission
/// <c>accounting:unletter</c> et période verrouillée (D8) — avec la priorité « permission » quand
/// les deux causes sont réunies (reflète exactement <c>LetteringQueryService.GetGroupAsync</c>).
/// </summary>
public sealed class LetteringQueryServiceGetGroupPermissionTests
{
    private readonly string _dbName = $"LetteringQueryDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;
    private readonly Guid _accountingPeriodId;

    public LetteringQueryServiceGetGroupPermissionTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);

        // AccountingPeriod réelle requise (cf. LetteringServiceTests) : JournalEntry.AccountingPeriod
        // est une relation requise ; un Guid orphelin ferait planter silencieusement les requêtes
        // projetées sur le provider InMemory.
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

    /// <summary>Crée une écriture 4111/707 lettrable, verrouillée ou non (D8, cause « statut »).</summary>
    private Guid SeedLetteredLine(int number, decimal amount, bool clientIsDebit, bool periodLocked)
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
        if (periodLocked)
            entry.MarkPeriodClosed();

        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == "4111").Id;
    }

    private void SeedGroup(string code, Guid lineA, Guid lineB)
    {
        var group = LetteringGroup.Create(code, "4111", Money.Create(100m), new[] { lineA, lineB }).Value;

        using var ctx = _factory.CreateContext();
        ctx.LetteringGroups.Add(group);

        var members = ctx.JournalEntryLines.Where(l => l.Id == lineA || l.Id == lineB).ToList();
        foreach (var line in members)
            line.SetLetteringCode(code);
        ctx.SaveChanges();
    }

    private LetteringQueryService BuildService(bool hasUnletterPermission)
    {
        var settings = Options.Create(new AccountingSettings());
        var currentUser = new Mock<ICurrentUser>();
        currentUser.Setup(u => u.HasPermission(Permissions.Accounting.Unletter)).Returns(hasUnletterPermission);
        return new LetteringQueryService(_factory, settings, currentUser.Object);
    }

    [Fact]
    public async Task GetGroupAsync_HasPermission_Unlocked_CanUnletter_NoBlockedReason()
    {
        var a = SeedLetteredLine(1, 100m, clientIsDebit: true, periodLocked: false);
        var b = SeedLetteredLine(2, 100m, clientIsDebit: false, periodLocked: false);
        SeedGroup("L00001", a, b);

        var result = await BuildService(hasUnletterPermission: true).GetGroupAsync("L00001");

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.CanUnletter);
        Assert.Null(result.Value.UnletterBlockedReason);
    }

    [Fact]
    public async Task GetGroupAsync_NoPermission_Unlocked_CannotUnletter_ReasonIsPermission()
    {
        var a = SeedLetteredLine(1, 100m, clientIsDebit: true, periodLocked: false);
        var b = SeedLetteredLine(2, 100m, clientIsDebit: false, periodLocked: false);
        SeedGroup("L00002", a, b);

        var result = await BuildService(hasUnletterPermission: false).GetGroupAsync("L00002");

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanUnletter);
        Assert.Equal("permission", result.Value.UnletterBlockedReason);
    }

    [Fact]
    public async Task GetGroupAsync_HasPermission_Locked_CannotUnletter_ReasonIsPeriodLocked()
    {
        var a = SeedLetteredLine(1, 100m, clientIsDebit: true, periodLocked: true);
        var b = SeedLetteredLine(2, 100m, clientIsDebit: false, periodLocked: true);
        SeedGroup("L00003", a, b);

        var result = await BuildService(hasUnletterPermission: true).GetGroupAsync("L00003");

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanUnletter);
        Assert.Equal("period_locked", result.Value.UnletterBlockedReason);
    }

    [Fact]
    public async Task GetGroupAsync_NoPermission_Locked_ReasonIsPermission_NotPeriodLocked()
    {
        // Les deux causes de blocage sont réunies : le libellé doit rester « permission »
        // (priorité fixée par LetteringQueryService.GetGroupAsync, pas un choix arbitraire du test).
        var a = SeedLetteredLine(1, 100m, clientIsDebit: true, periodLocked: true);
        var b = SeedLetteredLine(2, 100m, clientIsDebit: false, periodLocked: true);
        SeedGroup("L00004", a, b);

        var result = await BuildService(hasUnletterPermission: false).GetGroupAsync("L00004");

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanUnletter);
        Assert.Equal("permission", result.Value.UnletterBlockedReason);
    }

    [Fact]
    public async Task GetGroupAsync_UnknownCode_ReturnsGroupNotFound()
    {
        var result = await BuildService(hasUnletterPermission: true).GetGroupAsync("INCONNU");

        Assert.True(result.IsFailure);
        Assert.Equal("LETTERING_GROUP_NOT_FOUND", result.Error.Code);
    }
}
