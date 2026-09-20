using System.Security.Cryptography;
using System.Text;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>Lot B4 — Implémentation EF Core du service de sessions actives.</summary>
public sealed class UserSessionService : IUserSessionService
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _db;

    public UserSessionService(MasterDbContext db)
    {
        _db = db;
    }

    public async Task RecordAsync(
        Guid userId,
        Guid jwtId,
        string? refreshToken,
        string ipAddress,
        string? userAgent,
        DateTime expiresAt,
        Guid? tenantId,
        CancellationToken cancellationToken = default)
    {
        var session = UserSession.Create(
            userId,
            jwtId,
            refreshToken is null ? null : HashRefreshToken(refreshToken),
            ipAddress,
            Truncate(userAgent, 500),
            expiresAt,
            tenantId);

        _db.UserSessions.Add(session);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<UserSessionsPageDto> ListByUserAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.UserSessions.AsNoTracking().Where(s => s.UserId == userId);
        return await BuildPageAsync(query, page, pageSize, cancellationToken);
    }

    public async Task<UserSessionsPageDto> ListPlatformSessionsAsync(
        bool? activeOnly,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.UserSessions.AsNoTracking()
            .Where(s => s.TenantId == null || s.TenantId == Guid.Empty);
        if (activeOnly == true)
        {
            var nowUtc = DateTime.UtcNow;
            query = query.Where(s => s.RevokedAt == null && s.ExpiresAt > nowUtc);
        }
        else if (activeOnly == false)
        {
            var nowUtc = DateTime.UtcNow;
            query = query.Where(s => s.RevokedAt != null || s.ExpiresAt <= nowUtc);
        }
        return await BuildPageAsync(query, page, pageSize, cancellationToken);
    }

    public async Task<bool> RevokeAsync(
        Guid sessionId,
        Guid actorUserId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        var session = await _db.UserSessions.FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        if (session is null) return false;

        session.Revoke(actorUserId, Truncate(reason, 300) ?? "ManualRevoke");
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<int> RevokeAllByUserAsync(
        Guid userId,
        Guid actorUserId,
        string reason,
        CancellationToken cancellationToken = default)
    {
        var nowUtc = DateTime.UtcNow;
        var sessions = await _db.UserSessions
            .Where(s => s.UserId == userId && s.RevokedAt == null && s.ExpiresAt > nowUtc)
            .ToListAsync(cancellationToken);

        foreach (var session in sessions)
        {
            session.Revoke(actorUserId, Truncate(reason, 300) ?? "AdminRevokeAll");
        }

        await _db.SaveChangesAsync(cancellationToken);
        return sessions.Count;
    }

    private async Task<UserSessionsPageDto> BuildPageAsync(
        IQueryable<UserSession> filtered,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var totalCount = await filtered.CountAsync(cancellationToken);

        var nowUtc = DateTime.UtcNow;
        var activeCount = await filtered.CountAsync(s => s.RevokedAt == null && s.ExpiresAt > nowUtc, cancellationToken);
        var revokedCount = totalCount - activeCount;

        var pageRows = await filtered
            .OrderByDescending(s => s.IssuedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        // Charge les emails utilisateurs en bulk pour éviter N+1
        var userIds = pageRows.Select(s => s.UserId).Distinct().ToList();
        var userEmails = await _db.Users
            .AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Email ?? "", cancellationToken);

        var tenantIds = pageRows
            .Where(s => s.TenantId.HasValue && s.TenantId != Guid.Empty)
            .Select(s => s.TenantId!.Value)
            .Distinct()
            .ToList();

        var tenantNames = tenantIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.Tenants
                .AsNoTracking()
                .Where(t => tenantIds.Contains(t.Id))
                .ToDictionaryAsync(t => t.Id, t => t.CompanyName, cancellationToken);

        var items = pageRows.Select(s => new UserSessionDto
        {
            Id = s.Id,
            UserId = s.UserId,
            UserEmail = userEmails.TryGetValue(s.UserId, out var email) ? email : "",
            TenantId = s.TenantId,
            TenantName = s.TenantId.HasValue && tenantNames.TryGetValue(s.TenantId.Value, out var tn) ? tn : null,
            IpAddress = s.IpAddress,
            UserAgent = s.UserAgent,
            IssuedAt = s.IssuedAt,
            LastUsedAt = s.LastUsedAt,
            ExpiresAt = s.ExpiresAt,
            RevokedAt = s.RevokedAt,
            RevocationReason = s.RevocationReason,
            IsActive = s.RevokedAt is null && s.ExpiresAt > nowUtc
        }).ToList();

        return new UserSessionsPageDto
        {
            Items = items,
            TotalCount = totalCount,
            ActiveCount = activeCount,
            RevokedCount = revokedCount
        };
    }

    private static string HashRefreshToken(string refreshToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken));
        return Convert.ToHexString(bytes);
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrEmpty(value)) return value;
        return value.Length <= maxLength ? value : value[..maxLength];
    }
}
