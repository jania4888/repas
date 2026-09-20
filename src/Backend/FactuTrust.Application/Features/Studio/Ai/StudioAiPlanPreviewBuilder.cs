using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

// ---- DTO de l'aperçu structuré d'un plan (PR 3.2b) — sérialisés en camelCase (JsonSerializerDefaults.Web). ----

/// <summary>Un champ d'entité projeté pour l'aperçu. <see cref="Options"/> : libellés des choix (select).</summary>
public sealed record PreviewField(string Key, string Label, string FieldType, bool Required, bool Unique, IReadOnlyList<string>? Options, string? RelationToRef);

/// <summary>Référence de champ dans une section de formulaire (E2 : objets, pas de chaînes).</summary>
public sealed record PreviewFormFieldRef(string Key, string? Width, string? LabelOverride);

public sealed record PreviewFormSection(string Title, IReadOnlyList<PreviewFormFieldRef> Fields);

public sealed record PreviewFormLayout(IReadOnlyList<PreviewFormSection> Sections);

/// <summary>Une vue enregistrée proposée. <see cref="Mode"/> = clé normalisée (list | kanban | calendar).</summary>
public sealed record PreviewView(string Mode, string DisplayName);

public sealed record PreviewEntity(string Ref, string DisplayName, string? ExistingKey, IReadOnlyList<PreviewField> Fields,
    PreviewFormLayout? FormLayout, IReadOnlyList<PreviewView> Views, int SeedCount, IReadOnlyList<IReadOnlyDictionary<string, string?>> SeedSample);

public sealed record PreviewRelation(string Kind, string FromRef, string ToRef, string? Label, string? JunctionName);

public sealed record PreviewAmendmentItem(string Op, string? Target, string? Before, string? After, string Severity, string? Warning);

/// <summary>
/// Aperçu d'un amendement. <see cref="Degraded"/> = <c>true</c> quand le schéma réel de la table est
/// introuvable : un item par opération demandée, sans diff « avant → après » (C-B8).
/// </summary>
public sealed record PreviewAmendment(string TargetEntityRef, string? EntityKey, string? EntityDisplayName, bool Degraded, IReadOnlyList<PreviewAmendmentItem> Items);

/// <summary>
/// Aperçu structuré d'un plan Studio IA (contrat §12). <see cref="Workflows"/> reste TOUJOURS vide
/// en 3.x — 4.4 lira <c>summary.workflows[]</c>.
/// </summary>
public sealed record StudioAiPlanPreviewDto(Guid PlanId, string Kind, string Status, string Title,
    IReadOnlyList<PreviewEntity> Entities, IReadOnlyList<PreviewRelation> Relations, PreviewAmendment? Amendment,
    IReadOnlyList<object> Workflows, IReadOnlyList<string> Warnings, IReadOnlyList<DuplicateHint> Duplicates);

/// <summary>
/// Constructeur PUR de l'aperçu structuré d'un plan (PR 3.2b) : re-parse la spec persistée et la
/// projette en <see cref="StudioAiPlanPreviewDto"/>. Aucune dépendance MediatR / dépôt /
/// <c>ICurrentUser</c> — l'appelant (3.2c) fournit la spec, le summary, le schéma réel éventuel et
/// les deux garde-fous de flags. Déterministe : même entrée ⇒ même sortie octet à octet.
/// </summary>
public static class StudioAiPlanPreviewBuilder
{
    /// <summary>Avertissement figé de l'aperçu dégradé d'amendement (table introuvable, C-B8).</summary>
    public const string DegradedAmendmentWarning = "Table introuvable : aperçu limité aux opérations demandées.";

    public static Result<StudioAiPlanPreviewDto> Build(Guid planId, StudioAiPlanKind kind, string status,
        string specJson, string? summaryJson, CustomEntitySchemaDto? schema,
        bool manyToManyEnabled, bool recordViewsEnabled)
    {
        var summary = ReadSummary(summaryJson);
        return kind switch
        {
            StudioAiPlanKind.CreateSystem => BuildSystem(planId, status, specJson, summary),
            StudioAiPlanKind.CreateApp => BuildApp(planId, status, specJson, summary),
            StudioAiPlanKind.Amendment => BuildAmendment(planId, status, specJson, summary, schema, manyToManyEnabled, recordViewsEnabled),
            StudioAiPlanKind.View => BuildView(planId, status, specJson, summary),
            StudioAiPlanKind.Report => BuildReport(planId, status, specJson, summary),
            StudioAiPlanKind.RecordView => BuildRecordView(planId, status, specJson, summary),
            StudioAiPlanKind.Workflow => BuildWorkflow(planId, status, specJson, summary),
            _ => Result.Failure<StudioAiPlanPreviewDto>(Error.Validation("spec", $"Nature de plan inconnue : {kind}."))
        };
    }

