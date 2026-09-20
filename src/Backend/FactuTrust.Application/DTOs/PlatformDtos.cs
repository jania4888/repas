using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>Tenant row for platform operator list.</summary>
public sealed record PlatformTenantListItemDto
{
    public Guid TenantId { get; init; }
    public string CompanyName { get; init; } = null!;
    public string CompanyEmail { get; init; } = null!;
    public string TaxRegimeDisplay { get; init; } = null!;
    public bool IsActive { get; init; }
    public string DatabaseName { get; init; } = null!;
    public SubscriptionPlan? SubscriptionPlan { get; init; }
    public string? SubscriptionPlanDisplay { get; init; }
    public SubscriptionStatus? SubscriptionStatus { get; init; }
    public string? SubscriptionStatusDisplay { get; init; }
    public DateTime? SubscriptionEndDate { get; init; }
    public bool IsPayingSubscriber { get; init; }

    // ----- Lot A2 additions (optionnels, rétro-compatibles) -----------------
    /// <summary>NIF / matricule fiscal de l'entreprise (affichage en mono dans la table).</summary>
    public string? Nif { get; init; }
    /// <summary>Date de création du tenant (pour tri "Inscription" et chips).</summary>
    public DateTime? CreatedAt { get; init; }
    /// <summary>
    /// Dernière activité : <c>UpdatedAt ?? CreatedAt</c> côté tenant pour l'instant
    /// (proxy honnête tant qu'aucun tracking d'activité réel n'est en place — Lot D).
    /// </summary>
    public DateTime? LastActivityAt { get; init; }
    /// <summary>
    /// MRR (Monthly Recurring Revenue) estimé en TND pour cette ligne :
    ///  - Monthly Active/Trial → <c>MonthlyPrice.Amount</c> (ou 49 TND par défaut)
    ///  - Annual Active/Trial → <c>AnnualPrice.Amount / 12</c> (ou 39 TND par défaut)
    ///  - Sinon → null
    /// </summary>
    public decimal? MrrTnd { get; init; }

    /// <summary>
    /// Statut de provisionnement de la base du tenant. Additif et par défaut
    /// <see cref="TenantProvisioningStatus.Ready"/> (= 0), donc les tenants antérieurs au saga en
    /// deux temps se lisent « Prêt », ce qui est correct. Un tenant <c>Pending</c> ou
    /// <c>Failed</c> existe en base maître mais n'a pas de base exploitable : son utilisateur ne
    /// peut pas se connecter.
    /// </summary>
    public TenantProvisioningStatus ProvisioningStatus { get; init; }

    // ----- Phase 2 additions (plan §WP-B8, D8) — nullable + additive -----------------
    /// <summary>Tenant sector classification (null for legacy/firm tenants).</summary>
    public string? CompanySegment { get; init; }
    /// <summary>Tenant business domain (null for legacy/firm tenants).</summary>
    public string? BusinessDomain { get; init; }
}

/// <summary>Paged tenant list for platform operators.</summary>
public sealed record PlatformTenantListPageDto
{
    public IReadOnlyList<PlatformTenantListItemDto> Items { get; init; } = Array.Empty<PlatformTenantListItemDto>();
    public int TotalCount { get; init; }
}

/// <summary>Global tenant / subscription counts for platform dashboard KPIs.</summary>
public sealed record PlatformTenantStatsDto
{
    public int TotalTenants { get; init; }
    public int PayingSubscribers { get; init; }
    public int NonPayingSubscribers { get; init; }

    // ----- Lot A2 additions (optionnels, rétro-compatibles) -----------------
    /// <summary>Variation du nombre total d'entreprises sur les 30 derniers jours (en valeur absolue).</summary>
    public int? TotalDelta30d { get; init; }
    /// <summary>MRR estimé du parc, en TND, calculé via PlatformSubscriptionMetricsHelper.</summary>
    public decimal? MrrEstimateTnd { get; init; }
    /// <summary>
    /// Taux de conversion essai → payant sur les 30 derniers jours, exprimé en fraction (0..1).
    /// Formule : <c>convertedTrials30d / endedTrials30d</c>. Null si dénominateur = 0.
    /// </summary>
    public decimal? TrialConversionRate30d { get; init; }
    /// <summary>Variation du taux de conversion vs les 30 jours précédents (différence absolue de fraction).</summary>
    public decimal? TrialConversionDelta30d { get; init; }
    /// <summary>Nombre d'entreprises en risque (PastDue + Suspended).</summary>
    public int? RiskCount { get; init; }
    /// <summary>Série temporelle des nouveaux signups, 30 valeurs (J-29 à J-0).</summary>
    public IReadOnlyList<int>? NewSignupsTimeseries30d { get; init; }
}

