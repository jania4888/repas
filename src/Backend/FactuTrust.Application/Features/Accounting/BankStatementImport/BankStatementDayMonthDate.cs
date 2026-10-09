using System.Globalization;
using System.Text.RegularExpressions;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Année d'une date d'opération imprimée <b>sans année</b> — le relevé BH imprime « 05-06 » et
/// laisse l'année au seul en-tête du document.
///
/// <para>L'algorithme est celui que la lecture directe applique depuis l'origine : parmi l'année de
/// référence et ses deux voisines, on retient celle qui place la date dans la période du relevé
/// (élargie de 45 jours) et au plus près de la date valeur de la ligne ; à défaut d'ancre, au plus
/// près de la fin de période. <b>Jamais la date du jour</b>, et rien n'est rendu si aucune année ne
/// convient : une date non résolue reste un signalement, pas une invention.</para>
///
/// <para>Vit ici, dans la couche Application, pour n'exister qu'<b>une fois</b> :
/// <c>BankStatementLayoutExtractor</c> (lecture directe) et <c>BankStatementAiPageReader</c>
/// (lecture par IA) s'y réfèrent tous les deux. Deux implémentations finiraient par diverger, et
/// un relevé serait daté différemment selon le chemin qui l'a lu.</para>
/// </summary>
public static partial class BankStatementDayMonthDate
{
    /// <summary>Marge au-delà de la période imprimée dans laquelle une date reste plausible.</summary>
    private const int PeriodSlackDays = 45;

    /// <summary>Jour, mois et année forment-ils une date réelle d'un exercice plausible ?</summary>
    public static bool IsValid(int day, int month, int year) =>
        year is >= 2000 and <= 2100
        && month is >= 1 and <= 12
        && day >= 1
        && day <= DateTime.DaysInMonth(year, month);

    /// <summary>
    /// « 05-06 », « 05/06 », « 5.6 » → (5, 6). Rend null dès que le jeton porte autre chose qu'un
    /// jour et un mois : une date complète, un intervalle, du texte. Jour d'abord, convention
    /// tunisienne — à n'appeler que lorsque l'appelant accepte cette convention.
    /// </summary>
    public static (int Day, int Month)? TryParseDayMonth(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var match = DayMonthRegex().Match(value.Trim());
        if (!match.Success)
            return null;

        var day = int.Parse(match.Groups["d"].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups["m"].Value, CultureInfo.InvariantCulture);
        return month is >= 1 and <= 12 && day is >= 1 and <= 31 ? (day, month) : null;
    }

    /// <summary>
    /// Année la plus plausible pour un jour et un mois sans année. Null si aucune des trois années
    /// candidates ne tombe dans la période élargie — mieux vaut une date non lue qu'une date fausse.
    /// </summary>
    /// <param name="referenceYear">Année du relevé (période, ou date déjà résolue d'une autre ligne).</param>
    /// <param name="valueAnchor">Date valeur de la même ligne, quand elle est complète : la meilleure ancre.</param>
    public static DateOnly? Resolve(
        int day,
        int month,
        int? referenceYear,
        DateOnly? periodStart,
        DateOnly? periodEnd,
        DateOnly? valueAnchor)
    {
        if (referenceYear is not { } reference)
            return null;

        var target = valueAnchor ?? periodEnd ?? new DateOnly(reference, 12, 31);
        var candidates = new[] { reference - 1, reference, reference + 1 }
            .Where(y => IsValid(day, month, y))
            .Select(y => new DateOnly(y, month, day))
            .Where(d => (periodStart is null || d >= periodStart.Value.AddDays(-PeriodSlackDays))
                        && (periodEnd is null || d <= periodEnd.Value.AddDays(PeriodSlackDays)))
            .ToList();

        return candidates.Count == 0 ? null : candidates.MinBy(d => Math.Abs(d.DayNumber - target.DayNumber));
    }

    [GeneratedRegex(@"^(?<d>\d{1,2})[-/.](?<m>\d{1,2})$", RegexOptions.CultureInvariant)]
    private static partial Regex DayMonthRegex();
}
