using FactuTrust.Application.Common.Files;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.CompanySupport;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

public sealed class CompanySupportAttachmentsOptions
{
    public const string SectionName = "CompanySupportAttachments";
    public string BasePath { get; set; } = "App_Data/company-support";
}

public sealed class CompanySupportService : ICompanySupportService
{
    public const int MaxFilesPerMessage = 5;
    public const int MaxMessagesPerCompanyPerDay = 100;
    public const int MaxNotificationRecipients = 20;
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 100;
    private const int PreviewLength = 120;

    private readonly MasterDbContext _db;
    private readonly INotificationService _notifications;
    private readonly IPlatformActionAuditWriter _platformAudit;
    private readonly IOptions<CompanySupportAttachmentsOptions> _options;
    private readonly ILogger<CompanySupportService> _logger;

    public CompanySupportService(
        MasterDbContext db,
        INotificationService notifications,
        IPlatformActionAuditWriter platformAudit,
        IOptions<CompanySupportAttachmentsOptions> options,
        ILogger<CompanySupportService> logger)
    {
        _db = db;
        _notifications = notifications;
        _platformAudit = platformAudit;
        _options = options;
        _logger = logger;
    }

    public async Task<Result<CompanySupportBootstrapDto>> BootstrapForCompanyAsync(
        Guid companyTenantId, Guid userId, CancellationToken cancellationToken = default)
    {
        var gate = await EnsureCompanyTenantAsync(companyTenantId, cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<CompanySupportBootstrapDto>(gate.Error);

        var conversation = await FindConversationAsync(companyTenantId, cancellationToken);
        if (conversation is null)
            return Result.Success(new CompanySupportBootstrapDto(null, Array.Empty<CompanySupportMessageDto>(), null, 0));

        var messages = await LoadMessagesAsync(conversation.Id, null, null, DefaultPageSize, cancellationToken);
        var cursor = await FindCursorAsync(conversation.Id, userId, cancellationToken);
        var unread = await CountUnreadAsync(conversation.Id, userId, cursor?.LastReadAt, cancellationToken);
        return Result.Success(new CompanySupportBootstrapDto(conversation.Id, messages, cursor?.LastReadAt, unread));
    }

    public async Task<Result<IReadOnlyList<CompanySupportMessageDto>>> GetMessagesForCompanyAsync(
        Guid companyTenantId, DateTime? before, DateTime? after, int? limit, CancellationToken cancellationToken = default)
    {
        var gate = await EnsureCompanyTenantAsync(companyTenantId, cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<IReadOnlyList<CompanySupportMessageDto>>(gate.Error);

        var conversation = await FindConversationAsync(companyTenantId, cancellationToken);
        if (conversation is null)
            return Result.Success<IReadOnlyList<CompanySupportMessageDto>>(Array.Empty<CompanySupportMessageDto>());

        var messages = await LoadMessagesAsync(conversation.Id, before, after, ClampLimit(limit), cancellationToken);
        return Result.Success(messages);
    }

    public Task<Result<CompanySupportMessageDto>> PostCompanyMessageAsync(
        Guid companyTenantId, Guid userId, string displayName,
        CompanySupportCategory category, string? body, Guid clientRequestId,
        IReadOnlyList<CompanySupportUpload> files, CancellationToken cancellationToken = default)
        => PostAsync(
            companyTenantId, userId, displayName, CompanySupportAuthorSide.Company, category,
            body, clientRequestId, files, actorEmail: null, cancellationToken);

    public async Task<Result> MarkReadForCompanyAsync(
        Guid companyTenantId, Guid userId, DateTime? readAt, CancellationToken cancellationToken = default)
    {
        var conversation = await FindConversationAsync(companyTenantId, cancellationToken);
        if (conversation is null)
            return Result.Success();
        await AdvanceCursorAsync(conversation.Id, userId, readAt, cancellationToken);
        return Result.Success();
    }

    public async Task<int> GetCompanyUnreadCountAsync(
        Guid companyTenantId, Guid userId, CancellationToken cancellationToken = default)
    {
        var conversation = await FindConversationAsync(companyTenantId, cancellationToken);
        if (conversation is null)
            return 0;
        var cursor = await FindCursorAsync(conversation.Id, userId, cancellationToken);
        return await CountUnreadAsync(conversation.Id, userId, cursor?.LastReadAt, cancellationToken);
    }

    public async Task<Result<(Stream Stream, string FileName, string ContentType)>> DownloadForCompanyAsync(
        Guid companyTenantId, Guid userId, Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var conversation = await FindConversationAsync(companyTenantId, cancellationToken);
        if (conversation is null)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Document introuvable"));

        var opened = await OpenAttachmentAsync(conversation.Id, attachmentId, cancellationToken);
        if (opened.IsFailure)
            return opened;

        _db.CompanySupportAuditEvents.Add(CompanySupportAuditEvent.Create(
            conversation.Id, userId, CompanySupportAuthorSide.Company, "attachment.downloaded",
            attachmentId: attachmentId));
        await _db.SaveChangesAsync(cancellationToken);
        return opened;
    }

    public async Task<Result<CompanySupportInboxDto>> ListForPlatformAsync(
        Guid operatorUserId, string? companyName, bool unreadOnly, CompanySupportCategory? category,
        int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = page < 1 ? 1 : page;
        pageSize = pageSize < 1 ? 20 : Math.Min(pageSize, 50);
        var name = companyName?.Trim();

        var query =
            from conversation in _db.CompanySupportConversations.AsNoTracking()
            join tenant in _db.Tenants.AsNoTracking() on conversation.CompanyTenantId equals tenant.Id
            select new { conversation, tenant.CompanyName };

        if (!string.IsNullOrEmpty(name))
            query = query.Where(x => x.CompanyName.Contains(name));
        if (category is { } cat)
            query = query.Where(x => x.conversation.LastMessageCategory == cat);

        var rows = await query
            .OrderByDescending(x => x.conversation.LastMessageAt)
            .ToListAsync(cancellationToken);

        var conversationIds = rows.Select(r => r.conversation.Id).ToList();
        var cursors = await _db.CompanySupportReadCursors.AsNoTracking()
            .Where(c => c.UserId == operatorUserId && conversationIds.Contains(c.ConversationId))
            .ToDictionaryAsync(c => c.ConversationId, cancellationToken);

        var items = new List<CompanySupportInboxItemDto>();
        foreach (var row in rows)
        {
            cursors.TryGetValue(row.conversation.Id, out var cursor);
            var unread = await CountUnreadAsync(row.conversation.Id, operatorUserId, cursor?.LastReadAt, cancellationToken);
            if (unreadOnly && unread == 0)
                continue;
            items.Add(new CompanySupportInboxItemDto(
                row.conversation.Id,
                row.conversation.CompanyTenantId,
                row.CompanyName,
                row.conversation.LastMessageAt,
                row.conversation.LastMessagePreview,
                row.conversation.LastMessageCategory,
                row.conversation.LastAuthorSide,
                unread));
        }

        var total = items.Count;
        var pageItems = items.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        return Result.Success(new CompanySupportInboxDto(pageItems, total));
    }

    public async Task<Result<CompanySupportBootstrapDto>> GetForPlatformAsync(
        Guid companyTenantId, Guid operatorUserId, CancellationToken cancellationToken = default)
    {
        var gate = await EnsureCompanyTenantAsync(companyTenantId, cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<CompanySupportBootstrapDto>(gate.Error);

        var conversation = await FindConversationAsync(companyTenantId, cancellationToken);
        if (conversation is null)
            return Result.Success(new CompanySupportBootstrapDto(null, Array.Empty<CompanySupportMessageDto>(), null, 0));

        var messages = await LoadMessagesAsync(conversation.Id, null, null, DefaultPageSize, cancellationToken);
        var cursor = await FindCursorAsync(conversation.Id, operatorUserId, cancellationToken);
        var unread = await CountUnreadAsync(conversation.Id, operatorUserId, cursor?.LastReadAt, cancellationToken);
        return Result.Success(new CompanySupportBootstrapDto(conversation.Id, messages, cursor?.LastReadAt, unread));
    }

    public Task<Result<CompanySupportMessageDto>> PostPlatformReplyAsync(
        Guid companyTenantId, Guid operatorUserId, string displayName, string? actorEmail,
        string? body, Guid clientRequestId, IReadOnlyList<CompanySupportUpload> files,
        CancellationToken cancellationToken = default)
        => PostAsync(
            companyTenantId, operatorUserId, displayName, CompanySupportAuthorSide.Platform,
            CompanySupportCategory.Reply, body, clientRequestId, files, actorEmail, cancellationToken);

    public async Task<Result> MarkReadForPlatformAsync(
        Guid companyTenantId, Guid operatorUserId, DateTime? readAt, CancellationToken cancellationToken = default)
    {
        var conversation = await FindConversationAsync(companyTenantId, cancellationToken);
        if (conversation is null)
            return Result.Failure(Error.NotFound("Conversation introuvable"));
        await AdvanceCursorAsync(conversation.Id, operatorUserId, readAt, cancellationToken);
        return Result.Success();
    }

    public async Task<int> GetPlatformUnreadCountAsync(Guid operatorUserId, CancellationToken cancellationToken = default)
    {
        var conversations = await _db.CompanySupportConversations.AsNoTracking()
            .Select(c => c.Id)
            .ToListAsync(cancellationToken);
        var cursors = await _db.CompanySupportReadCursors.AsNoTracking()
            .Where(c => c.UserId == operatorUserId && conversations.Contains(c.ConversationId))
            .ToDictionaryAsync(c => c.ConversationId, cancellationToken);

        var total = 0;
        foreach (var id in conversations)
        {
            cursors.TryGetValue(id, out var cursor);
            total += await CountUnreadAsync(id, operatorUserId, cursor?.LastReadAt, cancellationToken);
        }
        return total;
    }

    public async Task<Result<(Stream Stream, string FileName, string ContentType)>> DownloadForPlatformAsync(
        Guid operatorUserId, string? actorEmail, Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await _db.CompanySupportAttachments.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == attachmentId, cancellationToken);
        if (attachment is null)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Document introuvable"));

        var message = await _db.CompanySupportMessages.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == attachment.MessageId, cancellationToken);
        if (message is null)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Document introuvable"));

        var conversation = await _db.CompanySupportConversations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == message.ConversationId, cancellationToken);
        if (conversation is null)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Document introuvable"));

        var opened = await OpenAttachmentAsync(conversation.Id, attachmentId, cancellationToken);
        if (opened.IsFailure)
            return opened;

        await _platformAudit.WriteAsync(new PlatformActionAuditRecord(
            operatorUserId,
            actorEmail,
            PlatformAuditActions.CompanySupportDownload,
            PlatformAuditOutcomes.Success,
            conversation.CompanyTenantId,
            null,
            new Dictionary<string, object?>
            {
                ["messageId"] = message.Id,
                ["attachmentId"] = attachmentId
            }), cancellationToken);

        return opened;
    }

