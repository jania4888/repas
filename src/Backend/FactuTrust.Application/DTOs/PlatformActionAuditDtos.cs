namespace FactuTrust.Application.DTOs;

/// <summary>Une ligne du journal d'audit des actions d'administration plateforme.</summary>
public sealed record PlatformActionAuditItemDto
{
    public Guid Id { get; init; }
    public Guid ActorUserId { get; init; }
    public string? ActorEmail { get; init; }
    public string Action { get; init; } = null!;
    public string Outcome { get; init; } = null!;
    public Guid? TargetTenantId { get; init; }
    public DateTime CreatedAtUtc { get; init; }
    public string? CorrelationId { get; init; }

    /// <summary>Contexte JSON brut (secteur, domaine, modules, forfait, motif d'échec).</summary>
    public string DetailsJson { get; init; } = null!;
}

public sealed record PlatformActionAuditPageDto
{
    public IReadOnlyList<PlatformActionAuditItemDto> Items { get; init; } = Array.Empty<PlatformActionAuditItemDto>();
    public int TotalCount { get; init; }
}