    // ---- CreateSystem ----

    private static Result<StudioAiPlanPreviewDto> BuildSystem(Guid planId, string status, string specJson, SummaryInfo summary)
    {
        if (!StudioAiSystemSpec.TryParse(specJson, out var spec, out var error) || spec is null)
            return InvalidSpec(error);

        var entities = spec.Entities.Select(entity =>
        {
            // refs et entityRef de seed sont normalisés par le parseur (slug, Ordinal) : égalité directe.
            var batch = spec.Seed.FirstOrDefault(b => string.Equals(b.EntityRef, entity.Ref, StringComparison.Ordinal));
            return new PreviewEntity(
                entity.Ref,
                entity.EntityDisplayName,
                entity.ExistingKey,
                entity.Fields.Select(ToPreviewField).ToList(),
                entity.Form is null ? null : ToPreviewFormLayout(entity.Form),
                entity.Views.Select(v => new PreviewView(v.Mode, v.DisplayName)).ToList(),
                batch is null ? 0 : StudioAiSeedSampler.Count(batch),
                batch is null
                    ? Array.Empty<IReadOnlyDictionary<string, string?>>()
                    : StudioAiSeedSampler.Sample(batch, entity.Fields));
        }).ToList();

        var relations = spec.Relations
            .Select(r => new PreviewRelation(r.Kind, r.FromRef, r.ToRef, r.Label, r.JunctionName))
            .ToList();

        return Result.Success(new StudioAiPlanPreviewDto(
            planId, StudioAiPlanKind.CreateSystem.ToString(), status,
            TitleOr(summary, spec.SystemDisplayName),
            entities, relations, Amendment: null,
            Array.Empty<object>(),
            summary.Warnings ?? spec.Warnings ?? Array.Empty<string>(),
            summary.Duplicates));
    }

    // ---- CreateApp ----

    private static Result<StudioAiPlanPreviewDto> BuildApp(Guid planId, string status, string specJson, SummaryInfo summary)
    {
        if (!StudioAiAppSpec.TryParse(specJson, out var spec, out var error) || spec is null)
            return InvalidSpec(error);

        // Une spec « app » = une seule table auto-portée (jamais de relation, formulaire, vue ni seed).
        var entity = new PreviewEntity(
            StudioAiAppSpec.SlugKey(spec.EntityDisplayName),
            spec.EntityDisplayName,
            ExistingKey: null,
            spec.Fields.Select(ToPreviewField).ToList(),
            FormLayout: null,
            Array.Empty<PreviewView>(),
            SeedCount: 0,
            Array.Empty<IReadOnlyDictionary<string, string?>>());

        return Result.Success(new StudioAiPlanPreviewDto(
            planId, StudioAiPlanKind.CreateApp.ToString(), status,
            TitleOr(summary, spec.EntityDisplayName),
            new[] { entity },
            Array.Empty<PreviewRelation>(), Amendment: null,
            Array.Empty<object>(),
            summary.Warnings ?? Array.Empty<string>(),
            summary.Duplicates));
    }

    // ---- Amendment ----

    private static Result<StudioAiPlanPreviewDto> BuildAmendment(Guid planId, string status, string specJson,
        SummaryInfo summary, CustomEntitySchemaDto? schema, bool manyToManyEnabled, bool recordViewsEnabled)
    {
        if (!StudioAiAmendmentSpec.TryParse(specJson, out var spec, out var error) || spec is null)
            return InvalidSpec(error);

        PreviewAmendment amendment;
        IReadOnlyList<string> specWarnings;
        if (schema is not null)
        {
            // Diff résolu contre le schéma RÉEL : exactement ce qui sera appliqué à l'exécution.
            var preview = StudioAiAmendmentPlanner.BuildPreview(spec, schema, manyToManyEnabled, recordViewsEnabled);
            amendment = new PreviewAmendment(
                spec.TargetEntityRef, preview.EntityKey, preview.EntityDisplayName, Degraded: false,
                preview.Items.Select(i => new PreviewAmendmentItem(i.Op, i.Target, i.Before, i.After, i.Severity, i.Warning)).ToList());
            specWarnings = preview.Warnings;
        }
        else
        {
            // Dégradé (B-Q4) : la table est introuvable — un item par opération demandée, sans diff.
            amendment = new PreviewAmendment(
                spec.TargetEntityRef, EntityKey: null, EntityDisplayName: null, Degraded: true,
                spec.Operations.Select(ToDegradedItem).ToList());
            specWarnings = spec.Warnings;
        }

        return Result.Success(new StudioAiPlanPreviewDto(
            planId, StudioAiPlanKind.Amendment.ToString(), status,
            TitleOr(summary, amendment.EntityDisplayName ?? spec.TargetEntityRef),
            Array.Empty<PreviewEntity>(),
            Array.Empty<PreviewRelation>(), amendment,
            Array.Empty<object>(),
            summary.Warnings ?? specWarnings,
            summary.Duplicates));
    }

