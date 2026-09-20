using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioAiSystemSpecTests
{
    [Fact]
    public void Parses_multi_entity_system_with_relations_and_seed()
    {
        const string json = """
        {
          "system": { "displayName": "Gestion des conges", "onboarding": ["Ajoutez des employes", "Configurez les types"] },
          "entities": [
            { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom", "type": "text" } ] },
            { "ref": "types_conges", "displayName": "Types de conges", "fields": [ { "label": "Libelle", "type": "text" } ] },
            { "ref": "demandes", "displayName": "Demandes", "fields": [
              { "label": "Employe", "type": "relation", "relationTo": "employes" },
              { "label": "Type", "type": "relation", "relationTo": "types_conges" },
              { "label": "Statut", "type": "select", "options": [ {"value":"en_attente","label":"En attente"} ] }
            ] }
          ],
          "seed": [ { "entityRef": "types_conges", "records": [ { "libelle": "CP" }, { "libelle": "RTT" } ] } ]
        }
        """;

        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.NotNull(spec);
        Assert.Equal(3, spec!.Entities.Count);
        Assert.Equal(2, spec.Seed.Count > 0 ? spec.Seed[0].Records.Count : 0);
        var demandes = spec.Entities.First(e => e.Ref == "demandes");
        Assert.Equal(CustomFieldType.RelationCustom, demandes.Fields[0].FieldType);
        Assert.Equal("employes", demandes.Fields[0].RelationToRef);
    }

    [Fact]
    public void Unknown_relation_target_degrades_to_text_instead_of_failing()
    {
        // "connecté à l'ERP": the model points a relation at a non-spec/ERP table. The whole system must
        // still be created — the dangling relation degrades to a plain text field (never a hard failure).
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "a", "displayName": "A", "fields": [
            { "label": "Nom", "type": "text" },
            { "label": "Employe", "type": "relation", "relationTo": "employees" }
          ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var rel = spec!.Entities[0].Fields.First(f => f.Label == "Employe");
        Assert.Equal(CustomFieldType.Text, rel.FieldType);
        Assert.Null(rel.RelationToRef);
    }

    [Theory]
    [InlineData("clients", "clients")]
    [InlineData("Clients", "clients")]
    [InlineData("products", "products")]
    [InlineData("Produits", "products")]
    public void Relation_to_known_erp_source_becomes_existing(string relationTo, string expectedRef)
    {
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "commandes", "displayName": "Commandes", "fields": [
            { "label": "Client", "type": "relation", "relationTo": "{{relationTo}}" }
          ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var rel = spec!.Entities[0].Fields[0];
        Assert.Equal(CustomFieldType.RelationExisting, rel.FieldType);
        Assert.Equal(expectedRef, rel.RelationToRef);
    }

    [Fact]
    public void Select_with_options_and_stray_relationTo_stays_select()
    {
        // The small model often pastes a spurious relationTo onto a select that already has options.
        // The field must remain a Select (options kept), NOT become a broken relation.
        const string json = """
        { "system": { "displayName": "Conges" }, "entities": [
          { "ref": "demandes", "displayName": "Demandes", "fields": [
            { "label": "Nom", "type": "text" },
            { "label": "Type de conge", "type": "select", "relationTo": "demandes",
              "options": [ {"value":"vacances","label":"Vacances"}, {"value":"maladie","label":"Maladie"} ] }
          ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var typeField = spec!.Entities[0].Fields.First(f => f.Label == "Type de conge");
        Assert.Equal(CustomFieldType.Select, typeField.FieldType);
        Assert.NotNull(typeField.Options);
        Assert.Equal(2, typeField.Options!.Count);
        Assert.Null(typeField.RelationToRef);
    }

    [Fact]
    public void Form_fields_accept_string_or_object_with_width_and_label()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "contrats", "displayName": "Contrats", "fields": [
            { "label": "Nom", "type": "text" },
            { "label": "Date de debut", "type": "date" },
            { "label": "Montant", "type": "money" }
          ],
          "form": { "sections": [ { "title": "Général", "fields": [
            "nom",
            { "field": "date_de_debut", "width": "half" },
            { "field": "Montant", "width": "large", "label": "  Montant TTC  " },
            { "field": "inconnu", "width": "half" }
          ] } ] } }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var form = spec!.Entities[0].Form;
        Assert.NotNull(form);
        var fields = form!.Sections[0].Fields;
        Assert.Equal(3, fields.Count);                        // champ inconnu ignoré, jamais d'échec
        Assert.Equal("nom", fields[0].Key);
        Assert.Null(fields[0].Width);                         // entrée chaîne → largeur par défaut (full)
        Assert.Null(fields[0].LabelOverride);
        Assert.Equal("half", fields[1].Width);
        Assert.Null(fields[2].Width);                         // largeur invalide → défaut (full)
        Assert.Equal("Montant TTC", fields[2].LabelOverride); // libellé nettoyé (trim)
    }

    [Fact]
    public void Legacy_form_with_plain_string_fields_still_parses()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "a", "displayName": "A", "fields": [
            { "label": "Nom", "type": "text" },
            { "label": "Ville", "type": "text" }
          ],
          "form": { "sections": [ { "fields": [ "nom", "ville" ] } ] } }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var fields = spec!.Entities[0].Form!.Sections[0].Fields;
        Assert.Equal(new[] { "nom", "ville" }, fields.Select(f => f.Key).ToArray());
        Assert.All(fields, f => Assert.Null(f.Width));
        Assert.All(fields, f => Assert.Null(f.LabelOverride));
    }

    [Fact]
    public void Field_with_relationTo_and_no_options_becomes_relation()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom", "type": "text" } ] },
          { "ref": "demandes", "displayName": "Demandes", "fields": [
            { "label": "Employe", "type": "text", "relationTo": "employes" }
          ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var rel = spec!.Entities.First(e => e.Ref == "demandes").Fields[0];
        Assert.Equal(CustomFieldType.RelationCustom, rel.FieldType);
        Assert.Equal("employes", rel.RelationToRef);
    }

    // ---- Réutilisation de tables existantes (existingKey — PR 1.3) ----

    [Theory]
    [InlineData("existingKey")]
    [InlineData("existing")]
    [InlineData("useExisting")]
    [InlineData("reuse")]
    public void Reused_entity_parses_via_every_alias_and_needs_no_fields(string alias)
    {
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "{{alias}}": "employes" },
          { "ref": "demandes", "displayName": "Demandes", "fields": [ { "label": "Statut" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);

        var reused = spec!.Entities.First(e => e.Ref == "employes");
        Assert.Equal("employes", reused.ExistingKey);
        Assert.Empty(reused.Fields);
        Assert.Null(reused.Form);
        Assert.Null(reused.Report);
        Assert.Equal("employes", reused.EntityDisplayName); // repli du libellé sur la clé
    }

    [Fact]
    public void Reuse_boolean_true_uses_the_entity_ref_as_key()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "existingKey": true, "displayName": "Employés" }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal("employes", spec!.Entities[0].ExistingKey);
        Assert.Equal("Employés", spec.Entities[0].EntityDisplayName);
    }

    [Fact]
    public void Reuse_boolean_false_means_no_reuse()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employés", "reuse": false, "fields": [ { "label": "Nom" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Null(spec!.Entities[0].ExistingKey);
        Assert.Single(spec.Entities[0].Fields);
    }

    [Fact]
    public void Invalid_existing_key_rejects_the_entity_with_a_message()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "x", "existingKey": "!!!" }
        ] }
        """;
        Assert.False(StudioAiSystemSpec.TryParse(json, out _, out var error));
        Assert.Contains("existingKey", error!, StringComparison.Ordinal);
    }

    [Fact]
    public void Reused_entity_ignores_fields_form_and_report_with_a_warning()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "existingKey": "employes", "displayName": "Employés",
            "fields": [ { "label": "Nom" } ],
            "form": { "sections": [ { "fields": [ "nom" ] } ] },
            "report": { "displayName": "État", "fields": [ "nom" ] } },
          { "ref": "demandes", "displayName": "Demandes", "fields": [ { "label": "Statut" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);

        var reused = spec!.Entities.First(e => e.Ref == "employes");
        Assert.Empty(reused.Fields);
        Assert.Null(reused.Form);
        Assert.Null(reused.Report);
        var warning = Assert.Single(spec.Warnings!);
        Assert.Contains("réutilisée telle quelle", warning, StringComparison.Ordinal);
    }

    [Fact]
    public void Relation_to_a_reused_ref_stays_a_custom_relation()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "existingKey": "employes" },
          { "ref": "demandes", "displayName": "Demandes", "fields": [
            { "label": "Employé", "type": "relation", "relationTo": "employes" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var rel = spec!.Entities.First(e => e.Ref == "demandes").Fields[0];
        Assert.Equal(CustomFieldType.RelationCustom, rel.FieldType);
        Assert.Equal("employes", rel.RelationToRef);
    }

    [Fact]
    public void Eight_new_plus_two_reused_entities_are_accepted()
    {
        var newEntities = string.Join(", ", Enumerable.Range(1, 8).Select(i =>
            $$"""{ "ref": "table_{{i}}", "displayName": "Table {{i}}", "fields": [ { "label": "Nom" } ] }"""));
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          {{newEntities}},
          { "ref": "employes", "existingKey": "employes" },
          { "ref": "contrats", "existingKey": "contrats" }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(10, spec!.Entities.Count);
        Assert.Equal(2, spec.Entities.Count(e => e.ExistingKey is not null));
    }

    [Fact]
    public void Ninth_new_entity_is_still_rejected()
    {
        var newEntities = string.Join(", ", Enumerable.Range(1, 9).Select(i =>
            $$"""{ "ref": "table_{{i}}", "displayName": "Table {{i}}", "fields": [ { "label": "Nom" } ] }"""));
        var json = $$"""{ "system": { "displayName": "T" }, "entities": [ {{newEntities}} ] }""";
        Assert.False(StudioAiSystemSpec.TryParse(json, out _, out var error));
        Assert.Contains($"Maximum {StudioAiSystemSpec.MaxEntities} entités", error!, StringComparison.Ordinal);
    }

    [Fact]
    public void Reused_entities_beyond_the_cap_are_ignored_with_a_warning()
    {
        var reusedEntities = string.Join(", ", Enumerable.Range(1, 9).Select(i =>
            $$"""{ "ref": "existante_{{i}}", "existingKey": "existante_{{i}}" }"""));
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "demandes", "displayName": "Demandes", "fields": [ { "label": "Statut" } ] },
          {{reusedEntities}}
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(1 + StudioAiSystemSpec.MaxExistingRefs, spec!.Entities.Count);
        var warning = Assert.Single(spec.Warnings!);
        Assert.Contains("ignorée", warning, StringComparison.Ordinal);
        Assert.Contains($"{StudioAiSystemSpec.MaxExistingRefs}", warning, StringComparison.Ordinal);
    }

    [Fact]
    public void Seed_batch_can_target_a_reused_entity_ref()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "existingKey": "employes" },
          { "ref": "demandes", "displayName": "Demandes", "fields": [ { "label": "Statut" } ] }
        ], "seed": [ { "entityRef": "employes", "records": [ { "nom": "Sami" } ] } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal("employes", spec!.Seed[0].EntityRef);
    }

    // ---- Relations plusieurs-à-plusieurs (PR 2.2) ----

    [Theory]
    [InlineData("many_to_many")]
    [InlineData("n_n")]
    [InlineData("nn")]
    [InlineData("many-to-many")]
    [InlineData("m2m")]
    public void Relation_kind_alias_is_recognized(string kind)
    {
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom" } ] },
          { "ref": "formations", "displayName": "Formations", "fields": [ { "label": "Titre" } ] }
        ], "relations": [ { "kind": "{{kind}}", "from": "employes", "to": "formations" } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var rel = Assert.Single(spec!.Relations);
        Assert.Equal("many_to_many", rel.Kind);
        Assert.Equal("employes", rel.FromRef);
        Assert.Equal("formations", rel.ToRef);
    }

    [Fact]
    public void Self_relation_is_ignored_with_a_warning()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom" } ] }
        ], "relations": [ { "kind": "many_to_many", "from": "employes", "to": "employes" } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Relations);
        var warning = Assert.Single(spec.Warnings!);
        Assert.Contains("liée à elle-même", warning, StringComparison.Ordinal);
    }

    [Fact]
    public void Seventh_relation_is_dropped_with_a_warning_beyond_the_cap()
    {
        var entities = string.Join(", ", Enumerable.Range(1, 8).Select(i =>
            $$"""{ "ref": "table_{{i}}", "displayName": "Table {{i}}", "fields": [ { "label": "Nom" } ] }"""));
        var relations = string.Join(", ", Enumerable.Range(1, 7).Select(i =>
            $$"""{ "kind": "many_to_many", "from": "table_{{i}}", "to": "table_{{i + 1}}" }"""));
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [ {{entities}} ], "relations": [ {{relations}} ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(StudioAiSystemSpec.MaxRelations, spec!.Relations.Count);
        Assert.Contains(spec.Warnings!, w => w.Contains($"Au plus {StudioAiSystemSpec.MaxRelations}", StringComparison.Ordinal));
    }

    [Fact]
    public void Relation_to_an_unknown_ref_is_ignored_with_a_warning()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom" } ] }
        ], "relations": [ { "kind": "many_to_many", "from": "employes", "to": "inconnue" } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Relations);
        var warning = Assert.Single(spec.Warnings!);
        Assert.Contains("inconnue", warning, StringComparison.Ordinal);
    }

    [Fact]
    public void Duplicate_relation_pair_regardless_of_order_is_kept_once()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom" } ] },
          { "ref": "formations", "displayName": "Formations", "fields": [ { "label": "Titre" } ] }
        ], "relations": [
          { "kind": "many_to_many", "from": "employes", "to": "formations" },
          { "kind": "many_to_many", "from": "formations", "to": "employes" }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Single(spec!.Relations);
        var warning = Assert.Single(spec.Warnings!);
        Assert.Contains("double", warning, StringComparison.Ordinal);
    }

    [Fact]
    public void Field_typed_many_to_many_is_promoted_to_a_relation_and_excluded_from_fields()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [
            { "label": "Nom", "type": "text" },
            { "label": "Formations", "type": "many_to_many", "relationTo": "formations" }
          ] },
          { "ref": "formations", "displayName": "Formations", "fields": [ { "label": "Titre" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var employes = spec!.Entities.First(e => e.Ref == "employes");
        Assert.Single(employes.Fields); // "Formations" retiré des champs, promu en relation
        Assert.DoesNotContain(employes.Fields, f => f.Label == "Formations");
        var rel = Assert.Single(spec.Relations);
        Assert.Equal("employes", rel.FromRef);
        Assert.Equal("formations", rel.ToRef);
    }

    [Fact]
    public void Spec_without_relations_has_an_empty_list_and_no_warning_about_relations()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Relations);
        Assert.True(spec.Warnings is null || spec.Warnings.Count == 0);
    }

    [Fact]
    public void Workflows_array_is_ignored_with_a_deferral_warning()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom" } ] }
        ], "workflows": [ { "name": "Notifier" } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var warning = Assert.Single(spec!.Warnings!);
        Assert.Contains("workflows", warning, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Promoted_field_with_unknown_target_is_reemitted_as_a_text_field_never_lost()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [
            { "label": "Nom", "type": "text" },
            { "label": "Clients", "type": "many_to_many", "relationTo": "clients" }
          ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Relations); // source ERP « clients » : pas de table du même nom dans la spec
        var employes = Assert.Single(spec.Entities);
        Assert.Equal(2, employes.Fields.Count);
        var clients = Assert.Single(employes.Fields, f => f.Label == "Clients");
        Assert.Equal(CustomFieldType.Text, clients.FieldType);
        Assert.Contains(spec.Warnings!, w => w.Contains("conservé en texte", StringComparison.Ordinal));
    }

    [Fact]
    public void Promoted_field_target_declared_later_in_the_spec_resolves()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [
            { "label": "Formations", "type": "n_n", "relationTo": "formations" }
          ] },
          { "ref": "formations", "displayName": "Formations", "fields": [ { "label": "Titre" } ] }
        ] }
        """;
        // « employes » n'a QUE le champ promu (cible déclarée après) : l'entité survit, la relation est créée.
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(2, spec!.Entities.Count);
        Assert.Empty(spec.Entities.First(e => e.Ref == "employes").Fields);
        var rel = Assert.Single(spec.Relations);
        Assert.Equal("formations", rel.ToRef);
    }

    [Fact]
    public void Overly_long_junction_name_is_truncated_to_100_characters()
    {
        var longName = new string('j', 150);
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employes", "fields": [ { "label": "Nom" } ] },
          { "ref": "formations", "displayName": "Formations", "fields": [ { "label": "Titre" } ] }
        ], "relations": [ { "kind": "many_to_many", "from": "employes", "to": "formations", "junctionName": "{{longName}}" } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var rel = Assert.Single(spec!.Relations);
        Assert.Equal(100, rel.JunctionName!.Length);
    }

    // ---------- PR 2.4 — vues enregistrées proposées (entities[].views[]) ----------

    [Fact]
    public void Entity_views_are_parsed_and_capped_at_three()
    {
        const string json = """
        { "system": { "displayName": "Ops" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre", "type": "text" } ],
            "views": [ { "name": "A", "mode": "list" }, { "name": "B", "mode": "kanban" },
                       { "name": "C", "mode": "calendar" }, { "name": "D" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var views = spec!.Entities[0].Views;
        Assert.Equal(3, views.Count);
        Assert.Equal(new[] { "list", "kanban", "calendar" }, views.Select(v => v.Mode));
        // Une vue d'entité n'a JAMAIS de clé de table (l'entité est implicite).
        Assert.All(views, v => Assert.Null(v.EntityKey));
        Assert.Contains(spec.Warnings!, w => w.Contains("Au plus 3 vues"));
    }

    [Fact]
    public void Unreadable_view_is_skipped_with_warning()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre" } ],
            "views": [ "???" ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Entities[0].Views);
        Assert.Contains(spec.Warnings!, w => w.Contains("Vue ignorée"));
    }

    [Fact]
    public void Invalid_view_mode_collects_warning_and_keeps_the_entity()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre" } ],
            "views": [ { "name": "A", "mode": "graphique" }, { "name": "B", "mode": "list" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var views = spec!.Entities[0].Views;
        Assert.Single(views);
        Assert.Equal("B", views[0].DisplayName);
        Assert.Contains(spec.Warnings!, w => w.Contains("Mode de vue inconnu"));
    }

    [Fact]
    public void Existing_entity_ignores_views_with_warning()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "taches", "existingKey": "taches",
            "views": [ { "name": "A", "mode": "list" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Entities[0].Views);
        Assert.Contains(spec.Warnings!, w => w.Contains("vues ignorées") && w.Contains("réutilisée telle quelle"));
    }

    [Fact]
    public void Views_node_must_be_an_array()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre" } ],
            "views": { "name": "A" } }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Entities[0].Views);
        Assert.Contains(spec.Warnings!, w => w.Contains("tableau de vues"));
    }

    // PR 3.3 — « specVersion » racine : absent ⇒ accepté (rétro-compatibilité), 1 ⇒ accepté,
    // toute autre valeur (entier ou chaîne non convertible) ⇒ rejet au message figé.

    [Fact]
    public void TryParse_accepts_spec_without_version()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.NotNull(spec);
    }

    [Fact]
    public void TryParse_accepts_spec_version_1()
    {
        const string json = """
        { "specVersion": 1, "system": { "displayName": "T" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.NotNull(spec);
    }

    [Theory]
    [InlineData("2", "2")]
    [InlineData("\"x\"", "x")]
    [InlineData("0", "0")]
    public void TryParse_rejects_unsupported_spec_version(string versionJson, string raw)
    {
        var json = $$"""
        { "specVersion": {{versionJson}}, "system": { "displayName": "T" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre" } ] }
        ] }
        """;
        Assert.False(StudioAiSystemSpec.TryParse(json, out _, out var error));
        Assert.Equal($"Version de spécification non prise en charge : {raw}.", error);
    }
}
