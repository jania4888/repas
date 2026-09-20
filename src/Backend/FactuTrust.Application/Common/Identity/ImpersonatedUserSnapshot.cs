using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Identity;

/// <summary>
/// Instantané d'identité d'un utilisateur « impersonné » par un traitement sans HTTP ni canal
/// (segment de workflow Studio rejoué par un job Hangfire, par exemple). Les permissions sont les
/// permissions EFFECTIVES (rôle ∩ droits de modules, via <c>IEffectivePermissionService</c>) —
/// mêmes droits que le JWT web de l'utilisateur au moment de la résolution.
/// </summary>
/// <param name="UserId">Identifiant de l'utilisateur impersonné.</param>
/// <param name="TenantId">Tenant de l'utilisateur (toujours égal au tenant demandé au résolveur).</param>
/// <param name="Email">Adresse e-mail (peut être <c>null</c>) — ne jamais la journaliser.</param>
/// <param name="Role">Rôle applicatif ; jamais un rôle plateforme.</param>
/// <param name="Permissions">Permissions effectives.</param>
/// <param name="Origin">
/// Origine du traitement, à des fins d'audit et de journalisation ; forme documentée
/// <c>"studio-workflow:{instanceId:N}"</c>.
/// </param>
public sealed record ImpersonatedUserSnapshot(
    Guid UserId,
    Guid TenantId,
    string? Email,
    UserRole Role,
    IReadOnlySet<string> Permissions,
    string Origin);
