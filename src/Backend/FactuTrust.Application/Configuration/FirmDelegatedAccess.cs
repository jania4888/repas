using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Configuration;

/// <summary>
/// Accès délégué cabinet (modules + permissions d'un collaborateur positionné sur un dossier client).
///
/// Source UNIQUE : l'émission du JWT (<c>TenantAuthTokenService</c>) et <c>GET /api/auth/me</c> doivent
/// décrire exactement la même session. Quand les deux calculaient séparément, <c>/auth/me</c> renvoyait
/// la projection NATIVE du cabinet et faisait croire au front qu'il était sorti du dossier.
/// </summary>
public static class FirmDelegatedAccess
{
    public static IReadOnlyList<int> BuildFirmManagedDelegatedModuleIds() =>
        new[]
        {
            (int)AppModule.Accounting,
            (int)AppModule.Fiscal,
            (int)AppModule.Reports,
            (int)AppModule.Payroll,
            (int)AppModule.AI
        };

    public static IReadOnlyList<int> BuildPlatformClientDelegatedModuleIds() =>
        new[]
        {
            (int)AppModule.Accounting,
            (int)AppModule.Fiscal,
            (int)AppModule.Sales,
            (int)AppModule.Treasury,
            (int)AppModule.Reports,
            (int)AppModule.Purchases,
            (int)AppModule.Payroll,
            (int)AppModule.AI
        };

    public static IReadOnlyList<int> BuildDelegatedModuleIds(bool isFirmManaged) =>
        isFirmManaged
            ? BuildFirmManagedDelegatedModuleIds()
            : BuildPlatformClientDelegatedModuleIds();

    public static IReadOnlyList<string> BuildDelegatedPermissions(UserRole role) =>
        DelegatedPermissionCatalog.GetDelegatedPermissions(role).ToList();

    /// <summary>Drapeau IA comptable éteint : ni la permission ni le module n'entrent dans la session.</summary>
    public static (IReadOnlyList<string> Permissions, IReadOnlyList<int> ModuleIds) ApplyAiAccountingFlag(
        IReadOnlyList<string> permissions,
        IReadOnlyList<int> moduleIds,
        bool aiAccountingEnabled)
    {
        if (aiAccountingEnabled)
            return (permissions, moduleIds);

        return (
            permissions.Where(p => !string.Equals(p, Permissions.AI.Chat, StringComparison.Ordinal)).ToList(),
            moduleIds.Where(id => id != (int)AppModule.AI).ToList());
    }
}
