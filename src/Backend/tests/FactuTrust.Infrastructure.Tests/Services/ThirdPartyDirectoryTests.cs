using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using FactuTrust.Infrastructure.Tests.Fakes;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Plan tiers unifié : agrégation clients+fournisseurs (filtres kind/recherche/inactifs), soldes
/// par tiers (politique brouillard), fiches comptables (upsert, unicité du code) et génération
/// séquentielle idempotente des codes auxiliaires (C0001…/F0001…).
/// </summary>
public sealed class ThirdPartyDirectoryTests
{
    private readonly TestTenantDbContextFactory _factory;
    private readonly ThirdPartyDirectoryService _service;

    public ThirdPartyDirectoryTests()
    {
        _factory = new TestTenantDbContextFactory($"ThirdPartyDirDb_{Guid.NewGuid()}");
        var currentUser = new Mock<ICurrentUser>();
        currentUser.SetupGet(u => u.Email).Returns("comptable@cabinet.tn");
        _service = new ThirdPartyDirectoryService(_factory, currentUser.Object,
            Options.Create(new AccountingSettings { IncludeBrouillardInReports = true }));
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

    private Guid SeedClient(string name, bool active = true)
    {
        var client = Client.Create(name, ClientType.Individual,
            Address.Create("1 rue test", "Tunis", "Tunis").Value,
            Email.Create($"{Guid.NewGuid():N}@test.tn").Value).Value;
        if (!active)
            client.Deactivate();
        client.SetAuditInfo("test", false);
        using var ctx = _factory.CreateContext();
        ctx.Clients.Add(client);
        ctx.SaveChanges();
        return client.Id;
    }

    private Guid SeedSupplier(string name)
    {
        var supplier = Supplier.Create(name, SupplierType.Individual,
            Address.Create("2 rue test", "Sfax", "Sfax").Value,
            Email.Create($"{Guid.NewGuid():N}@test.tn").Value).Value;
        supplier.SetAuditInfo("test", false);
        using var ctx = _factory.CreateContext();
        ctx.Suppliers.Add(supplier);
        ctx.SaveChanges();
        return supplier.Id;
    }

    private void SeedEntry(Guid thirdPartyId, ThirdPartyKind kind, decimal debit, decimal credit,
        JournalEntryStatus status = JournalEntryStatus.Validee)
    {
        SeedEntryReturning(thirdPartyId, kind, debit, credit, status);
    }

    /// <summary>Comme <see cref="SeedEntry"/>, mais retourne l'écriture créée (utile pour l'éditer
    /// ensuite via le handler cabinet, plan v3 tâche 7).</summary>
    private JournalEntry SeedEntryReturning(Guid thirdPartyId, ThirdPartyKind kind, decimal debit, decimal credit,
        JournalEntryStatus status = JournalEntryStatus.Validee, Guid? accountingPeriodId = null)
    {
        var account = kind == ThirdPartyKind.Client ? "4111" : "4011";
        var entry = JournalEntry.Create(Random.Shared.Next(1, 99999), "JOD", new DateTime(2026, 6, 15),
            "Test tiers", accountingPeriodId ?? Guid.NewGuid(), false, "Manual", null, new[]
            {
                new JournalLineInput(account, "Tiers", debit, credit, thirdPartyId, kind),
                new JournalLineInput("5320000", "Contrepartie", credit, debit, null, ThirdPartyKind.None)
            }, initialStatus: status).Value;
        entry.SetAuditInfo("test", false);
        using var ctx = _factory.CreateContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry;
    }

    // ── Répertoire ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Directory_AggregatesClientsAndSuppliers_WithBalances()
    {
        var clientId = SeedClient("Alpha SARL");
        var supplierId = SeedSupplier("Beta Fournitures");
        SeedEntry(clientId, ThirdPartyKind.Client, 1000m, 0m);   // client débiteur 1000
        SeedEntry(supplierId, ThirdPartyKind.Supplier, 0m, 400m); // fournisseur créditeur 400

        var result = await _service.GetDirectoryAsync(null, null, includeInactive: false, 1, 50);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.TotalCount);
        var client = result.Value.Items.Single(i => i.ThirdPartyId == clientId);
        Assert.Equal((int)ThirdPartyKind.Client, client.Kind);
        Assert.Equal(1000m, client.BalanceDebit);
        Assert.Equal(0m, client.BalanceCredit);
        Assert.Equal("4111", client.CollectiveAccountNumber); // défaut sans fiche
        Assert.Null(client.AuxiliaryCode);
        var supplier = result.Value.Items.Single(i => i.ThirdPartyId == supplierId);
        Assert.Equal(400m, supplier.BalanceCredit);
        Assert.Equal("4011", supplier.CollectiveAccountNumber);
    }

