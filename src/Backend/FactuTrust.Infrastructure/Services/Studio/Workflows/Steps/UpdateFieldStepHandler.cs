using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Automations;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;

/// <summary>
/// Handler de l'étape <c>update_field</c> : écrit une ou plusieurs valeurs dans l'enregistrement
/// courant en miroir exact du flux PATCH de l'API (<c>CustomRecordPatchFeatures</c>) — gabarits
/// rendus, fusion + validation par <see cref="CustomRecordPatchMerger"/>, compute-on-write,
/// contrôles d'unicité et de paire de jonction, écriture avec concurrence optimiste, puis
/// publication legacy <c>OnUpdate</c>. Le journal ne contient que les clés, jamais les valeurs.
/// </summary>
public sealed class UpdateFieldStepHandler : IStudioWorkflowStepHandler
{
    private readonly ICustomRecordRepository _records;
    private readonly IStudioComputedFieldWriter _computedWriter;
    private readonly IPublisher _publisher;
    private readonly ILogger<UpdateFieldStepHandler> _logger;

    public UpdateFieldStepHandler(
        ICustomRecordRepository records,
        IStudioComputedFieldWriter computedWriter,
        IPublisher publisher,
        ILogger<UpdateFieldStepHandler> logger)
    {
        _records = records;
        _computedWriter = computedWriter;
        _publisher = publisher;
        _logger = logger;
    }

    public string StepType => StudioWorkflowStepTypes.UpdateField;

    public async Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
    {
        if (!ctx.Step.Raw.TryGetPropertyValue("set", out var setNode) || setNode is not JsonObject set || set.Count == 0)
            return new StepOutcome.Fail("« set » est requis (1 à 10 paires champ → valeur, gabarits autorisés).");

        // Gabarits « {{…}} » rendus contre l'enregistrement et le contexte courants.
        var patch = new Dictionary<string, JsonNode?>(StringComparer.Ordinal);
        foreach (var pair in set)
            patch[pair.Key] = StudioTemplateRenderer.RenderValue(pair.Value, ctx.RecordData, ctx.Context, ctx.NowUtc);

        // Fusion partielle + validation : refuse les clés inconnues, réservées ou calculées.
        var merged = CustomRecordPatchMerger.MergePatch(ctx.Record.DataJson, patch, ctx.Fields);
        if (merged.IsFailure)
            return new StepOutcome.Fail(merged.Error.Description);

        var tenantId = ctx.TenantId;
        var canonical = await _computedWriter.ApplyOnUpdateAsync(
            tenantId, ctx.Entity.Id, ctx.Fields, merged.Value, ctx.Record.DataJson, cancellationToken);

        var uniqueError = await UniqueFieldChecker.CheckAsync(
            _records, tenantId, ctx.Entity.Id, ctx.Fields, canonical, excludeId: ctx.Record.Id, cancellationToken);
        if (uniqueError is not null)
            return new StepOutcome.Fail(uniqueError.Description);

        var pairError = await JunctionPairChecker.CheckAsync(
            _records, ctx.Entity, ctx.Fields, canonical, excludeId: ctx.Record.Id, cancellationToken);
        if (pairError is not null)
            return new StepOutcome.Fail(pairError.Description);

        // PR 4.1i : capture AVANT SetData pour le déclencheur « field_changed » des workflows chaînés.
        var previous = ctx.Record.DataJson;

        ctx.Record.SetData(canonical, ctx.Instance.StartedBy);
        try
        {
            await _records.UpdateWithConcurrencyAsync(ctx.Record, ctx.Record.RowVersion, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Course entre la relecture par le moteur et l'écriture : la ligne a changé entre-temps.
            _logger.LogWarning(
                "Concurrency conflict on workflow update_field {InstanceId} {RecordId}", ctx.Instance.Id, ctx.Record.Id);
            return new StepOutcome.Fail("Enregistrement modifié entre-temps.");
        }

        // Pont ERP : déclenche OnUpdate (best-effort, l'enregistrement est déjà persisté).
        await StudioRecordLifecycle.PublishAsync(
            _publisher, tenantId, ctx.Entity.Id, ctx.Record.Id, canonical,
            StudioAutomationTrigger.OnUpdate, ctx.Instance.StartedBy, cancellationToken);

        // Workflows Studio (PR 4.1i) : le marqueur ambiant fournit origine et profondeur (anti-boucle).
        await StudioWorkflowLifecycle.PublishAsync(
            _publisher, tenantId, ctx.Entity.Id, ctx.Record.Id, canonical, previous,
            StudioAutomationTrigger.OnUpdate, ctx.Instance.StartedBy, _logger, cancellationToken);

        // Journal : clés uniquement, jamais les valeurs écrites.
        return new StepOutcome.Continue(new JsonObject
        {
            ["set"] = new JsonArray(patch.Keys.Select(k => (JsonNode?)JsonValue.Create(k)).ToArray()),
            ["warnings"] = new JsonArray()
        });
    }
}
