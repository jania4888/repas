using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Communications;
using FactuTrust.Infrastructure.Persistence;
using Hangfire;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>Lot C2 — Lecture / requeue des EmailMessages côté backoffice.</summary>
public sealed class EmailMessageQueryService : IEmailMessageQueryService
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _db;
    private readonly IBackgroundJobClient _jobClient;

    public EmailMessageQueryService(MasterDbContext db, IBackgroundJobClient jobClient)
    {
        _db = db;
        _jobClient = jobClient;
    }

    public async Task<EmailMessagesPageDto> ListAsync(
        Guid? tenantId,
        int? statusFilter,
        string? search,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.EmailMessages.AsNoTracking().AsQueryable();
        if (tenantId.HasValue)
            query = query.Where(m => m.RelatedTenantId == tenantId);
        if (statusFilter.HasValue && Enum.IsDefined(typeof(EmailMessageStatus), statusFilter.Value))
        {
            var status = (EmailMessageStatus)statusFilter.Value;
            query = query.Where(m => m.Status == status);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(m =>
                m.ToEmail.ToLower().Contains(term)
                || m.Subject.ToLower().Contains(term)
                || m.TemplateCode.ToLower().Contains(term));
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var nowUtc = DateTime.UtcNow;
        var last24hCutoff = nowUtc.AddHours(-24);
        var last24h = await _db.EmailMessages
            .CountAsync(m => m.CreatedAt >= last24hCutoff, cancellationToken);

        var queuedCount = await _db.EmailMessages
            .CountAsync(m => m.Status == EmailMessageStatus.Queued || m.Status == EmailMessageStatus.Sending, cancellationToken);
        var sentCount = await _db.EmailMessages
            .CountAsync(m => m.Status == EmailMessageStatus.Sent, cancellationToken);
        var failedCount = await _db.EmailMessages
            .CountAsync(m => m.Status == EmailMessageStatus.Failed || m.Status == EmailMessageStatus.Bounced, cancellationToken);

        var rows = await query
            .OrderByDescending(m => m.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return new EmailMessagesPageDto
        {
            Items = rows.Select(MapList).ToList(),
            TotalCount = totalCount,
            QueuedCount = queuedCount,
            SentCount = sentCount,
            FailedCount = failedCount,
            Last24h = last24h
        };
    }

    public async Task<EmailMessageDetailDto?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var m = await _db.EmailMessages
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (m is null) return null;

        return new EmailMessageDetailDto
        {
            Id = m.Id,
            CreatedAt = m.CreatedAt,
            ToEmail = m.ToEmail,
            ToName = m.ToName,
            TemplateCode = m.TemplateCode,
            Subject = m.Subject,
            RenderedHtml = m.RenderedHtml,
            RenderedText = m.RenderedText,
            Status = m.Status,
            StatusDisplay = m.Status.ToDisplayString(),
            ProviderMessageId = m.ProviderMessageId,
            SentAt = m.SentAt,
            OpenedAt = m.OpenedAt,
            BouncedAt = m.BouncedAt,
            ErrorMessage = m.ErrorMessage,
            AttemptsCount = m.AttemptsCount,
            RelatedTenantId = m.RelatedTenantId
        };
    }

    public async Task<Result> RequeueAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var m = await _db.EmailMessages.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (m is null)
            return Result.Failure(Error.NotFound(nameof(EmailMessage), id));

        if (m.Status == EmailMessageStatus.Sent)
            return Result.Failure(Error.Validation("Status", "Ce message a déjà été envoyé."));

        m.RequeueForRetry();
        await _db.SaveChangesAsync(cancellationToken);
        _jobClient.Enqueue<SendEmailJob>(job => job.ExecuteAsync(id, CancellationToken.None));
        return Result.Success();
    }

    private static EmailMessageListItemDto MapList(EmailMessage m) => new()
    {
        Id = m.Id,
        CreatedAt = m.CreatedAt,
        ToEmail = m.ToEmail,
        ToName = m.ToName,
        TemplateCode = m.TemplateCode,
        Subject = m.Subject,
        Status = m.Status,
        StatusDisplay = m.Status.ToDisplayString(),
        SentAt = m.SentAt,
        ErrorMessage = m.ErrorMessage,
        AttemptsCount = m.AttemptsCount,
        RelatedTenantId = m.RelatedTenantId
    };
}
