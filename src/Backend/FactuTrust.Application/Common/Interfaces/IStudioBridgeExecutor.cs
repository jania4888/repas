using System.Text.Json.Nodes;
using FactuTrust.Domain.Entities.Studio;

namespace FactuTrust.Application.Common.Interfaces;

/// <summary>
/// Executes one Studio ERP-bridge automation against one record: resolves the action tool, maps the
/// record's fields to its arguments, runs it via the permission-gated tool executor, and writes a run
/// log entry (success/failure + result). Never throws — always returns a recorded run.
/// </summary>
public interface IStudioBridgeExecutor
{
    Task<CustomAutomationRun> ExecuteAsync(
        CustomEntityAutomation automation, Guid tenantId, Guid recordId, JsonObject? recordData,
        Guid? runBy, CancellationToken cancellationToken = default);

    /// <summary>
    /// Executes one ERP-bridge action by key, without an automation definition and without recording a
    /// run: resolves the tool, checks it is mutating, and invokes the permission-gated tool executor.
    /// Never throws — an unknown/non-mutating action or a tool exception becomes a failed outcome.
    /// </summary>
    Task<StudioBridgeOutcome> ExecuteActionAsync(
        string actionKey, IReadOnlyDictionary<string, object?> args, string correlationId,
        CancellationToken cancellationToken = default);
}

/// <summary>Outcome of one ERP-bridge action (D4): success flag, error message or serialized result.</summary>
public sealed record StudioBridgeOutcome(bool Success, string? Error, string? ResultJson);
