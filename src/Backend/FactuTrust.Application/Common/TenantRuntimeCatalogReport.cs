namespace FactuTrust.Application.Common;

/// <summary>
/// Issue de la mise en conformité du plan comptable d'un dossier (remap PCG hybride → NCT 01 puis
/// UPSERT du catalogue).
/// </summary>
public enum ChartCatalogOutcome
{
    /// <summary>Base sans table <c>ChartOfAccounts</c> (migrations non appliquées) : rien à faire.</summary>
    Skipped = 0,

    /// <summary>Remap déjà posé et catalogue déjà à l'empreinte courante.</summary>
    AlreadyApplied = 1,

    /// <summary>Remap des numéros + UPSERT du catalogue appliqués à l'instant.</summary>
    Applied = 2,

    /// <summary>
    /// Remap déjà posé, mais le catalogue embarqué a changé d'empreinte : seuls les libellés,
    /// rattachements et comptes manquants ont été synchronisés — aucun numéro réécrit.
    /// </summary>
    CatalogResynced = 3,

    /// <summary>
    /// Constat de lecture seule : le remap n'a jamais été posé, et rien ne s'oppose à la bascule
    /// (dossier sans écriture). <see cref="ChartCatalogOutcome.Applied"/> le remplacera dès qu'elle
    /// aura lieu.
    /// </summary>
    NotApplied = 5,

    /// <summary>
    /// Le remap n'a jamais été posé et le dossier contient déjà des écritures (ou des bulletins) :
    /// en mode automatique le service ne touche à rien. La bascule doit être déclenchée par un
    /// administrateur plateforme, après sauvegarde (cf. <c>docs/runbooks/coa-nct01-migration.md</c>).
    /// </summary>
    DeferredHasAccountingData = 4
}

/// <summary>
/// Différentiel attendu d'une bascule, calculé <b>sans rien écrire</b> (mode <c>dryRun</c>).
/// </summary>
public sealed record ChartMigrationPreview
{
    /// <summary>Comptes du catalogue absents du plan du dossier.</summary>
    public required int AccountsToCreate { get; init; }

    /// <summary>Comptes présents dont le libellé diffère de celui du catalogue.</summary>
    public required int AccountsToRelabel { get; init; }

    /// <summary>Comptes dont le numéro est réécrit par la table de remap.</summary>
    public required int AccountsToRenumber { get; init; }

    /// <summary>Comptes dont le numéro cible est déjà pris : les lignes sources sont fusionnées.</summary>
    public required int AccountsToMerge { get; init; }

    /// <summary>Comptes hérités désactivés par la table de remap (jamais supprimés s'ils sont mouvementés).</summary>
    public required int AccountsToDeactivate { get; init; }

    /// <summary>Lignes d'écriture dont le numéro de compte sera réécrit.</summary>
    public required int JournalLinesToRewrite { get; init; }

    /// <summary>Échantillon lisible « ancien → nouveau » (20 au plus), pour relecture avant bascule.</summary>
    public required IReadOnlyList<string> SampleRenumbering { get; init; }
}

/// <summary>
/// État du plan comptable d'un dossier après (ou sans) intervention. Sert à la fois de compte rendu
/// au provisionnement et de diagnostic en lecture seule côté plateforme.
/// </summary>
public sealed record TenantRuntimeCatalogReport
{
    public required ChartCatalogOutcome ChartOutcome { get; init; }

    /// <summary>La base porte-t-elle une table <c>ChartOfAccounts</c> ?</summary>
    public required bool HasChart { get; init; }

    /// <summary>Nombre de comptes du plan après l'opération (ou constaté, en lecture seule).</summary>
    public required int AccountCount { get; init; }

    /// <summary>Lignes d'écriture présentes : c'est ce qui rend le remap sensible.</summary>
    public required int AccountingLineCount { get; init; }

    /// <summary>Version de remap estampillée sur la base, <c>null</c> si jamais appliquée.</summary>
    public string? AppliedMapVersion { get; init; }

    /// <summary>
    /// La pose du catalogue de rubriques de la déclaration mensuelle a échoué sur ce dossier.
    /// </summary>
    /// <remarks>
    /// Le dossier reste utilisable — il garde sa configuration antérieure — mais l'enregistrement
    /// d'une déclaration y est refusé jusqu'à ce que la pose aboutisse. L'appelant écourte donc la
    /// mise en cache de son amorçage, pour que le nouvel essai soit rapide.
    /// </remarks>
    public bool MonthlyDeclarationCatalogFailed { get; init; }

    /// <summary>Empreinte du catalogue estampillée sur la base, <c>null</c> si inconnue.</summary>
    public string? AppliedCatalogHash { get; init; }

    /// <summary>Empreinte du catalogue embarqué dans cette version de l'API.</summary>
    public required string CurrentCatalogHash { get; init; }

    /// <summary>Différentiel attendu — renseigné uniquement par l'inspection en lecture seule.</summary>
    public ChartMigrationPreview? Preview { get; init; }

    /// <summary>
    /// Verdict lisible pour l'exploitation, déduit des <b>faits</b> (estampilles et volumétrie) et
    /// non de l'action tentée : <c>no-chart</c>, <c>deferred</c>, <c>legacy</c>,
    /// <c>catalog-drift</c> ou <c>nct01</c>.
    /// </summary>
    public string Verdict =>
        !HasChart ? "no-chart"
        : ChartOutcome == ChartCatalogOutcome.DeferredHasAccountingData ? "deferred"
        : AppliedMapVersion is null ? "legacy"
        : !string.Equals(AppliedCatalogHash, CurrentCatalogHash, StringComparison.Ordinal) ? "catalog-drift"
        : "nct01";
}
