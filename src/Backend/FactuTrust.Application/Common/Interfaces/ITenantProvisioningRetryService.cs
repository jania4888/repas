namespace FactuTrust.Application.Common.Interfaces;

public enum TenantProvisioningRetryFailureKind
{
    /// <summary>Aucun tenant ne correspond à l'identifiant fourni.</summary>
    NotFound,

    /// <summary>Le tenant est déjà provisionné : rejouer la phase 2 détruirait une base vivante.</summary>
    AlreadyReady,

    /// <summary>La création de la base a de nouveau échoué.</summary>
    ProvisioningFailed
}

public sealed class TenantProvisioningRetryResult
{
    public bool Success { get; init; }
    public TenantProvisioningRetryFailureKind? FailureKind { get; init; }
    public string? ErrorMessage { get; init; }
    public string? CorrelationId { get; init; }
    public Guid TenantId { get; init; }
    public string? DisplayName { get; init; }

    /// <summary>
    /// Vrai lorsque la base existait déjà et que seul le statut a été rectifié : aucune base n'a
    /// été supprimée ni recréée. L'opérateur doit le savoir — le contenu du dossier est intact.
    /// </summary>
    public bool Repaired { get; init; }

    public static TenantProvisioningRetryResult Ok(
        Guid tenantId,
        string displayName,
        string correlationId,
        bool repaired = false) =>
        new()
        {
            Success = true,
            TenantId = tenantId,
            DisplayName = displayName,
            CorrelationId = correlationId,
            Repaired = repaired
        };

    public static TenantProvisioningRetryResult Failure(
        TenantProvisioningRetryFailureKind kind,
        string message,
        string? correlationId = null) =>
        new() { Success = false, FailureKind = kind, ErrorMessage = message, CorrelationId = correlationId };
}

/// <summary>
/// Reprise du provisionnement d'un tenant resté en <c>Pending</c> ou <c>Failed</c>.
///
/// <para>
/// L'inscription est un saga en deux temps : les lignes de la base maître sont validées
/// <b>avant</b> la création de la base physique du tenant. Si la phase 2 échoue, il reste une
/// entreprise et un utilisateur Identity en base, mais aucune base exploitable — l'utilisateur ne
/// pourra jamais se connecter et, jusqu'ici, aucun opérateur ne disposait d'une action de reprise.
/// </para>
///
/// <para>
/// Ce service <b>ne rejoue que la phase 2</b> : il ne rouvre jamais la transaction maître, ne
/// recrée pas l'utilisateur et ne réapplique pas les droits de modules. L'ordre du saga est donc
/// préservé.
/// </para>
/// </summary>
public interface ITenantProvisioningRetryService
{
    Task<TenantProvisioningRetryResult> RetryAsync(Guid tenantId, Guid actorUserId, CancellationToken cancellationToken = default);
}