/// <summary>Filters and pagination for <see cref="IPlatformTenantQueryService.ListAsync"/>.</summary>
public sealed record PlatformTenantListQuery
{
    public string? Search { get; init; }
    /// <summary>paying, non_paying, or all (default).</summary>
    public string? Segment { get; init; }
    public SubscriptionPlan? Plan { get; init; }
    public SubscriptionStatus? SubscriptionStatus { get; init; }
    public bool? IsActive { get; init; }
    public TaxRegime? TaxRegime { get; init; }
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 50;

    // ----- Lot A2 additions (optionnels, rétro-compatibles) -----------------
    /// <summary>
    /// Champ de tri serveur. Valeurs reconnues :
    ///   <c>name</c> (par défaut, alphabétique sur CompanyName) · <c>createdAt</c> ·
    ///   <c>lastActivity</c> · <c>plan</c> · <c>status</c> · <c>endDate</c> · <c>mrr</c>.
    /// Toute autre valeur retombe sur le tri par nom.
    /// </summary>
    public string? SortBy { get; init; }
    /// <summary>Direction du tri : <c>asc</c> (défaut) ou <c>desc</c>.</summary>
    public string? SortDir { get; init; }
}

/// <summary>Tenant detail for platform operators.</summary>
public sealed record PlatformTenantDetailDto
{
    public Guid TenantId { get; init; }
    public string CompanyName { get; init; } = null!;
    public string CompanyEmail { get; init; } = null!;
    public string Nif { get; init; } = null!;
    public string Phone { get; init; } = null!;
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public string? Website { get; init; }
    public string TaxRegimeDisplay { get; init; } = null!;
    public bool IsActive { get; init; }
    public DateTime? DeactivatedAt { get; init; }
    public string DatabaseName { get; init; } = null!;
    public SubscriptionPlan? SubscriptionPlan { get; init; }
    public string? SubscriptionPlanDisplay { get; init; }
    public SubscriptionStatus? SubscriptionStatus { get; init; }
    public string? SubscriptionStatusDisplay { get; init; }
    public DateTime? SubscriptionEndDate { get; init; }
    public bool IsPayingSubscriber { get; init; }

    /// <summary>Filled by the API layer after checking tenant database migrations.</summary>
    public bool HasMigrationsApplied { get; init; }

    /// <summary>
    /// Statut de provisionnement de la base du tenant. Additif et par défaut
    /// <see cref="TenantProvisioningStatus.Ready"/> (= 0), donc les tenants antérieurs au saga en
    /// deux temps se lisent « Prêt », ce qui est correct. Un tenant <c>Pending</c> ou
    /// <c>Failed</c> existe en base maître mais n'a pas de base exploitable : son utilisateur ne
    /// peut pas se connecter.
    /// </summary>
    public TenantProvisioningStatus ProvisioningStatus { get; init; }

    // ----- Phase 2 additions (plan §WP-B8, D8) — nullable + additive -----------------
    /// <summary>Tenant sector classification (null for legacy/firm tenants).</summary>
    public string? CompanySegment { get; init; }
    /// <summary>Tenant business domain (null for legacy/firm tenants).</summary>
    public string? BusinessDomain { get; init; }
}

/// <summary>Result of a bulk tenant migration operation.</summary>
public sealed record MigrationResultDto
{
    public int TotalTenants { get; init; }
    public int SuccessCount { get; init; }
    public int FailureCount { get; init; }
}

/// <summary>
/// Aggregated KPIs for the platform Migrations page (Lot A3).
/// "Failures24h" reste à 0 tant que le tracking persistant des exécutions
/// n'est pas en place (Lot D4 : MigrationRuns + MigrationRunItems).
/// </summary>
public sealed record MigrationStatsDto
{
    /// <summary>Nombre total de tenants actifs.</summary>
    public int TotalTenants { get; init; }
    /// <summary>Tenants à jour (toutes les migrations EF appliquées).</summary>
    public int UpToDate { get; init; }
    /// <summary>Tenants en retard (au moins une migration manquante).</summary>
    public int Pending { get; init; }
    /// <summary>Échecs survenus dans les dernières 24h. Toujours 0 tant que le tracking persistant n'existe pas.</summary>
    public int Failures24h { get; init; }
}