    /// <summary>Un item par opération connue (12), cible au mieux ; inconnu ⇒ op brute (C-B8).</summary>
    private static PreviewAmendmentItem ToDegradedItem(ParsedAmendmentOp op) => op switch
    {
        AddFieldOp add => new(add.Op, add.Field.Label, null, null, "info", DegradedAmendmentWarning),
        UpdateFieldOp update => new(update.Op, update.FieldRef, null, null, "info", DegradedAmendmentWarning),
        RemoveFieldOp remove => new(remove.Op, remove.FieldRef, null, null, "info", DegradedAmendmentWarning),
        UpdateEntityOp updateEntity => new(updateEntity.Op, updateEntity.DisplayName, null, null, "info", DegradedAmendmentWarning),
        SetFormOp setForm => new(setForm.Op, null, null, null, "info", DegradedAmendmentWarning),
        SetReportOp setReport => new(setReport.Op, setReport.DisplayName, null, null, "info", DegradedAmendmentWarning),
        ReorderFieldsOp reorder => new(reorder.Op, string.Join(", ", reorder.FieldRefs), null, null, "info", DegradedAmendmentWarning),
        ChangeFieldTypeOp change => new(change.Op, change.FieldRef, null, null, "info", DegradedAmendmentWarning),
        AddRelationOp relation => new(relation.Op, relation.TargetRef, null, null, "info", DegradedAmendmentWarning),
        AssignSystemOp assign => new(assign.Op, assign.SystemRef, null, null, "info", DegradedAmendmentWarning),
        SetViewOp setView => new(setView.Op, setView.View.DisplayName, null, null, "info", DegradedAmendmentWarning),
        SetAutomationOp automation => new(automation.Op, null, null, null, "info", DegradedAmendmentWarning),
        _ => new(op.Op, null, null, null, "info", DegradedAmendmentWarning)
    };

    // ---- View / Report / RecordView : zéro entité, Title + Warnings ----

    private static Result<StudioAiPlanPreviewDto> BuildView(Guid planId, string status, string specJson, SummaryInfo summary)
    {
        if (!StudioAiViewSpec.TryParse(specJson, out var spec, out var error) || spec is null)
            return InvalidSpec(error);
        return Leaf(planId, StudioAiPlanKind.View, status, summary, spec.Title, spec.Warnings);
    }

    private static Result<StudioAiPlanPreviewDto> BuildReport(Guid planId, string status, string specJson, SummaryInfo summary)
    {
        if (!StudioAiReportSpec.TryParse(specJson, out var spec, out var error) || spec is null)
            return InvalidSpec(error);
        return Leaf(planId, StudioAiPlanKind.Report, status, summary, spec.Title, spec.Warnings);
    }

    private static Result<StudioAiPlanPreviewDto> BuildRecordView(Guid planId, string status, string specJson, SummaryInfo summary)
    {
        if (!StudioAiRecordViewSpec.TryParse(specJson, out var spec, out var error) || spec is null)
            return InvalidSpec(error);
        return Leaf(planId, StudioAiPlanKind.RecordView, status, summary, spec.DisplayName, Array.Empty<string>());
    }

    /// <summary>PR 4.3c — aperçu d'un plan Workflow : feuille (titre + avertissements). Le détail des
    /// workflows est lu par le frontend dans <c>summary.workflows</c> ; <c>Workflows</c> du DTO reste []
    /// (contrat §12 inchangé).</summary>
    private static Result<StudioAiPlanPreviewDto> BuildWorkflow(Guid planId, string status, string specJson, SummaryInfo summary)
    {
        if (!StudioAiWorkflowSpec.TryParse(specJson, out var spec, out var error) || spec is null)
            return InvalidSpec(error);
        var fallback = $"{spec.Workflows.Count} workflow(s)";
        return Leaf(planId, StudioAiPlanKind.Workflow, status, summary, fallback, spec.Warnings);
    }

