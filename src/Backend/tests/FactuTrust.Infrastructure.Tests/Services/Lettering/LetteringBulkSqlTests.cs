using System.Collections.Concurrent;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Application.Features.Accounting.Validators;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Tests.Fixtures;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// p3-13 : lettrage en masse contre SQL Server réel. Chaque groupe passe par le vrai validator et
/// le vrai handler <see cref="LetterAccountEntriesCommandHandler"/>, puis par
/// <see cref="LetteringService"/> (transaction Serializable isolée). Sauté sans SQL Server.
/// </summary>
[Collection(SqlServerSerialCollection.Name)]
public sealed class LetteringBulkSqlTests : IDisposable
{
    private readonly SqlTestDatabase _sqlDb = new(nameof(LetteringBulkSqlTests));
    private readonly TenantAmbientTransaction _ambient = new();
    private readonly TenantDbContextFactory? _factory;
    private readonly ConcurrentQueue<(string Action, Guid? EntityId, object? Values)> _audits = new();
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Guid _userId = Guid.NewGuid();
    private Guid _periodId;
    private int _entryNumber;

    public LetteringBulkSqlTests()
    {
        if (!_sqlDb.CanRun)
            return;

        var tenantContext = new Mock<ITenantContext>();
        tenantContext.SetupGet(c => c.ConnectionString).Returns(_sqlDb.ConnectionString);
        var hostEnvironment = new Mock<IHostEnvironment>();
        hostEnvironment.SetupGet(e => e.EnvironmentName).Returns(Environments.Development);
        _factory = new TenantDbContextFactory(
            tenantContext.Object, new Mock<IMediator>().Object, _ambient,
            NullLogger<TenantDbContext>.Instance, NullLoggerFactory.Instance,
            new ConfigurationBuilder().Build(), hostEnvironment.Object);

        using var ctx = _factory.CreateIsolatedContext();
        var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
        ctx.AccountingPeriods.Add(period);
        ctx.SaveChanges();
        _periodId = period.Id;
    }

    public void Dispose() => _sqlDb.Dispose();

    // ── Montage : vrai validator + vrai handler derrière un ISender minimal ──────────────────

    private sealed class LetteringSender : ISender
    {
        private readonly LetterAccountEntriesCommandHandler _handler;
        private readonly LetterAccountEntriesCommandValidator _validator = new();

        public LetteringSender(LetterAccountEntriesCommandHandler handler) => _handler = handler;

        public async Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            var command = (LetterAccountEntriesCommand)(object)request;
            var validation = await _validator.ValidateAsync(command, cancellationToken);
            if (!validation.IsValid)
                throw new ValidationException(validation.Errors);
            return (TResponse)(object)await _handler.Handle(command, cancellationToken);
        }

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : IRequest =>
            throw new NotSupportedException();

        public Task<object?> Send(object request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private BulkLetterCommandHandler Handler(IMemoryCache? cache = null, Action? afterEachLetteredGroup = null)
    {
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.TenantId).Returns(_tenantId);
        user.SetupGet(u => u.UserId).Returns(_userId);
        user.SetupGet(u => u.Email).Returns("bulk@test");
        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(),
                It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, Guid?, object?, object?, CancellationToken>((action, _, id, _, values, _) =>
            {
                _audits.Enqueue((action, id, values));
                if (action == AuditActions.Accounting.Lettered)
                    afterEachLetteredGroup?.Invoke();
            })
            .Returns(Task.CompletedTask);
        var settings = Options.Create(new AccountingSettings { LetteringSuggestionsEnabled = true });
        var lettering = new LetteringService(_factory!, _ambient, user.Object);
        var sender = new LetteringSender(new LetterAccountEntriesCommandHandler(lettering, audit.Object));
        var queries = new LetteringQueryService(_factory!, settings, user.Object);
        return new BulkLetterCommandHandler(
            sender, queries, audit.Object, user.Object, _ambient, cache ?? new MemoryCache(new MemoryCacheOptions()),
            settings, NullLogger<BulkLetterCommandHandler>.Instance);
    }

