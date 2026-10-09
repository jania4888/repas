using FactuTrust.Application.Features.Accounting.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Année d'une date imprimée sans année (BH « 05-06 »).
///
/// <para>Cet utilitaire est le <b>point unique</b> : la lecture directe
/// (<c>BankStatementLayoutExtractor.ResolveDate</c>) et la lecture par IA
/// (<c>BankStatementAiPageReader</c>) s'y réfèrent toutes deux. Deux implémentations finiraient
/// par diverger, et un même relevé serait daté différemment selon le chemin qui l'a lu.</para>
/// </summary>
public sealed class BankStatementDayMonthDateTests
{
    private static readonly DateOnly JuneStart = new(2026, 6, 1);
    private static readonly DateOnly JuneEnd = new(2026, 6, 30);

    [Theory]
    [InlineData("05-06", 5, 6)]
    [InlineData("5/6", 5, 6)]
    [InlineData("05.06", 5, 6)]
    [InlineData(" 12-06 ", 12, 6)]
    public void A_day_month_token_is_read(string printed, int day, int month)
    {
        var parsed = BankStatementDayMonthDate.TryParseDayMonth(printed);

        Assert.NotNull(parsed);
        Assert.Equal((day, month), parsed!.Value);
    }

    [Theory]
    [InlineData("2026-06-05")]   // déjà complète
    [InlineData("05-06-26")]     // déjà complète
    [InlineData("05-06-2026")]
    [InlineData("13-13")]        // mois impossible
    [InlineData("05")]
    [InlineData("illisible")]
    [InlineData("")]
    [InlineData(null)]
    public void Anything_that_is_not_exactly_a_day_and_a_month_is_refused(string? printed)
    {
        Assert.Null(BankStatementDayMonthDate.TryParseDayMonth(printed));
    }

    [Fact]
    public void The_year_is_the_one_that_places_the_date_inside_the_period()
    {
        // Le cas BH : « 05-06 » sur un relevé de juin 2026.
        var resolved = BankStatementDayMonthDate.Resolve(5, 6, 2026, JuneStart, JuneEnd, valueAnchor: null);

        Assert.Equal(new DateOnly(2026, 6, 5), resolved);
    }

    [Fact]
    public void A_december_operation_on_a_january_statement_belongs_to_the_previous_year()
    {
        // Sans cette bascule, une opération du 31 décembre serait datée onze mois trop tard.
        var resolved = BankStatementDayMonthDate.Resolve(
            31, 12, 2026, new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31), valueAnchor: null);

        Assert.Equal(new DateOnly(2025, 12, 31), resolved);
    }

    [Fact]
    public void The_value_date_is_the_closest_anchor_when_it_is_known()
    {
        var resolved = BankStatementDayMonthDate.Resolve(
            31, 12, 2026, periodStart: null, periodEnd: null, valueAnchor: new DateOnly(2025, 12, 31));

        Assert.Equal(new DateOnly(2025, 12, 31), resolved);
    }

    [Fact]
    public void No_plausible_year_yields_nothing_rather_than_a_wrong_date()
    {
        // Aucune des trois années candidates ne tombe dans la période élargie de 45 jours : mieux
        // vaut une date non lue, signalée, qu'une date fausse enregistrée en comptabilité.
        var resolved = BankStatementDayMonthDate.Resolve(
            15, 9, 2026, new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31), valueAnchor: null);

        Assert.Null(resolved);
    }

    [Fact]
    public void Without_a_reference_year_nothing_is_invented()
    {
        Assert.Null(BankStatementDayMonthDate.Resolve(5, 6, null, null, null, null));
    }

    [Fact]
    public void A_29th_of_february_misread_on_a_non_leap_statement_yields_nothing()
    {
        // 2026, 2027 : février n'a que 28 jours. 2028 est bissextile, mais à plus d'un an de la
        // période : la marge de 45 jours l'écarte. Le « 29-02 » est donc une lecture fautive, et
        // la ligne sera signalée à vérifier plutôt que datée d'un exercice voisin.
        var resolved = BankStatementDayMonthDate.Resolve(
            29, 2, 2027, new DateOnly(2027, 2, 1), new DateOnly(2027, 2, 28), valueAnchor: null);

        Assert.Null(resolved);
    }

    [Fact]
    public void A_29th_of_february_on_a_leap_year_statement_resolves()
    {
        var resolved = BankStatementDayMonthDate.Resolve(
            29, 2, 2028, new DateOnly(2028, 2, 1), new DateOnly(2028, 2, 29), valueAnchor: null);

        Assert.Equal(new DateOnly(2028, 2, 29), resolved);
    }

    [Theory]
    [InlineData(2026, 6, 31)]   // juin n'a que 30 jours
    [InlineData(2026, 13, 1)]
    [InlineData(1999, 6, 5)]    // hors des exercices plausibles
    public void An_impossible_date_is_never_valid(int year, int month, int day)
    {
        Assert.False(BankStatementDayMonthDate.IsValid(day, month, year));
    }
}