    [Fact]
    public async Task Directory_Filters_Kind_Search_AndInactive()
    {
        SeedClient("Alpha SARL");
        SeedClient("Inactif SA", active: false);
        SeedSupplier("Beta Fournitures");

        var clientsOnly = await _service.GetDirectoryAsync(ThirdPartyKind.Client, null, false, 1, 50);
        Assert.All(clientsOnly.Value.Items, i => Assert.Equal((int)ThirdPartyKind.Client, i.Kind));
        Assert.Equal(1, clientsOnly.Value.TotalCount); // l'inactif est exclu

        var withInactive = await _service.GetDirectoryAsync(ThirdPartyKind.Client, null, true, 1, 50);
        Assert.Equal(2, withInactive.Value.TotalCount);

        var searched = await _service.GetDirectoryAsync(null, "beta", false, 1, 50);
        Assert.Equal("Beta Fournitures", Assert.Single(searched.Value.Items).Name);
    }

    [Fact]
    public async Task Directory_ExcludesDrafts_WhenPolicyOff()
    {
        var clientId = SeedClient("Gamma");
        SeedEntry(clientId, ThirdPartyKind.Client, 500m, 0m, JournalEntryStatus.Validee);
        SeedEntry(clientId, ThirdPartyKind.Client, 200m, 0m, JournalEntryStatus.Brouillon);

        var noDrafts = new ThirdPartyDirectoryService(_factory, Mock.Of<ICurrentUser>(),
            Options.Create(new AccountingSettings { IncludeBrouillardInReports = false }));

        var withDrafts = await _service.GetDirectoryAsync(null, null, false, 1, 50);
        var withoutDrafts = await noDrafts.GetDirectoryAsync(null, null, false, 1, 50);

        Assert.Equal(700m, withDrafts.Value.Items.Single().BalanceDebit);
        Assert.Equal(500m, withoutDrafts.Value.Items.Single().BalanceDebit);
    }

    // ── Codes auxiliaires ───────────────────────────────────────────────────

    [Fact]
    public async Task EnsureCodes_GeneratesSequential_ThenIdempotent()
    {
        SeedClient("Alpha");
        SeedClient("Bravo");
        SeedSupplier("Charlie");
        SeedClient("Inactif", active: false); // exclu (inactif)

        var first = await _service.EnsureAuxiliaryCodesAsync();
        Assert.True(first.IsSuccess);
        Assert.Equal(3, first.Value);

        using (var ctx = _factory.CreateContext())
        {
            var codes = ctx.ThirdPartyAccountingProfiles.AsNoTracking().Select(p => p.AuxiliaryCode).ToList();
            Assert.Contains("C0001", codes);
            Assert.Contains("C0002", codes);
            Assert.Contains("F0001", codes);
        }

        var second = await _service.EnsureAuxiliaryCodesAsync();
        Assert.Equal(0, second.Value); // idempotent
    }

    [Fact]
    public async Task Directory_SearchByAuxiliaryCode_FindsThirdParty()
    {
        SeedClient("Alpha");
        await _service.EnsureAuxiliaryCodesAsync();

        var byCode = await _service.GetDirectoryAsync(null, "C0001", false, 1, 50);

        Assert.Equal("Alpha", Assert.Single(byCode.Value.Items).Name);
    }

    // ── Fiche tiers ─────────────────────────────────────────────────────────

