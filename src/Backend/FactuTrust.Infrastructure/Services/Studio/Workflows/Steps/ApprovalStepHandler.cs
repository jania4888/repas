using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;

/// <summary>
/// Handler de l'étape <c>approval</c> : au premier passage, crée une
/// <see cref="StudioWorkflowApproval"/> en attente (échéance bornée par <c>dueInHours</c>,
/// 72 h par défaut, clampée 1..720), notifie l'approbateur au mieux
/// (<see cref="NotificationType.StudioWorkflowApprovalRequested"/>, lien « /studio/approvals »)
/// puis suspend l'instance (<c>WaitingApproval</c>). À la reprise, suit la décision enregistrée
/// dans le contexte (<c>_approval.&lt;clé&gt;.status</c>) : <c>approved</c> ⇒ poursuite ;
/// <c>rejected</c> ⇒ <c>onReject</c> (stop/goto/continue) ; <c>expired</c> ⇒ <c>onTimeout</c>
/// (reject ⇒ même chemin que refusé, approve ⇒ poursuite, fail ⇒ échec) ; décision absente ⇒
/// échec figé.
/// </summary>
public sealed class ApprovalStepHandler : IStudioWorkflowStepHandler
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly INotificationService _notifications;
    private readonly ILogger<ApprovalStepHandler> _logger;

    public ApprovalStepHandler(
        IStudioWorkflowRepository workflows,
        INotificationService notifications,
        ILogger<ApprovalStepHandler> logger)
    {
        _workflows = workflows;
        _notifications = notifications;
        _logger = logger;
    }

    public string StepType => StudioWorkflowStepTypes.Approval;

    public async Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
    {
        var raw = ctx.Step.Raw;
        if (!ctx.IsResume)
            return await RequestApprovalAsync(ctx, raw, cancellationToken);

        var status = ctx.Context.Resolve($"_approval.{ctx.Step.Key}.status") is JsonValue node
            && node.TryGetValue<string>(out var s)
                ? s
                : null;

        var onReject = ReadString(raw, "onReject") ?? "stop";
        var gotoKey = ReadString(raw, "gotoKey");
        var onTimeout = ReadString(raw, "onTimeout") ?? "reject";

        return status switch
        {
            "approved" => new StepOutcome.Continue(),
            "rejected" => RejectedOutcome(onReject, gotoKey),
            "expired" => onTimeout switch
            {
                "approve" => new StepOutcome.Continue(),
                "fail" => new StepOutcome.Fail("Approbation expirée."),
                _ => RejectedOutcome(onReject, gotoKey) // « reject » (défaut) : même chemin qu'un refus.
            },
            _ => new StepOutcome.Fail("Décision d'approbation introuvable.")
        };
    }

    /// <summary>Premier passage : création de l'approbation, notification best-effort, suspension.</summary>
    private async Task<StepOutcome> RequestApprovalAsync(
        StepExecutionContext ctx, JsonObject raw, CancellationToken cancellationToken)
    {
        Guid? assigneeUserId = null;
        string? assigneeRole = null;
        if (raw.TryGetPropertyValue("assignee", out var assigneeNode) && assigneeNode is JsonObject assignee)
        {
            var kind = ReadString(assignee, "kind");
            var value = ReadString(assignee, "value");
            if (kind == "user" && Guid.TryParse(value, out var parsed))
                assigneeUserId = parsed;
            else if (kind == "role")
                assigneeRole = value;
        }

        var dueInHours = ReadInt(raw, "dueInHours");
        var dueAt = ctx.NowUtc.AddHours(Math.Clamp(dueInHours ?? StudioWorkflowStepsSpec.DefaultApprovalDueInHours, 1, StudioWorkflowStepsSpec.MaxHours));

        var title = Truncate(
            StudioTemplateRenderer.Render(
                ReadString(raw, "title") ?? string.Empty, ctx.RecordData, ctx.Context, ctx.NowUtc).Value,
            UserNotification.TitleMaxLength);
        var messageTemplate = ReadString(raw, "message");
        var message = messageTemplate is null
            ? null
            : Truncate(
                StudioTemplateRenderer.Render(messageTemplate, ctx.RecordData, ctx.Context, ctx.NowUtc).Value,
                UserNotification.BodyMaxLength);

        var approval = StudioWorkflowApproval.Create(
            ctx.TenantId, ctx.Instance.Id, ctx.Step.Key, assigneeUserId, assigneeRole, title, message, dueAt);
        await _workflows.AddApprovalAsync(approval, cancellationToken);

        try
        {
            await _notifications.CreateAsync(
                ctx.TenantId, assigneeRole, NotificationType.StudioWorkflowApprovalRequested,
                title, message ?? string.Empty, "/studio/approvals", assigneeUserId, cancellationToken);
        }
        catch (Exception ex)
        {
            // Notification best-effort : l'approbation est déjà persistée.
            _logger.LogWarning(ex, "Approval notification failed {InstanceId}", ctx.Instance.Id);
        }

        return new StepOutcome.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, dueAt, new JsonObject
        {
            ["approvalId"] = approval.Id,
            ["status"] = "pending"
        });
    }

    private static StepOutcome RejectedOutcome(string onReject, string? gotoKey) => onReject switch
    {
        "goto" when !string.IsNullOrWhiteSpace(gotoKey) => new StepOutcome.Goto(gotoKey),
        "continue" => new StepOutcome.Continue(),
        _ => new StepOutcome.Stop("Approbation refusée")
    };

    private static string Truncate(string value, int max) =>
        value.Length > max ? value[..max] : value;

    private static string? ReadString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<string>(out var s)
            ? s
            : null;

    private static int? ReadInt(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<int>(out var i)
            ? i
            : null;
}
