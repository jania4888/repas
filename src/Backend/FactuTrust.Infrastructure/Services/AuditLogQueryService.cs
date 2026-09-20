using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

public sealed class AuditLogQueryService : IAuditLogQueryService
{
    /// <summary>Taille de page maximale de l'historique d'une entité (4.7h2 ; clamp 1..100, défaut 20).</summary>
    private const int EntityHistoryMaxPageSize = 100;

    private const int MaxPageSize = 200;
    private const int DefaultPageSize = 25;

    private readonly ITenantDbContextFactory _contextFactory;

    public AuditLogQueryService(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Result<PagedResult<AuditLogEntryDto>>> GetLogsAsync(
        DateTime? from,
        DateTime? to,
        string? action,
        Guid? userId,
        string? entityType,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        // 4.7 suite (R52, D-47-75) : même borne haute que GetEntityHistoryAsync, sur la taille max 200,
        // pour que (page - 1) * pageSize ne déborde jamais (motif D-45-28, StudioWorkflowFeatures).
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize <= 0 ? DefaultPageSize : pageSize, 1, MaxPageSize);

        await using var ctx = _contextFactory.CreateContext();
        var q = BuildFilteredQuery(ctx, from, to, action, userId, entityType);

        var total = await q.CountAsync(cancellationToken);

        var list = await q.OrderByDescending(x => x.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => new AuditLogEntryDto
            {
                Id = r.Id,
                CreatedAt = r.CreatedAt,
                UserId = r.UserId,
                UserEmail = r.UserEmail,
                Action = r.Action,
                EntityType = r.EntityType,
                EntityId = r.EntityId,
                EntityLabel = null
            })
            .ToListAsync(cancellationToken);

        await ApplyEntityLabelsAsync(ctx, list, cancellationToken);

        return Result.Success(PagedResult<AuditLogEntryDto>.Create(list, page, pageSize, total));
    }

    public async Task<Result<PagedResult<AuditEntityHistoryRowDto>>> GetEntityHistoryAsync(
        string entityType, Guid entityId, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        // 4.7★1 (D-47-75, R52) : borne haute = int.MaxValue / taille max (100) pour que
        // (page - 1) * pageSize ne déborde jamais (motif D-45-28, StudioWorkflowFeatures).
        page = Math.Clamp(page, 1, int.MaxValue / EntityHistoryMaxPageSize);
        pageSize = Math.Clamp(pageSize <= 0 ? 20 : pageSize, 1, EntityHistoryMaxPageSize);

        await using var ctx = _contextFactory.CreateContext();
        var q = ctx.AuditLogs.AsNoTracking()
            .Where(a => a.EntityType == entityType && a.EntityId == entityId);

        var total = await q.CountAsync(cancellationToken);

        var list = await q.OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new AuditEntityHistoryRowDto
            {
                Id = a.Id,
                Action = a.Action,
                CreatedAt = a.CreatedAt,
                UserId = a.UserId,
                OldValues = a.OldValues,
                NewValues = a.NewValues
            })
            .ToListAsync(cancellationToken);

