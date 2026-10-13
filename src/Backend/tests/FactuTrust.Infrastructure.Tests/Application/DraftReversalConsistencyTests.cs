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

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// C5 : cohérence extourne ↔ brouillon.
/// — Supprimer un brouillon d'extourne restaure l'écriture d'origine (dé-marquage IsReversed).
/// — Un brouillon d'extourne n'est pas modifiable (miroir exact garanti à la création).
/// — L'annulation d'une facture dont l'écriture est encore en brouillon supprime le brouillon
///   au lieu de générer une contre-passation.
/// </summary>
public sealed class DraftReversalConsistencyTests
{
    private static IReadOnlyList<JournalLineInput> SaleLines(decimal amount = 100m) => new[]
    {
        new JournalLineInput("4111", "Client", amount, 0, null, ThirdPartyKind.None),
        new JournalLineInput("707", "Ventes", 0, amount, null, ThirdPartyKind.None)
    };

    private static IReadOnlyList<JournalLineInput> MirrorLines(decimal amount = 100m) => new[]
    {
        new JournalLineInput("4111", "Client", 0, amount, null, ThirdPartyKind.None),
        new JournalLineInput("707", "Ventes", amount, 0, null, ThirdPartyKind.None)
    };

    // ── Suppression / modification d'un brouillon d'extourne (InMemory + vrai repository) ──

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

