using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Files;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.FirmGovernance;
using FactuTrust.Domain.Entities.Honoraires;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Honoraires;

public sealed class HonorairesBillingService : IHonorairesBillingService
{
    private readonly ITenantDbContextFactory _tenantFactory;
    private readonly MasterDbContext _master;
    private readonly ITenantContext _tenantContext;
    private readonly IDocumentNumberService _numbering;
    private readonly IFirmAssignmentService _assignments;
    private readonly IFirmGovernanceService _governance;
    private readonly IConfiguration _configuration;
    private readonly ILogger<HonorairesBillingService> _logger;

    public HonorairesBillingService(
        ITenantDbContextFactory tenantFactory,
        MasterDbContext master,
        ITenantContext tenantContext,
        IDocumentNumberService numbering,
        IFirmAssignmentService assignments,
        IFirmGovernanceService governance,
        IConfiguration configuration,
        ILogger<HonorairesBillingService> logger)
    {
        _tenantFactory = tenantFactory;
        _master = master;
        _tenantContext = tenantContext;
        _numbering = numbering;
        _assignments = assignments;
        _governance = governance;
        _configuration = configuration;
        _logger = logger;
    }

    private async Task<Result<Guid>> EnsureFirmTenantAsync(CancellationToken ct)
    {
        var tenantId = _tenantContext.TenantId;
        if (tenantId is null || tenantId == Guid.Empty)
            return Result.Failure<Guid>(Error.Validation("Tenant", "Contexte cabinet introuvable"));

        var kind = await _master.Tenants.AsNoTracking()
            .Where(t => t.Id == tenantId.Value)
            .Select(t => t.Kind)
            .FirstOrDefaultAsync(ct);

        if (kind != TenantKind.AccountingFirm)
            return Result.Failure<Guid>(Error.Validation("Tenant", "Le module Honoraires est réservé aux cabinets"));

        return Result.Success(tenantId.Value);
    }

