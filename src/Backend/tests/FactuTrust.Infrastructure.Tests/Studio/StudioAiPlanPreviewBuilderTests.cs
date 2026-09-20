using System.Text.Json;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Aperçu structuré d'un plan Studio IA (PR 3.2b) : projection PURE de la spec persistée vers
/// <c>StudioAiPlanPreviewDto</c> — entités/relations/formulaires/vues/seed pour les créations,
/// diff du planificateur pour les amendements (dégradé sans schéma), titre + avertissements pour
/// fenêtres/états/vues enregistrées. Déterminisme prouvé ; <c>workflows</c> toujours vide (§12).
/// </summary>
public sealed class StudioAiPlanPreviewBuilderTests
{
    private static readonly Guid PlanId = Guid.NewGuid();

    private const string SystemSpecJson = """
        { "system": { "displayName": "RH" }, "entities": [
          { "ref": "employes", "displayName": "Employés", "fields": [
            { "label": "Nom", "type": "text", "required": true, "unique": true },
            { "label": "Date de naissance", "type": "date" },
            { "label": "Statut", "type": "select", "options": ["Actif", "Inactif"] }
          ],
          "form": { "sections": [
            { "title": "Général", "fields": [ "nom", { "field": "date_de_naissance", "width": "half" } ] },
            { "fields": [ "statut" ] }
          ] },
          "views": [ { "name": "Par statut", "mode": "list", "columns": ["nom", "statut"] } ] },
          { "ref": "formations", "displayName": "Formations", "fields": [
            { "label": "Libellé", "type": "text" }
          ] }
        ],
        "relations": [ { "kind": "many_to_many", "from": "employes", "to": "formations",
          "label": "Formations suivies", "junctionName": "Inscriptions" } ],
        "seed": [ { "entityRef": "formations", "records": [
          { "libelle": "Angular" }, { "libelle": "React" }, { "libelle": "Vue" }, { "libelle": "Svelte" }
        ] } ] }
        """;

    private const string SystemSummaryJson = """
        { "kind": "CreateSystem", "title": "Gestion RH", "steps": [],
          "entities": [ { "displayName": "Employés", "fieldCount": 3 }, { "displayName": "Formations", "fieldCount": 1 } ],
          "warnings": ["Avertissement de test."],
          "duplicates": [ { "specRef": "employes", "specDisplayName": "Employés",
            "existingKey": "salaries", "existingDisplayName": "Salariés", "reason": "same_name" } ],
          "relations": [] }
        """;

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

    [Fact]
    public void Build_system_maps_entities_relations_form_layout_and_seed_sample()
    {
        var result = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.CreateSystem, "Pending", SystemSpecJson, SystemSummaryJson,
            schema: null, manyToManyEnabled: true, recordViewsEnabled: true);

        Assert.True(result.IsSuccess, result.Error.Description);
        var dto = result.Value;
        Assert.Equal(PlanId, dto.PlanId);
        Assert.Equal("CreateSystem", dto.Kind);
        Assert.Equal("Pending", dto.Status);
        Assert.Equal("Gestion RH", dto.Title);                  // titre du summary, pas celui de la spec
        Assert.Equal(new[] { "Avertissement de test." }, dto.Warnings);
        var duplicate = Assert.Single(dto.Duplicates);
        Assert.Equal("employes", duplicate.SpecRef);
        Assert.Equal("salaries", duplicate.ExistingKey);
        Assert.Equal("same_name", duplicate.Reason);
        Assert.Null(dto.Amendment);
        Assert.Empty(dto.Workflows);

        // --- Entités ---
        Assert.Equal(2, dto.Entities.Count);
        var employes = dto.Entities[0];
        Assert.Equal("employes", employes.Ref);
        Assert.Equal("Employés", employes.DisplayName);
        Assert.Null(employes.ExistingKey);
        Assert.Equal(3, employes.Fields.Count);
        Assert.Equal(new PreviewField("nom", "Nom", "Text", true, true, null, null), employes.Fields[0]);
        var statut = employes.Fields[2];
        Assert.Equal("statut", statut.Key);
        Assert.Equal("Statut", statut.Label);
        Assert.Equal("Select", statut.FieldType);
        Assert.False(statut.Required);
        Assert.False(statut.Unique);
        Assert.Equal(new[] { "Actif", "Inactif" }, statut.Options); // libellés des choix
        Assert.Null(statut.RelationToRef);

