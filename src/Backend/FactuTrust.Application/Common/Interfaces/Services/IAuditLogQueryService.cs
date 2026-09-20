using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Common.Interfaces.Services;

public interface IAuditLogQueryService
{
    Task<Result<PagedResult<AuditLogEntryDto>>> GetLogsAsync(
        DateTime? from,
        DateTime? to,
        string? action,
        Guid? userId,
        string? entityType,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Historique paginé d'une entité précise (type + identifiant), le plus récent d'abord, en
    /// projection interne (sans IP, agent utilisateur ni hash). <paramref name="pageSize"/> est
    /// borné à 1..100 (défaut 20 si &lt;= 0).
    /// </summary>
    Task<Result<PagedResult<AuditEntityHistoryRowDto>>> GetEntityHistoryAsync(
        string entityType, Guid entityId, int page, int pageSize, CancellationToken cancellationToken = default);

    Task<Result<AuditLogDetailDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    Task<Result<AuditChainVerificationDto>> VerifyChainAsync(CancellationToken cancellationToken = default);
}