        return Result.Success(PagedResult<AuditEntityHistoryRowDto>.Create(list, page, pageSize, total));
    }

    public async Task<Result<AuditLogDetailDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var row = await ctx.AuditLogs.AsNoTracking()
            .Where(a => a.Id == id)
            .Select(r => new
            {
                r.Id,
                r.CreatedAt,
                r.UserId,
                r.UserEmail,
                r.Action,
                r.EntityType,
                r.EntityId,
                r.OldValues,
                r.NewValues,
                r.IpAddress,
                r.UserAgent,
                r.PreviousHash,
                r.Hash
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (row is null)
            return Result.Failure<AuditLogDetailDto>(Error.NotFound(nameof(AuditLog), id));

        var dto = new AuditLogDetailDto
        {
            Id = row.Id,
            CreatedAt = row.CreatedAt,
            UserId = row.UserId,
            UserEmail = row.UserEmail,
            Action = row.Action,
            EntityType = row.EntityType,
            EntityId = row.EntityId,
            EntityLabel = null,
            OldValues = row.OldValues,
            NewValues = row.NewValues,
            IpAddress = row.IpAddress,
            UserAgent = row.UserAgent,
            PreviousHash = row.PreviousHash,
            Hash = row.Hash
        };

        var oneRow = new List<AuditLogEntryDto>
        {
            new()
            {
                Id = dto.Id,
                CreatedAt = dto.CreatedAt,
                UserId = dto.UserId,
                UserEmail = dto.UserEmail,
                Action = dto.Action,
                EntityType = dto.EntityType,
                EntityId = dto.EntityId,
                EntityLabel = null
            }
        };
        await ApplyEntityLabelsAsync(ctx, oneRow, cancellationToken);
        if (oneRow[0].EntityLabel is { } label)
            dto = dto with { EntityLabel = label };

        return Result.Success(dto);
    }

    public async Task<Result<AuditChainVerificationDto>> VerifyChainAsync(CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var logs = await ctx.AuditLogs.AsNoTracking()
            .OrderBy(x => x.CreatedAt)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        var duplicatePreviousHashGroupCount = CountDuplicatePreviousHashGroups(logs);

        AuditLog? prev = null;
        foreach (var log in logs)
        {
            if (!log.VerifyIntegrity())
            {
                return Result.Success(new AuditChainVerificationDto
                {
                    IsValid = false,
                    EntryCount = logs.Count,
                    FirstBrokenEntryId = log.Id.ToString(),
                    FirstFailureReason = "IntegrityMismatch",
                    DuplicatePreviousHashGroupCount = duplicatePreviousHashGroupCount
                });
            }

            if (!log.VerifyChain(prev))
            {
                return Result.Success(new AuditChainVerificationDto
                {
                    IsValid = false,
                    EntryCount = logs.Count,
                    FirstBrokenEntryId = log.Id.ToString(),
                    FirstFailureReason = "ChainMismatch",
                    DuplicatePreviousHashGroupCount = duplicatePreviousHashGroupCount
                });
            }

            prev = log;
        }

        return Result.Success(new AuditChainVerificationDto
        {
            IsValid = true,
            EntryCount = logs.Count,
            FirstBrokenEntryId = null,
            FirstFailureReason = null,
            DuplicatePreviousHashGroupCount = 0
        });
    }

    private static int CountDuplicatePreviousHashGroups(IReadOnlyList<AuditLog> logs)
    {
        return logs
            .Where(x => x.PreviousHash != "GENESIS")
            .GroupBy(x => x.PreviousHash)
            .Count(g => g.Count() > 1);
    }

    private static IQueryable<AuditLog> BuildFilteredQuery(
        TenantDbContext ctx,
        DateTime? from,
        DateTime? to,
        string? action,
        Guid? userId,
        string? entityType)
    {
        var q = ctx.AuditLogs.AsNoTracking().AsQueryable();
        if (from.HasValue)
            q = q.Where(a => a.CreatedAt >= from.Value);
        if (to.HasValue)
            q = q.Where(a => a.CreatedAt <= to.Value);
        if (!string.IsNullOrWhiteSpace(action))
        {
            var a = action.Trim();
            q = q.Where(x => x.Action.Contains(a));
        }

        if (userId.HasValue)
            q = q.Where(x => x.UserId == userId);
        if (!string.IsNullOrWhiteSpace(entityType))
        {
            var et = entityType.Trim();
            q = q.Where(x => x.EntityType == et);
        }

        return q;
    }

    private static async Task ApplyEntityLabelsAsync(
        TenantDbContext ctx,
        List<AuditLogEntryDto> rows,
        CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
            return;

        var labels = new Dictionary<Guid, string>();

        await MergeInvoiceLabelsAsync(ctx, rows, labels, cancellationToken);
        await MergeClientLabelsAsync(ctx, rows, labels, cancellationToken);
        await MergeProductLabelsAsync(ctx, rows, labels, cancellationToken);
        await MergeSupplierLabelsAsync(ctx, rows, labels, cancellationToken);

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            if (!r.EntityId.HasValue)
                continue;
            if (labels.TryGetValue(r.EntityId.Value, out var label))
                rows[i] = r with { EntityLabel = label };
        }
    }

    private static async Task MergeInvoiceLabelsAsync(
        TenantDbContext ctx,
        List<AuditLogEntryDto> rows,
        Dictionary<Guid, string> labels,
        CancellationToken cancellationToken)
    {
        var ids = rows
            .Where(r => r.EntityType == "Invoice" && r.EntityId.HasValue)
            .Select(r => r.EntityId!.Value)
            .Distinct()
            .ToList();
        if (ids.Count == 0)
            return;

        var map = await ctx.Invoices.AsNoTracking()
            .Where(i => ids.Contains(i.Id))
            .Select(i => new { i.Id, Label = i.Number.Value })
            .ToDictionaryAsync(x => x.Id, x => x.Label, cancellationToken);

        foreach (var kv in map)
            labels[kv.Key] = kv.Value;
    }

    private static async Task MergeClientLabelsAsync(
        TenantDbContext ctx,
        List<AuditLogEntryDto> rows,
        Dictionary<Guid, string> labels,
        CancellationToken cancellationToken)
    {
        var ids = rows
            .Where(r => r.EntityType == "Client" && r.EntityId.HasValue)
            .Select(r => r.EntityId!.Value)
            .Distinct()
            .ToList();
        if (ids.Count == 0)
            return;

        var map = await ctx.Clients.AsNoTracking()
            .Where(c => ids.Contains(c.Id))
            .Select(c => new { c.Id, c.Name })
            .ToDictionaryAsync(x => x.Id, x => x.Name, cancellationToken);

        foreach (var kv in map)
            labels[kv.Key] = kv.Value;
    }

    private static async Task MergeProductLabelsAsync(
        TenantDbContext ctx,
        List<AuditLogEntryDto> rows,
        Dictionary<Guid, string> labels,
        CancellationToken cancellationToken)
    {
        var ids = rows
            .Where(r => r.EntityType == "Product" && r.EntityId.HasValue)
            .Select(r => r.EntityId!.Value)
            .Distinct()
            .ToList();
        if (ids.Count == 0)
            return;

        var map = await ctx.Products.AsNoTracking()
            .Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.Name })
            .ToDictionaryAsync(x => x.Id, x => x.Name, cancellationToken);

        foreach (var kv in map)
            labels[kv.Key] = kv.Value;
    }

    private static async Task MergeSupplierLabelsAsync(
        TenantDbContext ctx,
        List<AuditLogEntryDto> rows,
        Dictionary<Guid, string> labels,
        CancellationToken cancellationToken)
    {
        var ids = rows
            .Where(r => r.EntityType == "Supplier" && r.EntityId.HasValue)
            .Select(r => r.EntityId!.Value)
            .Distinct()
            .ToList();
        if (ids.Count == 0)
            return;

        var map = await ctx.Suppliers.AsNoTracking()
            .Where(s => ids.Contains(s.Id))
            .Select(s => new { s.Id, s.Name })
            .ToDictionaryAsync(x => x.Id, x => x.Name, cancellationToken);

        foreach (var kv in map)
            labels[kv.Key] = kv.Value;
    }
}
