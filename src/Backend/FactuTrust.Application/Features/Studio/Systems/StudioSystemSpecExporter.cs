using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Systems;

/// <summary>
/// Entrées de l'export : uniquement des entités de domaine, indexées par Id d'entité.
/// <see cref="Entities"/> contient TOUTES les entités du système (y compris Kind = Junction) telles que
/// renvoyées par <c>ICustomEntityRepository.ListBySystemIdAsync</c>.
/// </summary>
public sealed record StudioSystemExportInput(
    CustomSystemDefinition System,
    IReadOnlyList<CustomEntityDefinition> Entities,
    IReadOnlyDictionary<Guid, IReadOnlyList<CustomFieldDefinition>> FieldsByEntity,
    IReadOnlyDictionary<Guid, CustomFormDefinition?> DefaultFormByEntity,
    IReadOnlyDictionary<Guid, IReadOnlyList<CustomReportDefinition>> ReportsByEntity,
    IReadOnlyDictionary<Guid, IReadOnlyList<CustomRecordViewDefinition>> ViewsByEntity,
    IReadOnlyDictionary<Guid, IReadOnlyList<CustomRecord>>? SeedByEntity = null);

/// <summary>Résultat de l'export : la spec (racine <c>specVersion</c>/<c>exportedFrom</c>/…) + avertissements hors spec.</summary>
public sealed record StudioSystemExportResult(
    JsonObject Spec,
    IReadOnlyList<string> Warnings,
    /// <summary>Entités Standard exportées.</summary>
    int EntityCount,
    /// <summary>Relations N-N exportées (racine <c>relations[]</c>).</summary>
    int RelationCount,
    /// <summary>Vues exportées (toutes entités).</summary>
    int ViewCount,
    /// <summary>Vrai si <c>SeedByEntity</c> non null ET au moins 1 ligne exportée.</summary>
    bool IncludesSeed);

/// <summary>
/// Export pur d'un système Studio vers une spec ré-importable par <see cref="StudioAiSystemSpec.TryParse"/>
/// (PR 3.3, tranche 3.3b2). Construit un <see cref="ParsedSystemSpec"/> depuis les entités de domaine,
/// délègue la forme des nœuds à <see cref="StudioAiSpecCanonical.CanonicalSystemNode"/> et préfixe la
/// racine par <c>specVersion</c> / <c>exportedFrom</c>. Aucun identifiant interne (Id, TenantId) ne sort ;
/// un JSON de champ / vue / ligne corrompu produit un avertissement, jamais une exception.
/// </summary>
public static class StudioSystemSpecExporter
{
    public const int SpecVersion = StudioAiSystemSpec.SupportedSpecVersion;
    public const int DefaultMaxSeedRows = 200;

    private const string JunctionDescriptionSeparator = " — table de jonction";

    /// <summary>Borne du libellé d'une vue (miroir de <c>StudioAiRecordViewSpec.MaxDisplayNameLength</c>, privée).</summary>
    private const int MaxViewDisplayNameLength = 80;

    /// <summary>Types dont les valeurs de seed sont neutralisées (A12 : aucun identifiant de relation ne sort).</summary>
    private static readonly HashSet<CustomFieldType> NulledSeedTypes = new()
    {
        CustomFieldType.RelationCustom, CustomFieldType.RelationExisting,
        CustomFieldType.Attachment, CustomFieldType.Signature,
        CustomFieldType.Formula, CustomFieldType.Lookup, CustomFieldType.Rollup
    };

