using System.Text.RegularExpressions;

namespace FactuTrust.Application.Features.Studio.Workflows.Spec;

/// <summary>
/// Validation pure des expressions cron à 5 champs du déclencheur planifié (4.7b1 / D-47-B02, D5 levé) :
/// minute (0-59), heure (0-23), jour du mois (1-31), mois (1-12 ou JAN-DEC), jour de semaine
/// (0-7 ou SUN-SAT, 0 et 7 = dimanche). Jetons : <c>*</c>, listes <c>,</c>, plages <c>-</c>, pas <c>/</c>.
/// Sous-ensemble volontaire du gabarit Cronos/Hangfire : la forme exacte est revérifiée par Hangfire à
/// l'enregistrement du job récurrent (4.7b2, best-effort) — ici : rejet 400 précoce, chemin
/// <c>triggerConfig.cron</c>. Pure : aucune dépendance Infrastructure.
/// </summary>
public static class StudioWorkflowCronSpec
{
    private static readonly string[] MonthNames =
        { "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC" };

    private static readonly string[] DayNames =
        { "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT" };

    private static readonly (int Min, int Max, string[]? Names)[] Fields =
    {
        (0, 59, null),          // minute
        (0, 23, null),          // heure
        (1, 31, null),          // jour du mois
        (1, 12, MonthNames),    // mois
        (0, 7, DayNames)        // jour de semaine (7 = dimanche, convention crontab)
    };

    /// <summary>Analyse l'expression ; <paramref name="normalized"/> = trim + espaces uniques.</summary>
    public static bool TryParse(string? expression, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(expression))
            return false;

        var parts = Regex.Split(expression.Trim(), @"\s+");
        if (parts.Length != Fields.Length)
            return false;

        for (var i = 0; i < parts.Length; i++)
        {
            if (!IsValidField(parts[i], Fields[i]))
                return false;
        }

        normalized = string.Join(' ', parts);
        return true;
    }

    /// <summary>Un champ est une liste de termes séparés par des virgules, chacun avec un pas « /n » optionnel.</summary>
    private static bool IsValidField(string field, (int Min, int Max, string[]? Names) rule)
    {
        foreach (var term in field.Split(','))
        {
            if (term.Length == 0)
                return false;

            var slash = term.IndexOf('/');
            var range = slash >= 0 ? term[..slash] : term;
            if (slash >= 0)
            {
                var step = term[(slash + 1)..];
                if (!int.TryParse(step, out var n) || n < 1)
                    return false;
            }
            if (!IsValidTerm(range, rule))
                return false;
        }
        return true;
    }

    private static bool IsValidTerm(string term, (int Min, int Max, string[]? Names) rule)
    {
        if (term == "*")
            return true;

        var dash = term.IndexOf('-');
        if (dash >= 0)
        {
            if (term.IndexOf('-', dash + 1) >= 0)
                return false; // un seul tiret par plage
            return TryValue(term[..dash], rule, out var from)
                && TryValue(term[(dash + 1)..], rule, out var to)
                && from <= to;
        }
        return TryValue(term, rule, out _);
    }

    private static bool TryValue(string token, (int Min, int Max, string[]? Names) rule, out int value)
    {
        value = 0;
        if (int.TryParse(token, out var numeric))
        {
            value = numeric;
            return numeric >= rule.Min && numeric <= rule.Max;
        }

        if (rule.Names is { } names)
        {
            var index = Array.FindIndex(names, n => string.Equals(n, token, StringComparison.OrdinalIgnoreCase));
            if (index >= 0)
            {
                value = rule.Min + index;
                return true;
            }
        }
        return false;
    }
}
