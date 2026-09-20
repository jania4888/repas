using System.Globalization;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;

/// <summary>
/// Handler de l'étape <c>wait</c> : suspend l'instance (<c>Waiting</c>) jusqu'à
/// <c>NowUtc + hours</c> ou jusqu'à la date <c>until</c> (gabarit rendu, analysé en invariant /
/// supposé UTC — illisible ⇒ échec figé), plafonnée à <c>maxHours</c> (720 h par défaut, clampée
/// 1..720). Une échéance déjà passée poursuit immédiatement ; la reprise (<c>IsResume</c>)
/// poursuit toujours.
/// </summary>
public sealed class WaitStepHandler : IStudioWorkflowStepHandler
{
    public string StepType => StudioWorkflowStepTypes.Wait;

    public Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
    {
        if (ctx.IsResume)
            return Task.FromResult<StepOutcome>(new StepOutcome.Continue());

        var raw = ctx.Step.Raw;
        DateTime dueAt;
        var hours = ReadInt(raw, "hours");
        if (hours is not null)
        {
            dueAt = ctx.NowUtc.AddHours(hours.Value);
        }
        else
        {
            var (rendered, _) = StudioTemplateRenderer.Render(
                ReadString(raw, "until") ?? string.Empty, ctx.RecordData, ctx.Context, ctx.NowUtc);
            if (!DateTime.TryParse(rendered, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out dueAt))
                return Task.FromResult<StepOutcome>(new StepOutcome.Fail("Date d'attente invalide."));
        }

        var cap = ctx.NowUtc.AddHours(Math.Clamp(ReadInt(raw, "maxHours") ?? StudioWorkflowStepsSpec.DefaultWaitMaxHours, 1, StudioWorkflowStepsSpec.MaxHours));
        if (dueAt > cap)
            dueAt = cap;

        if (dueAt <= ctx.NowUtc)
            return Task.FromResult<StepOutcome>(new StepOutcome.Continue());

        return Task.FromResult<StepOutcome>(new StepOutcome.Suspend(
            StudioWorkflowInstanceStatus.Waiting, dueAt, new JsonObject
            {
                ["dueAt"] = dueAt.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture)
            }));
    }

    private static string? ReadString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<string>(out var s)
            ? s
            : null;

    private static int? ReadInt(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<int>(out var i)
            ? i
            : null;
}
