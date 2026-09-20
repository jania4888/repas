using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Parsing des demandes de MODIFICATION. Même exigence que les autres specs Studio : tolérant aux
/// approximations du petit modèle, mais strict sur la liste blanche d'opérations (ni suppression de
/// table, ni suppression de système).
/// </summary>
public sealed class StudioAiAmendmentSpecTests
{
    [Fact]
    public void Parses_the_axelor_style_add_field_request()
    {
        const string json = """
        { "target": { "entityKey": "contrats" },
          "operations": [ { "op": "add_field", "label": "Motif de refus", "type": "multilinetext" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal("contrats", spec!.TargetEntityRef);
        var add = Assert.IsType<AddFieldOp>(Assert.Single(spec.Operations));
        Assert.Equal("Motif de refus", add.Field.Label);
        Assert.Equal("motif_de_refus", add.Field.Key);
        Assert.Equal(CustomFieldType.MultilineText, add.Field.FieldType);
    }

    [Fact]
    public void Parses_every_whitelisted_operation()
    {
        const string json = """
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_field", "label": "Note", "type": "rating", "max": 4 },
          { "op": "update_field", "key": "statut", "required": true, "addOptions": ["resilie"] },
          { "op": "remove_field", "key": "obsolete" },
          { "op": "update_entity", "displayName": "Contrats clients" },
          { "op": "set_form", "sections": [ { "title": "Général", "fields": ["statut"] } ] },
          { "op": "set_report", "displayName": "Par statut", "definition": { "groupBy": ["statut"] } }
        ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(6, spec!.Operations.Count);
        Assert.IsType<AddFieldOp>(spec.Operations[0]);
        var upd = Assert.IsType<UpdateFieldOp>(spec.Operations[1]);
        Assert.True(upd.Required);
        Assert.Single(upd.AddOptions!);
        Assert.IsType<RemoveFieldOp>(spec.Operations[2]);
        Assert.Equal("Contrats clients", Assert.IsType<UpdateEntityOp>(spec.Operations[3]).DisplayName);
        Assert.IsType<SetFormOp>(spec.Operations[4]);
        Assert.Equal("Par statut", Assert.IsType<SetReportOp>(spec.Operations[5]).DisplayName);
    }

