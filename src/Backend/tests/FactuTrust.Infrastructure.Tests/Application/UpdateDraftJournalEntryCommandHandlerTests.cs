using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;
using FactuTrust.Infrastructure.Tests.Fakes;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Édition unitaire d'un brouillon : lettrage bloqué, auto-généré JV autorisé,
/// EntryNumber / SourceEntityType inchangés (mode client) ; levée conditionnelle des
/// garde-fous G3/G4/G5 pour le cabinet comptable en contexte délégué, avec délettrage
/// automatique transactionnel (plan v3, tâche 4).
/// </summary>
public sealed class UpdateDraftJournalEntryCommandHandlerTests
{
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

    /// <summary>Mock <see cref="ICurrentUser"/> minimal : seul <see cref="IsAccountingFirmDelegatedContext"/> est paramétrable.</summary>
    private sealed class FakeCurrentUser : ICurrentUser
    {
        public bool IsAccountingFirmDelegatedContext { get; set; }
        public Guid? UserId => null;
        public string? Email => "test@example.com";
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

    /// <summary>Capture les appels <see cref="IAuditService.LogAsync"/> pour assertions fines (D6).</summary>
    private sealed class RecordingAuditService : IAuditService
    {
        public sealed record Entry(string Action, string EntityType, Guid? EntityId, object? OldValues, object? NewValues);
        public List<Entry> Entries { get; } = new();

        public Task LogAsync(
            string action, string entityType, Guid? entityId = null,
            object? oldValues = null, object? newValues = null, CancellationToken cancellationToken = default)
        {
            Entries.Add(new Entry(action, entityType, entityId, oldValues, newValues));
            return Task.CompletedTask;
        }

        public Task<string> GetLastHashAsync(CancellationToken cancellationToken = default) => Task.FromResult("hash");
    }

    private static IReadOnlyList<JournalLineInput> SaleLines(decimal amount = 100m) => new[]
    {
        new JournalLineInput("4111", "Client", amount, 0, null, ThirdPartyKind.None),
        new JournalLineInput("707", "Ventes", 0, amount, null, ThirdPartyKind.None)
    };

    private static AccountingPeriod SeedPeriod(TestTenantDbContextFactory factory)
    {
        var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
        period.SetAuditInfo("test", false);
        using var ctx = factory.CreateContext();
        ctx.AccountingPeriods.Add(period);
        ctx.SaveChanges();
        return period;
    }

