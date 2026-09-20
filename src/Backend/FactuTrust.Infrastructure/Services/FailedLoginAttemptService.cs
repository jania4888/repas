using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>Lot B4 — Implémentation EF Core du service de tentatives de login échouées.</summary>
public sealed class FailedLoginAttemptService : IFailedLoginAttemptService
{
    private const int MaxPageSize = 200;
    private const int BruteForceThreshold = 10;

    private readonly MasterDbContext _db;

    public FailedLoginAttemptService(MasterDbContext db)
    {
        _db = db;
    }

    public async Task RecordAsync(
        string email,
        Guid? userId,
        string ipAddress,
        string? userAgent,
        FailedLoginReason reason,
        Guid? tenantId,
        CancellationToken cancellationToken = default)
    {
        var entry = FailedLoginAttempt.Record(
            email,
            userId,
            ipAddress,
            Truncate(userAgent, 500),
            reason,
            tenantId);
        _db.FailedLoginAttempts.Add(entry);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<FailedLoginAttemptsPageDto> ListAsync(
        string? email,
        string? ipAddress,
        DateTime? from,
        DateTime? to,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.FailedLoginAttempts.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(email))
        {
            var pattern = email.Trim().ToLowerInvariant();
            query = query.Where(a => a.Email.Contains(pattern));
        }
        if (!string.IsNullOrWhiteSpace(ipAddress))
        {
            var pattern = ipAddress.Trim();
            query = query.Where(a => a.IpAddress.Contains(pattern));
        }
        if (from.HasValue)
        {
            var fromValue = from.Value;
            query = query.Where(a => a.AttemptAt >= fromValue);
        }
        if (to.HasValue)
        {
            var toValue = to.Value;
            query = query.Where(a => a.AttemptAt <= toValue);
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var nowUtc = DateTime.UtcNow;
        var last24hCutoff = nowUtc.AddHours(-24);
        var lastHourCutoff = nowUtc.AddHours(-1);

        var last24h = await _db.FailedLoginAttempts
            .CountAsync(a => a.AttemptAt >= last24hCutoff, cancellationToken);
        var lastHour = await _db.FailedLoginAttempts
            .CountAsync(a => a.AttemptAt >= lastHourCutoff, cancellationToken);

        var topIpsRaw = await _db.FailedLoginAttempts.AsNoTracking()
            .Where(a => a.AttemptAt >= lastHourCutoff)
            .GroupBy(a => a.IpAddress)
            .Select(g => new
            {
                IpAddress = g.Key,
                Count = g.Count(),
                LastSeen = g.Max(a => a.AttemptAt)
            })
            .Where(g => g.Count >= BruteForceThreshold)
            .OrderByDescending(g => g.Count)
            .Take(5)
            .ToListAsync(cancellationToken);

        var topIps = topIpsRaw.Select(x => new TopIpDto
        {
            IpAddress = x.IpAddress,
            Count = x.Count,
            LastSeen = x.LastSeen
        }).ToList();

        var rows = await query
            .OrderByDescending(a => a.AttemptAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var items = rows.Select(a => new FailedLoginAttemptDto
        {
            Id = a.Id,
            Email = a.Email,
            UserId = a.UserId,
            IpAddress = a.IpAddress,
            UserAgent = a.UserAgent,
            AttemptAt = a.AttemptAt,
            Reason = a.Reason,
            ReasonDisplay = a.Reason.ToDisplayString(),
            TenantId = a.TenantId
        }).ToList();

        return new FailedLoginAttemptsPageDto
        {
            Items = items,
            TotalCount = totalCount,
            Last24h = last24h,
            LastHour = lastHour,
            TopSuspiciousIps = topIps
        };
    }

    public async Task<int> CountByIpInLastHourAsync(string ipAddress, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(ipAddress)) return 0;
        var lastHourCutoff = DateTime.UtcNow.AddHours(-1);
        return await _db.FailedLoginAttempts
            .CountAsync(a => a.IpAddress == ipAddress && a.AttemptAt >= lastHourCutoff, cancellationToken);
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrEmpty(value)) return value;
        return value.Length <= maxLength ? value : value[..maxLength];
    }
}
