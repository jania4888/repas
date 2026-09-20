using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Templates;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Contrat du catalogue de modèles embarqués (B-P0-06/B-P0-07) : chaque spec JSON livrée doit être
/// analysable par le parseur système actuel, respecter toutes les bornes (≤ 8 entités, ≤ 40 champs,
/// ≤ 200 fiches de seed), garder des clés stables (le <c>key</c> explicite de chaque champ coïncide
/// avec la clé dérivée du libellé, en attendant la prise en charge de la clé explicite par B-P0-02)
/// et produire un résumé d'aperçu sans erreur.
/// </summary>
public sealed class StudioTemplateCatalogTests
{
    private static readonly string[] ExpectedKeys =
    {
        "gestion-conges", "gestion-contrats", "suivi-equipements", "gestion-interventions",
        "gestion-leads", "catalogue-produits", "gestion-formations", "suivi-reclamations",
        "gestion-projets", "gestion-evenements"
    };

    public static IEnumerable<object[]> TemplateKeys =>
        StudioTemplateCatalog.All.Select(t => new object[] { t.Key });

    [Fact]
    public void Catalog_lists_exactly_the_ten_builtin_templates()
    {
        Assert.Equal(10, StudioTemplateCatalog.All.Count);
        Assert.Equal(
            ExpectedKeys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
            StudioTemplateCatalog.All.Select(t => t.Key).OrderBy(k => k, StringComparer.Ordinal).ToArray());
    }

    [Theory]
    [MemberData(nameof(TemplateKeys))]
    public void Every_builtin_template_parses_with_system_spec(string key)
    {
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);