    private static Mock<IChartOfAccountRepository> ChartMock()
    {
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string acc, CancellationToken _) =>
                ChartOfAccount.Create(acc, $"Compte {acc}", int.Parse(acc[..1]), null, AccountNatureType.Debit).Value);
        return chart;
    }

    private static UpdateDraftJournalEntryRequest BalancedRequest(decimal amount, string label) => new()
    {
        Label = label,
        Lines = new[]
        {
            new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = amount, Credit = 0m },
            new ManualJournalLineRequest { AccountNumber = "706", LineLabel = "Prestations", Debit = 0m, Credit = amount }
        }
    };

    /// <summary>Fabrique le handler cible avec ses collaborateurs réels (repo InMemory, vrai <see cref="LetteringService"/>,
    /// unité de travail passthrough) — modèle tâche 4 du plan v3.</summary>
    private static UpdateDraftJournalEntryCommandHandler BuildHandler(
        TestTenantDbContextFactory factory,
        Mock<IChartOfAccountRepository> chart,
        IAuditService audit,
        bool isFirm = false)
    {
        var repo = new JournalEntryRepository(factory);
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        return new UpdateDraftJournalEntryCommandHandler(
            repo, chart.Object, audit,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = isFirm },
            lettering,
            new PassthroughTenantUnitOfWork(),
            new FakeExchangeRateResolver(),
            NullLogger<UpdateDraftJournalEntryCommandHandler>.Instance);
    }

    // ── Mode client (isFirm = false) : garde-fous inchangés ────────────────────────────

    [Fact]
    public async Task Update_LetteredDraft_FailsAndLeavesLinesUnchanged()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var draft = JournalEntry.Create(3, "JV", new DateTime(2026, 8, 14), "Vente", period.Id,
            true, "Invoice", Guid.NewGuid(), SaleLines(100m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);
        draft.Lines.First().SetLetteringCode("AA");

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.Add(draft);
            seed.SaveChanges();
        }

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(200m, "Modifié")),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("Délettrez", result.Error.Description);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal("Vente", reloaded.Label);
        Assert.Equal(100m, reloaded.Lines.OrderBy(l => l.LineNumber).First().DebitAmount.Amount);
        Assert.Equal("AA", reloaded.Lines.First(l => l.LetteringCode == "AA").LetteringCode);
    }

    [Fact]
    public async Task Update_AutoGeneratedJvDraft_SucceedsWithoutChangingNumberOrSource()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var sourceId = Guid.NewGuid();
        var draft = JournalEntry.Create(19, "JV", new DateTime(2026, 8, 14), "Client — FAC-2026-000019", period.Id,
            true, "Invoice", sourceId, SaleLines(250m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.Add(draft);
            seed.SaveChanges();
        }

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(250m, "Client — FAC-2026-000019 (reclassé)")),
            CancellationToken.None);

        Assert.True(result.IsSuccess);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal(19, reloaded.EntryNumber);
        Assert.Equal("JV", reloaded.JournalCode);
        Assert.Equal("Invoice", reloaded.SourceEntityType);
        Assert.Equal(sourceId, reloaded.SourceEntityId);
        Assert.True(reloaded.IsAutoGenerated);
        Assert.Equal(JournalEntryStatus.Brouillon, reloaded.Status);
        Assert.Equal("Client — FAC-2026-000019 (reclassé)", reloaded.Label);
        Assert.Contains(reloaded.Lines, l => l.AccountNumber == "706");
    }

    /// <summary>
    /// §6.7/§9.7 : un brouillon TVA caisse (SourceEntityType="CashOperation") ne peut pas être
    /// réécrit manuellement — sinon les lignes 707/436711 divergeraient du VatRate de l'opération
    /// jointe (déclaration TVA « Brouillon inclus »). Seule l'extourne / l'annulation de
    /// l'opération est permise (mode client — levé pour le cabinet, voir plus bas).
    /// </summary>
    [Fact]
    public async Task Update_CashOperationSourcedDraft_FailsWithValidationError()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var sourceOperationId = Guid.NewGuid();
        var draft = JournalEntry.Create(31, "JC", new DateTime(2026, 8, 14), "Vente comptoir — Espèces", period.Id,
            true, "CashOperation", sourceOperationId, SaleLines(119m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.Add(draft);
            seed.SaveChanges();
        }

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(200m, "Modifié")),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("générée automatiquement depuis une opération de caisse", result.Error.Description);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal("Vente comptoir — Espèces", reloaded.Label);
        Assert.Equal(119m, reloaded.Lines.OrderBy(l => l.LineNumber).First().DebitAmount.Amount);
    }

    /// <summary>
    /// Non-régression : un brouillon sans source (saisie manuelle, <c>SourceEntityType</c> null)
    /// reste modifiable — la garde §6.7 ne s'applique qu'à <c>SourceEntityType = "CashOperation"</c>.
    /// </summary>
    [Fact]
    public async Task Update_DraftWithoutSource_RemainsEditable()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var draft = JournalEntry.Create(41, "JV", new DateTime(2026, 8, 14), "Saisie manuelle", period.Id,
            false, null, null, SaleLines(80m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.Add(draft);
            seed.SaveChanges();
        }

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(80m, "Saisie manuelle (corrigée)")),
            CancellationToken.None);

        Assert.True(result.IsSuccess);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal("Saisie manuelle (corrigée)", reloaded.Label);
        Assert.Null(reloaded.SourceEntityType);
    }

    // ── Mode cabinet délégué (isFirm = true) : levée conditionnelle (D1) ───────────────

    [Fact]
    public async Task Update_CashOperationDraft_FirmContext_Succeeds_AndKeepsSourceLink()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var sourceOperationId = Guid.NewGuid();
        var draft = JournalEntry.Create(31, "JC", new DateTime(2026, 8, 14), "Vente comptoir — Espèces", period.Id,
            true, "CashOperation", sourceOperationId, SaleLines(119m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.Add(draft);
            seed.SaveChanges();
        }

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object, isFirm: true);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(200m, "Corrigé par le cabinet")),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal("CashOperation", reloaded.SourceEntityType);
        Assert.Equal(sourceOperationId, reloaded.SourceEntityId);
        Assert.Equal(31, reloaded.EntryNumber);
        Assert.Equal("Corrigé par le cabinet", reloaded.Label);
        Assert.Equal(200m, reloaded.Lines.Single(l => l.AccountNumber == "4111").DebitAmount.Amount);
    }

    /// <summary>
    /// D3 : un groupe couvrant une ligne d'une AUTRE écriture libère TOUTES ses lignes — comme le
    /// délettrage manuel. L'audit <c>DraftUpdated</c> auto-suffisant porte les groupes délettrés ;
    /// l'audit <c>Unlettered</c> complémentaire est aussi émis.
    /// </summary>
    [Fact]
    public async Task Update_LetteredDraft_FirmContext_UnlettersGroupsThenUpdates()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);

        var draft = JournalEntry.Create(3, "JV", new DateTime(2026, 8, 14), "Vente", period.Id,
            true, "Invoice", Guid.NewGuid(), SaleLines(100m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);

        // Autre écriture (validée), lignes sur le même compte 4111, montant miroir pour équilibrer.
        var other = JournalEntry.Create(4, "JB", new DateTime(2026, 8, 20), "Règlement", period.Id,
            false, "Manual", null, new[]
            {
                new JournalLineInput("532", "Banque", 100m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 0m, 100m, null, ThirdPartyKind.None)
            }, initialStatus: JournalEntryStatus.Validee).Value;
        other.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.AddRange(draft, other);
            seed.SaveChanges();
        }

        var draftLineId = draft.Lines.Single(l => l.AccountNumber == "4111").Id;
        var otherLineId = other.Lines.Single(l => l.AccountNumber == "4111").Id;
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        var lettered = await lettering.ManualLetterAsync(new[] { draftLineId, otherLineId });
        Assert.True(lettered.IsSuccess, lettered.Error?.Description);

        string letteredCode;
        using (var check = factory.CreateContext())
        {
            letteredCode = check.JournalEntryLines.AsNoTracking().Single(l => l.Id == draftLineId).LetteringCode!;
        }

        var audit = new RecordingAuditService();
        var handler = BuildHandler(factory, ChartMock(), audit, isFirm: true);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(150m, "Modifié par le cabinet")),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);

        using var ctx = factory.CreateContext();
        var reloadedOther = await ctx.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == otherLineId);
        Assert.Null(reloadedOther.LetteringCode);
        Assert.False(await ctx.LetteringGroups.AsNoTracking().AnyAsync(g => g.Code == letteredCode));

        var reloadedDraft = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal("Modifié par le cabinet", reloadedDraft.Label);
        Assert.All(reloadedDraft.Lines, l => Assert.Null(l.LetteringCode));

        Assert.Single(audit.Entries, e => e.Action == AuditActions.Accounting.DraftUpdated);
        Assert.Contains(audit.Entries, e => e.Action == AuditActions.Accounting.Unlettered);
    }

    /// <summary>Nature combinée : brouillon caisse ET lettré — le cabinet peut le modifier ; le
    /// délettrage automatique s'exécute et le lien source caisse est conservé.</summary>
    [Fact]
    public async Task Update_LetteredCashDraft_FirmContext_Succeeds_AndUnletters()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var sourceOperationId = Guid.NewGuid();

        var draft = JournalEntry.Create(31, "JC", new DateTime(2026, 8, 14), "Vente comptoir — Espèces", period.Id,
            true, "CashOperation", sourceOperationId, SaleLines(119m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);

        var other = JournalEntry.Create(4, "JB", new DateTime(2026, 8, 20), "Règlement", period.Id,
            false, "Manual", null, new[]
            {
                new JournalLineInput("532", "Banque", 119m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 0m, 119m, null, ThirdPartyKind.None)
            }, initialStatus: JournalEntryStatus.Validee).Value;
        other.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.AddRange(draft, other);
            seed.SaveChanges();
        }

        var draftLineId = draft.Lines.Single(l => l.AccountNumber == "4111").Id;
        var otherLineId = other.Lines.Single(l => l.AccountNumber == "4111").Id;
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        Assert.True((await lettering.ManualLetterAsync(new[] { draftLineId, otherLineId })).IsSuccess);

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object, isFirm: true);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(200m, "Corrigé caisse+lettré")),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal("CashOperation", reloaded.SourceEntityType);
        Assert.Equal(sourceOperationId, reloaded.SourceEntityId);
        Assert.All(reloaded.Lines, l => Assert.Null(l.LetteringCode));
        var reloadedOther = await ctx.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == otherLineId);
        Assert.Null(reloadedOther.LetteringCode);
    }

    [Fact]
    public async Task Update_NonDraft_FirmContext_StillBlocked()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var validated = JournalEntry.Create(5, "JV", new DateTime(2026, 8, 14), "Vente validée", period.Id,
            false, "Manual", null, SaleLines(100m),
            initialStatus: JournalEntryStatus.Validee).Value;
        validated.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.Add(validated);
            seed.SaveChanges();
        }

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object, isFirm: true);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(validated.Id, BalancedRequest(200m, "Modifié")),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("brouillon", result.Error.Description);
    }

    /// <summary>
    /// D6 : un seul enregistrement <c>DraftUpdated</c> fait foi et porte l'intégralité de la trace
    /// (délettrage, override cabinet, totaux avant/après) — même en l'absence d'autre audit.
    /// </summary>
    [Fact]
    public async Task Update_FirmContext_AuditDraftUpdated_IsSelfSufficient()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);

        var draft = JournalEntry.Create(3, "JV", new DateTime(2026, 8, 14), "Vente", period.Id,
            true, "Invoice", Guid.NewGuid(), SaleLines(100m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);

        var other = JournalEntry.Create(4, "JB", new DateTime(2026, 8, 20), "Règlement", period.Id,
            false, "Manual", null, new[]
            {
                new JournalLineInput("532", "Banque", 100m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 0m, 100m, null, ThirdPartyKind.None)
            }, initialStatus: JournalEntryStatus.Validee).Value;
        other.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.AddRange(draft, other);
            seed.SaveChanges();
        }

        var draftLineId = draft.Lines.Single(l => l.AccountNumber == "4111").Id;
        var otherLineId = other.Lines.Single(l => l.AccountNumber == "4111").Id;
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        Assert.True((await lettering.ManualLetterAsync(new[] { draftLineId, otherLineId })).IsSuccess);

        var audit = new RecordingAuditService();
        var handler = BuildHandler(factory, ChartMock(), audit, isFirm: true);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(150m, "Modifié par le cabinet")),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);

        var draftUpdated = Assert.Single(audit.Entries, e => e.Action == AuditActions.Accounting.DraftUpdated);
        var newValues = draftUpdated.NewValues!;
        var type = newValues.GetType();

        var unletteredGroups = Assert.IsAssignableFrom<System.Collections.IEnumerable>(
            type.GetProperty("UnletteredGroups")!.GetValue(newValues));
        Assert.NotEmpty(unletteredGroups.Cast<object>());

        Assert.True((bool)type.GetProperty("FirmDelegatedOverride")!.GetValue(newValues)!);
        Assert.Equal(100m, (decimal)type.GetProperty("OldTotalDebit")!.GetValue(newValues)!);
        Assert.Equal(150m, (decimal)type.GetProperty("NewTotalDebit")!.GetValue(newValues)!);
        Assert.True((bool)type.GetProperty("WasLettered")!.GetValue(newValues)!);
    }

    /// <summary>
    /// D8/D7 (revue PR 1, 2e passe) : l'édition d'un brouillon lettré par le cabinet passe par le
    /// délettrage automatique — si une ligne du groupe est en période verrouillée, le délettrage
    /// est refusé (<c>LETTERING_PERIOD_LOCKED</c>) et TOUTE la mise à jour échoue sans aucun effet
    /// de bord : brouillon inchangé, groupe et codes de lettrage intacts.
    /// </summary>
    [Fact]
    public async Task Update_LetteredDraft_InLockedPeriod_FailsWithoutSideEffects()
    {
        var factory = new TestTenantDbContextFactory($"UpdateDraft_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var draft = JournalEntry.Create(41, "JV", new DateTime(2026, 8, 14), "Vente", period.Id,
            false, "Manual", null, SaleLines(100m),
            initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);
        var other = JournalEntry.Create(42, "JB", new DateTime(2026, 8, 15), "Règlement", period.Id,
            false, "Manual", null,
            new[]
            {
                new JournalLineInput("532", "Banque", 100m, 0m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 0m, 100m, null, ThirdPartyKind.None)
            }, initialStatus: JournalEntryStatus.Validee).Value;
        other.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.AddRange(draft, other);
            seed.SaveChanges();
        }

        var draftLineId = draft.Lines.Single(l => l.AccountNumber == "4111").Id;
        var otherLineId = other.Lines.Single(l => l.AccountNumber == "4111").Id;
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        var lettered = await lettering.ManualLetterAsync(new[] { draftLineId, otherLineId });
        Assert.True(lettered.IsSuccess);
        var code = lettered.Value.Code;

        // Verrou de l'exercice APRÈS le lettrage (D8, cause « exercice verrouillé »).
        using (var seed = factory.CreateContext())
        {
            seed.AccountingYearLocks.Add(AccountingYearLock.Create(2026, "test"));
            seed.SaveChanges();
        }

        var handler = BuildHandler(factory, ChartMock(), new RecordingAuditService(), isFirm: true);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(draft.Id, BalancedRequest(150m, "Modifié par le cabinet")),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(
            FactuTrust.Application.Features.Accounting.Lettering.LetteringErrorCodes.PeriodLocked,
            result.Error.Code);

        // Aucun effet de bord : brouillon intact, groupe et codes de lettrage intacts.
        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draft.Id);
        Assert.Equal("Vente", reloaded.Label);
        Assert.Equal(100m, reloaded.Lines.OrderBy(l => l.LineNumber).First().DebitAmount.Amount);
        Assert.Equal(code, reloaded.Lines.First(l => l.AccountNumber == "4111").LetteringCode);
        Assert.True(await ctx.LetteringGroups.AnyAsync(g => g.Code == code));
        var otherLine = await ctx.JournalEntryLines.SingleAsync(l => l.Id == otherLineId);
        Assert.Equal(code, otherLine.LetteringCode);
    }
}
