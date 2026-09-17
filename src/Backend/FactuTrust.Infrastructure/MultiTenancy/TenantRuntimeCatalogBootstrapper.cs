using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;

using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.MultiTenancy;

/// <summary>
/// Idempotent NCT + withholding catalog bootstrap shared by template maintenance
/// and <see cref="TenantMigrationGuard"/>.
/// </summary>
public static class TenantRuntimeCatalogBootstrapper
{
    public static async Task EnsureAsync(
        TenantDbContext context,
        CancellationToken cancellationToken = default,
        ILogger? logger = null)
    {
        await Nct01ChartMigrationService.EnsureMigratedAsync(context, cancellationToken);
        await FixedAssetCategoryNctRepairService.EnsureAppliedAsync(context, cancellationToken);

        // Après le remap NCT 01 et la réparation des catégories, qui l'un comme l'autre créent ou
        // renumérotent des comptes : la compaction doit voir le plan définitif pour choisir des
        // cibles libres. Et avant tout le reste, puisque ChartOfAccount.Create refuse désormais un
        // numéro de plus de 8 chiffres.
        await CompactAccountNumbersAsync(context, logger, cancellationToken);

        await WithholdingTaxCatalogInitializer.EnsureSystemTypesSeededAsync(context, cancellationToken);
        await WithholdingFiscalYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);
        await IncomeTaxYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);
        await WithholdingChartAccountsInitializer.EnsureAccountsAsync(context, cancellationToken);

        // Catalogue standard des rubriques de la déclaration mensuelle. Ce point d'appel unique
        // couvre à la fois la création d'un dossier et le rattrapage des dossiers existants à leur
        // première requête après déploiement. Données inertes tant qu'aucune famille n'est cochée.
        await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);
    }

    /// <summary>
    /// Renumérote les comptes de plus de 8 chiffres, puis reprend sur les fiches salariés le compte
    /// figé sur leurs bulletins.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>L'échec ne fait pas tomber le dossier.</b> Le service refuse de renuméroter quand la
    /// correction automatique serait dangereuse — compte hors norme ayant des sous-comptes, compte
    /// système, vivier de numéros saturé. Laisser l'exception remonter mettrait alors tout le
    /// dossier en HTTP 503 jusqu'à intervention, pour un défaut qui n'empêche ni la facturation, ni
    /// la comptabilité, ni la trésorerie.
    /// </para>
    /// <para>
    /// Ne rien faire est ici le comportement <b>sûr</b> : aucune donnée n'est modifiée à moitié (la
    /// transaction du service est annulée en entier), le compte hors norme reste en l'état, et le
    /// contrôle d'intégrité <c>health-account-number-length</c> le signale. Seule la validation d'un
    /// cycle de paie qui aurait besoin de recréer ce compte échouera, avec un message nominatif.
    /// </para>
    /// </remarks>
    private static async Task CompactAccountNumbersAsync(
        TenantDbContext context, ILogger? logger, CancellationToken cancellationToken)
    {
        try
        {
            var result = await ChartAccountDigitCompactionService.EnsureCompactedAsync(
                context, cancellationToken: cancellationToken);

            if (result.Applied)
            {
                logger?.LogInformation(
                    "Renumérotation des comptes trop longs appliquée : {Count} compte(s) déplacé(s) "
                    + "(plan {PlanHash}). Correspondances dans ChartOfAccountCompactionLogs.",
                    result.MappingCount, result.PlanHash);
            }

            await ChartAccountDigitCompactionService.BackfillEmployeeAuxiliaryAccountsAsync(
                context, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger?.LogError(
                ex,
                "Renumérotation des comptes trop longs impossible sur ce dossier : le plan comptable "
                + "reste en l'état. Lancer docs/runbooks/sql/CompactOverlongAccountNumbers.readonly.sql "
                + "pour identifier l'anomalie bloquante.");
        }
    }
}