    /// <summary>
    /// Pur : aucune I/O, aucune dépendance. <paramref name="maxSeedRows"/> est borné dans
    /// [0, <see cref="StudioAiSystemSpec.MaxSeedRecords"/>]. <paramref name="exportedAtUtc"/> injectable pour des
    /// tests déterministes (défaut <see cref="DateTime.UtcNow"/>).
    /// </summary>
    public static StudioSystemExportResult Export(
        StudioSystemExportInput input, int maxSeedRows = DefaultMaxSeedRows, DateTime? exportedAtUtc = null)
    {
        var warnings = new List<string>();
        var spec = ToParsedSpec(input, maxSeedRows, warnings);

        var canonical = StudioAiSpecCanonical.CanonicalSystemNode(spec);
        var root = new JsonObject
        {
            ["specVersion"] = SpecVersion,
            ["exportedFrom"] = new JsonObject
            {
                ["tenantSystemKey"] = input.System.Key,
                ["exportedAt"] = (exportedAtUtc ?? DateTime.UtcNow).ToString("O")
            }
        };
        // Un JsonNode ne peut pas avoir deux parents : recopie par clonage, clés/ordre inchangés.
        foreach (var property in canonical)
            root[property.Key] = property.Value?.DeepClone();

        var seedRows = spec.Seed.Sum(b => b.Records.Count);
        return new StudioSystemExportResult(
            root,
            warnings,
            EntityCount: spec.Entities.Count,
            RelationCount: spec.Relations.Count,
            ViewCount: spec.Entities.Sum(e => e.Views.Count),
            IncludesSeed: input.SeedByEntity is not null && seedRows > 0);
    }

    /// <summary>Étape intermédiaire exposée pour la duplication (3.3c2) et les tests : le ParsedSystemSpec avant canonisation.</summary>
    public static ParsedSystemSpec ToParsedSpec(StudioSystemExportInput input, int maxSeedRows, List<string> warnings)
    {
        // ---- Entités ---------------------------------------------------------------------------
        var inactiveCount = input.Entities.Count(e => !e.IsActive);
        if (inactiveCount > 0)
            warnings.Add($"{inactiveCount} table(s) inactive(s) non exportée(s).");

        var standard = input.Entities.Where(e => e.IsActive && e.Kind == CustomEntityKind.Standard).ToList();
        if (standard.Count > StudioAiSystemSpec.MaxEntities)
            warnings.Add($"Ce système compte {standard.Count} tables : la limite d'import est de {StudioAiSystemSpec.MaxEntities}, l'import ou la duplication échouera sans édition.");

        var exportedRefs = standard.Select(e => e.Key).ToHashSet(StringComparer.Ordinal);

        var entities = new List<ParsedSystemEntity>(standard.Count);
        var exportedFieldsByEntity = new Dictionary<Guid, IReadOnlyList<CustomFieldDefinition>>();
        foreach (var entity in standard)
        {
            var fields = ActiveFields(input, entity.Id);
            if (fields.Count > StudioAiAppSpec.MaxFields)
                warnings.Add($"Table « {entity.Key} » compte {fields.Count} champs : la limite d'import est de {StudioAiAppSpec.MaxFields}, l'import ou la duplication échouera sans édition.");
            exportedFieldsByEntity[entity.Id] = fields;

            var parsedFields = fields.Select(f => ToField(f, exportedRefs, warnings)).ToList();
            var fieldKeys = parsedFields.Select(f => f.Key).ToHashSet(StringComparer.Ordinal);

            entities.Add(new ParsedSystemEntity(
                Ref: entity.Key,
                EntityDisplayName: entity.DisplayName,
                EntityDisplayNamePlural: entity.DisplayNamePlural,
                Icon: entity.Icon,
                Description: entity.Description,
                Fields: parsedFields,
                Form: ToForm(input, entity.Id, fieldKeys),
                Report: ToReport(input, entity, warnings),
                Views: ToViews(input, entity, warnings)));
        }

        // ---- Relations N-N (jonctions) ---------------------------------------------------------
        var relations = ToRelations(input, exportedRefs, warnings);

        // ---- Seed ------------------------------------------------------------------------------
        var seed = input.SeedByEntity is null
            ? Array.Empty<ParsedSeedBatch>()
            : ToSeed(input, standard, exportedFieldsByEntity, maxSeedRows, warnings);

        return new ParsedSystemSpec(
            SystemDisplayName: input.System.DisplayName,
            SystemIcon: input.System.Icon,
            SystemDescription: input.System.Description,
            OnboardingSteps: ListCustomSystemsQueryHandler.ParseOnboarding(input.System.OnboardingJson),
            Entities: entities,
            Seed: seed,
            Warnings: null,
            Relations: relations);
    }

    // ---- Champs --------------------------------------------------------------------------------