    [Fact]
    public void Unknown_operations_are_dropped_with_a_warning_not_a_failure()
    {
        const string json = """
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "drop_table" },
          { "op": "delete_system" },
          { "op": "add_field", "label": "Note", "type": "text" }
        ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Single(spec!.Operations);
        Assert.Equal(2, spec.Warnings.Count);
        Assert.All(spec.Warnings, w => Assert.Contains("non prise en charge", w));
    }

    [Fact]
    public void Operations_are_capped()
    {
        var ops = string.Join(",", Enumerable.Range(0, StudioAiAmendmentSpec.MaxOperations + 5)
            .Select(i => $$"""{ "op": "add_field", "label": "Champ {{i}}", "type": "text" }"""));
        var json = $$"""{ "target": { "entityKey": "t" }, "operations": [ {{ops}} ] }""";

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(StudioAiAmendmentSpec.MaxOperations, spec!.Operations.Count);
        Assert.Contains(spec.Warnings, w => w.Contains("ignorées"));
    }

    [Fact]
    public void Field_reference_accepts_key_or_label()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "remove_field", "label": "Date de début" },
          { "op": "update_field", "field": "montant", "label": "Montant TTC" }
        ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal("Date de début", Assert.IsType<RemoveFieldOp>(spec!.Operations[0]).FieldRef);
        Assert.Equal("montant", Assert.IsType<UpdateFieldOp>(spec.Operations[1]).FieldRef);
    }

    [Fact]
    public void Report_definition_posed_inline_is_tolerated()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "set_report", "displayName": "Synthèse", "groupBy": ["statut"], "measures": [ { "field": "montant", "fn": "sum" } ] }
        ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        var report = Assert.IsType<SetReportOp>(Assert.Single(spec!.Operations));
        Assert.Equal("Synthèse", report.DisplayName);
        Assert.NotNull(report.ReportNode["groupBy"]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{ \"operations\": [ { \"op\": \"add_field\", \"label\": \"X\" } ] }")]
    [InlineData("{ \"target\": { \"entityKey\": \"t\" }, \"operations\": [] }")]
    [InlineData("{ \"target\": { \"entityKey\": \"t\" }, \"operations\": [ { \"op\": \"drop_table\" } ] }")]
    public void Invalid_specs_fail(string json)
    {
        Assert.False(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error));
        Assert.Null(spec);
        Assert.NotNull(error);
    }

    // ---- PR 3.1b : opérations d'amendement enrichies ----

    [Fact]
    public void Parses_every_pr31b_operation_with_aliases()
    {
        const string json = """
        { "target": { "entityKey": "interventions" }, "operations": [
          { "op": "reorder_fields", "fields": ["reference", "client", "statut"] },
          { "op": "change_field_type", "key": "duree_estimee", "type": "decimal" },
          { "op": "add_relation", "kind": "many_to_many", "target": "Compétences", "label": "Compétences requises" },
          { "op": "assign_system", "system": "Gestion Interventions" },
          { "op": "set_view", "mode": "kanban", "displayName": "Kanban par statut", "groupBy": "statut" },
          { "op": "set_automation", "trigger": "on_create", "action": "notify" }
        ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(6, spec!.Operations.Count);

        var reorder = Assert.IsType<ReorderFieldsOp>(spec.Operations[0]);
        Assert.Equal(new[] { "reference", "client", "statut" }, reorder.FieldRefs);

        var changeType = Assert.IsType<ChangeFieldTypeOp>(spec.Operations[1]);
        Assert.Equal("duree_estimee", changeType.FieldRef);
        Assert.Equal(CustomFieldType.Decimal, changeType.FieldType);

        var relation = Assert.IsType<AddRelationOp>(spec.Operations[2]);
        Assert.Equal("many_to_many", relation.Kind);
        Assert.Equal("competences", relation.TargetRef); // clé normalisée (slug), pas le libellé brut
        Assert.Equal("Compétences requises", relation.Label);

        var assign = Assert.IsType<AssignSystemOp>(spec.Operations[3]);
        Assert.Equal("gestion_interventions", assign.SystemRef);

        var view = Assert.IsType<SetViewOp>(spec.Operations[4]);
        Assert.Equal("kanban", view.View.Mode);
        Assert.Equal("Kanban par statut", view.View.DisplayName);
        Assert.Equal("statut", view.View.GroupByFieldKey);
        Assert.Null(view.View.EntityKey); // la vue porte toujours sur la table cible du plan

        var automation = Assert.IsType<SetAutomationOp>(spec.Operations[5]);
        Assert.Equal("on_create", automation.Node["trigger"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("reorder")]
    [InlineData("reordonner_champs")]
    public void Reorder_fields_accepts_fr_en_aliases(string alias)
    {
        var json = $$"""{ "target": { "entityKey": "t" }, "operations": [ { "op": "{{alias}}", "fields": ["a", "b"] } ] }""";

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        var reorder = Assert.IsType<ReorderFieldsOp>(Assert.Single(spec!.Operations));
        Assert.Equal("reorder_fields", reorder.Op);
        Assert.Equal(2, reorder.FieldRefs.Count);
    }

    [Fact]
    public void Reorder_fields_deduplicates_and_trims_references()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "reorder_fields", "fields": [ "statut", " Statut ", "montant", "statut" ] } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        var reorder = Assert.IsType<ReorderFieldsOp>(Assert.Single(spec!.Operations));
        Assert.Equal(new[] { "statut", "montant" }, reorder.FieldRefs);
    }

    [Fact]
    public void Reorder_fields_without_reference_is_dropped_with_a_warning()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "reorder_fields", "fields": [] },
          { "op": "remove_field", "key": "obsolete" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Single(spec!.Operations);
        Assert.Contains(spec.Warnings, w => w.Contains("aucune référence", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("change_type")]
    [InlineData("changer_type")]
    public void Change_field_type_accepts_fr_en_aliases(string alias)
    {
        var json = $$"""
            { "target": { "entityKey": "t" }, "operations": [
              { "op": "{{alias}}", "field": "duree", "type": "nombre", "options": ["a"], "config": { "max": 5 } } ] }
            """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        var changeType = Assert.IsType<ChangeFieldTypeOp>(Assert.Single(spec!.Operations));
        Assert.Equal(CustomFieldType.Number, changeType.FieldType);
        Assert.Single(changeType.Options!);
        Assert.Equal("5", changeType.Config!["max"]!.ToString());
    }

    [Fact]
    public void Change_field_type_with_an_unknown_type_is_dropped_with_a_warning()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "change_field_type", "key": "duree", "type": "wizard" },
          { "op": "remove_field", "key": "obsolete" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Single(spec!.Operations);
        Assert.Contains(spec.Warnings, w => w.Contains("wizard"));
    }

    [Fact]
    public void Change_field_type_never_accepts_a_numeric_enum_value()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "change_field_type", "key": "duree", "type": "3" },
          { "op": "remove_field", "key": "obsolete" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Single(spec!.Operations);
        Assert.Contains(spec.Warnings, w => w.Contains("inconnu"));
    }

    [Fact]
    public void Change_field_type_accepts_a_forbidden_target_so_the_preview_can_classify_it()
    {
        // La matrice D4 classe Formula en Forbidden À L'APERÇU : la spec ne doit pas le faire
        // disparaître au parsing (sinon l'utilisateur ne verrait jamais le refus).
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "change_field_type", "key": "total", "type": "formula" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(CustomFieldType.Formula, Assert.IsType<ChangeFieldTypeOp>(Assert.Single(spec!.Operations)).FieldType);
    }

    [Fact]
    public void Add_relation_defaults_to_many_to_one_and_normalizes_kinds()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "add_relation", "target": "clients" },
          { "op": "ajouter_relation", "kind": "N-N", "table": "Compétences", "junctionName": "Affectations" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        var one = Assert.IsType<AddRelationOp>(spec!.Operations[0]);
        Assert.Equal("many_to_one", one.Kind);
        var many = Assert.IsType<AddRelationOp>(spec.Operations[1]);
        Assert.Equal("many_to_many", many.Kind);
        Assert.Equal("competences", many.TargetRef);
        // Clé de jonction normalisée en slug au parsing, comme la cible (alignement aperçu/exécution).
        Assert.Equal("affectations", many.JunctionName);
    }

