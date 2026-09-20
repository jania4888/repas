using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Features.Studio.Automations;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;

/// <summary>
/// Handler de l'étape <c>erp_action</c> : résout l'action dans le catalogue du Pont
/// (<see cref="StudioBridgeActionCatalog"/>), traduit les entrées <c>mapping</c>
/// (champ / constante / gabarit rendu) en arguments via <see cref="StudioBridgeMapper"/>, puis
/// exécute l'action par <see cref="IStudioBridgeExecutor.ExecuteActionAsync"/> avec la corrélation
/// <c>studio-workflow:&lt;instance&gt;:&lt;étape&gt;</c>. Échec ⇒ <c>Fail</c> (poursuite possible
/// si <c>onFailure</c> = <c>continue</c>) ; succès ⇒ résultat mémorisé sous <c>saveResultAs</c>
/// et journalisé tronqué à 8 Ko.
/// </summary>
public sealed class ErpActionStepHandler : IStudioWorkflowStepHandler
{
    private const int MaxJournalResultBytes = 8 * 1024;

    private readonly IStudioBridgeExecutor _bridge;
    private readonly ILogger<ErpActionStepHandler> _logger;

    public ErpActionStepHandler(IStudioBridgeExecutor bridge, ILogger<ErpActionStepHandler> logger)
    {
        _bridge = bridge;
        _logger = logger;
    }

    public string StepType => StudioWorkflowStepTypes.ErpAction;

    public async Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
    {
        var raw = ctx.Step.Raw;
        var action = ReadString(raw, "action");
        var tool = StudioBridgeActionCatalog.Resolve(action);
        if (tool is null)
            return new StepOutcome.Fail($"Action ERP « {action} » inconnue ou non autorisée.");

        var mappings = ReadMappings(raw, ctx);
        var (args, mapError) = StudioBridgeMapper.Build(mappings, ctx.RecordData, tool);
        if (mapError is not null)
            return new StepOutcome.Fail(mapError);

        var outcome = await _bridge.ExecuteActionAsync(
            tool.Name, args, $"studio-workflow:{ctx.Instance.Id:N}:{ctx.Step.Key}", cancellationToken);

        if (!outcome.Success)
        {
            _logger.LogWarning(
                "Workflow ERP action failed {InstanceId} {StepKey}", ctx.Instance.Id, ctx.Step.Key);
            var onFailure = ReadString(raw, "onFailure");
            return new StepOutcome.Fail(
                outcome.Error ?? "Échec de l'action ERP.", ContinueAnyway: onFailure == "continue");
        }

        var saveResultAs = ReadString(raw, "saveResultAs");
        if (!string.IsNullOrWhiteSpace(saveResultAs))
            ctx.Context.SetResult(saveResultAs, ParseResult(outcome.ResultJson, truncate: false));

        return new StepOutcome.Continue(new JsonObject
        {
            ["action"] = tool.Name,
            ["result"] = ParseResult(outcome.ResultJson, truncate: true)
        });
    }

    /// <summary>Entrées <c>mapping</c> : champ, constante ou gabarit (rendu puis passé en constante).</summary>
    private static List<BridgeParamMapping> ReadMappings(JsonObject raw, StepExecutionContext ctx)
    {
        var mappings = new List<BridgeParamMapping>();
        if (!raw.TryGetPropertyValue("mapping", out var node) || node is not JsonArray arr)
            return mappings;
        foreach (var item in arr)
        {
            if (item is not JsonObject map) continue;
            var param = ReadString(map, "param");
            if (string.IsNullOrWhiteSpace(param)) continue;
            var source = ReadString(map, "source") ?? "field";
            var value = ReadString(map, "value");
            if (source == "template")
            {
                var (rendered, _) = StudioTemplateRenderer.Render(value ?? string.Empty, ctx.RecordData, ctx.Context, ctx.NowUtc);
                mappings.Add(new BridgeParamMapping(param, "const", rendered));
            }
            else
            {
                mappings.Add(new BridgeParamMapping(param, source, value));
            }
        }
        return mappings;
    }

    /// <summary>Analyse null-safe ; le journal est tronqué à 8 Ko (le contexte re-tronque à 2 Ko).</summary>
    private static JsonNode? ParseResult(string? resultJson, bool truncate)
    {
        if (resultJson is null)
            return null;
        if (truncate && resultJson.Length > MaxJournalResultBytes)
            resultJson = resultJson[..MaxJournalResultBytes];
        try
        {
            return JsonNode.Parse(resultJson);
        }
        catch (JsonException)
        {
            return JsonValue.Create(resultJson);
        }
    }

    private static string? ReadString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<string>(out var s)
            ? s
            : null;
}
