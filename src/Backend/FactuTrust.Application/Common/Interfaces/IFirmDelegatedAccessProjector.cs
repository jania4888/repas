using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces;

/// <summary>Projection d'une session déléguée : ce que le dossier client ouvre réellement au collaborateur.</summary>
public sealed record FirmDelegatedAccessProjection(
    bool IsFirmManaged,
    string? ContextCompanyName,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<int> ModuleIds);

/// <summary>
/// Calcule droits et modules d'un collaborateur cabinet positionné sur un dossier client.
/// Partagé par l'émission du JWT et par <c>GET /api/auth/me</c>, pour que les deux ne puissent pas diverger.
/// </summary>
public interface IFirmDelegatedAccessProjector
{
    Task<FirmDelegatedAccessProjection> ProjectAsync(
        UserRole role,
        Guid firmTenantId,
        Guid contextTenantId,
        CancellationToken cancellationToken = default);
}
