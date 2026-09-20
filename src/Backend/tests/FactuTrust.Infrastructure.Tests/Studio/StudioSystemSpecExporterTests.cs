using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Systems;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Export pur d'un système Studio (PR 3.3, tranche 3.3b2) : racine <c>specVersion</c>/<c>exportedFrom</c>
/// sans identifiant interne, corps = <see cref="StudioAiSpecCanonical.CanonicalSystemNode"/>, ré-importable
/// par <see cref="StudioAiSystemSpec.TryParse"/>, jonctions → <c>relations[]</c>, dégradations en texte
/// avec avertissement, seed bornée et neutralisée (relations/pièces jointes), JSON corrompu toléré.
/// </summary>
public sealed class StudioSystemSpecExporterTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly DateTime ExportedAt = new(2026, 9, 15, 12, 0, 0, DateTimeKind.Utc);

    // ---- Fixture : « Gestion des congés » (employes, conges, types_conge + jonction) -------------

    private sealed class Fixture
    {
        public CustomSystemDefinition System { get; } = CustomSystemDefinition.Create(
            Tenant, "gestion-conges", "Gestion des congés", "pi pi-calendar", "Suivi des congés.",
            "[\"Ajoutez des employés\",\"Configurez les types\"]", null);

        public List<CustomEntityDefinition> Entities { get; } = new();
        public Dictionary<Guid, List<CustomFieldDefinition>> Fields { get; } = new();
        public Dictionary<Guid, CustomFormDefinition?> Forms { get; } = new();
        public Dictionary<Guid, List<CustomReportDefinition>> Reports { get; } = new();
        public Dictionary<Guid, List<CustomRecordViewDefinition>> Views { get; } = new();
        public Dictionary<Guid, List<CustomRecord>> Seed { get; } = new();

        public CustomEntityDefinition Employes { get; }
        public CustomEntityDefinition Conges { get; }
        public CustomEntityDefinition TypesConge { get; }
        public CustomEntityDefinition Junction { get; }

        /// <param name="junctionTarget">Cible du 2e champ de la jonction (<c>types_conge</c> ou une clé hors système).</param>
        public Fixture(string junctionTarget = "types_conge", bool withOutsideRelation = true)
        {
            Employes = AddEntity("employes", "Employé", "Employés");
            AddField(Employes, "nom", "Nom", CustomFieldType.Text, required: true, sortOrder: 1);
            AddField(Employes, "client", "Client", CustomFieldType.RelationExisting, sortOrder: 2,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("existing", "clients")));
            AddField(Employes, "salaire", "Salaire", CustomFieldType.Money, sortOrder: 3,
                optionsJson: """{"money":{"currency":"TND"}}""");
            AddField(Employes, "note", "Note", CustomFieldType.Rating, sortOrder: 4,
                optionsJson: """{"rating":{"max":5}}""");
            AddField(Employes, "badge", "Badge", CustomFieldType.Barcode, sortOrder: 5,
                optionsJson: """{"render":{"format":"code128"}}""");
            AddField(Employes, "matricule", "Matricule", CustomFieldType.AutoNumber, sortOrder: 6,
                optionsJson: """{"number":{"prefix":"EMP-","padding":4,"suffix":""}}""");
            var ancien = AddField(Employes, "ancien", "Ancien", CustomFieldType.Text, sortOrder: 7);
            ancien.Update("Ancien", false, false, null, null, null, isActive: false, null);

            TypesConge = AddEntity("types_conge", "Type de congé", "Types de congé");
            AddField(TypesConge, "libelle", "Libellé", CustomFieldType.Text, unique: true, sortOrder: 1);
            AddField(TypesConge, "jours", "Jours", CustomFieldType.Number, sortOrder: 2);

            Conges = AddEntity("conges", "Congé", "Congés");
            AddField(Conges, "statut", "Statut", CustomFieldType.Select, required: true, sortOrder: 1,
                optionsJson: """{"options":[{"value":"en_attente","label":"En attente"},{"value":"approuve","label":"Approuvé"}]}""");
            AddField(Conges, "employe", "Employé", CustomFieldType.RelationCustom, required: true, sortOrder: 2,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "employes")));
            AddField(Conges, "type", "Type", CustomFieldType.RelationCustom, sortOrder: 3,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "types_conge")));
            if (withOutsideRelation)
                AddField(Conges, "service", "Service", CustomFieldType.RelationCustom, sortOrder: 4,
                    optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "services")));
            AddField(Conges, "debut", "Début", CustomFieldType.Date, sortOrder: 5);
            AddField(Conges, "fin", "Fin", CustomFieldType.Date, sortOrder: 6);
            AddField(Conges, "piece", "Pièce", CustomFieldType.Attachment, sortOrder: 7);

            Forms[Conges.Id] = CustomFormDefinition.Create(Tenant, Conges.Id, "default", "Formulaire", FormLayoutJson.Serialize(new FormLayout
            {
                Sections = new[]
                {
                    new FormSection
                    {
                        Title = "Général",
                        Fields = new[]
                        {
                            new FormFieldRef { Key = "statut", Width = "half" },
                            new FormFieldRef { Key = "employe", Width = "full" },
                            new FormFieldRef { Key = "champ_inconnu", Width = "full" }
                        }
                    }
                }
            }), isDefault: true, null);

            AddReport(Conges, "Congés par statut", new ReportDefinition
            {
                Grouping = new[] { "statut" },
                Aggregations = new[] { new ReportAggregation { Fn = "count" } }
            });

            AddView(Conges, "Tous", CustomRecordViewMode.List, new RecordViewDefinition(
                new[] { new RecordViewColumn("statut"), new RecordViewColumn("employe"), new RecordViewColumn("piece", Hidden: true) },
                Array.Empty<RecordViewFilter>(), new[] { new RecordViewSort("debut", true) }, null, null), isDefault: true);
            AddView(Conges, "Par statut", CustomRecordViewMode.Kanban, new RecordViewDefinition(
                new[] { new RecordViewColumn("statut") }, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(),
                new RecordViewKanban("statut", "employe", null, null), null));
            AddView(Conges, "Calendrier", CustomRecordViewMode.Calendar, new RecordViewDefinition(
                new[] { new RecordViewColumn("statut") }, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(),
                null, new RecordViewCalendar("debut", "fin", null, null)));

            Junction = AddEntity("employes_formations", "Participations", "Participations",
                description: $"Participants — table de jonction employes ↔ {junctionTarget}.", kind: CustomEntityKind.Junction);
            AddField(Junction, "employe", "Employé", CustomFieldType.RelationCustom, required: true, sortOrder: 1,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "employes")));
            AddField(Junction, "cible", "Cible", CustomFieldType.RelationCustom, required: true, sortOrder: 2,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", junctionTarget)));
        }

        public CustomEntityDefinition AddEntity(string key, string name, string plural, string? description = null,
            CustomEntityKind kind = CustomEntityKind.Standard)
        {
            var entity = CustomEntityDefinition.Create(Tenant, key, name, plural, "pi pi-table", description, null, System.Id, kind);
            Entities.Add(entity);
            Fields[entity.Id] = new List<CustomFieldDefinition>();
            return entity;
        }

        public CustomFieldDefinition AddField(CustomEntityDefinition entity, string key, string label, CustomFieldType type,
            bool required = false, bool unique = false, int sortOrder = 0, string? optionsJson = null)
        {
            var field = CustomFieldDefinition.Create(Tenant, entity.Id, key, label, type, required, unique, sortOrder, null, optionsJson, null, null);
            Fields[entity.Id].Add(field);
            return field;
        }

        public CustomReportDefinition AddReport(CustomEntityDefinition entity, string name, ReportDefinition definition)
        {
            var report = CustomReportDefinition.Create(Tenant, $"r_{Reports.Count}_{name.Length}", name,
                CustomReportDataSourceKind.CustomEntity, entity.Key, ReportDefinitionJson.Serialize(definition), null);
            if (!Reports.TryGetValue(entity.Id, out var list)) Reports[entity.Id] = list = new List<CustomReportDefinition>();
            list.Add(report);
            return report;
        }

        public CustomRecordViewDefinition AddView(CustomEntityDefinition entity, string name, CustomRecordViewMode mode,
            RecordViewDefinition? definition, bool isDefault = false, string? rawJson = null)
        {
            var view = CustomRecordViewDefinition.Create(Tenant, entity.Id, $"v_{name.Length}_{Views.Count}", name, mode,
                rawJson ?? RecordViewDefinitionJson.Serialize(definition!), isDefault, null);
            if (!Views.TryGetValue(entity.Id, out var list)) Views[entity.Id] = list = new List<CustomRecordViewDefinition>();
            list.Add(view);
            return view;
        }

        public void AddRecord(CustomEntityDefinition entity, string dataJson)
        {
            if (!Seed.TryGetValue(entity.Id, out var list)) Seed[entity.Id] = list = new List<CustomRecord>();
            list.Add(CustomRecord.Create(Tenant, entity.Id, dataJson, null));
        }

        public StudioSystemExportInput Build(bool includeSeed = false) => new(
            System,
            Entities,
            Fields.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<CustomFieldDefinition>)kv.Value),
            Forms,
            Reports.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<CustomReportDefinition>)kv.Value),
            Views.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<CustomRecordViewDefinition>)kv.Value),
            includeSeed ? Seed.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<CustomRecord>)kv.Value) : null);
    }

    private static StudioSystemExportResult Export(Fixture fixture, bool includeSeed = false, int maxSeedRows = StudioSystemSpecExporter.DefaultMaxSeedRows) =>
        StudioSystemSpecExporter.Export(fixture.Build(includeSeed), maxSeedRows, ExportedAt);

    private static JsonObject Entity(JsonObject spec, string @ref) =>
        spec["entities"]!.AsArray().Select(e => e!.AsObject()).Single(e => e["ref"]!.GetValue<string>() == @ref);

    private static JsonObject Field(JsonObject spec, string @ref, string key) =>
        Entity(spec, @ref)["fields"]!.AsArray().Select(f => f!.AsObject()).Single(f => f["key"]!.GetValue<string>() == key);

    private static IEnumerable<string> AllKeys(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var kv in obj)
                {
                    yield return kv.Key;
                    foreach (var k in AllKeys(kv.Value)) yield return k;
                }
                break;
            case JsonArray arr:
                foreach (var item in arr)
                    foreach (var k in AllKeys(item)) yield return k;
                break;
        }
    }

    // ---- Racine / forme ------------------------------------------------------------------------

    [Fact]
    public void Export_root_has_spec_version_1_and_exported_from_without_tenant_id()
    {
        var fixture = new Fixture();
        var result = Export(fixture);
        var spec = result.Spec;

        Assert.Equal(1, spec["specVersion"]!.GetValue<int>());
        Assert.Equal("gestion-conges", spec["exportedFrom"]!["tenantSystemKey"]!.GetValue<string>());
        Assert.Equal(ExportedAt.ToString("O"), spec["exportedFrom"]!["exportedAt"]!.GetValue<string>());
        Assert.Equal(new[] { "specVersion", "exportedFrom", "system", "entities", "relations" }, spec.Select(kv => kv.Key).ToArray());

        var keys = AllKeys(spec).ToList();
        Assert.DoesNotContain(keys, k => k.Equals("tenantId", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(keys, k => k.Equals("id", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(fixture.System.Id.ToString(), spec.ToJsonString());
        Assert.DoesNotContain(Tenant.ToString(), spec.ToJsonString());
    }

    [Fact]
    public void Export_body_equals_canonical_system_node_of_parsed_spec()
    {
        var fixture = new Fixture();
        fixture.AddRecord(fixture.TypesConge, """{"libelle":"CP","jours":25}""");
        var input = fixture.Build(includeSeed: true);

        var result = StudioSystemSpecExporter.Export(input, exportedAtUtc: ExportedAt);
        var body = new JsonObject();
        foreach (var kv in result.Spec.Where(kv => kv.Key is not ("specVersion" or "exportedFrom")))
            body[kv.Key] = kv.Value?.DeepClone();

        var expected = StudioAiSpecCanonical.CanonicalSystemNode(
            StudioSystemSpecExporter.ToParsedSpec(input, StudioSystemSpecExporter.DefaultMaxSeedRows, new List<string>()));

        Assert.Equal(StudioAiSpecCanonical.Serialize(expected), StudioAiSpecCanonical.Serialize(body));
    }

    [Fact]
    public void Export_round_trips_through_TryParse_without_error()
    {
        var result = Export(new Fixture(withOutsideRelation: false));

        Assert.True(StudioAiSystemSpec.TryParse(result.Spec.ToJsonString(), out var parsed, out var error), error);
        Assert.Equal(3, parsed!.Entities.Count);
        Assert.Single(parsed.Relations);
        Assert.True(parsed.Warnings is null || parsed.Warnings.Count == 0, string.Join(" | ", parsed.Warnings ?? Array.Empty<string>()));
        Assert.Equal(new[] { "Ajoutez des employés", "Configurez les types" }, parsed.OnboardingSteps);
    }

    [Fact]
    public void Export_is_deterministic_for_same_input()
    {
        var fixture = new Fixture();
        fixture.AddRecord(fixture.TypesConge, """{"libelle":"CP","jours":25}""");

        var first = Export(fixture, includeSeed: true);
        var second = Export(fixture, includeSeed: true);

        Assert.Equal(StudioAiSpecCanonical.Serialize(first.Spec), StudioAiSpecCanonical.Serialize(second.Spec));
        Assert.Equal(first.Warnings, second.Warnings);
    }

    // ---- Relations N-N -------------------------------------------------------------------------

    [Fact]
    public void Junction_entities_become_many_to_many_relations_and_are_not_listed_as_entities()
    {
        var result = Export(new Fixture());
        var spec = result.Spec;

        var relations = spec["relations"]!.AsArray();
        var relation = Assert.Single(relations)!.AsObject();
        Assert.Equal("many_to_many", relation["kind"]!.GetValue<string>());
        Assert.Equal("employes", relation["from"]!.GetValue<string>());
        Assert.Equal("types_conge", relation["to"]!.GetValue<string>());
        Assert.Equal("Participants", relation["label"]!.GetValue<string>());
        Assert.Equal("Participations", relation["junctionName"]!.GetValue<string>());

        var refs = spec["entities"]!.AsArray().Select(e => e!["ref"]!.GetValue<string>()).ToList();
        Assert.Equal(new[] { "employes", "types_conge", "conges" }, refs);
        Assert.DoesNotContain("employes_formations", refs);
        Assert.Equal(1, result.RelationCount);
        Assert.Equal(3, result.EntityCount);
    }

    [Fact]
    public void Junction_with_target_outside_system_is_skipped_with_warning()
    {
        var result = Export(new Fixture(junctionTarget: "formations"));

        Assert.Null(result.Spec["relations"]);
        Assert.Equal(0, result.RelationCount);
        Assert.Contains(result.Warnings, w => w.Contains("Table de jonction « employes_formations » ignorée"));
    }

    // ---- Champs --------------------------------------------------------------------------------

    [Fact]
    public void Relation_custom_to_entity_in_system_keeps_relation_to()
    {
        var spec = Export(new Fixture()).Spec;

        var field = Field(spec, "conges", "type");
        Assert.Equal("relation", field["type"]!.GetValue<string>());
        Assert.Equal("types_conge", field["relationTo"]!.GetValue<string>());
        Assert.Equal("employes", Field(spec, "conges", "employe")["relationTo"]!.GetValue<string>());
    }

    [Fact]
    public void Relation_custom_to_entity_outside_system_degrades_to_text_with_warning()
    {
        var result = Export(new Fixture());

        var field = Field(result.Spec, "conges", "service");
        Assert.Equal("text", field["type"]!.GetValue<string>());
        Assert.Null(field["relationTo"]);
        Assert.Null(field["options"]);
        Assert.Null(field["config"]);
        Assert.Contains(result.Warnings, w => w.Contains("Relation « Service » vers « services » hors système"));
    }

    [Fact]
    public void Relation_existing_keeps_erp_target()
    {
        var field = Field(Export(new Fixture()).Spec, "employes", "client");

        Assert.Equal("relation", field["type"]!.GetValue<string>());
        Assert.Equal("clients", field["relationTo"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(CustomFieldType.Formula, """{"formula":{"expr":"jours * 2"}}""")]
    [InlineData(CustomFieldType.Lookup, """{"lookup":{"via":"employe","field":"nom"}}""")]
    [InlineData(CustomFieldType.Rollup, """{"rollup":{"via":"employe","fn":"count"}}""")]
    public void Formula_lookup_and_rollup_fields_degrade_to_text_with_one_warning_each(CustomFieldType type, string optionsJson)
    {
        var fixture = new Fixture();
        fixture.AddField(fixture.Conges, "calcule", "Calculé", type, sortOrder: 20, optionsJson: optionsJson);

        var result = Export(fixture);

        var field = Field(result.Spec, "conges", "calcule");
        Assert.Equal("text", field["type"]!.GetValue<string>());
        Assert.Null(field["config"]);
        var expected = $"Champ « Calculé » ({type}) exporté en texte : formules et agrégats ne sont pas portables.";
        Assert.Single(result.Warnings, w => w == expected);
    }

    [Fact]
    public void Money_rating_and_barcode_config_is_exported()
    {
        var spec = Export(new Fixture()).Spec;

        Assert.Equal("TND", Field(spec, "employes", "salaire")["config"]!["currency"]!.GetValue<string>());
        Assert.Equal(5, Field(spec, "employes", "note")["config"]!["max"]!.GetValue<int>());
        Assert.Equal("code128", Field(spec, "employes", "badge")["config"]!["format"]!.GetValue<string>());
        var autoNumber = Field(spec, "employes", "matricule");
        Assert.Equal("autonumber", autoNumber["type"]!.GetValue<string>());
        Assert.Null(autoNumber["config"]);
        Assert.Equal(2, Field(spec, "conges", "statut")["options"]!.AsArray().Count);
    }

    [Fact]
    public void Corrupt_field_options_json_is_ignored_with_warning()
    {
        var fixture = new Fixture();
        fixture.AddField(fixture.TypesConge, "couleur", "Couleur", CustomFieldType.Select, sortOrder: 9, optionsJson: "{");

        var result = Export(fixture);

        var field = Field(result.Spec, "types_conge", "couleur");
        Assert.Equal("select", field["type"]!.GetValue<string>());
        Assert.Null(field["options"]);
        Assert.Contains("Configuration du champ « Couleur » illisible : ignorée.", result.Warnings);
    }

    // ---- Inactifs / formulaire / rapports / vues -----------------------------------------------

    [Fact]
    public void Inactive_entities_fields_views_and_reports_are_excluded()
    {
        var fixture = new Fixture();
        var archives = fixture.AddEntity("archives", "Archive", "Archives");
        archives.Update("Archive", "Archives", null, null, isActive: false, null);
        var inactiveView = fixture.AddView(fixture.Conges, "Cachée", CustomRecordViewMode.List, new RecordViewDefinition(
            new[] { new RecordViewColumn("statut") }, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(), null, null));
        inactiveView.Update("Cachée", CustomRecordViewMode.List, inactiveView.DefinitionJson, isActive: false, null);
        var inactiveReport = fixture.AddReport(fixture.TypesConge, "Ancien rapport", new ReportDefinition());
        inactiveReport.Update("Ancien rapport", CustomReportDataSourceKind.CustomEntity, "types_conge", inactiveReport.DefinitionJson, isActive: false, null);

        var result = Export(fixture);

        Assert.Equal(3, result.EntityCount);
        Assert.Equal(3, result.ViewCount);
        Assert.DoesNotContain(result.Spec["entities"]!.AsArray(), e => e!["ref"]!.GetValue<string>() == "archives");
        Assert.Null(Entity(result.Spec, "types_conge")["report"]);
        Assert.DoesNotContain(Entity(result.Spec, "employes")["fields"]!.AsArray(), f => f!["key"]!.GetValue<string>() == "ancien");
        Assert.Single(result.Warnings, w => w == "1 table(s) inactive(s) non exportée(s).");
    }

    [Fact]
    public void Default_form_is_exported_and_unknown_field_refs_are_dropped()
    {
        var spec = Export(new Fixture()).Spec;

        var sections = Entity(spec, "conges")["form"]!["sections"]!.AsArray();
        var section = Assert.Single(sections)!.AsObject();
        Assert.Equal("Général", section["title"]!.GetValue<string>());
        var fields = section["fields"]!.AsArray().Select(f => f!["field"]!.GetValue<string>()).ToList();
        Assert.Equal(new[] { "statut", "employe" }, fields);
        Assert.Equal("half", section["fields"]![0]!["width"]!.GetValue<string>());
        Assert.Null(Entity(spec, "employes")["form"]);
    }

    [Fact]
    public void First_report_is_exported_and_extra_reports_warn()
    {
        var fixture = new Fixture();
        fixture.AddReport(fixture.Conges, "Zzz second rapport", new ReportDefinition { Fields = new[] { "statut" } });

        var result = Export(fixture);

        var report = Entity(result.Spec, "conges")["report"]!.AsObject();
        Assert.Equal("Congés par statut", report["displayName"]!.GetValue<string>());
        Assert.Equal(new[] { "statut" }, report["groupBy"]!.AsArray().Select(g => g!.GetValue<string>()).ToArray());
        Assert.Equal("count", report["measures"]![0]!["fn"]!.GetValue<string>());
        Assert.Contains("Table « conges » : 1 rapport(s) supplémentaire(s) non exporté(s) (un seul rapport par table dans la spec).", result.Warnings);
    }

    [Fact]
    public void Views_are_mapped_to_parsed_record_view_spec_and_capped_at_three()
    {
        var fixture = new Fixture();
        fixture.AddView(fixture.Conges, "Zzz quatrième", CustomRecordViewMode.List, new RecordViewDefinition(
            new[] { new RecordViewColumn("statut") }, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(), null, null));

        var result = Export(fixture);

        Assert.Equal(3, result.ViewCount);
        var views = Entity(result.Spec, "conges")["views"]!.AsArray().Select(v => v!.AsObject()).ToList();
        Assert.Equal(new[] { "Tous", "Calendrier", "Par statut" }, views.Select(v => v["name"]!.GetValue<string>()).ToArray());

        var list = views[0];
        Assert.Equal("list", list["mode"]!.GetValue<string>());
        Assert.True(list["isDefault"]!.GetValue<bool>());
        Assert.Equal(new[] { "statut", "employe" }, list["columns"]!.AsArray().Select(c => c!.GetValue<string>()).ToArray());
        Assert.Equal("debut", list["sort"]![0]!["field"]!.GetValue<string>());
        Assert.True(list["sort"]![0]!["desc"]!.GetValue<bool>());

        var calendar = views[1];
        Assert.Equal("calendar", calendar["mode"]!.GetValue<string>());
        Assert.Equal("debut", calendar["start"]!.GetValue<string>());
        Assert.Equal("fin", calendar["end"]!.GetValue<string>());

        var kanban = views[2];
        Assert.Equal("kanban", kanban["mode"]!.GetValue<string>());
        Assert.Equal("statut", kanban["groupBy"]!.GetValue<string>());
        Assert.Equal("employe", kanban["title"]!.GetValue<string>());
        Assert.False(kanban["isDefault"]!.GetValue<bool>());

        Assert.Contains("Au plus 3 vues par table ; 1 vue(s) de « conges » non exportée(s).", result.Warnings);
    }

    [Fact]
    public void Corrupt_view_definition_is_skipped_with_warning()
    {
        var fixture = new Fixture();
        fixture.AddView(fixture.TypesConge, "Cassée", CustomRecordViewMode.List, null, rawJson: "{");

        var result = Export(fixture);

        Assert.Null(Entity(result.Spec, "types_conge")["views"]);
        Assert.Equal(3, result.ViewCount);
        Assert.Contains("Vue « Cassée » illisible : ignorée.", result.Warnings);
    }

    // ---- Seed ----------------------------------------------------------------------------------

    [Fact]
    public void Seed_is_omitted_when_not_requested()
    {
        var fixture = new Fixture();
        fixture.AddRecord(fixture.TypesConge, """{"libelle":"CP","jours":25}""");

        var result = Export(fixture, includeSeed: false);

        Assert.Null(result.Spec["seed"]);
        Assert.False(result.IncludesSeed);
    }

    [Fact]
    public void Seed_is_bounded_per_entity_and_nulls_relation_and_attachment_values()
    {
        var fixture = new Fixture();
        var employeId = Guid.NewGuid();
        for (var i = 0; i < 3; i++)
            fixture.AddRecord(fixture.Conges,
                $$$"""{"statut":"en_attente","employe":"{{{employeId}}}","piece":{"fileId":"abc"},"debut":"2026-01-0{{{i + 1}}}","inconnu":42}""");

        var result = Export(fixture, includeSeed: true, maxSeedRows: 2);

        Assert.True(result.IncludesSeed);
        var batch = Assert.Single(result.Spec["seed"]!.AsArray())!.AsObject();
        Assert.Equal("conges", batch["entityRef"]!.GetValue<string>());
        var records = batch["records"]!.AsArray();
        Assert.Equal(2, records.Count);
        var record = records[0]!.AsObject();
        Assert.Equal("en_attente", record["statut"]!.GetValue<string>());
        Assert.True(record.ContainsKey("employe"));
        Assert.Null(record["employe"]);
        Assert.True(record.ContainsKey("piece"));
        Assert.Null(record["piece"]);
        Assert.Equal("2026-01-01", record["debut"]!.GetValue<string>());
        Assert.False(record.ContainsKey("inconnu"));
        Assert.DoesNotContain(employeId.ToString(), result.Spec.ToJsonString());
        Assert.Contains("Données de départ de « conges » tronquées à 2 ligne(s).", result.Warnings);
    }

    [Fact]
    public void Seed_total_never_exceeds_parser_maximum()
    {
        var fixture = new Fixture();
        for (var i = 0; i < 100; i++)
        {
            fixture.AddRecord(fixture.Employes, $$"""{"nom":"E{{i}}"}""");
            fixture.AddRecord(fixture.TypesConge, $$"""{"libelle":"T{{i}}"}""");
            fixture.AddRecord(fixture.Conges, """{"statut":"en_attente"}""");
        }

        var result = Export(fixture, includeSeed: true, maxSeedRows: 100);

        var batches = result.Spec["seed"]!.AsArray().Select(b => b!.AsObject()).ToList();
        Assert.Equal(StudioAiSystemSpec.MaxSeedRecords, batches.Sum(b => b["records"]!.AsArray().Count));
        Assert.Equal(new[] { "employes", "types_conge" }, batches.Select(b => b["entityRef"]!.GetValue<string>()).ToArray());
        Assert.Contains("Données de départ de « conges » tronquées à 0 ligne(s).", result.Warnings);
        Assert.True(StudioAiSystemSpec.TryParse(result.Spec.ToJsonString(), out _, out var error), error);
    }

    [Fact]
    public void Seed_row_with_corrupt_data_json_is_skipped()
    {
        var fixture = new Fixture();
        fixture.AddRecord(fixture.TypesConge, """{"libelle":"CP"}""");
        fixture.AddRecord(fixture.TypesConge, "{ not json");
        fixture.AddRecord(fixture.TypesConge, """{"libelle":"RTT"}""");

        var result = Export(fixture, includeSeed: true);

        var batch = Assert.Single(result.Spec["seed"]!.AsArray())!.AsObject();
        Assert.Equal(2, batch["records"]!.AsArray().Count);
        Assert.Contains("1 ligne(s) de données de départ illisible(s) ignorée(s).", result.Warnings);
        Assert.True(result.IncludesSeed);
    }

    // ---- Bornes d'import -----------------------------------------------------------------------

    [Fact]
    public void More_than_eight_standard_entities_are_exported_with_a_warning()
    {
        var fixture = new Fixture();
        for (var i = 0; i < 6; i++)
        {
            var extra = fixture.AddEntity($"extra_{i}", $"Extra {i}", $"Extras {i}");
            fixture.AddField(extra, "nom", "Nom", CustomFieldType.Text, sortOrder: 1);
        }

        var result = Export(fixture);

        Assert.Equal(9, result.EntityCount);
        Assert.Equal(9, result.Spec["entities"]!.AsArray().Count);
        Assert.Contains("Ce système compte 9 tables : la limite d'import est de 8, l'import ou la duplication échouera sans édition.", result.Warnings);
    }
}
