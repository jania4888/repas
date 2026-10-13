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
using FactuTrust.Infrastructure.Tests.Fixtures;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;
using FactuTrust.Infrastructure.Tests.Fakes;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Tâche 5 (plan v3) : preuve d'atomicité et de concurrence réelles pour l'édition de brouillon
/// par le cabinet comptable (D7). SQL Server requis (LocalDB éphémère ou
/// <c>FACTUTRUST_TEST_SQL_CONNECTION</c>) : InMemory ignore les verrous/transactions, seul un
/// vrai moteur relationnel peut démontrer que <c>GetByIdForUpdateAsync</c> (XLOCK, HOLDLOCK)
/// bloque les lectures de décision ordinaires de la validation et du lettrage concurrents.
/// </summary>
public sealed class UpdateDraftJournalEntryConcurrencyTests : IDisposable
{
    private readonly SqlTestDatabase _sqlDb = new(nameof(UpdateDraftJournalEntryConcurrencyTests));
    private readonly string? _connectionString;
    private readonly bool _canRun;

    public UpdateDraftJournalEntryConcurrencyTests()
    {
        _connectionString = _sqlDb.ConnectionString;
        _canRun = _sqlDb.CanRun;
    }

    public void Dispose() => _sqlDb.Dispose();

    /// <summary>
    /// Regroupe une connexion/transaction ambiante indépendante (une par "acteur" DI dans les
    /// tests ci-dessous) : un vrai <see cref="TenantDbContextFactory"/> + <see cref="TenantAmbientTransaction"/>
    /// dédiés, pour que deux acteurs concurrents ouvrent bien DEUX connexions/sessions SQL
    /// distinctes sur la même base — condition nécessaire pour observer un blocage de verrou réel.
    /// </summary>
    private sealed class Scope
    {
        public TenantAmbientTransaction Ambient { get; } = new();
        public TenantDbContextFactory Factory { get; }
        public TenantUnitOfWork UnitOfWork { get; }
        public JournalEntryRepository JournalEntries { get; }
        public LetteringService Lettering { get; }

        public Scope(string connectionString)
        {
            var tenantContext = new Mock<ITenantContext>();
            tenantContext.SetupGet(c => c.ConnectionString).Returns(connectionString);

            var hostEnvironment = new Mock<IHostEnvironment>();
            hostEnvironment.SetupGet(e => e.EnvironmentName).Returns(Environments.Development);

            Factory = new TenantDbContextFactory(
                tenantContext.Object,
                new Mock<IMediator>().Object,
                Ambient,
                NullLogger<TenantDbContext>.Instance,
                NullLoggerFactory.Instance,
                new ConfigurationBuilder().Build(),
                hostEnvironment.Object);
            UnitOfWork = new TenantUnitOfWork(Factory, Ambient, NullLogger<TenantUnitOfWork>.Instance);
            JournalEntries = new JournalEntryRepository(Factory);
            Lettering = new LetteringService(Factory, Ambient);
        }
    }

    /// <summary>Mock <see cref="ICurrentUser"/> minimal : seul <c>IsAccountingFirmDelegatedContext</c> est paramétrable.</summary>
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