    /// <summary>Aperçu « feuille » : aucune entité ni relation, seuls le titre et les avertissements.</summary>
    private static Result<StudioAiPlanPreviewDto> Leaf(Guid planId, StudioAiPlanKind kind, string status,
        SummaryInfo summary, string specTitle, IReadOnlyList<string> specWarnings) =>
        Result.Success(new StudioAiPlanPreviewDto(
            planId, kind.ToString(), status,
            TitleOr(summary, specTitle),
            Array.Empty<PreviewEntity>(),
            Array.Empty<PreviewRelation>(), Amendment: null,
            Array.Empty<object>(),
            summary.Warnings ?? specWarnings,
            summary.Duplicates));

    // ---- Projections partagées ----

    private static PreviewField ToPreviewField(ParsedSystemField field) =>
        new(field.Key, field.Label, field.FieldType.ToString(), field.Required, field.Unique,
            field.Options?.Select(o => o.Label).ToList(), field.RelationToRef);

    private static PreviewField ToPreviewField(ParsedAppField field) =>
        new(field.Key, field.Label, field.FieldType.ToString(), field.Required, field.Unique,
            field.Options?.Select(o => o.Label).ToList(), RelationToRef: null);

    private static PreviewFormLayout ToPreviewFormLayout(ParsedFormSpec form) =>
        new(form.Sections.Select(section => new PreviewFormSection(
                section.Title ?? string.Empty,
                section.Fields.Select(f => new PreviewFormFieldRef(f.Key, f.Width, f.LabelOverride)).ToList()))
            .ToList());

    private static string TitleOr(SummaryInfo summary, string fallback) =>
        string.IsNullOrWhiteSpace(summary.Title) ? fallback : summary.Title!;

    private static Result<StudioAiPlanPreviewDto> InvalidSpec(string? error) =>
        Result.Failure<StudioAiPlanPreviewDto>(Error.Validation("spec", error ?? "spec_json invalide."));

    // ---- Lecture tolérante du summary (clés camelCase de StudioAiPlanSummary) ----

    /// <summary>
    /// Ce qui est relu du summary persisté : titre, avertissements, indices de doublons.
    /// <see cref="Warnings"/> = <c>null</c> quand le summary est absent ou illisible ⇒ repli sur
    /// les avertissements de la spec (E1 : Amendment/View/Report n'ont pas de summary à la création).
    /// </summary>
    private sealed record SummaryInfo(string? Title, IReadOnlyList<string>? Warnings, IReadOnlyList<DuplicateHint> Duplicates)
    {
        internal static readonly SummaryInfo Empty = new(null, null, Array.Empty<DuplicateHint>());
    }

    private static SummaryInfo ReadSummary(string? summaryJson)
    {
        if (!string.IsNullOrWhiteSpace(summaryJson))
        {
            try
            {
                if (JsonNode.Parse(summaryJson) is JsonObject root)
                {
                    var title = root["title"] is JsonValue titleValue && titleValue.TryGetValue<string>(out var text)
                        ? text
                        : null;
                    IReadOnlyList<string>? warnings = null;
                    if (root["warnings"] is JsonArray warningsArray)
                        warnings = warningsArray
                            .Select(w => w is JsonValue value && value.TryGetValue<string>(out var s) ? s : null)
                            .Where(s => s is not null)
                            .Cast<string>()
                            .ToList();
                    return new SummaryInfo(title, warnings, ReadDuplicates(root["duplicates"]));
                }
            }
            catch (JsonException)
            {
                // Summary illisible : l'aperçu reste rendu depuis la spec seule.
            }
        }
        return SummaryInfo.Empty;
    }

    /// <summary><c>duplicates</c> relu tolérant ; absent ou mal formé ⇒ <c>[]</c>.</summary>
    private static IReadOnlyList<DuplicateHint> ReadDuplicates(JsonNode? node)
    {
        if (node is not JsonArray array) return Array.Empty<DuplicateHint>();
        var hints = new List<DuplicateHint>(array.Count);
        foreach (var item in array)
        {
            if (item is not JsonObject obj) continue;
            var specRef = Str(obj["specRef"]);
            var specDisplayName = Str(obj["specDisplayName"]);
            var existingKey = Str(obj["existingKey"]);
            var existingDisplayName = Str(obj["existingDisplayName"]);
            var reason = Str(obj["reason"]);
            if (specRef is null || specDisplayName is null || existingKey is null || existingDisplayName is null || reason is null)
                continue;
            hints.Add(new DuplicateHint(specRef, specDisplayName, existingKey, existingDisplayName, reason));
        }
        return hints;
    }

    private static string? Str(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}
