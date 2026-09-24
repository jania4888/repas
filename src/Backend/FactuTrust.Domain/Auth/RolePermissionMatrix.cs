using System.Collections.Generic;

namespace FactuTrust.Domain.Auth;

/// <summary>
/// Lot B1 — Mapping statique rôle plateforme → ensemble de permissions accordées.
///
/// Source de vérité unique pour <see cref="PlatformAuthController.GeneratePlatformTokensAsync"/>
/// (qui sérialise ces permissions en claims JWT) et pour <see cref="RequirePlatformPermissionAttribute"/>
/// (qui vérifie qu'un appel API passe la barrière permission).
///
/// <b>Évolutivité</b> : pour rendre la matrice configurable en BDD, garder cette classe comme
/// fallback et ajouter un <c>IRolePermissionMatrixService</c> qui surcharge en runtime.
/// </summary>
public static class RolePermissionMatrix
{
    /// <summary>Permissions pour le rôle SuperAdmin / PlatformAdmin → tout.</summary>
    private static readonly IReadOnlySet<string> PlatformAdminPermissions =
        new HashSet<string>(PlatformPermissions.All);

    /// <summary>Permissions pour le rôle BillingAdmin.</summary>
    private static readonly IReadOnlySet<string> BillingAdminPermissions = new HashSet<string>
    {
        PlatformPermissions.TenantsRead,
        PlatformPermissions.SubscriptionChangePlan,
        PlatformPermissions.SubscriptionCancel,
        PlatformPermissions.PlansManage,
        PlatformPermissions.CouponsManage,
        PlatformPermissions.CreditsManage,
        PlatformPermissions.InvoiceRead,
        PlatformPermissions.InvoiceIssue,
        PlatformPermissions.InvoiceCancel,
        PlatformPermissions.ProvidersConfigure,
        PlatformPermissions.AuditRead,
        PlatformPermissions.NotificationsRead
    };

    /// <summary>Permissions pour le rôle SupportAgent (lecture + actions support).</summary>
    private static readonly IReadOnlySet<string> SupportAgentPermissions = new HashSet<string>
    {
        PlatformPermissions.TenantsRead,
        PlatformPermissions.SubscriptionChangePlan,
        PlatformPermissions.StorefrontRead,
        PlatformPermissions.StorefrontApprove,
        PlatformPermissions.StorefrontReject,
        PlatformPermissions.StorefrontSuspend,
        PlatformPermissions.AuditRead,
        PlatformPermissions.NotificationsRead,
        PlatformPermissions.CompanySupportRead,
        PlatformPermissions.CompanySupportWrite
    };

    /// <summary>Permissions pour le rôle MigrationOperator.</summary>
    private static readonly IReadOnlySet<string> MigrationOperatorPermissions = new HashSet<string>
    {
        PlatformPermissions.TenantsRead,
        PlatformPermissions.MigrationRead,
        PlatformPermissions.MigrationRun,
        PlatformPermissions.AuditRead,
        PlatformPermissions.NotificationsRead
    };

    /// <summary>Permissions pour le rôle ReadOnlyAuditor (lecture seule étendue).</summary>
    private static readonly IReadOnlySet<string> ReadOnlyAuditorPermissions = new HashSet<string>
    {
        PlatformPermissions.TenantsRead,
        PlatformPermissions.InvoiceRead,
        PlatformPermissions.MigrationRead,
        PlatformPermissions.StorefrontRead,
        PlatformPermissions.AuditRead,
        PlatformPermissions.SecurityRead,
        PlatformPermissions.AdminsRead,
        PlatformPermissions.NotificationsRead,
        PlatformPermissions.SectorRulesRead,
        PlatformPermissions.CompanySupportRead
    };

    /// <summary>
    /// Retourne l'ensemble des permissions pour un rôle plateforme donné.
    /// Retourne un set vide si le rôle est inconnu.
    /// </summary>
    public static IReadOnlySet<string> GetPermissionsFor(string roleName) => roleName switch
    {
        PlatformRoles.PlatformAdmin => PlatformAdminPermissions,
        PlatformRoles.BillingAdmin => BillingAdminPermissions,
        PlatformRoles.SupportAgent => SupportAgentPermissions,
        PlatformRoles.MigrationOperator => MigrationOperatorPermissions,
        PlatformRoles.ReadOnlyAuditor => ReadOnlyAuditorPermissions,
        _ => new HashSet<string>()
    };

    /// <summary>
    /// Calcule l'union des permissions pour une liste de rôles. Permet à un même
    /// utilisateur d'avoir plusieurs rôles (cas rare mais supporté par Identity).
    /// </summary>
    public static IReadOnlySet<string> ComputeEffectivePermissions(IEnumerable<string> roleNames)
    {
        var effective = new HashSet<string>();
        foreach (var role in roleNames)
        {
            foreach (var permission in GetPermissionsFor(role))
            {
                effective.Add(permission);
            }
        }
        return effective;
    }
}
