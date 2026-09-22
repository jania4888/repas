using FactuTrust.Application.Common;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;

using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.MultiTenancy;

/// <summary>
/// Idempotent NCT + withholding catalog bootstrap shared by tenant provisioning, template
/// maintenance and <see cref="TenantMigrationGuard"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>C'est le seul endroit qui pose le plan comptable NCT 01</b> (623 comptes) : les migrations EF
/// ne sèment que le plan « hybride PCG » historique (~210 comptes). Il doit donc être appelé à la
/// fin de tout provisionnement, quelle que soit la stratégie, et pas seulement à la construction du
/// template ou au premier appel HTTP.
/// </para>
/// </remarks>
public static class TenantRuntimeCatalogBootstrapper
{
    public static async Task<TenantRuntimeCatalogReport> EnsureAsync(
        TenantDbContext context,
        ChartMigrationMode chartMode = ChartMigrationMode.AutoSafe,
        CancellationToken cancellationToken = default,
        ILogger? logger = null)
    {
        var report = await Nct01ChartMigrationService.EnsureMigratedAsync(context, chartMode, cancellationToken);

        if (report.ChartOutcome == ChartCatalogOutcome.DeferredHasAccountingData)
        {
            logger?.LogWarning(
                "Plan comptable : bascule NCT 01 différée sur ce dossier — {Lines} ligne(s) d'écriture "
                + "déjà saisies sur le plan hérité ({Accounts} comptes). Le remap réécrirait "
                + "l'historique, périodes clôturées comprises : il doit être déclenché par un "
                + "administrateur plateforme après sauvegarde "
                + "(POST /api/platform/migrations/tenants/{{tenantId}}/chart-of-accounts/apply, "
                + "cf. docs/runbooks/coa-nct01-migration.md).",
                report.AccountingLineCount,
                report.AccountCount);

            // Étapes volontairement limitées à ce qui ne dépend PAS du plan comptable. La réparation
            // des catégories d'amortissement et les comptes de retenue à la source visent des
            // numéros NCT (221/2821/68112, parent 432) qui n'existent pas dans le plan hérité :
            // les poser ici créerait des références suspendues. Le plan du dossier reste donc
            // exactement dans l'état où l'exploitation l'a laissé.
            await WithholdingTaxCatalogInitializer.EnsureSystemTypesSeededAsync(context, cancellationToken);
            await WithholdingFiscalYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);
            await IncomeTaxYearParameterInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);
            await MonthlyDeclarationRubricInitializer.EnsureDefaultsSeededAsync(context, cancellationToken);

            return report;
        }

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

        if (report.ChartOutcome is ChartCatalogOutcome.Applied or ChartCatalogOutcome.CatalogResynced)
        {
            logger?.LogInformation(
                "Plan comptable : {Outcome} — {Accounts} comptes, catalogue {Hash}.",
                report.ChartOutcome,
                report.AccountCount,
                report.CurrentCatalogHash);
        }

        return report;
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
