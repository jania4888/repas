using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Billing;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Billing;

/// <summary>
/// Lot C4 — Service admin de gestion des factures plateforme.
///
/// Implémente le cycle :
/// <list type="number">
///   <item><b>CreateDraft</b> : sans numéro, modifiable.</item>
///   <item><b>Issue</b> : réserve un numéro séquentiel, fige les mentions, snapshot fiscal,
///         génère et stocke le PDF.</item>
///   <item><b>Cancel</b> : crée un avoir (facture de type <c>Refund</c>) et passe la facture
///         d'origine en <c>Cancelled</c>.</item>
/// </list>
///
/// Tous les calculs (subtotal HT, TVA, TTC) sont délégués à <see cref="PlatformInvoice.Recalculate"/>.
/// </summary>
public sealed class PlatformInvoiceAdminService : IPlatformInvoiceAdminService
{
    private const int MaxPageSize = 200;

    private readonly MasterDbContext _db;
    private readonly IPlatformDocumentNumberService _numberService;
    private readonly IPlatformFiscalSettingsService _fiscalService;
    private readonly IPlatformInvoicePdfRenderer _pdfRenderer;

    public PlatformInvoiceAdminService(
        MasterDbContext db,
        IPlatformDocumentNumberService numberService,
        IPlatformFiscalSettingsService fiscalService,
        IPlatformInvoicePdfRenderer pdfRenderer)
    {
        _db = db;
        _numberService = numberService;
        _fiscalService = fiscalService;
        _pdfRenderer = pdfRenderer;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // List
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<PlatformInvoicesPageDto> ListAsync(
        Guid? tenantId,
        string? statusFilter,
        DateTime? from,
        DateTime? to,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / MaxPageSize);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var query = _db.PlatformInvoices.AsNoTracking().AsQueryable();
        if (tenantId.HasValue) query = query.Where(i => i.TenantId == tenantId.Value);
        if (from.HasValue) query = query.Where(i => i.InvoiceDate >= from.Value.Date);
        if (to.HasValue) query = query.Where(i => i.InvoiceDate <= to.Value.Date);

        if (!string.IsNullOrWhiteSpace(statusFilter)
            && Enum.TryParse<PlatformInvoiceStatus>(statusFilter, true, out var st))
        {
            query = query.Where(i => i.Status == st);
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var stats = await query
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Draft = g.Count(i => i.Status == PlatformInvoiceStatus.Draft),
                Issued = g.Count(i => i.Status == PlatformInvoiceStatus.Issued),
                Paid = g.Count(i => i.Status == PlatformInvoiceStatus.Paid),
                Overdue = g.Count(i => i.Status == PlatformInvoiceStatus.Overdue
                    || (i.Status != PlatformInvoiceStatus.Paid
                        && i.Status != PlatformInvoiceStatus.Cancelled
                        && i.Status != PlatformInvoiceStatus.Draft
                        && i.DueDate != null
                        && i.DueDate < DateTime.UtcNow)),
                TotalIssuedTtc = g.Where(i => i.Status != PlatformInvoiceStatus.Draft && i.Status != PlatformInvoiceStatus.Cancelled).Sum(i => (decimal?)i.TotalTTC) ?? 0m,
                TotalPaidTtc = g.Where(i => i.Status == PlatformInvoiceStatus.Paid).Sum(i => (decimal?)i.TotalTTC) ?? 0m,
                TotalOutstandingTtc = g.Where(i => i.Status != PlatformInvoiceStatus.Paid
                    && i.Status != PlatformInvoiceStatus.Cancelled
                    && i.Status != PlatformInvoiceStatus.Draft).Sum(i => (decimal?)i.TotalTTC) ?? 0m
            })
            .FirstOrDefaultAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(i => i.InvoiceDate)
            .ThenByDescending(i => i.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var tenantIds = rows.Select(r => r.TenantId).Distinct().ToList();
        var tenants = await _db.Tenants.AsNoTracking()
            .Where(t => tenantIds.Contains(t.Id))
            .Select(t => new { t.Id, t.CompanyName })
            .ToDictionaryAsync(t => t.Id, t => t.CompanyName, cancellationToken);

        var invoiceIds = rows.Select(r => r.Id).ToList();
        var receiptSums = await _db.PlatformReceipts.AsNoTracking()
            .Where(r => invoiceIds.Contains(r.InvoiceId) && r.Status == PlatformReceiptStatus.Confirmed)
            .GroupBy(r => r.InvoiceId)
            .Select(g => new { InvoiceId = g.Key, Sum = g.Sum(x => x.AmountTND) })
            .ToDictionaryAsync(x => x.InvoiceId, x => x.Sum, cancellationToken);

        var nowUtc = DateTime.UtcNow;
        var items = rows.Select(i =>
        {
            var paid = receiptSums.GetValueOrDefault(i.Id, 0m);
            return new PlatformInvoiceSummaryDto
            {
                Id = i.Id,
                TenantId = i.TenantId,
                TenantName = tenants.GetValueOrDefault(i.TenantId, "—"),
                Number = i.Number,
                InvoiceDate = i.InvoiceDate,
                DueDate = i.DueDate,
                BillingType = i.BillingType,
                BillingTypeDisplay = i.BillingType.ToDisplayString(),
                Status = i.Status,
                StatusDisplay = i.Status.ToDisplayString(),
                SubtotalHT = i.SubtotalHT,
                VatAmount = i.VatAmount,
                StampDuty = i.StampDuty,
                TotalTTC = i.TotalTTC,
                TotalReceived = paid,
                RemainingAmount = Math.Max(0m, i.TotalTTC - paid),
                IssuedAt = i.IssuedAt,
                PaidAt = i.PaidAt,
                IsOverdue = i.Status != PlatformInvoiceStatus.Paid
                    && i.Status != PlatformInvoiceStatus.Cancelled
                    && i.Status != PlatformInvoiceStatus.Draft
                    && i.DueDate.HasValue
                    && i.DueDate.Value < nowUtc
            };
        }).ToList();

        return new PlatformInvoicesPageDto
        {
            Items = items,
            TotalCount = totalCount,
            DraftCount = stats?.Draft ?? 0,
            IssuedCount = stats?.Issued ?? 0,
            PaidCount = stats?.Paid ?? 0,
            OverdueCount = stats?.Overdue ?? 0,
            TotalIssuedTtc = Math.Round(stats?.TotalIssuedTtc ?? 0m, 3),
            TotalPaidTtc = Math.Round(stats?.TotalPaidTtc ?? 0m, 3),
            TotalOutstandingTtc = Math.Round(stats?.TotalOutstandingTtc ?? 0m, 3)
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Get
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<Result<PlatformInvoiceDetailDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var invoice = await _db.PlatformInvoices
            .Include(i => i.Lines)
            .Include(i => i.Receipts)
            .AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.NotFound(nameof(PlatformInvoice), id));

        var dto = await BuildDetailDtoAsync(invoice, cancellationToken);
        return Result.Success(dto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CreateDraft
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<Result<PlatformInvoiceDetailDto>> CreateDraftAsync(
        CreatePlatformInvoiceRequest request,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        if (request is null) return Result.Failure<PlatformInvoiceDetailDto>(Error.Validation("Request", "Requête invalide"));
        if (request.Lines.Count == 0)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Validation("Lines", "Au moins une ligne requise"));

        var tenant = await _db.Tenants.FindAsync(new object?[] { request.TenantId }, cancellationToken);
        if (tenant is null)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.NotFound(nameof(Tenant), request.TenantId));

        var fiscal = await _fiscalService.GetAsync(cancellationToken);

        var draft = PlatformInvoice.CreateDraft(
            tenantId: request.TenantId,
            invoiceDate: request.InvoiceDate ?? DateTime.UtcNow.Date,
            dueDate: request.DueDate,
            billingType: request.BillingType,
            createdByUserId: actorUserId,
            periodFrom: request.PeriodFrom,
            periodTo: request.PeriodTo);

        try
        {
            foreach (var l in request.Lines)
            {
                draft.AddLine(l.Description, l.Quantity, l.UnitPriceHT, l.VatRate, l.RelatedPeriodFrom, l.RelatedPeriodTo);
            }
            draft.ApplyDiscount(request.DiscountAmount);
            draft.ApplyCredits(request.CreditsApplied);
            if (request.CouponRedemptionId.HasValue)
                draft.AssociateCouponRedemption(request.CouponRedemptionId.Value);
            draft.Recalculate(stampDuty: 0m); // pas de timbre tant que Draft
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Validation("Invoice", ex.Message));
        }

