using System.Reflection;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using Hangfire;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA 4.7★2 (S6) : <see cref="StudioWorkflowCronSpec"/> testée directement (la validation 4.7b1 la
/// couvrait seulement au travers de <c>StudioWorkflowStepsSpec</c>). Grammaire à 5 champs, bornes par champ,
/// noms de mois / jours, pas, plages, listes, normalisation des espaces ; <c>* * * * *</c> accepté (U5).
/// Recoupement avec Hangfire : chaque préréglage produit par <see cref="Cron"/> est accepté par la spec, et,
/// quand l'analyseur Cronos embarqué dans Hangfire.Core est accessible par réflexion, chaque expression acceptée
/// par la spec est aussi analysable par Cronos (la forme exacte reste revérifiée par Hangfire à l'enregistrement).
/// </summary>
public sealed class StudioWorkflowCronSpecTests
{
    [Theory]
    [InlineData("* * * * *", "* * * * *")]            // U5 : « chaque minute » accepté (documenté, sans pas minimal)
    [InlineData("0 6 * * 1", "0 6 * * 1")]
    [InlineData("*/10 * * * *", "*/10 * * * *")]
    [InlineData("30 6 1 * *", "30 6 1 * *")]
    [InlineData("0 0 1 JAN *", "0 0 1 JAN *")]
    [InlineData("0 18 * * MON-FRI", "0 18 * * MON-FRI")]
    [InlineData("0 6 * * 0", "0 6 * * 0")]
    [InlineData("0 6 * * 7", "0 6 * * 7")]            // 7 = dimanche (convention crontab)
    [InlineData("0 8,12,18 * * *", "0 8,12,18 * * *")]
    [InlineData("0 6-8/2 * * *", "0 6-8/2 * * *")]    // plage avec pas
    [InlineData("0 6 * jan-dec *", "0 6 * jan-dec *")] // noms insensibles à la casse
    [InlineData("  0   6 *  *   1  ", "0 6 * * 1")]    // espaces multiples ⇒ normalisation
    public void Accepts_valid_five_field_expressions_and_normalizes_whitespace(string expression, string expectedNormalized)
    {
        Assert.True(StudioWorkflowCronSpec.TryParse(expression, out var normalized), expression);
        Assert.Equal(expectedNormalized, normalized);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("0 6 * *")]          // 4 champs
    [InlineData("0 6 * * * *")]      // 6 champs (secondes non supportées)
    [InlineData("chaque jour")]      // texte libre
    public void Rejects_expressions_that_do_not_have_exactly_five_fields(string? expression)
    {
        Assert.False(StudioWorkflowCronSpec.TryParse(expression, out var normalized));
        Assert.Equal(string.Empty, normalized);
    }

    [Theory]
    [InlineData("60 * * * *")]       // minute 60
    [InlineData("-1 * * * *")]       // minute négative
    [InlineData("* 24 * * *")]       // heure 24
    [InlineData("0 6 0 * *")]        // jour du mois 0
    [InlineData("0 6 32 * *")]       // jour du mois 32
    [InlineData("0 6 * 0 *")]        // mois 0
    [InlineData("0 6 * 13 *")]       // mois 13
    [InlineData("0 6 * * 8")]        // jour de semaine 8
    public void Rejects_values_outside_each_field_bounds(string expression)
    {
        Assert.False(StudioWorkflowCronSpec.TryParse(expression, out _), expression);
    }

    [Theory]
    [InlineData("*/0 * * * *")]      // pas nul
    [InlineData("*/-5 * * * *")]     // pas négatif
    [InlineData("*/ * * * *")]       // pas vide
    [InlineData("0 8-6 * * *")]      // plage inversée
    [InlineData("0 6-8-10 * * *")]   // deux tirets
    [InlineData("0 6,, * * *")]      // terme vide dans une liste
    [InlineData("0 6 * * LUN")]      // nom de jour inconnu (FR)
    [InlineData("0 6 * JANV *")]     // nom de mois inconnu
    [InlineData("0 6 * * MON-FRI-SAT")]
    [InlineData("0 6 ? * *")]        // jeton Quartz
    [InlineData("0 6 L * *")]        // jeton « dernier jour »
    public void Rejects_malformed_steps_ranges_lists_and_unknown_names(string expression)
    {
        Assert.False(StudioWorkflowCronSpec.TryParse(expression, out _), expression);
    }

    [Fact]
    public void Day_names_map_to_their_crontab_index_and_month_names_to_1_12()
    {
        // Les noms sont acceptés exactement là où les nombres le sont : plage nom-nom et pas sur nom.
        Assert.True(StudioWorkflowCronSpec.TryParse("0 6 * * SUN-SAT", out _));
        Assert.True(StudioWorkflowCronSpec.TryParse("0 6 * JAN-DEC *", out _));
        Assert.True(StudioWorkflowCronSpec.TryParse("0 6 * * MON/2", out _));
        // Un nom de mois dans le champ des jours (et inversement) est rejeté.
        Assert.False(StudioWorkflowCronSpec.TryParse("0 6 * * JAN", out _));
        Assert.False(StudioWorkflowCronSpec.TryParse("0 6 * MON *", out _));
        // Un nom là où la règle n'en connaît aucun (minute) est rejeté.
        Assert.False(StudioWorkflowCronSpec.TryParse("MON 6 * * *", out _));
    }

    [Fact]
    public void Every_hangfire_cron_helper_output_is_accepted_by_the_spec()
    {
        // Les préréglages du concepteur (« Fréquence », 4.7b5) et les jobs internes utilisent ces formes :
        // tout ce que Hangfire produit doit passer la validation 400 précoce.
        var helpers = new[]
        {
            Cron.Minutely(), Cron.Hourly(), Cron.Hourly(15), Cron.Daily(), Cron.Daily(6), Cron.Daily(6, 30),
            Cron.Weekly(), Cron.Weekly(DayOfWeek.Monday), Cron.Weekly(DayOfWeek.Monday, 6), Cron.Weekly(DayOfWeek.Sunday, 6, 15),
            Cron.Monthly(), Cron.Monthly(1), Cron.Monthly(1, 6), Cron.Monthly(28, 6, 30),
            Cron.Yearly(), Cron.Yearly(1), Cron.Yearly(1, 1), Cron.Yearly(12, 31, 23), Cron.Yearly(12, 31, 23, 59),
            Cron.MinuteInterval(10), Cron.HourInterval(6), Cron.DayInterval(2), Cron.MonthInterval(3)
        };

        foreach (var expression in helpers)
        {
            Assert.True(StudioWorkflowCronSpec.TryParse(expression, out var normalized), $"Hangfire : {expression}");
            Assert.Equal(expression, normalized);
        }
    }

    /// <summary>
    /// Recoupement avec l'analyseur que Hangfire applique à l'enregistrement (Cronos, embarqué interne dans
    /// Hangfire.Core ; <c>RecurringJobEntity.ParseCronExpression</c> → <c>Cronos.CronExpression.Parse</c>) :
    /// tout ce que la spec accepte doit être accepté par Cronos (sinon <c>AddOrUpdate</c> lèverait au moment
    /// d'activer le workflow, 4.7b2), et les bornes hors plage rejetées par la spec le sont aussi par Cronos.
    /// La spec reste volontairement plus stricte (ni <c>?</c>, <c>L</c>, <c>#</c>, ni macros <c>@daily</c>).
    /// </summary>
    [SkippableFact]
    public void Expressions_accepted_by_the_spec_are_parseable_by_the_cronos_parser_embedded_in_hangfire()
    {
        var parse = typeof(Cron).Assembly.GetType("Cronos.CronExpression")
            ?.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, new[] { typeof(string) });
        Skip.If(parse is null,
            "Hangfire.Core n'embarque plus Cronos.CronExpression.Parse(string) : adapter la réflexion (Hangfire.Core 1.8.14 l'expose).");

        var accepted = new[]
        {
            "* * * * *", "0 6 * * 1", "*/10 * * * *", "30 6 1 * *", "0 0 1 JAN *", "0 18 * * MON-FRI",
            "0 6 * * 0", "0 6 * * 7", "0 8,12,18 * * *", "0 6-8/2 * * *", "0 6 * * SUN-SAT", "0 0 1 */3 *"
        };
        foreach (var expression in accepted)
        {
            Assert.True(StudioWorkflowCronSpec.TryParse(expression, out _), expression);
            var exception = Record.Exception(() => parse!.Invoke(null, new object[] { expression }));
            Assert.True(exception is null, $"Cronos rejette « {expression} » : {exception?.InnerException?.Message ?? exception?.Message}");
        }

        var outOfRange = new[] { "60 * * * *", "* 24 * * *", "0 6 32 * *", "0 6 * 13 *", "0 6 * * 8", "0 6 * *" };
        foreach (var expression in outOfRange)
        {
            Assert.False(StudioWorkflowCronSpec.TryParse(expression, out _), expression);
            Assert.NotNull(Record.Exception(() => parse!.Invoke(null, new object[] { expression })));
        }
    }
}