    private Guid SeedClientLine(decimal amount, bool clientIsDebit, Guid? periodId = null,
        string currency = "TND", decimal rate = 1m)
    {
        var tnd = Math.Round(amount * rate, 3);
        var debit = clientIsDebit ? tnd : 0m;
        var credit = clientIsDebit ? 0m : tnd;
        var lines = currency == "TND"
            ? new[]
            {
                new JournalLineInput("4111", "Client", debit, credit, null, ThirdPartyKind.None),
                new JournalLineInput("707", "Contrepartie", credit, debit, null, ThirdPartyKind.None)
            }
            : new[]
            {
                new JournalLineInput("4111", "Client", debit, credit, null, ThirdPartyKind.None,
                    clientIsDebit ? amount : 0m, clientIsDebit ? 0m : amount),
                new JournalLineInput("707", "Contrepartie", credit, debit, null, ThirdPartyKind.None,
                    clientIsDebit ? 0m : amount, clientIsDebit ? amount : 0m)
            };
        var entry = currency == "TND"
            ? JournalEntry.Create(++_entryNumber, "JV", new DateTime(2026, 5, 10), $"Écriture {_entryNumber}",
                periodId ?? _periodId, false, "Manual", null, lines).Value
            : JournalEntry.Create(++_entryNumber, "JV", new DateTime(2026, 5, 10), $"Écriture {_entryNumber}",
                periodId ?? _periodId, false, "Manual", null, lines, currency: currency, exchangeRate: rate).Value;
        entry.SetAuditInfo("test", false);
        using var ctx = _factory!.CreateIsolatedContext();
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == "4111").Id;
    }

    private BulkLetterGroup Pair(string key, decimal amount = 100m) =>
        new(key, new[] { SeedClientLine(amount, true), SeedClientLine(amount, false) });

    private string? CodeOf(Guid lineId)
    {
        using var ctx = _factory!.CreateIsolatedContext();
        return ctx.JournalEntryLines.AsNoTracking().Where(l => l.Id == lineId).Select(l => l.LetteringCode).Single();
    }

    private static JsonElement Json(object? values) =>
        JsonDocument.Parse(JsonSerializer.Serialize(values)).RootElement;

    // ── Scénarios ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Bulk_PartialSuccess_ReportsEachGroupWithItsStableOutcome()
    {
        if (!_sqlDb.CanRun) return;

        var ok = Pair("ok");
        var already = Pair("already");
        var unbalanced = new BulkLetterGroup("unbalanced", new[] { SeedClientLine(100m, true), SeedClientLine(90m, false) });
        var exchange = new BulkLetterGroup("fx", new[]
        {
            SeedClientLine(1000m, true, currency: "EUR", rate: 3.0m),
            SeedClientLine(1000m, false, currency: "EUR", rate: 3.1m)
        });
        var lockedPeriod = AccountingPeriod.Create(2026, 4, new DateTime(2026, 4, 1), new DateTime(2026, 4, 30));
        lockedPeriod.Close("test");
        await using (var ctx = _factory!.CreateIsolatedContext())
        {
            ctx.AccountingPeriods.Add(lockedPeriod);
            await ctx.SaveChangesAsync();
        }
        var locked = new BulkLetterGroup("locked", new[]
        {
            SeedClientLine(50m, true, lockedPeriod.Id), SeedClientLine(50m, false, lockedPeriod.Id)
        });

        // « already » est lettré entre la proposition et la confirmation (autre utilisateur).
        var previous = await new LetteringService(_factory!, _ambient).ManualLetterAsync(already.JournalEntryLineIds);
        Assert.True(previous.IsSuccess);

        var requestId = Guid.NewGuid();
        var result = await Handler().Handle(
            new BulkLetterCommand(requestId, new[] { ok, already, unbalanced, exchange, locked }), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var report = result.Value;
        Assert.Equal((5, 1, 1, 3, 0), (report.Total, report.Lettered, report.AlreadyLettered, report.Rejected, report.NotProcessed));
        var byKey = report.Results.ToDictionary(r => r.ClientKey);
        Assert.Equal(BulkLetteringStatuses.Lettered, byKey["ok"].Status);
        Assert.Equal(CodeOf(ok.JournalEntryLineIds[0]), byKey["ok"].Code);
        Assert.Equal((BulkLetteringStatuses.AlreadyLettered, previous.Value.Code), (byKey["already"].Status, byKey["already"].Code));
        Assert.Equal(LetteringErrorCodes.Unbalanced, byKey["unbalanced"].ErrorCode);
        Assert.Equal(LetteringErrorCodes.ExchangeDifference, byKey["fx"].ErrorCode);
        Assert.Equal(LetteringErrorCodes.PeriodLocked, byKey["locked"].ErrorCode);

        // Aucune écriture pour les groupes refusés.
        foreach (var rejected in new[] { unbalanced, exchange, locked })
            Assert.All(rejected.JournalEntryLineIds, id => Assert.Null(CodeOf(id)));
    }

    [Fact]
    public async Task Bulk_AuditsEachGroupAsBulk_PlusOneBatchEntry()
    {
        if (!_sqlDb.CanRun) return;

        var a = Pair("a");
        var b = Pair("b", 70m);
        var requestId = Guid.NewGuid();

        var result = await Handler().Handle(new BulkLetterCommand(requestId, new[] { a, b }), CancellationToken.None);

        Assert.Equal(2, result.Value.Lettered);
        var lettered = _audits.Where(x => x.Action == AuditActions.Accounting.Lettered).Select(x => Json(x.Values)).ToList();
        Assert.Equal(2, lettered.Count);
        Assert.All(lettered, v =>
        {
            Assert.Equal("Bulk", v.GetProperty("Origin").GetString());
            Assert.Equal(requestId, v.GetProperty("BulkRequestId").GetGuid());
            Assert.False(v.GetProperty("AllowPartial").GetBoolean());
        });
        Assert.Equal(new[] { "a", "b" }, lettered.Select(v => v.GetProperty("SuggestionKey").GetString()));

        var batch = Assert.Single(_audits, x => x.Action == AuditActions.Accounting.LetteredBulk);
        Assert.Equal(requestId, batch.EntityId);
        Assert.Equal(2, Json(batch.Values).GetProperty("Lettered").GetInt32());
    }

    [Fact]
    public async Task Bulk_TwoParallelRequestsOnTheSameGroup_LetterItOnce()
    {
        if (!_sqlDb.CanRun) return;

        var group = Pair("same");
        var first = Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { group }), CancellationToken.None);
        var second = Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { group }), CancellationToken.None);
        var results = await Task.WhenAll(first, second);

        var statuses = results.Select(r => r.Value.Results.Single().Status).OrderBy(s => s, StringComparer.Ordinal).ToList();
        Assert.Equal(new[] { BulkLetteringStatuses.AlreadyLettered, BulkLetteringStatuses.Lettered }, statuses);
        var code = CodeOf(group.JournalEntryLineIds[0]);
        Assert.NotNull(code);
        Assert.Equal(code, CodeOf(group.JournalEntryLineIds[1]));
        Assert.All(results, r => Assert.Equal(code, r.Value.Results.Single().Code));
        await using var ctx = _factory!.CreateIsolatedContext();
        Assert.Equal(1, await ctx.LetteringGroups.AsNoTracking().CountAsync());
    }

    /// <summary>
    /// Lot interrompu après le premier groupe (client déconnecté), puis rejoué avec le même
    /// RequestId : le rapport partiel n'a pas été gardé, le rejeu reprend le lot. Le premier groupe
    /// sort en AlreadyLettered avec son code, les suivants sont lettrés. Un second rejeu renvoie
    /// le rapport désormais gardé, sans nouveau lettrage.
    /// </summary>
    [Fact]
    public async Task Bulk_InterruptedThenReplayed_ResumesWithoutLetteringTwice()
    {
        if (!_sqlDb.CanRun) return;

        var cache = new MemoryCache(new MemoryCacheOptions());
        var a = Pair("a");
        var b = Pair("b", 60m);
        var c = Pair("c", 70m);
        var command = new BulkLetterCommand(Guid.NewGuid(), new[] { a, b, c });
        using var cts = new CancellationTokenSource();

        var interrupted = await Handler(cache, afterEachLetteredGroup: cts.Cancel).Handle(command, cts.Token);

        Assert.Equal(
            new[] { BulkLetteringStatuses.Lettered, BulkLetteringStatuses.NotProcessed, BulkLetteringStatuses.NotProcessed },
            interrupted.Value.Results.Select(r => r.Status));
        Assert.Null(CodeOf(b.JournalEntryLineIds[0]));
        var codeA = interrupted.Value.Results[0].Code;

        var resumed = await Handler(cache).Handle(command, CancellationToken.None);

        Assert.Equal(
            new[] { BulkLetteringStatuses.AlreadyLettered, BulkLetteringStatuses.Lettered, BulkLetteringStatuses.Lettered },
            resumed.Value.Results.Select(r => r.Status));
        Assert.Equal(codeA, resumed.Value.Results[0].Code);
        Assert.NotNull(CodeOf(c.JournalEntryLineIds[1]));

        var replay = await Handler(cache).Handle(command, CancellationToken.None);
        Assert.Same(resumed.Value, replay.Value);
        await using var ctx = _factory!.CreateIsolatedContext();
        Assert.Equal(3, await ctx.LetteringGroups.AsNoTracking().CountAsync());
        Assert.Equal(3, _audits.Count(x => x.Action == AuditActions.Accounting.Lettered));
        Assert.Equal(2, _audits.Count(x => x.Action == AuditActions.Accounting.LetteredBulk));
    }

    /// <summary>Revue p3-13 (L3) : lignes déjà lettrées dans un groupe plus large → refus, pas « déjà lettré ».</summary>
    [Fact]
    public async Task Bulk_LinesAlreadyInALargerGroup_AreRejected()
    {
        if (!_sqlDb.CanRun) return;

        var debit = SeedClientLine(100m, true);
        var credit1 = SeedClientLine(60m, false);
        var credit2 = SeedClientLine(40m, false);
        Assert.True((await new LetteringService(_factory!, _ambient).ManualLetterAsync(new[] { debit, credit1, credit2 })).IsSuccess);

        var result = await Handler().Handle(
            new BulkLetterCommand(Guid.NewGuid(), new[] { new BulkLetterGroup("sub", new[] { debit, credit1 }) }),
            CancellationToken.None);

        var r = Assert.Single(result.Value.Results);
        Assert.Equal((BulkLetteringStatuses.Rejected, LetteringErrorCodes.AlreadyLettered), (r.Status, r.ErrorCode));
    }
}
