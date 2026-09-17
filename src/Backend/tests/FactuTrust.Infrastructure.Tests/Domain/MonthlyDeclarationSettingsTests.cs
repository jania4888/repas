using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

/// <summary>
/// Rampe de bascule vers le moteur paramétré. C'est le garde-fou qui transforme un remplacement de
/// calcul en opération constatable : sans lui, une rubrique oubliée produirait un zéro qui partirait
/// à la recette des finances.
/// </summary>
public sealed class MonthlyDeclarationSettingsTests
{
    private static MonthlyDeclarationSettings Parity()
    {
        var settings = MonthlyDeclarationSettings.CreateDefault();
        settings.SwitchToParity();
        return settings;
    }

    private static void RunCleanPeriods(MonthlyDeclarationSettings settings, int year, int month, int count)
    {
        for (var i = 0; i < count; i++)
        {
            settings.RecordParityRun(year, month, 0);
            month++;
            if (month > 12) { month = 1; year++; }
        }
    }

    [Fact]
    public void Un_dossier_neuf_est_en_calcul_historique()
    {
        var settings = MonthlyDeclarationSettings.CreateDefault();

        Assert.Equal(MonthlyDeclarationMode.Legacy, settings.Mode);
        Assert.Null(settings.ConfiguredSince);
        Assert.Equal(0, settings.ParityCleanStreak);
        Assert.False(settings.CanSwitchToConfigured);
    }

    /// <summary>
    /// La bascule directe est refusée : sans un seul contrôle de parité, rien n'atteste que la
    /// configuration du dossier reproduit ce que ses déclarations portaient jusque-là.
    /// </summary>
    [Fact]
    public void La_bascule_directe_depuis_le_calcul_historique_est_refusee()
    {
        var settings = MonthlyDeclarationSettings.CreateDefault();

        var result = settings.SwitchToConfigured(new DateTime(2026, 10, 1), "audit@cabinet.tn", "on y va");

        Assert.True(result.IsFailure);
        Assert.Equal(MonthlyDeclarationMode.Legacy, settings.Mode);
    }

    [Fact]
    public void Trois_periodes_consecutives_sans_ecart_ouvrent_la_bascule()
    {
        var settings = Parity();

        RunCleanPeriods(settings, 2026, 6, MonthlyDeclarationSettings.RequiredCleanParityPeriods);

        Assert.Equal(MonthlyDeclarationSettings.RequiredCleanParityPeriods, settings.ParityCleanStreak);
        Assert.True(settings.CanSwitchToConfigured);

        var result = settings.SwitchToConfigured(new DateTime(2026, 10, 1), null, null);

        Assert.True(result.IsSuccess);
        Assert.Equal(MonthlyDeclarationMode.Configured, settings.Mode);
        Assert.Equal(new DateTime(2026, 10, 1), settings.ConfiguredSince);
        Assert.Null(settings.ParityOverrideReason);
    }

    /// <summary>
    /// Contrôler janvier, puis juin, puis décembre ne prouve rien sur les mois sautés : la série ne
    /// s'allonge que sur des périodes contiguës.
    /// </summary>
    [Fact]
    public void Des_periodes_non_contigues_repartent_la_serie_a_un()
    {
        var settings = Parity();

        settings.RecordParityRun(2026, 1, 0);
        settings.RecordParityRun(2026, 6, 0);
        settings.RecordParityRun(2026, 12, 0);

        Assert.Equal(1, settings.ParityCleanStreak);
        Assert.False(settings.CanSwitchToConfigured);
    }

    [Fact]
    public void Un_ecart_remet_la_serie_a_zero()
    {
        var settings = Parity();

        RunCleanPeriods(settings, 2026, 6, 2);
        settings.RecordParityRun(2026, 8, 3);

        Assert.Equal(0, settings.ParityCleanStreak);
        Assert.Equal(3, settings.LastParityMaxGapMillimes);
        Assert.False(settings.CanSwitchToConfigured);
    }

