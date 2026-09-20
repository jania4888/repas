using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

public sealed class NotificationService : INotificationService
{
    private readonly MasterDbContext _masterContext;

    public NotificationService(MasterDbContext masterContext)
    {
        _masterContext = masterContext;
    }

    public Task<Result> CreateAsync(
        Guid recipientTenantId,
        string? recipientRole,
        NotificationType type,
        string title,
        string body,
        string? linkUrl = null,
        CancellationToken cancellationToken = default)
        => CreateAsync(recipientTenantId, recipientRole, type, title, body, linkUrl, recipientUserId: null, cancellationToken);

    public async Task<Result> CreateAsync(
        Guid recipientTenantId,
        string? recipientRole,
        NotificationType type,
        string title,
        string body,
        string? linkUrl,
        Guid? recipientUserId,
        CancellationToken cancellationToken)
    {
        var createResult = UserNotification.Create(
            recipientTenantId, recipientRole, type, title, body, linkUrl, recipientUserId);
        if (createResult.IsFailure)
            return Result.Failure(createResult.Error);

        _masterContext.UserNotifications.Add(createResult.Value);
        await _masterContext.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<NotificationListDto> GetListAsync(
        Guid tenantId, string? role, bool unreadOnly, int page, int pageSize,
        Guid? currentUserId = null,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / 50);
        pageSize = Math.Clamp(pageSize, 1, 50);

        var query = VisibleTo(_masterContext.UserNotifications.AsNoTracking(), tenantId, role, currentUserId);
        if (unreadOnly)
            query = query.Where(n => n.ReadAt == null);

        var totalCount = await query.CountAsync(cancellationToken);
        var unreadCount = await VisibleTo(_masterContext.UserNotifications.AsNoTracking(), tenantId, role, currentUserId)
            .CountAsync(n => n.ReadAt == null, cancellationToken);

        var items = await query
            .OrderByDescending(n => n.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(n => new NotificationDto
            {
                Id = n.Id,
                Type = n.Type,
                Title = n.Title,
                Body = n.Body,
                LinkUrl = n.LinkUrl,
                CreatedAt = n.CreatedAt,
                ReadAt = n.ReadAt
            })
            .ToListAsync(cancellationToken);

        return new NotificationListDto
        {
            Items = items,
            TotalCount = totalCount,
            UnreadCount = unreadCount,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<int> GetUnreadCountAsync(
        Guid tenantId, string? role, Guid? currentUserId = null,
        CancellationToken cancellationToken = default)
    {
        return await VisibleTo(_masterContext.UserNotifications.AsNoTracking(), tenantId, role, currentUserId)
            .CountAsync(n => n.ReadAt == null, cancellationToken);
    }

    public async Task<Result> MarkReadAsync(
        Guid tenantId, string? role, Guid notificationId, Guid? currentUserId = null,
        CancellationToken cancellationToken = default)
    {
        var notification = await VisibleTo(_masterContext.UserNotifications, tenantId, role, currentUserId)
            .FirstOrDefaultAsync(n => n.Id == notificationId, cancellationToken);

        if (notification is null)
            return Result.Failure(Error.NotFound("Notification", notificationId));

        notification.MarkRead();
        await _masterContext.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> MarkAllReadAsync(
        Guid tenantId, string? role, Guid? currentUserId = null,
        CancellationToken cancellationToken = default)
    {
        var unread = await VisibleTo(_masterContext.UserNotifications, tenantId, role, currentUserId)
            .Where(n => n.ReadAt == null)
            .ToListAsync(cancellationToken);

        foreach (var notification in unread)
            notification.MarkRead();

        if (unread.Count > 0)
            await _masterContext.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }

    private static IQueryable<UserNotification> VisibleTo(
        IQueryable<UserNotification> source, Guid tenantId, string? role, Guid? currentUserId) =>
        source.Where(n => n.RecipientTenantId == tenantId && (
            (n.RecipientUserId != null && currentUserId != null && n.RecipientUserId == currentUserId)
            || (n.RecipientUserId == null && (n.RecipientRole == null || n.RecipientRole == role))));
}
