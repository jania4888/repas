using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Templates;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Canonicalisation des specs Studio IA (B-P0-02) : forme unique persistée/exposée à l'éditeur
/// d'aperçu. Invariants couverts : aller-retour parse → canonique → parse stable à l'octet près,
/// clé de champ explicite prioritaire sur la dérivation du libellé, clés réservées/dupliquées
/// rejetées, alias acceptés jamais émis, clés inconnues éliminées (filtre d'écriture massive).
/// </summary>
public sealed class StudioAiSpecCanonicalTests
{
    /// <summary>Spec telle que le LLM la produit aujourd'hui (alias, types FR, formes tolérées).</summary>
    private const string SystemSpecLegacy = """
    {
      "system": { "displayName": "Gestion des congés", "icon": "calendar", "description": "Suivi des congés.",
        "onboarding": ["Ajoutez des employés", "Configurez les types"] },
      "entities": [
        { "ref": "employes", "displayName": "Employés", "fields": [
          { "label": "Nom", "type": "text", "required": true },
          { "label": "Date d'embauche", "type": "date" }
        ] },
        { "ref": "types_conges", "displayName": "Types de congés", "fields": [
          { "label": "Libellé", "type": "text", "unique": true },
          { "label": "Nombre de jours", "type": "number" }
        ] },
        { "ref": "demandes", "displayName": "Demandes", "fields": [
          { "label": "Employé", "type": "relation", "relationTo": "employes" },
          { "label": "Type", "type": "relation", "relationTo": "types_conges" },
          { "label": "Statut", "type": "select", "options": [ {"value":"en_attente","label":"En attente"}, "approuvee" ] },
          { "label": "Commentaire", "type": "texte long" }
        ],
        "form": { "sections": [ { "title": "Demande", "fields": [ "employe", { "field": "statut", "width": "half" } ] } ] },
        "report": { "displayName": "État des congés", "fields": [ "employe", "statut" ],
          "filters": [ { "field": "statut", "op": "different", "value": "brouillon" } ],
          "sort": [ { "field": "statut", "dir": "desc" } ] } }
      ],
      "seed": [ { "entityRef": "types_conges", "records": [ { "libelle": "CP", "nombre_de_jours": 25 }, { "libelle": "RTT" } ] } ]
    }
    """;

    [Fact]
    public void Canonical_of_parse_is_reparsable_and_byte_stable()
    {
        Assert.True(StudioAiSystemSpec.TryParse(SystemSpecLegacy, out var spec, out var error), error);
        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec!);

        Assert.True(StudioAiSystemSpec.TryParse(canonical, out var reparsed, out var reparseError), reparseError);
        var canonicalAgain = StudioAiSpecCanonical.CanonicalSystem(reparsed!);

