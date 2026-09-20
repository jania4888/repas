using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

public sealed class PlatformProvisionTenantResultDto
{
    public Guid TenantId { get; init; }

    public TenantKind TenantKind { get; init; }

    public string DisplayName { get; init; } = "";

    public TenantProvisioningStatus ProvisioningStatus { get; init; }

    public Guid ManagerUserId { get; init; }

    public string ManagerEmail { get; init; } = "";

    public IReadOnlyList<RegistrationWarningDto> RegistrationWarnings { get; init; } = Array.Empty<RegistrationWarningDto>();

    public string CorrelationId { get; init; } = "";
}

/// <summary>
/// Résultat d'une reprise de provisionnement
/// (<c>POST /api/platform/tenants/{tenantId}/provisioning/retry</c>).
/// </summary>
public sealed record TenantProvisioningRetryResultDto
{
    public Guid TenantId { get; init; }
    public string DisplayName { get; init; } = string.Empty;
    public string CorrelationId { get; init; } = string.Empty;

    /// <summary>
    /// Vrai si la base était en réalité déjà provisionnée et que seul le statut a été rectifié :
    /// rien n'a été supprimé ni recréé.
    /// </summary>
    public bool Repaired { get; init; }
}