    private static IReadOnlyList<CustomFieldDefinition> ActiveFields(StudioSystemExportInput input, Guid entityId) =>
        input.FieldsByEntity.TryGetValue(entityId, out var fields)
            ? fields.Where(f => f.IsActive).OrderBy(f => f.SortOrder).ToList()
            : Array.Empty<CustomFieldDefinition>();

    private static ParsedSystemField ToField(CustomFieldDefinition field, HashSet<string> exportedRefs, List<string> warnings)
    {
        var type = field.FieldType;
        IReadOnlyList<SelectOptionDto>? options = null;
        Dictionary<string, JsonNode?>? config = null;
        string? relationTo = null;

        JsonNode? optionsNode = null;
        var optionsReadable = true;
        if (!string.IsNullOrWhiteSpace(field.OptionsJson))
        {
            try { optionsNode = JsonNode.Parse(field.OptionsJson); }
            catch (JsonException)
            {
                optionsReadable = false;
                warnings.Add($"Configuration du champ « {field.Label} » illisible : ignorée.");
            }
        }

        switch (type)
        {
            case CustomFieldType.Select:
            case CustomFieldType.MultiSelect:
                options = optionsReadable ? StudioFieldJson.ParseOptions(field.OptionsJson) : null;
                break;

            case CustomFieldType.Money:
                config = ConfigFrom(optionsNode, "money", "currency", "currency");
                break;

            case CustomFieldType.Rating:
                config = ConfigFrom(optionsNode, "rating", "max", "max");
                break;

            case CustomFieldType.QrCode:
            case CustomFieldType.Barcode:
                config = ConfigFrom(optionsNode, "render", "format", "format");
                break;

            case CustomFieldType.RelationExisting:
            {
                var rel = optionsReadable ? StudioFieldJson.ParseRelation(field.OptionsJson) : null;
                if (rel is null)
                {
                    type = CustomFieldType.Text;
                    warnings.Add($"Relation « {field.Label} » vers « ? » hors système non exportée (champ exporté en texte).");
                }
                else relationTo = rel.Ref;
                break;
            }

            case CustomFieldType.RelationCustom:
            {
                var rel = optionsReadable ? StudioFieldJson.ParseRelation(field.OptionsJson) : null;
                if (rel is not null && exportedRefs.Contains(rel.Ref))
                    relationTo = rel.Ref;
                else
                {
                    type = CustomFieldType.Text;
                    warnings.Add($"Relation « {field.Label} » vers « {rel?.Ref ?? "?"} » hors système non exportée (champ exporté en texte).");
                }
                break;
            }

            case CustomFieldType.Formula:
            case CustomFieldType.Lookup:
            case CustomFieldType.Rollup:
                warnings.Add($"Champ « {field.Label} » ({type}) exporté en texte : formules et agrégats ne sont pas portables.");
                type = CustomFieldType.Text;
                break;

            // Text, MultilineText, Number, Decimal, Boolean, Date, DateTime, Percentage, AutoNumber,
            // Attachment, Signature : tel quel, sans options/config/relation.
        }

        return new ParsedSystemField(field.Key, field.Label, type, field.IsRequired, field.IsUnique, options, config, relationTo);
    }

    /// <summary>Extrait <c>OptionsJson.{wrapper}.{source}</c> en <c>{ target: valeur }</c> ; null si absent.</summary>
    private static Dictionary<string, JsonNode?>? ConfigFrom(JsonNode? optionsNode, string wrapper, string source, string target)
    {
        var value = optionsNode?[wrapper]?[source];
        return value is null ? null : new Dictionary<string, JsonNode?> { [target] = value.DeepClone() };
    }

    // ---- Formulaire ----------------------------------------------------------------------------

    private static ParsedFormSpec? ToForm(StudioSystemExportInput input, Guid entityId, HashSet<string> exportedKeys)
    {
        if (!input.DefaultFormByEntity.TryGetValue(entityId, out var form) || form is null || !form.IsActive)
            return null;

        var layout = FormLayoutJson.Parse(form.LayoutJson);
        var sections = layout.Sections
            .Select(s => new ParsedFormSection(
                s.Title,
                s.Fields.Where(f => exportedKeys.Contains(f.Key))
                    .Select(f => new ParsedFormFieldRef(f.Key, f.Width, f.LabelOverride))
                    .ToList()))
            .ToList();
        return sections.Count == 0 ? null : new ParsedFormSpec(sections);
    }