        draft.SetAuditInfo(actorUserId.ToString());
        _db.PlatformInvoices.Add(draft);
        await _db.SaveChangesAsync(cancellationToken);

        var dto = await BuildDetailDtoAsync(draft, cancellationToken);
        return Result.Success(dto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Issue
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<Result<PlatformInvoiceDetailDto>> IssueAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var invoice = await _db.PlatformInvoices
            .Include(i => i.Lines)
            .Include(i => i.Receipts)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.NotFound(nameof(PlatformInvoice), id));

        if (invoice.Status != PlatformInvoiceStatus.Draft)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Conflict($"Une facture {invoice.Status.ToDisplayString()} ne peut pas être réémise."));
        if (invoice.Lines.Count == 0)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Validation("Lines", "Au moins une ligne requise"));

        var fiscal = await _fiscalService.GetAsync(cancellationToken);

        // Recalcule avec le timbre fiscal courant.
        invoice.Recalculate(stampDuty: fiscal.TimbreFiscalAmount);

        var (number, year) = await _numberService.ReserveAsync("Invoice", fiscal.InvoiceNumberPrefix, cancellationToken);
        var snapshot = JsonSerializer.Serialize(fiscal);
        invoice.Issue(number, year, fiscal.LegalMentions, snapshot);

        await _db.SaveChangesAsync(cancellationToken);

        var dto = await BuildDetailDtoAsync(invoice, cancellationToken);
        try
        {
            var pdfBytes = _pdfRenderer.RenderInvoice(dto, fiscal);
            var storageKey = await SaveBlobAsync($"invoices/{invoice.Id}.pdf", pdfBytes, cancellationToken);
            invoice.AttachPdf(storageKey);
            await _db.SaveChangesAsync(cancellationToken);
            dto = dto with { PdfStorageKey = storageKey };
        }
        catch
        {
            // Le PDF se régénère à la demande via GetPdfAsync, on n'invalide pas l'émission.
        }

        return Result.Success(dto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cancel (avec génération avoir)
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<Result<PlatformInvoiceDetailDto>> CancelAsync(
        Guid id,
        CancelPlatformInvoiceRequest request,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var invoice = await _db.PlatformInvoices
            .Include(i => i.Lines)
            .Include(i => i.Receipts)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.NotFound(nameof(PlatformInvoice), id));
        if (invoice.Status == PlatformInvoiceStatus.Draft)
        {
            _db.PlatformInvoices.Remove(invoice);
            await _db.SaveChangesAsync(cancellationToken);
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Conflict("Brouillon supprimé (pas d'avoir nécessaire)."));
        }
        if (invoice.Status is PlatformInvoiceStatus.Cancelled or PlatformInvoiceStatus.Refunded)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Conflict("Facture déjà annulée."));

        var fiscal = await _fiscalService.GetAsync(cancellationToken);

        // Génère l'avoir (Refund) avec lignes opposées.
        var creditNote = PlatformInvoice.CreateDraft(
            tenantId: invoice.TenantId,
            invoiceDate: DateTime.UtcNow.Date,
            dueDate: null,
            billingType: PlatformInvoiceBillingType.Refund,
            createdByUserId: actorUserId);

        foreach (var l in invoice.Lines)
        {
            creditNote.AddLine($"Avoir : {l.Description}", l.Quantity, -Math.Abs(l.UnitPriceHT), l.VatRate, l.RelatedPeriodFrom, l.RelatedPeriodTo);
        }
        creditNote.Recalculate(stampDuty: 0m);

        var (creditNumber, creditYear) = await _numberService.ReserveAsync("CreditNote", fiscal.InvoiceNumberPrefix + "-AV", cancellationToken);
        var snapshot = JsonSerializer.Serialize(fiscal);
        creditNote.Issue(creditNumber, creditYear, fiscal.LegalMentions, snapshot);

        _db.PlatformInvoices.Add(creditNote);
        invoice.Cancel(request.Reason, creditNote.Id);
        await _db.SaveChangesAsync(cancellationToken);

        var dto = await BuildDetailDtoAsync(invoice, cancellationToken);
        return Result.Success(dto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lot C4 (complément) — Credit note partiel (sans annulation)
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<Result<PlatformInvoiceDetailDto>> IssueCreditNoteAsync(
        Guid id,
        IssueCreditNoteRequest request,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        if (request is null) return Result.Failure<PlatformInvoiceDetailDto>(Error.Validation("Request", "Requête invalide"));

        var source = await _db.PlatformInvoices
            .Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (source is null) return Result.Failure<PlatformInvoiceDetailDto>(Error.NotFound(nameof(PlatformInvoice), id));
        if (source.Status is PlatformInvoiceStatus.Draft or PlatformInvoiceStatus.Cancelled)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Conflict($"Avoir impossible : statut {source.Status.ToDisplayString()}."));

        var fiscal = await _fiscalService.GetAsync(cancellationToken);
        var refundAmount = request.AmountTtcTND.HasValue && request.AmountTtcTND.Value > 0
            ? Math.Min(request.AmountTtcTND.Value, source.TotalTTC)
            : source.TotalTTC;
        if (refundAmount <= 0)
            return Result.Failure<PlatformInvoiceDetailDto>(Error.Validation("AmountTtcTND", "Montant à créditer invalide"));

        // Avoir en une ligne synthétique (HT calculé sans TVA pour rester simple ; le total TTC est garanti).
        var creditNote = PlatformInvoice.CreateDraft(
            tenantId: source.TenantId,
            invoiceDate: DateTime.UtcNow.Date,
            dueDate: null,
            billingType: PlatformInvoiceBillingType.Refund,
            createdByUserId: actorUserId);

        // On crédite en HT négatif. La TVA est recalculée par Recalculate().
        var defaultVatRate = fiscal.DefaultVatRate;
        var amountHt = defaultVatRate > 0
            ? Math.Round(-refundAmount / (1m + (defaultVatRate / 100m)), 3)
            : -refundAmount;
        creditNote.AddLine(
            description: $"Avoir partiel sur facture {source.Number ?? source.Id.ToString("N")} — {request.Reason.Trim()}",
            quantity: 1m,
            unitPriceHT: amountHt,
            vatRate: defaultVatRate);
        creditNote.Recalculate(stampDuty: 0m);

        var (creditNumber, creditYear) = await _numberService.ReserveAsync(
            "CreditNote",
            fiscal.InvoiceNumberPrefix + "-AV",
            cancellationToken);
        var snapshot = JsonSerializer.Serialize(fiscal);
        creditNote.Issue(creditNumber, creditYear, fiscal.LegalMentions, snapshot);

        _db.PlatformInvoices.Add(creditNote);
        await _db.SaveChangesAsync(cancellationToken);

        var dto = await BuildDetailDtoAsync(creditNote, cancellationToken);
        return Result.Success(dto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lot C4 (complément) — Liste tenant (espace abonnement)
    // ─────────────────────────────────────────────────────────────────────────

    public Task<PlatformInvoicesPageDto> ListForTenantAsync(Guid tenantId, int page, int pageSize, CancellationToken cancellationToken = default)
        => ListAsync(tenantId, statusFilter: null, from: null, to: null, page, pageSize, cancellationToken);

    // ─────────────────────────────────────────────────────────────────────────
    // Lot C4 (complément) — Agrégation TVA par mois (DGI)
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<PlatformVatPeriodDto>> GetVatPeriodsAsync(int year, CancellationToken cancellationToken = default)
    {
        if (year < 2000 || year > 2200) return Array.Empty<PlatformVatPeriodDto>();

        var query = _db.PlatformInvoices.AsNoTracking()
            .Where(i => i.InvoiceDate.Year == year
                && i.Status != PlatformInvoiceStatus.Draft
                && i.Status != PlatformInvoiceStatus.Cancelled);

        var rows = await query
            .Select(i => new
            {
                i.InvoiceDate,
                i.BillingType,
                i.SubtotalHT,
                i.VatAmount,
                i.StampDuty,
                i.TotalTTC
            })
            .ToListAsync(cancellationToken);

        var byMonth = rows
            .GroupBy(r => r.InvoiceDate.Month)
            .ToDictionary(g => g.Key, g => g.ToList());

        var monthsFr = new[]
        {
            "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
            "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
        };

        var result = new List<PlatformVatPeriodDto>(12);
        for (var m = 1; m <= 12; m++)
        {
            var monthRows = byMonth.TryGetValue(m, out var list) ? list : new();
            var refunds = monthRows.Where(r => r.BillingType == PlatformInvoiceBillingType.Refund).ToList();
            var sales = monthRows.Where(r => r.BillingType != PlatformInvoiceBillingType.Refund).ToList();
            result.Add(new PlatformVatPeriodDto
            {
                Year = year,
                Month = m,
                MonthLabel = $"{monthsFr[m - 1]} {year}",
                InvoicesCount = sales.Count,
                TotalHT = Math.Round(sales.Sum(s => s.SubtotalHT), 3),
                TotalVat = Math.Round(sales.Sum(s => s.VatAmount), 3),
                TotalStamp = Math.Round(sales.Sum(s => s.StampDuty), 3),
                TotalTTC = Math.Round(sales.Sum(s => s.TotalTTC), 3),
                CreditNotesCount = refunds.Count,
                CreditNotesAmountTTC = Math.Round(Math.Abs(refunds.Sum(r => r.TotalTTC)), 3)
            });
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PDF
    // ─────────────────────────────────────────────────────────────────────────

    public async Task<Result<byte[]>> GetPdfAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var invoice = await _db.PlatformInvoices
            .Include(i => i.Lines)
            .Include(i => i.Receipts)
            .AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null)
            return Result.Failure<byte[]>(Error.NotFound(nameof(PlatformInvoice), id));

        var fiscal = await _fiscalService.GetAsync(cancellationToken);
        var dto = await BuildDetailDtoAsync(invoice, cancellationToken);

        if (!string.IsNullOrWhiteSpace(invoice.PdfStorageKey))
        {
            try
            {
                var stored = await ReadBlobAsync(invoice.PdfStorageKey!, cancellationToken);
                if (stored is { Length: > 0 }) return Result.Success(stored);
            }
            catch
            {
                // bascule sur re-rendu
            }
        }

        var bytes = _pdfRenderer.RenderInvoice(dto, fiscal);
        return Result.Success(bytes);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private async Task<PlatformInvoiceDetailDto> BuildDetailDtoAsync(PlatformInvoice invoice, CancellationToken cancellationToken)
    {
        var tenant = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == invoice.TenantId)
            .Select(t => new { t.CompanyName, NifValue = t.NIF.Value })
            .FirstOrDefaultAsync(cancellationToken);

        string? relatedNumber = null;
        if (invoice.RelatedInvoiceId.HasValue)
        {
            relatedNumber = await _db.PlatformInvoices.AsNoTracking()
                .Where(i => i.Id == invoice.RelatedInvoiceId.Value)
                .Select(i => i.Number)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var totalReceived = invoice.TotalReceived();
        var remaining = Math.Max(0m, invoice.TotalTTC - totalReceived);

        return new PlatformInvoiceDetailDto
        {
            Id = invoice.Id,
            TenantId = invoice.TenantId,
            TenantName = tenant?.CompanyName ?? "—",
            TenantNif = tenant?.NifValue,
            Number = invoice.Number,
            SequenceYear = invoice.SequenceYear,
            InvoiceDate = invoice.InvoiceDate,
            DueDate = invoice.DueDate,
            PeriodFrom = invoice.PeriodFrom,
            PeriodTo = invoice.PeriodTo,
            BillingType = invoice.BillingType,
            BillingTypeDisplay = invoice.BillingType.ToDisplayString(),
            Status = invoice.Status,
            StatusDisplay = invoice.Status.ToDisplayString(),
            SubtotalHT = invoice.SubtotalHT,
            VatAmount = invoice.VatAmount,
            DiscountAmount = invoice.DiscountAmount,
            CreditsApplied = invoice.CreditsApplied,
            StampDuty = invoice.StampDuty,
            TotalTTC = invoice.TotalTTC,
            TotalReceived = totalReceived,
            RemainingAmount = remaining,
            CouponRedemptionId = invoice.CouponRedemptionId,
            PdfStorageKey = invoice.PdfStorageKey,
            LegalMentions = invoice.LegalMentions,
            IssuedAt = invoice.IssuedAt,
            PaidAt = invoice.PaidAt,
            CancelledAt = invoice.CancelledAt,
            CancelledReason = invoice.CancelledReason,
            RelatedInvoiceId = invoice.RelatedInvoiceId,
            RelatedInvoiceNumber = relatedNumber,
            CreatedAt = invoice.CreatedAt,
            Lines = invoice.Lines.Select(l => new PlatformInvoiceLineDto
            {
                Id = l.Id,
                Description = l.Description,
                Quantity = l.Quantity,
                UnitPriceHT = l.UnitPriceHT,
                VatRate = l.VatRate,
                LineTotalHT = l.LineTotalHT,
                LineTotalTTC = l.LineTotalTTC,
                RelatedPeriodFrom = l.RelatedPeriodFrom,
                RelatedPeriodTo = l.RelatedPeriodTo
            }).ToList(),
            Receipts = invoice.Receipts.Select(r => new PlatformReceiptDto
            {
                Id = r.Id,
                InvoiceId = r.InvoiceId,
                ReceiptNumber = r.ReceiptNumber,
                PaymentDate = r.PaymentDate,
                Method = r.Method,
                MethodDisplay = r.Method.ToDisplayString(),
                Status = r.Status,
                StatusDisplay = r.Status.ToDisplayString(),
                Reference = r.Reference,
                AmountTND = r.AmountTND,
                ProviderTxId = r.ProviderTxId,
                ConfirmedAt = r.ConfirmedAt,
                CancelledAt = r.CancelledAt,
                CancelledReason = r.CancelledReason,
                CreatedAt = r.CreatedAt
            }).ToList()
        };
    }

    /// <summary>Stockage PDF simple sur disque (relatif au répertoire de l'app).</summary>
    private static async Task<string> SaveBlobAsync(string relativeKey, byte[] bytes, CancellationToken cancellationToken)
    {
        var rootPath = Path.Combine(AppContext.BaseDirectory, "storage");
        var fullPath = Path.Combine(rootPath, relativeKey);
        var dir = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        await File.WriteAllBytesAsync(fullPath, bytes, cancellationToken);
        return relativeKey;
    }

    private static async Task<byte[]> ReadBlobAsync(string relativeKey, CancellationToken cancellationToken)
    {
        var rootPath = Path.Combine(AppContext.BaseDirectory, "storage");
        var fullPath = Path.Combine(rootPath, relativeKey);
        if (!File.Exists(fullPath)) return Array.Empty<byte>();
        return await File.ReadAllBytesAsync(fullPath, cancellationToken);
    }
}