    private async Task<Result<CompanySupportMessageDto>> PostAsync(
        Guid companyTenantId, Guid userId, string displayName, CompanySupportAuthorSide side,
        CompanySupportCategory category, string? body, Guid clientRequestId,
        IReadOnlyList<CompanySupportUpload> files, string? actorEmail, CancellationToken cancellationToken)
    {
        if (clientRequestId == Guid.Empty)
            return Result.Failure<CompanySupportMessageDto>(Error.Validation("ClientRequestId", "Identifiant de requête obligatoire"));

        var gate = await EnsureCompanyTenantAsync(companyTenantId, cancellationToken);
        if (gate.IsFailure)
            return Result.Failure<CompanySupportMessageDto>(gate.Error);

        var uploads = files ?? Array.Empty<CompanySupportUpload>();
        if (uploads.Count > MaxFilesPerMessage)
            return Result.Failure<CompanySupportMessageDto>(Error.Validation("Files", $"Au plus {MaxFilesPerMessage} fichiers par message"));

        var validated = new List<(string SafeName, string ContentType, byte[] Bytes, string Extension)>();
        foreach (var file in uploads)
        {
            var headerLen = Math.Min(file.Content.Length, UploadValidator.RequiredHeaderBytes);
            var header = file.Content.AsMemory(0, headerLen);
            var check = UploadValidator.Validate(file.FileName, file.ContentType, file.Content.LongLength, header);
            if (!check.IsValid)
                return Result.Failure<CompanySupportMessageDto>(Error.Validation("File", check.ErrorMessage ?? "Fichier refusé"));
            var extension = Path.GetExtension(check.SafeFileName!);
            validated.Add((check.SafeFileName!, file.ContentType.Trim(), file.Content, extension));
        }

        var conversation = await EnsureConversationAsync(companyTenantId, userId, cancellationToken);
        if (conversation.IsFailure)
            return Result.Failure<CompanySupportMessageDto>(conversation.Error);

        var existing = await FindByClientRequestAsync(conversation.Value.Id, clientRequestId, cancellationToken);
        if (existing is not null)
            return Result.Success(existing);

        var dayStart = DateTime.UtcNow.Date;
        var sentToday = await _db.CompanySupportMessages.CountAsync(
            m => m.ConversationId == conversation.Value.Id && m.SentAt >= dayStart, cancellationToken);
        if (sentToday >= MaxMessagesPerCompanyPerDay)
            return Result.Failure<CompanySupportMessageDto>(Error.Validation("Quota", "Plafond journalier de messages atteint"));

        var created = CompanySupportMessage.Create(
            conversation.Value.Id, userId, side, displayName, category, body, clientRequestId, validated.Count > 0);
        if (created.IsFailure)
            return Result.Failure<CompanySupportMessageDto>(created.Error);

        created.Value.SetAuditInfo(userId.ToString());
        var writtenPaths = new List<string>();
        try
        {
            foreach (var file in validated)
            {
                var storedName = $"{Guid.NewGuid():N}{file.Extension}";
                var relative = $"{companyTenantId:N}/{storedName}";
                var absolute = ResolveContainedPath(relative);
                if (absolute is null)
                    throw new InvalidOperationException("Chemin de stockage hors racine.");
                Directory.CreateDirectory(Path.GetDirectoryName(absolute)!);
                await File.WriteAllBytesAsync(absolute, file.Bytes, cancellationToken);
                writtenPaths.Add(absolute);

                var attachment = CompanySupportAttachment.Create(
                    created.Value.Id, file.SafeName, relative, file.ContentType, file.Bytes.LongLength, userId);
                if (attachment.IsFailure)
                {
                    DeleteFiles(writtenPaths);
                    return Result.Failure<CompanySupportMessageDto>(attachment.Error);
                }
                attachment.Value.SetAuditInfo(userId.ToString());
                _db.CompanySupportAttachments.Add(attachment.Value);
            }

            conversation.Value.Touch(category, side, string.IsNullOrWhiteSpace(body) ? validated[0].SafeName : body);
            _db.CompanySupportMessages.Add(created.Value);
            if (side == CompanySupportAuthorSide.Company)
            {
                _db.CompanySupportAuditEvents.Add(CompanySupportAuditEvent.Create(
                    conversation.Value.Id, userId, side, "message.posted", created.Value.Id));
            }

            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            DeleteFiles(writtenPaths);
            DetachPending();
            var raced = await FindByClientRequestAsync(conversation.Value.Id, clientRequestId, cancellationToken);
            if (raced is not null)
                return Result.Success(raced);
            throw;
        }
        catch
        {
            DeleteFiles(writtenPaths);
            throw;
        }

        var dto = await MapMessageAsync(created.Value.Id, cancellationToken);
        if (side == CompanySupportAuthorSide.Platform)
        {
            await _platformAudit.WriteAsync(new PlatformActionAuditRecord(
                userId, actorEmail, PlatformAuditActions.CompanySupportReply, PlatformAuditOutcomes.Success,
                companyTenantId, null,
                new Dictionary<string, object?>
                {
                    ["messageId"] = created.Value.Id,
                    ["category"] = category.ToString()
                }), cancellationToken);
            await NotifyCompanyStaffAsync(companyTenantId, userId, body, cancellationToken);
        }

        return Result.Success(dto!);
    }