        Assert.Equal(canonical, canonicalAgain);
    }

    [Theory]
    [InlineData(StudioAiPlanKind.CreateSystem, SystemSpecLegacy)]
    [InlineData(StudioAiPlanKind.CreateApp, """
        { "entity": { "displayName": "Note de frais" }, "fields": [
          { "label": "Montant", "type": "money" },
          { "label": "Justificatif", "type": "attachment" } ],
          "report": { "groupBy": ["montant"], "measures": [ { "field": "montant", "fn": "sum" } ] } }
        """)]
    [InlineData(StudioAiPlanKind.Amendment, """
        { "target": { "entityKey": "employes" }, "operations": [
          { "op": "add_field", "label": "Matricule", "type": "text", "required": true },
          { "op": "update_field", "field": "nom", "label": "Nom de famille" },
          { "op": "remove_field", "field": "ancien_champ" },
          { "op": "update_entity", "displayName": "Salariés" },
          { "op": "set_form", "form": { "sections": [ { "title": "Identité", "fields": ["nom"] } ] } },
          { "op": "set_report", "displayName": "Effectifs", "report": { "groupBy": ["service"] } } ] }
        """)]
    [InlineData(StudioAiPlanKind.View, """
        { "title": "Factures récentes", "table": "Invoices",
          "columns": [ "Number", { "name": "TotalAmount", "label": "Total", "format": "money" } ], "search": false }
        """)]
    [InlineData(StudioAiPlanKind.Report, """
        { "title": "Ventes T1", "source": "Invoices", "groupBy": ["CustomerId"],
          "measures": [ { "field": "TotalAmount", "fn": "sum" } ],
          "filters": [ { "field": "Status", "op": "=", "value": "Paid" } ],
          "sort": [ { "field": "TotalAmount", "dir": "desc" } ], "from": "2026-01-01", "to": "2026-03-31" }
        """)]
    [InlineData(StudioAiPlanKind.RecordView, """
        { "entity": "interventions", "name": "Kanban par statut", "mode": "kanban",
          "columns": [ "titre", "statut" ],
          "filters": [ { "field": "statut", "op": "in", "value": ["planifiee", "en_cours"] } ],
          "sort": [ { "field": "cout", "desc": true } ], "groupBy": "statut", "title": "titre",
          "isDefault": true }
        """)]
    public void CanonicalFor_round_trips_byte_stable_for_every_kind(StudioAiPlanKind kind, string specJson)
    {
        var canonical = StudioAiSpecCanonical.CanonicalFor(kind, specJson, out var error);
        Assert.NotNull(canonical);

        var canonicalAgain = StudioAiSpecCanonical.CanonicalFor(kind, canonical!, out var reparseError);

        Assert.Null(reparseError);
        Assert.Equal(canonical, canonicalAgain);
    }

    [Fact]
    public void CanonicalFor_of_an_invalid_spec_is_null_with_the_parser_error()
    {
        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, "{ pas du json", out var error);

        Assert.Null(canonical);
        Assert.NotNull(error);
    }

    /// <summary>Spec d'amendement avec les six opérations de la PR 3.1b (alias, libellés, désordre).</summary>
    private const string AmendmentSpecPr31b = """
    { "target": { "entityKey": "Interventions" }, "operations": [
      { "op": "reordonner_champs", "fields": [ "reference", "client", "statut", "reference" ] },
      { "op": "change_field_type", "key": "duree_estimee", "type": "Decimal",
        "options": [ { "value": "h", "label": "Heures" } ], "config": { "max": 12, "custom": true } },
      { "op": "add_relation", "kind": "N-N", "target": "Compétences", "label": "Compétences requises", "junctionName": "Affectations" },
      { "op": "assign_system", "system": "Gestion Interventions" },
      { "op": "set_view", "mode": "kanban", "displayName": "Kanban par statut", "columns": ["reference"],
        "groupBy": "statut", "isDefault": true },
      { "op": "set_automation", "trigger": "on_create", "action": "notify" } ] }
    """;

    [Fact]
    public void Amendment_with_the_pr31b_operations_round_trips_byte_stable()
    {
        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Amendment, AmendmentSpecPr31b, out var error);
        Assert.NotNull(canonical);

        var canonicalAgain = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Amendment, canonical!, out var reparseError);

        Assert.Null(reparseError);
        Assert.Equal(canonical, canonicalAgain);
    }

    [Fact]
    public void Amendment_canonical_normalizes_the_pr31b_operations()
    {
        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Amendment, AmendmentSpecPr31b, out var error);
        Assert.NotNull(canonical);

        var node = JsonNode.Parse(canonical!)!;
        // Clé de table slugifiée ; alias d'op absorbés ; doublon de réordonnancement éliminé.
        Assert.Equal("interventions", node["target"]!["entityKey"]!.GetValue<string>());
        var ops = node["operations"]!.AsArray();
        Assert.Equal("reorder_fields", ops[0]!["op"]!.GetValue<string>());
        Assert.Equal(new[] { "reference", "client", "statut" },
            ops[0]!["fields"]!.AsArray().Select(f => f!.GetValue<string>()).ToArray());
        // Type émis en nom d'énumération minuscule exact (rejouable par TryMapType).
        Assert.Equal("change_field_type", ops[1]!["op"]!.GetValue<string>());
        Assert.Equal("decimal", ops[1]!["type"]!.GetValue<string>());
        Assert.Equal("h", ops[1]!["options"]!.AsArray()[0]!["value"]!.GetValue<string>());
        Assert.Equal("true", ops[1]!["config"]!["custom"]!.ToString());
        // Relation : kind canonique, cible et clé de jonction slugifiées.
        Assert.Equal("many_to_many", ops[2]!["kind"]!.GetValue<string>());
        Assert.Equal("competences", ops[2]!["target"]!.GetValue<string>());
        Assert.Equal("affectations", ops[2]!["junctionName"]!.GetValue<string>());
        Assert.Equal("gestion_interventions", ops[3]!["system"]!.GetValue<string>());
        // Vue : jamais de clé « entity » dans un amendement (la table cible est implicite).
        Assert.Equal("set_view", ops[4]!["op"]!.GetValue<string>());
        Assert.Null(ops[4]!["entity"]);
        Assert.Equal("kanban", ops[4]!["mode"]!.GetValue<string>());
        // Automatisation : contenu repassé tel quel (hors alias d'op).
        Assert.Equal("set_automation", ops[5]!["op"]!.GetValue<string>());
        Assert.Equal("on_create", ops[5]!["trigger"]!.GetValue<string>());
    }

    [Fact]
    public void Amendment_assign_system_detach_round_trips_byte_stable()
    {
        const string json = """
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "assign_system", "system": "aucun" } ] }
        """;

        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Amendment, json, out var error);
        Assert.NotNull(canonical);
        // Le détachement est émis « none » : une clé absente serait relue comme un oubli du modèle.
        Assert.Contains("\"system\": \"none\"", canonical, StringComparison.Ordinal);

        var canonicalAgain = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Amendment, canonical!, out var reparseError);
        Assert.Null(reparseError);
        Assert.Equal(canonical, canonicalAgain);
    }

    [Fact]
    public void Field_with_explicit_key_keeps_it()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "demandes", "displayName": "Demandes", "fields": [
            { "key": "date_debut", "label": "Date de début", "type": "date" } ] } ] }
        """;

        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var field = spec!.Entities[0].Fields[0];
        Assert.Equal("date_debut", field.Key); // et non « date_de_debut » dérivé du libellé

        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec);
        Assert.Contains("\"key\": \"date_debut\"", canonical, StringComparison.Ordinal);
    }

    [Fact]
    public void Reused_entity_round_trips_as_ref_existingKey_displayName_only()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "existingKey": "employes" },
          { "ref": "demandes", "displayName": "Demandes", "fields": [
            { "label": "Employé", "type": "relation", "relationTo": "employes" } ] }
        ] }
        """;

        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec!);

        // L'entité réutilisée n'émet QUE ref/existingKey/displayName : aucun champ, formulaire ou état.
        Assert.Contains("\"existingKey\": \"employes\"", canonical, StringComparison.Ordinal);
        var node = JsonNode.Parse(canonical)!;
        var reused = node["entities"]!.AsArray()
            .First(e => e!["ref"]!.GetValue<string>() == "employes")!;
        Assert.Equal(new[] { "ref", "existingKey", "displayName" },
            reused.AsObject().Select(p => p.Key).ToArray());
        Assert.Equal("employes", reused["displayName"]!.GetValue<string>()); // repli sur la clé

        // Stable à l'octet près au re-parse (l'éditeur d'aperçu ré-émet la même forme).
        var canonicalAgain = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, canonical, out var reparseError);
        Assert.Null(reparseError);
        Assert.Equal(canonical, canonicalAgain);
    }

    [Theory]
    [InlineData("id")]
    [InlineData("RowVersion")]
    [InlineData("created_at")]
    public void Field_with_reserved_key_is_rejected(string reservedKey)
    {
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "a", "displayName": "A", "fields": [
            { "key": "{{reservedKey}}", "label": "Identifiant", "type": "text" } ] } ] }
        """;

        var ok = StudioAiSystemSpec.TryParse(json, out _, out var error);

        Assert.False(ok);
        Assert.Contains("invalide ou réservée", error);
    }

    [Fact]
    public void Field_with_duplicate_key_is_rejected()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "a", "displayName": "A", "fields": [
            { "key": "nom", "label": "Nom", "type": "text" },
            { "key": "nom", "label": "Nom bis", "type": "text" } ] } ] }
        """;

        var ok = StudioAiSystemSpec.TryParse(json, out _, out var error);

        Assert.False(ok);
        Assert.Contains("dupliquée", error);
    }

    [Fact]
    public void App_field_with_explicit_key_keeps_it_and_duplicate_is_rejected()
    {
        const string json = """
        { "entity": { "displayName": "T" }, "fields": [
          { "key": "reference_interne", "label": "Référence", "type": "text" } ] }
        """;
        Assert.True(StudioAiAppSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal("reference_interne", spec!.Fields[0].Key);

        const string duplicate = """
        { "entity": { "displayName": "T" }, "fields": [
          { "key": "nom", "label": "A" }, { "key": "nom", "label": "B" } ] }
        """;
        Assert.False(StudioAiAppSpec.TryParse(duplicate, out _, out var dupError));
        Assert.Contains("dupliquée", dupError);
    }

    [Fact]
    public void Aliases_are_accepted_but_never_emitted()
    {
        // Alias historiques : « name » pour les libellés, « key » pour la ref d'entité, types FR.
        const string json = """
        { "name": "Système alias",
          "entities": [
            { "key": "employes", "name": "Employés", "fields": [
              { "name": "Nom", "type": "texte" },
              { "name": "Statut", "type": "liste", "options": ["actif", "inactif"] } ] } ] }
        """;

        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec!);

        Assert.Contains("\"displayName\": \"Système alias\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"type\": \"text\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"type\": \"select\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"ref\": \"employes\"", canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("\"texte\"", canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("\"liste\"", canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("\"name\":", canonical, StringComparison.Ordinal); // jamais l'alias « name »
        Assert.DoesNotContain("\"entity\":", canonical, StringComparison.Ordinal);
    }

    [Fact]
    public void Unknown_keys_are_dropped()
    {
        const string json = """
        { "system": { "displayName": "T", "foo": "bar" },
          "inconnu": [1, 2, 3],
          "entities": [
            { "ref": "a", "displayName": "A", "surprise": true, "fields": [
              { "label": "Nom", "type": "text", "weird": { "nested": 1 } } ] } ] }
        """;

        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec!);

        Assert.DoesNotContain("foo", canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("inconnu", canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("surprise", canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("weird", canonical, StringComparison.Ordinal);
    }

    [Fact]
    public void Legacy_spec_canonical_form_is_stable()
    {
        // Fixture « produite par le LLM actuel » : la forme canonique doit être stable et relisible.
        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, SystemSpecLegacy, out var error);

        Assert.NotNull(canonical);
        Assert.Null(error);
        var node = JsonNode.Parse(canonical!)!.AsObject();
        Assert.True(node.ContainsKey("system"));
        Assert.True(node.ContainsKey("entities"));
        Assert.True(node.ContainsKey("seed"));

        // L'alias d'opérateur est traduit en opérateur canonique.
        Assert.Contains("\"op\": \"neq\"", canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("different", canonical, StringComparison.Ordinal);
    }

    [Fact]
    public void Canonical_emits_options_as_value_label_objects_and_half_width_form_fields()
    {
        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, SystemSpecLegacy, out _);

        Assert.NotNull(canonical);
        Assert.Contains("\"value\": \"en_attente\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"label\": \"En attente\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"width\": \"half\"", canonical, StringComparison.Ordinal);
    }

    [Fact]
    public void Entity_with_more_than_max_fields_is_rejected_outright()
    {
        // 41 champs valides : rejet franc (revue P0) — aucune troncature silencieuse.
        var fields = string.Join(", ", Enumerable.Range(1, StudioAiAppSpec.MaxFields + 1)
            .Select(i => $"{{ \"label\": \"Champ {i}\", \"type\": \"text\" }}"));
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "a", "displayName": "A", "fields": [ {{fields}} ] } ] }
        """;

        var ok = StudioAiSystemSpec.TryParse(json, out var spec, out var error);

        Assert.False(ok);
        Assert.Null(spec);
        Assert.Contains("40", error, StringComparison.Ordinal);
    }

    [Fact]
    public void Entity_with_exactly_max_fields_is_accepted()
    {
        var fields = string.Join(", ", Enumerable.Range(1, StudioAiAppSpec.MaxFields)
            .Select(i => $"{{ \"label\": \"Champ {i}\", \"type\": \"text\" }}"));
        var json = $$"""
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "a", "displayName": "A", "fields": [ {{fields}} ] } ] }
        """;

        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Equal(StudioAiAppSpec.MaxFields, spec!.Entities[0].Fields.Count);
    }

    [Fact]
    public void Barcode_field_keeps_its_format_config_in_system_spec()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "articles", "displayName": "Articles", "fields": [
            { "key": "code", "label": "Code", "type": "barcode", "config": { "format": "ean13" } } ] } ] }
        """;

        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var config = spec!.Entities[0].Fields[0].Config;
        Assert.NotNull(config);
        Assert.Equal("ean13", config!["format"]!.GetValue<string>());

        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec);
        Assert.Contains("\"format\": \"ean13\"", canonical, StringComparison.Ordinal);
    }

    [Fact]
    public void Relations_round_trip_byte_stable_and_omit_null_label_and_junction_name()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employés", "fields": [ { "label": "Nom", "type": "text" } ] },
          { "ref": "formations", "displayName": "Formations", "fields": [ { "label": "Nom", "type": "text" } ] }
        ], "relations": [
          { "kind": "many_to_many", "from": "employes", "to": "formations", "label": "Participants", "junctionName": "Suivis" }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec!);

        Assert.Contains("\"relations\":", canonical, StringComparison.Ordinal);
        Assert.Contains("\"kind\": \"many_to_many\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"from\": \"employes\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"to\": \"formations\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"label\": \"Participants\"", canonical, StringComparison.Ordinal);
        Assert.Contains("\"junctionName\": \"Suivis\"", canonical, StringComparison.Ordinal);

        // Stable à l'octet près au re-parse.
        Assert.True(StudioAiSystemSpec.TryParse(canonical, out var reparsed, out var reparseError), reparseError);
        var canonicalAgain = StudioAiSpecCanonical.CanonicalSystem(reparsed!);
        Assert.Equal(canonical, canonicalAgain);

        // Sans label ni junctionName, les clés correspondantes sont omises (pas null).
        const string minimal = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employés", "fields": [ { "label": "Nom", "type": "text" } ] },
          { "ref": "formations", "displayName": "Formations", "fields": [ { "label": "Nom", "type": "text" } ] }
        ], "relations": [ { "kind": "many_to_many", "from": "employes", "to": "formations" } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(minimal, out var minimalSpec, out var minimalError), minimalError);
        var minimalCanonical = StudioAiSpecCanonical.CanonicalSystem(minimalSpec!);
        var relationNode = JsonNode.Parse(minimalCanonical)!["relations"]!.AsArray()[0]!.AsObject();
        Assert.Equal(new[] { "kind", "from", "to" }, relationNode.Select(p => p.Key).ToArray());
    }

    [Fact]
    public void Spec_without_relations_omits_the_relations_key_from_the_canonical_form()
    {
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "employes", "displayName": "Employés", "fields": [ { "label": "Nom", "type": "text" } ] } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec!);

        Assert.DoesNotContain("\"relations\"", canonical, StringComparison.Ordinal);
    }

    // ---------- PR 2.4 — vues enregistrées ----------

    [Fact]
    public void Record_view_canonical_is_stable_and_coherent()
    {
        Assert.True(StudioAiRecordViewSpec.TryParse("""
            { "entity": "interventions", "name": "Kanban par statut", "mode": "kanban",
              "columns": [ "titre", "statut" ],
              "filters": [ { "field": "statut", "op": "in", "value": ["planifiee"] } ],
              "sort": [ { "field": "cout", "desc": true } ], "groupBy": "statut", "title": "titre",
              "isDefault": true }
            """, out var spec, out var parseError), parseError);

        var canonical = StudioAiSpecCanonical.CanonicalRecordView(spec!);

        // Ordre des clés fixe (diff d'aperçu lisible) : entity, name, mode, columns, filters, sort,
        // groupBy, title, isDefault — start/end absents d'une spec kanban.
        var node = JsonNode.Parse(canonical)!.AsObject();
        Assert.Equal(
            new[] { "entity", "name", "mode", "columns", "filters", "sort", "groupBy", "title", "isDefault" },
            node.Select(p => p.Key));
        Assert.Equal("kanban", node["mode"]!.GetValue<string>());
        Assert.Equal("statut", node["groupBy"]!.GetValue<string>());
        Assert.True(node["isDefault"]!.GetValue<bool>());
        Assert.False(node.AsObject().ContainsKey("start"));
    }

    [Fact]
    public void System_canonical_emits_entity_views_after_report()
    {
        const string json = """
        { "system": { "displayName": "Ops" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre", "type": "text" } ],
            "report": { "displayName": "Etat", "fields": [ "titre" ] },
            "views": [ { "name": "Kanban", "mode": "kanban", "groupBy": "statut" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);

        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, json, out _);

        var node = JsonNode.Parse(canonical!)!;
        var entity = node["entities"]!.AsArray()[0]!.AsObject();
        // Ordre : report puis views ; la vue d'entité ne porte JAMAIS de clé « entity ».
        var keys = entity.Select(p => p.Key).ToList();
        Assert.True(keys.IndexOf("report") < keys.IndexOf("views"), $"ordre inattendu : {string.Join(",", keys)}");
        var view = entity["views"]!.AsArray()[0]!.AsObject();
        Assert.Equal("Kanban", view["name"]!.GetValue<string>());
        Assert.Equal("kanban", view["mode"]!.GetValue<string>());
        Assert.False(view.ContainsKey("entity"));

        // Aller-retour : le canonique se reparse à l'identique.
        var again = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, canonical!, out var reparseError);
        Assert.Null(reparseError);
        Assert.Equal(canonical, again);
    }

    [Fact]
    public void System_summary_counts_views_and_adds_a_views_step()
    {
        const string json = """
        { "system": { "displayName": "Ops" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre", "type": "text" } ],
            "views": [ { "name": "Kanban", "mode": "kanban", "groupBy": "statut" },
                       { "name": "Toutes", "mode": "list" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);

        using var doc = System.Text.Json.JsonDocument.Parse(StudioAiPlanSummary.ForSystem(spec!));

        var entity = doc.RootElement.GetProperty("entities")[0];
        Assert.Equal(2, entity.GetProperty("viewCount").GetInt32());
        var steps = doc.RootElement.GetProperty("steps").EnumerateArray().ToList();
        var viewsStep = Assert.Single(steps, s => s.GetProperty("key").GetString() == "views");
        Assert.Equal("Vues", viewsStep.GetProperty("label").GetString());
        Assert.Contains("Kanban", viewsStep.GetProperty("detail").GetString());
        // L'étape « vues » suit « tables » (et « états » s'il y en a) — jamais avant.
        Assert.True(
            steps.FindIndex(s => s.GetProperty("key").GetString() == "tables")
                < steps.FindIndex(s => s.GetProperty("key").GetString() == "views"));
    }

    [Fact]
    public void System_summary_omits_view_count_without_views()
    {
        const string json = """
        { "system": { "displayName": "Ops" }, "entities": [
          { "ref": "taches", "displayName": "Taches", "fields": [ { "label": "Titre", "type": "text" } ] }
        ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);

        using var doc = System.Text.Json.JsonDocument.Parse(StudioAiPlanSummary.ForSystem(spec!));

        Assert.False(doc.RootElement.GetProperty("entities")[0].TryGetProperty("viewCount", out _));
        Assert.DoesNotContain(
            doc.RootElement.GetProperty("steps").EnumerateArray(),
            s => s.GetProperty("key").GetString() == "views");
    }

    [Fact]
    public void Record_view_summary_lists_target_mode_and_columns()
    {
        Assert.True(StudioAiRecordViewSpec.TryParse("""
            { "entity": "interventions", "name": "Urgentes", "mode": "list",
              "columns": [ "titre", "client" ],
              "filters": [ { "field": "priorite", "op": "eq", "value": "haute" } ], "isDefault": true }
            """, out var spec, out var parseError), parseError);

        using var doc = System.Text.Json.JsonDocument.Parse(
            StudioAiPlanSummary.ForRecordView(spec!, "Interventions", new[] { "Colonne « x » inconnue, ignorée." }));

        Assert.Equal("RecordView", doc.RootElement.GetProperty("kind").GetString());
        Assert.Equal("Vue « Urgentes » sur Interventions", doc.RootElement.GetProperty("title").GetString());
        var steps = doc.RootElement.GetProperty("steps").EnumerateArray()
            .Select(s => (key: s.GetProperty("key").GetString(), detail: s.GetProperty("detail").GetString()))
            .ToList();
        Assert.Equal(("target", "Interventions"), steps[0]);
        Assert.Equal(("mode", "Liste"), steps[1]);
        Assert.Equal(("columns", "2"), steps[2]);
        Assert.Contains(steps, s => s.key == "filters" && s.detail == "1");
        Assert.Contains(steps, s => s.key == "default");
        Assert.Equal("Colonne « x » inconnue, ignorée.", doc.RootElement.GetProperty("warnings")[0].GetString());
    }

    // ---------- PR 3.3b1 — extraction CanonicalSystemNode (E9) ----------

    [Fact]
    public void CanonicalSystem_equals_serialized_canonical_node()
    {
        Assert.True(StudioAiSystemSpec.TryParse(SystemSpecLegacy, out var spec, out var error), error);

        var viaString = StudioAiSpecCanonical.CanonicalSystem(spec!);
        var viaNode = StudioAiSpecCanonical.Serialize(StudioAiSpecCanonical.CanonicalSystemNode(spec!));

        Assert.Equal(viaString, viaNode);
    }

    /// <summary>
    /// Sortie de <see cref="StudioAiSpecCanonical.CanonicalSystem"/> sur le modèle embarqué
    /// <c>suivi-reclamations</c>, capturée AVANT l'extraction de <c>CanonicalSystemNode</c> (3.3b1)
    /// et figée ici : toute dérive de la forme canonique fait échouer le test de non-régression.
    /// </summary>
    private const string SuiviReclamationsCanonicalGolden = """
    {
      "system": {
        "displayName": "Suivi des réclamations",
        "icon": "headset",
        "description": "Traitement des réclamations clients : motifs, réclamations et actions correctives.",
        "onboarding": [
          "Vérifiez les motifs préchargés",
          "Enregistrez une réclamation",
          "Affectez une action corrective"
        ]
      },
      "entities": [
        {
          "ref": "motifs",
          "displayName": "Motif",
          "displayNamePlural": "Motifs",
          "icon": "tags",
          "fields": [
            {
              "key": "libelle",
              "label": "Libellé",
              "type": "text",
              "required": true,
              "unique": true
            }
          ]
        },
        {
          "ref": "reclamations",
          "displayName": "Réclamation",
          "displayNamePlural": "Réclamations",
          "icon": "headset",
          "fields": [
            {
              "key": "reference",
              "label": "Référence",
              "type": "text",
              "required": true,
              "unique": true
            },
            {
              "key": "client",
              "label": "Client",
              "type": "relation",
              "required": true,
              "unique": false,
              "relationTo": "clients"
            },
            {
              "key": "motif",
              "label": "Motif",
              "type": "relation",
              "required": true,
              "unique": false,
              "relationTo": "motifs"
            },
            {
              "key": "description",
              "label": "Description",
              "type": "multilinetext",
              "required": false,
              "unique": false
            },
            {
              "key": "priorite",
              "label": "Priorité",
              "type": "select",
              "required": true,
              "unique": false,
              "options": [
                {
                  "value": "basse",
                  "label": "Basse"
                },
                {
                  "value": "normale",
                  "label": "Normale"
                },
                {
                  "value": "haute",
                  "label": "Haute"
                }
              ]
            },
            {
              "key": "date_d_ouverture",
              "label": "Date d'ouverture",
              "type": "date",
              "required": true,
              "unique": false
            },
            {
              "key": "statut",
              "label": "Statut",
              "type": "select",
              "required": true,
              "unique": false,
              "options": [
                {
                  "value": "ouverte",
                  "label": "Ouverte"
                },
                {
                  "value": "en_cours",
                  "label": "En cours"
                },
                {
                  "value": "resolue",
                  "label": "Résolue"
                },
                {
                  "value": "cloturee",
                  "label": "Clôturée"
                }
              ]
            }
          ],
          "form": {
            "sections": [
              {
                "title": "Réclamation",
                "fields": [
                  {
                    "field": "reference"
                  },
                  {
                    "field": "client"
                  },
                  {
                    "field": "motif"
                  },
                  {
                    "field": "description"
                  },
                  {
                    "field": "priorite",
                    "width": "half"
                  },
                  {
                    "field": "date_d_ouverture",
                    "width": "half"
                  },
                  {
                    "field": "statut"
                  }
                ]
              }
            ]
          },
          "report": {
            "displayName": "Réclamations ouvertes",
            "columns": [
              "reference",
              "client",
              "motif",
              "priorite",
              "date_d_ouverture",
              "statut"
            ],
            "filters": [
              {
                "field": "statut",
                "op": "neq",
                "value": "cloturee"
              }
            ],
            "sort": [
              {
                "field": "date_d_ouverture",
                "dir": "desc"
              }
            ]
          },
          "views": [
            {
              "name": "Par statut",
              "mode": "kanban",
              "columns": [
                "reference",
                "client",
                "priorite"
              ],
              "filters": [],
              "sort": [],
              "groupBy": "statut",
              "title": "reference",
              "isDefault": false
            },
            {
              "name": "Ouvertes",
              "mode": "list",
              "columns": [
                "reference",
                "client",
                "motif",
                "priorite",
                "statut",
                "date_d_ouverture"
              ],
              "filters": [
                {
                  "field": "statut",
                  "op": "neq",
                  "value": "cloturee"
                }
              ],
              "sort": [
                {
                  "field": "date_d_ouverture",
                  "desc": true
                }
              ],
              "isDefault": true
            }
          ]
        },
        {
          "ref": "actions_correctives",
          "displayName": "Action corrective",
          "displayNamePlural": "Actions correctives",
          "icon": "check",
          "fields": [
            {
              "key": "reclamation",
              "label": "Réclamation",
              "type": "relation",
              "required": true,
              "unique": false,
              "relationTo": "reclamations"
            },
            {
              "key": "description",
              "label": "Description",
              "type": "text",
              "required": true,
              "unique": false
            },
            {
              "key": "responsable",
              "label": "Responsable",
              "type": "text",
              "required": false,
              "unique": false
            },
            {
              "key": "date_limite",
              "label": "Date limite",
              "type": "date",
              "required": false,
              "unique": false
            },
            {
              "key": "terminee",
              "label": "Terminée",
              "type": "boolean",
              "required": false,
              "unique": false
            }
          ],
          "form": {
            "sections": [
              {
                "title": "Action corrective",
                "fields": [
                  {
                    "field": "reclamation"
                  },
                  {
                    "field": "description"
                  },
                  {
                    "field": "responsable",
                    "width": "half"
                  },
                  {
                    "field": "date_limite",
                    "width": "half"
                  },
                  {
                    "field": "terminee"
                  }
                ]
              }
            ]
          }
        }
      ],
      "seed": [
        {
          "entityRef": "motifs",
          "records": [
            {
              "libelle": "Retard de livraison"
            },
            {
              "libelle": "Produit défectueux"
            },
            {
              "libelle": "Erreur de facturation"
            },
            {
              "libelle": "Qualité de service"
            }
          ]
        }
      ]
    }
    """;

    [Fact]
    public void CanonicalSystem_on_suivi_reclamations_template_matches_golden_output()
    {
        var template = StudioTemplateCatalog.TryGet("suivi-reclamations");
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        var canonical = StudioAiSpecCanonical.CanonicalSystem(spec!);

        // Repli LF des deux côtés : la constante survivrait à une conversion CRLF du fichier au checkout Windows,
        // et WriteIndented émet Environment.NewLine (CRLF sur l'agent CI Windows). La forme (clés, ordre, indentation) reste comparée à l'octet près.
        Assert.Equal(
            SuiviReclamationsCanonicalGolden.Replace("\r\n", "\n"),
            canonical.Replace("\r\n", "\n"));
    }

    /// <summary>Spec telle que le LLM la produit (anglais, clés dans le désordre).</summary>
    private const string WorkflowSpecEnglish = """
    { "workflows": [
        { "entityKey": "invoices", "key": "relance", "name": "Relance", "description": "Après échéance.",
          "trigger": "manual", "triggerConfig": {},
          "steps": [ { "key": "s1", "type": "notify", "label": "Prévenir", "title": "T", "to": { "kind": "startedBy" } } ] },
        { "entityKey": "clients", "key": "accueil", "name": "Accueil", "trigger": "on_create",
          "steps": [ { "type": "wait", "hours": 2 } ] } ] }
    """;

    /// <summary>La MÊME spec avec alias FR/accents, ordre différent et clés d'étape dérivées.</summary>
    private const string WorkflowSpecFrenchAliases = """
    { "automatisations": [
        { "entite": "Clients", "cle": "accueil", "nom": "Accueil", "déclencheur": "creation",
          "etapes": [ { "type": "attendre", "heures": 2 } ] },
        { "table": "invoices", "key": "relance", "nom": "Relance", "description": "Après échéance.",
          "trigger": "manuel", "config": {},
          "steps": [ { "label": "Prévenir", "type": "notifier", "titre": "T", "destinataire": { "kind": "startedBy" }, "key": "s1" } ] } ] }
    """;

    /// <summary>Forme canonique attendue, en dur : tri entityKey puis key, clés triées récursivement.</summary>
    private const string WorkflowCanonicalGolden = """
    {
      "workflows": [
        {
          "entityKey": "clients",
          "key": "accueil",
          "name": "Accueil",
          "trigger": "on_create",
          "triggerConfig": {},
          "steps": {
            "steps": [
              {
                "hours": 2,
                "key": "etape_1",
                "type": "wait"
              }
            ],
            "version": 1
          },
          "isActive": false
        },
        {
          "entityKey": "invoices",
          "key": "relance",
          "name": "Relance",
          "description": "Après échéance.",
          "trigger": "manual",
          "triggerConfig": {},
          "steps": {
            "steps": [
              {
                "key": "s1",
                "label": "Prévenir",
                "title": "T",
                "to": {
                  "kind": "startedBy"
                },
                "type": "notify"
              }
            ],
            "version": 1
          },
          "isActive": false
        }
      ]
    }
    """;

    /// <summary>
    /// PR 4.3 : deux specs équivalentes (alias ≠, ordre ≠, espaces ≠, clés d'étape dérivées ou non)
    /// produisent la MÊME forme canonique, à l'octet près (clé du cache d'aperçu et forme rejouée en 4.3f).
    /// </summary>
    [Fact]
    public void CanonicalWorkflow_is_byte_stable_for_equivalent_specs()
    {
        var canonical1 = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Workflow, WorkflowSpecEnglish, out var e1);
        var canonical2 = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Workflow, WorkflowSpecFrenchAliases, out var e2);

        Assert.Null(e1);
        Assert.Null(e2);
        Assert.NotNull(canonical1);
        Assert.Equal(canonical1, canonical2);
        // Repli LF des deux côtés (motif suivi-reclamations) : WriteIndented émet Environment.NewLine.
        Assert.Equal(
            WorkflowCanonicalGolden.Replace("\r\n", "\n"),
            canonical1!.Replace("\r\n", "\n"));
    }

    /// <summary>PR 4.3 : une spec workflows invalide ⇒ null + erreur en clair (jamais de canonique partielle).</summary>
    [Fact]
    public void CanonicalFor_Workflow_returns_null_and_error_on_invalid_spec()
    {
        var result = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.Workflow, "{ \"workflows\": [] }", out var error);

        Assert.Null(result);
        Assert.NotNull(error);
    }
}
