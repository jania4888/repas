using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>
/// Rend les gabarits « {{ chemin }} » des workflows Studio : champs de l'enregistrement
/// (<c>{{montant}}</c>), <c>{{_now}}</c> (ISO 8601 UTC) et chemins de contexte
/// (<c>_record</c>, <c>_startedBy</c>, <c>_previous</c>, <c>_approval</c>, <c>_results</c> via
/// <see cref="StudioWorkflowContext.Resolve"/>). Aucune exécution de code ; variable inconnue ⇒
/// chaîne vide + avertissement « Variable « x » inconnue. » ; sortie tronquée à 4000 caractères.
/// </summary>
public static class StudioTemplateRenderer
{
    private static readonly Regex Placeholder = new(
        @"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]{0,80})\s*\}\}",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public const int MaxRenderedLength = 4000;

    /// <summary>Vrai si la chaîne contient au moins un placeholder valide.</summary>
    public static bool IsTemplate(string? s) => s is not null && Placeholder.IsMatch(s);

    public static (string Value, IReadOnlyList<string> Warnings) Render(
        string template, JsonObject recordData, StudioWorkflowContext context, DateTime nowUtc)
    {
        var warnings = new List<string>();
        var rendered = Placeholder.Replace(template, match =>
        {
            var path = match.Groups[1].Value;
            var node = ResolvePath(path, recordData, context, nowUtc, out var known);
            if (!known)
            {
                warnings.Add($"Variable « {path} » inconnue.");
                return string.Empty;
            }
            return NodeToString(node) ?? string.Empty;
        });
        if (rendered.Length > MaxRenderedLength)
            rendered = rendered[..MaxRenderedLength];
        return (rendered, warnings);
    }

    /// <summary>
    /// Rend une valeur de gabarit : une chaîne exactement égale à un seul placeholder donne la
    /// valeur JSON typée d'origine (clone), toute autre chaîne est rendue en texte et une valeur
    /// non-chaîne est retournée inchangée.
    /// </summary>
    public static JsonNode? RenderValue(
        JsonNode? value, JsonObject recordData, StudioWorkflowContext context, DateTime nowUtc)
    {
        if (value is not JsonValue jsonValue || !jsonValue.TryGetValue<string>(out var s))
            return value;

        var single = Placeholder.Match(s);
        if (single.Success && single.Index == 0 && single.Length == s.Length)
        {
            var node = ResolvePath(single.Groups[1].Value, recordData, context, nowUtc, out var known);
            if (known)
                return node?.DeepClone();
        }

        var (rendered, _) = Render(s, recordData, context, nowUtc);
        return JsonValue.Create(rendered);
    }

    // ---- Résolution ----

    private static JsonNode? ResolvePath(
        string path, JsonObject recordData, StudioWorkflowContext context, DateTime nowUtc, out bool known)
    {
        known = true;
        if (path == "_now")
            return JsonValue.Create(nowUtc.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture));

        if (path.StartsWith('_'))
        {
            var root = path.Split('.')[0];
            if (root is "_record" or "_startedBy" or "_previous" or "_approval" or "_results")
                return context.Resolve(path);
            known = false;
            return null;
        }

        if (recordData.TryGetPropertyValue(path, out var node))
            return node;
        known = false;
        return null;
    }

    private static string? NodeToString(JsonNode? node)
    {
        if (node is null) return null;
        if (node is not JsonValue v) return node.ToJsonString();
        if (v.TryGetValue<JsonElement>(out var el))
        {
            return el.ValueKind switch
            {
                JsonValueKind.String => el.GetString(),
                JsonValueKind.Number => el.TryGetDecimal(out var d)
                    ? d.ToString(CultureInfo.InvariantCulture)
                    : el.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Null => null,
                _ => el.GetRawText()
            };
        }
        if (v.TryGetValue<string>(out var s)) return s;
        if (v.TryGetValue<bool>(out var b)) return b ? "true" : "false";
        if (v.TryGetValue<decimal>(out var dec)) return dec.ToString(CultureInfo.InvariantCulture);
        if (v.TryGetValue<double>(out var dbl)) return dbl.ToString(CultureInfo.InvariantCulture);
        if (v.TryGetValue<int>(out var i)) return i.ToString(CultureInfo.InvariantCulture);
        if (v.TryGetValue<long>(out var l)) return l.ToString(CultureInfo.InvariantCulture);
        if (v.TryGetValue<DateTime>(out var dt)) return dt.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
        if (v.TryGetValue<Guid>(out var g)) return g.ToString();
        return v.ToString();
    }
}
