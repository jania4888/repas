using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Diff « avant → après » présenté à l'utilisateur avant qu'une modification ne s'applique. Le point
/// critique : une opération dont la cible n'existe pas doit DISPARAÎTRE de l'aperçu (avec un
/// avertissement) plutôt que d'être annoncée puis échouer silencieusement à l'exécution.
/// </summary>
public sealed class StudioAiAmendmentPlannerTests
{
    private static CustomEntitySchemaDto Schema() => new(
        new CustomEntityDto(Guid.NewGuid(), "contrats", "Contrat", "Contrats", null, null, true, 3, null,
            DateTime.UtcNow, DateTime.UtcNow),
        new[]
        {
            Field("nom", "Nom", CustomFieldType.Text),
            Field("statut", "Statut", CustomFieldType.Select, options: new[] { new SelectOptionDto("actif", "Actif") }),
            Field("montant", "Montant", CustomFieldType.Money, required: true)
        },
        new FormLayout
        {
            Sections = new[] { new FormSection { Fields = new[] { new FormFieldRef { Key = "nom", Width = "full" } } } }
        });

    private static CustomFieldDto Field(
        string key, string label, CustomFieldType type, bool required = false,
        IReadOnlyList<SelectOptionDto>? options = null) =>
        new(Guid.NewGuid(), key, label, type, required, false, 0, null, options, null, true);

