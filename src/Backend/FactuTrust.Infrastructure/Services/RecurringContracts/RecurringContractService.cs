using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.InvoiceWizard.Commands;
using FactuTrust.Application.Features.RecurringContracts;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.RecurringContracts;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.RecurringContracts;

public sealed partial class RecurringContractService : IRecurringContractService, IAsyncDisposable
{
    private readonly TenantDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IMediator _mediator;
    private readonly RecurringContractBillingService _billing;
    private readonly RecurringContractsOptions _options;
    private readonly ITenantMemberDirectory _members;
    private readonly IPlanQuotaService _planQuota;

    public RecurringContractService(
        ITenantDbContextFactory tenantFactory,
        ICurrentUser currentUser,
        IMediator mediator,
        RecurringContractBillingService billing,
        IOptions<RecurringContractsOptions> options,
        ITenantMemberDirectory tenantMemberDirectory,
        IPlanQuotaService planQuota)
    {
        _db = tenantFactory.CreateIsolatedContext();
        _currentUser = currentUser;
        _mediator = mediator;
        _billing = billing;
        _options = options.Value;
        _members = tenantMemberDirectory;
        _planQuota = planQuota;
    }

    public ValueTask DisposeAsync() => _db.DisposeAsync();

    public async Task<PagedResult<RecurringContractListItemDto>> ListAsync(
        RecurringContractListQuery query, CancellationToken cancellationToken = default)
    {
        var page = Math.Clamp(query.Page, 1, int.MaxValue / 100);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var q = _db.RecurringContracts.AsNoTracking().AsQueryable();

        if (query.Status.HasValue)
            q = q.Where(c => c.Status == query.Status.Value);
        if (query.ClientId.HasValue)
            q = q.Where(c => c.ClientId == query.ClientId.Value);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            // Recherche étendue au nom du client (D10) : sous-requête traduite en IN (SELECT …),
            // un seul aller-retour SQL. Sans terme de recherche, comportement inchangé.
            var matchingClientIds = _db.Clients
                .Where(cl => cl.Name.Contains(term))
                .Select(cl => cl.Id);
            q = q.Where(c =>
                (c.Number != null && c.Number.Contains(term)) ||
                (c.Reference != null && c.Reference.Contains(term)) ||
                matchingClientIds.Contains(c.ClientId));
        }

        var total = await q.CountAsync(cancellationToken);
        var items = await q.OrderByDescending(c => c.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);

        var clientIds = items.Select(i => i.ClientId).Distinct().ToList();
        var clients = await _db.Clients.AsNoTracking()
            .Where(c => clientIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);

        var contractIds = items.Select(i => i.Id).ToList();
        var lineTotals = await _db.RecurringContractLines.AsNoTracking()
            .Where(l => contractIds.Contains(l.RecurringContractId) && l.IsActive)
            .GroupBy(l => l.RecurringContractId)
            .Select(g => new { ContractId = g.Key, Total = g.Sum(l => l.Quantity * l.UnitPriceHT) })
            .ToDictionaryAsync(x => x.ContractId, x => x.Total, cancellationToken);

        var dtos = items.Select(c => new RecurringContractListItemDto
        {
            Id = c.Id,
            Number = c.Number,
            ClientId = c.ClientId,
            ClientName = clients.GetValueOrDefault(c.ClientId) ?? "—",
            Status = c.Status,
            StatusDisplay = c.Status.ToDisplayString(),
            BillingFrequency = c.BillingFrequency,
            BillingFrequencyDisplay = BillingFrequencyDisplay(c.BillingFrequency),
            StartDate = c.StartDate,
            EndDate = c.EndDate,
            NextBillingDate = c.NextBillingDate,
            Currency = c.Currency,
            EstimatedMonthlyAmount = NormalizeMonthlyEstimate(
                lineTotals.GetValueOrDefault(c.Id), c.BillingFrequency)
        }).ToList();