        // --- Formulaire (E2 : objets {key, width, labelOverride}) ---
        Assert.NotNull(employes.FormLayout);
        Assert.Equal(2, employes.FormLayout!.Sections.Count);
        Assert.Equal("Général", employes.FormLayout.Sections[0].Title);
        Assert.Equal(
            new[] { new PreviewFormFieldRef("nom", null, null), new PreviewFormFieldRef("date_de_naissance", "half", null) },
            employes.FormLayout.Sections[0].Fields);
        Assert.Equal(string.Empty, employes.FormLayout.Sections[1].Title); // section sans titre ⇒ ""
        Assert.Equal(new PreviewFormFieldRef("statut", null, null), Assert.Single(employes.FormLayout.Sections[1].Fields));

        // --- Vues proposées ---
        Assert.Equal(new PreviewView("list", "Par statut"), Assert.Single(employes.Views));

        // --- Seed : compteur complet, échantillon borné à 3 dans l'ordre de la spec ---
        Assert.Equal(0, employes.SeedCount);
        Assert.Empty(employes.SeedSample);
        var formations = dto.Entities[1];
        Assert.Equal(4, formations.SeedCount);
        Assert.Equal(StudioAiSeedSampler.MaxSampleRows, formations.SeedSample.Count);
        Assert.Equal(new[] { "Angular", "React", "Vue" }, formations.SeedSample.Select(r => r["libelle"]).ToArray());

