using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Fixture figée (§6) : entité <c>commandes</c> avec <c>statut</c> Select, <c>montant</c> Decimal,
/// <c>client</c> RelationExisting, <c>total</c> Formula (calculé), <c>ref</c> AutoNumber ;
/// <c>resolveAction</c> = <see cref="StudioBridgeActionCatalog.Resolve"/> ;
/// <c>resolveEntityFields</c> = { taches ⇒ [titre Text, fait Boolean] }.
/// </summary>
public sealed class StudioWorkflowStepsSpecTests
{
    private static readonly Guid Tid = Guid.NewGuid();

    private static readonly CustomEntityDefinition Entity =
        CustomEntityDefinition.Create(Tid, "commandes", "Commande", "Commandes", null, null, null);

    private static readonly IReadOnlyList<CustomFieldDefinition> Fields = new[]
    {
        Field(Entity.Id, "statut", CustomFieldType.Select, 0),
        Field(Entity.Id, "montant", CustomFieldType.Decimal, 1),
        Field(Entity.Id, "client", CustomFieldType.RelationExisting, 2),
        Field(Entity.Id, "total", CustomFieldType.Formula, 3),
        Field(Entity.Id, "ref", CustomFieldType.AutoNumber, 4)
    };

    private static readonly Guid TachesId = Guid.NewGuid();

    private static readonly IReadOnlyList<CustomFieldDefinition> TachesFields = new[]
    {
        Field(TachesId, "titre", CustomFieldType.Text, 0),
        Field(TachesId, "fait", CustomFieldType.Boolean, 1)
    };

    private static CustomFieldDefinition Field(Guid entityId, string key, CustomFieldType type, int sort)
        => CustomFieldDefinition.Create(Tid, entityId, key, key, type, false, false, sort, null, null, null, null);

    private static IReadOnlyList<CustomFieldDefinition>? ResolveEntityFields(string key)
        => key == "taches" ? TachesFields : null;

    private static WorkflowValidationOutcome Validate(
        string stepsJson,
        StudioWorkflowTriggerKind trigger = StudioWorkflowTriggerKind.OnCreate,
        string triggerConfig = "{}")
        => StudioWorkflowStepsSpec.Validate(
            stepsJson, trigger, triggerConfig, Entity, Fields, StudioBridgeActionCatalog.Resolve, ResolveEntityFields);

    private static string Notify(string key)
        => $$"""{ "key": "{{key}}", "type": "notify", "to": { "kind": "startedBy" }, "title": "Bonjour" }""";

    private static string StepsDoc(params string[] steps)
        => $$"""{ "version": 1, "steps": [{{string.Join(",", steps)}}] }""";