/// <summary>
/// Aggregated KPIs for the platform Vitrines 3D page (Lot A4).
/// "Refusées" = vitrines en statut Draft avec RejectionReason non null.
/// </summary>
public sealed record StorefrontStatsDto
{
    /// <summary>Vitrines en attente de validation (PendingReview).</summary>
    public int Pending { get; init; }
    /// <summary>Vitrines publiées sur Rue FactuTrust (Published).</summary>
    public int Published { get; init; }
    /// <summary>Vitrines refusées (Draft + RejectionReason renseigné).</summary>
    public int Rejected { get; init; }
    /// <summary>Vitrines suspendues (Suspended).</summary>
    public int Suspended { get; init; }
}

/// <summary>Migration status for one tenant database.</summary>
public sealed record MigrationStatusResultDto
{
    public Guid TenantId { get; init; }
    public string TenantName { get; init; } = null!;
    public bool HasMigrationsApplied { get; init; }
    public SubscriptionPlan? SubscriptionPlan { get; init; }
    public string? SubscriptionPlanDisplay { get; init; }
    public SubscriptionStatus? SubscriptionStatus { get; init; }
    public string? SubscriptionStatusDisplay { get; init; }
    public bool IsPayingSubscriber { get; init; }
}

// ---------------------------------------------------------------------------
// Balayage d'unicité des numéros de facture de vente (exigence fiscale).
// Préalable OBLIGATOIRE à toute migration ajoutant un index UNIQUE sur
// Invoices.Number : une migration unique qui échoue bloquerait le tenant
// au boot via TenantMigrationGuard.
// ---------------------------------------------------------------------------

/// <summary>Une facture impliquée dans un doublon de numéro.</summary>
public sealed record DuplicateInvoiceDto
{
    public Guid InvoiceId { get; init; }
    public InvoiceStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public DateTime IssueDate { get; init; }
    public DateTime CreatedAt { get; init; }
    public decimal TotalAmount { get; init; }
}

/// <summary>Un numéro de facture porté par plusieurs factures dans une même base tenant.</summary>
public sealed record DuplicateInvoiceNumberDto
{
    public string Number { get; init; } = null!;
    public IReadOnlyList<DuplicateInvoiceDto> Invoices { get; init; } = Array.Empty<DuplicateInvoiceDto>();
}

/// <summary>Résultat du balayage d'unicité pour un tenant.</summary>
public sealed record TenantInvoiceNumberIntegrityDto
{
    public const string StatusClean = "Clean";
    public const string StatusDuplicatesFound = "DuplicatesFound";
    public const string StatusUnreachable = "Unreachable";

    public Guid TenantId { get; init; }
    public string TenantName { get; init; } = null!;
    /// <summary>Clean | DuplicatesFound | Unreachable.</summary>
    public string Status { get; init; } = null!;
    public int InvoiceCount { get; init; }
    /// <summary>Vrai si un index UNIQUE dont la première colonne est Number existe déjà sur Invoices.</summary>
    public bool HasUniqueIndex { get; init; }
    public IReadOnlyList<DuplicateInvoiceNumberDto> Duplicates { get; init; } = Array.Empty<DuplicateInvoiceNumberDto>();
    public string? Error { get; init; }
}

/// <summary>Rapport consolidé du balayage d'unicité des numéros de facture (tous tenants actifs).</summary>
public sealed record InvoiceNumberIntegrityReportDto
{
    public DateTime ScannedAtUtc { get; init; }
    public int TotalTenants { get; init; }
    public int CleanTenants { get; init; }
    public int TenantsWithDuplicates { get; init; }
    public int UnreachableTenants { get; init; }
    public int TotalDuplicateNumbers { get; init; }
    /// <summary>
    /// Fail-closed : vrai UNIQUEMENT si tous les tenants ont été joints ET qu'aucun doublon
    /// n'a été trouvé. Un tenant injoignable suffit à rendre l'index unique non sûr.
    /// </summary>
    public bool IsUniqueIndexSafe { get; init; }
    public IReadOnlyList<TenantInvoiceNumberIntegrityDto> Tenants { get; init; } = Array.Empty<TenantInvoiceNumberIntegrityDto>();
}
