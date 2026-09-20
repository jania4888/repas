using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Billing;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Billing;

/// <summary>Lot C5 — Lecture paginée des intentions de paiement (audit / diag).</summary>
public sealed class PaymentIntentQueryService : IPaymentIntentQueryService
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _db;

    public PaymentIntentQueryService(MasterDbContext db)
    {
        _db = db;
    }

    public async Task<PaymentIntentsPageDto> ListAsync(
        string? providerCode,
        string? status,
        Guid? tenantId,
        DateTime? from,
        DateTime? to,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.PaymentIntents.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(providerCode))
            query = query.Where(i => i.ProviderCode == providerCode.ToLowerInvariant());
        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<PaymentIntentStatus>(status, true, out var st))
            query = query.Where(i => i.Status == st);
        if (tenantId.HasValue) query = query.Where(i => i.TenantId == tenantId.Value);
        if (from.HasValue) query = query.Where(i => i.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(i => i.CreatedAt <= to.Value);

        var totalCount = await query.CountAsync(cancellationToken);

        var stats = await _db.PaymentIntents.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Succeeded = g.Count(i => i.Status == PaymentIntentStatus.Succeeded),
                Pending = g.Count(i => i.Status == PaymentIntentStatus.Pending
                    || i.Status == PaymentIntentStatus.Created
                    || i.Status == PaymentIntentStatus.RedirectIssued),
                Failed = g.Count(i => i.Status == PaymentIntentStatus.Failed),
                TotalAmountSucceededTnd = g.Where(i => i.Status == PaymentIntentStatus.Succeeded)
                    .Sum(i => (decimal?)i.AmountTND) ?? 0m
            })
            .FirstOrDefaultAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(i => i.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var tenantIds = rows.Select(r => r.TenantId).Distinct().ToList();
        var tenants = await _db.Tenants.AsNoTracking()
            .Where(t => tenantIds.Contains(t.Id))
            .Select(t => new { t.Id, t.CompanyName })
            .ToDictionaryAsync(t => t.Id, t => t.CompanyName, cancellationToken);

        var invoiceIds = rows.Select(r => r.InvoiceId).Distinct().ToList();
        var invoices = await _db.PlatformInvoices.AsNoTracking()
            .Where(i => invoiceIds.Contains(i.Id))
            .Select(i => new { i.Id, i.Number })
            .ToDictionaryAsync(i => i.Id, i => i.Number, cancellationToken);

        var items = rows.Select(i => new PaymentIntentDto
        {
            Id = i.Id,
            TenantId = i.TenantId,
            TenantName = tenants.GetValueOrDefault(i.TenantId, "—"),
            InvoiceId = i.InvoiceId,
            InvoiceNumber = invoices.GetValueOrDefault(i.InvoiceId),
            ProviderCode = i.ProviderCode,
            ProviderRef = i.ProviderRef,
            AmountTND = i.AmountTND,
            Status = i.Status,
            StatusDisplay = i.Status.ToDisplayString(),
            ReturnUrl = i.ReturnUrl,
            RedirectUrl = i.RedirectUrl,
            FailureReason = i.FailureReason,
            CreatedAt = i.CreatedAt,
            CompletedAt = i.CompletedAt
        }).ToList();

        return new PaymentIntentsPageDto
        {
            Items = items,
            TotalCount = totalCount,
            SucceededCount = stats?.Succeeded ?? 0,
            PendingCount = stats?.Pending ?? 0,
            FailedCount = stats?.Failed ?? 0,
            TotalAmountSucceededTnd = Math.Round(stats?.TotalAmountSucceededTnd ?? 0m, 3)
        };
    }
}
