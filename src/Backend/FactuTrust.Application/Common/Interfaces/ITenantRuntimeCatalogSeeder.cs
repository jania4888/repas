using FactuTrust.Application.Common;

namespace FactuTrust.Application.Common.Interfaces;

/// <summary>
/// Pose sur une base tenant <b>déjà migrée</b> les catalogues qui ne sont pas semés par les
/// migrations EF : plan comptable NCT 01 (623 comptes), réparation des catégories
/// d'amortissement, renumérotation des comptes trop longs, comptes de retenue à la source,
/// paramètres d'exercice et rubriques de la déclaration mensuelle.
/// </summary>
/// <remarks>
/// <para>
/// Ce contrat existe pour une raison précise : la migration EF <c>20260326233329</c> sème un plan
/// « hybride PCG » d'environ 210 comptes, et le catalogue NCT 01 n'est appliqué <b>que</b> par ce
/// chemin. Tant qu'il n'était appelé qu'à la construction du template et au premier appel HTTP,
/// un dossier provisionné en <c>Strategy=Migrate</c> naissait — et restait — sur le plan hérité.
/// Il doit donc être invoqué à la fin de <b>tout</b> provisionnement, quelle que soit la stratégie.
/// </para>
/// <para>
/// Idempotent : sur une base à jour, l'appel coûte deux <c>SELECT</c>. La chaîne de connexion est
/// passée explicitement, comme pour <see cref="ISectorDataTemplateApplier"/> : au provisionnement
/// elle n'est pas encore enregistrée en base master.
/// </para>
/// </remarks>
public interface ITenantRuntimeCatalogSeeder
{
    /// <param name="connectionString">Chaîne de connexion de la base tenant.</param>
    /// <param name="authorizeChartRemap">
    /// <c>false</c> (défaut) : le remap des numéros de compte est <b>différé</b> si le dossier
    /// contient déjà des écritures ou des bulletins — il réécrirait l'historique, y compris sur des
    /// périodes clôturées. <c>true</c> : bascule explicitement autorisée par un administrateur
    /// plateforme, sauvegarde faite.
    /// </param>
    Task<TenantRuntimeCatalogReport> EnsureAsync(
        string connectionString,
        bool authorizeChartRemap = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Compte rendu <b>en lecture seule</b> : n'écrit rien, sert au diagnostic et au
    /// <c>dryRun</c> de la bascule.
    /// </summary>
    Task<TenantRuntimeCatalogReport> InspectAsync(
        string connectionString,
        CancellationToken cancellationToken = default);
}