        var ok = StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error);
        Assert.True(ok, error);
        Assert.NotNull(spec);
        Assert.Equal(template.DisplayName, spec!.SystemDisplayName);
        Assert.NotEmpty(template.Description);
        Assert.NotEmpty(template.Category);
        Assert.NotEmpty(template.ModuleTag);
    }

    [Fact]
    public void Builtin_template_keys_are_unique_and_url_safe()
    {
        var keys = StudioTemplateCatalog.All.Select(t => t.Key).ToList();
        Assert.Equal(keys.Count, keys.Distinct(StringComparer.Ordinal).Count());
        foreach (var key in keys)
        {
            Assert.False(string.IsNullOrWhiteSpace(key));
            Assert.Equal(key, key.ToLowerInvariant());
            Assert.DoesNotContain(' ', key);
        }
    }

    [Theory]
    [MemberData(nameof(TemplateKeys))]
    public void Builtin_templates_stay_under_spec_bounds(string key)
    {
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        Assert.InRange(spec!.Entities.Count, 1, StudioAiSystemSpec.MaxEntities);
        foreach (var entity in spec.Entities)
            Assert.InRange(entity.Fields.Count, 1, StudioAiAppSpec.MaxFields);

        var seedCount = spec.Seed.Sum(s => s.Records.Count);
        Assert.InRange(seedCount, 0, StudioAiSystemSpec.MaxSeedRecords);
    }

    [Theory]
    [MemberData(nameof(TemplateKeys))]
    public void Entity_refs_and_field_keys_have_valid_studio_key_shape(string key)
    {
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        var refs = spec!.Entities.Select(e => e.Ref).ToHashSet(StringComparer.Ordinal);
        foreach (var entity in spec.Entities)
        {
            Assert.True(StudioKey.IsValidShape(entity.Ref), $"Référence d'entité invalide : « {entity.Ref} ».");
            foreach (var field in entity.Fields)
            {
                Assert.True(StudioKey.IsValidShape(field.Key), $"Clé de champ invalide : « {field.Key} ».");
                Assert.False(StudioKey.IsReservedFieldKey(field.Key), $"Clé de champ réservée : « {field.Key} ».");
            }
        }

        // Chaque modèle expose au moins une relation, un formulaire et un état (esquisse B-P0-07).
        Assert.Contains(spec.Entities, e => e.Fields.Any(f =>
            f.FieldType is CustomFieldType.RelationCustom or CustomFieldType.RelationExisting));
        Assert.Contains(spec.Entities, e => e.Form is not null);
        Assert.Contains(spec.Entities, e => e.Report is not null);

        // Cibles de relation : référence de la spec ou source ERP en liste blanche (clients/products).
        foreach (var field in spec.Entities.SelectMany(e => e.Fields))
        {
            if (field.FieldType == CustomFieldType.RelationCustom)
                Assert.True(field.RelationToRef is not null && refs.Contains(field.RelationToRef),
                    $"Cible de relation hors spec : « {field.RelationToRef} ».");
            else if (field.FieldType == CustomFieldType.RelationExisting)
                Assert.True(ExistingRelationSources.IsRelationTarget(field.RelationToRef!),
                    $"Cible ERP inconnue : « {field.RelationToRef} ».");
        }
    }

    [Theory]
    [MemberData(nameof(TemplateKeys))]
    public void Explicit_field_keys_match_parser_derived_keys(string key)
    {
        // Aujourd'hui le parseur dérive la clé du libellé ; le « key » explicite écrit dans chaque
        // modèle doit lui être identique pour rester stable quand B-P0-02 le lira (les références
        // de formulaire, d'état et de seed s'appuient sur ces clés).
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        var root = JsonNode.Parse(template.SpecJson)!.AsObject();
        var rawEntities = root["entities"]!.AsArray();
        Assert.Equal(rawEntities.Count, spec!.Entities.Count);

        for (var i = 0; i < rawEntities.Count; i++)
        {
            var rawFields = rawEntities[i]!["fields"]!.AsArray();
            var parsedFields = spec.Entities[i].Fields;
            Assert.Equal(rawFields.Count, parsedFields.Count);
            for (var j = 0; j < rawFields.Count; j++)
            {
                var explicitKey = rawFields[j]!["key"]?.GetValue<string>();
                Assert.False(string.IsNullOrWhiteSpace(explicitKey));
                Assert.Equal(explicitKey, parsedFields[j].Key);
            }
        }

        // Les clés des fiches de seed visent toutes des champs existants (rien n'est ignoré au seeding).
        foreach (var batch in spec.Seed)
        {
            var entity = spec.Entities.First(e => e.Ref == batch.EntityRef);
            var fieldKeys = entity.Fields.Select(f => f.Key).ToHashSet(StringComparer.Ordinal);
            foreach (var record in batch.Records)
            {
                Assert.NotEmpty(record);
                foreach (var recordKey in record.Keys)
                    Assert.Contains(recordKey, fieldKeys);
            }
        }
    }

    [Theory]
    [MemberData(nameof(TemplateKeys))]
    public void Builtin_templates_stay_under_relation_and_view_bounds(string key)
    {
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        Assert.InRange(spec!.Relations.Count, 0, StudioAiSystemSpec.MaxRelations);
        foreach (var entity in spec.Entities)
            Assert.InRange(entity.Views.Count, 0, StudioAiSystemSpec.MaxViewsPerEntity);

        // Un avertissement = alias non résolu, relation ou vue ignorée : le JSON du modèle doit être corrigé.
        Assert.Empty(spec.Warnings ?? Array.Empty<string>());
    }

    [Fact]
    public void Gestion_projets_template_declares_team_relation_and_kanban_calendar_list_views()
    {
        var template = StudioTemplateCatalog.TryGet("gestion-projets");
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        Assert.Equal(4, spec!.Entities.Count);
        var relation = Assert.Single(spec.Relations);
        Assert.Equal("many_to_many", relation.Kind);
        Assert.Equal("membres", relation.FromRef);
        Assert.Equal("projets", relation.ToRef);
        Assert.Equal("Équipe", relation.Label);
        Assert.Equal("Équipe projet", relation.JunctionName);

        var modes = spec.Entities.SelectMany(e => e.Views)
            .Select(v => v.Mode).ToHashSet(StringComparer.Ordinal);
        Assert.Superset(new HashSet<string> { "kanban", "calendar", "list" }, modes);
        Assert.Equal(4, spec.Entities.Sum(e => e.Views.Count));

        var taches = spec.Entities.Single(e => e.Ref == "taches");
        Assert.Equal(2, taches.Views.Count);
        Assert.NotNull(taches.Report);

        var jalons = spec.Entities.Single(e => e.Ref == "jalons");
        var calendar = Assert.Single(jalons.Views);
        Assert.Equal("calendar", calendar.Mode);
        Assert.Equal("date_prevue", calendar.StartFieldKey);
        Assert.Equal("titre", calendar.TitleFieldKey);

        // Seed sans valeur de relation : « client » (relation ERP) n'est jamais préchargé.
        Assert.Equal(5, spec.Seed.Sum(s => s.Records.Count));
        Assert.DoesNotContain(spec.Seed.Single(s => s.EntityRef == "projets").Records, r => r.ContainsKey("client"));
    }

    [Fact]
    public void Gestion_evenements_template_declares_inscriptions_relation_and_agenda_view()
    {
        var template = StudioTemplateCatalog.TryGet("gestion-evenements");
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        Assert.Equal(3, spec!.Entities.Count);
        var relation = Assert.Single(spec.Relations);
        Assert.Equal("participants", relation.FromRef);
        Assert.Equal("evenements", relation.ToRef);
        Assert.Equal("Inscriptions", relation.Label);
        Assert.Equal("Inscriptions", relation.JunctionName);

        var evenements = spec.Entities.Single(e => e.Ref == "evenements");
        var agenda = Assert.Single(evenements.Views, v => v.Mode == "calendar");
        Assert.Equal("Agenda", agenda.DisplayName);
        Assert.Equal("date_debut", agenda.StartFieldKey);
        Assert.Equal("date_fin", agenda.EndFieldKey);
        Assert.Equal("titre", agenda.TitleFieldKey);
        Assert.True(agenda.IsDefault);
        Assert.NotNull(evenements.Report);
        Assert.Equal(3, spec.Entities.Sum(e => e.Views.Count));
    }

    [Fact]
    public void Stats_count_entities_relations_and_distinct_view_modes()
    {
        // Spec synthétique : 2 entités, 1 relation, vues kanban + kanban + list ⇒ modes distincts dans l'ordre d'apparition.
        const string json = """
        {
          "system": { "displayName": "Stats" },
          "entities": [
            {
              "ref": "taches", "displayName": "Tâche", "displayNamePlural": "Tâches",
              "fields": [ { "label": "Nom", "type": "text" }, { "label": "Statut", "type": "select", "options": [ "x", "y" ] } ],
              "views": [
                { "name": "K1", "mode": "kanban", "groupBy": "statut" },
                { "name": "K2", "mode": "kanban", "groupBy": "statut" }
              ]
            },
            {
              "ref": "projets", "displayName": "Projet", "displayNamePlural": "Projets",
              "fields": [ { "label": "Titre", "type": "text" } ],
              "views": [ { "name": "L", "mode": "list", "columns": [ "titre" ] } ]
            }
          ],
          "relations": [ { "kind": "many_to_many", "from": "taches", "to": "projets", "label": "Lien" } ]
        }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);
        Assert.Empty(spec!.Warnings ?? Array.Empty<string>());

        var stats = StudioTemplateCatalog.ComputeStats(spec);

        Assert.Equal(2, stats.EntityCount);
        Assert.Equal(1, stats.RelationCount);
        Assert.Equal(new[] { "kanban", "list" }, stats.ViewModes);
    }

    [Fact]
    public void Enriched_templates_expose_expected_relation_and_view_modes()
    {
        var formations = StudioTemplateCatalog.TryGet("gestion-formations");
        Assert.NotNull(formations);
        Assert.Equal(4, formations!.Stats.EntityCount);
        Assert.Equal(1, formations.Stats.RelationCount);
        Assert.Superset(new HashSet<string> { "kanban", "calendar" }, formations.Stats.ViewModes.ToHashSet(StringComparer.Ordinal));
        Assert.True(StudioAiSystemSpec.TryParse(formations.SpecJson, out var formationsSpec, out var formationsError), formationsError);
        var participations = Assert.Single(formationsSpec!.Relations);
        Assert.Equal("employes", participations.FromRef);
        Assert.Equal("formations", participations.ToRef);
        Assert.Equal("Participants", participations.Label);
        Assert.Equal("Participations", participations.JunctionName);
        var participant = formationsSpec.Entities.Single(e => e.Ref == "inscriptions").Fields.Single(f => f.Key == "participant");
        Assert.Equal(CustomFieldType.RelationCustom, participant.FieldType);
        Assert.Equal("employes", participant.RelationToRef);

        var interventions = StudioTemplateCatalog.TryGet("gestion-interventions");
        Assert.NotNull(interventions);
        Assert.Equal(0, interventions!.Stats.RelationCount);
        Assert.Equal(new[] { "calendar", "kanban" }, interventions.Stats.ViewModes);

        var reclamations = StudioTemplateCatalog.TryGet("suivi-reclamations");
        Assert.NotNull(reclamations);
        Assert.Equal(0, reclamations!.Stats.RelationCount);
        Assert.Equal(new[] { "kanban", "list" }, reclamations.Stats.ViewModes);
        Assert.True(StudioAiSystemSpec.TryParse(reclamations.SpecJson, out var reclamationsSpec, out var reclamationsError), reclamationsError);
        var ouvertes = reclamationsSpec!.Entities.Single(e => e.Ref == "reclamations").Views.Single(v => v.DisplayName == "Ouvertes");
        Assert.Equal("list", ouvertes.Mode);
        Assert.True(ouvertes.IsDefault);
        var filter = Assert.Single(ouvertes.Filters);
        Assert.Equal("statut", filter.FieldKey);
        Assert.Equal("neq", filter.Op);
        Assert.Equal("cloturee", filter.Value?.GetValue<string>());
    }

    [Theory]
    [InlineData("gestion-formations")]
    [InlineData("gestion-interventions")]
    [InlineData("suivi-reclamations")]
    [InlineData("gestion-projets")]
    [InlineData("gestion-evenements")]
    public void Every_builtin_template_exposes_at_least_one_view_or_relation(string key)
    {
        // Périmètre 3.3e1/3.3e2 : les 5 modèles enrichis ou nouveaux ; les 5 autres restent hors périmètre.
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        // Les stats portées par le catalogue sont bien celles recalculées depuis la spec.
        var recomputed = StudioTemplateCatalog.ComputeStats(spec!);
        Assert.Equal(recomputed.EntityCount, template.Stats.EntityCount);
        Assert.Equal(recomputed.RelationCount, template.Stats.RelationCount);
        Assert.Equal(recomputed.ViewModes, template.Stats.ViewModes);
        Assert.True(template.Stats.RelationCount > 0 || template.Stats.ViewModes.Count > 0,
            $"Le modèle « {key} » n'expose ni relation ni vue.");
    }

    [Fact]
    public void Catalog_is_sorted_by_category_then_display_name()
    {
        var expected = StudioTemplateCatalog.All
            .OrderBy(t => t.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(t => t.Key)
            .ToArray();
        Assert.Equal(expected, StudioTemplateCatalog.All.Select(t => t.Key).ToArray());
    }

    [Theory]
    [MemberData(nameof(TemplateKeys))]
    public void TryGet_round_trips_each_template(string key)
    {
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);
        Assert.Equal(key, template!.Key);
        Assert.False(string.IsNullOrWhiteSpace(template.SpecJson));

        // Recherche insensible à la casse et tolérante aux espaces.
        var upper = StudioTemplateCatalog.TryGet($"  {key.ToUpperInvariant()}  ");
        Assert.NotNull(upper);
        Assert.Equal(template, upper);
    }

    [Theory]
    [InlineData("inconnu")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void TryGet_unknown_key_returns_null(string? key)
    {
        Assert.Null(StudioTemplateCatalog.TryGet(key));
    }

    [Theory]
    [MemberData(nameof(TemplateKeys))]
    public void Summary_via_plan_summary_does_not_throw(string key)
    {
        var template = StudioTemplateCatalog.TryGet(key);
        Assert.NotNull(template);
        Assert.True(StudioAiSystemSpec.TryParse(template!.SpecJson, out var spec, out var error), error);

        var summaryJson = StudioAiPlanSummary.ForSystem(spec!);
        Assert.False(string.IsNullOrWhiteSpace(summaryJson));

        using var doc = JsonDocument.Parse(summaryJson);
        Assert.Equal(spec!.SystemDisplayName, doc.RootElement.GetProperty("title").GetString());
        Assert.Equal(spec.Entities.Count, doc.RootElement.GetProperty("entities").GetArrayLength());
    }
}
