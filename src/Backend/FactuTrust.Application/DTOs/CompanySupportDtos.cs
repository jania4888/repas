using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

public sealed record CompanySupportAttachmentDto(
    Guid Id,
    string FileName,
    string ContentType,
    long SizeBytes);

public sealed record CompanySupportMessageDto(
    Guid Id,
    Guid ConversationId,
    CompanySupportAuthorSide AuthorSide,
    string AuthorDisplayName,
    CompanySupportCategory Category,
    string Body,
    DateTime SentAt,
    IReadOnlyList<CompanySupportAttachmentDto> Attachments);

public sealed record CompanySupportBootstrapDto(
    Guid? ConversationId,
    IReadOnlyList<CompanySupportMessageDto> Messages,
    DateTime? LastReadAt,
    int UnreadCount);

public sealed record CompanySupportInboxItemDto(
    Guid ConversationId,
    Guid CompanyTenantId,
    string CompanyName,
    DateTime? LastMessageAt,
    string? LastMessagePreview,
    CompanySupportCategory? LastMessageCategory,
    CompanySupportAuthorSide? LastAuthorSide,
    int UnreadCount);

public sealed record CompanySupportInboxDto(
    IReadOnlyList<CompanySupportInboxItemDto> Items,
    int TotalCount);

public sealed record CompanySupportUpload(string FileName, string ContentType, byte[] Content);