    /// <summary>
    /// Rejouer la même période ne rallonge pas la série : sinon, relancer trois fois le contrôle du
    /// même mois suffirait à ouvrir la bascule.
    /// </summary>
    [Fact]
    public void Rejouer_la_meme_periode_ne_rallonge_pas_la_serie()
    {
        var settings = Parity();

        settings.RecordParityRun(2026, 6, 0);
        settings.RecordParityRun(2026, 6, 0);
        settings.RecordParityRun(2026, 6, 0);

        Assert.Equal(1, settings.ParityCleanStreak);
        Assert.False(settings.CanSwitchToConfigured);
    }

    [Fact]
    public void La_serie_traverse_un_changement_d_annee()
    {
        var settings = Parity();

        RunCleanPeriods(settings, 2026, 11, 3);

        Assert.Equal(3, settings.ParityCleanStreak);
        Assert.True(settings.CanSwitchToConfigured);
    }

    [Fact]
    public void La_bascule_sans_serie_exige_une_derogation_nominative_et_motivee()
    {
        var settings = Parity();
        settings.RecordParityRun(2026, 6, 0);

        Assert.True(settings.SwitchToConfigured(new DateTime(2026, 7, 1), null, null).IsFailure);
        Assert.True(settings.SwitchToConfigured(new DateTime(2026, 7, 1), "audit@cabinet.tn", "  ").IsFailure);

        var result = settings.SwitchToConfigured(
            new DateTime(2026, 7, 1), "audit@cabinet.tn", "Reprise de dossier : aucun historique comparable.");

        Assert.True(result.IsSuccess);
        Assert.Equal(MonthlyDeclarationMode.Configured, settings.Mode);
        Assert.Equal("audit@cabinet.tn", settings.ParityOverrideBy);
        Assert.Contains("Reprise de dossier", settings.ParityOverrideReason);
    }

    [Fact]
    public void La_date_d_effet_doit_etre_un_premier_de_mois()
    {
        var settings = Parity();
        RunCleanPeriods(settings, 2026, 6, 3);

        Assert.True(settings.SwitchToConfigured(new DateTime(2026, 10, 15), null, null).IsFailure);
        Assert.True(settings.SwitchToConfigured(new DateTime(2026, 10, 1), null, null).IsSuccess);
    }

    /// <summary>
    /// Une période antérieure à la bascule reste calculée comme avant : rouvrir une déclaration
    /// ancienne doit la recalculer à l'identique, pas la réécrire avec les règles d'aujourd'hui.
    /// </summary>
    [Fact]
    public void Les_periodes_anterieures_a_la_bascule_restent_en_calcul_historique()
    {
        var settings = Parity();
        RunCleanPeriods(settings, 2026, 6, 3);
        settings.SwitchToConfigured(new DateTime(2026, 10, 1), null, null);

        Assert.Equal(MonthlyDeclarationMode.Legacy, settings.ResolveModeFor(2026, 9));
        Assert.Equal(MonthlyDeclarationMode.Configured, settings.ResolveModeFor(2026, 10));
        Assert.Equal(MonthlyDeclarationMode.Configured, settings.ResolveModeFor(2027, 3));
    }

    [Fact]
    public void Le_retour_au_calcul_historique_efface_la_date_d_effet_et_la_derogation()
    {
        var settings = Parity();
        settings.RecordParityRun(2026, 6, 0);
        settings.SwitchToConfigured(new DateTime(2026, 7, 1), "audit@cabinet.tn", "derogation");

        settings.SwitchToLegacy();

        Assert.Equal(MonthlyDeclarationMode.Legacy, settings.Mode);
        Assert.Null(settings.ConfiguredSince);
        Assert.Null(settings.ParityOverrideBy);
        Assert.Null(settings.ParityOverrideReason);
    }

    [Fact]
    public void Un_ecart_negatif_est_refuse()
    {
        var settings = Parity();

        Assert.True(settings.RecordParityRun(2026, 6, -1).IsFailure);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(13)]
    public void Un_mois_hors_bornes_est_refuse(int month)
    {
        var settings = Parity();

        Assert.True(settings.RecordParityRun(2026, month, 0).IsFailure);
    }
}
