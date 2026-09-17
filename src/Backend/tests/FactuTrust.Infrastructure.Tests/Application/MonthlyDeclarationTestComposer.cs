using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
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
}