    [Fact]
    public void Add_relation_with_an_unknown_kind_is_dropped_with_a_warning()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "add_relation", "kind": "one_to_one", "target": "clients" },
          { "op": "remove_field", "key": "obsolete" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Single(spec!.Operations);
        Assert.Contains(spec.Warnings, w => w.Contains("one_to_one"));
    }

    [Fact]
    public void Assign_system_detaches_on_none_and_rejects_a_missing_key()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "assign_system", "system": "aucun" },
          { "op": "assign_system" },
          { "op": "rattacher_systeme", "systemKey": "Back-Office" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(2, spec!.Operations.Count); // la clé absente est un oubli : op ignorée + avertissement
        Assert.Null(Assert.IsType<AssignSystemOp>(spec.Operations[0]).SystemRef);
        Assert.Equal("back_office", Assert.IsType<AssignSystemOp>(spec.Operations[1]).SystemRef);
        Assert.Contains(spec.Warnings, w => w.Contains("système non précisé"));
    }

    [Fact]
    public void Set_view_without_a_name_is_dropped_with_a_warning()
    {
        const string json = """
        { "target": { "entityKey": "t" }, "operations": [
          { "op": "set_view", "mode": "kanban", "groupBy": "statut" },
          { "op": "remove_field", "key": "obsolete" } ] }
        """;

        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        Assert.Single(spec!.Operations);
        Assert.Contains(spec.Warnings, w => w.Contains("Vue enregistrée ignorée"));
    }

    [Fact]
    public void Max_operations_stays_twenty()
    {
        Assert.Equal(20, StudioAiAmendmentSpec.MaxOperations);
    }
}
