using FactuTrust.API.Services.Channels;
using FactuTrust.Application.Common.Identity;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Enums;

namespace FactuTrust.API.Services;

/// <summary>
/// Décorateur d'<see cref="ICurrentUser"/> à trois niveaux de priorité :
/// <list type="number">
///   <item><see cref="ImpersonatedUserContext"/> — segment de workflow Studio rejoué par un job Hangfire
///   sous l'identité de l'utilisateur lanceur (ni HTTP ni canal disponibles) ;</item>
///   <item><see cref="ChannelUserContext"/> — traitement de canal (WhatsApp) : le pipeline IA et ses
///   outils lisent l'identité impersonnée du canal ;</item>
///   <item><see cref="CurrentUser"/> HTTP historique — chemin web strictement inchangé : aucun des deux
///   AsyncLocal n'est posé hors traitement de canal ou de workflow.</item>
/// </list>
/// Sous un instantané (impersonation ou canal), les notions purement HTTP (portail client, contexte
/// délégué cabinet, IP, User-Agent) sont neutralisées : elles ne doivent jamais « fuir » du contexte
/// web appelant vers le traitement impersonné.
/// </summary>
public sealed class ChannelAwareCurrentUser : ICurrentUser
{
    private readonly CurrentUser _inner;

    public ChannelAwareCurrentUser(CurrentUser inner)
    {
        _inner = inner;
    }

    private static ImpersonatedUserSnapshot? Impersonated => ImpersonatedUserContext.Current;

    private static ChannelUserSnapshot? ChannelSnapshot => ChannelUserContext.Current;

    private static bool HasSnapshot => Impersonated is not null || ChannelSnapshot is not null;

    public Guid? UserId => Impersonated is { } i ? i.UserId : ChannelSnapshot is { } s ? s.UserId : _inner.UserId;

    public string? Email => Impersonated is { } i ? i.Email : ChannelSnapshot is { } s ? s.Email : _inner.Email;

    public Guid? TenantId => Impersonated is { } i ? i.TenantId : ChannelSnapshot is { } s ? s.TenantId : _inner.TenantId;

    public UserRole? Role => Impersonated is { } i ? i.Role : ChannelSnapshot is { } s ? s.Role : _inner.Role;

    public bool IsAuthenticated => HasSnapshot || _inner.IsAuthenticated;

    public bool IsAccountingFirmDelegatedContext =>
        !HasSnapshot && _inner.IsAccountingFirmDelegatedContext;

    public Guid? PortalClientId => HasSnapshot ? null : _inner.PortalClientId;

    public bool IsClientPortal => !HasSnapshot && _inner.IsClientPortal;

    /// <summary>
    /// Le premier instantané présent tranche seul : sous impersonation, on ne retombe jamais sur le canal
    /// ni sur les claims HTTP.
    /// </summary>
    public bool HasPermission(string permission) =>
        Impersonated is { } i ? i.Permissions.Contains(permission)
        : ChannelSnapshot is { } s ? s.Permissions.Contains(permission)
        : _inner.HasPermission(permission);

    public string? IpAddress => HasSnapshot ? null : _inner.IpAddress;

    public string? UserAgent => HasSnapshot ? null : _inner.UserAgent;
}