    // ---- Rapport -------------------------------------------------------------------------------

    private static ParsedAppReport? ToReport(StudioSystemExportInput input, CustomEntityDefinition entity, List<string> warnings)
    {
        if (!input.ReportsByEntity.TryGetValue(entity.Id, out var reports)) return null;
        var active = reports.Where(r => r.IsActive).OrderBy(r => r.DisplayName, StringComparer.Ordinal).ToList();
        if (active.Count == 0) return null;
        if (active.Count > 1)
            warnings.Add($"Table « {entity.Key} » : {active.Count - 1} rapport(s) supplémentaire(s) non exporté(s) (un seul rapport par table dans la spec).");

        var first = active[0];
        var def = ReportDefinitionJson.Parse(first.DefinitionJson);
        return new ParsedAppReport(first.DisplayName, def.Grouping, def.Aggregations, def.Fields, def.Filters, def.Sort);
    }

    // ---- Vues ----------------------------------------------------------------------------------

    private static IReadOnlyList<ParsedRecordViewSpec> ToViews(StudioSystemExportInput input, CustomEntityDefinition entity, List<string> warnings)
    {
        if (!input.ViewsByEntity.TryGetValue(entity.Id, out var views)) return Array.Empty<ParsedRecordViewSpec>();
        var active = views.Where(v => v.IsActive)
            .OrderByDescending(v => v.IsDefault)
            .ThenBy(v => v.DisplayName, StringComparer.Ordinal)
            .ToList();
        if (active.Count > StudioAiSystemSpec.MaxViewsPerEntity)
            warnings.Add($"Au plus {StudioAiSystemSpec.MaxViewsPerEntity} vues par table ; {active.Count - StudioAiSystemSpec.MaxViewsPerEntity} vue(s) de « {entity.Key} » non exportée(s).");

        var result = new List<ParsedRecordViewSpec>();
        foreach (var view in active.Take(StudioAiSystemSpec.MaxViewsPerEntity))
        {
            var def = RecordViewDefinitionJson.Parse(view.DefinitionJson);
            if (def is null)
            {
                warnings.Add($"Vue « {view.DisplayName} » illisible : ignorée.");
                continue;
            }
            var name = view.DisplayName.Length > MaxViewDisplayNameLength
                ? view.DisplayName[..MaxViewDisplayNameLength]
                : view.DisplayName;
            result.Add(new ParsedRecordViewSpec(
                EntityKey: null,
                DisplayName: name,
                Mode: StudioAiRecordViewSpec.ModeKey(view.Mode),
                Columns: (def.Columns ?? Array.Empty<RecordViewColumn>()).Where(c => !c.Hidden).Select(c => c.FieldKey).Take(StudioAiRecordViewSpec.MaxColumns).ToList(),
                Filters: (def.Filters ?? Array.Empty<RecordViewFilter>()).Take(StudioAiRecordViewSpec.MaxFilters).ToList(),
                Sort: (def.Sort ?? Array.Empty<RecordViewSort>()).Take(StudioAiRecordViewSpec.MaxSort).ToList(),
                GroupByFieldKey: def.Kanban?.GroupByFieldKey,
                StartFieldKey: def.Calendar?.StartFieldKey,
                EndFieldKey: def.Calendar?.EndFieldKey,
                TitleFieldKey: def.Kanban?.TitleFieldKey ?? def.Calendar?.TitleFieldKey,
                IsDefault: view.IsDefault));
        }
        return result;
    }

    // ---- Relations N-N -------------------------------------------------------------------------

