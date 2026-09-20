using FactuTrust.Application.Common.Identity;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Identity;

/// <summary>
/// Résolveur fail-closed de l'identité impersonnée (plan Studio IA 4.2a). Même séquence que
/// <c>ChannelInboundOrchestrator</c> (utilisateur maître → rôles Identity → permissions effectives)
/// mais sans aucun repli : un rôle plateforme (l'un des cinq <see cref="PlatformRoles"/>), zéro ou
/// plusieurs rôles applicatifs reconnus ⇒ refus — jamais de rôle et de permissions issus de rôles
/// différents. Chaque appel relit la base maître : une désactivation est prise en compte à la
/// reprise suivante.
/// </summary>
internal sealed class ImpersonationSnapshotResolver : IImpersonationSnapshotResolver
{
    private readonly MasterDbContext _master;
    private readonly IEffectivePermissionService _effectivePermissions;
    private readonly ILogger<ImpersonationSnapshotResolver> _logger;

    public ImpersonationSnapshotResolver(
        MasterDbContext master,
        IEffectivePermissionService effectivePermissions,
        ILogger<ImpersonationSnapshotResolver> logger)
    {
        _master = master;
        _effectivePermissions = effectivePermissions;
        _logger = logger;
    }

    public async Task<ImpersonatedUserSnapshot?> ResolveAsync(Guid tenantId, Guid userId, string origin, CancellationToken ct)
    {
        // Les utilisateurs plateforme portent TenantId == Guid.Empty : refus explicite des ids vides.
        if (tenantId == Guid.Empty || userId == Guid.Empty)
            return Refuse("identifiants vides", userId, origin);

        var user = await _master.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.Id, u.Email, u.TenantId, u.IsActive })
            .FirstOrDefaultAsync(ct);

        if (user is null)
            return Refuse("utilisateur introuvable", userId, origin);
        if (!user.IsActive)
            return Refuse("utilisateur inactif", userId, origin);
        if (user.TenantId != tenantId)
            return Refuse("tenant différent", userId, origin);

        var roleNames = await (
                from userRole in _master.UserRoles
                join identityRole in _master.Roles on userRole.RoleId equals identityRole.Id
                where userRole.UserId == userId
                select identityRole.Name)
            .ToListAsync(ct);

        // Tout rôle plateforme connu suffit au refus, même accompagné d'un rôle applicatif.
        if (roleNames.Any(PlatformRoles.IsKnownRole))
            return Refuse("rôle plateforme", userId, origin);

        // Exactement un rôle applicatif reconnu : avec plusieurs, le rôle du cliché et les
        // permissions effectives pourraient provenir de rôles différents (sélection non ordonnée).
        var roles = new List<UserRole>();
        foreach (var name in roleNames)
        {
            if (Enum.TryParse<UserRole>(name, ignoreCase: false, out var parsed) && Enum.IsDefined(parsed) && !roles.Contains(parsed))
                roles.Add(parsed);
        }

        if (roles.Count != 1)
            return Refuse(roles.Count == 0 ? "aucun rôle applicatif reconnu" : "rôle applicatif ambigu", userId, origin);

        var access = await _effectivePermissions.GetUserAccessSnapshotAsync(userId, ct);
        return new ImpersonatedUserSnapshot(user.Id, user.TenantId, user.Email, roles[0], access.EffectivePermissions, origin);
    }

    private ImpersonatedUserSnapshot? Refuse(string reason, Guid userId, string origin)
    {
        // Identifiants seulement : jamais d'e-mail ni de nom dans les journaux.
        _logger.LogWarning("Impersonation refusée ({Reason}) pour l'utilisateur {UserId}, origine {Origin}", reason, userId, origin);
        return null;
    }
}
