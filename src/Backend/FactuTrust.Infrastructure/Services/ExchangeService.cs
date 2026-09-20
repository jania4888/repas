using System.Collections.Frozen;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Exchange;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

public sealed class ExchangeAttachmentsOptions
{
    public const string SectionName = "ExchangeAttachments";
    public string BasePath { get; set; } = "App_Data/attachments";
}

public sealed class ExchangeService : IExchangeService
{
    private const long MaxFileSizeBytes = 10 * 1024 * 1024;

    private static readonly FrozenDictionary<string, string> AllowedContentTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["application/pdf"] = ".pdf",
        ["image/jpeg"] = ".jpg",
        ["image/jpg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp",
        ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] = ".xlsx",
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] = ".docx"
    }.ToFrozenDictionary();

    private const int DefaultMessagePageSize = 50;
    private const int MaxMessagePageSize = 100;
    private const int MaxMarkReadBatchSize = 100;

    private readonly MasterDbContext _db;
    private readonly IDbContextFactory<MasterDbContext> _dbFactory;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly FirmDossierAccessService _dossierAccess;
    private readonly FirmAssignmentService _assignments;
    private readonly INotificationService _notifications;
    private readonly IExchangeOppositePartyNotifier _oppositeParty;
    private readonly ExchangeAttachmentsOptions _options;
    private readonly ILogger<ExchangeService> _logger;

    // <c>_dbFactory</c> produit des MasterDbContext isolés du scope de requête. Utilisé
    // exclusivement par le flux read-only du bootstrap : évite tout partage d'instance
    // avec DataProtection et les autres services scoped, source identifiée du bug
    // « A second operation was started on this context instance… » côté /api/exchanges/bootstrap.
    // Les classes concrètes des services helpers sont injectées pour accéder aux surcharges
    // internes acceptant un MasterDbContext explicite (voir Firm{Assignment,DossierAccess}Service).
    public ExchangeService(
        MasterDbContext db,
        IDbContextFactory<MasterDbContext> dbFactory,
        UserManager<ApplicationUser> userManager,
        FirmDossierAccessService dossierAccess,
        FirmAssignmentService assignments,
        INotificationService notifications,
        IExchangeOppositePartyNotifier oppositeParty,
        IOptions<ExchangeAttachmentsOptions> options,
        ILogger<ExchangeService> logger)
    {
        _db = db;
        _dbFactory = dbFactory;
        _userManager = userManager;
        _dossierAccess = dossierAccess;
        _assignments = assignments;
        _notifications = notifications;
        _oppositeParty = oppositeParty;
        _options = options.Value;
        _logger = logger;
    }

    public Task<IReadOnlyList<ExchangeThreadListItemDto>> ListThreadsAsync(
        Guid homeTenantId,
        TenantKind tenantKind,
        FirmDossierAccessScope? firmScope,
        Guid? viewerUserId = null,
        CancellationToken cancellationToken = default)
        => ListThreadsAsync(_db, homeTenantId, tenantKind, firmScope, viewerUserId, cancellationToken);

    private static async Task<IReadOnlyList<ExchangeThreadListItemDto>> ListThreadsAsync(
        MasterDbContext ctx,
        Guid homeTenantId,
        TenantKind tenantKind,
        FirmDossierAccessScope? firmScope,
        Guid? viewerUserId,
        CancellationToken cancellationToken)
    {
        var query = ctx.ExchangeThreads.AsNoTracking()
            .Join(ctx.FirmClientAssignments.AsNoTracking(),
                t => t.FirmClientAssignmentId,
                a => a.Id,
                (t, a) => new { Thread = t, Assignment = a })
            .Where(x => x.Assignment.Status == FirmAssignmentStatus.Active);

        if (tenantKind == TenantKind.AccountingFirm)
        {
            query = query.Where(x => x.Thread.FirmTenantId == homeTenantId);
            if (firmScope is { } scope)
            {
                var accessible = await FirmDossierAccessService.GetAccessibleCompanyTenantIdsAsync(
                    ctx, homeTenantId, scope, cancellationToken);
                if (accessible is not null)
                    query = query.Where(x => accessible.Contains(x.Thread.CompanyTenantId));
            }
        }
        else
        {
            query = query.Where(x => x.Thread.CompanyTenantId == homeTenantId);
        }

        var rows = await query
            .OrderByDescending(x => x.Thread.LastActivityAt ?? x.Thread.CreatedAt)
            .Select(x => x.Thread)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return Array.Empty<ExchangeThreadListItemDto>();

        var companyIds = rows.Select(r => r.CompanyTenantId).Distinct().ToList();
        var firmIds = rows.Select(r => r.FirmTenantId).Distinct().ToList();
        var names = await GetTenantNamesAsync(ctx, companyIds.Concat(firmIds).Distinct().ToList(), cancellationToken);
        var firmProfiles = await ctx.AccountingFirmProfiles.AsNoTracking()
            .Where(p => firmIds.Contains(p.TenantId))
            .ToDictionaryAsync(p => p.TenantId, p => p.DisplayName, cancellationToken);

        var unreadByThread = new Dictionary<Guid, int>();
        if (viewerUserId is { } userId && userId != Guid.Empty)
        {
            var threadIds = rows.Select(r => r.Id).ToList();
            unreadByThread = await AggregateUnreadByThreadAsync(
                ctx, threadIds, userId, tenantKind == TenantKind.AccountingFirm, cancellationToken);
        }

        return rows.Select(t =>
        {
            var counterpart = tenantKind == TenantKind.AccountingFirm
                ? names.GetValueOrDefault(t.CompanyTenantId, "Société")
                : firmProfiles.GetValueOrDefault(t.FirmTenantId) ?? names.GetValueOrDefault(t.FirmTenantId, "Cabinet");
            var unread = unreadByThread.GetValueOrDefault(t.Id, 0);
            return new ExchangeThreadListItemDto(
                t.Id, t.FirmClientAssignmentId, t.FirmTenantId, t.CompanyTenantId,
                counterpart, t.Status, t.LastActivityAt, unread, t.Subject);
        }).ToList();
    }

    public Task<Result<ExchangeThreadDetailDto>> GetThreadAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
        => GetThreadAsync(_db, threadId, homeTenantId, tenantKind, userId, userRole, firmScope, cancellationToken);

    private static async Task<Result<ExchangeThreadDetailDto>> GetThreadAsync(
        MasterDbContext ctx,
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        var access = await ResolveAccessibleThreadAsync(ctx, threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeThreadDetailDto>(access.Error);

        return Result.Success(await MapDetailAsync(ctx, access.Value, cancellationToken));
    }

    public async Task<Result<ExchangeThreadDetailDto>> EnsureThreadAsync(
        Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName, string? userRole,
        FirmDossierAccessScope? firmScope, Guid? firmClientAssignmentId, CancellationToken cancellationToken = default)
    {
        Domain.Entities.FirmClientAssignment? assignment;

        if (tenantKind == TenantKind.AccountingFirm)
        {
            if (firmClientAssignmentId is null || firmClientAssignmentId == Guid.Empty)
                return Result.Failure<ExchangeThreadDetailDto>(Error.Validation("Assignment", "Affectation requise"));

            assignment = await _db.FirmClientAssignments
                .FirstOrDefaultAsync(a => a.Id == firmClientAssignmentId && a.FirmTenantId == homeTenantId
                    && a.Status == FirmAssignmentStatus.Active, cancellationToken);
            if (assignment is null)
                return Result.Failure<ExchangeThreadDetailDto>(Error.Validation("Assignment", "Affectation introuvable"));

            if (firmScope is { } scope &&
                !await _dossierAccess.CanAccessAssignmentAsync(homeTenantId, scope, assignment.Id, cancellationToken))
                return Result.Failure<ExchangeThreadDetailDto>(Error.Forbidden(FirmDossierAccessService.NotAssignedMessage));
        }
        else
        {
            if (!IsCompanyAdmin(userRole))
                return Result.Failure<ExchangeThreadDetailDto>(Error.Forbidden("Réservé à l'administrateur"));

            assignment = await _db.FirmClientAssignments
                .FirstOrDefaultAsync(a => a.CompanyTenantId == homeTenantId && a.Status == FirmAssignmentStatus.Active, cancellationToken);
            if (assignment is null)
                return Result.Failure<ExchangeThreadDetailDto>(Error.Validation("Assignment", "Aucune liaison cabinet active"));
        }

        var existing = await _db.ExchangeThreads
            .FirstOrDefaultAsync(t => t.FirmClientAssignmentId == assignment.Id, cancellationToken);

        if (existing is null)
        {
            var create = ExchangeThread.Create(assignment.Id, assignment.FirmTenantId, assignment.CompanyTenantId);
            if (create.IsFailure)
                return Result.Failure<ExchangeThreadDetailDto>(create.Error);

            existing = create.Value;
            existing.SetAuditInfo(userId.ToString());
            _db.ExchangeThreads.Add(existing);
            await AddAuditAsync(existing.Id, userId, displayName, ExchangeAuditEventType.ThreadOpened, null);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return Result.Success(await MapDetailAsync(existing, cancellationToken));
    }

    public async Task<Result> CloseThreadAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName,
        string? userRole, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure(Error.Forbidden("Réservé à l'administrateur"));
        if (tenantKind == TenantKind.AccountingFirm && !IsFirmManager(userRole))
            return Result.Failure(Error.Forbidden("Seul le gestionnaire du cabinet peut clore l'échange"));

        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure(access.Error);

        var close = access.Value.Close(userId);
        if (close.IsFailure)
            return close;

        access.Value.SetAuditInfo(userId.ToString(), isUpdate: true);
        await AddAuditAsync(threadId, userId, displayName, ExchangeAuditEventType.ThreadClosed, null);
        await _db.SaveChangesAsync(cancellationToken);

        var thread = access.Value;
        var recipientTenantId = tenantKind == TenantKind.AccountingFirm ? thread.CompanyTenantId : thread.FirmTenantId;
        var recipientRole = tenantKind == TenantKind.AccountingFirm
            ? nameof(UserRole.Administrator)
            : nameof(UserRole.FirmManager);
        var link = BuildLink(recipientTenantId == thread.CompanyTenantId, thread.Id);
        await TryNotifyAsync(recipientTenantId, recipientRole, NotificationType.ExchangeThreadClosed,
            "Échange clos", "L'échange professionnel a été clos.", link);

        return Result.Success();
    }

    public async Task<Result> ReopenThreadAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName,
        string? userRole, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure(Error.Forbidden("Réservé à l'administrateur"));
        if (tenantKind == TenantKind.AccountingFirm && !IsFirmManager(userRole))
            return Result.Failure(Error.Forbidden("Seul le gestionnaire du cabinet peut rouvrir l'échange"));

        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure(access.Error);

        var reopen = access.Value.Reopen();
        if (reopen.IsFailure)
            return reopen;

        access.Value.SetAuditInfo(userId.ToString(), isUpdate: true);
        await AddAuditAsync(threadId, userId, displayName, ExchangeAuditEventType.ThreadReopened, null);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public Task<Result<PagedExchangeMessagesDto>> GetMessagesAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, DateTime? after, DateTime? before = null, int? limit = null,
        CancellationToken cancellationToken = default)
        => GetMessagesAsync(_db, threadId, homeTenantId, tenantKind, userId, userRole, firmScope, after, before, limit, cancellationToken);

    private static async Task<Result<PagedExchangeMessagesDto>> GetMessagesAsync(
        MasterDbContext ctx,
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, DateTime? after, DateTime? before, int? limit,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAccessibleThreadAsync(ctx, threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<PagedExchangeMessagesDto>(access.Error);

        var isFirm = tenantKind == TenantKind.AccountingFirm;
        var q = ctx.ExchangeMessages.AsNoTracking().Where(m => m.ThreadId == threadId);
        if (!isFirm)
            q = q.Where(m => m.Visibility == ExchangeMessageVisibility.ClientVisible);
        if (after.HasValue)
            q = q.Where(m => m.SentAt > after.Value);
        if (before.HasValue)
            q = q.Where(m => m.SentAt < before.Value);

        // Incremental poll (`after`): chronological list capped to MaxMessagePageSize.
        // Legacy full fetch (no limit, no after): unbounded chronological list.
        if (after.HasValue || limit is null)
        {
            var ordered = q.OrderBy(m => m.SentAt);
            if (after.HasValue)
            {
                var capped = await ordered.Take(MaxMessagePageSize).ToListAsync(cancellationToken);
                var mappedCapped = await MapMessagesAsync(ctx, capped, cancellationToken);
                return Result.Success(new PagedExchangeMessagesDto(
                    mappedCapped,
                    HasMore: capped.Count == MaxMessagePageSize,
                    OldestSentAt: mappedCapped.Count > 0 ? mappedCapped[0].SentAt : null));
            }

            var all = await ordered.ToListAsync(cancellationToken);
            var mappedAll = await MapMessagesAsync(ctx, all, cancellationToken);
            return Result.Success(new PagedExchangeMessagesDto(
                mappedAll,
                HasMore: false,
                OldestSentAt: mappedAll.Count > 0 ? mappedAll[0].SentAt : null));
        }

        var pageSize = Math.Clamp(limit.Value, 1, MaxMessagePageSize);
        var pageDesc = await q.OrderByDescending(m => m.SentAt).Take(pageSize + 1).ToListAsync(cancellationToken);
        var hasMore = pageDesc.Count > pageSize;
        if (hasMore)
            pageDesc = pageDesc.Take(pageSize).ToList();
        pageDesc.Reverse();
        var mapped = await MapMessagesAsync(ctx, pageDesc, cancellationToken);
        return Result.Success(new PagedExchangeMessagesDto(
            mapped,
            hasMore,
            mapped.Count > 0 ? mapped[0].SentAt : null));
    }

    public async Task<Result<ExchangeMessageDto>> SendMessageAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName,
        string? userRole, FirmDossierAccessScope? firmScope, SendExchangeMessageDto dto,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeMessageDto>(access.Error);

        var thread = access.Value;
        if (thread.Status == ExchangeThreadStatus.Closed)
            return Result.Failure<ExchangeMessageDto>(Error.Validation("Status", "L'échange est clos"));

        if (dto.Visibility == ExchangeMessageVisibility.InternalNote && tenantKind != TenantKind.AccountingFirm)
            return Result.Failure<ExchangeMessageDto>(Error.Forbidden("Les notes internes sont réservées au cabinet"));

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeMessageDto>(Error.Forbidden("Réservé à l'administrateur"));

        var create = ExchangeMessage.Create(threadId, userId, homeTenantId, displayName, dto.Body, dto.Visibility);
        if (create.IsFailure)
            return Result.Failure<ExchangeMessageDto>(create.Error);

        _db.ExchangeMessages.Add(create.Value);
        thread.TouchActivity();
        thread.SetAuditInfo(userId.ToString(), isUpdate: true);

        var auditType = dto.Visibility == ExchangeMessageVisibility.InternalNote
            ? ExchangeAuditEventType.InternalNoteAdded
            : ExchangeAuditEventType.MessageSent;
        await AddAuditAsync(threadId, userId, displayName, auditType, null);
        await _db.SaveChangesAsync(cancellationToken);

        if (dto.Visibility == ExchangeMessageVisibility.ClientVisible)
        {
            var recipientTenantId = tenantKind == TenantKind.AccountingFirm ? thread.CompanyTenantId : thread.FirmTenantId;
            var recipientRole = tenantKind == TenantKind.AccountingFirm
                ? nameof(UserRole.Administrator)
                : null;
            var link = BuildLink(recipientTenantId == thread.CompanyTenantId, thread.Id);
            await TryNotifyAsync(recipientTenantId, recipientRole, NotificationType.ExchangeMessageReceived,
                "Nouveau message", Truncate(dto.Body, 120), link);
        }

        var mapped = await MapMessagesAsync(new[] { create.Value }, cancellationToken);
        return Result.Success(mapped[0]);
    }

    public async Task<Result> MarkMessageReadAsync(
        Guid threadId, Guid messageId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string? userRole, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure(access.Error);

        var message = await _db.ExchangeMessages.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == messageId && m.ThreadId == threadId, cancellationToken);
        if (message is null)
            return Result.Failure(Error.Validation("Message", "Message introuvable"));

        if (message.Visibility == ExchangeMessageVisibility.InternalNote && tenantKind != TenantKind.AccountingFirm)
            return Result.Failure(Error.Forbidden("Accès refusé"));

        var exists = await _db.ExchangeMessageReads.AnyAsync(r => r.MessageId == messageId && r.UserId == userId, cancellationToken);
        if (exists)
            return Result.Success();

        var read = ExchangeMessageRead.Create(messageId, userId);
        if (read.IsFailure)
            return Result.Failure(read.Error);

        _db.ExchangeMessageReads.Add(read.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> MarkMessagesReadBatchAsync(
        Guid threadId, IReadOnlyList<Guid> messageIds, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string? userRole, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        if (messageIds is null || messageIds.Count == 0)
            return Result.Success();

        var access = await ResolveAccessibleThreadAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure(access.Error);

        var distinctIds = messageIds.Where(id => id != Guid.Empty).Distinct().Take(MaxMarkReadBatchSize).ToList();
        if (distinctIds.Count == 0)
            return Result.Success();

        var isFirm = tenantKind == TenantKind.AccountingFirm;
        var messages = await _db.ExchangeMessages.AsNoTracking()
            .Where(m => m.ThreadId == threadId && distinctIds.Contains(m.Id))
            .Select(m => new { m.Id, m.Visibility })
            .ToListAsync(cancellationToken);

        var eligibleIds = messages
            .Where(m => isFirm || m.Visibility == ExchangeMessageVisibility.ClientVisible)
            .Select(m => m.Id)
            .ToList();
        if (eligibleIds.Count == 0)
            return Result.Success();

        var alreadyRead = await _db.ExchangeMessageReads.AsNoTracking()
            .Where(r => r.UserId == userId && eligibleIds.Contains(r.MessageId))
            .Select(r => r.MessageId)
            .ToListAsync(cancellationToken);
        var alreadySet = alreadyRead.ToHashSet();

        foreach (var messageId in eligibleIds.Where(id => !alreadySet.Contains(id)))
        {
            var read = ExchangeMessageRead.Create(messageId, userId);
            if (read.IsSuccess)
                _db.ExchangeMessageReads.Add(read.Value);
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public Task<Result<IReadOnlyList<ExchangeRequestDto>>> ListRequestsAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
        => ListRequestsAsync(_db, threadId, homeTenantId, tenantKind, userId, userRole, firmScope, cancellationToken);

    private static async Task<Result<IReadOnlyList<ExchangeRequestDto>>> ListRequestsAsync(
        MasterDbContext ctx,
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        var access = await ResolveAccessibleThreadAsync(ctx, threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<IReadOnlyList<ExchangeRequestDto>>(access.Error);

        var rows = await ctx.ExchangeRequests.AsNoTracking()
            .Where(r => r.ThreadId == threadId)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<ExchangeRequestDto>>(rows.Select(MapRequest).ToList());
    }

    public async Task<Result<ExchangeRequestDto>> CreateRequestAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName,
        string? userRole, FirmDossierAccessScope? firmScope, CreateExchangeRequestDto dto,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeRequestDto>(access.Error);

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeRequestDto>(Error.Forbidden("Réservé à l'administrateur"));

        var thread = access.Value;
        if (thread.Status == ExchangeThreadStatus.Closed)
            return Result.Failure<ExchangeRequestDto>(Error.Validation("Status", "L'échange est clos"));

        var nextNumber = await _db.ExchangeRequests.Where(r => r.ThreadId == threadId).MaxAsync(r => (int?)r.Number, cancellationToken) ?? 0;
        var create = ExchangeRequest.Create(threadId, nextNumber + 1, dto.Title, dto.Description ?? string.Empty,
            dto.Category, dto.Priority, userId, homeTenantId);
        if (create.IsFailure)
            return Result.Failure<ExchangeRequestDto>(create.Error);

        create.Value.SetAuditInfo(userId.ToString());
        _db.ExchangeRequests.Add(create.Value);
        thread.TouchActivity();
        await AddAuditAsync(threadId, userId, displayName, ExchangeAuditEventType.RequestCreated,
            $"{{\"number\":{create.Value.Number}}}");
        await _db.SaveChangesAsync(cancellationToken);

        await _oppositeParty.NotifyAsync(
            thread, homeTenantId, NotificationType.ExchangeRequestCreated,
            "Nouvelle demande", create.Value.Title, "demandes", cancellationToken);

        return Result.Success(MapRequest(create.Value));
    }

    public async Task<Result<ExchangeRequestDto>> ChangeRequestStatusAsync(
        Guid threadId, Guid requestId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string displayName, string? userRole, FirmDossierAccessScope? firmScope,
        ChangeExchangeRequestStatusDto dto, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeRequestDto>(access.Error);

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeRequestDto>(Error.Forbidden("Réservé à l'administrateur"));

        var request = await _db.ExchangeRequests.FirstOrDefaultAsync(r => r.Id == requestId && r.ThreadId == threadId, cancellationToken);
        if (request is null)
            return Result.Failure<ExchangeRequestDto>(Error.Validation("Request", "Demande introuvable"));

        var change = request.ChangeStatus(dto.Status);
        if (change.IsFailure)
            return Result.Failure<ExchangeRequestDto>(change.Error);

        request.SetAuditInfo(userId.ToString(), isUpdate: true);
        access.Value.TouchActivity();
        await AddAuditAsync(threadId, userId, displayName, ExchangeAuditEventType.RequestStatusChanged,
            $"{{\"requestId\":\"{requestId}\",\"status\":\"{dto.Status}\"}}");
        await _db.SaveChangesAsync(cancellationToken);

        var thread = access.Value;
        var recipientTenantId = tenantKind == TenantKind.AccountingFirm ? thread.CompanyTenantId : thread.FirmTenantId;
        var recipientRole = tenantKind == TenantKind.AccountingFirm ? nameof(UserRole.Administrator) : null;
        await TryNotifyAsync(recipientTenantId, recipientRole, NotificationType.ExchangeRequestStatusChanged,
            "Demande mise à jour", $"Statut : {dto.Status}", BuildLink(recipientTenantId == thread.CompanyTenantId, thread.Id));

        return Result.Success(MapRequest(request));
    }

    public async Task<Result<ExchangeRequestDto>> AssignRequestAsync(
        Guid threadId, Guid requestId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string displayName, string? userRole, FirmDossierAccessScope? firmScope,
        AssignExchangeRequestDto dto, CancellationToken cancellationToken = default)
    {
        if (tenantKind != TenantKind.AccountingFirm)
            return Result.Failure<ExchangeRequestDto>(Error.Forbidden("Réservé au cabinet"));

        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeRequestDto>(access.Error);

        var request = await _db.ExchangeRequests.FirstOrDefaultAsync(r => r.Id == requestId && r.ThreadId == threadId, cancellationToken);
        if (request is null)
            return Result.Failure<ExchangeRequestDto>(Error.Validation("Request", "Demande introuvable"));

        var assign = request.Assign(dto.AssigneeUserId);
        if (assign.IsFailure)
            return Result.Failure<ExchangeRequestDto>(assign.Error);

        request.SetAuditInfo(userId.ToString(), isUpdate: true);
        access.Value.TouchActivity();
        await AddAuditAsync(threadId, userId, displayName, ExchangeAuditEventType.RequestAssigned,
            $"{{\"requestId\":\"{requestId}\",\"assigneeUserId\":\"{dto.AssigneeUserId}\"}}");
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(MapRequest(request));
    }

    public async Task<Result<IReadOnlyList<ExchangeRequestCommentDto>>> ListRequestCommentsAsync(
        Guid threadId, Guid requestId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string? userRole, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<IReadOnlyList<ExchangeRequestCommentDto>>(access.Error);

        var exists = await _db.ExchangeRequests.AsNoTracking()
            .AnyAsync(r => r.Id == requestId && r.ThreadId == threadId, cancellationToken);
        if (!exists)
            return Result.Failure<IReadOnlyList<ExchangeRequestCommentDto>>(Error.Validation("Request", "Demande introuvable"));

        var rows = await _db.ExchangeRequestComments.AsNoTracking()
            .Where(c => c.RequestId == requestId && c.ThreadId == threadId)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<ExchangeRequestCommentDto>>(rows.Select(MapComment).ToList());
    }

    public async Task<Result<ExchangeRequestCommentDto>> AddRequestCommentAsync(
        Guid threadId, Guid requestId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string displayName, string? userRole, FirmDossierAccessScope? firmScope,
        CreateExchangeRequestCommentDto dto, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeRequestCommentDto>(access.Error);

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeRequestCommentDto>(Error.Forbidden("Réservé à l'administrateur"));

        var thread = access.Value;
        if (thread.Status == ExchangeThreadStatus.Closed)
            return Result.Failure<ExchangeRequestCommentDto>(Error.Validation("Status", "L'échange est clos"));

        var request = await _db.ExchangeRequests.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == requestId && r.ThreadId == threadId, cancellationToken);
        if (request is null)
            return Result.Failure<ExchangeRequestCommentDto>(Error.Validation("Request", "Demande introuvable"));
        if (request.Status == ExchangeRequestStatus.Closed)
            return Result.Failure<ExchangeRequestCommentDto>(Error.Validation("Status", "Une demande close ne peut plus recevoir de commentaires"));

        var create = ExchangeRequestComment.Create(threadId, requestId, userId, homeTenantId, displayName, dto.Body);
        if (create.IsFailure)
            return Result.Failure<ExchangeRequestCommentDto>(create.Error);

        create.Value.SetAuditInfo(userId.ToString());
        _db.ExchangeRequestComments.Add(create.Value);
        thread.TouchActivity();
        await AddAuditAsync(threadId, userId, displayName, ExchangeAuditEventType.RequestCommented,
            $"{{\"requestId\":\"{requestId}\"}}");
        await _db.SaveChangesAsync(cancellationToken);

        await _oppositeParty.NotifyAsync(
            thread, homeTenantId, NotificationType.ExchangeRequestCommented,
            "Nouveau commentaire", request.Title, "demandes", cancellationToken);

        return Result.Success(MapComment(create.Value));
    }

    public Task<Result<IReadOnlyList<ExchangeTaskDto>>> ListTasksAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
        => ListTasksAsync(_db, threadId, homeTenantId, tenantKind, userId, userRole, firmScope, cancellationToken);

    private static async Task<Result<IReadOnlyList<ExchangeTaskDto>>> ListTasksAsync(
        MasterDbContext ctx,
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        var access = await ResolveAccessibleThreadAsync(ctx, threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<IReadOnlyList<ExchangeTaskDto>>(access.Error);

        var rows = await ctx.ExchangeTasks.AsNoTracking()
            .Where(t => t.ThreadId == threadId)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<ExchangeTaskDto>>(rows.Select(MapTask).ToList());
    }

    public async Task<Result<ExchangeTaskDto>> CreateTaskAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName,
        string? userRole, FirmDossierAccessScope? firmScope, CreateExchangeTaskDto dto,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeTaskDto>(access.Error);

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeTaskDto>(Error.Forbidden("Réservé à l'administrateur"));

        var thread = access.Value;
        if (thread.Status == ExchangeThreadStatus.Closed)
            return Result.Failure<ExchangeTaskDto>(Error.Validation("Status", "L'échange est clos"));

        Guid? assigneeTenantId = null;
        if (dto.AssigneeUserId is { } assigneeId && assigneeId != Guid.Empty)
        {
            var assignee = await _userManager.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == assigneeId, cancellationToken);
            assigneeTenantId = assignee?.TenantId;
        }

        var create = ExchangeTask.Create(threadId, dto.Title, dto.Description, dto.DueDate,
            dto.AssigneeUserId, assigneeTenantId, userId, homeTenantId);
        if (create.IsFailure)
            return Result.Failure<ExchangeTaskDto>(create.Error);

        create.Value.SetAuditInfo(userId.ToString());
        _db.ExchangeTasks.Add(create.Value);
        thread.TouchActivity();

        var eventType = dto.DueDate.HasValue
            ? ExchangeAuditEventType.AppointmentSuggested
            : ExchangeAuditEventType.TaskCreated;
        await AddAuditAsync(threadId, userId, displayName, eventType, null);
        await _db.SaveChangesAsync(cancellationToken);

        var opposite = await _oppositeParty.NotifyAsync(
            thread, homeTenantId, NotificationType.ExchangeTaskCreated,
            "Nouvelle tâche", create.Value.Title, "taches", cancellationToken);

        if (dto.AssigneeUserId is { } aid && aid != Guid.Empty && aid != userId
            && aid != opposite.RecipientUserId && assigneeTenantId is { } atid)
        {
            var assigneeLink = BuildLink(atid == thread.CompanyTenantId, thread.Id, "taches");
            await TryNotifyUserAsync(atid, aid, NotificationType.ExchangeTaskAssigned,
                "Tâche assignée", create.Value.Title, assigneeLink);
        }

        return Result.Success(MapTask(create.Value));
    }

    public async Task<Result<ExchangeTaskDto>> ChangeTaskStatusAsync(
        Guid threadId, Guid taskId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string displayName, string? userRole, FirmDossierAccessScope? firmScope,
        ChangeExchangeTaskStatusDto dto, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeTaskDto>(access.Error);

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeTaskDto>(Error.Forbidden("Réservé à l'administrateur"));

        var task = await _db.ExchangeTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ThreadId == threadId, cancellationToken);
        if (task is null)
            return Result.Failure<ExchangeTaskDto>(Error.Validation("Task", "Tâche introuvable"));

        var change = task.ChangeStatus(dto.Status);
        if (change.IsFailure)
            return Result.Failure<ExchangeTaskDto>(change.Error);

        task.SetAuditInfo(userId.ToString(), isUpdate: true);
        access.Value.TouchActivity();
        var auditType = dto.Status == ExchangeTaskStatus.Done
            ? ExchangeAuditEventType.TaskCompleted
            : ExchangeAuditEventType.TaskStatusChanged;
        await AddAuditAsync(threadId, userId, displayName, auditType, $"{{\"status\":\"{dto.Status}\"}}");
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(MapTask(task));
    }

    public Task<Result<IReadOnlyList<ExchangeDocumentDto>>> ListDocumentsAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
        => ListDocumentsAsync(_db, threadId, homeTenantId, tenantKind, userId, userRole, firmScope, cancellationToken);

    private static async Task<Result<IReadOnlyList<ExchangeDocumentDto>>> ListDocumentsAsync(
        MasterDbContext ctx,
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        var access = await ResolveAccessibleThreadAsync(ctx, threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<IReadOnlyList<ExchangeDocumentDto>>(access.Error);

        var rows = await ctx.ExchangeDocuments.AsNoTracking()
            .Where(d => d.ThreadId == threadId)
            .OrderByDescending(d => d.UploadedAt)
            .ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<ExchangeDocumentDto>>(rows.Select(MapDocument).ToList());
    }

    public async Task<Result<ExchangeDocumentDto>> UploadDocumentAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName,
        string? userRole, FirmDossierAccessScope? firmScope, string fileName, string contentType,
        Stream content, Guid? messageId, Guid? requestId, Guid? taskId, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadTrackedAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<ExchangeDocumentDto>(access.Error);

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeDocumentDto>(Error.Forbidden("Réservé à l'administrateur"));

        var thread = access.Value;
        if (thread.Status == ExchangeThreadStatus.Closed)
            return Result.Failure<ExchangeDocumentDto>(Error.Validation("Status", "L'échange est clos"));

        if (string.IsNullOrWhiteSpace(contentType) || !AllowedContentTypes.TryGetValue(contentType.Trim(), out var ext))
            return Result.Failure<ExchangeDocumentDto>(Error.Validation("ContentType",
                "Type de fichier non autorisé. Formats acceptés : PDF, JPEG, PNG, WebP, Excel (.xlsx), Word (.docx)."));

        await using var ms = new MemoryStream();
        await content.CopyToAsync(ms, cancellationToken);
        if (ms.Length <= 0 || ms.Length > MaxFileSizeBytes)
            return Result.Failure<ExchangeDocumentDto>(Error.Validation("Size", "Fichier trop volumineux (max 10 Mo) ou vide"));

        var safeName = Path.GetFileName(fileName);
        if (string.IsNullOrWhiteSpace(safeName))
            safeName = $"document{ext}";

        var relativeDir = Path.Combine("exchanges", thread.FirmTenantId.ToString("N"), threadId.ToString("N"));
        var storedName = $"{Guid.NewGuid():N}{ext}";
        var relativePath = Path.Combine(relativeDir, storedName).Replace('\\', '/');
        var absoluteDir = Path.Combine(ResolveBasePath(), relativeDir);
        Directory.CreateDirectory(absoluteDir);
        var absolutePath = Path.Combine(absoluteDir, storedName);

        await File.WriteAllBytesAsync(absolutePath, ms.ToArray(), cancellationToken);

        var create = ExchangeDocument.Create(threadId, safeName, relativePath, contentType.Trim(), ms.Length,
            userId, homeTenantId, messageId, requestId, taskId);
        if (create.IsFailure)
        {
            TryDeleteFile(absolutePath);
            return Result.Failure<ExchangeDocumentDto>(create.Error);
        }

        create.Value.SetAuditInfo(userId.ToString());
        _db.ExchangeDocuments.Add(create.Value);
        thread.TouchActivity();
        var documentPayload = requestId is { } rid
            ? $"{{\"fileName\":{System.Text.Json.JsonSerializer.Serialize(safeName)},\"requestId\":\"{rid}\"}}"
            : $"{{\"fileName\":{System.Text.Json.JsonSerializer.Serialize(safeName)}}}";
        await AddAuditAsync(threadId, userId, displayName, ExchangeAuditEventType.DocumentShared, documentPayload);
        await _db.SaveChangesAsync(cancellationToken);

        if (messageId is null)
        {
            await _oppositeParty.NotifyAsync(
                thread, homeTenantId, NotificationType.ExchangeDocumentShared,
                "Nouveau document", safeName, "documents", cancellationToken);
        }

        return Result.Success(MapDocument(create.Value));
    }

    public async Task<Result<(Stream Stream, string FileName, string ContentType)>> DownloadDocumentAsync(
        Guid threadId, Guid documentId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string? userRole, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<(Stream, string, string)>(access.Error);

        var doc = await _db.ExchangeDocuments.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == documentId && d.ThreadId == threadId, cancellationToken);
        if (doc is null)
            return Result.Failure<(Stream, string, string)>(Error.Validation("Document", "Document introuvable"));

        var absolute = ResolveContainedPath(doc.StoragePath);
        if (absolute is null || !File.Exists(absolute))
            return Result.Failure<(Stream, string, string)>(Error.Validation("Document", "Fichier introuvable sur le disque"));

        Stream stream = new FileStream(absolute, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Result.Success((stream, doc.FileName, doc.ContentType));
    }

    public async Task<Result> DeleteDocumentAsync(
        Guid threadId, Guid documentId, Guid homeTenantId, TenantKind tenantKind, Guid userId,
        string? userRole, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessibleThreadAsync(threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure(access.Error);

        if (tenantKind == TenantKind.Company && !IsCompanyAdmin(userRole))
            return Result.Failure(Error.Forbidden("Réservé à l'administrateur"));

        var doc = await _db.ExchangeDocuments.FirstOrDefaultAsync(d => d.Id == documentId && d.ThreadId == threadId, cancellationToken);
        if (doc is null)
            return Result.Failure(Error.Validation("Document", "Document introuvable"));

        if (doc.UploadedByUserId != userId && !IsFirmManager(userRole) && !IsCompanyAdmin(userRole))
            return Result.Failure(Error.Forbidden("Suppression non autorisée"));

        var absolute = ResolveContainedPath(doc.StoragePath);
        _db.ExchangeDocuments.Remove(doc);
        await _db.SaveChangesAsync(cancellationToken);
        if (absolute is not null)
            TryDeleteFile(absolute);
        return Result.Success();
    }

    public Task<Result<IReadOnlyList<ExchangeAuditEventDto>>> GetHistoryAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, int page, int pageSize, CancellationToken cancellationToken = default)
        => GetHistoryAsync(_db, threadId, homeTenantId, tenantKind, userId, userRole, firmScope, page, pageSize, cancellationToken);

    private static async Task<Result<IReadOnlyList<ExchangeAuditEventDto>>> GetHistoryAsync(
        MasterDbContext ctx,
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, int page, int pageSize, CancellationToken cancellationToken)
    {
        var access = await ResolveAccessibleThreadAsync(ctx, threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        if (access.IsFailure)
            return Result.Failure<IReadOnlyList<ExchangeAuditEventDto>>(access.Error);

        page = Math.Clamp(page, 1, int.MaxValue / 100);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var rows = await ctx.ExchangeAuditEvents.AsNoTracking()
            .Where(e => e.ThreadId == threadId)
            .OrderByDescending(e => e.OccurredAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return Result.Success<IReadOnlyList<ExchangeAuditEventDto>>(rows.Select(e => new ExchangeAuditEventDto(
            e.Id, e.ThreadId, e.OccurredAt, e.ActorUserId, e.ActorDisplayName, e.EventType, e.PayloadJson)).ToList());
    }

    public async Task<ExchangeUnreadSummaryDto> GetUnreadSummaryAsync(
        Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken = default)
    {
        var threadIds = await GetAccessibleThreadIdsAsync(homeTenantId, tenantKind, firmScope, cancellationToken);
        if (threadIds.Count == 0)
            return new ExchangeUnreadSummaryDto(0, 0, Array.Empty<ExchangeThreadUnreadDto>());

        var openRequests = await _db.ExchangeRequests.AsNoTracking()
            .CountAsync(r => threadIds.Contains(r.ThreadId) &&
                (r.Status == ExchangeRequestStatus.Open || r.Status == ExchangeRequestStatus.InProgress
                 || r.Status == ExchangeRequestStatus.WaitingClient || r.Status == ExchangeRequestStatus.WaitingFirm),
                cancellationToken);

        var unreadByThread = await AggregateUnreadByThreadAsync(
            threadIds, userId, tenantKind == TenantKind.AccountingFirm, cancellationToken);

        var perThread = unreadByThread
            .Select(kv => new ExchangeThreadUnreadDto(kv.Key, kv.Value))
            .ToList();

        return new ExchangeUnreadSummaryDto(perThread.Sum(x => x.UnreadCount), openRequests, perThread);
    }

    public async Task<Result<ExchangeBootstrapDto>> BootstrapAsync(
        Guid homeTenantId, TenantKind tenantKind, Guid userId, string displayName, string? userRole,
        FirmDossierAccessScope? firmScope, Guid? threadId, string? tab,
        CancellationToken cancellationToken = default)
    {
        // FIX CONCURRENCE : le flux bootstrap enchaîne 8+ requêtes SQL séquentielles et
        // co-habite dans le scope de requête avec DataProtection (persistance keyring →
        // MasterDbContext) et les autres services scoped. Une seule sérialisation ratée
        // (ex: warm-up DataProtection au 1er hit) déclenche « A second operation was
        // started on this context instance… ». On isole donc TOUT le bootstrap sur un
        // MasterDbContext dédié, produit par la factory (Singleton) → aucune contention
        // possible avec les autres consommateurs du scope.
        // Les écritures (EnsureThreadAsync) restent sur _db scoped pour préserver la
        // transaction et le change tracker ; leur commit est visible par le contexte
        // isolé grâce à la sémantique READ COMMITTED par défaut de SQL Server.
        var sw = System.Diagnostics.Stopwatch.StartNew();
        await using var isolatedCtx = await _dbFactory.CreateDbContextAsync(cancellationToken);

        Result<ExchangeBootstrapDto> result;
        if (tenantKind == TenantKind.Company)
            result = await BootstrapCompanyAsync(isolatedCtx, homeTenantId, userId, displayName, userRole, threadId, tab, cancellationToken);
        else
            result = await BootstrapFirmAsync(isolatedCtx, homeTenantId, userId, displayName, userRole, firmScope, threadId, tab, cancellationToken);

        sw.Stop();
        _logger.LogInformation(
            "Exchange bootstrap {Kind} completed in {ElapsedMs}ms success={Success}",
            tenantKind, sw.ElapsedMilliseconds, result.IsSuccess);
        return result;
    }

    // --- helpers ---

    private Task<Result<ExchangeThread>> ResolveAccessibleThreadAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
        => ResolveAccessibleThreadAsync(_db, threadId, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);

    private static async Task<Result<ExchangeThread>> ResolveAccessibleThreadAsync(
        MasterDbContext ctx,
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        var thread = await ctx.ExchangeThreads.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == threadId, cancellationToken);
        if (thread is null)
            return Result.Failure<ExchangeThread>(Error.Validation("Thread", "Échange introuvable"));

        return await EnsureAccessAsync(ctx, thread, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
    }

    private async Task<Result<ExchangeThread>> ResolveAccessibleThreadTrackedAsync(
        Guid threadId, Guid homeTenantId, TenantKind tenantKind, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        // Version « tracked » : utilisée uniquement pour les WRITES (SendMessage, Close/Reopen,
        // Create/ChangeRequest, Task*, UploadDocument) — elle DOIT rester sur _db scoped pour
        // que la transaction et les Change Tracker restent cohérents avec les autres écritures
        // du même scope de requête. Bootstrap = lecture pure → n'entre jamais ici.
        var thread = await _db.ExchangeThreads.FirstOrDefaultAsync(t => t.Id == threadId, cancellationToken);
        if (thread is null)
            return Result.Failure<ExchangeThread>(Error.Validation("Thread", "Échange introuvable"));

        var access = await EnsureAccessAsync(_db, thread, homeTenantId, tenantKind, userRole, firmScope, cancellationToken);
        return access.IsFailure ? Result.Failure<ExchangeThread>(access.Error) : Result.Success(thread);
    }

    private static async Task<Result<ExchangeThread>> EnsureAccessAsync(
        MasterDbContext ctx,
        ExchangeThread thread, Guid homeTenantId, TenantKind tenantKind, string? userRole,
        FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        var assignmentActive = await ctx.FirmClientAssignments.AsNoTracking()
            .AnyAsync(a => a.Id == thread.FirmClientAssignmentId && a.Status == FirmAssignmentStatus.Active, cancellationToken);
        if (!assignmentActive)
            return Result.Failure<ExchangeThread>(Error.Forbidden(FirmDossierAccessService.InactiveAssignmentMessage));

        if (tenantKind == TenantKind.Company)
        {
            if (thread.CompanyTenantId != homeTenantId)
                return Result.Failure<ExchangeThread>(Error.Forbidden("Accès refusé"));
            if (!IsCompanyAdmin(userRole))
                return Result.Failure<ExchangeThread>(Error.Forbidden("Réservé à l'administrateur"));
            return Result.Success(thread);
        }

        if (thread.FirmTenantId != homeTenantId)
            return Result.Failure<ExchangeThread>(Error.Forbidden("Accès refusé"));

        if (firmScope is { } scope &&
            !await FirmDossierAccessService.CanAccessAssignmentAsync(ctx, homeTenantId, scope, thread.FirmClientAssignmentId, cancellationToken))
            return Result.Failure<ExchangeThread>(Error.Forbidden(FirmDossierAccessService.NotAssignedMessage));

        return Result.Success(thread);
    }

    private Task<ExchangeThreadDetailDto> MapDetailAsync(ExchangeThread thread, CancellationToken cancellationToken)
        => MapDetailAsync(_db, thread, cancellationToken);

    private static async Task<ExchangeThreadDetailDto> MapDetailAsync(
        MasterDbContext ctx, ExchangeThread thread, CancellationToken cancellationToken)
    {
        var names = await GetTenantNamesAsync(ctx, new[] { thread.CompanyTenantId, thread.FirmTenantId }, cancellationToken);
        var firmProfile = await ctx.AccountingFirmProfiles.AsNoTracking()
            .Where(p => p.TenantId == thread.FirmTenantId)
            .Select(p => p.DisplayName)
            .FirstOrDefaultAsync(cancellationToken);

        // On requête directement ctx.Users (MasterDbContext hérite d'IdentityDbContext) au lieu
        // de _userManager.Users, sinon on retomberait sur le DbContext scoped d'Identity — même
        // instance que _db, ré-ouvrant la fenêtre de concurrence qu'on cherche à fermer.
        var companyUsers = await ctx.Users.AsNoTracking()
            .Where(u => u.TenantId == thread.CompanyTenantId && u.IsActive)
            .OrderBy(u => u.LastName)
            .Take(20)
            .ToListAsync(cancellationToken);
        var firmUsers = await ctx.Users.AsNoTracking()
            .Where(u => u.TenantId == thread.FirmTenantId && u.IsActive)
            .OrderBy(u => u.LastName)
            .Take(20)
            .ToListAsync(cancellationToken);

        var allUsers = companyUsers.Concat(firmUsers).ToList();
        var rolesByUser = await GetRolesByUserIdsAsync(ctx, allUsers.Select(u => u.Id).ToList(), cancellationToken);

        var participants = new List<ExchangeParticipantDto>();
        foreach (var u in companyUsers)
        {
            if (!rolesByUser.TryGetValue(u.Id, out var roles) || !roles.Contains(nameof(UserRole.Administrator)))
                continue;
            participants.Add(new ExchangeParticipantDto(u.Id, $"{u.FirstName} {u.LastName}".Trim(),
                nameof(UserRole.Administrator), "company", false));
        }
        foreach (var u in firmUsers)
        {
            if (!rolesByUser.TryGetValue(u.Id, out var roles))
                continue;
            var role = roles.FirstOrDefault(r => r is nameof(UserRole.FirmManager) or nameof(UserRole.FirmAccountant));
            if (role is null) continue;
            participants.Add(new ExchangeParticipantDto(u.Id, $"{u.FirstName} {u.LastName}".Trim(), role, "firm", false));
        }

        return new ExchangeThreadDetailDto(
            thread.Id, thread.FirmClientAssignmentId, thread.FirmTenantId, thread.CompanyTenantId,
            names.GetValueOrDefault(thread.CompanyTenantId, "Société"),
            firmProfile ?? names.GetValueOrDefault(thread.FirmTenantId, "Cabinet"),
            thread.Status, thread.Subject, thread.CreatedAt, thread.LastActivityAt, thread.ClosedAt, thread.ClosedByUserId,
            participants);
    }

    private Task<IReadOnlyList<ExchangeMessageDto>> MapMessagesAsync(
        IReadOnlyList<ExchangeMessage> messages, CancellationToken cancellationToken)
        => MapMessagesAsync(_db, messages, cancellationToken);

    private static async Task<IReadOnlyList<ExchangeMessageDto>> MapMessagesAsync(
        MasterDbContext ctx, IReadOnlyList<ExchangeMessage> messages, CancellationToken cancellationToken)
    {
        if (messages.Count == 0)
            return Array.Empty<ExchangeMessageDto>();

        var ids = messages.Select(m => m.Id).ToList();
        var reads = await ctx.ExchangeMessageReads.AsNoTracking()
            .Where(r => ids.Contains(r.MessageId))
            .ToListAsync(cancellationToken);
        var docs = await ctx.ExchangeDocuments.AsNoTracking()
            .Where(d => d.MessageId != null && ids.Contains(d.MessageId.Value))
            .ToListAsync(cancellationToken);

        var readerIds = reads.Select(r => r.UserId).Distinct().ToList();
        var readerNames = readerIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await ctx.Users.AsNoTracking()
                .Where(u => readerIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, u => $"{u.FirstName} {u.LastName}".Trim(), cancellationToken);

        var readsByMessage = reads.ToLookup(r => r.MessageId);
        var docsByMessage = docs.ToLookup(d => d.MessageId!.Value);

        return messages.Select(m => new ExchangeMessageDto(
            m.Id, m.ThreadId, m.AuthorUserId, m.AuthorTenantId, m.AuthorDisplayName, m.Visibility, m.Body, m.SentAt,
            readsByMessage[m.Id]
                .Select(r => new ExchangeMessageReadDto(r.UserId, readerNames.GetValueOrDefault(r.UserId), r.ReadAt))
                .ToList(),
            docsByMessage[m.Id].Select(MapDocument).ToList()
        )).ToList();
    }

    private Task<Dictionary<Guid, int>> AggregateUnreadByThreadAsync(
        IReadOnlyList<Guid> threadIds, Guid userId, bool isFirm, CancellationToken cancellationToken)
        => AggregateUnreadByThreadAsync(_db, threadIds, userId, isFirm, cancellationToken);

    private static async Task<Dictionary<Guid, int>> AggregateUnreadByThreadAsync(
        MasterDbContext ctx, IReadOnlyList<Guid> threadIds, Guid userId, bool isFirm, CancellationToken cancellationToken)
    {
        if (threadIds.Count == 0)
            return new Dictionary<Guid, int>();

        // LEFT JOIN anti-join (r IS NULL) plutôt qu'une sous-requête corrélée NOT EXISTS
        // par ligne message — meilleur plan d'exécution avec l'index (UserId, MessageId).
        var rows = await (
            from m in ctx.ExchangeMessages.AsNoTracking()
            where threadIds.Contains(m.ThreadId) && m.AuthorUserId != userId
            where isFirm || m.Visibility == ExchangeMessageVisibility.ClientVisible
            join r in ctx.ExchangeMessageReads.AsNoTracking().Where(x => x.UserId == userId)
                on m.Id equals r.MessageId into reads
            from r in reads.DefaultIfEmpty()
            where r == null
            group m by m.ThreadId into g
            select new { ThreadId = g.Key, Count = g.Count() }
        ).ToListAsync(cancellationToken);

        return rows.ToDictionary(x => x.ThreadId, x => x.Count);
    }

    private Task<IReadOnlyList<Guid>> GetAccessibleThreadIdsAsync(
        Guid homeTenantId, TenantKind tenantKind, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
        => GetAccessibleThreadIdsAsync(_db, homeTenantId, tenantKind, firmScope, cancellationToken);

    private static async Task<IReadOnlyList<Guid>> GetAccessibleThreadIdsAsync(
        MasterDbContext ctx,
        Guid homeTenantId, TenantKind tenantKind, FirmDossierAccessScope? firmScope, CancellationToken cancellationToken)
    {
        var query = ctx.ExchangeThreads.AsNoTracking()
            .Join(ctx.FirmClientAssignments.AsNoTracking(),
                t => t.FirmClientAssignmentId,
                a => a.Id,
                (t, a) => new { Thread = t, Assignment = a })
            .Where(x => x.Assignment.Status == FirmAssignmentStatus.Active);

        if (tenantKind == TenantKind.AccountingFirm)
        {
            query = query.Where(x => x.Thread.FirmTenantId == homeTenantId);
            if (firmScope is { } scope)
            {
                var accessible = await FirmDossierAccessService.GetAccessibleCompanyTenantIdsAsync(
                    ctx, homeTenantId, scope, cancellationToken);
                if (accessible is not null)
                    query = query.Where(x => accessible.Contains(x.Thread.CompanyTenantId));
            }
        }
        else
        {
            query = query.Where(x => x.Thread.CompanyTenantId == homeTenantId);
        }

        return await query.Select(x => x.Thread.Id).ToListAsync(cancellationToken);
    }

    private Task<Dictionary<Guid, List<string>>> GetRolesByUserIdsAsync(
        IReadOnlyList<Guid> userIds, CancellationToken cancellationToken)
        => GetRolesByUserIdsAsync(_db, userIds, cancellationToken);

    private static async Task<Dictionary<Guid, List<string>>> GetRolesByUserIdsAsync(
        MasterDbContext ctx, IReadOnlyList<Guid> userIds, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
            return new Dictionary<Guid, List<string>>();

        var rows = await (
            from ur in ctx.Set<IdentityUserRole<Guid>>().AsNoTracking()
            join r in ctx.Roles.AsNoTracking() on ur.RoleId equals r.Id
            where userIds.Contains(ur.UserId)
            select new { ur.UserId, r.Name }
        ).ToListAsync(cancellationToken);

        return rows
            .GroupBy(x => x.UserId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Name ?? string.Empty).Where(n => n.Length > 0).ToList());
    }

    private async Task<Result<ExchangeBootstrapDto>> BootstrapCompanyAsync(
        MasterDbContext isolatedCtx,
        Guid homeTenantId, Guid userId, string displayName, string? userRole,
        Guid? threadId, string? tab, CancellationToken cancellationToken)
    {
        if (!IsCompanyAdmin(userRole))
            return Result.Failure<ExchangeBootstrapDto>(Error.Forbidden("Réservé à l'administrateur"));

        // Passe le contexte isolé à la surcharge interne du service pour éviter tout
        // partage avec le scope de requête (voir doc BootstrapAsync).
        var assignment = await _assignments.GetCompanyCurrentAssignmentAsync(isolatedCtx, homeTenantId, cancellationToken);
        if (assignment is null)
        {
            return Result.Success(new ExchangeBootstrapDto(
                null, null, null, null, null, null, null, null, null, 0, 0,
                "Liez un cabinet comptable dans Paramètres → Cabinet comptable pour ouvrir les échanges."));
        }

        if (assignment.Status == FirmAssignmentStatus.PendingFirmApproval)
        {
            return Result.Success(new ExchangeBootstrapDto(
                null, assignment, null, null, null, null, null, null, null, 0, 0,
                "Votre demande de liaison est en attente d’acceptation par le cabinet."));
        }

        if (assignment.Status != FirmAssignmentStatus.Active)
        {
            return Result.Success(new ExchangeBootstrapDto(
                null, assignment, null, null, null, null, null, null, null, 0, 0,
                "Liez un cabinet comptable dans Paramètres → Cabinet comptable pour ouvrir les échanges."));
        }

        // Fast-path (99 % des cold loads société) : le thread existe déjà → lecture seule
        // sur isolatedCtx, sans EnsureThreadAsync / SaveChangesAsync.
        // Fallback écriture : premier accès uniquement (EnsureThread sur _db scoped).
        ExchangeThreadDetailDto active;
        var existingThread = await isolatedCtx.ExchangeThreads.AsNoTracking()
            .FirstOrDefaultAsync(t => t.FirmClientAssignmentId == assignment.Id, cancellationToken);

        if (existingThread is not null)
        {
            active = await MapDetailAsync(isolatedCtx, existingThread, cancellationToken);
        }
        else
        {
            // EnsureThreadAsync est une écriture : elle continue sur _db scoped, seule à
            // participer à la transaction et au change tracker de la requête. SaveChangesAsync
            // interne rend le thread visible pour le contexte isolé sur les lectures suivantes.
            var ensure = await EnsureThreadAsync(
                homeTenantId, TenantKind.Company, userId, displayName, userRole, null, null, cancellationToken);
            if (ensure.IsFailure)
                return Result.Failure<ExchangeBootstrapDto>(ensure.Error);
            active = ensure.Value;
        }

        var resolvedThreadId = threadId is { } tid && tid != Guid.Empty && tid == active.Id ? tid : active.Id;
        return await BuildBootstrapPayloadAsync(
            isolatedCtx,
            homeTenantId, TenantKind.Company, userId, userRole, null,
            threads: null, companyAssignment: assignment, firmClients: null,
            active, resolvedThreadId, tab, cancellationToken);
    }

    private async Task<Result<ExchangeBootstrapDto>> BootstrapFirmAsync(
        MasterDbContext isolatedCtx,
        Guid homeTenantId, Guid userId, string displayName, string? userRole,
        FirmDossierAccessScope? firmScope, Guid? threadId, string? tab, CancellationToken cancellationToken)
    {
        // Toutes les lectures utilisent isolatedCtx (contexte dédié) — aucun risque de
        // « second operation on same instance » avec DataProtection / autres services scoped.
        // Les appels séquentiels sur le même contexte isolé restent sûrs (pas de parallélisme).
        var threads = await ListThreadsAsync(
            isolatedCtx, homeTenantId, TenantKind.AccountingFirm, firmScope, userId, cancellationToken);
        var clients = await _assignments.GetActiveClientsAsync(isolatedCtx, homeTenantId, cancellationToken);

        if (clients.Count == 0 && threads.Count == 0)
        {
            return Result.Success(new ExchangeBootstrapDto(
                threads, null, clients, null, null, null, null, null, null, 0, 0,
                "Aucun dossier client actif pour démarrer un échange."));
        }

        ExchangeThreadDetailDto? active = null;
        Guid? resolvedThreadId = threadId is { } tid && tid != Guid.Empty ? tid : null;

        if (resolvedThreadId is null)
        {
            var firstWithThread = threads.OrderByDescending(t => t.LastActivityAt ?? DateTime.MinValue).FirstOrDefault();
            if (firstWithThread is not null)
            {
                resolvedThreadId = firstWithThread.Id;
            }
            else if (clients.Count > 0)
            {
                // Écriture : voir doc BootstrapCompanyAsync — reste sur _db.
                var ensure = await EnsureThreadAsync(
                    homeTenantId, TenantKind.AccountingFirm, userId, displayName, userRole, firmScope,
                    clients[0].AssignmentId, cancellationToken);
                if (ensure.IsFailure)
                    return Result.Failure<ExchangeBootstrapDto>(ensure.Error);
                active = ensure.Value;
                resolvedThreadId = active.Id;
                // Re-lecture sur le contexte isolé : le SaveChangesAsync d'EnsureThreadAsync
                // a validé la transaction, le nouveau thread est visible.
                threads = await ListThreadsAsync(
                    isolatedCtx, homeTenantId, TenantKind.AccountingFirm, firmScope, userId, cancellationToken);
            }
        }

        if (resolvedThreadId is { } rt && active is null)
        {
            var get = await GetThreadAsync(
                isolatedCtx, rt, homeTenantId, TenantKind.AccountingFirm, userId, userRole, firmScope, cancellationToken);
            if (get.IsFailure)
                return Result.Failure<ExchangeBootstrapDto>(get.Error);
            active = get.Value;
        }

        return await BuildBootstrapPayloadAsync(
            isolatedCtx,
            homeTenantId, TenantKind.AccountingFirm, userId, userRole, firmScope,
            threads, null, clients, active, resolvedThreadId, tab, cancellationToken);
    }

    private static async Task<Result<ExchangeBootstrapDto>> BuildBootstrapPayloadAsync(
        MasterDbContext isolatedCtx,
        Guid homeTenantId, TenantKind tenantKind, Guid userId, string? userRole,
        FirmDossierAccessScope? firmScope,
        IReadOnlyList<ExchangeThreadListItemDto>? threads,
        FirmClientAssignmentDto? companyAssignment,
        IReadOnlyList<FirmClientDossierDto>? firmClients,
        ExchangeThreadDetailDto? active,
        Guid? resolvedThreadId,
        string? tab,
        CancellationToken cancellationToken)
    {
        PagedExchangeMessagesDto? messages = null;
        IReadOnlyList<ExchangeRequestDto>? requests = null;
        IReadOnlyList<ExchangeTaskDto>? tasks = null;
        IReadOnlyList<ExchangeDocumentDto>? documents = null;
        IReadOnlyList<ExchangeAuditEventDto>? history = null;
        var openRequests = 0;
        var unread = 0;

        if (resolvedThreadId is { } tid && active is not null)
        {
            var messagesResult = await GetMessagesAsync(
                isolatedCtx, tid, homeTenantId, tenantKind, userId, userRole, firmScope,
                after: null, before: null, limit: DefaultMessagePageSize, cancellationToken);
            if (messagesResult.IsSuccess)
                messages = messagesResult.Value;

            var normalizedTab = (tab ?? "conversation").Trim().ToLowerInvariant();
            if (normalizedTab is "demandes" or "requests")
            {
                var r = await ListRequestsAsync(isolatedCtx, tid, homeTenantId, tenantKind, userId, userRole, firmScope, cancellationToken);
                if (r.IsSuccess) requests = r.Value;
            }
            else if (normalizedTab is "taches" or "tasks")
            {
                var r = await ListTasksAsync(isolatedCtx, tid, homeTenantId, tenantKind, userId, userRole, firmScope, cancellationToken);
                if (r.IsSuccess) tasks = r.Value;
            }
            else if (normalizedTab == "documents")
            {
                var r = await ListDocumentsAsync(isolatedCtx, tid, homeTenantId, tenantKind, userId, userRole, firmScope, cancellationToken);
                if (r.IsSuccess) documents = r.Value;
            }
            else if (normalizedTab is "historique" or "history")
            {
                var r = await GetHistoryAsync(isolatedCtx, tid, homeTenantId, tenantKind, userId, userRole, firmScope, 1, 50, cancellationToken);
                if (r.IsSuccess) history = r.Value;
            }

            openRequests = await isolatedCtx.ExchangeRequests.AsNoTracking()
                .CountAsync(r => r.ThreadId == tid &&
                    (r.Status == ExchangeRequestStatus.Open || r.Status == ExchangeRequestStatus.InProgress
                     || r.Status == ExchangeRequestStatus.WaitingClient || r.Status == ExchangeRequestStatus.WaitingFirm),
                    cancellationToken);

            if (threads is not null)
                unread = threads.Sum(t => t.UnreadCount);
            else
            {
                var unreadMap = await AggregateUnreadByThreadAsync(
                    isolatedCtx, new[] { tid }, userId, tenantKind == TenantKind.AccountingFirm, cancellationToken);
                unread = unreadMap.GetValueOrDefault(tid, 0);
            }
        }

        return Result.Success(new ExchangeBootstrapDto(
            threads, companyAssignment, firmClients, active, messages,
            requests, tasks, documents, history, openRequests, unread, null));
    }

    private static ExchangeRequestDto MapRequest(ExchangeRequest r) => new(
        r.Id, r.ThreadId, r.Number, r.Title, r.Description, r.Category, r.Priority, r.Status,
        r.CreatedByUserId, r.CreatedByTenantId, r.AssigneeUserId, r.CreatedAt, r.ResolvedAt, r.ClosedAt);

    private static ExchangeRequestCommentDto MapComment(ExchangeRequestComment c) => new(
        c.Id, c.ThreadId, c.RequestId, c.AuthorUserId, c.AuthorTenantId, c.AuthorDisplayName, c.Body, c.CreatedAt);

    private static ExchangeTaskDto MapTask(ExchangeTask t) => new(
        t.Id, t.ThreadId, t.Title, t.Description, t.DueDate, t.AssigneeUserId, t.AssigneeTenantId,
        t.Status, t.CreatedByUserId, t.CreatedAt, t.CompletedAt);

    private static ExchangeDocumentDto MapDocument(ExchangeDocument d) => new(
        d.Id, d.ThreadId, d.MessageId, d.RequestId, d.TaskId, d.FileName, d.ContentType, d.SizeBytes,
        d.UploadedByUserId, d.UploadedAt);

    // Sans aucun await : la signature async déclenchait CS1998 (bloquant avec TreatWarningsAsErrors).
    // Retour Task.CompletedTask = comportement strictement identique (corps déjà synchrone).
    private Task AddAuditAsync(Guid threadId, Guid actorUserId, string displayName,
        ExchangeAuditEventType type, string? payload)
    {
        var audit = ExchangeAuditEvent.Create(threadId, actorUserId, displayName, type, payload);
        if (audit.IsSuccess)
            _db.ExchangeAuditEvents.Add(audit.Value);
        return Task.CompletedTask;
    }

    private Task<Dictionary<Guid, string>> GetTenantNamesAsync(IReadOnlyList<Guid> ids, CancellationToken cancellationToken)
        => GetTenantNamesAsync(_db, ids, cancellationToken);

    private static async Task<Dictionary<Guid, string>> GetTenantNamesAsync(
        MasterDbContext ctx, IReadOnlyList<Guid> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();
        return await ctx.Tenants.AsNoTracking()
            .Where(t => ids.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.CompanyName, cancellationToken);
    }

    private async Task TryNotifyAsync(
        Guid recipientTenantId, string? recipientRole, NotificationType type,
        string title, string body, string? linkUrl)
    {
        try
        {
            await _notifications.CreateAsync(recipientTenantId, recipientRole, type, title, body, linkUrl);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Échec notification exchange {Type}", type);
        }
    }

    private async Task TryNotifyUserAsync(
        Guid recipientTenantId, Guid recipientUserId, NotificationType type,
        string title, string body, string? linkUrl)
    {
        try
        {
            await _notifications.CreateAsync(
                recipientTenantId, null, type, title, body, linkUrl, recipientUserId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Échec notification exchange {Type}", type);
        }
    }

    private static string BuildLink(bool forCompany, Guid threadId, string? tab = null)
    {
        var path = forCompany ? $"/exchanges/{threadId}" : $"/firm/exchanges/{threadId}";
        return string.IsNullOrWhiteSpace(tab) ? path : $"{path}?tab={tab.Trim()}";
    }

    private static bool IsCompanyAdmin(string? role) =>
        string.Equals(role, nameof(UserRole.Administrator), StringComparison.OrdinalIgnoreCase);

    private static bool IsFirmManager(string? role) =>
        string.Equals(role, nameof(UserRole.FirmManager), StringComparison.OrdinalIgnoreCase);

    private string ResolveBasePath()
    {
        var basePath = _options.BasePath;
        return Path.IsPathRooted(basePath) ? basePath : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, basePath));
    }

    private string? ResolveContainedPath(string relativePath)
    {
        var root = ResolveBasePath();
        var combined = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!combined.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            return null;
        return combined;
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* best effort */ }
    }

    private static string Truncate(string? value, int max) =>
        string.IsNullOrEmpty(value) ? string.Empty : value.Length <= max ? value : value[..max];
}
