using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

public sealed record ParsedAppField(
    string Key,
    string Label,
    CustomFieldType FieldType,
    bool Required,
    bool Unique,
    IReadOnlyList<SelectOptionDto>? Options,
    Dictionary<string, JsonNode?>? Config);

public sealed record ParsedAppReport(
    string DisplayName,
    IReadOnlyList<string> Grouping,
    IReadOnlyList<ReportAggregation> Aggregations,
    IReadOnlyList<string> Fields,
    IReadOnlyList<ReportFilter> Filters,
    IReadOnlyList<ReportSort> Sort);

public sealed record ParsedAppSpec(
    string EntityDisplayName,
    string EntityDisplayNamePlural,
    string? Icon,
    string? Description,
    IReadOnlyList<ParsedAppField> Fields,
    ParsedAppReport? Report);

/// <summary>
/// Parses the natural-language "app spec" JSON emitted by the assistant into validated, sanitized
/// entity/field/report requests. Pure (no DB) and defensive: maps friendly type names to
/// <see cref="CustomFieldType"/>, slugifies + de-duplicates field keys, and only ever produces the
/// "safe" self-contained field types (no relation/formula/lookup/rollup that need cross-entity context).
/// Unknown types degrade to Text; a Select without options degrades to Text. The downstream Studio
/// commands still enforce all validation/quotas — this layer just shapes a clean, low-risk request.
/// </summary>
public static class StudioAiAppSpec
{
    public const int MaxFields = 40;

