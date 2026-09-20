using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for SupplierInvoice aggregate.
/// </summary>
public sealed class SupplierInvoiceRepository : ISupplierInvoiceRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public SupplierInvoiceRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<SupplierInvoice?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .Include(si => si.Supplier)
            .FirstOrDefaultAsync(si => si.Id == id, cancellationToken);
    }

    public async Task<SupplierInvoice?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .Include(si => si.Supplier)
            .Include(si => si.Warehouse)
            .Include(si => si.PurchaseOrder)
            .Include(si => si.SourcePurchaseReceipt)
            .Include(si => si.Lines)
            .Include(si => si.Payments)
            .FirstOrDefaultAsync(si => si.Id == id, cancellationToken);
    }

    public async Task<Result<RecordPaymentAuditData>> RecordPaymentAsync(
        Guid invoiceId,
        decimal? amount,
        DateTime paymentDate,
        PaymentMethod method,
        string? reference,
        string? notes,
        DateTime? effetDueDate,
        string userId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // 1. Load invoice with payments for validation
        var invoice = await context.SupplierInvoices
            .Include(si => si.Payments)
            .FirstOrDefaultAsync(si => si.Id == invoiceId, cancellationToken);

        if (invoice is null)
            return Result.Failure<RecordPaymentAuditData>(Error.NotFound("SupplierInvoice", invoiceId));

        // 2. Compute totals from the already-loaded payments
        var totalPaid = invoice.Payments.Sum(p => p.Amount.Amount);
        var remainingAmount = invoice.TotalAmount.Amount - totalPaid;
        var paymentAmount = amount ?? remainingAmount;

        if (paymentAmount <= 0)
            return Result.Failure<RecordPaymentAuditData>(Error.Validation("Amount", "Le montant du paiement doit être positif"));

        if (paymentAmount > remainingAmount)
            return Result.Failure<RecordPaymentAuditData>(Error.Validation("Amount", $"Le montant ne peut pas dépasser le restant dû ({remainingAmount:N3} {invoice.TotalAmount.Currency})"));

        // 3. Create payment entity via domain factory
        var money = Money.Create(paymentAmount, invoice.TotalAmount.Currency);
        var paymentResult = SupplierPayment.Create(invoice, money, paymentDate, method, reference, notes, effetDueDate);
        if (paymentResult.IsFailure)
            return Result.Failure<RecordPaymentAuditData>(paymentResult.Error);

        var payment = paymentResult.Value;
        payment.SetAuditInfo(userId, isUpdate: false);

        // 4. Add payment — the invoice is already tracked by the context,
        //    so EF will correctly set the FK without tracking conflicts.
        context.SupplierPayments.Add(payment);

        // 5. Update invoice status via the domain method (entity is already tracked)
        var newTotalPaid = totalPaid + paymentAmount;
        var allDates = invoice.Payments.Select(p => p.PaymentDate).Append(paymentDate);
        var lastPaymentDate = allDates.Max();
        invoice.ReconcilePaymentStatus(newTotalPaid, lastPaymentDate, payment.Reference);
        var isInvoiceNowFullyPaid = invoice.Status == SupplierInvoiceStatus.Paid;

        // 6. Save both the new payment and the updated invoice in one transaction
        await context.SaveChangesAsync(cancellationToken);

        var auditData = new RecordPaymentAuditData(
            invoice.Id, payment.Id, invoice.InvoiceNumber, paymentAmount, paymentDate, newTotalPaid, isInvoiceNowFullyPaid);
        return Result.Success(auditData);
    }

    public async Task<bool> ExistsForPurchaseOrderAsync(Guid purchaseOrderId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .AnyAsync(si => si.PurchaseOrderId == purchaseOrderId && si.Status != SupplierInvoiceStatus.Cancelled, cancellationToken);
    }

    public async Task<bool> ExistsByInvoiceNumberAsync(string invoiceNumber, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .AnyAsync(si => si.InvoiceNumber == invoiceNumber, cancellationToken);
    }

    public async Task<IReadOnlyList<string>> GetNonCancelledExternalReferencesForSupplierAsync(
        Guid supplierId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .AsNoTracking()
            .Where(si => si.SupplierId == supplierId
                         && si.Status != SupplierInvoiceStatus.Cancelled
                         && si.ExternalReference != null
                         && si.ExternalReference != "")
            .Select(si => si.ExternalReference!)
            .ToListAsync(cancellationToken);
    }

    public async Task<decimal> SumFixedAssetDeductibleVatAsync(
        DateTime fromDate,
        DateTime toDate,
        bool realizedOnly = false,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        return await context.SupplierInvoiceLines
            .AsNoTracking()
            .Where(l => l.IsFixedAsset)
            .Where(l => l.SupplierInvoice.InvoiceDate >= from && l.SupplierInvoice.InvoiceDate <= to)
            // Même assiette que la TVA déductible de la déclaration : exclure les factures annulées.
            .Where(l => !realizedOnly || l.SupplierInvoice.Status != SupplierInvoiceStatus.Cancelled)
            .SumAsync(l => l.VatAmount.Amount, cancellationToken);
    }

    public async Task<(IReadOnlyList<SupplierInvoice> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        SupplierInvoiceStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        Guid? purchaseReceiptId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        bool unpaidOnly = false,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplySupplierInvoiceFilters(
            context.SupplierInvoices
                .Include(si => si.Supplier)
                .Include(si => si.Warehouse)
                .Include(si => si.PurchaseOrder)
                .Include(si => si.Lines)
                .Include(si => si.Payments)
                .AsQueryable(),
            searchTerm, status, supplierId, purchaseOrderId, purchaseReceiptId, fromDate, toDate, unpaidOnly);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(si => si.InvoiceDate)
            .ThenByDescending(si => si.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the supplier-invoice list filters. Single source of truth shared by
    /// <see cref="SearchAsync"/> and <see cref="GetSummaryAsync"/> (no drift between list and totals).
    /// </summary>
    private static IQueryable<SupplierInvoice> ApplySupplierInvoiceFilters(
        IQueryable<SupplierInvoice> query,
        string? searchTerm,
        SupplierInvoiceStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        Guid? purchaseReceiptId,
        DateTime? fromDate,
        DateTime? toDate,
        bool unpaidOnly)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(si =>
                si.InvoiceNumber.Contains(term) ||
                si.Supplier.Name.Contains(term) ||
                (si.ExternalReference != null && si.ExternalReference.Contains(term)));
        }

        if (unpaidOnly)
            query = query.Where(si => si.Status != SupplierInvoiceStatus.Paid && si.Status != SupplierInvoiceStatus.Cancelled);

        if (status.HasValue)
            query = query.Where(si => si.Status == status.Value);

        if (supplierId.HasValue)
            query = query.Where(si => si.SupplierId == supplierId.Value);

        if (purchaseOrderId.HasValue)
            query = query.Where(si => si.PurchaseOrderId == purchaseOrderId.Value);

        if (purchaseReceiptId.HasValue)
            query = query.Where(si => si.SourcePurchaseReceiptId == purchaseReceiptId.Value);

        if (fromDate.HasValue)
            query = query.Where(si => si.InvoiceDate >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(si => si.InvoiceDate <= toDate.Value);

        return query;
    }

    public async Task<IReadOnlyList<LinkedSupplierInvoiceSummaryDto>> GetLinkedSummariesByPurchaseOrderIdAsync(
        Guid purchaseOrderId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var rows = await context.SupplierInvoices
            .AsNoTracking()
            .Where(si => si.PurchaseOrderId == purchaseOrderId)
            .OrderByDescending(si => si.InvoiceDate)
            .Select(si => new
            {
                si.Id,
                si.InvoiceNumber,
                si.InvoiceDate,
                si.Status,
                TotalTTC = si.TotalAmount.Amount
            })
            .ToListAsync(cancellationToken);

        return rows.Select(si => new LinkedSupplierInvoiceSummaryDto
        {
            Id = si.Id,
            InvoiceNumber = si.InvoiceNumber,
            InvoiceDate = si.InvoiceDate,
            Status = si.Status,
            StatusDisplay = si.Status.ToDisplayString(),
            TotalTTC = si.TotalTTC
        }).ToList();
    }

    public async Task<IReadOnlyList<LinkedSupplierInvoiceSummaryDto>> GetLinkedSummariesByPurchaseReceiptIdAsync(
        Guid purchaseReceiptId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var rows = await context.SupplierInvoices
            .AsNoTracking()
            .Where(si => si.SourcePurchaseReceiptId == purchaseReceiptId)
            .OrderByDescending(si => si.InvoiceDate)
            .Select(si => new
            {
                si.Id,
                si.InvoiceNumber,
                si.InvoiceDate,
                si.Status,
                TotalTTC = si.TotalAmount.Amount
            })
            .ToListAsync(cancellationToken);

        return rows.Select(si => new LinkedSupplierInvoiceSummaryDto
        {
            Id = si.Id,
            InvoiceNumber = si.InvoiceNumber,
            InvoiceDate = si.InvoiceDate,
            Status = si.Status,
            StatusDisplay = si.Status.ToDisplayString(),
            TotalTTC = si.TotalTTC
        }).ToList();
    }

    public async Task<SupplierInvoiceListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        SupplierInvoiceStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        Guid? purchaseReceiptId,
        DateTime? fromDate,
        DateTime? toDate,
        bool unpaidOnly = false,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var filtered = ApplySupplierInvoiceFilters(
            context.SupplierInvoices.AsNoTracking(),
            searchTerm, status, supplierId, purchaseOrderId, purchaseReceiptId, fromDate, toDate, unpaidOnly);

        // Lightweight per-invoice projection; Paid via the Payments navigation (correlated subquery).
        var rows = await filtered
            .Select(si => new
            {
                Ttc = si.TotalAmount.Amount,
                Ht = si.SubTotal.Amount,
                si.DueDate,
                si.Status,
                Currency = si.TotalAmount.Currency,
                Paid = si.Payments.Sum(p => (decimal?)p.Amount.Amount) ?? 0m
            })
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return new SupplierInvoiceListSummaryDto { Currency = "TND" };

        var today = DateTime.UtcNow.Date;
        decimal totalTtc = 0m, totalHt = 0m, totalPaid = 0m, totalRemaining = 0m;
        var overdueCount = 0;

        foreach (var r in rows)
        {
            totalTtc += r.Ttc;
            totalHt += r.Ht;
            totalPaid += r.Paid;
            // Same as the list: remaining = TTC - paid (not clamped).
            totalRemaining += r.Ttc - r.Paid;
            if (r.DueDate < today
                && r.Status != SupplierInvoiceStatus.Paid && r.Status != SupplierInvoiceStatus.Cancelled)
            {
                overdueCount++;
            }
        }

        return new SupplierInvoiceListSummaryDto
        {
            Count = rows.Count,
            TotalTtc = Math.Round(totalTtc, 3),
            TotalHt = Math.Round(totalHt, 3),
            TotalVat = Math.Round(totalTtc - totalHt, 3),
            TotalPaid = Math.Round(totalPaid, 3),
            TotalRemaining = Math.Round(totalRemaining, 3),
            OverdueCount = overdueCount,
            Currency = rows[0].Currency
        };
    }

    public async Task<IReadOnlyList<SupplierInvoice>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .Include(si => si.Supplier)
            .OrderByDescending(si => si.InvoiceDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<SupplierInvoice> AddAsync(SupplierInvoice entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // La facture porte des navigations vers d'AUTRES agrégats (Supplier, PurchaseOrder,
        // SourcePurchaseReceipt, Warehouse et, en cascade, leurs lignes et leurs Product),
        // chargés par d'AUTRES DbContext. Les laisser traverser par context.Add() ferait
        // tenter à EF de les RÉINSÉRER (violation PK_Products / PK_PurchaseReceipts).
        // Toutes les FK sont déjà portées par l'entité : on ne traque que l'agrégat.
        context.ChangeTracker.AutoDetectChangesEnabled = false;

        context.ChangeTracker.TrackGraph(entity, node =>
        {
            if (node.Entry.Metadata.IsOwned() || node.Entry.Entity is SupplierInvoice or SupplierInvoiceLine)
                node.Entry.State = EntityState.Added;
            // sinon : laissé Detached → TrackGraph n'explore pas plus loin
        });

        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(SupplierInvoice entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.SupplierInvoices.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(SupplierInvoice entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.SupplierInvoices.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices.AnyAsync(si => si.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<SupplierInvoice>> GetOpenInvoicesForSupplierAsync(
        Guid supplierId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .AsTracking()
            .Include(si => si.Supplier)
            .Include(si => si.Lines)
            .Where(si =>
                si.SupplierId == supplierId
                && si.Status != SupplierInvoiceStatus.Cancelled
                && (si.Status == SupplierInvoiceStatus.Pending || si.Status == SupplierInvoiceStatus.PartiallyPaid))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<SupplierInvoice>> GetPaidWithholdingInvoicesForTejPeriodAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .AsNoTracking()
            .Include(si => si.Supplier)
            .Include(si => si.Lines)
            .Where(si =>
                si.Status == SupplierInvoiceStatus.Paid
                && si.IsSubjectToWithholding
                && si.WithholdingAmount != null && si.WithholdingAmount > 0
                && si.WithholdingTaxTypeId != null
                && si.PaidAt != null
                && si.PaidAt.Value.Year == year
                && si.PaidAt.Value.Month == month)
            .OrderBy(si => si.InvoiceNumber)
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountPaidWithholdingInvoicesForTejPeriodAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierInvoices
            .AsNoTracking()
            .CountAsync(si =>
                si.Status == SupplierInvoiceStatus.Paid
                && si.IsSubjectToWithholding
                && si.WithholdingAmount != null && si.WithholdingAmount > 0
                && si.WithholdingTaxTypeId != null
                && si.PaidAt != null
                && si.PaidAt.Value.Year == year
                && si.PaidAt.Value.Month == month,
                cancellationToken);
    }

    public async Task<(int Count, decimal TotalWithheld)> GetPaidWithholdingSummaryForTejPeriodAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.SupplierInvoices.AsNoTracking()
            .Where(si =>
                si.Status == SupplierInvoiceStatus.Paid
                && si.IsSubjectToWithholding
                && si.WithholdingAmount != null && si.WithholdingAmount > 0
                && si.WithholdingTaxTypeId != null
                && si.PaidAt != null
                && si.PaidAt.Value.Year == year
                && si.PaidAt.Value.Month == month);

        var count = await query.CountAsync(cancellationToken);
        var total = count == 0 ? 0m : await query.SumAsync(si => si.WithholdingAmount ?? 0, cancellationToken);
        return (count, total);
    }

    public async Task<List<(int Month, int Count, decimal TotalHT, decimal TotalWithheld, decimal TotalNetPaid)>> GetMonthlyWithholdingAggregatesForPaidInvoicesAsync(
        int year,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var raw = await context.SupplierInvoices
            .AsNoTracking()
            .Where(si =>
                si.Status == SupplierInvoiceStatus.Paid
                && si.IsSubjectToWithholding
                && si.WithholdingAmount != null && si.WithholdingAmount > 0
                && si.PaidAt != null
                && si.PaidAt.Value.Year == year)
            .GroupBy(si => si.PaidAt!.Value.Month)
            .Select(g => new
            {
                Month = g.Key,
                Count = g.Count(),
                TotalHT = g.Sum(x => x.SubTotal.Amount),
                TotalWithheld = g.Sum(x => x.WithholdingAmount ?? 0),
                TotalNetPaid = g.Sum(x => x.NetAmountAfterWithholding ?? x.TotalAmount.Amount - (x.WithholdingAmount ?? 0))
            })
            .OrderBy(x => x.Month)
            .ToListAsync(cancellationToken);

        return raw.Select(r => (r.Month, r.Count, r.TotalHT, r.TotalWithheld, r.TotalNetPaid)).ToList();
    }

    public async Task<IReadOnlyList<SupplierWithholdingReportRowDto>> GetSupplierWithholdingReportRowsAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var from = fromDate.Date;
        var to = toDate.Date;

        return await context.SupplierInvoices
            .AsNoTracking()
            .Where(si =>
                si.Status == SupplierInvoiceStatus.Paid
                && si.WithholdingAmount != null && si.WithholdingAmount > 0
                && si.PaidAt != null
                && si.PaidAt.Value.Date >= from && si.PaidAt.Value.Date <= to)
            .GroupBy(si => new
            {
                si.SupplierId,
                SupplierName = si.Supplier != null ? si.Supplier.Name : string.Empty,
                Currency = si.TotalAmount.Currency
            })
            .Select(g => new SupplierWithholdingReportRowDto
            {
                SupplierId = g.Key.SupplierId,
                SupplierName = g.Key.SupplierName,
                InvoiceCount = g.Count(),
                TotalHT = g.Sum(x => x.SubTotal.Amount),
                TotalWithholding = g.Sum(x => x.WithholdingAmount ?? 0),
                TotalNetPaid = g.Sum(x => x.NetAmountAfterWithholding ?? x.TotalAmount.Amount - (x.WithholdingAmount ?? 0)),
                Currency = g.Key.Currency
            })
            .OrderBy(r => r.SupplierName)
            .ToListAsync(cancellationToken);
    }

    public async Task<SupplierPayment?> GetPaymentByIdWithInvoiceAsync(Guid paymentId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SupplierPayments
            .Include(p => p.SupplierInvoice)
                .ThenInclude(si => si!.Supplier)
            .Include(p => p.SupplierInvoice!)
                .ThenInclude(si => si.Lines)
            .Include(p => p.SupplierInvoice!)
                .ThenInclude(si => si.PurchaseOrder)
            .Include(p => p.SupplierInvoice!)
                .ThenInclude(si => si.Payments)
            .FirstOrDefaultAsync(p => p.Id == paymentId, cancellationToken);
    }

    public async Task<Result<(Guid PaymentId, string InvoiceNumber)>> SettleEffetAsync(
        Guid paymentId,
        DateTime settlementDate,
        string userId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var payment = await context.SupplierPayments
            .Include(p => p.SupplierInvoice)
            .FirstOrDefaultAsync(p => p.Id == paymentId, cancellationToken);

        if (payment is null)
            return Result.Failure<(Guid, string)>(Error.NotFound("SupplierPayment", paymentId));

        if (payment.Method != PaymentMethod.Traite)
            return Result.Failure<(Guid, string)>(Error.Validation("Effet", "Ce paiement n'est pas une traite"));

        var settled = payment.MarkEffetSettled(settlementDate, EffetStatus.Encaisse);
        if (settled.IsFailure)
            return Result.Failure<(Guid, string)>(settled.Error);

        payment.SetAuditInfo(userId, isUpdate: true);
        await context.SaveChangesAsync(cancellationToken);

        return Result.Success((payment.Id, payment.SupplierInvoice.InvoiceNumber));
    }
}
