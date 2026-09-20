using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Automations;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;

/// <summary>
/// Handler de l'étape <c>create_record</c> (D2) : crée un enregistrement dans une autre table du
/// tenant en miroir exact du flux Create de l'API (<c>CreateCustomRecordCommandHandler</c>) —
/// entité cible active et non-jonction, gabarits <c>set</c> rendus puis validés par
/// <see cref="CustomRecordValidator"/>, quota « enregistrements par table », compute-on-write,
/// contrôles d'unicité et de paire de jonction, persistance, puis publication legacy
/// <c>OnCreate</c>. L'identifiant créé est mémorisé sous <c>saveResultAs</c> et journalisé.
/// </summary>
public sealed class CreateRecordStepHandler : IStudioWorkflowStepHandler
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly IStudioQuotaService _quota;
    private readonly IStudioComputedFieldWriter _computedWriter;
    private readonly IPublisher _publisher;
    private readonly ILogger<CreateRecordStepHandler> _logger;

    public CreateRecordStepHandler(
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordRepository records,
        IStudioQuotaService quota,
        IStudioComputedFieldWriter computedWriter,
        IPublisher publisher,
        ILogger<CreateRecordStepHandler> logger)
    {
        _entities = entities;
        _fields = fields;
        _records = records;
        _quota = quota;
        _computedWriter = computedWriter;
        _publisher = publisher;
        _logger = logger;
    }

    public string StepType => StudioWorkflowStepTypes.CreateRecord;

    public async Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
    {
        var raw = ctx.Step.Raw;
        var entityKey = ReadString(raw, "entity");

        var target = entityKey is null
            ? null
            : await _entities.GetByKeyAsync(ctx.TenantId, entityKey, cancellationToken);
        if (target is null || !target.IsActive || target.Kind == CustomEntityKind.Junction)
            return new StepOutcome.Fail($"Table cible « {entityKey} » introuvable ou non autorisée.");

        if (!raw.TryGetPropertyValue("set", out var setNode) || setNode is not JsonObject set || set.Count == 0)
            return new StepOutcome.Fail("« set » est requis (1 à 10 paires champ → valeur, gabarits autorisés).");

        var targetFields = await _fields.ListByEntityAsync(
            ctx.TenantId, target.Id, includeInactive: false, cancellationToken);

        // Gabarits « {{…}} » rendus contre l'enregistrement et le contexte courants.
        var data = new Dictionary<string, JsonNode?>(StringComparer.Ordinal);
        foreach (var pair in set)
            data[pair.Key] = StudioTemplateRenderer.RenderValue(pair.Value, ctx.RecordData, ctx.Context, ctx.NowUtc);

        var validation = CustomRecordValidator.ValidateAndCanonicalize(targetFields, data);
        if (validation.IsFailure)
            return new StepOutcome.Fail(validation.Error.Description);

        var count = await _records.CountAsync(ctx.TenantId, target.Id, cancellationToken);
        var quota = await _quota.EnsureUnderLimitAsync(
            ctx.TenantId, StudioQuotas.MaxRecordsKey, count, StudioQuotas.MaxRecordsFallback,
            "enregistrements par table", cancellationToken);
        if (quota.IsFailure)
            return new StepOutcome.Fail(quota.Error.Description);

        // Compute-on-write : allocation des AutoNumber avant persistance.
        var canonical = await _computedWriter.ApplyOnCreateAsync(
            ctx.TenantId, target.Id, targetFields, validation.Value, cancellationToken);

        var uniqueError = await UniqueFieldChecker.CheckAsync(
            _records, ctx.TenantId, target.Id, targetFields, canonical, excludeId: null, cancellationToken);
        if (uniqueError is not null)
            return new StepOutcome.Fail(uniqueError.Description);

        var pairError = await JunctionPairChecker.CheckAsync(
            _records, target, targetFields, canonical, excludeId: null, cancellationToken);
        if (pairError is not null)
            return new StepOutcome.Fail(pairError.Description);

        var record = CustomRecord.Create(ctx.TenantId, target.Id, canonical, ctx.Instance.StartedBy);
        await _records.AddAsync(record, cancellationToken);

        // Pont ERP : déclenche OnCreate (best-effort, l'enregistrement est déjà persisté).
        await StudioRecordLifecycle.PublishAsync(
            _publisher, ctx.TenantId, target.Id, record.Id, canonical,
            StudioAutomationTrigger.OnCreate, ctx.Instance.StartedBy, cancellationToken);

        // Workflows Studio (PR 4.1i) : le marqueur ambiant fournit origine et profondeur (anti-boucle).
        await StudioWorkflowLifecycle.PublishAsync(
            _publisher, ctx.TenantId, target.Id, record.Id, canonical, null,
            StudioAutomationTrigger.OnCreate, ctx.Instance.StartedBy, _logger, cancellationToken);

        JsonObject result = new()
        {
            ["recordId"] = record.Id,
            ["entityKey"] = target.Key
        };
        var saveResultAs = ReadString(raw, "saveResultAs");
        if (!string.IsNullOrWhiteSpace(saveResultAs))
            ctx.Context.SetResult(saveResultAs, result.DeepClone());

        _logger.LogInformation(
            "Workflow created record {InstanceId} {RecordId}", ctx.Instance.Id, record.Id);
        return new StepOutcome.Continue(result);
    }

    private static string? ReadString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<string>(out var s)
            ? s
            : null;
}
