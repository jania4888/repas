namespace FactuTrust.Application.Common.Interfaces;

/// <summary>Contexte d'une action d'administration plateforme à consigner.</summary>
public sealed record PlatformActionAuditRecord(
    Guid ActorUserId,
    string? ActorEmail,
    string Action,
    string Outcome,
    Guid? TargetTenantId,
    string? CorrelationId,
    IReadOnlyDictionary<string, object?>? Details = null);

/// <summary>
/// Écrit une ligne d'audit plateforme en base maître.
///
/// <para>
/// Toujours appelé <b>hors</b> de la transaction d'inscription et de manière non bloquante : un
/// échec d'audit ne doit jamais faire échouer une création réussie (il est journalisé). Les échecs
/// d'action sont eux aussi consignés — c'est ce qu'on recherche lors d'un incident.
/// </para>
///
/// <para>
/// Ne pas utiliser <c>IAuditService</c> pour cela : il écrit dans la base <b>du tenant</b>, qui
/// n'existe pas encore au moment où la création est décidée.
/// </para>
/// </summary>
public interface IPlatformActionAuditWriter
{
    Task WriteAsync(PlatformActionAuditRecord record, CancellationToken cancellationToken = default);
}
