using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;

/// <summary>
/// Handler de l'étape <c>notify</c> : envoie une notification applicative
/// (<see cref="NotificationType.StudioWorkflowMessage"/>) au destinataire déclaré —
/// utilisateur (<c>user</c>), rôle (<c>role</c>) ou lanceur de l'instance
/// (<c>startedBy</c>, inconnu ⇒ <c>Skip</c>). Titre/corps/lien sont rendus par
/// <see cref="StudioTemplateRenderer"/> puis tronqués aux bornes de <see cref="UserNotification"/>
/// (200/1000/300) ; un lien non relatif (« /… ») est abandonné. L'envoi ne bloque jamais le
/// workflow : toute exception ⇒ <c>Fail(ContinueAnyway: true)</c>.
/// </summary>
public sealed class NotifyStepHandler : IStudioWorkflowStepHandler
{
    private readonly INotificationService _notifications;
    private readonly ILogger<NotifyStepHandler> _logger;

    public NotifyStepHandler(INotificationService notifications, ILogger<NotifyStepHandler> logger)
    {
        _notifications = notifications;
        _logger = logger;
    }

    public string StepType => StudioWorkflowStepTypes.Notify;

    public async Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
    {
        var raw = ctx.Step.Raw;
        string? kind = null;
        string? value = null;
        if (raw.TryGetPropertyValue("to", out var toNode) && toNode is JsonObject to)
        {
            kind = ReadString(to, "kind");
            value = ReadString(to, "value");
        }

        Guid? recipientUserId = null;
        string? recipientRole = null;
        switch (kind)
        {
            case "user":
                recipientUserId = Guid.Parse(value!);
                break;
            case "role":
                recipientRole = value;
                break;
            case "startedBy":
                if (ctx.Instance.StartedBy is null)
                    return new StepOutcome.Skip("Lanceur inconnu");
                recipientUserId = ctx.Instance.StartedBy;
                break;
            default:
                return new StepOutcome.Fail("Destinataire « to » manquant ou non reconnu.");
        }

        try
        {
            var title = Truncate(
                StudioTemplateRenderer.Render(
                    ReadString(raw, "title") ?? string.Empty, ctx.RecordData, ctx.Context, ctx.NowUtc).Value,
                UserNotification.TitleMaxLength);
            var body = Truncate(
                StudioTemplateRenderer.Render(
                    ReadString(raw, "body") ?? string.Empty, ctx.RecordData, ctx.Context, ctx.NowUtc).Value,
                UserNotification.BodyMaxLength);

            string? link = null;
            var renderedLink = StudioTemplateRenderer.Render(
                ReadString(raw, "link") ?? string.Empty, ctx.RecordData, ctx.Context, ctx.NowUtc).Value;
            if (renderedLink.StartsWith("/", StringComparison.Ordinal))
                link = Truncate(renderedLink, UserNotification.LinkUrlMaxLength);

            await _notifications.CreateAsync(
                ctx.TenantId, recipientRole, NotificationType.StudioWorkflowMessage,
                title, body, link, recipientUserId, cancellationToken);

            return new StepOutcome.Continue(new JsonObject
            {
                ["to"] = kind,
                ["title"] = title
            });
        }
        catch (Exception ex)
        {
            // La notification est best-effort : elle ne doit jamais bloquer le workflow.
            _logger.LogWarning(ex, "Workflow notify step failed {InstanceId}", ctx.Instance.Id);
            return new StepOutcome.Fail(ex.Message, ContinueAnyway: true);
        }
    }

    private static string Truncate(string value, int max) =>
        value.Length > max ? value[..max] : value;

    private static string? ReadString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<string>(out var s)
            ? s
            : null;
}