    [Fact]
    public async Task UpsertProfile_CreatesThenUpdates_AndGetReflectsIt()
    {
        var clientId = SeedClient("Alpha");

        var create = await _service.UpsertProfileAsync(ThirdPartyKind.Client, clientId,
            new UpsertThirdPartyProfileRequest
            {
                AuxiliaryCode = "cli-alpha",
                CollectiveAccountNumber = "4112",
                PaymentTermDays = 60,
                AccountingNotes = "Client grand compte"
            });
        Assert.True(create.IsSuccess);

        var profile = await _service.GetProfileAsync(ThirdPartyKind.Client, clientId);
        Assert.True(profile.Value.HasProfile);
        Assert.Equal("CLI-ALPHA", profile.Value.AuxiliaryCode); // normalisé MAJ
        Assert.Equal("4112", profile.Value.CollectiveAccountNumber);
        Assert.Equal(60, profile.Value.PaymentTermDays);
        Assert.Equal("Alpha", profile.Value.ThirdPartyName);

        var update = await _service.UpsertProfileAsync(ThirdPartyKind.Client, clientId,
            new UpsertThirdPartyProfileRequest { AuxiliaryCode = "CLI-ALPHA", CollectiveAccountNumber = "4111", PaymentTermDays = 30 });
        Assert.True(update.IsSuccess);
        Assert.Equal("4111", (await _service.GetProfileAsync(ThirdPartyKind.Client, clientId)).Value.CollectiveAccountNumber);
    }

    [Fact]
    public async Task UpsertProfile_DuplicateCode_Conflicts_AndUnknownThirdParty_NotFound()
    {
        var a = SeedClient("Alpha");
        var b = SeedClient("Bravo");
        await _service.UpsertProfileAsync(ThirdPartyKind.Client, a,
            new UpsertThirdPartyProfileRequest { AuxiliaryCode = "C0001", CollectiveAccountNumber = "4111" });

        var duplicate = await _service.UpsertProfileAsync(ThirdPartyKind.Client, b,
            new UpsertThirdPartyProfileRequest { AuxiliaryCode = "c0001", CollectiveAccountNumber = "4111" });
        Assert.True(duplicate.IsFailure);
        Assert.Contains("déjà attribué", duplicate.Error.Description);

        var unknown = await _service.UpsertProfileAsync(ThirdPartyKind.Client, Guid.NewGuid(),
            new UpsertThirdPartyProfileRequest { AuxiliaryCode = "X1", CollectiveAccountNumber = "4111" });
        Assert.True(unknown.IsFailure);
    }

    [Fact]
    public void Entity_RejectsInvalidCode_AndNoneKind()
    {
        Assert.True(ThirdPartyAccountingProfile.Create(
            ThirdPartyKind.None, Guid.NewGuid(), "C0001", "4111").IsFailure);
        Assert.True(ThirdPartyAccountingProfile.Create(
            ThirdPartyKind.Client, Guid.NewGuid(), "c 1!", "4111").IsFailure);
        Assert.True(ThirdPartyAccountingProfile.Create(
            ThirdPartyKind.Client, Guid.NewGuid(), "C0001", "41-11").IsFailure);
        Assert.True(ThirdPartyAccountingProfile.Create(
            ThirdPartyKind.Client, Guid.NewGuid(), "C0001", "4111", paymentTermDays: 999).IsFailure);
    }

    // ── Non-régression : édition cabinet d'un brouillon (plan v3, tâche 7) ──────────────────
    // « Mêmes règles brouillard que la balance auxiliaire » (§1.4) : une édition cabinet d'un
    // brouillon impliquant un tiers doit se répercuter immédiatement sur son solde.

    /// <summary>Mock <see cref="ICurrentUser"/> minimal : seul <see cref="IsAccountingFirmDelegatedContext"/> est paramétrable.</summary>
    private sealed class FakeCurrentUser : ICurrentUser
    {
        public bool IsAccountingFirmDelegatedContext { get; set; }
        public Guid? UserId => null;
        public string? Email => "comptable@cabinet.tn";
        public Guid? TenantId => null;
        public UserRole? Role => null;
        public bool IsAuthenticated => true;
        public bool HasPermission(string permission) => true;
        public Guid? PortalClientId => null;
        public bool IsClientPortal => false;
        public string? IpAddress => null;
        public string? UserAgent => null;
    }

