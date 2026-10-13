using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using Moq;
using Xunit;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Revue p3-11 : le handler standard transmet RequireNoExchangeDifference au service et trace
/// BulkRequestId dans l'audit « Lettered ». Le lettrage en masse (p3-13) dépend des deux.
/// </summary>
public sealed class LetterAccountEntriesCommandHandlerTests
{
    private static readonly IReadOnlyList<Guid> Ids = new[] { Guid.NewGuid(), Guid.NewGuid() };

    private static Mock<ILetteringService> Lettering(Result<LetteringOutcome> result)
    {
        var lettering = new Mock<ILetteringService>(MockBehavior.Strict);
        lettering.Setup(l => l.ManualLetterAsync(
                It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<bool>(), It.IsAny<LetteringOrigin>(),
                It.IsAny<CancellationToken>(), It.IsAny<bool>()))
            .ReturnsAsync(result);
        return lettering;
    }

    private static LetteringOutcome Outcome() =>
        new(Guid.NewGuid(), "L00007", "411", 100m, "TND", false, Ids);

    [Fact]
    public async Task BulkCommand_ForwardsTheFlag_AndAuditsTheBulkRequestId()
    {
        var bulkId = Guid.NewGuid();
        var lettering = Lettering(Result.Success(Outcome()));
        object? audited = null;
        var audit = new Mock<IAuditService>(MockBehavior.Strict);
        audit.Setup(a => a.LogAsync(AuditActions.Accounting.Lettered, "LetteringGroup", It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, Guid?, object?, object?, CancellationToken>((_, _, _, _, nv, _) => audited = nv)
            .Returns(Task.CompletedTask);

        var result = await new LetterAccountEntriesCommandHandler(lettering.Object, audit.Object).Handle(
            new LetterAccountEntriesCommand(Ids, AllowPartial: false, Origin: LetteringOrigin.Bulk,
                SuggestionKey: "k1", RequireNoExchangeDifference: true, BulkRequestId: bulkId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        lettering.Verify(l => l.ManualLetterAsync(Ids, false, LetteringOrigin.Bulk, It.IsAny<CancellationToken>(), true), Times.Once);

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(audited));
        var root = json.RootElement;
        Assert.Equal(bulkId, root.GetProperty("BulkRequestId").GetGuid());
        Assert.Equal("Bulk", root.GetProperty("Origin").GetString());
        Assert.Equal("k1", root.GetProperty("SuggestionKey").GetString());
    }

    [Fact]
    public async Task ManualCommand_KeepsTheDefault_FlagOff_AndNullBulkRequestId()
    {
        var lettering = Lettering(Result.Success(Outcome()));
        object? audited = null;
        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, Guid?, object?, object?, CancellationToken>((_, _, _, _, nv, _) => audited = nv)
            .Returns(Task.CompletedTask);

        await new LetterAccountEntriesCommandHandler(lettering.Object, audit.Object).Handle(
            new LetterAccountEntriesCommand(Ids), CancellationToken.None);

        lettering.Verify(l => l.ManualLetterAsync(Ids, false, LetteringOrigin.Manual, It.IsAny<CancellationToken>(), false), Times.Once);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(audited));
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("BulkRequestId").ValueKind);
    }

    [Fact]
    public async Task ServiceFailure_IsReturned_WithoutAudit()
    {
        var lettering = Lettering(Result.Failure<LetteringOutcome>(LetteringErrors.ExchangeDifference("écart")));
        var audit = new Mock<IAuditService>(MockBehavior.Strict);

        var result = await new LetterAccountEntriesCommandHandler(lettering.Object, audit.Object).Handle(
            new LetterAccountEntriesCommand(Ids, Origin: LetteringOrigin.Bulk,
                RequireNoExchangeDifference: true, BulkRequestId: Guid.NewGuid()),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(LetteringErrorCodes.ExchangeDifference, result.Error.Code);
    }
}