    private static Mock<IChartOfAccountRepository> ChartMock()
    {
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string acc, CancellationToken _) =>
                ChartOfAccount.Create(acc, $"Compte {acc}", int.Parse(acc[..1]), null, AccountNatureType.Debit).Value);
        return chart;
    }

    private static IReadOnlyList<JournalLineInput> BalancedLines(decimal amount = 100m) => new[]
    {
        new JournalLineInput("4111", "Client", amount, 0, null, ThirdPartyKind.None),
        new JournalLineInput("706", "Prestations", 0, amount, null, ThirdPartyKind.None)
    };

    private static UpdateDraftJournalEntryRequest BalancedRequest(decimal amount, string label) => new()
    {
        Label = label,
        Lines = new[]
        {
            new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = amount, Credit = 0m },
            new ManualJournalLineRequest { AccountNumber = "706", LineLabel = "Prestations", Debit = 0m, Credit = amount }
        }
    };

    private static AccountingPeriod SeedPeriod(TenantDbContext ctx)
    {
        var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
        period.SetAuditInfo("test", false);
        ctx.AccountingPeriods.Add(period);
        return period;
    }

    private static UpdateDraftJournalEntryCommandHandler BuildEditHandler(Scope scope, bool isFirm) =>
        new(scope.JournalEntries, ChartMock().Object,
            Fakes.ExistingThirdParties.Clients().Object, Fakes.ExistingThirdParties.Suppliers().Object,
            new Mock<IAuditService>().Object,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = isFirm },
            scope.Lettering, scope.UnitOfWork,
            new FakeExchangeRateResolver(),
            NullLogger<UpdateDraftJournalEntryCommandHandler>.Instance);

    private static ValidateJournalEntryCommandHandler BuildValidateHandler(Scope scope) =>
        new(scope.JournalEntries, new Mock<IAuditService>().Object,
            new FakeCurrentUser { IsAccountingFirmDelegatedContext = true });

    // ── Test 1 : atomicité — un échec de rééquilibrage annule aussi le délettrage automatique ──

    [Fact]
    public async Task Unlettering_IsRolledBack_WhenUnbalancedLinesRejectedInsideTransaction()
    {
        if (!_canRun) return;

        var editScope = new Scope(_connectionString!);

        Guid draftId;
        Guid draftLineId;
        Guid counterLineId;
        string letteringCode;

        using (var ctx = editScope.Factory.CreateIsolatedContext())
        {
            var period = SeedPeriod(ctx);

            var draft = JournalEntry.Create(1, "JOD", new DateTime(2026, 8, 3), "Vente",
                period.Id, false, null, null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 100m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("706", "Prestations", 0m, 100m, null, ThirdPartyKind.None)
                },
                initialStatus: JournalEntryStatus.Brouillon).Value;
            draft.SetAuditInfo("test", false);

            var counterparty = JournalEntry.Create(2, "JB", new DateTime(2026, 8, 4), "Encaissement",
                period.Id, false, null, null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 0m, 100m, null, ThirdPartyKind.None),
                    new JournalLineInput("512", "Banque", 100m, 0m, null, ThirdPartyKind.None)
                }).Value;
            counterparty.SetAuditInfo("test", false);

            ctx.JournalEntries.AddRange(draft, counterparty);
            await ctx.SaveChangesAsync();

            draftId = draft.Id;
            draftLineId = draft.Lines.Single(l => l.AccountNumber == "4111").Id;
            counterLineId = counterparty.Lines.Single(l => l.AccountNumber == "4111").Id;

            var letterResult = await editScope.Lettering.ManualLetterAsync(new[] { draftLineId, counterLineId });
            Assert.True(letterResult.IsSuccess);

            letteringCode = await ctx.JournalEntryLines.AsNoTracking()
                .Where(l => l.Id == draftLineId)
                .Select(l => l.LetteringCode!)
                .SingleAsync();
        }

        var handler = BuildEditHandler(editScope, isFirm: true);

        // Débit 100 / crédit 50 : passe le contrôle de comptes (avant transaction) mais échoue le
        // rééquilibrage (BuildLines, DANS la transaction) — après le délettrage automatique.
        var unbalanced = new UpdateDraftJournalEntryRequest
        {
            Label = "Modifié (rejeté)",
            Lines = new[]
            {
                new ManualJournalLineRequest { AccountNumber = "4111", LineLabel = "Client", Debit = 100m, Credit = 0m },
                new ManualJournalLineRequest { AccountNumber = "706", LineLabel = "Prestations", Debit = 0m, Credit = 50m }
            }
        };

        var result = await handler.Handle(new UpdateDraftJournalEntryCommand(draftId, unbalanced), CancellationToken.None);

        Assert.True(result.IsFailure);

        await using var verify = editScope.Factory.CreateIsolatedContext();
        var reloaded = await verify.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == draftId);
        Assert.Equal("Vente", reloaded.Label);
        Assert.Equal(letteringCode, reloaded.Lines.Single(l => l.AccountNumber == "4111").LetteringCode);
        Assert.True(await verify.LetteringGroups.AnyAsync(g => g.Code == letteringCode));
        Assert.Equal(letteringCode, await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.Id == counterLineId).Select(l => l.LetteringCode).SingleAsync());
    }

    // ── Test 2 : le XLOCK de l'édition bloque la lecture de décision de la validation ──────────

    [Fact]
    public async Task FirmUpdate_HoldsXLock_ConcurrentValidationDecisionRead_BlocksUntilCommit_ThenValidatesEditedEntry()
    {
        if (!_canRun) return;

        var editScope = new Scope(_connectionString!);
        var concurrentScope = new Scope(_connectionString!);

        Guid entryId;
        using (var ctx = editScope.Factory.CreateIsolatedContext())
        {
            var period = SeedPeriod(ctx);
            var entry = JournalEntry.Create(1, "JOD", new DateTime(2026, 8, 3), "Initial",
                period.Id, false, null, null, BalancedLines(100m),
                initialStatus: JournalEntryStatus.Brouillon).Value;
            entry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(entry);
            await ctx.SaveChangesAsync();
            entryId = entry.Id;
        }

        var lockHeldTcs = new TaskCompletionSource();
        var proceedTcs = new TaskCompletionSource();

        var editTask = Task.Run(() => editScope.UnitOfWork.ExecuteAsync(async ct =>
        {
            var entry = await editScope.JournalEntries.GetByIdForUpdateAsync(entryId, ct);
            lockHeldTcs.TrySetResult();
            await proceedTcs.Task;
            return await editScope.JournalEntries.MutateAsync(
                entryId,
                e => e.UpdateDraftLines("Modifié (édition cabinet)", BalancedLines(250m)),
                ct);
        }));

        await lockHeldTcs.Task;

        var validateHandler = BuildValidateHandler(concurrentScope);
        var validationTask = Task.Run(() => validateHandler.Handle(new ValidateJournalEntryCommand(entryId), CancellationToken.None));

        await Task.WhenAny(validationTask, Task.Delay(TimeSpan.FromSeconds(1)));
        Assert.False(validationTask.IsCompleted); // toujours bloqué : le XLOCK tient la lecture de décision

        proceedTcs.SetResult();

        var editResult = await editTask;
        Assert.True(editResult.IsSuccess);

        var validationResult = await validationTask;
        Assert.True(validationResult.IsSuccess);

        await using var verify = editScope.Factory.CreateIsolatedContext();
        var reloaded = await verify.JournalEntries.Include(e => e.Lines).SingleAsync(e => e.Id == entryId);
        Assert.Equal(JournalEntryStatus.Validee, reloaded.Status);
        Assert.Equal("Modifié (édition cabinet)", reloaded.Label);
        Assert.Equal(250m, reloaded.Lines.Single(l => l.AccountNumber == "4111").DebitAmount.Amount);
    }

    // ── Test 3 : la validation commitée en premier ferme la porte à l'édition (G1 relu verrouillé) ─

    [Fact]
    public async Task Validation_CommitsFirst_FirmUpdate_RejectedByStatusGuard()
    {
        if (!_canRun) return;

        var scope = new Scope(_connectionString!);

        Guid entryId;
        using (var ctx = scope.Factory.CreateIsolatedContext())
        {
            var period = SeedPeriod(ctx);
            var entry = JournalEntry.Create(1, "JOD", new DateTime(2026, 8, 3), "Initial",
                period.Id, false, null, null, BalancedLines(100m),
                initialStatus: JournalEntryStatus.Brouillon).Value;
            entry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(entry);
            await ctx.SaveChangesAsync();
            entryId = entry.Id;
        }

        var validateHandler = BuildValidateHandler(scope);
        var validationResult = await validateHandler.Handle(new ValidateJournalEntryCommand(entryId), CancellationToken.None);
        Assert.True(validationResult.IsSuccess);

        var editHandler = BuildEditHandler(scope, isFirm: true);
        var editResult = await editHandler.Handle(
            new UpdateDraftJournalEntryCommand(entryId, BalancedRequest(200m, "Édition tardive")),
            CancellationToken.None);

        Assert.True(editResult.IsFailure);
        Assert.Contains("Seule une écriture en brouillon peut être modifiée", editResult.Error.Description);
    }

    // ── Test 4 : la lecture de décision du lettrage concurrent bloque aussi, et échoue proprement
    // après le commit de l'édition (ligne remplacée introuvable) — aucun groupe orphelin créé ────

    [Fact]
    public async Task ConcurrentLettering_DecisionRead_BlocksUntilCommit_NoOrphanGroup()
    {
        if (!_canRun) return;

        var editScope = new Scope(_connectionString!);
        var concurrentScope = new Scope(_connectionString!);

        Guid entryAId, lineA4111Id, lineB4111Id;
        using (var ctx = editScope.Factory.CreateIsolatedContext())
        {
            var period = SeedPeriod(ctx);

            var entryA = JournalEntry.Create(1, "JOD", new DateTime(2026, 8, 3), "Entrée A",
                period.Id, false, null, null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 100m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("706", "Prestations", 0m, 100m, null, ThirdPartyKind.None)
                },
                initialStatus: JournalEntryStatus.Brouillon).Value;
            entryA.SetAuditInfo("test", false);

            var entryB = JournalEntry.Create(2, "JB", new DateTime(2026, 8, 4), "Entrée B",
                period.Id, false, null, null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 0m, 100m, null, ThirdPartyKind.None),
                    new JournalLineInput("512", "Banque", 100m, 0m, null, ThirdPartyKind.None)
                }).Value;
            entryB.SetAuditInfo("test", false);

            ctx.JournalEntries.AddRange(entryA, entryB);
            await ctx.SaveChangesAsync();

            entryAId = entryA.Id;
            lineA4111Id = entryA.Lines.Single(l => l.AccountNumber == "4111").Id;
            lineB4111Id = entryB.Lines.Single(l => l.AccountNumber == "4111").Id;
        }

        var lockHeldTcs = new TaskCompletionSource();
        var proceedTcs = new TaskCompletionSource();

        var editTask = Task.Run(() => editScope.UnitOfWork.ExecuteAsync(async ct =>
        {
            var entry = await editScope.JournalEntries.GetByIdForUpdateAsync(entryAId, ct);
            lockHeldTcs.TrySetResult();
            await proceedTcs.Task;
            // Remplace les lignes : l'ancienne ligne "4111" (lineA4111Id) est physiquement
            // supprimée par cascade EF, une nouvelle ligne "4111" (nouvel Id) est insérée.
            return await editScope.JournalEntries.MutateAsync(
                entryAId,
                e => e.UpdateDraftLines("Entrée A (éditée)", new[]
                {
                    new JournalLineInput("4111", "Client", 250m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("706", "Prestations", 0m, 250m, null, ThirdPartyKind.None)
                }),
                ct);
        }));

        await lockHeldTcs.Task;

        var letteringTask = Task.Run(() =>
            concurrentScope.Lettering.ManualLetterAsync(new[] { lineA4111Id, lineB4111Id }));

        await Task.WhenAny(letteringTask, Task.Delay(TimeSpan.FromSeconds(1)));
        Assert.False(letteringTask.IsCompleted); // toujours bloqué : lecture de décision du lettrage sous XLOCK

        proceedTcs.SetResult();

        var editResult = await editTask;
        Assert.True(editResult.IsSuccess);

        var letteringResult = await letteringTask;
        Assert.True(letteringResult.IsFailure);
        Assert.Contains("introuvables", letteringResult.Error.Description);

        await using var verify = editScope.Factory.CreateIsolatedContext();
        Assert.Equal(0, await verify.LetteringGroups.CountAsync());
        Assert.False(await verify.JournalEntryLines.AnyAsync(l => l.Id == lineA4111Id)); // ancienne ligne bien supprimée
    }

    // ── Test 5 (variante) : un lettrage commité en premier est vu et auto-délettré par l'édition ─

    [Fact]
    public async Task Lettering_CommitsFirst_FirmUpdate_SeesLetteringCodes_AutoUnletters()
    {
        if (!_canRun) return;

        var scope = new Scope(_connectionString!);

        Guid entryAId, lineA4111Id, lineB4111Id;
        using (var ctx = scope.Factory.CreateIsolatedContext())
        {
            var period = SeedPeriod(ctx);

            var entryA = JournalEntry.Create(1, "JOD", new DateTime(2026, 8, 3), "Entrée A",
                period.Id, false, null, null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 100m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("706", "Prestations", 0m, 100m, null, ThirdPartyKind.None)
                },
                initialStatus: JournalEntryStatus.Brouillon).Value;
            entryA.SetAuditInfo("test", false);

            var entryB = JournalEntry.Create(2, "JB", new DateTime(2026, 8, 4), "Entrée B",
                period.Id, false, null, null,
                new[]
                {
                    new JournalLineInput("4111", "Client", 0m, 100m, null, ThirdPartyKind.None),
                    new JournalLineInput("512", "Banque", 100m, 0m, null, ThirdPartyKind.None)
                }).Value;
            entryB.SetAuditInfo("test", false);

            ctx.JournalEntries.AddRange(entryA, entryB);
            await ctx.SaveChangesAsync();

            entryAId = entryA.Id;
            lineA4111Id = entryA.Lines.Single(l => l.AccountNumber == "4111").Id;
            lineB4111Id = entryB.Lines.Single(l => l.AccountNumber == "4111").Id;
        }

        var letterResult = await scope.Lettering.ManualLetterAsync(new[] { lineA4111Id, lineB4111Id });
        Assert.True(letterResult.IsSuccess);

        string letteringCode;
        using (var ctx = scope.Factory.CreateIsolatedContext())
        {
            letteringCode = await ctx.JournalEntryLines.AsNoTracking()
                .Where(l => l.Id == lineA4111Id)
                .Select(l => l.LetteringCode!)
                .SingleAsync();
        }

        var editHandler = BuildEditHandler(scope, isFirm: true);
        var editResult = await editHandler.Handle(
            new UpdateDraftJournalEntryCommand(entryAId, BalancedRequest(300m, "Entrée A (éditée par le cabinet)")),
            CancellationToken.None);

        Assert.True(editResult.IsSuccess);

        await using var verify = scope.Factory.CreateIsolatedContext();
        Assert.False(await verify.LetteringGroups.AnyAsync(g => g.Code == letteringCode));
        var lineB = await verify.JournalEntryLines.AsNoTracking().SingleAsync(l => l.Id == lineB4111Id);
        Assert.Null(lineB.LetteringCode);
    }
}