    // Friendly aliases (EN/FR) → field type. Only self-contained types are accepted for AI generation.
    private static readonly Dictionary<string, CustomFieldType> TypeAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["text"] = CustomFieldType.Text, ["texte"] = CustomFieldType.Text, ["string"] = CustomFieldType.Text,
        ["multilinetext"] = CustomFieldType.MultilineText, ["textarea"] = CustomFieldType.MultilineText,
        ["texte long"] = CustomFieldType.MultilineText, ["paragraphe"] = CustomFieldType.MultilineText, ["notes"] = CustomFieldType.MultilineText,
        ["number"] = CustomFieldType.Number, ["nombre"] = CustomFieldType.Number, ["entier"] = CustomFieldType.Number, ["integer"] = CustomFieldType.Number, ["int"] = CustomFieldType.Number,
        ["decimal"] = CustomFieldType.Decimal, ["nombre decimal"] = CustomFieldType.Decimal, ["float"] = CustomFieldType.Decimal, ["double"] = CustomFieldType.Decimal,
        ["money"] = CustomFieldType.Money, ["monetaire"] = CustomFieldType.Money, ["montant"] = CustomFieldType.Money, ["currency"] = CustomFieldType.Money, ["prix"] = CustomFieldType.Money,
        ["percentage"] = CustomFieldType.Percentage, ["pourcentage"] = CustomFieldType.Percentage, ["percent"] = CustomFieldType.Percentage,
        ["rating"] = CustomFieldType.Rating, ["note"] = CustomFieldType.Rating, ["etoiles"] = CustomFieldType.Rating,
        ["boolean"] = CustomFieldType.Boolean, ["bool"] = CustomFieldType.Boolean, ["oui/non"] = CustomFieldType.Boolean, ["ouinon"] = CustomFieldType.Boolean, ["checkbox"] = CustomFieldType.Boolean, ["case a cocher"] = CustomFieldType.Boolean,
        ["date"] = CustomFieldType.Date,
        ["datetime"] = CustomFieldType.DateTime, ["date et heure"] = CustomFieldType.DateTime, ["timestamp"] = CustomFieldType.DateTime,
        ["select"] = CustomFieldType.Select, ["liste"] = CustomFieldType.Select, ["choix"] = CustomFieldType.Select, ["dropdown"] = CustomFieldType.Select, ["statut"] = CustomFieldType.Select, ["status"] = CustomFieldType.Select, ["enum"] = CustomFieldType.Select,
        ["multiselect"] = CustomFieldType.MultiSelect, ["choix multiple"] = CustomFieldType.MultiSelect, ["tags"] = CustomFieldType.MultiSelect,
        ["qrcode"] = CustomFieldType.QrCode, ["qr"] = CustomFieldType.QrCode,
        ["barcode"] = CustomFieldType.Barcode, ["code-barres"] = CustomFieldType.Barcode, ["codebarres"] = CustomFieldType.Barcode,
        ["autonumber"] = CustomFieldType.AutoNumber, ["auto"] = CustomFieldType.AutoNumber, ["reference"] = CustomFieldType.AutoNumber, ["numero"] = CustomFieldType.AutoNumber,
        ["attachment"] = CustomFieldType.Attachment, ["piece jointe"] = CustomFieldType.Attachment, ["fichier"] = CustomFieldType.Attachment, ["file"] = CustomFieldType.Attachment,
        ["signature"] = CustomFieldType.Signature
    };

    private static readonly HashSet<string> AggFns = new(StringComparer.OrdinalIgnoreCase) { "sum", "avg", "count", "min", "max" };

    // Alias tolérants (petits modèles, EN/FR/symboles) → opérateur canonique du CustomReportRunner.
    // Liste blanche stricte : un op hors de cette table fait ignorer le filtre, jamais échouer le spec.
    private static readonly Dictionary<string, string> FilterOpAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["eq"] = "eq", ["="] = "eq", ["=="] = "eq", ["equals"] = "eq", ["is"] = "eq", ["egal"] = "eq",
        ["neq"] = "neq", ["!="] = "neq", ["<>"] = "neq", ["ne"] = "neq", ["not"] = "neq", ["different"] = "neq",
        ["gt"] = "gt", [">"] = "gt", ["greater"] = "gt", ["superieur"] = "gt", ["apres"] = "gt",
        ["gte"] = "gte", [">="] = "gte",
        ["lt"] = "lt", ["<"] = "lt", ["less"] = "lt", ["inferieur"] = "lt", ["avant"] = "lt",
        ["lte"] = "lte", ["<="] = "lte",
        ["contains"] = "contains", ["like"] = "contains", ["contient"] = "contains",
        ["in"] = "in", ["dans"] = "in",
        ["between"] = "between", ["entre"] = "between", ["range"] = "between"
    };

    public static bool TryParse(string? specJson, out ParsedAppSpec? spec, out string? error)
    {
        spec = null;
        error = null;
        if (string.IsNullOrWhiteSpace(specJson)) { error = "spec_json est vide."; return false; }

        JsonNode? root;
        try { root = JsonNode.Parse(specJson); }
        catch (JsonException) { error = "spec_json n'est pas un JSON valide."; return false; }

        var entity = root?["entity"];
        var displayName = Str(entity?["displayName"]) ?? Str(entity?["name"]) ?? Str(root?["name"]) ?? Str(root?["displayName"]);
        if (string.IsNullOrWhiteSpace(displayName)) { error = "entity.displayName est obligatoire."; return false; }

        var plural = Str(entity?["displayNamePlural"]);
        var icon = Str(entity?["icon"]);
        var description = Str(entity?["description"]);

        var fieldsArr = root?["fields"]?.AsArray();
        if (fieldsArr is null || fieldsArr.Count == 0) { error = "Au moins un champ est requis."; return false; }

        // Rejet franc (cohérent avec StudioAiSystemSpec) plutôt que troncature silencieuse.
        if (fieldsArr.Count > MaxFields) { error = $"Au plus {MaxFields} champs."; return false; }

        var fields = new List<ParsedAppField>();
        var usedKeys = new HashSet<string>(StringComparer.Ordinal);

        foreach (var fn in fieldsArr)
        {
            var label = Str(fn?["label"]) ?? Str(fn?["name"]);
            if (string.IsNullOrWhiteSpace(label)) continue;

            var fieldType = MapType(Str(fn?["type"]));

            // Clé explicite (éditeur d'aperçu) prioritaire sur la dérivation du libellé — même
            // règle que StudioAiSystemSpec : invalide, réservée ou dupliquée ⇒ rejet franc.
            var explicitKey = Str(fn?["key"]);
            string key;
            if (!string.IsNullOrWhiteSpace(explicitKey))
            {
                key = StudioKey.Slugify(explicitKey!);
                if (StudioKey.IsReservedFieldKey(key) || !StudioKey.IsValidShape(key))
                { error = $"Clé de champ « {key} » invalide ou réservée."; return false; }
                if (!usedKeys.Add(key)) { error = $"Clé de champ « {key} » dupliquée."; return false; }
            }
            else
            {
                key = UniqueFieldKey(label!, usedKeys);
            }

            var required = Bool(fn?["required"]) ?? Bool(fn?["isRequired"]) ?? false;
            var unique = Bool(fn?["unique"]) ?? Bool(fn?["isUnique"]) ?? false;

            IReadOnlyList<SelectOptionDto>? options = null;
            Dictionary<string, JsonNode?>? config = null;

            if (fieldType is CustomFieldType.Select or CustomFieldType.MultiSelect)
            {
                options = ParseOptions(fn?["options"]);
                if (options is null || options.Count == 0)
                {
                    // A list field with no options would be rejected downstream — degrade to free text.
                    fieldType = CustomFieldType.Text;
                }
            }
            else
            {
                config = ParseConfig(fn, fieldType);
            }

            fields.Add(new ParsedAppField(key, label!, fieldType, required, unique, options, config));
        }

        if (fields.Count == 0) { error = "Aucun champ valide dans la spécification."; return false; }

        spec = new ParsedAppSpec(
            displayName!.Trim(),
            string.IsNullOrWhiteSpace(plural) ? displayName!.Trim() : plural!.Trim(),
            icon, description, fields, ParseReport(root?["report"], fields));
        return true;
    }

    /// <summary>Accent-folded slug (so « Date de début » → « date_de_debut », not « date_de_d_but »).</summary>
    public static string SlugKey(string input) => StudioKey.Slugify(RemoveDiacritics(input));

    /// <summary>Repli sans diacritiques (réutilisé par le détecteur de doublons).</summary>
    internal static string RemoveDiacritics(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        var decomposed = text.Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark)
                sb.Append(c);
        }
        return sb.ToString().Normalize(System.Text.NormalizationForm.FormC);
    }

    public static CustomFieldType MapType(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return CustomFieldType.Text;
        var key = raw.Trim();
        if (TypeAliases.TryGetValue(key, out var t)) return t;
        // Accept exact enum names too (e.g. "Decimal"), but only the self-contained ones.
        if (Enum.TryParse<CustomFieldType>(key, ignoreCase: true, out var parsed) && IsSafeAiType(parsed))
            return parsed;
        return CustomFieldType.Text;
    }

    /// <summary>
    /// Résolution STRICTE d'un type déclaré (alias FR/EN ou nom d'énumération exact), SANS repli sur
    /// Texte : contrairement à <see cref="MapType"/> (add_field, où un type inconnu peut dégrader sans
    /// risque), <c>change_field_type</c> (PR 3.1b) doit signaler une valeur inconnue plutôt que la
    /// masquer, et accepter aussi les cibles interdites (Formula/Lookup/Rollup/…) pour que la matrice
    /// D4 puisse les classer <c>Forbidden</c> au lieu de les voir disparaître ici.
    /// </summary>
    public static bool TryMapType(string? raw, out CustomFieldType type)
    {
        type = CustomFieldType.Text;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var key = raw.Trim();
        if (TypeAliases.TryGetValue(key, out type)) return true;
        // Contrat "nom uniquement" : Enum.TryParse accepte aussi les entiers (ex. "3" → Money), ce qui
        // laisserait un modèle IA deviner une valeur numérique d'énumération. On l'exclut explicitement.
        if (!int.TryParse(key, out _) && Enum.TryParse(key, ignoreCase: true, out type)) return true;
        type = CustomFieldType.Text;
        return false;
    }

    private static bool IsSafeAiType(CustomFieldType t) => t is not (
        CustomFieldType.RelationCustom or CustomFieldType.RelationExisting or
        CustomFieldType.Formula or CustomFieldType.Lookup or CustomFieldType.Rollup);

    private static string UniqueFieldKey(string label, HashSet<string> used)
    {
        var baseKey = SlugKey(label);
        if (string.IsNullOrEmpty(baseKey) || !StudioKey.IsValidShape(baseKey) || StudioKey.IsReservedFieldKey(baseKey))
            baseKey = "champ";
        var key = baseKey;
        var i = 1;
        while (used.Contains(key))
            key = $"{baseKey}_{++i}";
        used.Add(key);
        return key;
    }

    private static IReadOnlyList<SelectOptionDto>? ParseOptions(JsonNode? node)
    {
        if (node is not JsonArray arr) return null;
        var result = new List<SelectOptionDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in arr)
        {
            string? value;
            string? label;
            if (item is JsonObject obj)
            {
                value = Str(obj["value"]) ?? Str(obj["label"]);
                label = Str(obj["label"]) ?? value;
            }
            else
            {
                value = Str(item);
                label = value;
            }
            if (string.IsNullOrWhiteSpace(value)) continue;
            var slug = SlugKey(value);
            if (string.IsNullOrEmpty(slug)) slug = value!.Trim();
            if (!seen.Add(slug)) continue;
            result.Add(new SelectOptionDto(slug, (label ?? value)!.Trim()));
        }
        return result.Count > 0 ? result : null;
    }

    private static Dictionary<string, JsonNode?>? ParseConfig(JsonNode? fn, CustomFieldType type)
    {
        var cfg = fn?["config"] as JsonObject;
        switch (type)
        {
            case CustomFieldType.Money:
            {
                var currency = Str(cfg?["currency"]) ?? Str(fn?["currency"]) ?? "TND";
                return new() { ["currency"] = JsonValue.Create(currency.Trim().ToUpperInvariant()) };
            }
            case CustomFieldType.Rating:
            {
                var max = Int(cfg?["max"]) ?? Int(fn?["max"]) ?? 5;
                return new() { ["max"] = JsonValue.Create(Math.Clamp(max, 1, 10)) };
            }
            case CustomFieldType.Barcode:
            {
                var format = (Str(cfg?["format"]) ?? Str(fn?["format"]) ?? "code128").Trim().ToLowerInvariant();
                if (format is not ("code128" or "ean13")) format = "code128";
                return new() { ["format"] = JsonValue.Create(format) };
            }
            default:
                return null;
        }
    }

    private static ParsedAppReport? ParseReport(JsonNode? node, IReadOnlyList<ParsedAppField> fields) =>
        ParseReportForFields(node, fields.Select(f => (f.Key, f.Label)).ToList());

    /// <summary>
    /// Analyse un nœud <c>report</c> en résolvant ses références (clé OU libellé) contre une liste de
    /// champs fournie — utilisée aussi bien pour un spec de création que pour un état posé sur une
    /// table EXISTANTE (modification), où les champs viennent du schéma réel.
    /// </summary>
    public static ParsedAppReport? ParseReportForFields(JsonNode? node, IReadOnlyList<(string Key, string Label)> fields)
    {
        if (node is not JsonObject obj) return null;
        var displayName = Str(obj["displayName"]) ?? Str(obj["title"]) ?? "Rapport";

        var byKey = fields.GroupBy(f => f.Key, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Key, StringComparer.Ordinal);
        var byLabel = fields.GroupBy(f => SlugKey(f.Label)).ToDictionary(g => g.Key, g => g.First().Key, StringComparer.Ordinal);

        string? ResolveField(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var r = raw.Trim();
            if (byKey.ContainsKey(r)) return r;
            var slug = SlugKey(r);
            if (byKey.ContainsKey(slug)) return slug;
            return byLabel.TryGetValue(slug, out var k) ? k : null;
        }

        var grouping = new List<string>();
        foreach (var g in (obj["groupBy"] ?? obj["dimensions"] ?? obj["grouping"])?.AsArray() ?? new JsonArray())
        {
            var f = ResolveField(Str(g));
            if (f is not null && !grouping.Contains(f)) grouping.Add(f);
        }

        var aggs = new List<ReportAggregation>();
        foreach (var m in (obj["measures"] ?? obj["aggregations"])?.AsArray() ?? new JsonArray())
        {
            string? field;
            string fnName;
            if (m is JsonObject mo)
            {
                field = ResolveField(Str(mo["field"]));
                fnName = (Str(mo["fn"]) ?? Str(mo["agg"]) ?? "sum").Trim().ToLowerInvariant();
            }
            else
            {
                field = ResolveField(Str(m));
                fnName = "sum";
            }
            if (!AggFns.Contains(fnName)) fnName = "sum";
            // count works without a field; others need one.
            if (field is null && fnName != "count") continue;
            aggs.Add(new ReportAggregation { Field = field ?? grouping.FirstOrDefault() ?? string.Empty, Fn = fnName });
        }

        // Un regroupement sans mesure reçoit un « count » implicite (comportement historique) —
        // ajouté AVANT le parsing du tri pour qu'un tri sur `count` se résolve.
        if (grouping.Count > 0 && aggs.Count == 0)
            aggs.Add(new ReportAggregation { Field = string.Empty, Fn = "count" });

        // Colonnes projetées (rapport de détail sans regroupement) : champ inconnu ignoré.
        var columns = new List<string>();
        foreach (var c in (obj["columns"] ?? obj["select"] ?? obj["fields"])?.AsArray() ?? new JsonArray())
        {
            var f = ResolveField(Str(c) ?? Str((c as JsonObject)?["field"]));
            if (f is not null && !columns.Contains(f)) columns.Add(f);
        }

        var filters = ParseFilters(obj["filters"] ?? obj["filtres"] ?? obj["where"], ResolveField);
        var sort = ParseSort(obj["sort"] ?? obj["orderBy"] ?? obj["tri"], ResolveField, aggs);

        if (grouping.Count == 0 && aggs.Count == 0 && columns.Count == 0 && filters.Count == 0 && sort.Count == 0)
            return null;
        return new ParsedAppReport(displayName!.Trim(), grouping, aggs, columns, filters, sort);
    }

    private static IReadOnlyList<ReportFilter> ParseFilters(JsonNode? node, Func<string?, string?> resolveField)
    {
        var result = new List<ReportFilter>();
        if (node is not JsonArray arr) return result;
        foreach (var it in arr)
        {
            if (it is not JsonObject fo) continue;
            var field = resolveField(Str(fo["field"]) ?? Str(fo["champ"]));
            if (field is null) continue; // champ inconnu → filtre ignoré
            var rawOp = (Str(fo["op"]) ?? Str(fo["operator"]) ?? "eq").Trim();
            if (!FilterOpAliases.TryGetValue(rawOp, out var op)) continue; // op hors liste blanche → ignoré
            var value = fo["value"] ?? fo["valeur"] ?? fo["values"];
            var value2 = fo["value2"] ?? fo["to"] ?? fo["max"];
            if (op == "in" && value is not JsonArray) op = "eq"; // scalaire toléré sur un `in`
            if (op == "between" && (value is null || value2 is null)) continue;
            if (value is null) continue;
            result.Add(new ReportFilter { Field = field, Op = op, Value = value.DeepClone(), Value2 = value2?.DeepClone() });
        }
        return result;
    }

    private static IReadOnlyList<ReportSort> ParseSort(
        JsonNode? node, Func<string?, string?> resolveField, IReadOnlyList<ReportAggregation> aggs)
    {
        var result = new List<ReportSort>();
        var arr = node as JsonArray;
        if (arr is null && node is not null) arr = new JsonArray(node.DeepClone()); // entrée unique tolérée
        if (arr is null) return result;

        // Un tri peut aussi viser une colonne d'agrégat du rapport groupé (count, sum_montant, …).
        var aggKeys = aggs
            .Select(a => string.Equals(a.Fn, "count", StringComparison.OrdinalIgnoreCase)
                ? "count"
                : $"{a.Fn.ToLowerInvariant()}_{a.Field}")
            .ToHashSet(StringComparer.Ordinal);

        foreach (var it in arr)
        {
            string? rawField;
            var dir = "asc";
            if (it is JsonObject so)
            {
                rawField = Str(so["field"]) ?? Str(so["champ"]);
                dir = NormalizeSortDir(Str(so["dir"]) ?? Str(so["direction"]) ?? Str(so["order"]));
            }
            else
            {
                rawField = Str(it);
                // « montant desc » toléré sur une entrée chaîne.
                var parts = rawField?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts is { Length: >= 2 })
                {
                    var last = parts[^1].ToLowerInvariant();
                    if (last is "asc" or "desc" or "descending" or "descendant" or "decroissant" or "croissant")
                    {
                        dir = NormalizeSortDir(last);
                        rawField = string.Join(' ', parts[..^1]);
                    }
                }
            }
            var field = resolveField(rawField)
                ?? (rawField is not null && aggKeys.Contains(SlugKey(rawField)) ? SlugKey(rawField) : null);
            if (field is null) continue; // champ inconnu → tri ignoré
            if (result.Any(s => s.Field == field)) continue;
            result.Add(new ReportSort { Field = field, Dir = dir });
        }
        return result;
    }

    private static string NormalizeSortDir(string? raw)
    {
        var d = raw?.Trim().ToLowerInvariant();
        return d is "desc" or "descending" or "descendant" or "decroissant" or "za" ? "desc" : "asc";
    }

    private static string? Str(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<string>(out var s)) return string.IsNullOrWhiteSpace(s) ? null : s;
        return v.ToString();
    }

    private static bool? Bool(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<bool>(out var b)) return b;
        var s = Str(n)?.Trim().ToLowerInvariant();
        return s switch { "true" or "oui" or "yes" or "1" => true, "false" or "non" or "no" or "0" => false, _ => (bool?)null };
    }

    private static int? Int(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<int>(out var i)) return i;
        return int.TryParse(Str(n), out var p) ? p : null;
    }
}