    private static ParsedAmendmentSpec Parse(string json)
    {
        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var error), error);
        return spec!;
    }

    [Fact]
    public void Add_field_preview_describes_the_new_field()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_field", "label": "Motif de refus", "type": "multilinetext", "required": true } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("add_field", item.Op);
        Assert.Equal("Motif de refus", item.Target);
        Assert.Null(item.Before);
        Assert.Contains("texte long", item.After);
        Assert.Contains("obligatoire", item.After);
    }

    [Fact]
    public void Remove_field_warns_that_data_is_preserved()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "remove_field", "key": "statut" } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("warning", item.Severity);
        Assert.Contains("CONSERVÉES", item.Warning);
        Assert.Equal("Statut", item.Target);
    }

    [Fact]
    public void Operation_on_an_unknown_field_is_dropped_with_a_warning()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "remove_field", "key": "champ_fantome" },
          { "op": "update_field", "key": "autre_fantome", "required": true } ] }
        """), Schema());

        Assert.Empty(preview.Items);
        Assert.Equal(2, preview.Warnings.Count);
        Assert.All(preview.Warnings, w => Assert.Contains("introuvable", w));
    }

    [Fact]
    public void Field_reference_resolves_by_label_as_well_as_key()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "update_field", "label": "Montant" } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("Montant", item.Target);
        Assert.Contains("montant", item.Before);      // type « montant » conservé
        Assert.Contains("obligatoire", item.Before);  // état actuel reflété
    }

    [Fact]
    public void Set_form_preview_flags_the_layout_replacement()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_form", "sections": [ { "title": "Identité", "fields": [ "nom", { "field": "montant", "width": "half" } ] } ] } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("warning", item.Severity);
        Assert.Contains("Identité (2)", item.After);
        Assert.Contains("remplacée", item.Warning);
    }

    [Fact]
    public void Resolved_form_keeps_widths_and_drops_unknown_fields()
    {
        var spec = Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_form", "sections": [ { "fields": [
            "Nom",
            { "field": "montant", "width": "half", "label": "Montant TTC" },
            { "field": "inexistant", "width": "half" } ] } ] } ] }
        """);
        var op = Assert.IsType<SetFormOp>(Assert.Single(spec.Operations));

        var layout = StudioAiAmendmentPlanner.ResolveForm(op.FormNode, Schema().Fields);

        Assert.NotNull(layout);
        var fields = layout!.Sections[0].Fields;
        Assert.Equal(2, fields.Count);                     // champ inconnu écarté
        Assert.Equal("nom", fields[0].Key);                // résolu par libellé
        Assert.Equal("full", fields[0].Width);
        Assert.Equal("half", fields[1].Width);
        Assert.Equal("Montant TTC", fields[1].LabelOverride);
    }

    [Fact]
    public void Resolved_report_maps_labels_to_real_field_keys()
    {
        var spec = Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_report", "displayName": "Par statut", "definition": {
            "groupBy": ["Statut"], "measures": [ { "field": "Montant", "fn": "sum" } ],
            "filters": [ { "field": "Statut", "op": "eq", "value": "actif" } ],
            "sort": [ { "field": "Montant", "dir": "desc" } ] } } ] }
        """);
        var op = Assert.IsType<SetReportOp>(Assert.Single(spec.Operations));

        var def = StudioAiAmendmentPlanner.ResolveReport(op.ReportNode, Schema().Fields);

        Assert.NotNull(def);
        Assert.Equal(new[] { "statut" }, def!.Grouping);
        Assert.Equal("montant", def.Aggregations[0].Field);
        Assert.Equal("statut", def.Filters[0].Field);
        Assert.Equal("montant", def.Sort[0].Field);
        Assert.Equal("desc", def.Sort[0].Dir);
    }

    [Fact]
    public void Summary_json_carries_the_steps_and_the_destructive_warnings()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_field", "label": "Motif de refus", "type": "text" },
          { "op": "remove_field", "key": "statut" } ] }
        """), Schema());

        var json = StudioAiAmendmentPlanner.ToSummaryJson(preview);

        Assert.Contains("Amendment", json);
        Assert.Contains("Modification de", json);
        Assert.Contains("Ajouter", json);
        Assert.Contains("Retirer", json);
        Assert.Contains("CONSERV", json);
    }

    // ---- PR 3.1b : opérations d'amendement enrichies ----

    private static CustomEntitySchemaDto SchemaWithDate() => new(
        new CustomEntityDto(Guid.NewGuid(), "interventions", "Intervention", "Interventions", null, null, true, 3, null,
            DateTime.UtcNow, DateTime.UtcNow),
        new[]
        {
            Field("titre", "Titre", CustomFieldType.Text),
            Field("statut", "Statut", CustomFieldType.Select, options: new[] { new SelectOptionDto("planifiee", "Planifiée") }),
            Field("date_debut", "Date de début", CustomFieldType.Date)
        },
        new FormLayout());

    [Fact]
    public void Reorder_fields_promises_the_effective_order_cited_fields_first()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "reorder_fields", "fields": [ "montant", "Nom", "champ_fantome" ] } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("reorder_fields", item.Op);
        Assert.Equal("Nom, Statut, Montant", item.Before);
        // « montant » cité en premier, « Nom » résolu depuis son libellé, « statut » conservé à la suite.
        Assert.Equal("Montant, Nom, Statut", item.After);
        Assert.Equal("info", item.Severity);
        Assert.Single(preview.Warnings);
        Assert.Contains("champ_fantome", preview.Warnings[0]);
    }

    [Fact]
    public void Reorder_fields_without_any_known_field_is_dropped_with_a_warning()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "reorder_fields", "fields": [ "fantome1", "fantome2" ] } ] }
        """), Schema());

        Assert.Empty(preview.Items);
        Assert.Equal(3, preview.Warnings.Count); // 2 refs inconnues + « aucun champ reconnu »
        Assert.Contains(preview.Warnings, w => w.Contains("aucun champ reconnu"));
    }

    [Fact]
    public void Change_field_type_lossless_is_an_info_step()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "change_field_type", "key": "montant", "type": "decimal" } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("info", item.Severity);
        Assert.Equal("montant", item.Before);
        Assert.Equal("décimal", item.After);
        Assert.Contains("sans perte", item.Warning);
    }

    [Fact]
    public void Change_field_type_requiring_an_empty_table_warns_without_a_fabricated_count()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "change_field_type", "key": "montant", "type": "number" } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("warning", item.Severity);
        Assert.Contains("table vide", item.Warning);
        // Le planificateur est pur : aucun nombre d'enregistrements n'est inventé.
        Assert.DoesNotContain("enregistrement(s))", item.Warning);
    }

    [Fact]
    public void Change_field_type_forbidden_is_an_error_step()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "change_field_type", "key": "nom", "type": "formula" } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("error", item.Severity);
        Assert.Contains("nouveau champ", item.Warning);
    }

    [Fact]
    public void Change_field_type_to_the_same_type_is_an_error_step()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "change_field_type", "key": "nom", "type": "text" } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("error", item.Severity);
        Assert.Contains("déjà de ce type", item.Warning);
    }

    [Fact]
    public void Add_relation_many_to_one_is_an_info_step()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_one", "target": "clients", "label": "Client" } ] }
        """), Schema(), manyToManyEnabled: false);

        var item = Assert.Single(preview.Items);
        Assert.Equal("Client", item.Target);
        Assert.Equal("info", item.Severity);
        Assert.Contains("plusieurs-à-un", item.After);
        Assert.Contains("clients", item.After);
    }

    [Fact]
    public void Add_relation_many_to_many_is_dropped_with_a_warning_when_the_flag_is_off()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_many", "target": "competences" } ] }
        """), Schema(), manyToManyEnabled: false);

        Assert.Empty(preview.Items);
        Assert.Single(preview.Warnings);
        Assert.Contains("plusieurs-à-plusieurs ne sont pas activées", preview.Warnings[0]);
    }

    [Fact]
    public void Add_relation_many_to_many_to_the_table_itself_is_an_error_step()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "n_n", "target": "Contrats" } ] }
        """), Schema(), manyToManyEnabled: true);

        var item = Assert.Single(preview.Items);
        Assert.Equal("error", item.Severity);
        Assert.Contains("différente de la table source", item.Warning);
    }

    [Fact]
    public void Add_relation_many_to_many_from_a_junction_table_is_an_error_step()
    {
        var junctionSchema = new CustomEntitySchemaDto(
            new CustomEntityDto(Guid.NewGuid(), "employes_projets", "Employé – Projet", "Employés – Projets", null, null,
                true, 2, null, DateTime.UtcNow, DateTime.UtcNow, CustomEntityKind.Junction),
            new[] { Field("employes", "Employés", CustomFieldType.RelationCustom) },
            new FormLayout());

        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "employes_projets" }, "operations": [
          { "op": "add_relation", "kind": "many_to_many", "target": "competences" } ] }
        """), junctionSchema, manyToManyEnabled: true);

        var item = Assert.Single(preview.Items);
        Assert.Equal("error", item.Severity);
        Assert.Contains("table standard active", item.Warning);
    }

    [Fact]
    public void Assign_system_describes_attach_and_detach()
    {
        var attach = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "assign_system", "system": "rh" } ] }
        """), Schema());
        Assert.Contains("rattachée au système « rh »", Assert.Single(attach.Items).After);

        var detach = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "assign_system", "system": "none" } ] }
        """), Schema());
        Assert.Contains("détachée", Assert.Single(detach.Items).After);
    }

    [Fact]
    public void Set_view_kanban_is_resolved_against_the_real_schema()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "interventions" }, "operations": [
          { "op": "set_view", "mode": "kanban", "displayName": "Par statut", "groupBy": "Statut",
            "columns": [ "titre", "champ_fantome" ] } ] }
        """), SchemaWithDate(), recordViewsEnabled: true);

        var item = Assert.Single(preview.Items);
        Assert.Equal("set_view", item.Op);
        Assert.Equal("Par statut", item.Target);
        Assert.Contains("Kanban", item.After);
        Assert.Contains("regroupée par « statut »", item.After);
        Assert.Single(preview.Warnings); // colonne inconnue écartée
        Assert.Contains("champ_fantome", preview.Warnings[0]);
    }

    [Fact]
    public void Set_view_kanban_without_a_select_field_degrades_to_list_with_a_warning()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "interventions" }, "operations": [
          { "op": "set_view", "mode": "kanban", "displayName": "Par date", "groupBy": "date_debut" } ] }
        """), SchemaWithDate(), recordViewsEnabled: true);

        var item = Assert.Single(preview.Items);
        Assert.Contains("Liste", item.After); // dégradé : « date_debut » n'est pas une liste de choix
        Assert.Contains(preview.Warnings, w => w.Contains("Kanban impossible"));
    }

    [Fact]
    public void Set_view_calendar_without_a_date_field_degrades_to_list_with_a_warning()
    {
        var schemaSansDate = new CustomEntitySchemaDto(
            new CustomEntityDto(Guid.NewGuid(), "taches", "Tâche", "Tâches", null, null, true, 1, null,
                DateTime.UtcNow, DateTime.UtcNow),
            new[] { Field("titre", "Titre", CustomFieldType.Text) },
            new FormLayout());

        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "taches" }, "operations": [
          { "op": "set_view", "mode": "calendar", "displayName": "Planning", "start": "titre" } ] }
        """), schemaSansDate, recordViewsEnabled: true);

        var item = Assert.Single(preview.Items);
        Assert.Contains("Liste", item.After);
        Assert.Contains(preview.Warnings, w => w.Contains("Calendrier impossible"));
    }

    [Fact]
    public void Set_view_is_dropped_with_a_warning_when_record_views_are_off()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "interventions" }, "operations": [
          { "op": "set_view", "mode": "list", "displayName": "Toutes" } ] }
        """), SchemaWithDate(), recordViewsEnabled: false);

        Assert.Empty(preview.Items);
        Assert.Single(preview.Warnings);
        Assert.Contains("vues enregistrées ne sont pas activées", preview.Warnings[0]);
    }

    [Fact]
    public void Set_automation_is_an_info_step_with_an_explicit_warning()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_automation", "trigger": "on_create", "action": "notify" } ] }
        """), Schema());

        var item = Assert.Single(preview.Items);
        Assert.Equal("set_automation", item.Op);
        Assert.Equal("info", item.Severity);
        Assert.Contains("étape ignorée", item.Warning);
    }

    [Fact]
    public void Summary_json_uses_the_french_labels_of_the_new_operations()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "reorder_fields", "fields": [ "montant" ] },
          { "op": "change_field_type", "key": "montant", "type": "decimal" },
          { "op": "add_relation", "kind": "many_to_one", "target": "clients" },
          { "op": "assign_system", "system": "rh" },
          { "op": "set_view", "mode": "list", "displayName": "Toutes" },
          { "op": "set_automation", "trigger": "on_create" } ] }
        """), Schema(), manyToManyEnabled: true, recordViewsEnabled: true);

        // Le JSON sérialisé échappe les accents (JsonSerializerDefaults.Web) : on relit les libellés.
        var json = StudioAiAmendmentPlanner.ToSummaryJson(preview);
        var labels = System.Text.Json.Nodes.JsonNode.Parse(json)!["steps"]!.AsArray()
            .Select(s => s!["label"]!.GetValue<string>()).ToList();

        Assert.Equal(6, labels.Count);
        Assert.Contains("Réordonner les champs", labels);
        Assert.Contains("Changer le type de « Montant »", labels);
        Assert.Contains("Relier à « clients »", labels);
        Assert.Contains("Rattacher au système « rh »", labels);
        Assert.Contains("Vue « Toutes »", labels);
        Assert.Contains("Automatisation (non appliquée)", labels);
    }

    [Fact]
    public void Summary_json_labels_the_detach_step()
    {
        var preview = StudioAiAmendmentPlanner.BuildPreview(Parse("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "assign_system", "system": "aucun" } ] }
        """), Schema());

        var json = StudioAiAmendmentPlanner.ToSummaryJson(preview);
        var label = System.Text.Json.Nodes.JsonNode.Parse(json)!["steps"]!.AsArray()[0]!["label"]!
            .GetValue<string>();

        Assert.Equal("Détacher la table de son système", label);
    }
}