    private async Task NotifyCompanyStaffAsync(
        Guid companyTenantId, Guid authorUserId, string? body, CancellationToken cancellationToken)
    {
        try
        {
            var admin = nameof(UserRole.Administrator);
            var supervisor = nameof(UserRole.Supervisor);
            var recipients = await (
                    from user in _db.Users.AsNoTracking()
                    join userRole in _db.UserRoles.AsNoTracking() on user.Id equals userRole.UserId
                    join role in _db.Roles.AsNoTracking() on userRole.RoleId equals role.Id
                    where user.TenantId == companyTenantId
                          && user.IsActive
                          && user.Id != authorUserId
                          && (role.Name == admin || role.Name == supervisor)
                    select user.Id)
                .Distinct()
                .Take(MaxNotificationRecipients)
                .ToListAsync(cancellationToken);

            var preview = string.IsNullOrWhiteSpace(body) ? "Pièce jointe" : body.Trim();
            if (preview.Length > PreviewLength)
                preview = preview[..PreviewLength];

            foreach (var recipientId in recipients)
            {
                await _notifications.CreateAsync(
                    companyTenantId,
                    null,
                    NotificationType.CompanySupportReplyReceived,
                    "Réponse de l'assistance",
                    preview,
                    "/assistance",
                    recipientId,
                    cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Company support notification failed for tenant {TenantId}", companyTenantId);
        }
    }

    private async Task<Result> EnsureCompanyTenantAsync(Guid companyTenantId, CancellationToken cancellationToken)
    {
        if (companyTenantId == Guid.Empty)
            return Result.Failure(Error.Validation("Tenant", "Société invalide"));

        var tenant = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == companyTenantId)
            .Select(t => new { t.Kind })
            .FirstOrDefaultAsync(cancellationToken);
        if (tenant is null || tenant.Kind != TenantKind.Company)
            return Result.Failure(Error.NotFound("Société introuvable"));
        return Result.Success();
    }

    private async Task<Result<CompanySupportConversation>> EnsureConversationAsync(
        Guid companyTenantId, Guid userId, CancellationToken cancellationToken)
    {
        var existing = await _db.CompanySupportConversations
            .FirstOrDefaultAsync(c => c.CompanyTenantId == companyTenantId, cancellationToken);
        if (existing is not null)
            return Result.Success(existing);

        var created = CompanySupportConversation.Create(companyTenantId);
        if (created.IsFailure)
            return created;
        created.Value.SetAuditInfo(userId.ToString());
        _db.CompanySupportConversations.Add(created.Value);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return created;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            _db.Entry(created.Value).State = EntityState.Detached;
            var raced = await _db.CompanySupportConversations
                .FirstAsync(c => c.CompanyTenantId == companyTenantId, cancellationToken);
            return Result.Success(raced);
        }
    }