    [Fact]
    public void Minimal_valid_workflow_parses_with_index_by_key()
    {
        var json = StepsDoc(
            Notify("aa"),
            """{ "key": "bb", "type": "wait", "hours": 2 }""");

        var result = StudioWorkflowStepsSpec.Parse(json);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Version);
        Assert.Equal(2, result.Value.Steps.Count);
        Assert.Equal(1, result.Value.IndexByKey["bb"]);
    }

    [Fact]
    public void Empty_steps_is_rejected()
    {
        Assert.Contains(Validate("""{ "version": 1, "steps": [] }""").Errors, e => e.Path == "steps");
        Assert.Contains(Validate("""{ "version": 1 }""").Errors, e => e.Path == "steps");
    }

    [Fact]
    public void More_than_thirty_steps_is_rejected()
    {
        var steps = Enumerable.Range(0, 31)
            .Select(i => Notify($"s{i}"))
            .ToArray();

        var outcome = Validate(StepsDoc(steps));

        Assert.Contains(outcome.Errors, e => e.Path == "steps" && e.Message.Contains("30"));
    }

    [Fact]
    public void Steps_json_over_64_kb_is_rejected()
    {
        var json = StepsDoc(
            $$"""{ "key": "aa", "type": "notify", "to": { "kind": "startedBy" }, "title": "{{new string('x', 70 * 1024)}}" }""");

        var outcome = Validate(json);

        Assert.Contains(outcome.Errors, e => e.Path == "steps");
    }

    [Fact]
    public void Duplicate_step_key_is_rejected()
    {
        var json = StepsDoc(Notify("aa"), Notify("aa"));

        var outcome = Validate(json);

        Assert.Contains(outcome.Errors, e => e.Path == "steps[1].key");
    }

    [Fact]
    public void Invalid_step_key_shape_is_rejected()
    {
        foreach (var key in new[] { "Abc", "x" })
        {
            var outcome = Validate(StepsDoc(Notify(key)));
            Assert.Contains(outcome.Errors, e => e.Path == "steps[0].key" && e.Message.Contains("Clé"));
        }
    }

    [Fact]
    public void Unknown_step_type_is_rejected()
    {
        var outcome = Validate(StepsDoc("""{ "key": "aa", "type": "magic" }"""));

        Assert.Contains(outcome.Errors, e => e.Path == "steps[0].type");
    }

    [Fact]
    public void Unknown_property_is_rejected_with_the_frozen_message()
    {
        var json = StepsDoc(
            """{ "key": "aa", "type": "notify", "to": { "kind": "startedBy" }, "title": "Bonjour", "foo": 1 }""");

        var outcome = Validate(json);

        Assert.Contains(outcome.Errors, e => e.Message == "Propriété « foo » non reconnue.");
    }

    [Fact]
    public void Condition_requires_one_to_ten_filters_and_known_operator()
    {
        var zero = Validate(StepsDoc("""{ "key": "aa", "type": "condition", "filters": [] }"""));
        Assert.Contains(zero.Errors, e => e.Path == "steps[0].filters");

        var filter = """{ "field": "statut", "op": "eq", "value": "valide" }""";
        var eleven = Validate(StepsDoc(
            $$"""{ "key": "aa", "type": "condition", "filters": [{{string.Join(",", Enumerable.Repeat(filter, 11))}}] }"""));
        Assert.Contains(eleven.Errors, e => e.Path == "steps[0].filters");

        var like = Validate(StepsDoc(
            """{ "key": "aa", "type": "condition", "filters": [ { "field": "statut", "op": "like", "value": "x" } ] }"""));
        Assert.Contains(like.Errors, e => e.Path == "steps[0].filters" && e.Message.Contains("like"));
    }

    [Fact]
    public void Condition_goto_must_target_a_later_step()
    {
        var backward = Validate(StepsDoc(
            Notify("aa"),
            """{ "key": "bb", "type": "condition", "filters": [ { "field": "statut", "op": "eq", "value": "x" } ], "onFalse": "goto", "gotoKey": "aa" }"""));
        Assert.Contains(backward.Errors, e => e.Path == "steps[1].gotoKey");

        var unknown = Validate(StepsDoc(
            Notify("aa"),
            """{ "key": "bb", "type": "condition", "filters": [ { "field": "statut", "op": "eq", "value": "x" } ], "onFalse": "goto", "gotoKey": "fantome" }"""));
        Assert.Contains(unknown.Errors, e => e.Path == "steps[1].gotoKey");

        var forward = Validate(StepsDoc(
            """{ "key": "aa", "type": "condition", "filters": [ { "field": "statut", "op": "eq", "value": "x" } ], "onFalse": "goto", "gotoKey": "bb" }""",
            Notify("bb")));
        Assert.Empty(forward.Errors);
    }

    [Fact]
    public void Condition_field_may_reference_previous_approval_and_results_variables()
    {
        var json = StepsDoc(
            """
            { "key": "aa", "type": "condition", "onFalse": "skip", "filters": [
                { "field": "_previous.montant", "op": "gt", "value": 100 },
                { "field": "_approval.validation_chef.status", "op": "eq", "value": "approved" },
                { "field": "_results.facture.invoice_number", "op": "contains", "value": "F-" }
            ] }
            """,
            Notify("bb"));

        var outcome = Validate(json);

        Assert.Empty(outcome.Errors);

        var textOnly = Validate(StepsDoc(
            """
            { "key": "aa", "type": "condition", "filters": [
                { "field": "_results.facture.total", "op": "gt", "value": 100 }
            ] }
            """));
        Assert.Contains(textOnly.Errors, e => e.Path == "steps[0].filters");
    }

    [Fact]
    public void Update_field_rejects_unknown_and_computed_fields()
    {
        foreach (var key in new[] { "total", "ref", "fantome" })
        {
            var outcome = Validate(StepsDoc(
                $$"""{ "key": "aa", "type": "update_field", "set": { "{{key}}": 1 } }"""));
            Assert.Contains(outcome.Errors, e => e.Path == "steps[0].set" && e.Message.Contains(key));
        }

        var valid = Validate(StepsDoc(
            """{ "key": "aa", "type": "update_field", "set": { "statut": "valide", "montant": 12.5 } }"""));
        Assert.Empty(valid.Errors);
    }

    [Fact]
    public void Erp_action_requires_bridgeable_action_and_required_mappings()
    {
        var notBridgeable = Validate(StepsDoc(
            """{ "key": "aa", "type": "erp_action", "action": "studio_plan_changes" }"""));
        Assert.Contains(notBridgeable.Errors, e => e.Path == "steps[0].action");

        var missingParams = Validate(StepsDoc(
            """{ "key": "aa", "type": "erp_action", "action": "generate_invoice" }"""));
        Assert.Contains(missingParams.Errors, e => e.Path == "steps[0].mapping" && e.Message.Contains("client_id"));

        var covered = Validate(StepsDoc(
            """
            { "key": "aa", "type": "erp_action", "action": "generate_invoice", "saveResultAs": "facture",
              "mapping": [
                { "param": "client_id", "source": "field", "value": "client" },
                { "param": "product_id", "source": "const", "value": "8f7b6d8e-0000-0000-0000-000000000000" },
                { "param": "quantity", "source": "const", "value": 1 }
            ] }
            """));
        Assert.Empty(covered.Errors);
    }

    [Fact]
    public void Erp_action_save_result_as_must_match_the_regex()
    {
        const string mapping = """
            "mapping": [
                { "param": "client_id", "source": "const", "value": "8f7b6d8e-0000-0000-0000-000000000000" },
                { "param": "product_id", "source": "const", "value": "8f7b6d8e-0000-0000-0000-000000000000" },
                { "param": "quantity", "source": "const", "value": 1 }
            ]
            """;

        foreach (var saveAs in new[] { "Résultat", "a" + new string('b', 32) })
        {
            var outcome = Validate(StepsDoc(
                $$"""{ "key": "aa", "type": "erp_action", "action": "generate_invoice", "saveResultAs": "{{saveAs}}", {{mapping}} }"""));
            Assert.Contains(outcome.Errors, e => e.Path == "steps[0].saveResultAs");
        }
    }

    [Fact]
    public void Notify_requires_title_and_relative_link()
    {
        var noTitle = Validate(StepsDoc(
            """{ "key": "aa", "type": "notify", "to": { "kind": "startedBy" } }"""));
        Assert.Contains(noTitle.Errors, e => e.Path == "steps[0].title");

        var absoluteLink = Validate(StepsDoc(
            """{ "key": "aa", "type": "notify", "to": { "kind": "startedBy" }, "title": "Bonjour", "link": "https://x" }"""));
        Assert.Contains(absoluteLink.Errors, e => e.Path == "steps[0].link");

        var relativeLink = Validate(StepsDoc(
            """{ "key": "aa", "type": "notify", "to": { "kind": "startedBy" }, "title": "Bonjour", "link": "/studio/d/commandes" }"""));
        Assert.Empty(relativeLink.Errors);
    }

    [Fact]
    public void Approval_rejects_started_by_assignee_and_out_of_range_due_hours()
    {
        var startedBy = Validate(StepsDoc(
            """{ "key": "aa", "type": "approval", "assignee": { "kind": "startedBy" }, "title": "Valider", "dueInHours": 24 }"""));
        Assert.Contains(startedBy.Errors, e => e.Path == "steps[0].assignee");

        foreach (var hours in new[] { 0, 721 })
        {
            var outcome = Validate(StepsDoc(
                $$"""{ "key": "aa", "type": "approval", "assignee": { "kind": "role", "value": "Administrator" }, "title": "Valider", "dueInHours": {{hours}} }"""));
            Assert.Contains(outcome.Errors, e => e.Path == "steps[0].dueInHours");
        }

        var valid = Validate(StepsDoc(
            """{ "key": "aa", "type": "approval", "assignee": { "kind": "role", "value": "Administrator" }, "title": "Valider", "dueInHours": 24 }"""));
        Assert.Empty(valid.Errors);
    }

    [Fact]
    public void Wait_requires_hours_xor_until()
    {
        var neither = Validate(StepsDoc("""{ "key": "aa", "type": "wait" }"""));
        Assert.Contains(neither.Errors, e => e.Path == "steps[0].hours");

        var both = Validate(StepsDoc("""{ "key": "aa", "type": "wait", "hours": 2, "until": "{{date}}" }"""));
        Assert.Contains(both.Errors, e => e.Path == "steps[0].hours");

        Assert.Empty(Validate(StepsDoc("""{ "key": "aa", "type": "wait", "hours": 2 }""")).Errors);
        Assert.Empty(Validate(StepsDoc("""{ "key": "aa", "type": "wait", "until": "{{date_livraison}}" }""")).Errors);
    }

    [Fact]
    public void Create_record_requires_active_standard_entity_and_settable_fields()
    {
        var unknown = Validate(StepsDoc(
            """{ "key": "aa", "type": "create_record", "entity": "fantome", "set": { "titre": "x" } }"""));
        Assert.Contains(unknown.Errors, e => e.Path == "steps[0].entity");

        var junction = Validate(StepsDoc(
            """{ "key": "aa", "type": "create_record", "entity": "commandes_lignes", "set": { "titre": "x" } }"""));
        Assert.Contains(junction.Errors, e => e.Path == "steps[0].entity" && e.Message.Contains("jonction"));

        var unknownField = Validate(StepsDoc(
            """{ "key": "aa", "type": "create_record", "entity": "taches", "set": { "titre": "x", "total": 1 } }"""));
        Assert.Contains(unknownField.Errors, e => e.Path == "steps[0].set" && e.Message.Contains("total"));

        var valid = Validate(StepsDoc(
            """{ "key": "aa", "type": "create_record", "entity": "taches", "set": { "titre": "Suivi {{ref}}", "fait": false }, "saveResultAs": "tache" }"""));
        Assert.Empty(valid.Errors);
    }

    [Fact]
    public void Trigger_config_must_be_empty_for_on_create_on_update_and_manual()
    {
        foreach (var trigger in new[]
        {
            StudioWorkflowTriggerKind.OnCreate,
            StudioWorkflowTriggerKind.OnUpdate,
            StudioWorkflowTriggerKind.Manual
        })
        {
            var outcome = Validate(StepsDoc(Notify("aa")), trigger, """{ "field": "x" }""");
            Assert.Contains(outcome.Errors, e => e.Path == "triggerConfig");
        }
    }

    [Fact]
    public void Field_changed_requires_an_active_non_computed_field()
    {
        var computed = Validate(StepsDoc(Notify("aa")),
            StudioWorkflowTriggerKind.FieldChanged, """{ "field": "total" }""");
        Assert.Contains(computed.Errors, e => e.Path == "triggerConfig.field");

        var missing = Validate(StepsDoc(Notify("aa")),
            StudioWorkflowTriggerKind.FieldChanged, "{}");
        Assert.Contains(missing.Errors, e => e.Path == "triggerConfig.field");

        var valid = Validate(StepsDoc(Notify("aa")),
            StudioWorkflowTriggerKind.FieldChanged, """{ "field": "statut", "to": "valide" }""");
        Assert.Empty(valid.Errors);
    }

    // ---- Déclencheur planifié (4.7b1 / D-47-B02, D5 levé) ----

    [Fact]
    public void Scheduled_trigger_requires_a_valid_cron()
    {
        // cron absent ⇒ « triggerConfig.cron ».
        var missing = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled);
        var only = Assert.Single(missing.Errors);
        Assert.Equal("triggerConfig.cron", only.Path);

        // cron invalides : 4 ou 6 champs, texte libre, hors bornes, pas nul, plage inversée.
        foreach (var bad in new[] { "0 6 * *", "* * * * * *", "chaque jour", "61 * * * *", "* 25 * * *", "0 6 32 * *", "0 6 * 13 *", "0 6 * * 8", "*/0 * * * *", "5-1 * * * *" })
        {
            var outcome = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
                $$"""{ "cron": "{{bad}}" }""");
            Assert.Contains(outcome.Errors, e => e.Path == "triggerConfig.cron");
        }
    }

    [Fact]
    public void Scheduled_trigger_accepts_valid_cron_expressions()
    {
        foreach (var cron in new[] { "*/10 * * * *", "0 6 * * 1", "30 6 1 * *", "0 0 1 JAN *", "0 18 * * MON-FRI", "0 6 * * 0" })
        {
            var outcome = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
                $$"""{ "cron": "{{cron}}" }""");
            Assert.Empty(outcome.Errors);
        }
    }

    [Fact]
    public void Scheduled_trigger_rejects_unknown_properties_and_bad_filters()
    {
        // Propriété non reconnue (le fuseau est fixé à UTC — pas de « timezone »).
        var unknown = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            """{ "cron": "0 6 * * *", "timezone": "Europe/Paris" }""");
        Assert.Contains(unknown.Errors, e => e.Path == "triggerConfig" && e.Message.Contains("timezone"));

        // « filters » n'est pas un tableau.
        var notArray = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            """{ "cron": "0 6 * * *", "filters": {} }""");
        Assert.Contains(notArray.Errors, e => e.Path == "triggerConfig.filters");

        // 11 filtres ⇒ borne dépassée.
        var eleven = string.Join(",", Enumerable.Range(0, 11).Select(k => $$"""{ "field": "statut", "op": "eq", "value": {{k}} }"""));
        var tooMany = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            $$"""{ "cron": "0 6 * * *", "filters": [{{eleven}}] }""");
        Assert.Contains(tooMany.Errors, e => e.Path == "triggerConfig.filters" && e.Message.Contains("10"));

        // Opérateur inconnu.
        var badOp = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            """{ "cron": "0 6 * * *", "filters": [ { "field": "statut", "op": "almost", "value": "x" } ] }""");
        Assert.Contains(badOp.Errors, e => e.Path == "triggerConfig.filters" && e.Message.Contains("Opérateur inconnu"));

        // Champ inconnu.
        var unknownField = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            """{ "cron": "0 6 * * *", "filters": [ { "field": "fantome", "op": "eq", "value": "x" } ] }""");
        Assert.Contains(unknownField.Errors, e => e.Path == "triggerConfig.filters" && e.Message.Contains("fantome"));

        // Champ calculé non filtrable.
        var computed = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            """{ "cron": "0 6 * * *", "filters": [ { "field": "total", "op": "gt", "value": 3 } ] }""");
        Assert.Contains(computed.Errors, e => e.Path == "triggerConfig.filters" && e.Message.Contains("calculé"));

        // Variable « _previous » interdite : le balayage planifié n'a ni valeur précédente ni résultats d'étapes.
        var previous = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            """{ "cron": "0 6 * * *", "filters": [ { "field": "_previous.statut", "op": "eq", "value": "x" } ] }""");
        Assert.Contains(previous.Errors, e => e.Path == "triggerConfig.filters");
    }

    [Fact]
    public void Scheduled_trigger_accepts_valid_filters()
    {
        var outcome = Validate(StepsDoc(Notify("aa")), StudioWorkflowTriggerKind.Scheduled,
            """{ "cron": "0 6 * * 1", "filters": [ { "field": "statut", "op": "eq", "value": "en_attente" }, { "field": "montant", "op": "gte", "value": 100 } ] }""");
        Assert.Empty(outcome.Errors);
    }

    [Fact]
    public void Lint_warns_on_unreachable_steps_after_stop()
    {
        var json = StepsDoc(
            """{ "key": "aa", "type": "condition", "filters": [ { "field": "statut", "op": "eq", "value": "valide" } ], "onFalse": "stop" }""",
            Notify("bb"),
            Notify("cc"));

        var spec = StudioWorkflowStepsSpec.Parse(json).Value;
        var warnings = StudioWorkflowStepsSpec.Lint(spec);

        var warning = Assert.Single(warnings);
        Assert.Equal("steps[1]", warning.Path);
    }

    [Fact]
    public void Catalog_lists_seven_types_in_frozen_order()
    {
        Assert.Equal(
            new[] { "condition", "update_field", "erp_action", "notify", "approval", "wait", "create_record" },
            StudioWorkflowStepTypes.All);

        var catalog = StudioWorkflowStepTypes.Catalog();
        Assert.Equal(StudioWorkflowStepTypes.All, catalog.Select(c => c.Type).ToArray());
        Assert.All(catalog, entry =>
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.Label));
            Assert.False(string.IsNullOrWhiteSpace(entry.Description));
            Assert.NotEmpty(entry.Properties);
        });
    }
}
