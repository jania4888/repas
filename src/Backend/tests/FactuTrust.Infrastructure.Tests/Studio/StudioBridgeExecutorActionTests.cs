using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 4.1g — <see cref="IStudioBridgeExecutor.ExecuteActionAsync"/> : exécution d'une action ERP par
/// clé, sans automation ni run persisté (message figé, exception ⇒ issue en échec, corrélation
/// pass-through), plus la délégation du chemin legacy qui continue d'enregistrer un run unique.
/// </summary>
public sealed class StudioBridgeExecutorActionTests
{
    private const string InvoiceMapping =
        """[{"param":"client_id","source":"const","value":"c1"},{"param":"product_id","source":"const","value":"p1"},{"param":"quantity","source":"const","value":"2"}]""";

    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();

    private readonly Mock<IAiToolExecutor> _toolExecutor = new();
    private readonly Mock<ICustomAutomationRepository> _repo = new();
    private readonly StudioBridgeExecutor _sut;

    public StudioBridgeExecutorActionTests() =>
        _sut = new StudioBridgeExecutor(_toolExecutor.Object, _repo.Object, NullLogger<StudioBridgeExecutor>.Instance);

    private void SetupInvoiceToolReturns(AiToolResult result) =>
        _toolExecutor
            .Setup(e => e.ExecuteAsync("generate_invoice", It.IsAny<Dictionary<string, object?>>(),
                It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(result);

    [Fact]
    public async Task Unknown_action_returns_failed_outcome_with_the_frozen_message()
    {
        var outcome = await _sut.ExecuteActionAsync("no_such_tool", new Dictionary<string, object?>(), "corr-1");

        Assert.False(outcome.Success);
        Assert.Equal("Action ERP « no_such_tool » inconnue ou non autorisée.", outcome.Error);
        Assert.Null(outcome.ResultJson);
    }

    [Fact]
    public async Task Non_mutating_tool_returns_failed_outcome()
    {
        var outcome = await _sut.ExecuteActionAsync("get_sales_revenue", new Dictionary<string, object?>(), "corr-2");

        Assert.False(outcome.Success);
        Assert.Equal("Action ERP « get_sales_revenue » inconnue ou non autorisée.", outcome.Error);
        _toolExecutor.Verify(e => e.ExecuteAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, object?>>(),
            It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Tool_success_returns_serialized_result_json()
    {
        SetupInvoiceToolReturns(new AiToolResult { Success = true, Data = """{ "invoiceId": "abc" }""" });

        var outcome = await _sut.ExecuteActionAsync(
            "generate_invoice", new Dictionary<string, object?> { ["client_id"] = "c1" }, "corr-3");

        Assert.True(outcome.Success);
        Assert.Null(outcome.Error);
        Assert.Equal("""{ "invoiceId": "abc" }""", outcome.ResultJson);
    }

    [Fact]
    public async Task Tool_exception_returns_failed_outcome_and_never_throws()
    {
        _toolExecutor
            .Setup(e => e.ExecuteAsync("generate_invoice", It.IsAny<Dictionary<string, object?>>(),
                It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("ERP indisponible"));

        var outcome = await _sut.ExecuteActionAsync("generate_invoice", new Dictionary<string, object?>(), "corr-4");

        Assert.False(outcome.Success);
        Assert.Equal("ERP indisponible", outcome.Error);
        Assert.Null(outcome.ResultJson);
    }

    [Fact]
    public async Task Correlation_id_is_passed_through_to_the_tool_executor()
    {
        SetupInvoiceToolReturns(new AiToolResult { Success = true, Data = "{}" });

        await _sut.ExecuteActionAsync("generate_invoice", new Dictionary<string, object?>(), "wf:instance:etape");

        _toolExecutor.Verify(e => e.ExecuteAsync(
            "generate_invoice",
            It.IsAny<Dictionary<string, object?>>(),
            It.Is<AiToolExecutionContext>(c => c.CorrelationId == "wf:instance:etape"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Legacy_execute_delegates_and_still_records_one_run()
    {
        SetupInvoiceToolReturns(new AiToolResult { Success = true, Data = """{ "invoiceId": "abc" }""" });
        var automation = CustomEntityAutomation.Create(TenantId, EntityId, "Pont test", StudioAutomationTrigger.OnCreate,
            "generate_invoice", InvoiceMapping, null, false, null, null);

        var run = await _sut.ExecuteAsync(automation, TenantId, Guid.NewGuid(), new System.Text.Json.Nodes.JsonObject(), null);

        Assert.Equal(StudioAutomationRunStatus.Success, run.Status);
        Assert.Equal("""{ "invoiceId": "abc" }""", run.ResultJson);
        _toolExecutor.Verify(e => e.ExecuteAsync("generate_invoice", It.IsAny<Dictionary<string, object?>>(),
            It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()), Times.Once);
        _repo.Verify(r => r.AddRunAsync(It.IsAny<CustomAutomationRun>(), It.IsAny<CancellationToken>()), Times.Once);
    }
}