        return PagedResult<RecurringContractListItemDto>.Create(dtos, page, pageSize, total);
    }

    public async Task<RecurringContractDto?> GetAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts
            .Include(c => c.Lines)
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (contract is null) return null;

        var clientName = await _db.Clients.AsNoTracking()
            .Where(c => c.Id == contract.ClientId)
            .Select(c => c.Name)
            .FirstOrDefaultAsync(cancellationToken) ?? "—";

        var metricIds = contract.Lines.Where(l => l.UsageMetricId.HasValue)
            .Select(l => l.UsageMetricId!.Value).Distinct().ToList();
        var metrics = metricIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.UsageMetrics.AsNoTracking()
                .Where(m => metricIds.Contains(m.Id))
                .ToDictionaryAsync(m => m.Id, m => m.Name, cancellationToken);

        return MapContract(contract, clientName, metrics);
    }

    public async Task<Result<Guid>> CreateAsync(UpsertRecurringContractDto dto, CancellationToken cancellationToken = default)
    {
        var created = RecurringContract.CreateDraft(
            dto.ClientId, dto.BillingFrequency, dto.BillingDayOfMonth, dto.StartDate,
            dto.EndDate, dto.AutoRenew, dto.NoticePeriodDays, "TND",
            dto.PaymentTermTemplateId, dto.SourceQuoteId,
            dto.Reference, dto.Notes);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);

        var contract = created.Value;
        var number = await GenerateContractNumberAsync(0, cancellationToken);
        contract.AssignNumber(number);

        foreach (var lineDto in dto.Lines.OrderBy(l => l.SortOrder))
        {
            var lineResult = contract.AddLine(
                lineDto.LineType, lineDto.Description, lineDto.Quantity,
                lineDto.UnitPriceHT, lineDto.VatRate, lineDto.ProductId,
                lineDto.UsageMetricId, lineDto.IncludedQuantity, lineDto.OverageUnitPriceHT);
            if (lineResult.IsFailure)
                return Result.Failure<Guid>(lineResult.Error);
        }

        contract.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");
        await _db.RecurringContracts.AddAsync(contract, cancellationToken);
        var save = await SaveWithNumberRetryAsync(contract, cancellationToken);
        if (save.IsFailure) return Result.Failure<Guid>(save.Error);
        return Result.Success(contract.Id);
    }

    public async Task<Result> UpdateAsync(Guid id, UpsertRecurringContractDto dto, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts.Include(c => c.Lines)
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (contract is null)
            return Result.Failure(Error.NotFound("RecurringContract", id));

        var header = contract.UpdateHeader(
            dto.BillingFrequency, dto.BillingDayOfMonth, dto.StartDate, dto.EndDate,
            dto.AutoRenew, dto.NoticePeriodDays, dto.PaymentTermTemplateId,
            dto.Reference, dto.Notes);
        if (header.IsFailure) return header;

        if (contract.Status.CanBeEdited())
        {
            _db.RecurringContractLines.RemoveRange(contract.Lines);
            foreach (var lineDto in dto.Lines.OrderBy(l => l.SortOrder))
            {
                var lineResult = contract.AddLine(
                    lineDto.LineType, lineDto.Description, lineDto.Quantity,
                    lineDto.UnitPriceHT, lineDto.VatRate, lineDto.ProductId,
                    lineDto.UsageMetricId, lineDto.IncludedQuantity, lineDto.OverageUnitPriceHT);
                if (lineResult.IsFailure) return lineResult;
            }
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ActivateAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts.Include(c => c.Lines)
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (contract is null) return Result.Failure(Error.NotFound("RecurringContract", id));
        var result = contract.Activate();
        if (result.IsFailure) return result;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SuspendAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (contract is null) return Result.Failure(Error.NotFound("RecurringContract", id));
        var beforeJson = SerializeHeaderSnapshot(contract);
        var result = contract.Suspend();
        if (result.IsFailure) return result;
        // D17 : la suspension est tracée comme avenant pour l'historique (additif).
        await TraceLifecycleAmendmentAsync(id, RecurringContractAmendmentType.Suspend, beforeJson, contract, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ResumeAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (contract is null) return Result.Failure(Error.NotFound("RecurringContract", id));
        var beforeJson = SerializeHeaderSnapshot(contract);
        var result = contract.Resume();
        if (result.IsFailure) return result;
        // D17 : la reprise est tracée comme avenant pour l'historique (additif).
        await TraceLifecycleAmendmentAsync(id, RecurringContractAmendmentType.Resume, beforeJson, contract, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task TraceLifecycleAmendmentAsync(
        Guid contractId,
        RecurringContractAmendmentType type,
        string beforeJson,
        RecurringContract contract,
        CancellationToken cancellationToken)
    {
        var amendment = RecurringContractAmendment.Create(
            contractId, type, DateTime.UtcNow.Date, ProrationPolicy.None,
            notes: null, beforeJson, SerializeHeaderSnapshot(contract), _currentUser.UserId);
        await _db.RecurringContractAmendments.AddAsync(amendment, cancellationToken);
    }

    private static string SerializeHeaderSnapshot(RecurringContract contract) =>
        JsonSerializer.Serialize(new
        {
            contract.StartDate,
            contract.EndDate,
            contract.Status,
            contract.AutoRenew,
            contract.NextBillingDate
        });

    public async Task<Result> CancelAsync(Guid id, DateTime? cancellationDate = null, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (contract is null) return Result.Failure(Error.NotFound("RecurringContract", id));
        var result = contract.Cancel(cancellationDate);
        if (result.IsFailure) return result;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> AmendAsync(Guid id, AmendRecurringContractDto dto, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts.Include(c => c.Lines)
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (contract is null) return Result.Failure(Error.NotFound("RecurringContract", id));

        var beforeJson = SerializeLinesSnapshot(contract);

        var isLifecycleType = dto.AmendmentType is RecurringContractAmendmentType.Suspend
            or RecurringContractAmendmentType.Resume;

        if (contract.Status == RecurringContractStatus.Active && !isLifecycleType)
        {
            // D14 : avenant de lignes sur contrat actif par fenêtres d'effet (effet immédiat).
            // Seules les lignes de UpdatedContract sont lues — l'en-tête est ignoré (phase 1).
            if (dto.UpdatedContract is null)
                return Result.Failure(Error.Validation("UpdatedContract",
                    "Les lignes cibles sont obligatoires pour un avenant sur contrat actif"));

            var targets = new List<RecurringContractAmendLineTarget>();
            foreach (var lineDto in dto.UpdatedContract.Lines.OrderBy(l => l.SortOrder))
            {
                var lineResult = RecurringContractLine.Create(
                    id, lineDto.LineType, lineDto.Description, lineDto.Quantity,
                    lineDto.UnitPriceHT, lineDto.VatRate, dto.EffectiveDate,
                    lineDto.ProductId, lineDto.UsageMetricId, lineDto.IncludedQuantity,
                    lineDto.OverageUnitPriceHT, lineDto.SortOrder);
                if (lineResult.IsFailure) return Result.Failure(lineResult.Error);
                targets.Add(new RecurringContractAmendLineTarget(lineDto.Id, lineResult.Value));
            }

            var amend = contract.AmendLines(dto.EffectiveDate, targets, DateTime.UtcNow);
            if (amend.IsFailure) return amend;
        }
        else if (!isLifecycleType && contract.Status != RecurringContractStatus.Draft)
        {
            return Result.Failure(Error.Validation("Status",
                "Avenant impossible sur ce statut — si le contrat est suspendu, reprenez-le d'abord"));
        }
        else if (dto.UpdatedContract is not null)
        {
            // Chemin brouillon inchangé (remplacement complet, gardé par CanBeEdited).
            var update = await UpdateAsync(id, dto.UpdatedContract, cancellationToken);
            if (update.IsFailure) return update;
            contract = await _db.RecurringContracts.Include(c => c.Lines)
                .FirstAsync(c => c.Id == id, cancellationToken);
        }

        if (dto.AmendmentType == RecurringContractAmendmentType.Suspend)
            contract.Suspend();
        else if (dto.AmendmentType == RecurringContractAmendmentType.Resume)
            contract.Resume();

        var afterJson = SerializeLinesSnapshot(contract);

        var amendment = RecurringContractAmendment.Create(
            id, dto.AmendmentType, dto.EffectiveDate, dto.ProrationPolicy,
            dto.Notes, beforeJson, afterJson, _currentUser.UserId);
        await _db.RecurringContractAmendments.AddAsync(amendment, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    // Snapshot des lignes pour l'historique des avenants (étendu des fenêtres d'effet — additif).
    private static string SerializeLinesSnapshot(RecurringContract contract) =>
        JsonSerializer.Serialize(contract.Lines.Select(l => new
        {
            l.Id, l.LineType, l.Description, l.Quantity, l.UnitPriceHT, l.IsActive,
            l.EffectiveFrom, l.EffectiveTo
        }));

    public async Task<Result<Guid>> ConvertFromQuoteAsync(
        Guid quoteId, UpsertRecurringContractDto dto, CancellationToken cancellationToken = default)
    {
        var quote = await _db.Quotes.Include(q => q.Lines)
            .FirstOrDefaultAsync(q => q.Id == quoteId, cancellationToken);
        if (quote is null)
            return Result.Failure<Guid>(Error.NotFound("Quote", quoteId));
        if (quote.Status != QuoteStatus.Accepted && quote.Status != QuoteStatus.Converted)
            return Result.Failure<Guid>(Error.Validation("Quote", "Le devis doit être accepté"));

        var lines = dto.Lines.Count > 0
            ? dto.Lines
            : quote.Lines.Select((l, i) => new UpsertRecurringContractLineDto
            {
                LineType = RecurringContractLineType.FixedRecurring,
                ProductId = l.ProductId,
                Description = l.ProductName,
                Quantity = l.Quantity,
                UnitPriceHT = l.UnitPrice.Amount,
                VatRate = l.VatRate.ToDecimal(),
                SortOrder = i
            }).ToList();

        var createDto = dto with
        {
            ClientId = quote.ClientId,
            SourceQuoteId = quoteId,
            Lines = lines
        };
        return await CreateAsync(createDto, cancellationToken);
    }

    public async Task<IReadOnlyList<UsageMetricDto>> ListUsageMetricsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.UsageMetrics.AsNoTracking()
            .OrderBy(m => m.Code)
            .Select(m => new UsageMetricDto
            {
                Id = m.Id,
                Code = m.Code,
                Name = m.Name,
                Unit = m.Unit,
                AggregationMode = m.AggregationMode,
                AggregationModeDisplay = m.AggregationMode.ToString(),
                ProductId = m.ProductId,
                IsActive = m.IsActive
            }).ToListAsync(cancellationToken);
    }

    public async Task<Result<Guid>> CreateUsageMetricAsync(UpsertUsageMetricDto dto, CancellationToken cancellationToken = default)
    {
        var created = UsageMetric.Create(dto.Code, dto.Name, dto.Unit, dto.AggregationMode, dto.ProductId);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        await _db.UsageMetrics.AddAsync(created.Value, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateUsageMetricAsync(Guid id, UpsertUsageMetricDto dto, CancellationToken cancellationToken = default)
    {
        var metric = await _db.UsageMetrics.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (metric is null) return Result.Failure(Error.NotFound("UsageMetric", id));
        var result = metric.Update(dto.Name, dto.Unit, dto.AggregationMode, dto.IsActive);
        if (result.IsFailure) return result;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<UsageRecordDto>> ListUsageRecordsAsync(
        Guid contractId, DateTime? from, DateTime? to, CancellationToken cancellationToken = default)
    {
        var q = _db.UsageRecords.AsNoTracking().Where(r => r.RecurringContractId == contractId);
        if (from.HasValue) q = q.Where(r => r.PeriodTo >= from.Value.Date);
        if (to.HasValue) q = q.Where(r => r.PeriodFrom <= to.Value.Date);

        var records = await q.OrderByDescending(r => r.PeriodFrom).ToListAsync(cancellationToken);
        var metricIds = records.Select(r => r.UsageMetricId).Distinct().ToList();
        var metrics = await _db.UsageMetrics.AsNoTracking()
            .Where(m => metricIds.Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, m => m.Name, cancellationToken);

        return records.Select(r => new UsageRecordDto
        {
            Id = r.Id,
            RecurringContractId = r.RecurringContractId,
            UsageMetricId = r.UsageMetricId,
            UsageMetricName = metrics.GetValueOrDefault(r.UsageMetricId) ?? "—",
            PeriodFrom = r.PeriodFrom,
            PeriodTo = r.PeriodTo,
            Quantity = r.Quantity,
            Source = r.Source,
            SourceDisplay = r.Source.ToString(),
            Notes = r.Notes,
            CreatedAt = r.CreatedAt
        }).ToList();
    }

    public async Task<Result<Guid>> RecordUsageAsync(
        Guid contractId, RecordUsageDto dto, CancellationToken cancellationToken = default)
    {
        var contractExists = await _db.RecurringContracts.AnyAsync(c => c.Id == contractId, cancellationToken);
        if (!contractExists)
            return Result.Failure<Guid>(Error.NotFound("RecurringContract", contractId));

        var created = UsageRecord.Create(
            contractId, dto.UsageMetricId, dto.PeriodFrom, dto.PeriodTo,
            dto.Quantity, UsageRecordSource.Manual, _currentUser.UserId, dto.Notes);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);

        await _db.UsageRecords.AddAsync(created.Value, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result<int>> ImportUsageRecordsAsync(
        Guid contractId, IReadOnlyList<ImportUsageRecordRowDto> rows, CancellationToken cancellationToken = default)
    {
        var contractExists = await _db.RecurringContracts.AnyAsync(c => c.Id == contractId, cancellationToken);
        if (!contractExists)
            return Result.Failure<int>(Error.NotFound("RecurringContract", contractId));

        var metrics = await _db.UsageMetrics.AsNoTracking().ToListAsync(cancellationToken);
        var byCode = metrics.ToDictionary(m => m.Code, StringComparer.OrdinalIgnoreCase);
        var imported = 0;

        foreach (var row in rows)
        {
            if (!byCode.TryGetValue(row.MetricCode.Trim(), out var metric))
                continue;

            var existing = await _db.UsageRecords.FirstOrDefaultAsync(r =>
                r.RecurringContractId == contractId &&
                r.UsageMetricId == metric.Id &&
                r.PeriodFrom == row.PeriodFrom.Date &&
                r.PeriodTo == row.PeriodTo.Date &&
                r.Source == UsageRecordSource.Import, cancellationToken);

            if (existing is not null)
            {
                existing.UpdateQuantity(row.Quantity, row.Notes);
            }
            else
            {
                var created = UsageRecord.Create(
                    contractId, metric.Id, row.PeriodFrom, row.PeriodTo,
                    row.Quantity, UsageRecordSource.Import, _currentUser.UserId, row.Notes);
                if (created.IsSuccess)
                    await _db.UsageRecords.AddAsync(created.Value, cancellationToken);
            }
            imported++;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(imported);
    }

    public async Task<IReadOnlyList<RecurringContractBillingRunDto>> ListBillingRunsAsync(
        Guid contractId, CancellationToken cancellationToken = default)
    {
        var contract = await _db.RecurringContracts.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == contractId, cancellationToken);
        var runs = await _db.RecurringContractBillingRuns.AsNoTracking()
            .Where(r => r.RecurringContractId == contractId)
            .OrderByDescending(r => r.PeriodFrom)
            .ToListAsync(cancellationToken);

        return runs.Select(r => new RecurringContractBillingRunDto
        {
            Id = r.Id,
            RecurringContractId = r.RecurringContractId,
            ContractNumber = contract?.Number,
            PeriodFrom = r.PeriodFrom,
            PeriodTo = r.PeriodTo,
            Status = r.Status,
            StatusDisplay = r.Status.ToDisplayString(),
            InvoiceDraftId = r.InvoiceDraftId,
            InvoiceId = r.InvoiceId,
            FixedAmount = r.FixedAmount,
            UsageAmount = r.UsageAmount,
            ProrationAmount = r.ProrationAmount,
            TotalAmount = r.TotalAmount,
            ErrorMessage = r.ErrorMessage,
            CreatedAt = r.CreatedAt
        }).ToList();
    }

    public async Task<IReadOnlyList<PendingRecurringDraftDto>> ListPendingDraftsAsync(
        CancellationToken cancellationToken = default)
    {
        var runs = await _db.RecurringContractBillingRuns.AsNoTracking()
            .Where(r => r.Status == RecurringContractBillingRunStatus.DraftCreated && r.InvoiceDraftId != null)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(cancellationToken);

        var contractIds = runs.Select(r => r.RecurringContractId).Distinct().ToList();
        var contracts = await _db.RecurringContracts.AsNoTracking()
            .Where(c => contractIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, cancellationToken);

        var clientIds = contracts.Values.Select(c => c.ClientId).Distinct().ToList();
        var clients = await _db.Clients.AsNoTracking()
            .Where(c => clientIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);

        return runs.Select(r =>
        {
            var contract = contracts.GetValueOrDefault(r.RecurringContractId);
            return new PendingRecurringDraftDto
            {
                BillingRunId = r.Id,
                RecurringContractId = r.RecurringContractId,
                ContractNumber = contract?.Number,
                ClientName = contract is null ? "—" : clients.GetValueOrDefault(contract.ClientId) ?? "—",
                InvoiceDraftId = r.InvoiceDraftId!.Value,
                PeriodFrom = r.PeriodFrom,
                PeriodTo = r.PeriodTo,
                TotalAmount = r.TotalAmount
            };
        }).ToList();
    }

    public Task<Result<int>> TriggerBillingAsync(Guid? contractId, CancellationToken cancellationToken = default)
        => _billing.ScanAndCreateDraftsAsync(_db, contractId, DateTime.UtcNow, cancellationToken);

    public async Task<Result<InvoiceCreatedResultDto>> IssueBillingRunAsync(
        Guid billingRunId, CancellationToken cancellationToken = default)
    {
        var run = await _db.RecurringContractBillingRuns
            .FirstOrDefaultAsync(r => r.Id == billingRunId, cancellationToken);
        if (run is null)
            return Result.Failure<InvoiceCreatedResultDto>(Error.NotFound("BillingRun", billingRunId));

        if (run.Status != RecurringContractBillingRunStatus.DraftCreated || !run.InvoiceDraftId.HasValue)
            return Result.Failure<InvoiceCreatedResultDto>(Error.Validation(
                "BillingRun",
                "Ce brouillon n'est pas émissible. Il a déjà été facturé, a échoué, ou n'est pas encore prêt."));

        var tenantId = _currentUser.TenantId ?? Guid.Empty;
        if (tenantId != Guid.Empty)
        {
            var quota = await _planQuota.EnsureCanCreateInvoiceAsync(tenantId, cancellationToken);
            if (quota.IsFailure)
                return Result.Failure<InvoiceCreatedResultDto>(quota.Error);
        }

        var result = await _mediator.Send(
            new SubmitInvoiceCommand(run.InvoiceDraftId.Value, RecurringBillingIssueKeys.ForRun(run.Id)),
            cancellationToken);

        if (result.IsSuccess && tenantId != Guid.Empty)
        {
            try
            {
                await _planQuota.OnInvoiceCreatedAsync(tenantId, cancellationToken);
            }
            catch
            {
                // Best-effort, identique à CreateInvoiceCommand : la facture est déjà émise.
            }
        }

        return result;
    }

    /// <summary>
    /// Génère un numéro CTR-{année}-{seq:D4} en sautant les candidats déjà pris (D11).
    /// <paramref name="attempt"/> décale la séquence à chaque retry externe (collision en concurrence).
    /// Boucle interne de 5 candidats max avant de laisser le retry externe agir.
    /// </summary>
    private async Task<string> GenerateContractNumberAsync(int attempt, CancellationToken cancellationToken)
    {
        var year = DateTime.UtcNow.Year;
        var count = await _db.RecurringContracts.CountAsync(c => c.CreatedAt.Year == year, cancellationToken);
        for (var i = 0; i < 5; i++)
        {
            var candidate = $"CTR-{year}-{(count + 1 + attempt + i):D4}";
            if (!await _db.RecurringContracts.AnyAsync(c => c.Number == candidate, cancellationToken))
                return candidate;
        }
        // Tous les candidats sont pris : on retourne le dernier — l'index unique déclenchera le retry externe.
        return $"CTR-{year}-{(count + 1 + attempt + 4):D4}";
    }

    /// <summary>
    /// Persiste un contrat (création/clone) en absorbant une course sur l'unicité du numéro :
    /// sur violation d'index unique (SQL 2601/2627), régénère le numéro et réessaie (max 3).
    /// L'index unique UX_RecurringContracts_Number reste le garde-fou ultime.
    /// </summary>
    private async Task<Result> SaveWithNumberRetryAsync(RecurringContract contract, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
                return Result.Success();
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
            {
                if (attempt == 2)
                    return Result.Failure(Error.Conflict("Impossible d'attribuer un numéro de contrat unique, veuillez réessayer"));
                var number = await GenerateContractNumberAsync(attempt + 1, cancellationToken);
                contract.AssignNumber(number);
            }
        }
        return Result.Failure(Error.Conflict("Impossible d'attribuer un numéro de contrat unique, veuillez réessayer"));
    }

    private static RecurringContractDto MapContract(
        RecurringContract contract, string clientName, IReadOnlyDictionary<Guid, string> metrics) =>
        MapContractCore(contract, clientName, metrics);

    /// <summary>
    /// Mapping de base partagé entre GetAsync (sortie strictement inchangée) et GetDetailAsync (T10).
    /// </summary>
    private static RecurringContractDto MapContractCore(
        RecurringContract contract, string clientName, IReadOnlyDictionary<Guid, string> metrics) =>
        new()
        {
            Id = contract.Id,
            Number = contract.Number,
            ClientId = contract.ClientId,
            ClientName = clientName,
            Status = contract.Status,
            StatusDisplay = contract.Status.ToDisplayString(),
            BillingFrequency = contract.BillingFrequency,
            BillingFrequencyDisplay = BillingFrequencyDisplay(contract.BillingFrequency),
            BillingDayOfMonth = contract.BillingDayOfMonth,
            StartDate = contract.StartDate,
            EndDate = contract.EndDate,
            NextBillingDate = contract.NextBillingDate,
            LastBilledPeriodEnd = contract.LastBilledPeriodEnd,
            PaymentTermTemplateId = contract.PaymentTermTemplateId,
            AutoRenew = contract.AutoRenew,
            NoticePeriodDays = contract.NoticePeriodDays,
            Currency = contract.Currency,
            SourceQuoteId = contract.SourceQuoteId,
            Reference = contract.Reference,
            Notes = contract.Notes,
            SetupFeeBilled = contract.SetupFeeBilled,
            Lines = contract.Lines.OrderBy(l => l.SortOrder).Select(l => new RecurringContractLineDto
            {
                Id = l.Id,
                LineType = l.LineType,
                LineTypeDisplay = l.LineType.ToString(),
                ProductId = l.ProductId,
                Description = l.Description,
                Quantity = l.Quantity,
                UnitPriceHT = l.UnitPriceHT,
                VatRate = l.VatRate,
                UsageMetricId = l.UsageMetricId,
                UsageMetricName = l.UsageMetricId.HasValue
                    ? metrics.GetValueOrDefault(l.UsageMetricId.Value) : null,
                IncludedQuantity = l.IncludedQuantity,
                OverageUnitPriceHT = l.OverageUnitPriceHT,
                EffectiveFrom = l.EffectiveFrom,
                EffectiveTo = l.EffectiveTo,
                IsActive = l.IsActive,
                SortOrder = l.SortOrder
            }).ToList()
        };

    private static string BillingFrequencyDisplay(BillingFrequency f) => f switch
    {
        BillingFrequency.Monthly => "Mensuel",
        BillingFrequency.Quarterly => "Trimestriel",
        BillingFrequency.Annual => "Annuel",
        _ => f.ToString()
    };

    private static decimal NormalizeMonthlyEstimate(decimal total, BillingFrequency f) => f switch
    {
        BillingFrequency.Quarterly => decimal.Round(total / 3m, 3),
        BillingFrequency.Annual => decimal.Round(total / 12m, 3),
        _ => total
    };
}