    private async Task AdvanceCursorAsync(
        Guid conversationId, Guid userId, DateTime? readAt, CancellationToken cancellationToken)
    {
        var target = readAt ?? await _db.CompanySupportMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.SentAt)
            .Select(m => (DateTime?)m.SentAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (target is null)
            return;

        var cursor = await _db.CompanySupportReadCursors
            .FirstOrDefaultAsync(c => c.ConversationId == conversationId && c.UserId == userId, cancellationToken);
        if (cursor is null)
        {
            var created = CompanySupportReadCursor.Create(conversationId, userId, target.Value);
            if (created.IsFailure)
                return;
            created.Value.SetAuditInfo(userId.ToString());
            _db.CompanySupportReadCursors.Add(created.Value);
        }
        else
        {
            cursor.Advance(target.Value);
        }

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            DetachPending();
        }
    }

    private Task<CompanySupportConversation?> FindConversationAsync(Guid companyTenantId, CancellationToken cancellationToken)
        => _db.CompanySupportConversations.FirstOrDefaultAsync(c => c.CompanyTenantId == companyTenantId, cancellationToken);

    private Task<CompanySupportReadCursor?> FindCursorAsync(Guid conversationId, Guid userId, CancellationToken cancellationToken)
        => _db.CompanySupportReadCursors.AsNoTracking()
            .FirstOrDefaultAsync(c => c.ConversationId == conversationId && c.UserId == userId, cancellationToken);

    private async Task<int> CountUnreadAsync(
        Guid conversationId, Guid userId, DateTime? lastReadAt, CancellationToken cancellationToken)
    {
        var query = _db.CompanySupportMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.AuthorUserId != userId);
        if (lastReadAt is { } readAt)
            query = query.Where(m => m.SentAt > readAt);
        return await query.CountAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<CompanySupportMessageDto>> LoadMessagesAsync(
        Guid conversationId, DateTime? before, DateTime? after, int limit, CancellationToken cancellationToken)
    {
        var query = _db.CompanySupportMessages.AsNoTracking().Where(m => m.ConversationId == conversationId);
        if (before is { } beforeAt)
            query = query.Where(m => m.SentAt < beforeAt);
        if (after is { } afterAt)
            query = query.Where(m => m.SentAt > afterAt);

        var rows = await query
            .OrderByDescending(m => m.SentAt)
            .Take(limit)
            .ToListAsync(cancellationToken);
        rows.Reverse();

        var ids = rows.Select(m => m.Id).ToList();
        var attachments = await _db.CompanySupportAttachments.AsNoTracking()
            .Where(a => ids.Contains(a.MessageId))
            .ToListAsync(cancellationToken);
        var byMessage = attachments.GroupBy(a => a.MessageId).ToDictionary(g => g.Key, g => g.ToList());

        return rows.Select(m => Map(m, byMessage.GetValueOrDefault(m.Id))).ToList();
    }

    private async Task<CompanySupportMessageDto?> FindByClientRequestAsync(
        Guid conversationId, Guid clientRequestId, CancellationToken cancellationToken)
    {
        var message = await _db.CompanySupportMessages.AsNoTracking()
            .FirstOrDefaultAsync(m => m.ConversationId == conversationId && m.ClientRequestId == clientRequestId, cancellationToken);
        if (message is null)
            return null;
        return await MapMessageAsync(message.Id, cancellationToken);
    }

    private async Task<CompanySupportMessageDto?> MapMessageAsync(Guid messageId, CancellationToken cancellationToken)
    {
        var message = await _db.CompanySupportMessages.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == messageId, cancellationToken);
        if (message is null)
            return null;
        var attachments = await _db.CompanySupportAttachments.AsNoTracking()
            .Where(a => a.MessageId == messageId)
            .ToListAsync(cancellationToken);
        return Map(message, attachments);
    }

    private static CompanySupportMessageDto Map(CompanySupportMessage message, IReadOnlyList<CompanySupportAttachment>? attachments)
        => new(
            message.Id,
            message.ConversationId,
            message.AuthorSide,
            message.AuthorDisplayName,
            message.Category,
            message.Body,
            message.SentAt,
            (attachments ?? Array.Empty<CompanySupportAttachment>())
                .Select(a => new CompanySupportAttachmentDto(a.Id, a.FileName, a.ContentType, a.SizeBytes))
                .ToList());

    private async Task<Result<(Stream Stream, string FileName, string ContentType)>> OpenAttachmentAsync(
        Guid conversationId, Guid attachmentId, CancellationToken cancellationToken)
    {
        var attachment = await _db.CompanySupportAttachments.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == attachmentId, cancellationToken);
        if (attachment is null)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Document introuvable"));

        var belongs = await _db.CompanySupportMessages.AsNoTracking()
            .AnyAsync(m => m.Id == attachment.MessageId && m.ConversationId == conversationId, cancellationToken);
        if (!belongs)
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Document introuvable"));

        var absolute = ResolveContainedPath(attachment.StoragePath);
        if (absolute is null || !File.Exists(absolute))
            return Result.Failure<(Stream, string, string)>(Error.NotFound("Fichier introuvable"));

        Stream stream = new FileStream(absolute, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Result.Success((stream, attachment.FileName, attachment.ContentType));
    }

    private string ResolveBasePath()
    {
        var basePath = _options.Value.BasePath;
        return Path.IsPathRooted(basePath) ? basePath : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, basePath));
    }

    private string? ResolveContainedPath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || relativePath.Contains("..", StringComparison.Ordinal))
            return null;
        var root = ResolveBasePath();
        var combined = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        var rooted = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        if (!combined.StartsWith(rooted, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(combined, root, StringComparison.OrdinalIgnoreCase))
            return null;
        return combined;
    }

    private static int ClampLimit(int? limit)
    {
        if (limit is null or < 1)
            return DefaultPageSize;
        return Math.Min(limit.Value, MaxPageSize);
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 2601 or 2627 };

    private void DetachPending()
    {
        foreach (var entry in _db.ChangeTracker.Entries().Where(e => e.State != EntityState.Unchanged).ToList())
            entry.State = EntityState.Detached;
    }

    private static void DeleteFiles(IEnumerable<string> paths)
    {
        foreach (var path in paths)
        {
            try
            {
                if (File.Exists(path))
                    File.Delete(path);
            }
            catch
            {
                // best effort
            }
        }
    }
}