    private static Mock<IChartOfAccountRepository> ChartMock()
    {
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string acc, CancellationToken _) =>
                ChartOfAccount.Create(acc, $"Compte {acc}", int.Parse(acc[..1]), null, AccountNatureType.Debit).Value);
        return chart;
    }

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
            repo, chart.Object, ExistingThirdParties.Clients().Object, ExistingThirdParties.Suppliers().Object, audit,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = isFirm },
            lettering,
            new PassthroughTenantUnitOfWork(),
            new FakeExchangeRateResolver(),
            NullLogger<UpdateDraftJournalEntryCommandHandler>.Instance);
    }

    private static UpdateDraftJournalEntryRequest BalancedRequest(decimal amount, string label) => new()
    {
        Label = label,
        Lines = new[]
        {
            new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = amount, Credit = 0m },
            new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Ventes", Debit = 0m, Credit = amount }
        }
    };

    /// <summary>La période doit exister en base : GetByIdAsync fait un Include(AccountingPeriod) requis.</summary>
    private static AccountingPeriod SeedPeriod(TestTenantDbContextFactory factory)
    {
        var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
        period.SetAuditInfo("test", false);
        using var ctx = factory.CreateContext();
        ctx.AccountingPeriods.Add(period);
        ctx.SaveChanges();
        return period;
    }

    private static (TestTenantDbContextFactory Factory, JournalEntry Original, JournalEntry ReversalDraft) SeedReversalPair()
    {
        var factory = new TestTenantDbContextFactory($"ReversalDb_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);

        var original = JournalEntry.Create(1, "JV", new DateTime(2026, 5, 10), "Vente", period.Id,
            false, "Manual", null, SaleLines(), initialStatus: JournalEntryStatus.Validee).Value;
        original.SetAuditInfo("test", false);

        var reversal = JournalEntry.Create(2, "JV", new DateTime(2026, 5, 10), "Extourne JV-1 : erreur", period.Id,
            false, "ManualReversal", original.Id, MirrorLines(), Money.DefaultCurrency,
            reversesEntryId: original.Id, initialStatus: JournalEntryStatus.Brouillon).Value;
        reversal.SetAuditInfo("test", false);

        original.MarkReversedBy(reversal.Id);

        using var ctx = factory.CreateContext();
        ctx.JournalEntries.AddRange(original, reversal);
        ctx.SaveChanges();
        return (factory, original, reversal);
    }

    [Fact]
    public async Task DeleteReversalDraft_RestoresOriginal()
    {
        var (factory, original, reversal) = SeedReversalPair();
        var repo = new JournalEntryRepository(factory);
        var handler = new DeleteDraftJournalEntryCommandHandler(repo, new Mock<IAuditService>().Object);

        var result = await handler.Handle(new DeleteDraftJournalEntryCommand(reversal.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        using var ctx = factory.CreateContext();
        Assert.Null(await ctx.JournalEntries.AsNoTracking().FirstOrDefaultAsync(e => e.Id == reversal.Id));
        var restored = await ctx.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == original.Id);
        Assert.False(restored.IsReversed);
        Assert.Null(restored.ReversedByEntryId);
    }

    [Fact]
    public async Task DeleteOrdinaryDraft_DoesNotTouchOtherEntries()
    {
        var factory = new TestTenantDbContextFactory($"ReversalDb_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var draft = JournalEntry.Create(1, "JOD", new DateTime(2026, 5, 10), "OD", period.Id,
            false, "Manual", null, SaleLines(), initialStatus: JournalEntryStatus.Brouillon).Value;
        draft.SetAuditInfo("test", false);
        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.Add(draft);
            seed.SaveChanges();
        }
        var handler = new DeleteDraftJournalEntryCommandHandler(new JournalEntryRepository(factory), new Mock<IAuditService>().Object);

        var result = await handler.Handle(new DeleteDraftJournalEntryCommand(draft.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        using var ctx = factory.CreateContext();
        Assert.Empty(ctx.JournalEntries.AsNoTracking().ToList());
    }

    [Fact]
    public async Task UpdateReversalDraft_Fails()
    {
        var (factory, _, reversal) = SeedReversalPair();
        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object);

        var request = new UpdateDraftJournalEntryRequest
        {
            Label = "Extourne modifiée",
            Lines = new[]
            {
                new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = 0m, Credit = 999m },
                new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Vente", Debit = 999m, Credit = 0m }
            }
        };

        var result = await handler.Handle(new UpdateDraftJournalEntryCommand(reversal.Id, request), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("miroir", result.Error.Description);
    }

    // ── Mode cabinet délégué (isFirm = true) : levée conditionnelle (D1, D4) ───────────

    [Fact]
    public async Task Update_ReversalDraft_FirmContext_Succeeds_AndKeepsReversesEntryId()
    {
        var (factory, original, reversal) = SeedReversalPair();
        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object, isFirm: true);

        var request = new UpdateDraftJournalEntryRequest
        {
            Label = "Extourne corrigée par le cabinet",
            Lines = new[]
            {
                new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = 0m, Credit = 150m },
                new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Ventes", Debit = 150m, Credit = 0m }
            }
        };

        var result = await handler.Handle(new UpdateDraftJournalEntryCommand(reversal.Id, request), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == reversal.Id);
        Assert.Equal(original.Id, reloaded.ReversesEntryId);
        Assert.Equal("ManualReversal", reloaded.SourceEntityType);
        Assert.Equal("Extourne corrigée par le cabinet", reloaded.Label);
        Assert.Equal(150m, reloaded.Lines.Single(l => l.AccountNumber == "707").DebitAmount.Amount);
    }

    /// <summary>
    /// Après édition cabinet d'un brouillon d'extourne, la suppression continue de restaurer
    /// l'écriture d'origine — l'édition n'a pas cassé le lien de cohérence extourne ↔ brouillon.
    /// </summary>
    [Fact]
    public async Task Delete_ReversalDraft_AfterFirmEdit_StillRestoresOriginal()
    {
        var (factory, original, reversal) = SeedReversalPair();
        var updateHandler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object, isFirm: true);

        var editResult = await updateHandler.Handle(
            new UpdateDraftJournalEntryCommand(reversal.Id, new UpdateDraftJournalEntryRequest
            {
                Label = "Extourne corrigée",
                Lines = new[]
                {
                    new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = 0m, Credit = 120m },
                    new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Ventes", Debit = 120m, Credit = 0m }
                }
            }),
            CancellationToken.None);
        Assert.True(editResult.IsSuccess, editResult.Error?.Description);

        var repo = new JournalEntryRepository(factory);
        var deleteHandler = new DeleteDraftJournalEntryCommandHandler(repo, new Mock<IAuditService>().Object);

        var result = await deleteHandler.Handle(new DeleteDraftJournalEntryCommand(reversal.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        using var ctx = factory.CreateContext();
        Assert.Null(await ctx.JournalEntries.AsNoTracking().FirstOrDefaultAsync(e => e.Id == reversal.Id));
        var restored = await ctx.JournalEntries.AsNoTracking().SingleAsync(e => e.Id == original.Id);
        Assert.False(restored.IsReversed);
        Assert.Null(restored.ReversedByEntryId);
    }

    /// <summary>
    /// Nature combinée : extourne (ReversesEntryId) d'une écriture caisse, avec lignes lettrées —
    /// le cabinet peut la modifier ; le délettrage automatique s'exécute et le lien d'extourne
    /// est conservé (D3 + D4 combinées).
    /// </summary>
    [Fact]
    public async Task Update_LetteredManualReversalOfCashEntry_FirmContext_Succeeds()
    {
        var factory = new TestTenantDbContextFactory($"ReversalDb_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var sourceOperationId = Guid.NewGuid();

        var cashOriginal = JournalEntry.Create(1, "JC", new DateTime(2026, 5, 10), "Vente comptoir — Espèces", period.Id,
            true, "CashOperation", sourceOperationId, SaleLines(119m), initialStatus: JournalEntryStatus.Validee).Value;
        cashOriginal.SetAuditInfo("test", false);

        var reversal = JournalEntry.Create(2, "JC", new DateTime(2026, 5, 10), "Extourne JC-1", period.Id,
            false, "ManualReversal", cashOriginal.Id, MirrorLines(119m), Money.DefaultCurrency,
            reversesEntryId: cashOriginal.Id, initialStatus: JournalEntryStatus.Brouillon).Value;
        reversal.SetAuditInfo("test", false);
        cashOriginal.MarkReversedBy(reversal.Id);

        var other = JournalEntry.Create(3, "JB", new DateTime(2026, 5, 20), "Règlement", period.Id,
            false, "Manual", null, new[]
            {
                new JournalLineInput("532", "Banque", 0m, 119m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 119m, 0m, null, ThirdPartyKind.None)
            }, initialStatus: JournalEntryStatus.Validee).Value;
        other.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.AddRange(cashOriginal, reversal, other);
            seed.SaveChanges();
        }

        var reversalLineId = reversal.Lines.Single(l => l.AccountNumber == "4111").Id;
        var otherLineId = other.Lines.Single(l => l.AccountNumber == "4111").Id;
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        Assert.True((await lettering.ManualLetterAsync(new[] { reversalLineId, otherLineId })).IsSuccess);

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object, isFirm: true);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(reversal.Id, new UpdateDraftJournalEntryRequest
            {
                Label = "Extourne corrigée par le cabinet",
                Lines = new[]
                {
                    new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = 0m, Credit = 150m },
                    new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Ventes", Debit = 150m, Credit = 0m }
                }
            }),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);

        using var ctx = factory.CreateContext();
        var reloaded = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == reversal.Id);
        Assert.Equal(cashOriginal.Id, reloaded.ReversesEntryId);
        Assert.All(reloaded.Lines, l => Assert.Null(l.LetteringCode));
        var reloadedOther = await ctx.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == otherLineId);
        Assert.Null(reloadedOther.LetteringCode);
    }

    /// <summary>
    /// Nature combinée en mode CLIENT : extourne de caisse lettrée doit échouer sur le PREMIER
    /// garde-fou déclenché dans l'ordre G1→G2→G3→G4→G5, soit G3 (miroir) — et ne produire AUCUN
    /// effet de bord : le lettrage et le lien d'extourne restent parfaitement intacts.
    /// </summary>
    [Fact]
    public async Task Update_CombinedNatureDraft_ClientContext_BlockedByFirstGuard_NoUnlettering()
    {
        var factory = new TestTenantDbContextFactory($"ReversalDb_{Guid.NewGuid()}");
        var period = SeedPeriod(factory);
        var sourceOperationId = Guid.NewGuid();

        var cashOriginal = JournalEntry.Create(1, "JC", new DateTime(2026, 5, 10), "Vente comptoir — Espèces", period.Id,
            true, "CashOperation", sourceOperationId, SaleLines(119m), initialStatus: JournalEntryStatus.Validee).Value;
        cashOriginal.SetAuditInfo("test", false);

        var reversal = JournalEntry.Create(2, "JC", new DateTime(2026, 5, 10), "Extourne JC-1", period.Id,
            false, "ManualReversal", cashOriginal.Id, MirrorLines(119m), Money.DefaultCurrency,
            reversesEntryId: cashOriginal.Id, initialStatus: JournalEntryStatus.Brouillon).Value;
        reversal.SetAuditInfo("test", false);
        cashOriginal.MarkReversedBy(reversal.Id);

        var other = JournalEntry.Create(3, "JB", new DateTime(2026, 5, 20), "Règlement", period.Id,
            false, "Manual", null, new[]
            {
                new JournalLineInput("532", "Banque", 0m, 119m, null, ThirdPartyKind.None),
                new JournalLineInput("4111", "Client", 119m, 0m, null, ThirdPartyKind.None)
            }, initialStatus: JournalEntryStatus.Validee).Value;
        other.SetAuditInfo("test", false);

        using (var seed = factory.CreateContext())
        {
            seed.JournalEntries.AddRange(cashOriginal, reversal, other);
            seed.SaveChanges();
        }

        var reversalLineId = reversal.Lines.Single(l => l.AccountNumber == "4111").Id;
        var otherLineId = other.Lines.Single(l => l.AccountNumber == "4111").Id;
        var lettering = new LetteringService(factory, new TenantAmbientTransaction());
        Assert.True((await lettering.ManualLetterAsync(new[] { reversalLineId, otherLineId })).IsSuccess);

        string letteredCode;
        using (var check = factory.CreateContext())
        {
            letteredCode = check.JournalEntryLines.AsNoTracking().Single(l => l.Id == reversalLineId).LetteringCode!;
        }

        var handler = BuildHandler(factory, ChartMock(), new Mock<IAuditService>().Object, isFirm: false);

        var result = await handler.Handle(
            new UpdateDraftJournalEntryCommand(reversal.Id, new UpdateDraftJournalEntryRequest
            {
                Label = "Tentative client",
                Lines = new[]
                {
                    new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = 0m, Credit = 150m },
                    new ManualJournalLineRequest { AccountNumber = "707", LineLabel = "Ventes", Debit = 150m, Credit = 0m }
                }
            }),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("miroir", result.Error.Description);

        using var ctx = factory.CreateContext();
        Assert.True(await ctx.LetteringGroups.AsNoTracking().AnyAsync(g => g.Code == letteredCode));
        var reloadedReversalLine = await ctx.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == reversalLineId);
        var reloadedOtherLine = await ctx.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == otherLineId);
        Assert.Equal(letteredCode, reloadedReversalLine.LetteringCode);
        Assert.Equal(letteredCode, reloadedOtherLine.LetteringCode);
        var reloadedReversal = await ctx.JournalEntries.SingleAsync(e => e.Id == reversal.Id);
        Assert.Equal(cashOriginal.Id, reloadedReversal.ReversesEntryId);
    }

    // ── Annulation de facture avec écriture d'origine en brouillon (Moq pur) ───────────────

    [Fact]
    public async Task CancelInvoice_WithDraftOriginal_DeletesDraftInsteadOfReversing()
    {
        var draftOriginal = JournalEntry.Create(1, "JV", new DateTime(2026, 5, 10), "Vente FAC-1", Guid.NewGuid(),
            true, "Invoice", Guid.NewGuid(), SaleLines(), initialStatus: JournalEntryStatus.Brouillon).Value;

        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.CountAsync(It.IsAny<CancellationToken>())).ReturnsAsync(180);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(x => x.GetBySourceAsync("InvoiceCancelled", It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((JournalEntry?)null);
        journals.Setup(x => x.GetBySourceAsync("Invoice", It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(draftOriginal);

        var periodService = new Mock<IAccountingPeriodService>();
        var withholding = new Mock<IWithholdingTaxRepository>();
        var ctxFactory = new Mock<ITenantDbContextFactory>();
        var settings = Options.Create(new AccountingSettings { BrouillardEnabled = true });

        var service = new AccountingService(
            chart.Object, periodService.Object, journals.Object, withholding.Object,
            new Mock<IDepreciationRateCategoryRepository>().Object,
            ctxFactory.Object, NullLogger<AccountingService>.Instance, settings);

        var result = await service.ReverseInvoiceSaleEntryAsync(Guid.NewGuid(), "FAC-1", CancellationToken.None);

        Assert.True(result.IsSuccess);
        journals.Verify(x => x.RemoveAsync(draftOriginal, It.IsAny<CancellationToken>()), Times.Once);
        journals.Verify(x => x.AddAsync(It.IsAny<JournalEntry>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.False(draftOriginal.IsReversed);
    }
}