        // --- Relations ---
        var relation = Assert.Single(dto.Relations);
        Assert.Equal(new PreviewRelation("many_to_many", "employes", "formations", "Formations suivies", "Inscriptions"), relation);
    }

    [Fact]
    public void Build_app_yields_single_entity()
    {
        const string specJson = """
            { "entity": { "displayName": "Contrats clients", "icon": "fa-solid fa-file-contract" },
              "fields": [
                { "label": "Montant", "type": "money", "required": true },
                { "label": "Statut", "type": "select", "options": [ {"value":"actif","label":"Actif"}, {"value":"expire","label":"Expiré"} ] }
              ] }
            """;

        var result = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.CreateApp, "Pending", specJson, summaryJson: null,
            schema: null, manyToManyEnabled: false, recordViewsEnabled: false);

        Assert.True(result.IsSuccess, result.Error.Description);
        var dto = result.Value;
        Assert.Equal("CreateApp", dto.Kind);
        Assert.Equal("Contrats clients", dto.Title);            // repli sur la spec (pas de summary)
        Assert.Empty(dto.Warnings);
        Assert.Empty(dto.Duplicates);                           // absent du summary ⇒ []
        var entity = Assert.Single(dto.Entities);
        Assert.Equal("contrats_clients", entity.Ref);           // slug accent-plié du nom
        Assert.Equal("Contrats clients", entity.DisplayName);
        Assert.Null(entity.ExistingKey);
        Assert.Equal(2, entity.Fields.Count);
        Assert.Equal(new PreviewField("montant", "Montant", "Money", true, false, null, null), entity.Fields[0]);
        Assert.Equal(new[] { "Actif", "Expiré" }, entity.Fields[1].Options);
        Assert.Null(entity.FormLayout);
        Assert.Empty(entity.Views);
        Assert.Equal(0, entity.SeedCount);
        Assert.Empty(entity.SeedSample);
        Assert.Empty(dto.Relations);
        Assert.Null(dto.Amendment);
    }

    [Fact]
    public void Build_amendment_with_schema_uses_planner_items()
    {
        const string specJson = """
            { "target": { "entityKey": "contrats" }, "operations": [
              { "op": "add_field", "label": "Motif de refus", "type": "multilinetext", "required": true },
              { "op": "remove_field", "key": "statut" } ] }
            """;

        var result = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.Amendment, "Pending", specJson, summaryJson: null,
            Schema(), manyToManyEnabled: true, recordViewsEnabled: true);

        Assert.True(result.IsSuccess, result.Error.Description);
        var dto = result.Value;
        Assert.Equal("Amendment", dto.Kind);
        Assert.Empty(dto.Entities);
        Assert.Empty(dto.Relations);
        Assert.Equal("Contrat", dto.Title);                     // repli : nom réel de la table
        Assert.Empty(dto.Warnings);

        Assert.NotNull(dto.Amendment);
        var amendment = dto.Amendment!;
        Assert.False(amendment.Degraded);
        Assert.Equal("contrats", amendment.TargetEntityRef);
        Assert.Equal("contrats", amendment.EntityKey);
        Assert.Equal("Contrat", amendment.EntityDisplayName);
        Assert.Equal(2, amendment.Items.Count);
        Assert.Equal(new PreviewAmendmentItem("add_field", "Motif de refus", null, amendment.Items[0].After, "info", null),
            amendment.Items[0]);
        Assert.Contains("texte long", amendment.Items[0].After);
        var remove = amendment.Items[1];
        Assert.Equal("remove_field", remove.Op);
        Assert.Equal("Statut", remove.Target);
        Assert.Equal("warning", remove.Severity);
        Assert.Contains("CONSERVÉES", remove.Warning);
    }

    [Fact]
    public void Build_amendment_without_schema_is_degraded_with_one_item_per_op_for_all_twelve_ops()
    {
        const string specJson = """
            { "target": { "entityKey": "interventions" }, "operations": [
              { "op": "add_field", "label": "Motif de refus", "type": "multilinetext", "required": true },
              { "op": "update_field", "key": "statut", "required": true },
              { "op": "remove_field", "key": "obsolete" },
              { "op": "update_entity", "displayName": "Contrats clients" },
              { "op": "set_form", "sections": [ { "title": "Général", "fields": ["statut"] } ] },
              { "op": "set_report", "displayName": "Par statut", "definition": { "groupBy": ["statut"] } },
              { "op": "reorder_fields", "fields": ["reference", "client", "statut"] },
              { "op": "change_field_type", "key": "duree_estimee", "type": "decimal" },
              { "op": "add_relation", "kind": "many_to_many", "target": "Compétences", "label": "Compétences requises" },
              { "op": "assign_system", "system": "Gestion Interventions" },
              { "op": "set_view", "mode": "kanban", "displayName": "Kanban par statut", "groupBy": "statut" },
              { "op": "set_automation", "trigger": "on_create", "action": "notify" }
            ] }
            """;

        var result = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.Amendment, "Pending", specJson, summaryJson: null,
            schema: null, manyToManyEnabled: false, recordViewsEnabled: false);

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.NotNull(result.Value.Amendment);
        var amendment = result.Value.Amendment!;
        Assert.True(amendment.Degraded);
        Assert.Equal("interventions", amendment.TargetEntityRef);
        Assert.Null(amendment.EntityKey);
        Assert.Null(amendment.EntityDisplayName);
        Assert.Equal("interventions", result.Value.Title);      // repli : ref brute de la spec

        // Un item par opération, dans l'ordre de la spec, pour les 12 opérations connues (C-B8).
        Assert.Equal(12, amendment.Items.Count);
        Assert.Equal(
            new[]
            {
                "add_field", "update_field", "remove_field", "update_entity", "set_form", "set_report",
                "reorder_fields", "change_field_type", "add_relation", "assign_system", "set_view", "set_automation"
            },
            amendment.Items.Select(i => i.Op).ToArray());
        Assert.All(amendment.Items, item =>
        {
            Assert.Equal("info", item.Severity);
            Assert.Equal(StudioAiPlanPreviewBuilder.DegradedAmendmentWarning, item.Warning);
            Assert.Null(item.Before);
            Assert.Null(item.After);
        });
        // Cibles au mieux depuis la spec brute.
        Assert.Equal("Motif de refus", amendment.Items[0].Target);
        Assert.Equal("reference, client, statut", amendment.Items[6].Target);
        Assert.Equal("competences", amendment.Items[8].Target);
        Assert.Equal("Kanban par statut", amendment.Items[10].Target);
    }

    // ---- Fenêtre / état / vue enregistrée : zéro entité, titre + avertissements ----

    public static TheoryData<StudioAiPlanKind, string, string?, string, int> LeafSpecs => new()
    {
        // Fenêtre : summary null à la création (E1) ⇒ titre + avertissements relus de la spec.
        {
            StudioAiPlanKind.View,
            """{ "title": "Factures fournisseurs", "table": "supplier_invoices", "columns": [ "number", "colonne fantôme!" ] }""",
            null, "Factures fournisseurs", 1
        },
        // État : preset inconnu ⇒ avertissement de parsing, sans échec.
        {
            StudioAiPlanKind.Report,
            """{ "title": "Ventes T1", "preset": "ventes_par_licorne", "source": "InvoiceLines" }""",
            null, "Ventes T1", 1
        },
        // Vue enregistrée : un summary existe (E1) ⇒ titre + avertissements relus du summary.
        {
            StudioAiPlanKind.RecordView,
            """{ "entity": "contrats", "name": "Kanban par statut", "mode": "kanban", "groupBy": "statut" }""",
            """{ "kind": "RecordView", "title": "Kanban des contrats", "warnings": ["Colonne inconnue retirée."], "duplicates": [] }""",
            "Kanban des contrats", 1
        }
    };

    [Theory]
    [MemberData(nameof(LeafSpecs))]
    public void Build_view_report_recordview_have_no_entities_but_title_and_warnings(
        StudioAiPlanKind kind, string specJson, string? summaryJson, string expectedTitle, int expectedWarnings)
    {
        var result = StudioAiPlanPreviewBuilder.Build(
            PlanId, kind, "Completed", specJson, summaryJson,
            schema: null, manyToManyEnabled: false, recordViewsEnabled: false);

        Assert.True(result.IsSuccess, result.Error.Description);
        var dto = result.Value;
        Assert.Equal(kind.ToString(), dto.Kind);
        Assert.Empty(dto.Entities);
        Assert.Empty(dto.Relations);
        Assert.Null(dto.Amendment);
        Assert.Equal(expectedTitle, dto.Title);
        Assert.Equal(expectedWarnings, dto.Warnings.Count);
        Assert.All(dto.Warnings, w => Assert.False(string.IsNullOrWhiteSpace(w)));
        Assert.Empty(dto.Duplicates);
        Assert.Empty(dto.Workflows);
    }

    [Fact]
    public void Build_invalid_spec_returns_validation_spec_error()
    {
        // JSON illisible (CreateSystem).
        var system = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.CreateSystem, "Pending", "{ pas du json", null, null, false, false);
        Assert.True(system.IsFailure);
        Assert.Equal("Validation.spec", system.Error.Code);
        Assert.False(string.IsNullOrWhiteSpace(system.Error.Description));

        // Cible absente (Amendment).
        var amendment = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.Amendment, "Pending", """{ "operations": [ { "op": "update_entity" } ] }""",
            null, null, false, false);
        Assert.True(amendment.IsFailure);
        Assert.Equal("Validation.spec", amendment.Error.Code);

        // Libellé de vue obligatoire absent (RecordView).
        var recordView = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.RecordView, "Pending", """{ "entity": "contrats", "mode": "list" }""",
            null, null, false, false);
        Assert.True(recordView.IsFailure);
        Assert.Equal("Validation.spec", recordView.Error.Code);
    }

    [Fact]
    public void Build_is_deterministic_same_json_twice()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var first = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.CreateSystem, "Pending", SystemSpecJson, SystemSummaryJson, null, true, true);
        var second = StudioAiPlanPreviewBuilder.Build(
            PlanId, StudioAiPlanKind.CreateSystem, "Pending", SystemSpecJson, SystemSummaryJson, null, true, true);

        Assert.True(first.IsSuccess && second.IsSuccess);
        var firstJson = JsonSerializer.Serialize(first.Value, options);
        Assert.Equal(firstJson, JsonSerializer.Serialize(second.Value, options));
        // Contrat camelCase figé (§12) : clés en minuscules, workflows toujours présent et vide.
        Assert.Contains("\"seedSample\"", firstJson);
        Assert.Contains("\"formLayout\"", firstJson);
        Assert.Contains("\"workflows\":[]", firstJson);
    }

    // ---- workflows : toujours [] en 3.x, quelle que soit la nature du plan (contrat §12) ----

    public static TheoryData<StudioAiPlanKind, string> AllKindSpecs => new()
    {
        {
            StudioAiPlanKind.CreateSystem,
            """{ "system": { "displayName": "T" }, "entities": [ { "ref": "a", "displayName": "A", "fields": [ { "label": "Nom" } ] } ] }"""
        },
        {
            StudioAiPlanKind.CreateApp,
            """{ "entity": { "displayName": "Contrats" }, "fields": [ { "label": "Nom" } ] }"""
        },
        {
            StudioAiPlanKind.Amendment,
            """{ "target": { "entityKey": "contrats" }, "operations": [ { "op": "update_entity", "displayName": "X" } ] }"""
        },
        {
            StudioAiPlanKind.View,
            """{ "title": "T", "table": "supplier_invoices" }"""
        },
        {
            StudioAiPlanKind.Report,
            """{ "title": "CA", "preset": "ventes_par_produit" }"""
        },
        {
            StudioAiPlanKind.RecordView,
            """{ "entity": "contrats", "name": "Toutes", "mode": "list" }"""
        }
    };

    [Theory]
    [MemberData(nameof(AllKindSpecs))]
    public void Build_workflows_always_empty(StudioAiPlanKind kind, string specJson)
    {
        // Amendement couvert ici SANS schéma (dégradé) : workflows reste vide aussi.
        var result = StudioAiPlanPreviewBuilder.Build(
            PlanId, kind, "Pending", specJson, summaryJson: null,
            schema: null, manyToManyEnabled: true, recordViewsEnabled: true);

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.Empty(result.Value.Workflows);
    }
}
