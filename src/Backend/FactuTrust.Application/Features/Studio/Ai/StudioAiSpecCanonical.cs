using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// Forme CANONIQUE d'une spec Studio IA : clés dans un ordre fixe, noms de types canoniques
/// (<c>text</c>, <c>select</c>, <c>date</c>, …), options en objets <c>{value,label}</c>, clé de
/// champ toujours explicite (<c>"key"</c>). C'est la seule forme persistée après édition et la
/// seule exposée à l'éditeur d'aperçu : la canonicalisation EST le filtre d'écriture massive
/// (aucune clé inconnue conservée). Les alias d'entrée (<c>ref</c>/<c>key</c>, <c>label</c>/<c>name</c>,
/// types français « texte », « liste », …) restent acceptés par les parseurs mais ne sont jamais émis.
/// Invariant : <c>CanonicalFor(kind, CanonicalFor(kind, x))</c> est stable à l'octet près.
/// </summary>
public static class StudioAiSpecCanonical
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = true, // 2 espaces par défaut, sans espaces finaux
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping // « é » reste lisible dans l'éditeur
    };

    /// <summary>Écriture ordonnée (ordre d'insertion) + indentation 2 espaces, sans espaces finaux.</summary>
    public static string Serialize(JsonNode node) => node.ToJsonString(SerializerOptions);

    /// <summary>Parse une spec selon la nature du plan puis la resérialise en forme canonique ; null si invalide.</summary>
    public static string? CanonicalFor(StudioAiPlanKind kind, string specJson, out string? error)
    {
        error = null;
        switch (kind)
        {
            case StudioAiPlanKind.CreateSystem:
                if (!StudioAiSystemSpec.TryParse(specJson, out var system, out error) || system is null) return null;
                return CanonicalSystem(system);
            case StudioAiPlanKind.CreateApp:
                if (!StudioAiAppSpec.TryParse(specJson, out var app, out error) || app is null) return null;
                return CanonicalApp(app);
            case StudioAiPlanKind.Amendment:
                if (!StudioAiAmendmentSpec.TryParse(specJson, out var amendment, out error) || amendment is null) return null;
                return CanonicalAmendment(amendment);
            case StudioAiPlanKind.View:
                if (!StudioAiViewSpec.TryParse(specJson, out var view, out error) || view is null) return null;
                return CanonicalView(view);
            case StudioAiPlanKind.Report:
                if (!StudioAiReportSpec.TryParse(specJson, out var report, out error) || report is null) return null;
                return CanonicalReport(report);
            case StudioAiPlanKind.RecordView:
                if (!StudioAiRecordViewSpec.TryParse(specJson, out var recordView, out error) || recordView is null) return null;
                return CanonicalRecordView(recordView);
            case StudioAiPlanKind.Workflow:
                if (!StudioAiWorkflowSpec.TryParse(specJson, out var workflow, out error) || workflow is null) return null;
                return CanonicalWorkflow(workflow);
            default:
                error = $"Nature de plan « {kind} » non prise en charge.";
                return null;
        }
    }

    // ---- Système multi-tables -------------------------------------------------------------

    /// <summary>Ordre fixe des clés : system{displayName,icon,description,onboarding(,menu P2)}, entities[], seed[].</summary>
    public static string CanonicalSystem(ParsedSystemSpec spec) => Serialize(CanonicalSystemNode(spec));

    /// <summary>
    /// Nœud canonique d'une spec système (E9, PR 3.3) : même construction que
    /// <see cref="CanonicalSystem"/> (désormais un one-liner), exposée pour les ré-émetteurs qui
    /// enrichissent la racine avant sérialisation (<c>specVersion</c>, <c>exportedFrom</c> — export
    /// de systèmes). La sortie sérialisée de <see cref="CanonicalSystem"/> reste identique à
    /// l'octet près (test de non-régression sur le modèle <c>suivi-reclamations</c>).
    /// </summary>
    public static JsonObject CanonicalSystemNode(ParsedSystemSpec spec)
    {
        var system = new JsonObject { ["displayName"] = spec.SystemDisplayName };
        if (spec.SystemIcon is not null) system["icon"] = spec.SystemIcon;
        if (spec.SystemDescription is not null) system["description"] = spec.SystemDescription;
        if (spec.OnboardingSteps is { Count: > 0 })
            system["onboarding"] = StringArray(spec.OnboardingSteps);

        var entities = new JsonArray();
        foreach (var entity in spec.Entities)
        {
            // Table réutilisée : la clé existante suffit — aucun champ/formulaire/état n'est émis
            // (ils ne seraient de toute façon pas appliqués). displayName est ré-émis car il sert de
            // libellé d'aperçu ; au re-parse il retombe sur existingKey s'il est absent.
            if (entity.ExistingKey is not null)
            {
                entities.Add(new JsonObject
                {
                    ["ref"] = entity.Ref,
                    ["existingKey"] = entity.ExistingKey,
                    ["displayName"] = entity.EntityDisplayName
                });
                continue;
            }

            var node = new JsonObject
            {
                ["ref"] = entity.Ref,
                ["displayName"] = entity.EntityDisplayName,
                ["displayNamePlural"] = entity.EntityDisplayNamePlural
            };
            if (entity.Icon is not null) node["icon"] = entity.Icon;
            if (entity.Description is not null) node["description"] = entity.Description;
            node["fields"] = new JsonArray(entity.Fields
                .Select(f => FieldJson(f.Key, f.Label, f.FieldType, f.Required, f.Unique, f.Options, f.Config, f.RelationToRef))
                .ToArray());
            if (entity.Form is not null) node["form"] = FormJson(entity.Form);
            if (entity.Report is not null) node["report"] = ReportJson(entity.Report);
            // Vues enregistrées proposées (PR 2.4) : clés de champ non résolues, telles qu'émises.
            if (entity.Views.Count > 0)
                node["views"] = new JsonArray(entity.Views.Select(v => (JsonNode)RecordViewJson(v)).ToArray());
            entities.Add(node);
        }

        var root = new JsonObject
        {
            ["system"] = system,
            ["entities"] = entities
        };
        if (spec.Relations.Count > 0)
        {
            root["relations"] = new JsonArray(spec.Relations.Select(r =>
            {
                var node = new JsonObject
                {
                    ["kind"] = r.Kind,
                    ["from"] = r.FromRef,
                    ["to"] = r.ToRef
                };
                if (r.Label is not null) node["label"] = r.Label;
                if (r.JunctionName is not null) node["junctionName"] = r.JunctionName;
                return (JsonNode)node;
            }).ToArray());
        }
        if (spec.Seed.Count > 0)
        {
            root["seed"] = new JsonArray(spec.Seed.Select(batch => (JsonNode)new JsonObject
            {
                ["entityRef"] = batch.EntityRef,
                ["records"] = new JsonArray(batch.Records.Select(r => (JsonNode)RecordJson(r)).ToArray())
            }).ToArray());
        }
        return root;
    }

    // ---- Table simple ----------------------------------------------------------------------

    public static string CanonicalApp(ParsedAppSpec spec)
    {
        var entity = new JsonObject
        {
            ["displayName"] = spec.EntityDisplayName,
            ["displayNamePlural"] = spec.EntityDisplayNamePlural
        };
        if (spec.Icon is not null) entity["icon"] = spec.Icon;
        if (spec.Description is not null) entity["description"] = spec.Description;

        var root = new JsonObject
        {
            ["entity"] = entity,
            ["fields"] = new JsonArray(spec.Fields
                .Select(f => FieldJson(f.Key, f.Label, f.FieldType, f.Required, f.Unique, f.Options, f.Config, null))
                .ToArray())
        };
        if (spec.Report is not null) root["report"] = ReportJson(spec.Report);
        return Serialize(root);
    }

    // ---- Modification d'une table existante -------------------------------------------------

    public static string CanonicalAmendment(ParsedAmendmentSpec spec)
    {
        var operations = new JsonArray();
        foreach (var operation in spec.Operations)
        {
            switch (operation)
            {
                case AddFieldOp add:
                {
                    var field = add.Field;
                    var node = new JsonObject
                    {
                        ["op"] = "add_field",
                        ["key"] = field.Key,
                        ["label"] = field.Label,
                        ["type"] = CanonicalTypeName(field.FieldType),
                        ["required"] = field.Required,
                        ["unique"] = field.Unique
                    };
                    if (field.Options is { Count: > 0 }) node["options"] = OptionsJson(field.Options);
                    if (field.Config is { Count: > 0 }) node["config"] = ConfigJson(field.Config);
                    operations.Add(node);
                    break;
                }
                case UpdateFieldOp update:
                {
                    var node = new JsonObject { ["op"] = "update_field", ["field"] = update.FieldRef };
                    if (update.Label is not null) node["label"] = update.Label;
                    if (update.Required is not null) node["required"] = update.Required.Value;
                    if (update.Unique is not null) node["unique"] = update.Unique.Value;
                    if (update.AddOptions is { Count: > 0 }) node["addOptions"] = OptionsJson(update.AddOptions);
                    operations.Add(node);
                    break;
                }
                case RemoveFieldOp remove:
                    operations.Add(new JsonObject { ["op"] = "remove_field", ["field"] = remove.FieldRef });
                    break;
                case UpdateEntityOp updateEntity:
                {
                    var node = new JsonObject { ["op"] = "update_entity" };
                    if (updateEntity.DisplayName is not null) node["displayName"] = updateEntity.DisplayName;
                    if (updateEntity.DisplayNamePlural is not null) node["displayNamePlural"] = updateEntity.DisplayNamePlural;
                    if (updateEntity.Icon is not null) node["icon"] = updateEntity.Icon;
                    if (updateEntity.Description is not null) node["description"] = updateEntity.Description;
                    operations.Add(node);
                    break;
                }
                case SetFormOp setForm:
                    // Charge libre résolue contre le schéma réel à l'exécution : conservée telle quelle.
                    operations.Add(new JsonObject { ["op"] = "set_form", ["form"] = setForm.FormNode.DeepClone() });
                    break;
                case SetReportOp setReport:
                {
                    var node = new JsonObject { ["op"] = "set_report" };
                    if (setReport.DisplayName is not null) node["displayName"] = setReport.DisplayName;
                    node["report"] = setReport.ReportNode.DeepClone();
                    operations.Add(node);
                    break;
                }
                case ReorderFieldsOp reorder:
                    operations.Add(new JsonObject { ["op"] = "reorder_fields", ["fields"] = StringArray(reorder.FieldRefs) });
                    break;
                case ChangeFieldTypeOp changeType:
                {
                    var node = new JsonObject
                    {
                        ["op"] = "change_field_type",
                        ["field"] = changeType.FieldRef,
                        ["type"] = CanonicalChangeFieldTypeName(changeType.FieldType)
                    };
                    if (changeType.Options is { Count: > 0 }) node["options"] = OptionsJson(changeType.Options);
                    if (changeType.Relation is not null)
                        node["relation"] = new JsonObject { ["kind"] = changeType.Relation.Kind, ["ref"] = changeType.Relation.Ref };
                    if (changeType.Config is { Count: > 0 }) node["config"] = RawConfigJson(changeType.Config);
                    operations.Add(node);
                    break;
                }
                case AddRelationOp addRelation:
                {
                    var node = new JsonObject { ["op"] = "add_relation", ["kind"] = addRelation.Kind, ["target"] = addRelation.TargetRef };
                    if (addRelation.Label is not null) node["label"] = addRelation.Label;
                    if (addRelation.JunctionName is not null) node["junctionName"] = addRelation.JunctionName;
                    operations.Add(node);
                    break;
                }
                case AssignSystemOp assignSystem:
                {
                    // Détachement émis « none » (jamais de clé absente : au re-parse une clé absente
                    // est une OUBLI du modèle ⇒ op ignorée — l'aller-retour ne serait pas stable).
                    var node = new JsonObject { ["op"] = "assign_system" };
                    node["system"] = assignSystem.SystemRef ?? "none";
                    operations.Add(node);
                    break;
                }
                case SetViewOp setView:
                {
                    var node = new JsonObject { ["op"] = "set_view" };
                    foreach (var kv in RecordViewJson(setView.View))
                        node[kv.Key] = kv.Value?.DeepClone();
                    operations.Add(node);
                    break;
                }
                case SetAutomationOp setAutomation:
                {
                    var node = new JsonObject { ["op"] = "set_automation" };
                    foreach (var kv in setAutomation.Node)
                        if (kv.Key != "op") node[kv.Key] = kv.Value?.DeepClone();
                    operations.Add(node);
                    break;
                }
            }
        }

        var root = new JsonObject
        {
            ["target"] = new JsonObject { ["entityKey"] = spec.TargetEntityRef },
            ["operations"] = operations
        };
        return Serialize(root);
    }

    // ---- Fenêtre (vue lecture seule) ---------------------------------------------------------

    public static string CanonicalView(ParsedViewSpec spec)
    {
        var columns = new JsonArray();
        foreach (var column in spec.Columns)
        {
            var node = new JsonObject { ["name"] = column.Name };
            if (column.Label is not null) node["label"] = column.Label;
            if (column.Format is not null) node["format"] = column.Format;
            columns.Add(node);
        }

        var root = new JsonObject
        {
            ["title"] = spec.Title,
            ["table"] = spec.Table,
            ["columns"] = columns,
            ["search"] = spec.Search
        };
        return Serialize(root);
    }

    // ---- État (rapport SQL) ------------------------------------------------------------------

    public static string CanonicalReport(ParsedReportSpec spec)
    {
        var root = new JsonObject { ["title"] = spec.Title };
        if (spec.PresetKey is not null) root["preset"] = spec.PresetKey;
        if (spec.Source is not null) root["source"] = spec.Source;
        if (spec.Grouping.Count > 0) root["groupBy"] = StringArray(spec.Grouping);
        if (spec.Measures.Count > 0) root["measures"] = MeasuresJson(spec.Measures);
        if (spec.Columns.Count > 0) root["columns"] = StringArray(spec.Columns);
        if (spec.Filters.Count > 0) root["filters"] = FiltersJson(spec.Filters);
        if (spec.Sort.Count > 0) root["sort"] = SortJson(spec.Sort);
        if (spec.From is not null) root["from"] = spec.From.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (spec.To is not null) root["to"] = spec.To.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return Serialize(root);
    }

    // ---- Vue enregistrée (PR 2.4) -----------------------------------------------------------

    /// <summary>Ordre fixe : entity?, name, mode, columns, filters, sort, groupBy?/start?/end?/title?, isDefault.</summary>
    public static string CanonicalRecordView(ParsedRecordViewSpec spec)
    {
        var root = new JsonObject();
        if (spec.EntityKey is not null) root["entity"] = spec.EntityKey;
        root["name"] = spec.DisplayName;
        root["mode"] = spec.Mode;
        root["columns"] = StringArray(spec.Columns);
        root["filters"] = RecordViewFiltersJson(spec.Filters);
        root["sort"] = RecordViewSortJson(spec.Sort);
        if (spec.GroupByFieldKey is not null) root["groupBy"] = spec.GroupByFieldKey;
        if (spec.StartFieldKey is not null) root["start"] = spec.StartFieldKey;
        if (spec.EndFieldKey is not null) root["end"] = spec.EndFieldKey;
        if (spec.TitleFieldKey is not null) root["title"] = spec.TitleFieldKey;
        root["isDefault"] = spec.IsDefault;
        return Serialize(root);
    }

    // ---- Workflows (PR 4.3) -----------------------------------------------------------------

    /// <summary>
    /// Forme canonique d'une spec de workflows : <c>{ "workflows": [ … ] }</c> triée par
    /// <c>entityKey</c> puis <c>key</c> ; chaque workflow dans l'ordre fixe
    /// <c>entityKey, key, name, description?, trigger (snake_case), triggerConfig, steps, isActive</c>
    /// avec <c>triggerConfig</c> et <c>steps</c> à clés triées récursivement (les tableaux gardent
    /// leur ordre — il est significatif). Jamais d'avertissements ici : la forme canonique est la
    /// clé du cache d'aperçu et la forme rejouée à la confirmation (4.3f).
    /// </summary>
    public static string CanonicalWorkflow(ParsedWorkflowPlanSpec spec)
    {
        var workflows = spec.Workflows
            .OrderBy(w => w.EntityKey, StringComparer.Ordinal)
            .ThenBy(w => w.Key, StringComparer.Ordinal)
            .Select(w =>
            {
                var node = new JsonObject
                {
                    ["entityKey"] = w.EntityKey,
                    ["key"] = w.Key,
                    ["name"] = w.Name
                };
                if (w.Description is not null) node["description"] = w.Description;
                node["trigger"] = StudioWorkflowEnumNames.TriggerName(w.Trigger);
                node["triggerConfig"] = SortedDeep(w.TriggerConfig);
                node["steps"] = SortedDeep(w.Steps);
                node["isActive"] = false; // D-08 : toujours inactif, quelle que soit la spec émise.
                return node;
            })
            .ToArray();
        return Serialize(new JsonObject { ["workflows"] = new JsonArray(workflows) });
    }

    /// <summary>Vue embarquée dans une spec système : jamais de clé « entity » (entité implicite).</summary>
    private static JsonObject RecordViewJson(ParsedRecordViewSpec view)
    {
        var node = new JsonObject
        {
            ["name"] = view.DisplayName,
            ["mode"] = view.Mode,
            ["columns"] = StringArray(view.Columns),
            ["filters"] = RecordViewFiltersJson(view.Filters),
            ["sort"] = RecordViewSortJson(view.Sort)
        };
        if (view.GroupByFieldKey is not null) node["groupBy"] = view.GroupByFieldKey;
        if (view.StartFieldKey is not null) node["start"] = view.StartFieldKey;
        if (view.EndFieldKey is not null) node["end"] = view.EndFieldKey;
        if (view.TitleFieldKey is not null) node["title"] = view.TitleFieldKey;
        node["isDefault"] = view.IsDefault;
        return node;
    }

    /// <summary>Filtres d'une vue : <c>{ "field", "op", "value"? }</c> (value omise quand absente).</summary>
    private static JsonArray RecordViewFiltersJson(IReadOnlyList<RecordViews.RecordViewFilter> filters)
    {
        var array = new JsonArray();
        foreach (var filter in filters)
        {
            var node = new JsonObject
            {
                ["field"] = filter.FieldKey,
                ["op"] = filter.Op
            };
            if (filter.Value is not null) node["value"] = filter.Value.DeepClone();
            array.Add(node);
        }
        return array;
    }

    private static JsonArray RecordViewSortJson(IReadOnlyList<RecordViews.RecordViewSort> sorts) =>
        new(sorts.Select(s => (JsonNode)new JsonObject { ["field"] = s.FieldKey, ["desc"] = s.Descending }).ToArray());

    // ---- Briques communes --------------------------------------------------------------------

    /// <summary>Noms canoniques émis (premier alias de <c>StudioAiAppSpec.TypeAliases</c>).</summary>
    private static string CanonicalTypeName(CustomFieldType type) => type switch
    {
        CustomFieldType.Text => "text",
        CustomFieldType.MultilineText => "multilinetext",
        CustomFieldType.Number => "number",
        CustomFieldType.Decimal => "decimal",
        CustomFieldType.Boolean => "boolean",
        CustomFieldType.Date => "date",
        CustomFieldType.DateTime => "datetime",
        CustomFieldType.Select => "select",
        CustomFieldType.MultiSelect => "multiselect",
        CustomFieldType.Money => "money",
        CustomFieldType.Percentage => "percentage",
        CustomFieldType.Rating => "rating",
        CustomFieldType.QrCode => "qrcode",
        CustomFieldType.Barcode => "barcode",
        CustomFieldType.AutoNumber => "autonumber",
        CustomFieldType.Attachment => "attachment",
        CustomFieldType.Signature => "signature",
        CustomFieldType.RelationCustom => "relation",
        CustomFieldType.RelationExisting => "relation",
        // Jamais produit par les parseurs IA (Formula/Lookup/Rollup exclus à l'entrée) — repli défensif.
        _ => "text"
    };

    private static JsonObject FieldJson(
        string key, string label, CustomFieldType type, bool required, bool unique,
        IReadOnlyList<SelectOptionDto>? options, Dictionary<string, JsonNode?>? config, string? relationToRef)
    {
        var node = new JsonObject
        {
            ["key"] = key,
            ["label"] = label,
            ["type"] = CanonicalTypeName(type),
            ["required"] = required,
            ["unique"] = unique
        };
        if (options is { Count: > 0 }) node["options"] = OptionsJson(options);
        if (config is { Count: > 0 }) node["config"] = ConfigJson(config);
        if (relationToRef is not null) node["relationTo"] = relationToRef;
        return node;
    }

    private static JsonArray OptionsJson(IReadOnlyList<SelectOptionDto> options) =>
        new(options.Select(o => (JsonNode)new JsonObject { ["value"] = o.Value, ["label"] = o.Label }).ToArray());

    /// <summary>Seules les clés produites par les parseurs (currency/max/format), dans cet ordre fixe.</summary>
    private static JsonObject ConfigJson(IReadOnlyDictionary<string, JsonNode?> config)
    {
        var node = new JsonObject();
        foreach (var key in new[] { "currency", "max", "format" })
            if (config.TryGetValue(key, out var value))
                node[key] = value?.DeepClone();
        return node;
    }

    /// <summary>
    /// Nom EXACT de l'énumération (minuscule) — round-trippable via <c>StudioAiAppSpec.TryMapType</c>,
    /// y compris les types interdits en cible (Formula/Lookup/Rollup/…) que <c>change_field_type</c>
    /// doit pouvoir désigner pour être classé Forbidden par la matrice D4, jamais collapsés vers
    /// "text" comme le fait <see cref="CanonicalTypeName"/> (réservé à add_field).
    /// </summary>
    private static string CanonicalChangeFieldTypeName(CustomFieldType type) => type.ToString().ToLowerInvariant();

    /// <summary>Repasse un config arbitraire (change_field_type) tel que reçu, sans en filtrer les clés.</summary>
    private static JsonObject RawConfigJson(IReadOnlyDictionary<string, JsonNode?> config)
    {
        var node = new JsonObject();
        foreach (var kv in config) node[kv.Key] = kv.Value?.DeepClone();
        return node;
    }

    /// <summary>Formulaire : <c>{"sections":[{"title","fields":[{"field","width"?,"label"?}]}]}</c>, clé résolue.</summary>
    private static JsonObject FormJson(ParsedFormSpec form)
    {
        var sections = new JsonArray();
        foreach (var section in form.Sections)
        {
            var fields = new JsonArray();
            foreach (var field in section.Fields)
            {
                var node = new JsonObject { ["field"] = field.Key };
                if (field.Width is not null) node["width"] = field.Width;
                if (field.LabelOverride is not null) node["label"] = field.LabelOverride;
                fields.Add(node);
            }
            var sectionNode = new JsonObject();
            if (section.Title is not null) sectionNode["title"] = section.Title;
            sectionNode["fields"] = fields;
            sections.Add(sectionNode);
        }
        return new JsonObject { ["sections"] = sections };
    }

    private static JsonObject ReportJson(ParsedAppReport report)
    {
        var node = new JsonObject { ["displayName"] = report.DisplayName };
        if (report.Grouping.Count > 0) node["groupBy"] = StringArray(report.Grouping);
        if (report.Aggregations.Count > 0) node["measures"] = MeasuresJson(report.Aggregations);
        if (report.Fields.Count > 0) node["columns"] = StringArray(report.Fields);
        if (report.Filters.Count > 0) node["filters"] = FiltersJson(report.Filters);
        if (report.Sort.Count > 0) node["sort"] = SortJson(report.Sort);
        return node;
    }

    private static JsonArray MeasuresJson(IReadOnlyList<ReportAggregation> measures)
    {
        var array = new JsonArray();
        foreach (var measure in measures)
        {
            var node = new JsonObject();
            if (!string.IsNullOrEmpty(measure.Field)) node["field"] = measure.Field;
            node["fn"] = measure.Fn;
            array.Add(node);
        }
        return array;
    }

    private static JsonArray FiltersJson(IReadOnlyList<ReportFilter> filters)
    {
        var array = new JsonArray();
        foreach (var filter in filters)
        {
            var node = new JsonObject
            {
                ["field"] = filter.Field,
                ["op"] = filter.Op,
                ["value"] = filter.Value?.DeepClone()
            };
            if (filter.Value2 is not null) node["value2"] = filter.Value2.DeepClone();
            array.Add(node);
        }
        return array;
    }

    private static JsonArray SortJson(IReadOnlyList<ReportSort> sorts) =>
        new(sorts.Select(s => (JsonNode)new JsonObject { ["field"] = s.Field, ["dir"] = s.Dir }).ToArray());

    /// <summary>
    /// Copie profonde à clés d'objets triées (ordinal) récursivement ; les tableaux conservent leur
    /// ordre (significatif : étapes, colonnes). Base des formes canoniques à JSON imbriqué libre (4.3).
    /// </summary>
    private static JsonNode? SortedDeep(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                var sorted = new JsonObject();
                foreach (var prop in obj.OrderBy(p => p.Key, StringComparer.Ordinal))
                    sorted[prop.Key] = SortedDeep(prop.Value);
                return sorted;
            case JsonArray arr:
                var copy = new JsonArray();
                foreach (var item in arr)
                    copy.Add(SortedDeep(item));
                return copy;
            default:
                return node?.DeepClone();
        }
    }

    private static JsonArray StringArray(IReadOnlyList<string> values) =>
        new(values.Select(v => (JsonNode)JsonValue.Create(v)).ToArray());

    private static JsonObject RecordJson(IReadOnlyDictionary<string, JsonNode?> record)
    {
        var node = new JsonObject();
        foreach (var kvp in record)
            node[kvp.Key] = kvp.Value?.DeepClone();
        return node;
    }
}
