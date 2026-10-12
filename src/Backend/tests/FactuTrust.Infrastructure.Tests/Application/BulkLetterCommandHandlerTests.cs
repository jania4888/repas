using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using FluentValidation;
using FluentValidation.Results;
using MediatR;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// p3-13 : handler du lettrage en masse, sans base (ISender simulé). Les scénarios bout en bout
/// (vraie transaction, audits, concurrence) sont dans LetteringBulkSqlTests.
/// </summary>
public sealed class BulkLetterCommandHandlerTests
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Mock<ISender> _sender = new(MockBehavior.Strict);
    private readonly Mock<ILetteringQueryService> _queries = new(MockBehavior.Strict);
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<IAmbientTransactionState> _ambient = new();
    private readonly MemoryCache _cache = new(new MemoryCacheOptions());
    private readonly List<LetterAccountEntriesCommand> _sent = new();
    private bool _enabled = true;
    private bool _identified = true;

    private BulkLetterCommandHandler Handler()
    {
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.TenantId).Returns(_identified ? _tenantId : null);
        user.SetupGet(u => u.UserId).Returns(_userId);
        var settings = Options.Create(new AccountingSettings { LetteringSuggestionsEnabled = _enabled });
        return new BulkLetterCommandHandler(
            _sender.Object, _queries.Object, _audit.Object, user.Object, _ambient.Object, _cache, settings,
            NullLogger<BulkLetterCommandHandler>.Instance);
    }

    private static BulkLetterGroup Group(string key) => new(key, new[] { Guid.NewGuid(), Guid.NewGuid() });

    private void SenderReturns(Func<LetterAccountEntriesCommand, Result<LetteringResultDto>> respond)
    {
        _sender.Setup(s => s.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .Returns<LetterAccountEntriesCommand, CancellationToken>((cmd, _) =>
            {
                _sent.Add(cmd);
                return Task.FromResult(respond(cmd));
            });
    }

    private static Result<LetteringResultDto> Lettered(string code) =>
        Result.Success(new LetteringResultDto(code, Guid.NewGuid(), false, 2, null));

    [Fact]
    public async Task Bulk_LettersGroupsSequentially_WithForcedBulkOptions()
    {
        var requestId = Guid.NewGuid();
        var groups = new[] { Group("a"), Group("b"), Group("c") };
        var n = 0;
        SenderReturns(_ => Lettered($"L0000{++n}"));

        var result = await Handler().Handle(new BulkLetterCommand(requestId, groups), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(new[] { "a", "b", "c" }, _sent.Select(c => c.SuggestionKey));
        Assert.All(_sent, c =>
        {
            Assert.Equal(LetteringOrigin.Bulk, c.Origin);
            Assert.False(c.AllowPartial);
            Assert.True(c.RequireNoExchangeDifference);
            Assert.Equal(requestId, c.BulkRequestId);
        });
        Assert.Equal(groups[1].JournalEntryLineIds, _sent[1].JournalEntryLineIds);
        var report = result.Value;
        Assert.Equal((3, 3, 0, 0, 0), (report.Total, report.Lettered, report.AlreadyLettered, report.Rejected, report.NotProcessed));
        Assert.Equal(new[] { "L00001", "L00002", "L00003" }, report.Results.Select(r => r.Code));
        Assert.All(report.Results, r => Assert.Equal(BulkLetteringStatuses.Lettered, r.Status));
    }

    [Fact]
    public async Task Bulk_SendsEachGroupWithoutTheRequestToken()
    {
        using var cts = new CancellationTokenSource();
        CancellationToken seen = default;
        _sender.Setup(s => s.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .Returns<LetterAccountEntriesCommand, CancellationToken>((_, ct) => { seen = ct; return Task.FromResult(Lettered("L00001")); });

        await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a") }), cts.Token);

        Assert.False(seen.CanBeCanceled);
    }

    [Fact]
    public async Task Bulk_Cancellation_LeavesRemainingGroupsNotProcessed_AndIsNotCached()
    {
        using var cts = new CancellationTokenSource();
        SenderReturns(_ => { cts.Cancel(); return Lettered("L00001"); });
        var command = new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a"), Group("b"), Group("c") });

        var result = await Handler().Handle(command, cts.Token);

        Assert.True(result.IsSuccess);
        Assert.Single(_sent);
        Assert.Equal(
            new[] { BulkLetteringStatuses.Lettered, BulkLetteringStatuses.NotProcessed, BulkLetteringStatuses.NotProcessed },
            result.Value.Results.Select(r => r.Status));
        Assert.Equal(2, result.Value.NotProcessed);

        // Un lot interrompu n'est pas gardé : le rejeu reprend le travail.
        await Handler().Handle(command, CancellationToken.None);
        Assert.Equal(4, _sent.Count);
    }

    [Fact]
    public async Task Bulk_Replay_ReturnsTheSameReportWithoutSendingAgain()
    {
        SenderReturns(_ => Lettered("L00001"));
        var command = new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a") });

        var first = await Handler().Handle(command, CancellationToken.None);
        var second = await Handler().Handle(command, CancellationToken.None);

        Assert.Same(first.Value, second.Value);
        Assert.Single(_sent);
        _audit.Verify(a => a.LogAsync(AuditActions.Accounting.LetteredBulk, It.IsAny<string>(), It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Bulk_ReplayCacheKey_IsScopedByTenantAndUser()
    {
        var requestId = Guid.NewGuid();
        Assert.NotEqual(
            BulkLetterCommandHandler.ReportCacheKey(_tenantId, _userId, requestId),
            BulkLetterCommandHandler.ReportCacheKey(_tenantId, Guid.NewGuid(), requestId));
        Assert.NotEqual(
            BulkLetterCommandHandler.ReportCacheKey(_tenantId, _userId, requestId),
            BulkLetterCommandHandler.ReportCacheKey(Guid.NewGuid(), _userId, requestId));

        // Un rapport gardé pour un autre utilisateur n'est jamais renvoyé.
        var foreign = new BulkLetteringResultDto(requestId, 0, 0, 0, 0, 0, Array.Empty<BulkLetteringGroupResultDto>());
        _cache.Set(BulkLetterCommandHandler.ReportCacheKey(_tenantId, Guid.NewGuid(), requestId), foreign);
        SenderReturns(_ => Lettered("L00001"));

        var result = await Handler().Handle(new BulkLetterCommand(requestId, new[] { Group("a") }), CancellationToken.None);

        Assert.NotSame(foreign, result.Value);
        Assert.Single(_sent);
    }

    [Fact]
    public async Task Bulk_ConcurrentCallForTheSameRequest_GetsBulkInProgress()
    {
        var release = new TaskCompletionSource<Result<LetteringResultDto>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _sender.Setup(s => s.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .Returns(() => { started.TrySetResult(); return release.Task; });
        var command = new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a") });

        var first = Handler().Handle(command, CancellationToken.None);
        await started.Task;
        var second = await Handler().Handle(command, CancellationToken.None);
        release.SetResult(Lettered("L00001"));
        var firstResult = await first;

        Assert.True(second.IsFailure);
        Assert.Equal(LetteringErrorCodes.BulkInProgress, second.Error.Code);
        Assert.True(firstResult.IsSuccess);

        // Le verrou est relâché : un nouvel appel renvoie le rapport gardé.
        var third = await Handler().Handle(command, CancellationToken.None);
        Assert.Same(firstResult.Value, third.Value);
    }

    /// <summary>
    /// Revue p3-13 (M1) : une erreur inattendue arrête le lot SANS perdre le rapport ni l'audit de
    /// lot ; les groupes suivants sortent en NotProcessed, le lot n'est pas gardé et le verrou est
    /// relâché (le rejeu reprend tout).
    /// </summary>
    [Fact]
    public async Task Bulk_UnexpectedError_StopsTheBatch_KeepsTheReportAndTheBatchAudit()
    {
        var failing = Group("b");
        SenderReturns(cmd => cmd.SuggestionKey == "b" ? throw new InvalidOperationException("panne") : Lettered("L00001"));
        _queries.Setup(q => q.GetLineCodesAsync(failing.JournalEntryLineIds, It.IsAny<CancellationToken>()))
            .ReturnsAsync(failing.JournalEntryLineIds.ToDictionary(id => id, _ => (string?)"L00009"));
        object? audited = null;
        _audit.Setup(a => a.LogAsync(AuditActions.Accounting.LetteredBulk, "LetteringBulk", It.IsAny<Guid?>(), null,
                It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, Guid?, object?, object?, CancellationToken>((_, _, _, _, nv, _) => audited = nv)
            .Returns(Task.CompletedTask);
        var command = new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a"), failing, Group("c") });

        var result = await Handler().Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(new[] { "a", "b" }, _sent.Select(c => c.SuggestionKey));
        var r = result.Value.Results;
        Assert.Equal(BulkLetteringStatuses.Lettered, r[0].Status);
        Assert.Equal((BulkLetteringStatuses.Rejected, LetteringErrorCodes.Unexpected, "L00009"), (r[1].Status, r[1].ErrorCode, r[1].Code));
        Assert.Equal(BulkLetteringStatuses.NotProcessed, r[2].Status);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(audited));
        Assert.True(json.RootElement.GetProperty("Aborted").GetBoolean());
        Assert.Equal(1, json.RootElement.GetProperty("NotProcessed").GetInt32());

        await Handler().Handle(command, CancellationToken.None);
        Assert.Equal(4, _sent.Count);   // pas de cache, verrou relâché : le rejeu reprend
    }

    [Fact]
    public async Task Bulk_UnexpectedErrorOnTheLastGroup_IsStillNotCached()
    {
        var failing = Group("a");
        _sender.Setup(s => s.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("panne"));
        _queries.Setup(q => q.GetLineCodesAsync(failing.JournalEntryLineIds, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("base indisponible"));
        var command = new BulkLetterCommand(Guid.NewGuid(), new[] { failing });

        var first = await Handler().Handle(command, CancellationToken.None);

        var r = Assert.Single(first.Value.Results);
        Assert.Equal((LetteringErrorCodes.Unexpected, (string?)null), (r.ErrorCode, r.Code));
        _sender.Reset();
        SenderReturns(_ => Lettered("L00001"));
        var retry = await Handler().Handle(command, CancellationToken.None);
        Assert.Equal(BulkLetteringStatuses.Lettered, Assert.Single(retry.Value.Results).Status);
    }

    /// <summary>Revue p3-13 (L1) : même RequestId, autre sélection → refus, jamais l'ancien rapport.</summary>
    [Fact]
    public async Task Bulk_SameRequestIdWithOtherContent_IsRefused()
    {
        SenderReturns(_ => Lettered("L00001"));
        var requestId = Guid.NewGuid();
        var a = Group("a");
        await Handler().Handle(new BulkLetterCommand(requestId, new[] { a, Group("b") }), CancellationToken.None);

        var changed = await Handler().Handle(new BulkLetterCommand(requestId, new[] { a }), CancellationToken.None);

        Assert.True(changed.IsFailure);
        Assert.Equal(LetteringErrorCodes.Validation, changed.Error.Code);
        Assert.Equal(2, _sent.Count);
    }

    [Fact]
    public void Fingerprint_DependsOnKeysLinesAndOrder()
    {
        var a = Group("a");
        var b = Group("b");
        var reference = BulkLetterCommandHandler.Fingerprint(new[] { a, b });
        Assert.Equal(reference, BulkLetterCommandHandler.Fingerprint(new[] { a, b }));
        Assert.NotEqual(reference, BulkLetterCommandHandler.Fingerprint(new[] { b, a }));
        Assert.NotEqual(reference, BulkLetterCommandHandler.Fingerprint(new[] { a, new BulkLetterGroup("c", b.JournalEntryLineIds) }));
        Assert.NotEqual(reference, BulkLetterCommandHandler.Fingerprint(
            new[] { a, new BulkLetterGroup("b", b.JournalEntryLineIds.Reverse().ToList()) }));
    }

    [Fact]
    public async Task Bulk_UnidentifiedUser_IsRefusedWithoutSending()
    {
        _identified = false;

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a") }), CancellationToken.None);

        Assert.Equal(LetteringErrorCodes.Validation, result.Error.Code);
        _sender.VerifyNoOtherCalls();
        _audit.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Bulk_AlreadyCancelled_SendsNothing_AuditsOnce_AndIsNotCached()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var command = new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a"), Group("b") });

        var result = await Handler().Handle(command, cts.Token);

        Assert.All(result.Value.Results, r => Assert.Equal(BulkLetteringStatuses.NotProcessed, r.Status));
        _sender.VerifyNoOtherCalls();
        _audit.Verify(a => a.LogAsync(AuditActions.Accounting.LetteredBulk, It.IsAny<string>(), It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);

        SenderReturns(_ => Lettered("L00001"));
        await Handler().Handle(command, CancellationToken.None);
        Assert.Equal(2, _sent.Count);
    }

    [Fact]
    public async Task Bulk_InsideAmbientTransaction_IsRefusedWithoutSending()
    {
        _ambient.SetupGet(a => a.IsActive).Returns(true);

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a") }), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.Validation, result.Error.Code);
        _sender.VerifyNoOtherCalls();
        _audit.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Bulk_FeatureDisabled_IsRefusedWithoutSending()
    {
        _enabled = false;

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a") }), CancellationToken.None);

        Assert.Equal(LetteringErrorCodes.FeatureDisabled, result.Error.Code);
        _sender.VerifyNoOtherCalls();
        _audit.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Bulk_ValidationException_RejectsOnlyThatGroup()
    {
        var bad = Group("bad");
        SenderReturns(cmd => cmd.SuggestionKey == "bad"
            ? throw new ValidationException(new[] { new ValidationFailure("Lines", "Lignes invalides.") })
            : Lettered("L00001"));

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { bad, Group("ok") }), CancellationToken.None);

        var rejected = result.Value.Results[0];
        Assert.Equal(BulkLetteringStatuses.Rejected, rejected.Status);
        Assert.Equal(LetteringErrorCodes.Validation, rejected.ErrorCode);
        Assert.Equal("Lignes invalides.", rejected.Message);
        Assert.Equal(BulkLetteringStatuses.Lettered, result.Value.Results[1].Status);
    }

    [Fact]
    public async Task Bulk_ServiceFailure_IsRejectedWithItsStableCode()
    {
        SenderReturns(_ => Result.Failure<LetteringResultDto>(LetteringErrors.Unbalanced("Le groupe n'est pas équilibré.")));

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { Group("a") }), CancellationToken.None);

        var r = Assert.Single(result.Value.Results);
        Assert.Equal((BulkLetteringStatuses.Rejected, LetteringErrorCodes.Unbalanced, "Le groupe n'est pas équilibré."),
            (r.Status, r.ErrorCode, r.Message));
        Assert.Null(r.Code);
    }

    [Fact]
    public async Task Bulk_AlreadyLetteredInOneGroup_IsReportedWithTheExistingCode()
    {
        var group = Group("a");
        SenderReturns(_ => Result.Failure<LetteringResultDto>(LetteringErrors.AlreadyLettered("Déjà lettrée.")));
        _queries.Setup(q => q.GetLineCodesAsync(group.JournalEntryLineIds, It.IsAny<CancellationToken>()))
            .ReturnsAsync(group.JournalEntryLineIds.ToDictionary(id => id, _ => (string?)"L00042"));
        ExistingGroup("L00042", group.JournalEntryLineIds);

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { group }), CancellationToken.None);

        var r = Assert.Single(result.Value.Results);
        Assert.Equal((BulkLetteringStatuses.AlreadyLettered, "L00042"), (r.Status, r.Code));
        Assert.Null(r.ErrorCode);
        Assert.Equal(1, result.Value.AlreadyLettered);
    }

    private void ExistingGroup(string code, IEnumerable<Guid> members)
    {
        var lines = members.Select(id => new LetteringLineDto(
            id, Guid.NewGuid(), new DateTime(2026, 5, 1), "JV", 1, 1, "4111", "Ligne", "Écriture", null, "Manual",
            10m, 0m, "TND", 0m, 0m, code, false, null, 0, null, false, false, false, false)).ToList();
        _queries.Setup(q => q.GetGroupAsync(code, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new LetteringGroupDto(
                Guid.NewGuid(), code, "4111", 10m, "TND", code.StartsWith('P'), DateTime.UtcNow, null, lines, true, null, false)));
    }

    /// <summary>Revue p3-13 (L3) : un groupe existant plus large n'est pas la proposition.</summary>
    [Fact]
    public async Task Bulk_AlreadyLetteredInALargerGroup_IsRejected()
    {
        var group = Group("a");
        SenderReturns(_ => Result.Failure<LetteringResultDto>(LetteringErrors.AlreadyLettered("Déjà lettrée.")));
        _queries.Setup(q => q.GetLineCodesAsync(group.JournalEntryLineIds, It.IsAny<CancellationToken>()))
            .ReturnsAsync(group.JournalEntryLineIds.ToDictionary(id => id, _ => (string?)"L00005"));
        ExistingGroup("L00005", group.JournalEntryLineIds.Append(Guid.NewGuid()));

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { group }), CancellationToken.None);

        var r = Assert.Single(result.Value.Results);
        Assert.Equal((BulkLetteringStatuses.Rejected, LetteringErrorCodes.AlreadyLettered), (r.Status, r.ErrorCode));
    }

    /// <summary>Revue p3-13 (L3) : un groupe partiel (P…) n'est jamais « déjà lettré » (pas de lecture du groupe).</summary>
    [Fact]
    public async Task Bulk_AlreadyInAPartialGroup_IsRejected()
    {
        var group = Group("a");
        SenderReturns(_ => Result.Failure<LetteringResultDto>(LetteringErrors.AlreadyLettered("Déjà lettrée.")));
        _queries.Setup(q => q.GetLineCodesAsync(group.JournalEntryLineIds, It.IsAny<CancellationToken>()))
            .ReturnsAsync(group.JournalEntryLineIds.ToDictionary(id => id, _ => (string?)"P00003"));

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { group }), CancellationToken.None);

        Assert.Equal(BulkLetteringStatuses.Rejected, Assert.Single(result.Value.Results).Status);
        _queries.Verify(q => q.GetGroupAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    public static TheoryData<string?, string?> MixedCodes() => new()
    {
        { "L00001", "L00002" }, // deux groupes différents
        { "L00001", null },     // une ligne encore libre
    };

    [Theory]
    [MemberData(nameof(MixedCodes))]
    public async Task Bulk_AlreadyLetteredAcrossGroupsOrPartly_IsRejected(string? first, string? second)
    {
        var group = Group("a");
        SenderReturns(_ => Result.Failure<LetteringResultDto>(LetteringErrors.AlreadyLettered("Déjà lettrée.")));
        _queries.Setup(q => q.GetLineCodesAsync(group.JournalEntryLineIds, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string?>
            {
                [group.JournalEntryLineIds[0]] = first,
                [group.JournalEntryLineIds[1]] = second
            });

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { group }), CancellationToken.None);

        var r = Assert.Single(result.Value.Results);
        Assert.Equal((BulkLetteringStatuses.Rejected, LetteringErrorCodes.AlreadyLettered), (r.Status, r.ErrorCode));
    }

    [Fact]
    public async Task Bulk_AlreadyLetteredWithAnUnknownLine_IsRejected()
    {
        var group = Group("a");
        SenderReturns(_ => Result.Failure<LetteringResultDto>(LetteringErrors.AlreadyLettered("Déjà lettrée.")));
        _queries.Setup(q => q.GetLineCodesAsync(group.JournalEntryLineIds, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string?> { [group.JournalEntryLineIds[0]] = "L00001" });

        var result = await Handler().Handle(new BulkLetterCommand(Guid.NewGuid(), new[] { group }), CancellationToken.None);

        Assert.Equal(BulkLetteringStatuses.Rejected, Assert.Single(result.Value.Results).Status);
    }

    [Fact]
    public async Task Bulk_WritesOneBatchAudit_WithCountersAndGroups()
    {
        var requestId = Guid.NewGuid();
        object? audited = null;
        CancellationToken auditToken = new(true);
        _audit.Setup(a => a.LogAsync(AuditActions.Accounting.LetteredBulk, "LetteringBulk", requestId, null,
                It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, Guid?, object?, object?, CancellationToken>((_, _, _, _, nv, ct) => { audited = nv; auditToken = ct; })
            .Returns(Task.CompletedTask);
        SenderReturns(cmd => cmd.SuggestionKey == "a"
            ? Lettered("L00001")
            : Result.Failure<LetteringResultDto>(LetteringErrors.PeriodLocked("Période verrouillée.")));
        using var cts = new CancellationTokenSource();

        await Handler().Handle(new BulkLetterCommand(requestId, new[] { Group("a"), Group("b") }), cts.Token);

        Assert.NotNull(audited);
        Assert.False(auditToken.CanBeCanceled);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(audited));
        var root = json.RootElement;
        Assert.Equal(requestId, root.GetProperty("RequestId").GetGuid());
        Assert.False(root.GetProperty("Aborted").GetBoolean());
        Assert.Equal(2, root.GetProperty("Total").GetInt32());
        Assert.Equal(1, root.GetProperty("Lettered").GetInt32());
        Assert.Equal(1, root.GetProperty("Rejected").GetInt32());
        var groups = root.GetProperty("Groups");
        Assert.Equal("L00001", groups[0].GetProperty("Code").GetString());
        Assert.Equal(LetteringErrorCodes.PeriodLocked, groups[1].GetProperty("ErrorCode").GetString());
        Assert.False(groups[1].TryGetProperty("Message", out _));
    }
}
