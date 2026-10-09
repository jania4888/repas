using System.Security.Claims;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Authorization;

/// <summary>
/// Guards accounting entry validation (journal, budget initial) to delegated firm context only.
/// </summary>
public static class AccountingValidationAccess
{
    public const string DeniedMessage =
        "Seul le cabinet comptable, en mode dossier client, peut valider les écritures comptables.";

    public static bool IsAccountingFirmDelegatedContext(ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true)
            return false;

        var tenantKind = TenantKindExtensions.FromClaimValue(
            user.FindFirst(AuthClaimTypes.TenantKind)?.Value);
        if (tenantKind != TenantKind.AccountingFirm)
            return false;

        var accessMode = user.FindFirst(AuthClaimTypes.AccessMode)?.Value;
        if (!string.Equals(accessMode, "delegated", StringComparison.OrdinalIgnoreCase))
            return false;

        var contextTenantId = user.FindFirst(AuthClaimTypes.ContextTenantId)?.Value;
        return Guid.TryParse(contextTenantId, out var id) && id != Guid.Empty;
    }

    /// <summary>
    /// Cabinet comptable chez lui (hors dossier client). Volontairement NON défini comme la négation
    /// de <see cref="IsAccountingFirmDelegatedContext"/> : un jeton délégué auquel manquerait le
    /// <c>context_tenant_id</c> passerait alors pour natif et rouvrirait l'espace cabinet.
    /// </summary>
    public static bool IsAccountingFirmNativeContext(ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true)
            return false;

        var tenantKind = TenantKindExtensions.FromClaimValue(
            user.FindFirst(AuthClaimTypes.TenantKind)?.Value);
        if (tenantKind != TenantKind.AccountingFirm)
            return false;

        var accessMode = user.FindFirst(AuthClaimTypes.AccessMode)?.Value;
        return !string.Equals(accessMode, "delegated", StringComparison.OrdinalIgnoreCase);
    }
}
