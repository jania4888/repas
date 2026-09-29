using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using Moq;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Composeur de lignes paramétrées monté sur des dépôts simulés, pour les tests de la déclaration
/// mensuelle qui n'exercent pas la configuration.
/// </summary>
/// <remarks>
/// <para>
/// Les dépôts ne sont pas configurés, et c'est volontaire : avec les réglages d'un dossier ordinaire
/// — déclaration mensuelle unique active, déclaration paramétrable éteinte —
/// <c>ComposeAsync</c> sort sur un test booléen <b>avant</b> de les solliciter. Qu'aucun appel
/// simulé n'ait été prévu et que les tests passent tout de même est précisément la démonstration
/// recherchée : drapeau éteint, la fonctionnalité ne coûte pas une requête.
/// </para>
/// <para>
/// Les réglages passés sont ceux du test lui-même, jamais une copie allégée : c'est ce qui fait de
/// ces suites la preuve de non-régression du chantier.
/// </para>
/// </remarks>
internal static class MonthlyDeclarationTestComposer
{
    public static MonthlyDeclarationLineComposer Inactive(IOptions<AccountingSettings> settings) =>
        new(
            new Mock<IMonthlyDeclarationConfigRepository>().Object,
            new Mock<IJournalEntryRepository>().Object,
            new Mock<IChartOfAccountRepository>().Object,
            settings);

    /// <summary>
    /// Composeur d'un dossier en calcul paramétré depuis janvier 2026, dont les familles
    /// <paramref name="included"/> sont cochées et dont les rubriques actives sont
    /// <paramref name="rubrics"/>. Les rubriques n'étant pas assises sur des comptes, le journal ne
    /// rend aucun mouvement et le plan comptable n'est pas lu.
    /// </summary>
    public static MonthlyDeclarationLineComposer Configured(
        IOptions<AccountingSettings> settings,
        IReadOnlyList<MonthlyDeclarationRubric> rubrics,
        params MonthlyDeclarationFamily[] included) =>
        ConfiguredOn(new Mock<IMonthlyDeclarationConfigRepository>(), settings, rubrics, included);

    /// <summary>
    /// Même composeur, monté sur un dépôt de configuration fourni par le test — pour vérifier
    /// ensuite ce qui a été lu ou écrit.
    /// </summary>
    public static MonthlyDeclarationLineComposer ConfiguredOn(
        Mock<IMonthlyDeclarationConfigRepository> config,
        IOptions<AccountingSettings> settings,
        IReadOnlyList<MonthlyDeclarationRubric> rubrics,
        params MonthlyDeclarationFamily[] included) =>
        ConfiguredWithMovements(
            config, settings, rubrics, new Dictionary<string, AccountPeriodMovement>(StringComparer.Ordinal), included);

    /// <summary>
    /// Même composeur, dont le journal rend les mouvements donnés — pour les rubriques assises sur
    /// des comptes (loyers 613 de l'article 4, par exemple).
    /// </summary>
    public static MonthlyDeclarationLineComposer ConfiguredWithMovements(
        Mock<IMonthlyDeclarationConfigRepository> config,
        IOptions<AccountingSettings> settings,
        IReadOnlyList<MonthlyDeclarationRubric> rubrics,
        IReadOnlyDictionary<string, AccountPeriodMovement> movements,
        params MonthlyDeclarationFamily[] included)
    {
        var regime = MonthlyDeclarationSettings.CreateDefault();
        regime.SwitchToParity();
        regime.SwitchToConfigured(new DateTime(2026, 1, 1), "comptable@cabinet.tn", "test");

        config.Setup(c => c.GetSettingsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(regime);
        config.Setup(c => c.GetFamilySettingsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(included
                .Select(f => MonthlyDeclarationFamilySetting.Create(f, isIncluded: true).Value)
                .ToList());
        config.Setup(c => c.GetRubricsAsync(false, It.IsAny<CancellationToken>())).ReturnsAsync(rubrics);

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(j => j.SumMovementsByAccountsAsync(
                It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<IReadOnlyCollection<string>>(),
                It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(movements);

        // Plan comptable vide : un compte cité est alors signalé inconnu, sans rien changer au montant.
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(c => c.GetAllActiveAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<ChartOfAccount>());

        return new(config.Object, journals.Object, chart.Object, settings);
    }

    /// <summary>Rubrique à montants fixes : brut et retenue portés par la rubrique elle-même.</summary>
    public static MonthlyDeclarationRubric FixedRubric(
        MonthlyDeclarationFamily family, string code, string reportCode, decimal gross, decimal withheld) =>
        MonthlyDeclarationRubric.Create(
            family, code, code, reportCode,
            RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            ratePercent: 0m, fixedGrossAmount: gross, fixedWithheldAmount: withheld,
            payrollComponent: null, withheldPayrollComponent: null,
            effectiveFrom: null, effectiveTo: null, accounts: null).Value;
}
