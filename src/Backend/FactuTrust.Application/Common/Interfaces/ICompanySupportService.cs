using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces;

public interface ICompanySupportService
{
    Task<Result<CompanySupportBootstrapDto>> BootstrapForCompanyAsync(
        Guid companyTenantId, Guid userId, CancellationToken cancellationToken = default);

    Task<Result<IReadOnlyList<CompanySupportMessageDto>>> GetMessagesForCompanyAsync(
        Guid companyTenantId, DateTime? before, DateTime? after, int? limit, CancellationToken cancellationToken = default);

    Task<Result<CompanySupportMessageDto>> PostCompanyMessageAsync(
        Guid companyTenantId, Guid userId, string displayName,
        CompanySupportCategory category, string? body, Guid clientRequestId,
        IReadOnlyList<CompanySupportUpload> files, CancellationToken cancellationToken = default);

    Task<Result> MarkReadForCompanyAsync(
        Guid companyTenantId, Guid userId, DateTime? readAt, CancellationToken cancellationToken = default);

    Task<int> GetCompanyUnreadCountAsync(
        Guid companyTenantId, Guid userId, CancellationToken cancellationToken = default);

    Task<Result<(Stream Stream, string FileName, string ContentType)>> DownloadForCompanyAsync(
        Guid companyTenantId, Guid userId, Guid attachmentId, CancellationToken cancellationToken = default);

    Task<Result<CompanySupportInboxDto>> ListForPlatformAsync(
        Guid operatorUserId, string? companyName, bool unreadOnly, CompanySupportCategory? category,
        int page, int pageSize, CancellationToken cancellationToken = default);

    Task<Result<CompanySupportBootstrapDto>> GetForPlatformAsync(
        Guid companyTenantId, Guid operatorUserId, CancellationToken cancellationToken = default);

    Task<Result<CompanySupportMessageDto>> PostPlatformReplyAsync(
        Guid companyTenantId, Guid operatorUserId, string displayName, string? actorEmail,
        string? body, Guid clientRequestId, IReadOnlyList<CompanySupportUpload> files,
        CancellationToken cancellationToken = default);

    Task<Result> MarkReadForPlatformAsync(
        Guid companyTenantId, Guid operatorUserId, DateTime? readAt, CancellationToken cancellationToken = default);

    Task<int> GetPlatformUnreadCountAsync(Guid operatorUserId, CancellationToken cancellationToken = default);

    Task<Result<(Stream Stream, string FileName, string ContentType)>> DownloadForPlatformAsync(
        Guid operatorUserId, string? actorEmail, Guid attachmentId, CancellationToken cancellationToken = default);
}
