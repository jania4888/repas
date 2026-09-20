using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Enums;
using Xunit;
using static FactuTrust.Application.Features.Studio.Ai.StudioAiPlanSummary;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 4.3c — <see cref="StudioAiPlanSummary"/> : la clé <c>workflows</c> est TOUJOURS émise (tableau
/// vide par défaut, comme <c>duplicates</c> et <c>relations</c>), <c>ForWorkflow</c> produit le contrat
/// figé du brief §D (snake_case du déclencheur, libellés FR des étapes, <c>isActive:false</c>,
/// tables touchées avec <c>existingKey</c>), et les résumés persistés sans <c>workflows</c> restent lisibles.
/// </summary>
public sealed class StudioAiPlanSummaryTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private const string RelanceSpec = """
        { "workflows": [ { "entityKey": "factures", "name": "Relance", "trigger": "manual",
          "steps": [ { "type": "notify", "to": { "kind": "startedBy" }, "title": "Relance" } ] } ] }
        """;

    private const string TwoTablesSpec = """
        { "workflows": [
          { "entityKey": "factures", "name": "Relance", "trigger": "manual",
            "steps": [ { "type": "notify", "label": "Prévenir le commercial", "to": { "kind": "startedBy" }, "title": "Relance" } ] },
          { "entityKey": "devis", "name": "Contrôle devis", "trigger": "on_create",
            "steps": [ { "type": "condition", "filters": [ { "field": "montant", "op": "gt", "value": 1000 } ] },
                       { "type": "approval", "assignee": { "kind": "role", "value": "Manager" }, "title": "À valider" } ] } ] }
        """;

    [Fact]
    public void Existing_summaries_always_emit_workflows_as_empty_array()
    {
        Assert.True(StudioAiRecordViewSpec.TryParse(
            """{"entity":"interventions","name":"Toutes","mode":"list"}""", out var spec, out var error), error);

        var json = ForRecordView(spec!, "Interventions", Array.Empty<string>());

        Assert.Contains("\"workflows\":[]", json);
        Assert.Contains("\"duplicates\":[]", json);
        Assert.Contains("\"relations\":[]", json);
        var summary = JsonSerializer.Deserialize<PlanSummary>(json, Web)!;
        Assert.Equal("RecordView", summary.Kind);
        Assert.NotNull(summary.Workflows);
        Assert.Empty(summary.Workflows!);
    }

    [Fact]
    public void ForWorkflow_emits_contract_shape_with_inactive_flag_and_step_labels()
    {
        var spec = Parse(RelanceSpec);
        var schemas = new Dictionary<string, CustomEntitySchemaDto> { ["factures"] = Schema("factures", "Factures") };

        var json = ForWorkflow(spec, schemas, new[] { "Avertissement de test" });

        var root = JsonNode.Parse(json)!.AsObject();
        Assert.Equal("Workflow", root["kind"]!.GetValue<string>());
        Assert.Equal("1 workflow sur Factures", root["title"]!.GetValue<string>());
        Assert.Equal("Avertissement de test", Assert.Single(root["warnings"]!.AsArray())!.GetValue<string>());

        // Contrat figé brief §D (camelCase, additif : entityKey + entityDisplayName).
        var workflow = Assert.Single(root["workflows"]!.AsArray())!.AsObject();
        Assert.Equal("relance", workflow["key"]!.GetValue<string>());
        Assert.Equal("Relance", workflow["name"]!.GetValue<string>());
        Assert.Equal("factures", workflow["entityKey"]!.GetValue<string>());
        Assert.Equal("Factures", workflow["entityDisplayName"]!.GetValue<string>());
        Assert.Equal("manual", workflow["trigger"]!.GetValue<string>());
        Assert.Equal(1, workflow["stepCount"]!.GetValue<int>());
        Assert.False(workflow["isActive"]!.GetValue<bool>());
        var step = Assert.Single(workflow["steps"]!.AsArray())!.AsObject();
        Assert.Equal("etape_1", step["key"]!.GetValue<string>());
        Assert.Equal("notify", step["type"]!.GetValue<string>());
        Assert.Equal("Notifier", step["label"]!.GetValue<string>()); // libellé FR du catalogue, faute de label explicite

        var summary = JsonSerializer.Deserialize<PlanSummary>(json, Web)!;
        Assert.Equal(new SummaryEntity("Factures", 2, 0, ExistingKey: "factures"), Assert.Single(summary.Entities));
        Assert.Single(summary.Steps);
        Assert.Equal("relance", summary.Steps[0].Key);
        Assert.Equal("Relance", summary.Steps[0].Label);
        Assert.Equal("Factures · manuel · 1 étape(s) · créé inactif", summary.Steps[0].Detail);
        Assert.Empty(summary.Duplicates!);
        Assert.Empty(summary.Relations!);
    }

    [Fact]
    public void ForWorkflow_uses_explicit_step_label_and_falls_back_to_entity_key_when_schema_is_unknown()
    {
        var spec = Parse(TwoTablesSpec);

        // Aucun schéma connu : la clé est affichée telle quelle, 0 champ.
        var unknown = JsonSerializer.Deserialize<PlanSummary>(
            ForWorkflow(spec, new Dictionary<string, CustomEntitySchemaDto>(), Array.Empty<string>()), Web)!;

        Assert.Equal(2, unknown.Workflows!.Count);
        Assert.Equal("Prévenir le commercial", unknown.Workflows[0].Steps[0].Label);
        Assert.Equal("factures", unknown.Workflows[0].EntityDisplayName);
        Assert.Equal(2, unknown.Workflows[1].StepCount);
        Assert.Equal(new[] { "Condition", "Approbation" }, unknown.Workflows[1].Steps.Select(s => s.Label));
        Assert.Equal("on_create", unknown.Workflows[1].Trigger);
        Assert.All(unknown.Workflows, w => Assert.False(w.IsActive));
        Assert.Equal(2, unknown.Entities.Count);
        Assert.Equal(new SummaryEntity("factures", 0, 0, ExistingKey: "factures"), unknown.Entities[0]);
        Assert.Equal("2 workflows sur factures, devis", unknown.Title);

        // Deux tables connues : libellés réels, une entité par clé distincte.
        var schemas = new Dictionary<string, CustomEntitySchemaDto>
        {
            ["factures"] = Schema("factures", "Factures"),
            ["devis"] = Schema("devis", "Devis")
        };
        var known = JsonSerializer.Deserialize<PlanSummary>(ForWorkflow(spec, schemas, Array.Empty<string>()), Web)!;

        Assert.Equal("2 workflows sur Factures, Devis", known.Title);
        Assert.Equal(2, known.Entities.Count);
        Assert.Equal("Factures", known.Workflows![0].EntityDisplayName);
        Assert.Equal("Devis", known.Workflows[1].EntityDisplayName);
        Assert.Equal(2, known.Steps.Count); // une ligne de checklist par workflow (D-43-04)
    }

    [Fact]
    public void Stored_summaries_without_workflows_still_deserialize()
    {
        var summary = JsonSerializer.Deserialize<PlanSummary>(
            "{\"kind\":\"CreateApp\",\"title\":\"t\",\"steps\":[],\"entities\":[],\"warnings\":[]}", Web);

        Assert.NotNull(summary);
        Assert.Equal("CreateApp", summary!.Kind);
        Assert.Null(summary.Workflows);
    }

    // ---- Helpers ----

    private static ParsedWorkflowPlanSpec Parse(string specJson)
    {
        Assert.True(StudioAiWorkflowSpec.TryParse(specJson, out var spec, out var error), error);
        return spec!;
    }

    /// <summary>Schéma minimal d'une table existante (2 champs, aucune relation) — motif de StudioAiPlanExecutorTests.</summary>
    private static CustomEntitySchemaDto Schema(string key, string displayName)
    {
        var fields = new List<CustomFieldDto>
        {
            new(Guid.NewGuid(), "numero", "Numéro", CustomFieldType.Text, false, false, 1, null, null, null, true),
            new(Guid.NewGuid(), "montant", "Montant", CustomFieldType.Number, false, false, 2, null, null, null, true)
        };
        return new CustomEntitySchemaDto(
            new CustomEntityDto(Guid.NewGuid(), key, displayName, displayName, null, null, true, fields.Count, null,
                DateTime.UtcNow, DateTime.UtcNow),
            fields, new FormLayout());
    }
}