    public async Task<Result<Guid>> CreateInvoiceDraftAsync(UpsertHonorairesInvoiceDto dto, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure<Guid>(tenant.Error);

        var create = HonorairesInvoice.CreateDraft(
            dto.FirmClientAssignmentId, dto.ClientName, dto.IssueDate, dto.DueDate, dto.Currency);
        if (create.IsFailure) return Result.Failure<Guid>(create.Error);

        var invoice = create.Value;
        ApplyInvoiceDto(invoice, dto);
        var lines = await ApplyLinesAsync(tenant.Value, invoice, dto.Lines, cancellationToken);
        if (lines.IsFailure) return Result.Failure<Guid>(lines.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        db.HonorairesInvoices.Add(invoice);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(invoice.Id);
    }

    public async Task<Result> UpdateInvoiceDraftAsync(Guid id, UpsertHonorairesInvoiceDto dto, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var invoice = await db.HonorairesInvoices.Include(i => i.Lines).FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null) return Result.Failure(Error.NotFound("HonorairesInvoice", id));
        if (!invoice.Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Seul un brouillon peut être modifié"));

        ApplyInvoiceDto(invoice, dto);
        var lines = await ApplyLinesAsync(tenant.Value, invoice, dto.Lines, cancellationToken);
        if (lines.IsFailure) return lines;

        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ValidateInvoiceAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var invoice = await db.HonorairesInvoices.Include(i => i.Lines).FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null) return Result.Failure(Error.NotFound("HonorairesInvoice", id));

        if (invoice.IsCreditNote && invoice.LinkedInvoiceId.HasValue)
        {
            var amountCheck = await ValidateCreditNoteAmountAsync(db, invoice, cancellationToken);
            if (amountCheck.IsFailure) return amountCheck;
        }

        var docType = invoice.IsCreditNote ? NumberingDocumentType.FeeCreditNote : NumberingDocumentType.FeeInvoice;
        var year = invoice.IssueDate.Year;
        var reserved = await _numbering.ReserveNextAsync(tenant.Value, docType, year, invoice.IssueDate, cancellationToken);
        var assign = invoice.AssignNumber(reserved.Value);
        if (assign.IsFailure) return assign;

        var validate = invoice.Validate();
        if (validate.IsFailure) return validate;

        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> CancelInvoiceAsync(Guid id, string? reason = null, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var invoice = await db.HonorairesInvoices.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null) return Result.Failure(Error.NotFound("HonorairesInvoice", id));

        var result = invoice.Cancel(reason);
        if (result.IsFailure) return result;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<Guid>> CreateCreditNoteAsync(CreateHonorairesCreditNoteDto dto, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure<Guid>(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var source = await db.HonorairesInvoices.AsNoTracking().Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == dto.LinkedInvoiceId, cancellationToken);
        if (source is null) return Result.Failure<Guid>(Error.NotFound("HonorairesInvoice", dto.LinkedInvoiceId));
        if (source.Type != HonorairesDocumentType.Invoice)
            return Result.Failure<Guid>(Error.Validation("LinkedInvoiceId", "Seule une facture peut être rectifiée par un avoir"));
        if (source.IsCreditNote)
            return Result.Failure<Guid>(Error.Validation("LinkedInvoiceId", "Impossible de créer un avoir sur un avoir"));
        if (source.Status == HonorairesInvoiceStatus.Cancelled)
            return Result.Failure<Guid>(Error.Validation("Status", "Impossible de créer un avoir sur une facture annulée"));
        if (source.Status is not (HonorairesInvoiceStatus.Validated or HonorairesInvoiceStatus.Paid or HonorairesInvoiceStatus.PartiallyPaid))
            return Result.Failure<Guid>(Error.Validation("Status", "La facture source doit être finalisée"));

        var existingDraft = await db.HonorairesInvoices.AsNoTracking()
            .AnyAsync(i => i.LinkedInvoiceId == source.Id
                && i.Type == HonorairesDocumentType.CreditNote
                && i.Status == HonorairesInvoiceStatus.Draft, cancellationToken);
        if (existingDraft)
            return Result.Failure<Guid>(Error.Validation("LinkedInvoiceId", "Un avoir brouillon existe déjà pour cette facture"));

        var create = HonorairesInvoice.CreateCreditNoteDraft(
            source.FirmClientAssignmentId, source.ClientName, source.Id, dto.IssueDate, dto.DueDate, source.Currency);
        if (create.IsFailure) return Result.Failure<Guid>(create.Error);

        var credit = create.Value;
        credit.SetClientSnapshot(source.ClientName, source.ClientNif, source.ClientAddress, source.ContactName, source.ContactEmail, source.ContactPhone);
        credit.SetNotes(dto.Notes);
        credit.SetReference(source.Number is null ? null : $"Avoir sur {source.Number}");

        if (dto.Lines is { Count: > 0 })
        {
            var lines = await ApplyLinesAsync(tenant.Value, credit, dto.Lines, cancellationToken);
            if (lines.IsFailure) return Result.Failure<Guid>(lines.Error);
        }
        else
        {
            // Copie snapshot historique : conserver ActivityCode même si désactivé depuis.
            var mapped = source.Lines.OrderBy(l => l.LineNumber).Select(l => (
                l.ActivityCode,
                l.Designation,
                l.Description,
                l.Quantity,
                l.UnitPrice,
                l.VatRate,
                l.DiscountPercent
            ));
            var lines = credit.ReplaceLines(mapped);
            if (lines.IsFailure) return Result.Failure<Guid>(lines.Error);
        }

        db.HonorairesInvoices.Add(credit);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(credit.Id);
    }

    public async Task<HonorairesInvoiceDto?> GetInvoiceAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var invoice = await db.HonorairesInvoices.AsNoTracking()
            .Include(i => i.Lines)
            .Include(i => i.Payments)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null) return null;

        string? linkedNumber = null;
        if (invoice.LinkedInvoiceId.HasValue)
        {
            linkedNumber = await db.HonorairesInvoices.AsNoTracking()
                .Where(i => i.Id == invoice.LinkedInvoiceId.Value)
                .Select(i => i.Number)
                .FirstOrDefaultAsync(cancellationToken);
        }