    /// <summary>Modèle : <c>ValidatePurchaseReceiptCommandHandlerTests.cs</c> — pas de transaction,
    /// l'atomicité réelle est prouvée par les tests SQL (tâche 5, hors périmètre ici).</summary>
    private sealed class PassthroughTenantUnitOfWork : ITenantUnitOfWork
    {
        public Task<Result> ExecuteAsync(
            Func<CancellationToken, Task<Result>> action,
            CancellationToken cancellationToken = default)
            => action(cancellationToken);

        public Task<Result<T>> ExecuteAsync<T>(
            Func<CancellationToken, Task<Result<T>>> action,
            CancellationToken cancellationToken = default)
            => action(cancellationToken);
    }

    /// <summary>Période comptable réelle requise par <c>GetByIdForUpdateAsync</c> (Include AccountingPeriod).</summary>
    private async Task<AccountingPeriod> SeedPeriodAsync(int year, int month)
    {
        var start = new DateTime(year, month, 1);
        var period = AccountingPeriod.Create(year, month, start, start.AddMonths(1).AddDays(-1));
        period.SetAuditInfo("test", false);
        await using var ctx = _factory.CreateContext();
        ctx.AccountingPeriods.Add(period);
        await ctx.SaveChangesAsync();
        return period;
    }

    private UpdateDraftJournalEntryCommandHandler BuildUpdateHandler(
        IJournalEntryRepository repository, bool isFirm = true)
    {
        var lettering = new LetteringService(_factory, new TenantAmbientTransaction());
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string acc, CancellationToken _) =>
                ChartOfAccount.Create(acc, $"Compte {acc}", int.Parse(acc[..1]), null, AccountNatureType.Debit).Value);
        return new UpdateDraftJournalEntryCommandHandler(
            repository, chart.Object, ExistingThirdParties.Clients().Object, ExistingThirdParties.Suppliers().Object, new Mock<IAuditService>().Object,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = isFirm },
            lettering,
            new PassthroughTenantUnitOfWork(),
            new FakeExchangeRateResolver(),
            NullLogger<UpdateDraftJournalEntryCommandHandler>.Instance);
    }

    private static UpdateDraftJournalEntryRequest ClientLineRequest(Guid clientId, decimal debit, string label) => new()
    {
        Label = label,
        Lines = new[]
        {
            new ManualJournalLineRequest
            {
                AccountNumber = "4111", LineLabel = "Tiers", Debit = debit, Credit = 0m,
                ThirdPartyId = clientId, ThirdPartyKind = (int)ThirdPartyKind.Client
            },
            new ManualJournalLineRequest { AccountNumber = "5320000", LineLabel = "Contrepartie", Debit = 0m, Credit = debit }
        }
    };

    [Fact]
    public async Task ThirdPartyBalances_AfterFirmEditOfDraft_FollowEditedLines()
    {
        var clientId = SeedClient("Delta");
        var period = await SeedPeriodAsync(2026, 6);
        var draft = SeedEntryReturning(clientId, ThirdPartyKind.Client, debit: 300m, credit: 0m,
            status: JournalEntryStatus.Brouillon, accountingPeriodId: period.Id);

        var repository = new JournalEntryRepository(_factory);
        var editResult = await BuildUpdateHandler(repository).Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, ClientLineRequest(clientId, 800m, "Correction cabinet")),
            CancellationToken.None);
        Assert.True(editResult.IsSuccess, editResult.Error?.Description);

        var result = await _service.GetDirectoryAsync(null, null, includeInactive: false, 1, 50);

        // Solde tiers = mêmes règles brouillard que la balance auxiliaire (§1.4) : le montant
        // édité par le cabinet (800, et non plus 300) est reflété immédiatement.
        var client = result.Value.Items.Single(i => i.ThirdPartyId == clientId);
        Assert.Equal(800m, client.BalanceDebit);
    }
}