    private static IReadOnlyList<ParsedSystemRelation> ToRelations(StudioSystemExportInput input, HashSet<string> exportedRefs, List<string> warnings)
    {
        var relations = new List<ParsedSystemRelation>();
        var seenPairs = new HashSet<string>(StringComparer.Ordinal);
        var skipped = 0;

        foreach (var junction in input.Entities.Where(e => e.IsActive && e.Kind == CustomEntityKind.Junction))
        {
            var links = ActiveFields(input, junction.Id).Where(f => f.FieldType == CustomFieldType.RelationCustom).ToList();
            var targets = links.Select(f => StudioFieldJson.ParseRelation(f.OptionsJson)?.Ref).ToList();
            if (links.Count != 2 || targets.Any(t => t is null || !exportedRefs.Contains(t)))
            {
                warnings.Add($"Table de jonction « {junction.Key} » ignorée : cible hors système ou structure inattendue.");
                continue;
            }

            var from = targets[0]!;
            var to = targets[1]!;
            var pairKey = string.CompareOrdinal(from, to) <= 0 ? $"{from}|{to}" : $"{to}|{from}";
            if (!seenPairs.Add(pairKey)) continue;

            if (relations.Count >= StudioAiSystemSpec.MaxRelations) { skipped++; continue; }

            relations.Add(new ParsedSystemRelation("many_to_many", from, to, JunctionLabel(junction.Description), junction.DisplayName));
        }

        if (skipped > 0)
            warnings.Add($"Au plus {StudioAiSystemSpec.MaxRelations} relations plusieurs-à-plusieurs ; {skipped} non exportée(s).");
        return relations;
    }

    /// <summary>Préfixe de <c>Description</c> avant « — table de jonction » (forme écrite par l'orchestrateur N-N) ; null sinon.</summary>
    private static string? JunctionLabel(string? description)
    {
        if (string.IsNullOrWhiteSpace(description)) return null;
        var index = description.IndexOf(JunctionDescriptionSeparator, StringComparison.Ordinal);
        if (index <= 0) return null;
        var label = description[..index].Trim();
        return label.Length == 0 ? null : label;
    }

    // ---- Seed ----------------------------------------------------------------------------------

    private static IReadOnlyList<ParsedSeedBatch> ToSeed(
        StudioSystemExportInput input,
        IReadOnlyList<CustomEntityDefinition> standard,
        IReadOnlyDictionary<Guid, IReadOnlyList<CustomFieldDefinition>> exportedFieldsByEntity,
        int maxSeedRows,
        List<string> warnings)
    {
        var maxRows = Math.Clamp(maxSeedRows, 0, StudioAiSystemSpec.MaxSeedRecords);
        var remaining = StudioAiSystemSpec.MaxSeedRecords;
        var batches = new List<ParsedSeedBatch>();
        var corruptRows = 0;

        foreach (var entity in standard)
        {
            if (!input.SeedByEntity!.TryGetValue(entity.Id, out var rows) || rows.Count == 0) continue;

            var take = Math.Min(maxRows, remaining);
            if (rows.Count > take)
                warnings.Add($"Données de départ de « {entity.Key} » tronquées à {take} ligne(s).");
            if (take == 0) continue;

            var fields = exportedFieldsByEntity[entity.Id];
            var exportedKeys = fields.Select(f => f.Key).ToHashSet(StringComparer.Ordinal);
            var nulledKeys = fields.Where(f => NulledSeedTypes.Contains(f.FieldType)).Select(f => f.Key).ToHashSet(StringComparer.Ordinal);

            var records = new List<Dictionary<string, JsonNode?>>();
            foreach (var row in rows.Take(take))
            {
                JsonObject? data;
                try { data = JsonNode.Parse(row.DataJson) as JsonObject; }
                catch (JsonException) { data = null; }
                if (data is null) { corruptRows++; continue; }

                var record = new Dictionary<string, JsonNode?>();
                foreach (var kv in data)
                {
                    if (!exportedKeys.Contains(kv.Key)) continue;
                    record[kv.Key] = nulledKeys.Contains(kv.Key) ? null : kv.Value?.DeepClone();
                }
                records.Add(record);
            }

            remaining -= take;
            if (records.Count > 0)
                batches.Add(new ParsedSeedBatch(entity.Key, records));
        }

        if (corruptRows > 0)
            warnings.Add($"{corruptRows} ligne(s) de données de départ illisible(s) ignorée(s).");
        return batches;
    }
}
