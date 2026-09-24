using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces;

public interface IFirmAssignmentService
{
    Task<Result<AccountingFirmDirectoryPageDto>> SearchDirectoryAsync(AccountingFirmDirectoryQuery query, Guid companyTenantId, CancellationToken cancellationToken = default);
    Task<FirmClientAssignmentDto?> GetCompanyCurrentAssignmentAsync(Guid companyTenantId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<FirmClientAssignmentDto>> GetCompanyAssignmentHistoryAsync(Guid companyTenantId, CancellationToken cancellationToken = default);
    Task<Result<FirmClientAssignmentDto>> RequestAssignmentAsync(Guid companyTenantId, Guid requestedByUserId, RequestFirmAssignmentDto dto, CancellationToken cancellationToken = default);
    Task<Result> RevokeByCompanyAsync(Guid companyTenantId, Guid revokedByUserId, CancellationToken cancellationToken = default);
    Task<Result> CancelPendingByCompanyAsync(Guid companyTenantId, Guid cancelledByUserId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<FirmClientAssignmentDto>> GetIncomingInvitationsAsync(Guid firmTenantId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<FirmClientDossierDto>> GetActiveClientsAsync(Guid firmTenantId, CancellationToken cancellationToken = default);
    Task<Result> AcceptAssignmentAsync(Guid firmTenantId, Guid assignmentId, Guid respondedByUserId, CancellationToken cancellationToken = default);
    Task<Result> RejectAssignmentAsync(Guid firmTenantId, Guid assignmentId, Guid respondedByUserId, string? reason = null, CancellationToken cancellationToken = default);
    Task<Result> RevokeByFirmAsync(Guid firmTenantId, Guid assignmentId, Guid revokedByUserId, CancellationToken cancellationToken = default);
    Task<bool> HasActiveAssignmentAsync(Guid firmTenantId, Guid companyTenantId, CancellationToken cancellationToken = default);
    Task<AccountingFirmProfileDto?> GetFirmProfileAsync(Guid firmTenantId, CancellationToken cancellationToken = default);
    Task<Result> UpdateFirmProfileAsync(Guid firmTenantId, UpdateAccountingFirmProfileDto dto, CancellationToken cancellationToken = default);
}

public interface IFirmDashboardService
{
    Task<FirmDashboardDto> GetDashboardAsync(Guid firmTenantId, CancellationToken cancellationToken = default);
}

public interface IFirmContextService
{
    Task<AuthResponseDto> SwitchToClientAsync(Guid userId, Guid homeTenantId, Guid clientTenantId, CancellationToken cancellationToken = default);
    Task<AuthResponseDto> ClearContextAsync(Guid userId, Guid homeTenantId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Rétablit le contexte dossier d'une session déléguée lors d'un rafraîchissement de jeton.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Mêmes contrôles que <see cref="SwitchToClientAsync"/> — cabinet, affectation active, portée du
    /// collaborateur, dossier actif — mais <b>sans exception</b> : le refresh ne doit pas échouer
    /// parce qu'une affectation a été révoquée entre-temps. Renvoie <c>null</c> dans ce cas, et
    /// l'appelant émet alors un jeton natif qui ramène l'utilisateur au cabinet.
    /// </para>
    /// <para>
    /// Le rôle est relu en base : l'endpoint de refresh est anonyme, le principal HTTP courant est
    /// expiré ou absent, et se replier sur <c>FirmAccountant</c> ferait perdre son dossier à un
    /// responsable toutes les 15 minutes.
    /// </para>
    /// </remarks>
    Task<AuthResponseDto?> TryRestoreDelegatedContextAsync(
        Guid userId, Guid homeTenantId, Guid clientTenantId, CancellationToken cancellationToken = default);
    Task<FirmContextDto> GetCurrentContextAsync(System.Security.Claims.ClaimsPrincipal principal, CancellationToken cancellationToken = default);
}

public interface IAccountingFirmsFeature
{
    bool IsEnabled { get; }
}

public interface ITenantAuthTokenService
{
    Task<AuthResponseDto> GenerateTokensAsync(
        Guid userId,
        Guid homeTenantId,
        Guid? contextTenantId = null,
        string? contextCompanyName = null,
        CancellationToken cancellationToken = default);
}
