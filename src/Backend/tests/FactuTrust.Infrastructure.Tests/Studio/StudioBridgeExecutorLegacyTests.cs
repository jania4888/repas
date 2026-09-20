using System.Text.Json.Nodes;
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
/// Lock on the legacy ERP-bridge executor behaviour: the PR 4.1 workflow engine builds on it and
/// must not change this contract (tool resolution, required-parameter validation, run recording,
/// studio-bridge correlation prefix, 2000-char error truncation).
/// </summary>
public sealed class StudioBridgeExecutorLegacyTests
{
    private const string InvoiceMapping =
        """[{"param":"client_id","source":"const","value":"c1"},{"param":"product_id","source":"const","value":"p1"},{"param":"quantity","source":"const","value":"2"}]""";

    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();

    private readonly Mock<IAiToolExecutor> _toolExecutor = new();
    private readonly Mock<ICustomAutomationRepository> _repo = new();
    private readonly StudioBridgeExecutor _sut;

    public StudioBridgeExecutorLegacyTests() =>
        _sut = new StudioBridgeExecutor(_toolExecutor.Object, _repo.Object, NullLogger<StudioBridgeExecutor>.Instance);

    private static CustomEntityAutomation Automation(string actionKey, string mappingJson) =>
        CustomEntityAutomation.Create(TenantId, EntityId, "Pont test", StudioAutomationTrigger.OnCreate,
            actionKey, mappingJson, null, false, null, null);

    private void SetupInvoiceToolReturns(AiToolResult result) =>
        _toolExecutor
            .Setup(e => e.ExecuteAsync("generate_invoice", It.IsAny<Dictionary<string, object?>>(),
                It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(result);

    [Fact]
    public async Task Unknown_action_fails_with_the_exact_french_message()
    {
        var run = await _sut.ExecuteAsync(Automation("no_such_tool", "[]"), TenantId, Guid.NewGuid(), new JsonObject(), null);

        Assert.Equal(StudioAutomationRunStatus.Failed, run.Status);
        Assert.Equal("Action ERP « no_such_tool » inconnue ou non autorisée.", run.Error);
    }

    [Fact]
    public async Task Non_mutating_tool_fails()
    {
        var run = await _sut.ExecuteAsync(Automation("get_sales_revenue", "[]"), TenantId, Guid.NewGuid(), new JsonObject(), null);

        Assert.Equal(StudioAutomationRunStatus.Failed, run.Status);
        Assert.Equal("Action ERP « get_sales_revenue » inconnue ou non autorisée.", run.Error);
        _toolExecutor.Verify(e => e.ExecuteAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, object?>>(),
            It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Missing_required_mapping_fails()
    {
        const string mapping = """[{ "param": "client_id", "source": "const", "value": "c1" }]""";

        var run = await _sut.ExecuteAsync(Automation("generate_invoice", mapping), TenantId, Guid.NewGuid(), new JsonObject(), null);

        Assert.Equal(StudioAutomationRunStatus.Failed, run.Status);
        Assert.Equal("Paramètre requis manquant pour l'action : « product_id ».", run.Error);
        _toolExecutor.Verify(e => e.ExecuteAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, object?>>(),
            It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Successful_tool_records_success_with_result_json()
    {
        SetupInvoiceToolReturns(new AiToolResult { Success = true, Data = """{ "invoiceId": "abc" }""" });

        var run = await _sut.ExecuteAsync(Automation("generate_invoice", InvoiceMapping), TenantId, Guid.NewGuid(), new JsonObject(), null);

        Assert.Equal(StudioAutomationRunStatus.Success, run.Status);
        Assert.Equal("""{ "invoiceId": "abc" }""", run.ResultJson);
        Assert.Null(run.Error);
    }

    [Fact]
    public async Task Tool_exception_is_recorded_truncated_to_2000()
    {
        _toolExecutor
            .Setup(e => e.ExecuteAsync("generate_invoice", It.IsAny<Dictionary<string, object?>>(),
                It.IsAny<AiToolExecutionContext>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException(new string('x', 3000)));

        var run = await _sut.ExecuteAsync(Automation("generate_invoice", InvoiceMapping), TenantId, Guid.NewGuid(), new JsonObject(), null);

        Assert.Equal(StudioAutomationRunStatus.Failed, run.Status);
        Assert.NotNull(run.Error);
        Assert.Equal(2000, run.Error!.Length);
    }

    [Fact]
    public async Task Add_run_async_is_called_exactly_once()
    {
        SetupInvoiceToolReturns(new AiToolResult { Success = true, Data = "{}" });

        await _sut.ExecuteAsync(Automation("generate_invoice", InvoiceMapping), TenantId, Guid.NewGuid(), new JsonObject(), null);

        _repo.Verify(r => r.AddRunAsync(It.IsAny<CustomAutomationRun>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Correlation_id_is_studio_bridge_prefixed()
    {
        var automation = Automation("generate_invoice", InvoiceMapping);
        SetupInvoiceToolReturns(new AiToolResult { Success = true, Data = "{}" });

        await _sut.ExecuteAsync(automation, TenantId, Guid.NewGuid(), new JsonObject(), null);

        _toolExecutor.Verify(e => e.ExecuteAsync(
            "generate_invoice",
            It.IsAny<Dictionary<string, object?>>(),
            It.Is<AiToolExecutionContext>(c => c.CorrelationId == $"studio-bridge:{automation.Id:N}"),
            It.IsAny<CancellationToken>()), Times.Once);
    }
}
