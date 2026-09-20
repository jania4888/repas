using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// Construit l'aperçu structuré (checklist type « Modèle de données / Formulaires / États / Données »)
/// d'un plan Studio IA, rendu par le frontend avant confirmation. Pur (pas de DB), sérialisé en JSON
/// camelCase dans <c>StudioAiBuildPlan.SummaryJson</c>.
/// </summary>
public static class StudioAiPlanSummary
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public sealed record SummaryStep(string Key, string Label, string Detail);

    /// <summary><paramref name="ExistingKey"/> non null = table existante réutilisée telle quelle
    /// (propriété omise du JSON quand null : les tables créées n'encombrent pas l'aperçu).
    /// <paramref name="ViewCount"/> : nombre de vues enregistrées proposées (PR 2.4) — omis du JSON
    /// quand 0, pour ne pas changer la forme des aperçus existants.</summary>
    public sealed record SummaryEntity(
        string DisplayName,
        int FieldCount,
        int RelationCount,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ExistingKey = null,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] int ViewCount = 0);

    /// <summary>
    /// Une relation plusieurs-à-plusieurs de l'aperçu (PR 2.2) : libellés d'affichage des deux tables
    /// (jamais de ref interne, l'aperçu ne montre que des noms lisibles) et nom de la jonction si fourni.
    /// </summary>
    public sealed record SummaryRelation(string FromDisplayName, string ToDisplayName, string Kind, string? JunctionName);

    /// <summary>Une étape d'un workflow proposé : clé, type figé (StudioWorkflowStepTypes) et libellé FR.</summary>
    public sealed record SummaryWorkflowStep(string Key, string Type, string Label);

    /// <summary>
    /// Un workflow proposé par l'IA (PR 4.3c) : contrat figé lu par l'onglet « Workflows » de l'aperçu (4.4k).
    /// <c>IsActive</c> est toujours false — l'utilisateur active après relecture. <c>Trigger</c> = nom snake_case
    /// figé (StudioWorkflowEnumNames.TriggerName).
    /// </summary>
    public sealed record SummaryWorkflow(
        string Key,
        string Name,
        string EntityKey,
        string EntityDisplayName,
        string Trigger,
        int StepCount,
        IReadOnlyList<SummaryWorkflowStep> Steps,
        bool IsActive);

    /// <summary>
    /// <paramref name="Sample"/> : quelques VRAIES lignes déjà calculées, jointes à l'aperçu d'un état.
    /// L'utilisateur valide alors sur des chiffres, pas sur une promesse. Paramètre optionnel en fin de
    /// record : les aperçus existants (table, système, fenêtre) sont inchangés.
    /// <paramref name="Duplicates"/> : indices de doublons (table proposée ≈ table existante) — la clé
    /// <c>duplicates</c> est TOUJOURS émise dans le JSON (tableau vide par défaut, jamais null) pour
    /// que le bandeau d'aperçu ait une forme stable.
    /// <paramref name="Relations"/> : relations plusieurs-à-plusieurs déclarées (PR 2.2) ; comme
    /// <c>duplicates</c>, la clé <c>relations</c> est TOUJOURS émise en tableau (vide par défaut).
    /// <paramref name="Workflows"/> : workflows proposés (PR 4.3c, contrat brief §D) ; comme
    /// <c>duplicates</c>, la clé <c>workflows</c> est TOUJOURS émise en tableau (vide par défaut).
    /// </summary>
    public sealed record PlanSummary(
        string Kind,
        string Title,
        IReadOnlyList<SummaryStep> Steps,
        IReadOnlyList<SummaryEntity> Entities,
        IReadOnlyList<string> Warnings,
        Common.ReportResultDto? Sample = null,
        IReadOnlyList<DuplicateHint>? Duplicates = null,
        IReadOnlyList<SummaryRelation>? Relations = null,
        IReadOnlyList<SummaryWorkflow>? Workflows = null);

    /// <summary>
    /// Un avertissement en clair par indice de doublon : l'utilisateur voit POURQUOI la table est
    /// signalée et comment la réutiliser (<c>existingKey</c>) au lieu de la recréer.
    /// </summary>
    internal static List<string> DuplicateWarnings(IReadOnlyList<DuplicateHint>? duplicates) =>
        duplicates?.Select(d =>
            $"Table « {d.SpecDisplayName} » : une table existante « {d.ExistingDisplayName} » (clé « {d.ExistingKey} ») semble équivalente"
            + " — réutilisez-la plutôt que de la recréer (\"existingKey\" dans la spec).").ToList()
        ?? new List<string>();

    public static string ForSystem(ParsedSystemSpec spec, IReadOnlyList<DuplicateHint>? duplicates = null)
    {
        var entities = spec.Entities
            .Select(e => new SummaryEntity(
                e.EntityDisplayName,
                e.Fields.Count,
                e.Fields.Count(f => f.FieldType is CustomFieldType.RelationCustom or CustomFieldType.RelationExisting),
                e.ExistingKey,
                e.Views.Count))
            .ToList();

        var created = entities.Where(e => e.ExistingKey is null).ToList();
        var totalFields = created.Sum(e => e.FieldCount);
        var totalRelations = created.Sum(e => e.RelationCount);
        var formCount = spec.Entities.Count(e => e.ExistingKey is null && e.Form is not null);
        var reportCount = spec.Entities.Count(e => e.ExistingKey is null && e.Report is not null);
        var seedCount = spec.Seed.Sum(s => s.Records.Count);

        var steps = new List<SummaryStep>
        {
            new("data_model", "Modèle de données",
                $"{created.Count} table(s) | {totalFields} champ(s)"
                + (totalRelations > 0 ? $" | {totalRelations} relation(s)" : string.Empty))
        };
        var displayNameByRef = spec.Entities.ToDictionary(e => e.Ref, e => e.EntityDisplayName, StringComparer.Ordinal);
        string DisplayNameOf(string r) => displayNameByRef.TryGetValue(r, out var name) ? name : r;
        // Étape « relations » juste après « data_model » (ordre figé par la spec pr-2.2).
        if (spec.Relations.Count > 0)
        {
            steps.Add(new SummaryStep("relations", "Relations plusieurs-à-plusieurs",
                $"{spec.Relations.Count} relation(s) — tables de liaison : " + string.Join(", ", spec.Relations.Select(r =>
                    string.IsNullOrWhiteSpace(r.JunctionName)
                        ? $"{DisplayNameOf(r.FromRef)} ↔ {DisplayNameOf(r.ToRef)}"
                        : r.JunctionName))));
        }
        var reusedCount = entities.Count(e => e.ExistingKey is not null);
        if (reusedCount > 0)
            steps.Add(new SummaryStep("reuse", "Tables réutilisées",
                $"{reusedCount} table(s) existante(s) reprise(s) telle(s) quelle(s)"));

        if (formCount > 0)
            steps.Add(new SummaryStep("forms", "Formulaires", $"{formCount} formulaire(s) personnalisé(s)"));
        if (reportCount > 0)
            steps.Add(new SummaryStep("reports", "États", $"{reportCount} état(s)"));
        // Vues enregistrées proposées par entité (PR 2.4) : après les états, avant le seed.
        var viewCount = spec.Entities.Sum(e => e.Views.Count);
        if (viewCount > 0)
            steps.Add(new SummaryStep("views", "Vues",
                $"{viewCount} vue(s) : " + string.Join(", ", spec.Entities
                    .SelectMany(e => e.Views)
                    .Select(v => $"{v.DisplayName} ({StudioAiRecordViewSpec.ModeLabel(v.Mode)})"))));
        if (seedCount > 0)
            steps.Add(new SummaryStep("seed", "Données de référence", $"{seedCount} enregistrement(s)"));
        if (spec.OnboardingSteps is { Count: > 0 })
            steps.Add(new SummaryStep("onboarding", "Guide de démarrage", $"{spec.OnboardingSteps.Count} étape(s)"));

        var warnings = new List<string>(spec.Warnings ?? Array.Empty<string>());
        warnings.AddRange(DuplicateWarnings(duplicates));

        var summaryRelations = spec.Relations
            .Select(r => new SummaryRelation(DisplayNameOf(r.FromRef), DisplayNameOf(r.ToRef), r.Kind, r.JunctionName))
            .ToList();

        // Duplicates/Relations peuvent rester null ici : Serialize émet toujours un tableau (vide par défaut).
        return Serialize(new PlanSummary(
            StudioAiPlanKind.CreateSystem.ToString(), spec.SystemDisplayName, steps, entities, warnings,
            Duplicates: duplicates, Relations: summaryRelations));
    }

    public static string ForApp(ParsedAppSpec spec, IReadOnlyList<DuplicateHint>? duplicates = null)
    {
        var steps = new List<SummaryStep>
        {
            new("data_model", "Modèle de données", $"1 table | {spec.Fields.Count} champ(s)")
        };
        if (spec.Report is not null)
            steps.Add(new SummaryStep("reports", "États", $"1 état (« {spec.Report.DisplayName} »)"));

        var entities = new List<SummaryEntity> { new(spec.EntityDisplayName, spec.Fields.Count, 0) };
        return Serialize(new PlanSummary(
            StudioAiPlanKind.CreateApp.ToString(), spec.EntityDisplayName, steps, entities,
            DuplicateWarnings(duplicates), Duplicates: duplicates));
    }

    public static string ForView(
        string title, string table, Common.ViewDefinition definition, IReadOnlyList<string> warnings)
    {
        var steps = new List<SummaryStep>
        {
            new("view_source", "Table source", table),
            new("view_columns", "Colonnes affichées",
                string.Join(", ", definition.Columns.Take(8).Select(c => c.Label ?? c.Name))
                + (definition.Columns.Count > 8 ? $" (+{definition.Columns.Count - 8})" : string.Empty))
        };
        if (definition.Search)
            steps.Add(new SummaryStep("view_search", "Recherche", "activée"));

        return Serialize(new PlanSummary(
            StudioAiPlanKind.View.ToString(), title, steps,
            Array.Empty<SummaryEntity>(), warnings));
    }

    /// <summary>
    /// Aperçu d'un ÉTAT : source, axes d'analyse, mesures, filtres — et un échantillon de lignes
    /// réellement calculées. Rien n'est enregistré tant que l'utilisateur n'a pas validé.
    /// </summary>
    public static string ForReport(
        string title,
        string sourceLabel,
        Common.ReportDefinition definition,
        Common.ReportResultDto sample,
        IReadOnlyList<string> warnings)
    {
        string LabelOf(string key) =>
            sample.Columns.FirstOrDefault(c => string.Equals(c.Key, key, StringComparison.Ordinal))?.Label ?? key;

        var steps = new List<SummaryStep> { new("report_source", "Source", sourceLabel) };

        if (definition.Grouping.Count > 0)
        {
            steps.Add(new SummaryStep("report_group", "Analysé par",
                string.Join(", ", definition.Grouping.Select(LabelOf))));
            steps.Add(new SummaryStep("report_measures", "Mesures",
                string.Join(", ", sample.Columns.Where(c => c.Kind == "measure").Select(c => c.Label))));
        }
        else
        {
            steps.Add(new SummaryStep("report_columns", "Colonnes",
                string.Join(", ", sample.Columns.Take(8).Select(c => c.Label))
                + (sample.Columns.Count > 8 ? $" (+{sample.Columns.Count - 8})" : string.Empty)));
        }

        if (definition.Filters.Count > 0)
            steps.Add(new SummaryStep("report_filters", "Filtres",
                string.Join(" ; ", definition.Filters.Select(f => $"{LabelOf(f.Field)} {f.Op}"))));

        if (definition.Sort.Count > 0)
            steps.Add(new SummaryStep("report_sort", "Tri",
                string.Join(", ", definition.Sort.Select(s => $"{LabelOf(s.Field)} {(s.Dir == "desc" ? "↓" : "↑")}"))));

        steps.Add(new SummaryStep("report_sample", "Aperçu des données",
            sample.TotalRows == 0
                ? "aucune donnée sur cette période"
                : $"{sample.Rows.Count} ligne(s) affichée(s) sur {sample.TotalRows}"));

        return Serialize(new PlanSummary(
            StudioAiPlanKind.Report.ToString(), title, steps,
            Array.Empty<SummaryEntity>(), warnings, sample));
    }

    /// <summary>
    /// Aperçu d'une VUE ENREGISTRÉE proposée (PR 2.4) : table cible, mode, volumétrie des
    /// colonnes/filtres. Quand la spec a été résolue contre le schéma réel, l'appelant passe la spec
    /// ajustée (mode dégradé inclus) et les avertissements de résolution.
    /// </summary>
    public static string ForRecordView(
        ParsedRecordViewSpec spec, string entityDisplayName, IReadOnlyList<string> warnings)
    {
        var steps = new List<SummaryStep>
        {
            new("target", "Table", entityDisplayName),
            new("mode", "Mode", StudioAiRecordViewSpec.ModeLabel(spec.Mode)),
            new("columns", "Colonnes", $"{spec.Columns.Count}")
        };
        if (spec.Filters.Count > 0)
            steps.Add(new SummaryStep("filters", "Filtres", $"{spec.Filters.Count}"));
        if (spec.IsDefault)
            steps.Add(new SummaryStep("default", "Vue par défaut", "oui"));

        return Serialize(new PlanSummary(
            StudioAiPlanKind.RecordView.ToString(), $"Vue « {spec.DisplayName} » sur {entityDisplayName}",
            steps, Array.Empty<SummaryEntity>(), warnings));
    }

    /// <summary>
    /// Résumé d'un plan Workflow (PR 4.3c) : une ligne de checklist par workflow, la clé <c>workflows</c>
    /// remplie (contrat figé brief §D), <c>entities</c> = tables touchées (existantes : <c>existingKey</c>
    /// renseigné, lu par la carte d'aperçu 4.4k). Pur : les schémas réels sont passés en paramètre ;
    /// table absente du dictionnaire ⇒ clé affichée telle quelle, 0 champ.
    /// </summary>
    public static string ForWorkflow(
        ParsedWorkflowPlanSpec spec,
        IReadOnlyDictionary<string, CustomEntitySchemaDto> schemasByEntityKey,
        IReadOnlyList<string> warnings)
    {
        var workflows = spec.Workflows.Select(w => ToSummaryWorkflow(w, DisplayNameOf(w.EntityKey, schemasByEntityKey))).ToList();
        var steps = workflows.Select(w => new SummaryStep(
            w.Key, w.Name,
            $"{w.EntityDisplayName} · {TriggerLabel(w.Trigger)} · {w.StepCount} étape(s) · créé inactif")).ToList();
        var entities = spec.Workflows.Select(w => w.EntityKey).Distinct(StringComparer.Ordinal)
            .Select(key => schemasByEntityKey.TryGetValue(key, out var schema)
                ? new SummaryEntity(schema.Entity.DisplayName, schema.Fields.Count, schema.Relations?.Count ?? 0, ExistingKey: key)
                : new SummaryEntity(key, 0, 0, ExistingKey: key))
            .ToList();
        var title = $"{workflows.Count} workflow{(workflows.Count > 1 ? "s" : "")} sur {string.Join(", ", entities.Select(e => e.DisplayName))}";
        return Serialize(new PlanSummary(
            StudioAiPlanKind.Workflow.ToString(), title, steps, entities, warnings,
            Workflows: workflows));
    }

    private static SummaryWorkflow ToSummaryWorkflow(ParsedWorkflowItem item, string entityDisplayName)
    {
        var steps = new List<SummaryWorkflowStep>();
        if (item.Steps["steps"] is JsonArray array)
            foreach (var node in array.OfType<JsonObject>())
            {
                var type = node["type"]?.GetValue<string>() ?? "";
                var label = node["label"]?.GetValue<string>() ?? StepTypeLabel(type);
                steps.Add(new SummaryWorkflowStep(node["key"]?.GetValue<string>() ?? "", type, label));
            }
        return new SummaryWorkflow(item.Key, item.Name, item.EntityKey, entityDisplayName,
            StudioWorkflowEnumNames.TriggerName(item.Trigger), steps.Count, steps, IsActive: false);
    }

    private static string StepTypeLabel(string type) =>
        StudioWorkflowStepTypes.Catalog().FirstOrDefault(e => e.Type == type)?.Label ?? type;

    private static string TriggerLabel(string trigger) => trigger switch
    {
        "on_create" => "à la création", "on_update" => "à la modification",
        "field_changed" => "au changement d'un champ", "manual" => "manuel", _ => trigger
    };

    private static string DisplayNameOf(string entityKey, IReadOnlyDictionary<string, CustomEntitySchemaDto> schemas) =>
        schemas.TryGetValue(entityKey, out var s) && !string.IsNullOrWhiteSpace(s.Entity.DisplayName) ? s.Entity.DisplayName : entityKey;

    /// <summary><c>duplicates</c>, <c>relations</c> et <c>workflows</c> sont TOUJOURS présents dans le JSON (tableau vide par défaut).</summary>
    private static string Serialize(PlanSummary summary) => JsonSerializer.Serialize(
        summary with
        {
            Duplicates = summary.Duplicates ?? Array.Empty<DuplicateHint>(),
            Relations = summary.Relations ?? Array.Empty<SummaryRelation>(),
            Workflows = summary.Workflows ?? Array.Empty<SummaryWorkflow>()
        },
        Options);
}
