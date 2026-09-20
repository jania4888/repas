using System.Collections;
using System.Globalization;
using System.Text.Json.Nodes;

namespace FactuTrust.Application.Features.Studio.Common;

/// <summary>
/// Évalue les filtres des workflows Studio (étapes <c>condition</c>) avec exactement la sémantique
/// de <see cref="CustomReportRunner"/> : champ inconnu ⇒ le filtre passe (défensif), opérateur
/// inconnu ⇒ idem, comparaisons numériques en <c>decimal</c> quand le champ est numérique,
/// comparaison de chaînes <see cref="StringComparison.OrdinalIgnoreCase"/> sinon.
/// <c>is_empty</c> / <c>is_not_empty</c> (absents du rapport) : null, chaîne vide/blanche ou
/// tableau vide. Pure (aucune dépendance) ; la parité avec le rapport est figée par les tests (D17).
/// </summary>
public static class StudioFilterEvaluator
{
    /// <summary>Les 11 opérateurs — mêmes clés que <c>RecordViewDefinitionValidator.Operators</c>.</summary>
    public static readonly IReadOnlySet<string> Operators = new HashSet<string>(StringComparer.Ordinal)
        { "eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "between", "is_empty", "is_not_empty" };

    public static bool Passes(
        IReadOnlyDictionary<string, object?> row,
        StudioFilter filter,
        IReadOnlyDictionary<string, FilterFieldMeta> fieldByKey)
    {
        if (!fieldByKey.TryGetValue(filter.Field, out var field))
            return true; // unknown filter field is ignored (same defensive semantics as the report runner)

        var cell = Normalize(row.GetValueOrDefault(filter.Field));
        var numeric = field.Numeric;
        var value = Normalize(filter.Value);

        switch (filter.Op.ToLowerInvariant())
        {
            case "eq": return Compare(cell, value, numeric) == 0;
            case "neq": return Compare(cell, value, numeric) != 0;
            case "gt": return Compare(cell, value, numeric) > 0;
            case "gte": return Compare(cell, value, numeric) >= 0;
            case "lt": return Compare(cell, value, numeric) < 0;
            case "lte": return Compare(cell, value, numeric) <= 0;
            case "contains":
                return (ToStr(cell) ?? string.Empty).Contains(ToStr(value) ?? string.Empty, StringComparison.OrdinalIgnoreCase);
            case "in":
                return ListValues(filter.Value).Any(v => Compare(cell, Normalize(v), numeric) == 0);
            case "between":
                return Compare(cell, value, numeric) >= 0 && Compare(cell, Normalize(filter.Value2), numeric) <= 0;
            case "is_empty":
                return IsEmpty(cell);
            case "is_not_empty":
                return !IsEmpty(cell);
            default:
                return true;
        }
    }

    /// <summary>Combine les filtres : tous (<paramref name="matchAll"/>) ou au moins un.</summary>
    public static bool PassesAll(
        IReadOnlyDictionary<string, object?> row,
        IReadOnlyList<StudioFilter> filters,
        IReadOnlyDictionary<string, FilterFieldMeta> fieldByKey,
        bool matchAll)
        => matchAll
            ? filters.All(f => Passes(row, f, fieldByKey))
            : filters.Any(f => Passes(row, f, fieldByKey));

    /// <summary>Convertit un nœud JSON en primitif — délégué à <see cref="CustomReportRunner.JsonToPrimitive"/> (public).</summary>
    public static object? ToPrimitive(JsonNode? node) => CustomReportRunner.JsonToPrimitive(node);

    // ---- Helpers (copie de la sémantique privée de CustomReportRunner : Compare/ToStr/TryGetDecimal) ----

    private static object? Normalize(object? value) => value is JsonNode node ? ToPrimitive(node) : value;

    private static IEnumerable<object?> ListValues(object? value)
    {
        if (value is JsonArray arr)
            return arr.Select(ToPrimitive);
        if (value is IEnumerable seq and not string)
            return seq.Cast<object?>();
        return Enumerable.Empty<object?>();
    }

    private static bool IsEmpty(object? cell) => cell switch
    {
        null => true,
        string s => string.IsNullOrWhiteSpace(s),
        ICollection col => col.Count == 0,
        _ => false
    };

    private static int Compare(object? cell, object? value, bool numeric)
    {
        if (numeric && TryGetDecimal(cell, out var a) && TryGetDecimal(value, out var b))
            return a.CompareTo(b);
        return string.Compare(ToStr(cell) ?? string.Empty, ToStr(value) ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    private static string? ToStr(object? value) => value switch
    {
        null => null,
        decimal d => d.ToString(CultureInfo.InvariantCulture),
        double db => db.ToString(CultureInfo.InvariantCulture),
        int i => i.ToString(CultureInfo.InvariantCulture),
        long l => l.ToString(CultureInfo.InvariantCulture),
        bool b => b ? "true" : "false",
        DateTime dt => dt.ToString("o", CultureInfo.InvariantCulture),
        _ => value.ToString()
    };

    private static bool TryGetDecimal(object? value, out decimal result)
    {
        switch (value)
        {
            case decimal d: result = d; return true;
            case double db: result = (decimal)db; return true;
            case int i: result = i; return true;
            case long l: result = l; return true;
            case string s when decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var ds): result = ds; return true;
            default: result = 0m; return false;
        }
    }
}

/// <summary>Filtre d'une condition de workflow. <paramref name="Value2"/> ne sert que pour <c>between</c>.</summary>
public sealed record StudioFilter(string Field, string Op, object? Value, object? Value2 = null);

/// <summary>Métadonnée d'un champ filtrable : comparaison numérique si <paramref name="Numeric"/>, dates ISO triables si <paramref name="Date"/>.</summary>
public sealed record FilterFieldMeta(string Key, bool Numeric, bool Date);
