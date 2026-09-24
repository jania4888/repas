namespace FactuTrust.Domain.Auth;

/// <summary>
/// Lot B1 — Catalogue des permissions fines plateforme.
///
/// Format : <c>platform.&lt;category&gt;:&lt;action&gt;</c> (ex: <c>platform.tenants:suspend</c>).
/// Le préfixe <c>platform.</c> évite toute collision avec les permissions tenant
/// (<c>invoices:create</c>, <c>clients:read</c>, etc.) — toutes deux sont émises
/// dans le claim JWT <see cref="AuthClaimTypes.Permission"/>.
///
/// Réutilise l'infrastructure existante :
/// <list type="bullet">
///   <item><c>PermissionPolicyProvider</c> accepte tout policy nommée <c>perm:&lt;permission&gt;</c>.</item>
///   <item><c>PermissionAuthorizationHandler</c> vérifie le claim <c>perm</c>.</item>
/// </list>
/// Usage côté contrôleur : <c>[Authorize(Policy = PlatformPolicies.PolicyFor(PlatformPermissions.TenantsSuspend))]</c>.
/// </summary>
public static class PlatformPermissions
{
    private const string Prefix = "platform.";

    // ---------- Entreprises (tenants) ----------
    public const string TenantsRead = Prefix + "tenants:read";
    public const string TenantsWrite = Prefix + "tenants:write";
    public const string TenantsSuspend = Prefix + "tenants:suspend";
    public const string TenantsDelete = Prefix + "tenants:delete";

    // ---------- Abonnements ----------
    public const string SubscriptionChangePlan = Prefix + "subscription:change-plan";
    public const string SubscriptionCancel = Prefix + "subscription:cancel";

    // ---------- Plans & coupons (Lot C1/C3) ----------
    public const string PlansManage = Prefix + "plans:manage";
    public const string CouponsManage = Prefix + "coupons:manage";
    public const string CreditsManage = Prefix + "credits:manage";

    // ---------- Factures plateforme (Lot C4) ----------
    public const string InvoiceRead = Prefix + "invoice:read";
    public const string InvoiceIssue = Prefix + "invoice:issue";
    public const string InvoiceCancel = Prefix + "invoice:cancel";

    // ---------- Migrations ----------
    public const string MigrationRead = Prefix + "migration:read";
    public const string MigrationRun = Prefix + "migration:run";

    // ---------- Vitrines 3D ----------
    public const string StorefrontRead = Prefix + "storefront:read";
    public const string StorefrontApprove = Prefix + "storefront:approve";
    public const string StorefrontReject = Prefix + "storefront:reject";
    public const string StorefrontSuspend = Prefix + "storefront:suspend";

    // ---------- Audit & sécurité ----------
    public const string AuditRead = Prefix + "audit:read";
    public const string SecurityRead = Prefix + "security:read";

    // ---------- Administration des admins plateforme ----------
    public const string AdminsRead = Prefix + "admins:read";
    public const string AdminsManage = Prefix + "admins:manage";

    // ---------- Providers de paiement (Lot C5) ----------
    public const string ProvidersConfigure = Prefix + "providers:configure";

    // ---------- Notifications (Lot A5) ----------
    public const string NotificationsRead = Prefix + "notifications:read";

    // ---------- Configuration IA (modèle LLM global) ----------
    public const string AiManage = Prefix + "ai:manage";

    // ---------- Règles sectorielles (Phase 2, plan §WP-B5) ----------
    public const string SectorRulesRead = Prefix + "sector-rules:read";
    public const string SectorRulesManage = Prefix + "sector-rules:manage";
    public const string SectorRulesApply = Prefix + "sector-rules:apply";

    // Assistance société ↔ opérateurs plateforme
    public const string CompanySupportRead = Prefix + "company-support:read";
    public const string CompanySupportWrite = Prefix + "company-support:write";

    /// <summary>Toutes les permissions reconnues — utile pour assigner le rôle Super-Admin.</summary>
    public static readonly IReadOnlyList<string> All = new[]
    {
        TenantsRead, TenantsWrite, TenantsSuspend, TenantsDelete,
        SubscriptionChangePlan, SubscriptionCancel,
        PlansManage, CouponsManage, CreditsManage,
        InvoiceRead, InvoiceIssue, InvoiceCancel,
        MigrationRead, MigrationRun,
        StorefrontRead, StorefrontApprove, StorefrontReject, StorefrontSuspend,
        AuditRead, SecurityRead,
        AdminsRead, AdminsManage,
        ProvidersConfigure,
        NotificationsRead,
        AiManage,
        SectorRulesRead, SectorRulesManage, SectorRulesApply,
        CompanySupportRead, CompanySupportWrite
    };
}
