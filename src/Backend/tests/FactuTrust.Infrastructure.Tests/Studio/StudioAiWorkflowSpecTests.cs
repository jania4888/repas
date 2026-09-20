using System.Text;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 4.3 — <see cref="StudioAiWorkflowSpec"/> : parsing tolérant (alias FR/EN insensibles à la casse
/// et aux accents, racine tableau ou objet), normalisation vers la forme <c>StudioWorkflowStepsSpec</c>,
/// rejets en clair (jamais de troncature), <c>isActive</c> forcé à <c>false</c> (D-08). Depuis 4.7b5,
/// « scheduled » est conservé (alias FR « planifié » compris) — la validation du cron fait foi en aval.
/// </summary>
public sealed class StudioAiWorkflowSpecTests
{
    [Fact]
    public void Parses_root_array_and_root_object_alike()
    {
        const string asObject = """
        { "workflows": [ { "entityKey": "factures", "name": "Relance", "trigger": "manual",
          "steps": [ { "type": "notify", "to": { "kind": "startedBy" }, "title": "Relance" } ] } ] }
        """;
        const string asArray = """
        [ { "entityKey": "factures", "name": "Relance", "trigger": "manual",
            "steps": [ { "type": "notify", "to": { "kind": "startedBy" }, "title": "Relance" } ] } ]
        """;

        Assert.True(StudioAiWorkflowSpec.TryParse(asObject, out var fromObject, out var err1), err1);
        Assert.True(StudioAiWorkflowSpec.TryParse(asArray, out var fromArray, out var err2), err2);

        Assert.Single(fromObject!.Workflows);
        Assert.Single(fromArray!.Workflows);
        Assert.Equal(fromObject.Workflows[0].Key, fromArray.Workflows[0].Key);
        Assert.Equal(fromObject.Workflows[0].Steps.ToJsonString(), fromArray.Workflows[0].Steps.ToJsonString());
    }

    [Fact]
    public void Accepts_french_aliases_for_trigger_steps_and_properties()
    {
        const string spec = """
        { "automatisations": [ {
            "entite": "Factures",
            "nom": "Validation des factures",
            "déclencheur": "création",
            "étapes": [
              { "type": "si", "filtres": [ { "field": "montant", "op": "gt", "value": 1000 } ], "sinon": "stop" },
              { "type": "validation", "approbateur": { "kind": "role", "value": "Manager" }, "titre": "À valider",
                "texte": "Merci", "delai_heures": 48, "si_expiration": "reject", "si_refus": "stop" },
              { "type": "notifier", "destinataire": { "kind": "startedBy" }, "titre": "OK", "message": "Validée" }
            ] } ] }
        """;

        Assert.True(StudioAiWorkflowSpec.TryParse(spec, out var parsed, out var error), error);
        var wf = Assert.Single(parsed!.Workflows);
        Assert.Equal("factures", wf.EntityKey);
        Assert.Equal(StudioWorkflowTriggerKind.OnCreate, wf.Trigger);

        var steps = wf.Steps["steps"]!.AsArray();
        Assert.Equal(3, steps.Count);

        Assert.Equal("condition", steps[0]!["type"]!.GetValue<string>());
        Assert.NotNull(steps[0]!["filters"]);
        Assert.Equal("stop", steps[0]!["onFalse"]!.GetValue<string>());

        Assert.Equal("approval", steps[1]!["type"]!.GetValue<string>());
        Assert.NotNull(steps[1]!["assignee"]);
        Assert.Equal("À valider", steps[1]!["title"]!.GetValue<string>());
        // « texte » est conscient du type : message pour une approbation…
        Assert.Equal("Merci", steps[1]!["message"]!.GetValue<string>());
        Assert.Equal(48, steps[1]!["dueInHours"]!.GetValue<int>());
        Assert.Equal("reject", steps[1]!["onTimeout"]!.GetValue<string>());
        Assert.Equal("stop", steps[1]!["onReject"]!.GetValue<string>());

        Assert.Equal("notify", steps[2]!["type"]!.GetValue<string>());
        // … et body pour une notification.
        Assert.Equal("Validée", steps[2]!["body"]!.GetValue<string>());
    }

    [Fact]
    public void Derives_key_from_name_when_missing()
    {
        const string spec = """
        { "workflows": [ { "entityKey": "factures", "name": "Relance après échéance", "trigger": "manual",
          "steps": [ { "type": "wait", "hours": 24 }, { "type": "notify", "to": {"kind":"startedBy"}, "title": "Go" } ] } ] }
        """;

        Assert.True(StudioAiWorkflowSpec.TryParse(spec, out var parsed, out var error), error);
        var wf = Assert.Single(parsed!.Workflows);
        // StudioKey.Slugify (fiche) : minuscules, tout non [a-z0-9] → « _ » (accents non dépliés).
        Assert.Equal("relance_apr_s_ch_ance", wf.Key);

        // Clés d'étapes dérivées quand absentes.
        var steps = wf.Steps["steps"]!.AsArray();
        Assert.Equal("etape_1", steps[0]!["key"]!.GetValue<string>());
        Assert.Equal("etape_2", steps[1]!["key"]!.GetValue<string>());
    }

    [Fact]
    public void Keeps_scheduled_workflows_with_cron_and_filters()
    {
        const string spec = """
        { "workflows": [
            { "entityKey": "factures", "name": "Rappel hebdo", "trigger": "scheduled",
              "triggerConfig": { "cron": "0 6 * * 1", "filtres": [ { "field": "statut", "op": "eq", "value": "validee" } ] },
              "steps": [ { "type": "notify", "to": {"kind":"startedBy"}, "title": "Hebdo" } ] },
            { "entityKey": "factures", "name": "Relance", "trigger": "manual",
              "steps": [ { "type": "notify", "to": {"kind":"startedBy"}, "title": "Relance" } ] } ] }
        """;

        Assert.True(StudioAiWorkflowSpec.TryParse(spec, out var parsed, out var error), error);
        Assert.Equal(2, parsed!.Workflows.Count);
        Assert.Empty(parsed.Warnings);

        var wf = parsed.Workflows[0];
        Assert.Equal(StudioWorkflowTriggerKind.Scheduled, wf.Trigger);
        Assert.Equal("0 6 * * 1", wf.TriggerConfig["cron"]!.GetValue<string>());
        // Alias FR traduit ; les bornes des filtres sont validées en aval (b1).
        var filters = wf.TriggerConfig["filters"]!.AsArray();
        Assert.Single(filters);
        Assert.Equal("statut", filters[0]!["field"]!.GetValue<string>());

        // Demande d'enregistrement : déclencheur canonique snake_case, cron transporté.
        var request = StudioAiWorkflowSpec.ToSaveRequest(wf);
        Assert.Equal("scheduled", request.Trigger);
        Assert.Equal("0 6 * * 1", request.TriggerConfig!["cron"]!.GetValue<string>());
    }

    [Fact]
    public void Parses_a_scheduled_only_plan_with_the_french_alias()
    {
        const string spec = """
        { "workflows": [ { "entityKey": "factures", "name": "Rappel", "trigger": "planifié",
          "triggerConfig": { "cron": "0 6 * * *" },
          "steps": [ { "type": "notify", "to": {"kind":"startedBy"}, "title": "x" } ] } ] }
        """;

        Assert.True(StudioAiWorkflowSpec.TryParse(spec, out var parsed, out var error), error);
        var wf = Assert.Single(parsed!.Workflows);
        Assert.Equal(StudioWorkflowTriggerKind.Scheduled, wf.Trigger);
        Assert.Equal("0 6 * * *", wf.TriggerConfig["cron"]!.GetValue<string>());
    }

    [Fact]
    public void Fails_with_more_than_five_workflows()
    {
        var sb = new StringBuilder("""{ "workflows": [""");
        for (var i = 1; i <= 6; i++)
        {
            if (i > 1) sb.Append(',');
            sb.Append($$"""{ "entityKey": "factures", "name": "Flux {{i}}", "trigger": "manual", "steps": [ { "type": "wait", "hours": 1 } ] }""");
        }
        sb.Append("] }");

        Assert.False(StudioAiWorkflowSpec.TryParse(sb.ToString(), out _, out var error));
        Assert.Contains("5", error);
    }

    [Fact]
    public void Fails_without_entity_or_without_steps()
    {
        Assert.False(StudioAiWorkflowSpec.TryParse(
            """{ "workflows": [ { "name": "Sans table", "trigger": "manual", "steps": [ { "type": "wait", "hours": 1 } ] } ] }""",
            out _, out var noEntity));
        Assert.Contains("entityKey", noEntity);

        Assert.False(StudioAiWorkflowSpec.TryParse(
            """{ "workflows": [ { "entityKey": "factures", "name": "Sans étapes", "trigger": "manual", "steps": [] } ] }""",
            out _, out var noSteps));
        Assert.Contains("étape", noSteps);
    }

    [Fact]
    public void Fails_on_unknown_step_type()
    {
        Assert.False(StudioAiWorkflowSpec.TryParse(
            """{ "workflows": [ { "entityKey": "factures", "name": "Flux", "trigger": "manual", "steps": [ { "type": "envoyer_email" } ] } ] }""",
            out _, out var error));
        Assert.Contains("envoyer_email", error);
    }

    [Fact]
    public void Fails_beyond_thirty_steps_or_oversized_json()
    {
        var sb = new StringBuilder("""{ "workflows": [ { "entityKey": "factures", "name": "Flux", "trigger": "manual", "steps": [""");
        for (var i = 0; i < 31; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append("""{ "type": "wait", "hours": 1 }""");
        }
        sb.Append("] } ] }");
        Assert.False(StudioAiWorkflowSpec.TryParse(sb.ToString(), out _, out var tooMany));
        Assert.Contains("30", tooMany);

        var hugeTitle = new string('x', 70 * 1024);
        var big = $$"""{ "workflows": [ { "entityKey": "factures", "name": "Flux", "trigger": "manual", "steps": [ { "type": "notify", "to": {"kind":"startedBy"}, "title": "{{hugeTitle}}" } ] } ] }""";
        Assert.False(StudioAiWorkflowSpec.TryParse(big, out _, out var tooBig));
        Assert.Contains("64 Ko", tooBig);
    }

    [Fact]
    public void Forces_is_active_false_in_ToSaveRequest()
    {
        const string spec = """
        { "workflows": [ { "entityKey": "factures", "name": "Relance", "trigger": "manual", "isActive": true,
          "steps": [ { "type": "wait", "hours": 1 } ] } ] }
        """;

        Assert.True(StudioAiWorkflowSpec.TryParse(spec, out var parsed, out var error), error);
        var item = Assert.Single(parsed!.Workflows);
        Assert.False(item.IsActive); // D-08 : « isActive: true » émis par le modèle est ignoré.

        var request = StudioAiWorkflowSpec.ToSaveRequest(item);
        Assert.False(request.IsActive);
        Assert.Null(request.RowVersion);
        Assert.Equal("manual", request.Trigger);
        Assert.Equal(item.Key, request.Key);
        Assert.Same(item.Steps, request.Steps);
    }

    [Fact]
    public void Field_changed_trigger_config_is_normalised_to_field_from_to()
    {
        const string spec = """
        { "workflows": [ { "entityKey": "factures", "name": "Statut payée", "trigger": "changement_champ",
          "triggerConfig": { "champ": "statut", "de": "en_attente", "vers": "payee" },
          "steps": [ { "type": "notify", "to": {"kind":"startedBy"}, "title": "Payée" } ] } ] }
        """;

        Assert.True(StudioAiWorkflowSpec.TryParse(spec, out var parsed, out var error), error);
        var wf = Assert.Single(parsed!.Workflows);
        Assert.Equal(StudioWorkflowTriggerKind.FieldChanged, wf.Trigger);
        Assert.Equal(3, wf.TriggerConfig.Count);
        Assert.Equal("statut", wf.TriggerConfig["field"]!.GetValue<string>());
        Assert.Equal("en_attente", wf.TriggerConfig["from"]!.GetValue<string>());
        Assert.Equal("payee", wf.TriggerConfig["to"]!.GetValue<string>());
    }
}
