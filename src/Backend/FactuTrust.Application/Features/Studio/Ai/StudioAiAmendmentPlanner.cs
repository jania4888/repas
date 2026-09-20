using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Relations;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>Une ligne de l'aperçu de modification : ce qui change, avant → après, et son risque.</summary>
public sealed record AmendmentPreviewItem(
    string Op,
    string Target,
    string? Before,
    string? After,
    string Severity,
    string? Warning);

public sealed record AmendmentPreview(
    string EntityKey,
    string EntityDisplayName,
    IReadOnlyList<AmendmentPreviewItem> Items,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Calcule le diff « avant → après » d'une modification de table Studio, et résout les références de
/// champ brutes émises par le modèle contre le schéma RÉEL. Pur (aucun accès base) : l'appelant fournit
/// le schéma. Les mêmes fonctions de résolution servent à l'aperçu et à l'exécution, de sorte que ce que
/// l'utilisateur valide est exactement ce qui sera appliqué.
/// </summary>
public static class StudioAiAmendmentPlanner
{
    private static readonly JsonSerializerOptions SummaryOptions = new(JsonSerializerDefaults.Web);

    /// <param name="manyToManyEnabled">
    /// Garde <c>EnableStudioManyToMany</c> (PR 3.1b) : une opération <c>add_relation</c> de type
    /// plusieurs-à-plusieurs est écartée avec un avertissement explicite quand le drapeau est coupé.
    /// </param>
    /// <param name="recordViewsEnabled">
    /// Garde <c>EnableStudioRecordViews</c> (PR 3.1b) : une opération <c>set_view</c> est écartée avec
    /// un avertissement explicite quand le drapeau est coupé.
    /// </param>
    public static AmendmentPreview BuildPreview(
        ParsedAmendmentSpec spec, CustomEntitySchemaDto schema,
        bool manyToManyEnabled = false, bool recordViewsEnabled = false)
    {
        var items = new List<AmendmentPreviewItem>();
        var warnings = new List<string>(spec.Warnings);
        var activeFields = schema.Fields.Where(f => f.IsActive).ToList();

        foreach (var op in spec.Operations)
        {
            switch (op)
            {
                case AddFieldOp add:
                {
                    var clash = activeFields.FirstOrDefault(f =>
                        string.Equals(f.Label, add.Field.Label, StringComparison.OrdinalIgnoreCase));
                    items.Add(new AmendmentPreviewItem("add_field", add.Field.Label, null,
                        DescribeNewField(add.Field), "info",
                        clash is null ? null : $"Un champ « {clash.Label} » existe déjà : le nouveau champ recevra une clé distincte."));
                    break;
                }
                case UpdateFieldOp upd:
                {
                    var target = ResolveField(upd.FieldRef, activeFields);
                    if (target is null)
                    {
                        warnings.Add($"Champ « {upd.FieldRef} » introuvable : modification ignorée.");
                        break;
                    }
                    items.Add(new AmendmentPreviewItem("update_field", target.Label,
                        DescribeField(target), DescribeUpdatedField(target, upd), "info", null));
                    break;
                }
                case RemoveFieldOp rem:
                {
                    var target = ResolveField(rem.FieldRef, activeFields);
                    if (target is null)
                    {
                        warnings.Add($"Champ « {rem.FieldRef} » introuvable : retrait ignoré.");
                        break;
                    }
                    items.Add(new AmendmentPreviewItem("remove_field", target.Label,
                        DescribeField(target), "retiré du formulaire", "warning",
                        "Les valeurs déjà saisies sont CONSERVÉES ; le champ est seulement masqué."));
                    break;
                }
                case UpdateEntityOp ent:
                {
                    items.Add(new AmendmentPreviewItem("update_entity", schema.Entity.DisplayName,
                        schema.Entity.DisplayName,
                        ent.DisplayName ?? schema.Entity.DisplayName, "info", null));
                    break;
                }
                case SetFormOp form:
                {
                    var layout = ResolveForm(form.FormNode, activeFields);
                    if (layout is null || layout.Sections.Count == 0)
                    {
                        warnings.Add("Mise en page du formulaire ignorée : aucun champ reconnu.");
                        break;
                    }
                    var after = string.Join(" | ", layout.Sections.Select(s =>
                        $"{s.Title ?? "Section"} ({s.Fields.Count})"));
                    items.Add(new AmendmentPreviewItem("set_form", "Formulaire",
                        $"{schema.Form.Sections.Count} section(s)", after, "warning",
                        "La mise en page actuelle du formulaire sera remplacée."));
                    break;
                }
                case SetReportOp report:
                {
                    var def = ResolveReport(report.ReportNode, activeFields);
                    if (def is null)
                    {
                        warnings.Add("État ignoré : aucun champ reconnu dans la définition.");
                        break;
                    }
                    items.Add(new AmendmentPreviewItem("set_report", report.DisplayName ?? "Rapport",
                        null, DescribeReport(def), "info", null));
                    break;
                }
                case ReorderFieldsOp reorder:
                {
                    var orderedKeys = new List<string>();
                    foreach (var raw in reorder.FieldRefs)
                    {
                        var target = ResolveField(raw, activeFields);
                        if (target is null)
                        {
                            warnings.Add($"Champ « {raw} » introuvable : retiré de la réorganisation.");
                            continue;
                        }
                        if (!orderedKeys.Contains(target.Key)) orderedKeys.Add(target.Key);
                    }
                    if (orderedKeys.Count == 0)
                    {
                        warnings.Add("Réorganisation des champs ignorée : aucun champ reconnu.");
                        break;
                    }
                    // Ordre EFFECTIF promis à l'exécution : les champs cités d'abord (dans l'ordre
                    // demandé), puis les champs non cités dans leur ordre actuel.
                    var effectiveOrder = orderedKeys
                        .Concat(activeFields.Select(f => f.Key).Where(k => !orderedKeys.Contains(k)))
                        .Select(k => activeFields.First(f => f.Key == k).Label);
                    items.Add(new AmendmentPreviewItem("reorder_fields", schema.Entity.DisplayName,
                        string.Join(", ", activeFields.Select(f => f.Label)),
                        string.Join(", ", effectiveOrder), "info", null));
                    break;
                }
                case ChangeFieldTypeOp changeType:
                {
                    var target = ResolveField(changeType.FieldRef, activeFields);
                    if (target is null)
                    {
                        warnings.Add($"Champ « {changeType.FieldRef} » introuvable : changement de type ignoré.");
                        break;
                    }
                    var policy = FieldTypeConversionPolicy.Classify(target.FieldType, changeType.FieldType);
                    var severity = policy switch
                    {
                        FieldTypeConversion.Lossless => "info",
                        FieldTypeConversion.RequiresEmptyTable => "warning",
                        _ => "error"
                    };
                    // Le planificateur est pur : le nombre d'enregistrements n'est connu qu'à
                    // l'application (recomptage dans ChangeCustomFieldTypeCommand). Le message de
                    // l'aperçu ne doit donc PAS citer un compte qui serait fabriqué.
                    var message = policy == FieldTypeConversion.RequiresEmptyTable
                        ? "Ce changement exige une table vide : le nombre d'enregistrements sera vérifié à l'application."
                        : FieldTypeConversionPolicy.Describe(target.FieldType, changeType.FieldType);
                    items.Add(new AmendmentPreviewItem("change_field_type", target.Label,
                        TypeLabel(target.FieldType), TypeLabel(changeType.FieldType), severity, message));
                    break;
                }
                case AddRelationOp relation:
                {
                    if (relation.Kind == EntityRelationKinds.ManyToMany && !manyToManyEnabled)
                    {
                        warnings.Add($"Relation vers « {relation.TargetRef} » ignorée : les relations plusieurs-à-plusieurs ne sont pas activées.");
                        break;
                    }
                    var label = string.IsNullOrWhiteSpace(relation.Label) ? relation.TargetRef : relation.Label!;
                    var kindLabel = relation.Kind == EntityRelationKinds.ManyToMany ? "plusieurs-à-plusieurs" : "plusieurs-à-un";
                    // Contraintes de la jonction vérifiables sur le seul schéma de la table modifiée
                    // (miroir de CreateManyToManyRelationCommand) ; l'existence et le caractère
                    // « standard » de la CIBLE sont revérifiés à l'exécution.
                    string? blocking = null;
                    if (relation.Kind == EntityRelationKinds.ManyToMany)
                    {
                        if (string.Equals(relation.TargetRef, schema.Entity.Key, StringComparison.OrdinalIgnoreCase))
                            blocking = "La table cible doit être différente de la table source.";
                        else if (schema.Entity.Kind == CustomEntityKind.Junction)
                            blocking = "La table source doit être une table standard active.";
                    }
                    items.Add(new AmendmentPreviewItem("add_relation", label, null,
                        $"relation {kindLabel} vers « {relation.TargetRef} »",
                        blocking is null ? "info" : "error", blocking));
                    break;
                }
                case AssignSystemOp assign:
                {
                    items.Add(new AmendmentPreviewItem("assign_system", assign.SystemRef ?? string.Empty, null,
                        assign.SystemRef is null
                            ? "détachée de son système actuel"
                            : $"rattachée au système « {assign.SystemRef} »",
                        "info", null));
                    break;
                }
                case SetViewOp view:
                {
                    if (!recordViewsEnabled)
                    {
                        warnings.Add($"Vue « {view.View.DisplayName} » ignorée : les vues enregistrées ne sont pas activées.");
                        break;
                    }
                    // Résolution contre le schéma RÉEL (mêmes règles qu'à l'enregistrement manuel et
                    // qu'à l'outil studio_plan_record_view) : clés inconnues écartées avec
                    // avertissement, kanban sans liste de choix / calendrier sans champ date
                    // dégradés en liste avec avertissement.
                    var (viewMode, viewDefinition, viewWarnings) =
                        StudioAiRecordViewSpec.ResolveAgainstSchema(view.View, schema.Fields);
                    foreach (var viewWarning in viewWarnings) warnings.Add(viewWarning);
                    items.Add(new AmendmentPreviewItem("set_view", view.View.DisplayName, null,
                        DescribeResolvedView(viewMode, viewDefinition), "info", null));
                    break;
                }
                case SetAutomationOp:
                {
                    items.Add(new AmendmentPreviewItem("set_automation", "Automatisation", null,
                        "déclarée mais non appliquée", "info",
                        "Les automatisations ne sont pas encore créées par l'assistant : étape ignorée."));
                    break;
                }
            }
        }

        return new AmendmentPreview(schema.Entity.Key, schema.Entity.DisplayName, items, warnings);
    }

    /// <summary>Sérialise l'aperçu au format attendu par la carte de validation du frontend.</summary>
    public static string ToSummaryJson(AmendmentPreview preview)
    {
        var steps = preview.Items
            .Select(i => new StudioAiPlanSummary.SummaryStep(i.Op, StepLabel(i), StepDetail(i)))
            .ToList();

        var summary = new StudioAiPlanSummary.PlanSummary(
            StudioAiPlanKind.Amendment.ToString(),
            $"Modification de « {preview.EntityDisplayName} »",
            steps,
            // Pas de pastilles « table » ici : les étapes portent déjà le détail du diff, et un
            // compteur de champs serait trompeur sur une modification.
            Array.Empty<StudioAiPlanSummary.SummaryEntity>(),
            preview.Warnings.Concat(preview.Items.Where(i => i.Warning is not null).Select(i => i.Warning!))
                .Distinct().ToList());

        return JsonSerializer.Serialize(summary, SummaryOptions);
    }

    // ---- Résolution partagée aperçu / exécution ----

    /// <summary>Résout une référence brute (clé exacte, clé slugifiée ou libellé) vers un champ actif.</summary>
    public static CustomFieldDto? ResolveField(string raw, IReadOnlyList<CustomFieldDto> fields)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var trimmed = raw.Trim();
        var exact = fields.FirstOrDefault(f => string.Equals(f.Key, trimmed, StringComparison.Ordinal));
        if (exact is not null) return exact;

        var slug = StudioAiAppSpec.SlugKey(trimmed);
        return fields.FirstOrDefault(f => string.Equals(f.Key, slug, StringComparison.Ordinal))
            ?? fields.FirstOrDefault(f => string.Equals(StudioAiAppSpec.SlugKey(f.Label), slug, StringComparison.Ordinal));
    }

    /// <summary>
    /// Construit une mise en page à partir du nœud émis par le modèle. Accepte, pour chaque entrée,
    /// une chaîne (clé/libellé) ou un objet { field, width, label } ; toute référence non résolue est
    /// écartée — la sanitisation côté commande reste le dernier filet.
    /// </summary>
    public static FormLayout? ResolveForm(JsonNode formNode, IReadOnlyList<CustomFieldDto> fields)
    {
        var sectionsArr = (formNode["sections"] ?? formNode)?.AsArray();
        if (sectionsArr is null) return null;

        var sections = new List<FormSection>();
        foreach (var sec in sectionsArr)
        {
            var refs = new List<FormFieldRef>();
            foreach (var entry in sec?["fields"]?.AsArray() ?? new JsonArray())
            {
                string? raw;
                string? width = null;
                string? labelOverride = null;
                if (entry is JsonObject o)
                {
                    raw = AsString(o["field"]) ?? AsString(o["key"]) ?? AsString(o["name"]);
                    width = string.Equals(AsString(o["width"]), "half", StringComparison.OrdinalIgnoreCase) ? "half" : "full";
                    labelOverride = AsString(o["label"]) ?? AsString(o["labelOverride"]);
                }
                else
                {
                    raw = AsString(entry);
                }
                if (raw is null) continue;
                var field = ResolveField(raw, fields);
                if (field is null) continue;
                refs.Add(new FormFieldRef
                {
                    Key = field.Key,
                    Width = width ?? "full",
                    LabelOverride = string.IsNullOrWhiteSpace(labelOverride) ? null : labelOverride!.Trim()
                });
            }
            if (refs.Count > 0)
                sections.Add(new FormSection { Title = AsString(sec?["title"]), Fields = refs });
        }
        return sections.Count > 0 ? new FormLayout { Sections = sections } : null;
    }

    /// <summary>Construit une définition d'état en résolvant ses références contre les champs réels.</summary>
    public static ReportDefinition? ResolveReport(JsonNode reportNode, IReadOnlyList<CustomFieldDto> fields)
    {
        var parsed = StudioAiAppSpec.ParseReportForFields(
            reportNode, fields.Select(f => (f.Key, f.Label)).ToList());
        if (parsed is null) return null;

        return new ReportDefinition
        {
            Fields = parsed.Fields,
            Filters = parsed.Filters,
            Grouping = parsed.Grouping,
            Aggregations = parsed.Aggregations,
            Sort = parsed.Sort
        };
    }

    // ---- Descriptions lisibles ----

    private static string StepLabel(AmendmentPreviewItem item) => item.Op switch
    {
        "add_field" => $"Ajouter « {item.Target} »",
        "update_field" => $"Modifier « {item.Target} »",
        "remove_field" => $"Retirer « {item.Target} »",
        "update_entity" => "Renommer la table",
        "set_form" => "Réorganiser le formulaire",
        "set_report" => $"État « {item.Target} »",
        "reorder_fields" => "Réordonner les champs",
        "change_field_type" => $"Changer le type de « {item.Target} »",
        "add_relation" => $"Relier à « {item.Target} »",
        "assign_system" => item.Target.Length == 0
            ? "Détacher la table de son système"
            : $"Rattacher au système « {item.Target} »",
        "set_view" => $"Vue « {item.Target} »",
        "set_automation" => "Automatisation (non appliquée)",
        _ => item.Target
    };

    private static string StepDetail(AmendmentPreviewItem item) =>
        item.Before is null ? item.After ?? string.Empty : $"{item.Before} → {item.After}";

    private static string DescribeField(CustomFieldDto f)
    {
        var flags = new List<string> { TypeLabel(f.FieldType) };
        if (f.IsRequired) flags.Add("obligatoire");
        if (f.IsUnique) flags.Add("unique");
        return string.Join(", ", flags);
    }

    private static string DescribeNewField(ParsedAppField f)
    {
        var flags = new List<string> { TypeLabel(f.FieldType) };
        if (f.Required) flags.Add("obligatoire");
        if (f.Unique) flags.Add("unique");
        if (f.Options is { Count: > 0 }) flags.Add($"{f.Options.Count} option(s)");
        return string.Join(", ", flags);
    }

    private static string DescribeUpdatedField(CustomFieldDto before, UpdateFieldOp op)
    {
        var flags = new List<string> { TypeLabel(before.FieldType) };
        if (op.Label is not null && !string.Equals(op.Label, before.Label, StringComparison.Ordinal))
            flags.Insert(0, $"libellé « {op.Label} »");
        var required = op.Required ?? before.IsRequired;
        var unique = op.Unique ?? before.IsUnique;
        if (required) flags.Add("obligatoire");
        if (unique) flags.Add("unique");
        if (op.AddOptions is { Count: > 0 }) flags.Add($"+{op.AddOptions.Count} option(s)");
        return string.Join(", ", flags);
    }

    private static string DescribeReport(ReportDefinition def)
    {
        var parts = new List<string>();
        if (def.Grouping.Count > 0) parts.Add($"{def.Grouping.Count} regroupement(s)");
        if (def.Aggregations.Count > 0) parts.Add($"{def.Aggregations.Count} mesure(s)");
        if (def.Fields.Count > 0) parts.Add($"{def.Fields.Count} colonne(s)");
        if (def.Filters.Count > 0) parts.Add($"{def.Filters.Count} filtre(s)");
        if (def.Sort.Count > 0) parts.Add($"{def.Sort.Count} tri(s)");
        return parts.Count > 0 ? string.Join(", ", parts) : "état vide";
    }

    /// <summary>
    /// Décrit la vue RÉELLEMENT enregistrée après résolution (mode éventuellement dégradé en liste,
    /// colonnes/filtres/tris effectifs) — l'aperçu promet ce que <c>ResolveAgainstSchema</c> produit.
    /// </summary>
    private static string DescribeResolvedView(CustomRecordViewMode mode, RecordViewDefinition definition)
    {
        var parts = new List<string>
        {
            $"vue {StudioAiRecordViewSpec.ModeLabel(StudioAiRecordViewSpec.ModeKey(mode))}",
            $"{definition.Columns.Count} colonne(s)"
        };
        if (definition.Kanban is not null) parts.Add($"regroupée par « {definition.Kanban.GroupByFieldKey} »");
        if (definition.Calendar is not null) parts.Add($"début « {definition.Calendar.StartFieldKey} »");
        if (definition.Filters.Count > 0) parts.Add($"{definition.Filters.Count} filtre(s)");
        if (definition.Sort.Count > 0) parts.Add($"{definition.Sort.Count} tri(s)");
        return string.Join(", ", parts);
    }

    /// <summary>Libellé français d'un type de champ (aperçu ET messages d'exécution).</summary>
    public static string TypeLabel(CustomFieldType type) => type switch
    {
        CustomFieldType.Text => "texte",
        CustomFieldType.MultilineText => "texte long",
        CustomFieldType.Number => "nombre",
        CustomFieldType.Decimal => "décimal",
        CustomFieldType.Money => "montant",
        CustomFieldType.Percentage => "pourcentage",
        CustomFieldType.Rating => "note",
        CustomFieldType.Boolean => "oui/non",
        CustomFieldType.Date => "date",
        CustomFieldType.DateTime => "date et heure",
        CustomFieldType.Select => "liste",
        CustomFieldType.MultiSelect => "choix multiple",
        CustomFieldType.Attachment => "pièce jointe",
        CustomFieldType.Signature => "signature",
        CustomFieldType.QrCode => "QR code",
        CustomFieldType.Barcode => "code-barres",
        CustomFieldType.AutoNumber => "numéro auto",
        CustomFieldType.RelationCustom => "relation",
        CustomFieldType.RelationExisting => "relation ERP",
        CustomFieldType.Formula => "formule",
        CustomFieldType.Lookup => "recherche",
        CustomFieldType.Rollup => "agrégat",
        _ => type.ToString().ToLowerInvariant()
    };

    private static string? AsString(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<string>(out var s)) return string.IsNullOrWhiteSpace(s) ? null : s;
        return v.ToString();
    }
}
