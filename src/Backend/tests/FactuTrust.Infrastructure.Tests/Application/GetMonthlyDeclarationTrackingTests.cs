using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// « Suivi DM ». Ce qui compte ici : les douze mois sont toujours rendus — un trou de dépôt doit se
/// voir — et le régime affiché est celui de la période, pas celui du dossier aujourd'hui.
/// </summary>
public sealed class GetMonthlyDeclarationTrackingTests
{
    private static VatDeclaration Declaration(int year, int month, decimal collected)
    {
        var d = VatDeclaration.CreateDraft(
            year, month,
            Money.Create(collected, "TND"), Money.Zero("TND"), Money.Zero("TND"),
            Money.Zero("TND"), Money.Zero("TND"), Money.Zero("TND"), "TND");
        return d;
    }

    private static GetMonthlyDeclarationTrackingQueryHandler Handler(
        IReadOnlyList<VatDeclaration> declarations,
        MonthlyDeclarationSettings? settings = null,
        bool v2 = true,
        bool configurableActive = true)
    {
        var vat = new Mock<IVatDeclarationRepository>();
        vat.Setup(r => r.GetByYearAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(declarations);

        var config = new Mock<IMonthlyDeclarationConfigRepository>();
        config.Setup(r => r.GetSettingsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(settings);

        var options = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = v2,
            MonthlyDeclarationConfigurableLinesEnabled = configurableActive
        });

        return new GetMonthlyDeclarationTrackingQueryHandler(vat.Object, config.Object, options);
    }

    [Fact]
    public async Task Rend_les_douze_mois_meme_sans_aucun_depot()
    {
        var result = await Handler([]).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(12, result.Value.Months.Count);
        Assert.All(result.Value.Months, m => Assert.False(m.Exists));
        Assert.Equal(Enumerable.Range(1, 12), result.Value.Months.Select(m => m.Month));
    }

    /// <summary>
    /// L'échéance est portée même par une période sans dépôt : c'est justement là qu'elle sert.
    /// </summary>
    [Fact]
    public async Task Une_periode_sans_depot_porte_quand_meme_son_echeance()
    {
        var result = await Handler([]).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        var january = result.Value.Months.Single(m => m.Month == 1);
        Assert.False(january.Exists);
        Assert.Equal(new DateTime(2026, 2, 22), january.FilingDeadline);
    }

    [Fact]
    public async Task Rend_le_statut_et_les_montants_d_une_periode_deposee()
    {
        var declaration = Declaration(2026, 3, collected: 500m);
        declaration.Submit();

        var result = await Handler([declaration]).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        var march = result.Value.Months.Single(m => m.Month == 3);
        Assert.True(march.Exists);
        Assert.Equal((int)VatDeclarationStatus.Submitted, march.Status);
        Assert.NotNull(march.SubmittedAt);
        Assert.Equal(500m, march.VatDue);
        Assert.Equal(500m, march.TotalToPay);
    }

    /// <summary>
    /// Le total à payer vient de l'expression partagée avec l'écran de déclaration. Une copie de la
    /// formule finirait par donner deux chiffres pour la même période.
    /// </summary>
    [Fact]
    public async Task Le_total_a_payer_agrege_les_familles_et_deduit_les_acomptes()
    {
        var declaration = Declaration(2026, 4, collected: 1000m);
        declaration.SetAdditionalTaxes(
            fodec: 10m, droitTimbre: 5m, tcl: 20m, tfp: 30m, foprolos: 15m,
            withholdingTax: 40m, acomptes: 100m);
        declaration.SetConfiguredFamilyTaxes(consumptionDuty: 7m, hotelTax: 3m, licenceFee: 2m);

        var result = await Handler([declaration]).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        // 1000 + 10 + 5 + 20 + 30 + 15 + 40 + 7 + 3 + 2 − 100
        Assert.Equal(1032m, result.Value.Months.Single(m => m.Month == 4).TotalToPay);
    }

    /// <summary>
    /// Hors V2, le total à payer reste la seule T.V.A due : c'est la garantie de non-régression,
    /// et le suivi doit la refléter comme le reste.
    /// </summary>
    [Fact]
    public async Task Hors_v2_le_total_reste_la_tva_due()
    {
        var declaration = Declaration(2026, 4, collected: 1000m);
        declaration.SetAdditionalTaxes(
            fodec: 10m, droitTimbre: 5m, tcl: 20m, tfp: 30m, foprolos: 15m,
            withholdingTax: 40m, acomptes: 0m);

        var result = await Handler([declaration], v2: false).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        Assert.Equal(1000m, result.Value.Months.Single(m => m.Month == 4).TotalToPay);
    }

    /// <summary>
    /// Le cœur du suivi pendant la migration : un dossier basculé en juillet a ses six premiers mois
    /// restés au calcul historique. Les afficher tous « paramétrés » raconterait une histoire fausse.
    /// </summary>
    [Fact]
    public async Task Le_regime_affiche_est_celui_de_la_periode_pas_celui_du_dossier()
    {
        var settings = MonthlyDeclarationSettings.CreateDefault();
        settings.SwitchToParity();
        for (var month = 1; month <= 3; month++)
            settings.RecordParityRun(2026, month, 0);
        var switched = settings.SwitchToConfigured(new DateTime(2026, 7, 1), null, null);
        Assert.True(switched.IsSuccess, switched.Error?.Description);

        var result = await Handler([], settings).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        Assert.Equal(
            (int)MonthlyDeclarationMode.Legacy,
            result.Value.Months.Single(m => m.Month == 6).Mode);
        Assert.Equal(
            (int)MonthlyDeclarationMode.Configured,
            result.Value.Months.Single(m => m.Month == 7).Mode);
    }

    [Fact]
    public async Task Un_dossier_jamais_parametre_est_en_calcul_historique_partout()
    {
        var result = await Handler([]).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        Assert.All(
            result.Value.Months,
            m => Assert.Equal((int)MonthlyDeclarationMode.Legacy, m.Mode));
    }

    [Fact]
    public async Task Rend_l_etat_de_la_rampe_avec_les_mois()
    {
        var settings = MonthlyDeclarationSettings.CreateDefault();
        settings.SwitchToParity();
        settings.RecordParityRun(2026, 1, 0);

        var result = await Handler([], settings).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        Assert.Equal((int)MonthlyDeclarationMode.Parity, result.Value.Settings.Mode);
        Assert.Equal(1, result.Value.Settings.ParityCleanStreak);
        Assert.True(result.Value.Settings.ConfigurableLinesEnabled);
    }

    /// <summary>
    /// Le suivi sert d'abord à voir les trous de dépôt, un besoin qui ne dépend d'aucun drapeau.
    /// </summary>
    [Fact]
    public async Task Reste_lisible_drapeau_eteint_en_le_signalant()
    {
        var result = await Handler([], configurableActive: false).Handle(
            new GetMonthlyDeclarationTrackingQuery(2026), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(12, result.Value.Months.Count);
        Assert.False(result.Value.Settings.ConfigurableLinesEnabled);
    }

    [Theory]
    [InlineData(1999)]
    [InlineData(2101)]
    public async Task Refuse_un_exercice_hors_bornes(int year)
    {
        var result = await Handler([]).Handle(
            new GetMonthlyDeclarationTrackingQuery(year), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("Exercice", result.Error.Description);
    }
}