        return MapInvoice(invoice, linkedNumber);
    }

    public async Task<HonorairesPagedResult<HonorairesInvoiceListItemDto>> ListInvoicesAsync(
        HonorairesDocumentType? type, HonorairesInvoiceStatus? status, Guid? assignmentId, string? search,
        int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / 100);
        pageSize = Math.Clamp(pageSize, 1, 100);
        await using var db = _tenantFactory.CreateIsolatedContext();
        var q = db.HonorairesInvoices.AsNoTracking().AsQueryable();
        if (type.HasValue) q = q.Where(i => i.Type == type);
        if (status.HasValue) q = q.Where(i => i.Status == status);
        if (assignmentId.HasValue) q = q.Where(i => i.FirmClientAssignmentId == assignmentId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(i => (i.Number != null && i.Number.Contains(s)) || i.ClientName.Contains(s));
        }

        var total = await q.CountAsync(cancellationToken);
        var rows = await q.OrderByDescending(i => i.IssueDate).ThenByDescending(i => i.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(cancellationToken);
        var items = rows.Select(i => new HonorairesInvoiceListItemDto
        {
            Id = i.Id,
            Number = i.Number,
            IssueDate = i.IssueDate,
            DueDate = i.DueDate,
            Status = i.Status,
            StatusDisplay = i.Status.ToDisplayString(),
            Type = i.Type,
            LinkedInvoiceId = i.LinkedInvoiceId,
            ClientName = i.ClientName,
            FirmClientAssignmentId = i.FirmClientAssignmentId,
            TotalAmount = i.TotalAmount.Amount,
            AmountDue = Math.Max(0m, Math.Abs(i.TotalAmount.Amount) - i.AmountPaid.Amount),
            Currency = i.Currency
        }).ToList();

        return new HonorairesPagedResult<HonorairesInvoiceListItemDto>
        {
            Items = items, TotalCount = total, Page = page, PageSize = pageSize
        };
    }

    public async Task<string> PreviewInvoiceNumberAsync(HonorairesDocumentType type, DateTime referenceDate, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return "N° Provisoire";
        var docType = type == HonorairesDocumentType.CreditNote ? NumberingDocumentType.FeeCreditNote : NumberingDocumentType.FeeInvoice;
        return await _numbering.PreviewNextAsync(tenant.Value, docType, referenceDate.Year, referenceDate, cancellationToken);
    }

    public async Task<Result<byte[]>> ExportInvoicePdfAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var invoice = await db.HonorairesInvoices.AsNoTracking().Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invoice is null) return Result.Failure<byte[]>(Error.NotFound("HonorairesInvoice", id));
        return Result.Success(HonorairesPdfRenderer.RenderInvoice(invoice));
    }

    public async Task<Result<Guid>> CreateQuoteDraftAsync(UpsertHonorairesQuoteDto dto, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure<Guid>(tenant.Error);

        var create = HonorairesQuote.CreateDraft(dto.FirmClientAssignmentId, dto.ClientName, dto.IssueDate, dto.ValidUntil, dto.Currency);
        if (create.IsFailure) return Result.Failure<Guid>(create.Error);
        var quote = create.Value;
        ApplyQuoteDto(quote, dto);
        var lines = await ApplyQuoteLinesAsync(tenant.Value, quote, dto.Lines, cancellationToken);
        if (lines.IsFailure) return Result.Failure<Guid>(lines.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        db.HonorairesQuotes.Add(quote);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(quote.Id);
    }

    public async Task<Result> UpdateQuoteDraftAsync(Guid id, UpsertHonorairesQuoteDto dto, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.Include(q => q.Lines).FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
        if (quote is null) return Result.Failure(Error.NotFound("HonorairesQuote", id));
        if (!quote.Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Seul un brouillon peut être modifié"));

        ApplyQuoteDto(quote, dto);
        var lines = await ApplyQuoteLinesAsync(tenant.Value, quote, dto.Lines, cancellationToken);
        if (lines.IsFailure) return lines;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SendQuoteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.Include(q => q.Lines).FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
        if (quote is null) return Result.Failure(Error.NotFound("HonorairesQuote", id));

        if (string.IsNullOrWhiteSpace(quote.Number))
        {
            var reserved = await _numbering.ReserveNextAsync(
                tenant.Value, NumberingDocumentType.FeeQuote, quote.IssueDate.Year, quote.IssueDate, cancellationToken);
            var assign = quote.AssignNumber(reserved.Value);
            if (assign.IsFailure) return assign;
        }

        var send = quote.MarkSent();
        if (send.IsFailure) return send;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> AcceptQuoteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
        if (quote is null) return Result.Failure(Error.NotFound("HonorairesQuote", id));
        var result = quote.Accept();
        if (result.IsFailure) return result;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> RejectQuoteAsync(Guid id, string? reason = null, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
        if (quote is null) return Result.Failure(Error.NotFound("HonorairesQuote", id));
        var result = quote.Reject(reason);
        if (result.IsFailure) return result;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> CancelQuoteAsync(Guid id, string? reason = null, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
        if (quote is null) return Result.Failure(Error.NotFound("HonorairesQuote", id));
        var result = quote.Cancel(reason);
        if (result.IsFailure) return result;
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<Guid>> ConvertQuoteToInvoiceAsync(Guid quoteId, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure<Guid>(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.Include(q => q.Lines).FirstOrDefaultAsync(q => q.Id == quoteId, cancellationToken);
        if (quote is null) return Result.Failure<Guid>(Error.NotFound("HonorairesQuote", quoteId));
        if (!quote.Status.CanBeConverted())
            return Result.Failure<Guid>(Error.Validation("Status", "Seuls les devis acceptés peuvent être convertis"));

        var create = HonorairesInvoice.CreateDraft(
            quote.FirmClientAssignmentId, quote.ClientName, DateTime.UtcNow.Date, null, quote.Currency);
        if (create.IsFailure) return Result.Failure<Guid>(create.Error);

        var invoice = create.Value;
        invoice.SetClientSnapshot(quote.ClientName, quote.ClientNif, quote.ClientAddress, quote.ContactName, quote.ContactEmail, quote.ContactPhone);
        invoice.SetNotes(quote.Notes);
        invoice.SetPaymentTerms(quote.PaymentTerms);
        invoice.SetReference(quote.Number is null ? null : $"Devis n° {quote.Number}");
        invoice.SetSourceQuoteId(quote.Id);

        foreach (var line in quote.Lines.OrderBy(l => l.LineNumber))
        {
            var add = invoice.AddLine(
                line.Designation, line.Description, line.Quantity, line.UnitPrice, line.VatRate, line.DiscountPercent, line.ActivityCode);
            if (add.IsFailure) return Result.Failure<Guid>(add.Error);
        }

        var reserved = await _numbering.ReserveNextAsync(
            tenant.Value, NumberingDocumentType.FeeInvoice, invoice.IssueDate.Year, invoice.IssueDate, cancellationToken);
        var assign = invoice.AssignNumber(reserved.Value);
        if (assign.IsFailure) return Result.Failure<Guid>(assign.Error);
        var validate = invoice.Validate();
        if (validate.IsFailure) return Result.Failure<Guid>(validate.Error);

        var converted = quote.MarkAsConverted(invoice.Id);
        if (converted.IsFailure) return Result.Failure<Guid>(converted.Error);

        db.HonorairesInvoices.Add(invoice);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(invoice.Id);
    }

    public async Task<HonorairesQuoteDto?> GetQuoteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.AsNoTracking().Include(q => q.Lines)
            .FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
        return quote is null ? null : MapQuote(quote);
    }

    public async Task<HonorairesPagedResult<HonorairesQuoteListItemDto>> ListQuotesAsync(
        HonorairesQuoteStatus? status, Guid? assignmentId, string? search,
        int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = Math.Clamp(page, 1, int.MaxValue / 100);
        pageSize = Math.Clamp(pageSize, 1, 100);
        await using var db = _tenantFactory.CreateIsolatedContext();
        var q = db.HonorairesQuotes.AsNoTracking().AsQueryable();
        if (status.HasValue) q = q.Where(x => x.Status == status);
        if (assignmentId.HasValue) q = q.Where(x => x.FirmClientAssignmentId == assignmentId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(x => (x.Number != null && x.Number.Contains(s)) || x.ClientName.Contains(s));
        }

        var total = await q.CountAsync(cancellationToken);
        var rows = await q.OrderByDescending(x => x.IssueDate)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(cancellationToken);
        var items = rows.Select(x => new HonorairesQuoteListItemDto
        {
            Id = x.Id,
            Number = x.Number,
            IssueDate = x.IssueDate,
            Status = x.Status,
            StatusDisplay = x.Status.ToDisplayString(),
            ClientName = x.ClientName,
            FirmClientAssignmentId = x.FirmClientAssignmentId,
            TotalAmount = x.TotalAmount.Amount,
            Currency = x.Currency
        }).ToList();

        return new HonorairesPagedResult<HonorairesQuoteListItemDto>
        {
            Items = items, TotalCount = total, Page = page, PageSize = pageSize
        };
    }

    public async Task<string> PreviewQuoteNumberAsync(DateTime referenceDate, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return "N° Provisoire";
        return await _numbering.PreviewNextAsync(tenant.Value, NumberingDocumentType.FeeQuote, referenceDate.Year, referenceDate, cancellationToken);
    }

    public async Task<Result<byte[]>> ExportQuotePdfAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var quote = await db.HonorairesQuotes.AsNoTracking().Include(q => q.Lines)
            .FirstOrDefaultAsync(q => q.Id == id, cancellationToken);
        if (quote is null) return Result.Failure<byte[]>(Error.NotFound("HonorairesQuote", id));
        return Result.Success(HonorairesPdfRenderer.RenderQuote(quote));
    }

    public async Task<Result<Guid>> RecordPaymentAsync(Guid invoiceId, RecordHonorairesPaymentDto dto, CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure<Guid>(tenant.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        var invoice = await db.HonorairesInvoices.Include(i => i.Payments)
            .FirstOrDefaultAsync(i => i.Id == invoiceId, cancellationToken);
        if (invoice is null) return Result.Failure<Guid>(Error.NotFound("HonorairesInvoice", invoiceId));

        var paymentResult = HonorairesPayment.Create(
            invoice,
            dto.PaymentDate,
            Money.Create(dto.Amount, invoice.Currency),
            Money.Create(dto.ClientWithholdingAmount, invoice.Currency),
            dto.Method,
            dto.Reference,
            dto.Notes,
            dto.BankAccountLabel);
        if (paymentResult.IsFailure) return Result.Failure<Guid>(paymentResult.Error);

        var record = invoice.RecordPayment(paymentResult.Value);
        if (record.IsFailure) return Result.Failure<Guid>(record.Error);

        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(paymentResult.Value.Id);
    }

    public async Task<IReadOnlyList<HonorairesPaymentDto>> ListPaymentsAsync(Guid? invoiceId, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var q = db.HonorairesPayments.AsNoTracking().Include(p => p.Invoice).AsQueryable();
        if (invoiceId.HasValue) q = q.Where(p => p.HonorairesInvoiceId == invoiceId);
        var rows = await q.OrderByDescending(p => p.PaymentDate).Take(200).ToListAsync(cancellationToken);
        return rows.Select(p => new HonorairesPaymentDto
        {
            Id = p.Id,
            HonorairesInvoiceId = p.HonorairesInvoiceId,
            InvoiceNumber = p.Invoice.Number,
            ClientName = p.Invoice.ClientName,
            PaymentDate = p.PaymentDate,
            Amount = p.Amount.Amount,
            ClientWithholdingAmount = p.ClientWithholdingAmount.Amount,
            AppliedAmount = p.AppliedAmount,
            Method = p.Method,
            MethodDisplay = p.Method.ToDisplayString(),
            Reference = p.Reference,
            Notes = p.Notes,
            BankAccountLabel = p.BankAccountLabel
        }).ToList();
    }

    public async Task<IReadOnlyList<BillableDossierDto>> ListBillableDossiersAsync(CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Array.Empty<BillableDossierDto>();

        var clients = await _assignments.GetActiveClientsAsync(tenant.Value, cancellationToken);
        var assignmentIds = clients.Select(c => c.AssignmentId).ToList();
        var files = await _master.PermanentFiles.AsNoTracking()
            .Where(p => assignmentIds.Contains(p.FirmClientAssignmentId))
            .Select(p => new
            {
                p.FirmClientAssignmentId,
                p.CompanyName,
                p.Nif,
                p.AnnualFeeAmount,
                p.BillingFrequency
            })
            .ToDictionaryAsync(p => p.FirmClientAssignmentId, cancellationToken);

        var snapshots = await _master.FirmClientAssignments.AsNoTracking()
            .Where(a => assignmentIds.Contains(a.Id))
            .Select(a => new { a.Id, a.CompanyProfileSnapshotJson })
            .ToListAsync(cancellationToken);

        return clients.Select(c =>
        {
            files.TryGetValue(c.AssignmentId, out var pf);
            var snap = snapshots.FirstOrDefault(s => s.Id == c.AssignmentId);
            CompanyProfileSnapshotDto? profile = null;
            if (!string.IsNullOrWhiteSpace(snap?.CompanyProfileSnapshotJson))
            {
                try
                {
                    profile = System.Text.Json.JsonSerializer.Deserialize<CompanyProfileSnapshotDto>(snap.CompanyProfileSnapshotJson!);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Snapshot dossier {AssignmentId} illisible", c.AssignmentId);
                }
            }

            var freq = pf?.BillingFrequency;
            var fee = pf?.AnnualFeeAmount;
            string? suggested = null;
            if (fee is > 0 && freq.HasValue)
            {
                suggested = freq.Value switch
                {
                    BillingFrequency.Monthly => $"Honoraires mensuels — {c.CompanyName}",
                    BillingFrequency.Quarterly => $"Honoraires trimestriels — {c.CompanyName}",
                    BillingFrequency.Annual => $"Honoraires annuels — {c.CompanyName}",
                    _ => $"Honoraires — {c.CompanyName}"
                };
            }

            var address = profile is null
                ? null
                : string.Join(", ", new[] { profile.Street, profile.City, profile.Governorate }.Where(x => !string.IsNullOrWhiteSpace(x)));

            return new BillableDossierDto
            {
                AssignmentId = c.AssignmentId,
                CompanyTenantId = c.CompanyTenantId,
                CompanyName = pf?.CompanyName ?? c.CompanyName,
                Nif = pf?.Nif ?? profile?.Nif,
                Address = address,
                ContactEmail = profile?.Email,
                ContactPhone = profile?.Phone,
                AnnualFeeAmount = fee,
                BillingFrequency = freq,
                SuggestedLineDesignation = suggested
            };
        }).ToList();
    }

    public async Task<Result<Guid>> AddAttachmentAsync(
        HonorairesAttachmentDocumentKind kind, Guid documentId,
        string fileName, string contentType, Stream content, long sizeBytes,
        CancellationToken cancellationToken = default)
    {
        var tenant = await EnsureFirmTenantAsync(cancellationToken);
        if (tenant.IsFailure) return Result.Failure<Guid>(tenant.Error);

        // ReadHeaderAsync loops until the full header is read or EOF, rather than trusting a single
        // ReadAsync call to fill the buffer (not guaranteed by Stream semantics — a chunked/network
        // stream could otherwise cause a valid upload to be wrongly rejected as a magic-byte mismatch).
        var (header, headerRead) = await UploadValidator.ReadHeaderAsync(content, UploadValidator.RequiredHeaderBytes, cancellationToken);

        var validation = UploadValidator.Validate(fileName, contentType, sizeBytes, header.AsMemory(0, headerRead));
        if (!validation.IsValid)
            return Result.Failure<Guid>(Error.Validation("File", validation.ErrorMessage!));
        var safeName = validation.SafeFileName!;

        var basePath = _configuration["AccountingAttachments:BasePath"]
            ?? Path.Combine(AppContext.BaseDirectory, "App_Data", "attachments");
        var baseFullPath = Path.GetFullPath(basePath);
        var relative = Path.Combine("tenants", tenant.Value.ToString("N"), "honoraires", kind.ToString().ToLowerInvariant(), documentId.ToString("N"), $"{Guid.NewGuid():N}_{safeName}");
        var full = Path.GetFullPath(Path.Combine(baseFullPath, relative));

        // Containment check via Path.GetRelativePath: a simple StartsWith(basePath) would wrongly accept
        // a sibling directory that happens to share the same string prefix (e.g. "/data/safe-other" starts
        // with "/data/safe"). GetRelativePath is only safe/contained if it does not escape upward ("..")
        // and is not itself rooted (which would mean full and baseFullPath share no common root).
        if (!PathContainment.IsContained(baseFullPath, full))
            return Result.Failure<Guid>(Error.Validation("FileName", "Chemin de fichier invalide"));

        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await using (var fs = File.Create(full))
        {
            if (headerRead > 0)
                await fs.WriteAsync(header.AsMemory(0, headerRead), cancellationToken);
            await content.CopyToAsync(fs, cancellationToken);
        }

        var create = HonorairesAttachment.Create(kind, documentId, safeName, contentType, sizeBytes, relative.Replace('\\', '/'), null);
        if (create.IsFailure) return Result.Failure<Guid>(create.Error);

        await using var db = _tenantFactory.CreateIsolatedContext();
        db.HonorairesAttachments.Add(create.Value);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(create.Value.Id);
    }

    public async Task<IReadOnlyList<HonorairesAttachmentListItemDto>> ListAttachmentsAsync(
        HonorairesAttachmentDocumentKind kind, Guid documentId, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        return await db.HonorairesAttachments.AsNoTracking()
            .Where(a => a.DocumentKind == kind && a.DocumentId == documentId)
            .OrderByDescending(a => a.UploadedAt)
            .Select(a => new HonorairesAttachmentListItemDto
            {
                Id = a.Id,
                FileName = a.FileName,
                ContentType = a.ContentType,
                SizeBytes = a.SizeBytes,
                UploadedAt = a.UploadedAt
            }).ToListAsync(cancellationToken);
    }

    public async Task<Result> DeleteAttachmentAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        await using var db = _tenantFactory.CreateIsolatedContext();
        var att = await db.HonorairesAttachments.FirstOrDefaultAsync(a => a.Id == attachmentId, cancellationToken);
        if (att is null) return Result.Failure(Error.NotFound("HonorairesAttachment", attachmentId));
        db.HonorairesAttachments.Remove(att);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private static void ApplyInvoiceDto(HonorairesInvoice invoice, UpsertHonorairesInvoiceDto dto)
    {
        invoice.SetClientSnapshot(dto.ClientName, dto.ClientNif, dto.ClientAddress, dto.ContactName, dto.ContactEmail, dto.ContactPhone);
        invoice.SetDates(dto.IssueDate, dto.DueDate);
        invoice.SetReference(dto.Reference);
        invoice.SetNotes(dto.Notes);
        invoice.SetPaymentTerms(dto.PaymentTerms);
        invoice.SetPaymentInfo(dto.PaymentMethod, dto.BankAccountLabel);
        invoice.SetWithholdingAmount(Money.Create(dto.WithholdingAmount, invoice.Currency));
        invoice.SetRecurring(dto.IsRecurring, dto.RecurrenceFrequency);
        if (dto.SourceQuoteId.HasValue)
            invoice.SetSourceQuoteId(dto.SourceQuoteId.Value);
    }

    private static void ApplyQuoteDto(HonorairesQuote quote, UpsertHonorairesQuoteDto dto)
    {
        quote.SetClientSnapshot(dto.ClientName, dto.ClientNif, dto.ClientAddress, dto.ContactName, dto.ContactEmail, dto.ContactPhone);
        quote.SetDates(dto.IssueDate, dto.ValidUntil);
        quote.SetReference(dto.Reference);
        quote.SetNotes(dto.Notes);
        quote.SetPaymentTerms(dto.PaymentTerms);
    }

    private async Task<Result> ApplyLinesAsync(
        Guid firmTenantId,
        HonorairesInvoice invoice,
        List<HonorairesLineWriteDto> lines,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveLineWritesAsync(firmTenantId, lines, cancellationToken);
        if (resolved.IsFailure) return Result.Failure(resolved.Error);

        var mapped = resolved.Value.Select(l => (
            l.ActivityCode,
            l.Designation,
            l.Description,
            l.Quantity,
            Money.Create(l.UnitPrice, invoice.Currency),
            VatRateExtensions.FromPercent(l.VatRate),
            l.DiscountPercent
        ));
        return invoice.ReplaceLines(mapped);
    }

    private async Task<Result> ApplyQuoteLinesAsync(
        Guid firmTenantId,
        HonorairesQuote quote,
        List<HonorairesLineWriteDto> lines,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveLineWritesAsync(firmTenantId, lines, cancellationToken);
        if (resolved.IsFailure) return Result.Failure(resolved.Error);

        var mapped = resolved.Value.Select(l => (
            l.ActivityCode,
            l.Designation,
            l.Description,
            l.Quantity,
            Money.Create(l.UnitPrice, quote.Currency),
            VatRateExtensions.FromPercent(l.VatRate),
            l.DiscountPercent
        ));
        return quote.ReplaceLines(mapped);
    }

    /// <summary>
    /// Valide les codes activité et force la désignation = libellé catalogue quand un référentiel actif existe.
    /// Sans codes actifs : comportement legacy (désignation libre, ActivityCode optionnel).
    /// </summary>
    private async Task<Result<List<HonorairesLineWriteDto>>> ResolveLineWritesAsync(
        Guid firmTenantId,
        List<HonorairesLineWriteDto> lines,
        CancellationToken cancellationToken)
    {
        var activeCodes = await _governance.ListActivityCodesAsync(
            firmTenantId, includeInactive: false, billableOnly: false, cancellationToken);
        var byCode = activeCodes.ToDictionary(c => c.Code, StringComparer.OrdinalIgnoreCase);
        var hasCatalog = activeCodes.Count > 0;

        var resolved = new List<HonorairesLineWriteDto>(lines.Count);
        foreach (var line in lines)
        {
            var normalized = FirmActivityCode.NormalizeCode(line.ActivityCode);
            var activityCode = string.IsNullOrEmpty(normalized) ? null : normalized;

            if (hasCatalog)
            {
                if (activityCode is null)
                    return Result.Failure<List<HonorairesLineWriteDto>>(
                        Error.Validation("ActivityCode", "Sélectionnez un type d'activité"));

                if (!byCode.TryGetValue(activityCode, out var catalog))
                    return Result.Failure<List<HonorairesLineWriteDto>>(
                        Error.Validation(
                            "ActivityCode",
                            $"Le code activité « {activityCode} » ne fait pas partie du référentiel du cabinet."));

                resolved.Add(line with
                {
                    ActivityCode = catalog.Code,
                    Designation = catalog.Label
                });
            }
            else
            {
                resolved.Add(line with { ActivityCode = activityCode });
            }
        }

        return Result.Success(resolved);
    }

    private static async Task<Result> ValidateCreditNoteAmountAsync(
        TenantDbContext db,
        HonorairesInvoice creditNote,
        CancellationToken cancellationToken)
    {
        if (!creditNote.LinkedInvoiceId.HasValue)
            return Result.Failure(Error.Validation("LinkedInvoiceId", "La facture d'origine est obligatoire pour un avoir"));

        var sourceId = creditNote.LinkedInvoiceId.Value;
        var source = await db.HonorairesInvoices.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == sourceId, cancellationToken);
        if (source is null)
            return Result.Failure(Error.Validation("LinkedInvoiceId", "Facture d'origine introuvable"));

        var sourceMagnitude = Math.Abs(source.TotalAmount.Amount);
        var creditMagnitude = Math.Abs(creditNote.TotalAmount.Amount);

        if (creditMagnitude > sourceMagnitude + 0.0005m)
            return Result.Failure(Error.Validation(
                "TotalAmount",
                $"Le montant de l'avoir ({creditMagnitude:N3} {creditNote.Currency}) dépasse la facture originale ({sourceMagnitude:N3} {source.Currency})"));

        var otherAmounts = await db.HonorairesInvoices.AsNoTracking()
            .Where(i => i.LinkedInvoiceId == sourceId
                && i.Type == HonorairesDocumentType.CreditNote
                && i.Id != creditNote.Id
                && i.Status != HonorairesInvoiceStatus.Cancelled
                && i.Status != HonorairesInvoiceStatus.Draft)
            .Select(i => i.TotalAmount.Amount)
            .ToListAsync(cancellationToken);

        var otherCreditsMagnitude = otherAmounts.Sum(a => Math.Abs(a));

        if (otherCreditsMagnitude + creditMagnitude > sourceMagnitude + 0.0005m)
            return Result.Failure(Error.Validation(
                "TotalAmount",
                $"Le cumul des avoirs ({otherCreditsMagnitude + creditMagnitude:N3} {creditNote.Currency}) dépasse la facture originale ({sourceMagnitude:N3} {source.Currency})"));

        return Result.Success();
    }

    private static HonorairesInvoiceDto MapInvoice(HonorairesInvoice i, string? linkedInvoiceNumber = null) => new()
    {
        Id = i.Id,
        Number = i.Number,
        IssueDate = i.IssueDate,
        DueDate = i.DueDate,
        Status = i.Status,
        StatusDisplay = i.Status.ToDisplayString(),
        Type = i.Type,
        IsCreditNote = i.IsCreditNote,
        FirmClientAssignmentId = i.FirmClientAssignmentId,
        ClientName = i.ClientName,
        ClientNif = i.ClientNif,
        ClientAddress = i.ClientAddress,
        ContactName = i.ContactName,
        ContactEmail = i.ContactEmail,
        ContactPhone = i.ContactPhone,
        Reference = i.Reference,
        Notes = i.Notes,
        PaymentTerms = i.PaymentTerms,
        PaymentMethod = i.PaymentMethod,
        BankAccountLabel = i.BankAccountLabel,
        Currency = i.Currency,
        SourceQuoteId = i.SourceQuoteId,
        LinkedInvoiceId = i.LinkedInvoiceId,
        LinkedInvoiceNumber = linkedInvoiceNumber,
        SubTotal = i.SubTotal.Amount,
        TotalVat = i.TotalVat.Amount,
        WithholdingAmount = i.WithholdingAmount.Amount,
        TotalAmount = i.TotalAmount.Amount,
        AmountPaid = i.AmountPaid.Amount,
        AmountDue = i.AmountDue,
        IsRecurring = i.IsRecurring,
        RecurrenceFrequency = i.RecurrenceFrequency,
        Lines = i.Lines.OrderBy(l => l.LineNumber).Select(MapLine).ToList(),
        Payments = i.Payments.Select(p => new HonorairesPaymentDto
        {
            Id = p.Id,
            HonorairesInvoiceId = p.HonorairesInvoiceId,
            PaymentDate = p.PaymentDate,
            Amount = p.Amount.Amount,
            ClientWithholdingAmount = p.ClientWithholdingAmount.Amount,
            AppliedAmount = p.AppliedAmount,
            Method = p.Method,
            MethodDisplay = p.Method.ToDisplayString(),
            Reference = p.Reference,
            Notes = p.Notes,
            BankAccountLabel = p.BankAccountLabel
        }).ToList()
    };

    private static HonorairesQuoteDto MapQuote(HonorairesQuote q) => new()
    {
        Id = q.Id,
        Number = q.Number,
        IssueDate = q.IssueDate,
        ValidUntil = q.ValidUntil,
        Status = q.Status,
        StatusDisplay = q.Status.ToDisplayString(),
        FirmClientAssignmentId = q.FirmClientAssignmentId,
        ClientName = q.ClientName,
        ClientNif = q.ClientNif,
        ClientAddress = q.ClientAddress,
        ContactName = q.ContactName,
        ContactEmail = q.ContactEmail,
        ContactPhone = q.ContactPhone,
        Reference = q.Reference,
        Notes = q.Notes,
        PaymentTerms = q.PaymentTerms,
        Currency = q.Currency,
        ConvertedInvoiceId = q.ConvertedInvoiceId,
        SubTotal = q.SubTotal.Amount,
        TotalVat = q.TotalVat.Amount,
        TotalAmount = q.TotalAmount.Amount,
        Lines = q.Lines.OrderBy(l => l.LineNumber).Select(l => new HonorairesLineDto
        {
            Id = l.Id,
            LineNumber = l.LineNumber,
            ActivityCode = l.ActivityCode,
            Designation = l.Designation,
            Description = l.Description,
            Quantity = l.Quantity,
            UnitPrice = l.UnitPrice.Amount,
            VatRate = (int)l.VatRate,
            DiscountPercent = l.DiscountPercent,
            DiscountAmount = l.DiscountAmount.Amount,
            SubTotal = l.SubTotal.Amount,
            VatAmount = l.VatAmount.Amount,
            Total = l.Total.Amount
        }).ToList()
    };

    private static HonorairesLineDto MapLine(HonorairesInvoiceLine l) => new()
    {
        Id = l.Id,
        LineNumber = l.LineNumber,
        ActivityCode = l.ActivityCode,
        Designation = l.Designation,
        Description = l.Description,
        Quantity = l.Quantity,
        UnitPrice = l.UnitPrice.Amount,
        VatRate = (int)l.VatRate,
        DiscountPercent = l.DiscountPercent,
        DiscountAmount = l.DiscountAmount.Amount,
        SubTotal = l.SubTotal.Amount,
        VatAmount = l.VatAmount.Amount,
        Total = l.Total.Amount
    };
}
