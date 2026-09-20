using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>
/// Déclencheur des workflows Studio (PR 4.1i) : écoute <see cref="CustomRecordWorkflowNotification"/>
/// (D13) et démarre, pour chaque définition active correspondant au déclencheur, une instance via le
/// moteur. Garde-fous : flag <c>Ollama:EnableStudioWorkflows</c> off ⇒ inerte ; profondeur bornée à
/// <see cref="StudioWorkflowExecutionScope.MaxDepth"/> ; anti-doublon
/// <c>HasOpenInstanceInChainAsync</c> ; quota d'instances ouvertes par enregistrement. Chaque
/// définition est traitée séquentiellement et isolément : un échec est journalisé (ids uniquement)
/// et n'empêche jamais les autres définitions ni le flux d'origine.
/// </summary>
public sealed class StudioWorkflowTriggerHandler : INotificationHandler<CustomRecordWorkflowNotification>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly IStudioWorkflowEngine _engine;
    private readonly IStudioQuotaService _quota;
    private readonly OllamaSettings _settings;
    private readonly ILogger<StudioWorkflowTriggerHandler> _logger;

    public StudioWorkflowTriggerHandler(
        IStudioWorkflowRepository workflows,
        IStudioWorkflowEngine engine,
        IStudioQuotaService quota,
        IOptions<OllamaSettings> settings,
        ILogger<StudioWorkflowTriggerHandler> logger)
    {
        _workflows = workflows;
        _engine = engine;
        _quota = quota;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task Handle(CustomRecordWorkflowNotification notification, CancellationToken cancellationToken)
    {
        if (!_settings.EnableStudioWorkflows)
            return;

        var kinds = notification.Trigger switch
        {
            StudioAutomationTrigger.OnCreate => new[] { StudioWorkflowTriggerKind.OnCreate },
            StudioAutomationTrigger.OnUpdate => new[] { StudioWorkflowTriggerKind.OnUpdate, StudioWorkflowTriggerKind.FieldChanged },
            _ => Array.Empty<StudioWorkflowTriggerKind>()
        };
        if (kinds.Length == 0)
            return;

        if (notification.Depth > StudioWorkflowExecutionScope.MaxDepth)
        {
            _logger.LogInformation(
                "Workflow trigger ignored beyond max depth {RecordId} {Depth}", notification.RecordId, notification.Depth);
            return;
        }

        foreach (var kind in kinds)
        {
            var definitions = await _workflows.ListActiveByTriggerAsync(
                notification.TenantId, notification.EntityDefinitionId, kind, cancellationToken);

            foreach (var definition in definitions)
            {
                try
                {
                    if (kind == StudioWorkflowTriggerKind.FieldChanged
                        && !FieldChangedMatches(definition, notification))
                    {
                        continue;
                    }

                    if (await _workflows.HasOpenInstanceInChainAsync(
                            notification.TenantId, definition.Id, notification.RecordId,
                            notification.OriginWorkflowInstanceId, cancellationToken))
                    {
                        continue;
                    }

                    var openCount = await _workflows.CountInstancesForRecordAsync(
                        notification.TenantId, notification.RecordId, openOnly: true, cancellationToken);
                    var quota = await _quota.EnsureUnderLimitAsync(
                        notification.TenantId, StudioQuotas.MaxWorkflowInstancesPerRecordKey, openCount,
                        StudioQuotas.MaxWorkflowInstancesPerRecordFallback,
                        "instances de workflow actives par enregistrement", cancellationToken);
                    if (quota.IsFailure)
                    {
                        _logger.LogWarning(
                            "Workflow instance quota reached {DefinitionId} {RecordId}", definition.Id, notification.RecordId);
                        continue;
                    }

                    await _engine.StartAsync(
                        definition,
                        notification.RecordId,
                        kind,
                        notification.RunBy,
                        startedByEmail: null,
                        notification.PreviousDataJson,
                        depth: notification.OriginWorkflowInstanceId is null ? 0 : notification.Depth + 1,
                        notification.OriginWorkflowInstanceId,
                        cancellationToken);
                }
                catch (Exception ex)
                {
                    // Isolation par définition : ids uniquement, jamais de données d'enregistrement.
                    _logger.LogWarning(ex, "Workflow start failed {DefinitionId} {RecordId}", definition.Id, notification.RecordId);
                }
            }
        }
    }

    /// <summary>
    /// « field_changed » (§0.5) : le champ configuré doit avoir réellement changé entre
    /// <c>PreviousDataJson</c> et <c>DataJson</c> (sémantique <c>eq</c> sur
    /// <see cref="StudioFilterEvaluator.ToPrimitive"/>) ; les bornes optionnelles <c>from</c> /
    /// <c>to</c> doivent en outre correspondre à l'ancienne / la nouvelle valeur.
    /// </summary>
    private static bool FieldChangedMatches(StudioWorkflowDefinition definition, CustomRecordWorkflowNotification notification)
    {
        if (!TryReadTriggerConfig(definition.TriggerConfigJson, out var field, out var from, out var to))
            return false; // config illisible : la validation l'aurait refusée — pas de déclenchement.

        var previous = ReadField(notification.PreviousDataJson, field);
        var current = ReadField(notification.DataJson, field);
        if (EqEquals(previous, current))
            return false;
        if (from is not null && !EqEquals(previous, from))
            return false;
        if (to is not null && !EqEquals(current, to))
            return false;
        return true;
    }

    private static bool TryReadTriggerConfig(
        string triggerConfigJson, out string field, out object? from, out object? to)
    {
        field = string.Empty;
        from = null;
        to = null;
        try
        {
            if (JsonNode.Parse(triggerConfigJson) is not JsonObject config)
                return false;
            if (config.TryGetPropertyValue("field", out var fieldNode)
                && fieldNode is JsonValue fieldValue
                && fieldValue.TryGetValue<string>(out var f)
                && !string.IsNullOrWhiteSpace(f))
            {
                field = f;
            }
            else
            {
                return false;
            }
            if (config.TryGetPropertyValue("from", out var fromNode))
                from = StudioFilterEvaluator.ToPrimitive(fromNode);
            if (config.TryGetPropertyValue("to", out var toNode))
                to = StudioFilterEvaluator.ToPrimitive(toNode);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static object? ReadField(string? dataJson, string field)
    {
        if (string.IsNullOrEmpty(dataJson))
            return null;
        try
        {
            var obj = JsonNode.Parse(dataJson) as JsonObject;
            return obj is not null && obj.TryGetPropertyValue(field, out var node)
                ? StudioFilterEvaluator.ToPrimitive(node)
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Sémantique <c>eq</c> de <see cref="StudioFilterEvaluator"/> : décimal quand les deux
    /// côtés sont numériques, sinon chaînes insensibles à la casse (null ≡ chaîne vide).</summary>
    private static bool EqEquals(object? a, object? b)
    {
        if (TryGetDecimal(a, out var da) && TryGetDecimal(b, out var db))
            return da == db;
        return string.Equals(AsString(a) ?? string.Empty, AsString(b) ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    private static string? AsString(object? value) => value switch
    {
        null => null,
        decimal d => d.ToString(CultureInfo.InvariantCulture),
        double db => db.ToString(CultureInfo.InvariantCulture),
        int i => i.ToString(CultureInfo.InvariantCulture),
        long l => l.ToString(CultureInfo.InvariantCulture),
        bool b => b ? "true" : "false",
        DateTime dt => dt.ToString("o", CultureInfo.InvariantCulture),
        _ => value.ToString()
    };

    private static bool TryGetDecimal(object? value, out decimal result)
    {
        switch (value)
        {
            case decimal d: result = d; return true;
            case double db: result = (decimal)db; return true;
            case int i: result = i; return true;
            case long l: result = l; return true;
            case string s when decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var ds): result = ds; return true;
            default: result = 0m; return false;
        }
    }
}
