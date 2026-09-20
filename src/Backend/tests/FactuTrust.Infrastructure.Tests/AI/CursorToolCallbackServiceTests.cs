using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Entities.AI;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class CursorToolCallbackServiceTests
{
    [Fact]
    public async Task ExecuteAsync_Unauthorized_WhenTokenMismatch()
    {
        var registry = new CursorToolRunRegistry();
        var service = new CursorToolCallbackService(registry, NullLogger<CursorToolCallbackService>.Instance);
        var runId = Guid.NewGuid();
        registry.Register(CreateContext(runId, "token-a", Mock.Of<IAiToolExecutor>(), Mock.Of<IAiToolExecutorScopeFactory>()));

        var (status, _) = await service.ExecuteAsync(
            runId,
            "token-b",
            new CursorToolCallbackRequest { Name = "list_invoices" },
            CancellationToken.None);

        Assert.Equal(401, status);
    }

    [Fact]
    public async Task ExecuteAsync_InvokesScopeFactory_AndEnqueuesSse()
    {
        var registry = new CursorToolRunRegistry();
        var service = new CursorToolCallbackService(registry, NullLogger<CursorToolCallbackService>.Instance);
        var runId = Guid.NewGuid();
        var token = CursorToolRunContext.CreateToken();
        var scope = new Mock<IAiToolExecutorScopeFactory>();
        scope.Setup(x => x.ExecuteAsync(
                "list_invoices",
                It.IsAny<Dictionary<string, object?>>(),
                It.IsAny<AiToolExecutionContext>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(AiToolResult.Ok("""{"ok":true}"""));
        var ctx = CreateContext(runId, token, Mock.Of<IAiToolExecutor>(), scope.Object);
        registry.Register(ctx);

        var (status, _) = await service.ExecuteAsync(
            runId,
            token,
            new CursorToolCallbackRequest
            {
                Name = "list_invoices",
                CallId = "c1",
                Arguments = JsonDocument.Parse("""{"limit":5}""").RootElement
            },
            CancellationToken.None);

        Assert.Equal(200, status);
        Assert.Equal(1, ctx.ToolsExecuted);
        Assert.Equal(2, ctx.ExtraEvents.Count);
        Assert.Contains(ctx.Conversation.Messages, m => m.Role == MessageRole.Tool && m.ToolName == "list_invoices");
        scope.Verify(x => x.ExecuteAsync(
            "list_invoices",
            It.IsAny<Dictionary<string, object?>>(),
            It.IsAny<AiToolExecutionContext>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---- R7/PR 2.4 : un outil « plan » pousse EXACTEMENT un événement studio_plan ----

    [Theory]
    [InlineData("studio_plan_app")]
    [InlineData("studio_plan_system")]
    [InlineData("studio_plan_report")]
    [InlineData("studio_plan_changes")]
    [InlineData("studio_plan_view")]
    [InlineData("studio_plan_record_view")]
    [InlineData("studio_plan_workflow")]
    public async Task Plan_tool_success_enqueues_exactly_one_studio_plan_event(string toolName)
    {
        // La liste AiToolRegistry.StudioPlanEmittingTools est la SEULE condition d'émission :
        // chaque outil qui produit un plan confirmable doit pousser la carte d'aperçu, une fois.
        var registry = new CursorToolRunRegistry();
        var service = new CursorToolCallbackService(registry, NullLogger<CursorToolCallbackService>.Instance);
        var runId = Guid.NewGuid();
        var token = CursorToolRunContext.CreateToken();
        var scope = new Mock<IAiToolExecutorScopeFactory>();
        scope.Setup(x => x.ExecuteAsync(
                toolName,
                It.IsAny<Dictionary<string, object?>>(),
                It.IsAny<AiToolExecutionContext>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(AiToolResult.Ok("""{"planId":"p1"}"""));
        var ctx = CreateContext(runId, token, Mock.Of<IAiToolExecutor>(), scope.Object);
        registry.Register(ctx);

        var (status, _) = await service.ExecuteAsync(
            runId, token,
            new CursorToolCallbackRequest { Name = toolName, CallId = "c1" },
            CancellationToken.None);

        Assert.Equal(200, status);
        var planEvents = ctx.ExtraEvents.Where(e => e.Type == "studio_plan").ToList();
        Assert.Single(planEvents);
        Assert.Equal("""{"planId":"p1"}""", planEvents[0].Content);
    }

    [Theory]
    [InlineData("studio_run_report")]   // résultat d'état : autre événement, jamais studio_plan
    [InlineData("list_invoices")]        // outil ordinaire
    [InlineData("studio_generate_app")]  // chemin direct historique : pas de plan
    public async Task Non_plan_tool_success_enqueues_no_studio_plan_event(string toolName)
    {
        var registry = new CursorToolRunRegistry();
        var service = new CursorToolCallbackService(registry, NullLogger<CursorToolCallbackService>.Instance);
        var runId = Guid.NewGuid();
        var token = CursorToolRunContext.CreateToken();
        var scope = new Mock<IAiToolExecutorScopeFactory>();
        scope.Setup(x => x.ExecuteAsync(
                toolName,
                It.IsAny<Dictionary<string, object?>>(),
                It.IsAny<AiToolExecutionContext>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(AiToolResult.Ok("""{"ok":true}"""));
        var ctx = CreateContext(runId, token, Mock.Of<IAiToolExecutor>(), scope.Object);
        registry.Register(ctx);

        var (status, _) = await service.ExecuteAsync(
            runId, token,
            new CursorToolCallbackRequest { Name = toolName, CallId = "c1" },
            CancellationToken.None);

        Assert.Equal(200, status);
        Assert.DoesNotContain(ctx.ExtraEvents, e => e.Type == "studio_plan");
    }

    private static CursorToolRunContext CreateContext(
        Guid runId,
        string token,
        IAiToolExecutor executor,
        IAiToolExecutorScopeFactory scope) =>
        new()
        {
            RunId = runId,
            Token = token,
            Conversation = Conversation.Create(Guid.NewGuid(), "test"),
            CorrelationId = "corr",
            ToolExecutor = executor,
            ScopeFactory = scope,
            TenantId = Guid.NewGuid(),
            ConnectionString = "Server=.;Database=t",
            UserId = Guid.NewGuid(),
            Role = UserRole.Accountant,
            Permissions = new HashSet<string>(StringComparer.Ordinal)
        };
}
