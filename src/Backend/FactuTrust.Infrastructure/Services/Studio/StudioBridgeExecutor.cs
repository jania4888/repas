using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.Studio.Automations;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio;

/// <summary>
/// Runs a Studio automation by mapping the record to an ERP action tool and invoking the existing,
/// permission-gated <see cref="IAiToolExecutor"/>. Every outcome is persisted as a <see cref="CustomAutomationRun"/>.
/// The bridge adds NO business logic — all validation/permissions live in the underlying tool/command.
/// </summary>
public sealed class StudioBridgeExecutor : IStudioBridgeExecutor
{
    private const int MaxErrorLength = 2000;

    private readonly IAiToolExecutor _toolExecutor;
    private readonly ICustomAutomationRepository _repo;
    private readonly ILogger<StudioBridgeExecutor> _logger;

    public StudioBridgeExecutor(
        IAiToolExecutor toolExecutor, ICustomAutomationRepository repo, ILogger<StudioBridgeExecutor> logger)
    {
        _toolExecutor = toolExecutor;
        _repo = repo;
        _logger = logger;
    }

    public async Task<CustomAutomationRun> ExecuteAsync(
        CustomEntityAutomation automation, Guid tenantId, Guid recordId, JsonObject? recordData,
        Guid? runBy, CancellationToken cancellationToken = default)
    {
        var tool = AiToolRegistry.GetToolDefinition(automation.ActionKey);
        if (tool is null || !tool.IsMutating)
            return await RecordAsync(tenantId, automation.Id, recordId, StudioAutomationRunStatus.Failed,
                null, $"Action ERP « {automation.ActionKey} » inconnue ou non autorisée.", runBy, cancellationToken);

        var mappings = StudioBridgeMapper.ParseMappings(automation.MappingJson);
        var (args, mapError) = StudioBridgeMapper.Build(mappings, recordData, tool);
        if (mapError is not null)
            return await RecordAsync(tenantId, automation.Id, recordId, StudioAutomationRunStatus.Failed,
                null, mapError, runBy, cancellationToken);

        var outcome = await ExecuteActionAsync(automation.ActionKey, args, $"studio-bridge:{automation.Id:N}", cancellationToken);
        return await RecordAsync(
            tenantId, automation.Id, recordId,
            outcome.Success ? StudioAutomationRunStatus.Success : StudioAutomationRunStatus.Failed,
            outcome.ResultJson,
            outcome.Error,
            runBy, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<StudioBridgeOutcome> ExecuteActionAsync(
        string actionKey, IReadOnlyDictionary<string, object?> args, string correlationId,
        CancellationToken cancellationToken = default)
    {
        var tool = AiToolRegistry.GetToolDefinition(actionKey);
        if (tool is null || !tool.IsMutating)
            return new StudioBridgeOutcome(false, $"Action ERP « {actionKey} » inconnue ou non autorisée.", null);

        AiToolResult result;
        try
        {
            result = await _toolExecutor.ExecuteAsync(
                tool.Name, new Dictionary<string, object?>(args), new AiToolExecutionContext(correlationId), cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Studio bridge action {Action} threw (correlation {CorrelationId})", tool.Name, correlationId);
            return new StudioBridgeOutcome(false, ex.Message, null);
        }

        return result.Success
            ? new StudioBridgeOutcome(true, null, result.Data)
            : new StudioBridgeOutcome(false, result.ErrorMessage, null);
    }

    private async Task<CustomAutomationRun> RecordAsync(
        Guid tenantId, Guid automationId, Guid recordId, StudioAutomationRunStatus status,
        string? resultJson, string? error, Guid? runBy, CancellationToken cancellationToken)
    {
        var run = CustomAutomationRun.Create(tenantId, automationId, recordId, status, resultJson, Truncate(error), null, runBy);
        try
        {
            await _repo.AddRunAsync(run, cancellationToken);
        }
        catch (Exception ex)
        {
            // Recording the run is itself best-effort — never let logging failure surface.
            _logger.LogWarning(ex, "Could not persist automation run for {AutomationId} / record {RecordId}", automationId, recordId);
        }
        return run;
    }

    private static string? Truncate(string? s) =>
        s is { Length: > MaxErrorLength } ? s[..MaxErrorLength] : s;
}
