using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Audit;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.AccountingAudit;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AccountingAudit;

public sealed class AccountingAuditQueryService : IAccountingAuditQueryService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly AccountingSettings _settings;

    public AccountingAuditQueryService(
        ITenantDbContextFactory contextFactory,
        IOptions<AccountingSettings> settings)
    {
        _contextFactory = contextFactory;
        _settings = settings.Value;
    }

    public async Task<Result<AccountingAuditDashboardDto>> GetDashboardAsync(
        int fiscalYear, CancellationToken cancellationToken = default)
    {
        if (!_settings.AccountingAuditDashboardEnabled)
            return Result.Failure<AccountingAuditDashboardDto>(Error.Validation("Audit", "Dashboard non activé."));

        await using var ctx = _contextFactory.CreateContext();
        var lastRun = await ctx.Set<AccountingControlRun>().AsNoTracking()
            .Where(r => r.FiscalYear == fiscalYear && r.Status == ControlRunStatus.Completed)
            .OrderByDescending(r => r.CompletedAt)
            .FirstOrDefaultAsync(cancellationToken);

        var openAnomalies = await ctx.Set<AccountingAnomaly>().AsNoTracking()
            .Where(a => a.Run.FiscalYear == fiscalYear
                        && a.Status != AnomalyStatus.Corrected
                        && a.Status != AnomalyStatus.Ignored)
            .GroupBy(a => a.Severity)
            .Select(g => new { Severity = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        int CountFor(int severity) =>
            openAnomalies.FirstOrDefault(x => x.Severity == severity)?.Count ?? 0;

        var priorRun = await ctx.Set<AccountingControlRun>().AsNoTracking()
            .Where(r => r.FiscalYear == fiscalYear - 1 && r.Status == ControlRunStatus.Completed)
            .OrderByDescending(r => r.CompletedAt)
            .FirstOrDefaultAsync(cancellationToken);

        var compliance = lastRun?.ComplianceRate ?? 100m;
        decimal? delta = priorRun is null ? null : compliance - priorRun.ComplianceRate;

        return Result.Success(new AccountingAuditDashboardDto
        {
            FiscalYear = fiscalYear,
            BlockingCount = CountFor((int)PreClosingSeverity.Blocking),
            WarningCount = CountFor((int)PreClosingSeverity.Warning),
            // Total des anomalies ouvertes, toutes sévérités confondues.
            AnomalyCount = openAnomalies.Sum(x => x.Count),
            InfoCount = CountFor((int)PreClosingSeverity.Info),
            ComplianceRate = compliance,
            ComplianceRateDeltaVsPriorYear = delta,
            LastRun = lastRun?.CompletedAt is null ? null : new AccountingAuditLastRunDto
            {
                RunId = lastRun.Id,
                CompletedAt = lastRun.CompletedAt!.Value,
                Duration = lastRun.CompletedAt!.Value - lastRun.StartedAt,
                TriggeredByUserName = lastRun.TriggeredByUserName
            }
        });
    }

    public async Task<Result<PagedAnomaliesDto>> GetAnomaliesAsync(
        AccountingAnomalyFilterDto filter, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var q = ctx.Set<AccountingAnomaly>().AsNoTracking()
            .Include(a => a.Run)
            .Include(a => a.Lines)
            .Where(a => a.Run.FiscalYear == filter.FiscalYear);

        if (filter.Severity is { } sev) q = q.Where(a => a.Severity == sev);
        if (filter.Category is { } cat) q = q.Where(a => (int)a.Category == cat);
        if (filter.Status is { } st) q = q.Where(a => (int)a.Status == st);
        if (!string.IsNullOrWhiteSpace(filter.Account)) q = q.Where(a => a.AccountRef != null && a.AccountRef.Contains(filter.Account));
        if (filter.AssignedToUserId is { } uid) q = q.Where(a => a.AssignedToUserId == uid);
        if (!string.IsNullOrWhiteSpace(filter.ModuleCode)) q = q.Where(a => a.ModuleCode == filter.ModuleCode);
        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var s = filter.Search.Trim();
            q = q.Where(a => a.Title.Contains(s) || a.Description.Contains(s) || (a.AccountRef != null && a.AccountRef.Contains(s)));
        }

        var total = await q.CountAsync(cancellationToken);
        var ignored = await ctx.Set<AccountingAnomaly>().AsNoTracking()
            .Include(a => a.Run)
            .CountAsync(a => a.Run.FiscalYear == filter.FiscalYear && a.Status == AnomalyStatus.Ignored, cancellationToken);
        var open = await ctx.Set<AccountingAnomaly>().AsNoTracking()
            .Include(a => a.Run)
            .CountAsync(a => a.Run.FiscalYear == filter.FiscalYear
                             && a.Status != AnomalyStatus.Corrected
                             && a.Status != AnomalyStatus.Ignored, cancellationToken);

        var page = Math.Clamp(filter.Page, 1, int.MaxValue / 100);
        var pageSize = Math.Clamp(filter.PageSize, 1, 100);
        var items = await q.OrderByDescending(a => a.Severity)
            .ThenByDescending(a => a.Amount)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return Result.Success(new PagedAnomaliesDto
        {
            Items = items.Select(MapListItem).ToList(),
            TotalCount = total,
            Page = page,
            PageSize = pageSize,
            OpenCount = open,
            IgnoredCount = ignored
        });
    }

    public async Task<Result<AccountingAnomalyDetailDto>> GetAnomalyDetailAsync(
        Guid anomalyId, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var anomaly = await ctx.Set<AccountingAnomaly>().AsNoTracking()
            .Include(a => a.Run)
            .Include(a => a.Lines)
            .Include(a => a.Activities)
            .FirstOrDefaultAsync(a => a.Id == anomalyId, cancellationToken);
        if (anomaly is null)
            return Result.Failure<AccountingAnomalyDetailDto>(Error.NotFound("AccountingAnomaly", anomalyId));
        return Result.Success(MapDetail(anomaly));
    }

    public async Task<Result<AccountingAuditAnalyticsDto>> GetAnalyticsAsync(
        int fiscalYear, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var anomalies = await ctx.Set<AccountingAnomaly>().AsNoTracking()
            .Include(a => a.Run)
            .Where(a => a.Run.FiscalYear == fiscalYear
                        && a.Status != AnomalyStatus.Corrected
                        && a.Status != AnomalyStatus.Ignored)
            .ToListAsync(cancellationToken);

        var byCategory = anomalies
            .GroupBy(a => a.Category)
            .Select(g => new AccountingAuditCategorySliceDto
            {
                Category = (int)g.Key,
                Label = g.Key.ToString(),
                Count = g.Count()
            }).ToList();

        var trend = await BuildTrendAsync(ctx, fiscalYear, cancellationToken);

        var topAccounts = anomalies
            .Where(a => !string.IsNullOrEmpty(a.AccountRef))
            .GroupBy(a => a.AccountRef!)
            .Select(g => new AccountingAuditTopAccountDto
            {
                AccountNumber = g.Key,
                AnomalyCount = g.Count(),
                TotalAmount = g.Sum(x => x.Amount)
            })
            .OrderByDescending(x => x.AnomalyCount)
            .Take(10)
            .ToList();

        var riskRadar = BuildRiskRadar(anomalies);

        var recentActivity = await ctx.Set<AccountingAnomalyActivity>().AsNoTracking()
            .Include(a => a.Anomaly).ThenInclude(x => x.Run)
            .Where(a => a.Anomaly.Run.FiscalYear == fiscalYear)
            .OrderByDescending(a => a.CreatedAt)
            .Take(20)
            .Select(a => new AccountingAnomalyActivityDto
            {
                Id = a.Id,
                ActivityType = (int)a.ActivityType,
                UserName = a.UserName,
                Message = a.Message,
                CreatedAt = a.CreatedAt
            })
            .ToListAsync(cancellationToken);

        return Result.Success(new AccountingAuditAnalyticsDto
        {
            ByCategory = byCategory,
            Trend = trend,
            TopAccounts = topAccounts,
            RiskRadar = riskRadar,
            RecentActivity = recentActivity
        });
    }

    public async Task<Result<IReadOnlyList<AccountingControlModuleDto>>> GetModulesAsync(
        int fiscalYear, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var counts = await ctx.Set<AccountingAnomaly>().AsNoTracking()
            .Include(a => a.Run)
            .Where(a => a.Run.FiscalYear == fiscalYear
                        && a.Status != AnomalyStatus.Corrected
                        && a.Status != AnomalyStatus.Ignored)
            .GroupBy(a => a.ModuleCode)
            .Select(g => new { Module = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var countMap = counts.ToDictionary(x => x.Module, x => x.Count);
        var modules = AccountingAuditModuleCatalog.All.Select(m => new AccountingControlModuleDto
        {
            Code = m.Code,
            Label = m.Label,
            Icon = m.Icon,
            Count = countMap.GetValueOrDefault(m.Code)
        }).ToList();

        return Result.Success<IReadOnlyList<AccountingControlModuleDto>>(modules);
    }

    private static async Task<IReadOnlyList<AccountingAuditTrendPointDto>> BuildTrendAsync(
        TenantDbContext ctx, int fiscalYear, CancellationToken ct)
    {
        var runs = await ctx.Set<AccountingControlRun>().AsNoTracking()
            .Where(r => r.FiscalYear == fiscalYear && r.Status == ControlRunStatus.Completed)
            .OrderBy(r => r.CompletedAt)
            .Take(6)
            .ToListAsync(ct);

        return runs.Select((r, i) => new AccountingAuditTrendPointDto
        {
            Label = r.CompletedAt?.ToString("MM/yyyy") ?? $"Run {i + 1}",
            Blocking = r.BlockingCount,
            Warning = r.WarningCount,
            Info = r.InfoCount
        }).ToList();
    }

    private static IReadOnlyList<AccountingAuditRiskAxisDto> BuildRiskRadar(List<AccountingAnomaly> anomalies)
    {
        var axes = new[] { "Lettrage", "TVA", "Rapprochement", "Documents", "Intégrité" };
        return axes.Select(axis =>
        {
            var cat = axis switch
            {
                "Lettrage" => AnomalyCategory.Lettrage,
                "TVA" => AnomalyCategory.Tva,
                "Rapprochement" => AnomalyCategory.Rapprochement,
                "Documents" => AnomalyCategory.Documents,
                _ => AnomalyCategory.Integrite
            };
            var count = anomalies.Count(a => a.Category == cat);
            var score = Math.Max(0, 100 - count * 5m);
            return new AccountingAuditRiskAxisDto
            {
                Axis = axis,
                CurrentScore = score,
                SectorAverage = 75m
            };
        }).ToList();
    }

    private static AccountingAnomalyListItemDto MapListItem(AccountingAnomaly a)
    {
        var fiscalYear = a.Run?.FiscalYear ?? (a.PeriodFrom?.Year ?? DateTime.UtcNow.Year);
        var lineContexts = a.Lines.Select(ToLineContext).ToList();
        var correctionLink = AuditCorrectionLinkBuilder.Build(
            a.RuleCode, a.DeepLinkRoute, a.AccountRef, a.PeriodFrom, a.PeriodTo,
            fiscalYear, a.Id, lineContexts);

        return new AccountingAnomalyListItemDto
        {
            Id = a.Id,
            RuleCode = a.RuleCode,
            ModuleCode = a.ModuleCode,
            Severity = a.Severity,
            Category = (int)a.Category,
            Title = a.Title,
            Description = a.Description,
            DetailSummary = BuildDetailSummary(a),
            AccountRef = a.AccountRef,
            PeriodFrom = a.PeriodFrom,
            PeriodTo = a.PeriodTo,
            Amount = a.Amount,
            Status = (int)a.Status,
            AssignedToUserId = a.AssignedToUserId,
            AssignedToUserName = a.AssignedToUserName,
            DeepLinkRoute = correctionLink.Route,
            CorrectionLink = correctionLink,
            LineCount = a.Lines.Count,
            DetectedAt = a.DetectedAt
        };
    }

    private static AuditCorrectionLinkBuilder.LineContext ToLineContext(AccountingAnomalyLine l) =>
        new(l.JournalEntryId, l.EntryDate, l.AccountNumber, l.Label, l.PieceRef);

    private static string BuildDetailSummary(AccountingAnomaly a)
    {
        var parts = new List<string>();
        if (a.Lines.Count > 0) parts.Add($"{a.Lines.Count} élément(s)");
        if (a.Amount > 0) parts.Add($"{a.Amount:N3} TND");
        if (a.PeriodFrom.HasValue) parts.Add($"période {a.PeriodFrom:dd/MM/yyyy}");
        return parts.Count > 0 ? string.Join(" · ", parts) : a.Description;
    }

    internal static AccountingAnomalyDetailDto MapDetail(AccountingAnomaly a)
    {
        var recommendations = string.IsNullOrEmpty(a.RecommendationsJson)
            ? Array.Empty<string>()
            : JsonSerializer.Deserialize<string[]>(a.RecommendationsJson) ?? Array.Empty<string>();

        var fiscalYear = a.Run?.FiscalYear ?? (a.PeriodFrom?.Year ?? DateTime.UtcNow.Year);
        var lineContexts = a.Lines.Select(ToLineContext).ToList();
        var correctionLink = AuditCorrectionLinkBuilder.Build(
            a.RuleCode, a.DeepLinkRoute, a.AccountRef, a.PeriodFrom, a.PeriodTo,
            fiscalYear, a.Id, lineContexts);

        return new AccountingAnomalyDetailDto
        {
            Id = a.Id,
            RuleCode = a.RuleCode,
            ModuleCode = a.ModuleCode,
            Severity = a.Severity,
            Category = (int)a.Category,
            Title = a.Title,
            Description = a.Description,
            Impact = a.Impact,
            AccountRef = a.AccountRef,
            Amount = a.Amount,
            PeriodFrom = a.PeriodFrom,
            PeriodTo = a.PeriodTo,
            Status = (int)a.Status,
            AssignedToUserId = a.AssignedToUserId,
            AssignedToUserName = a.AssignedToUserName,
            DetectedAt = a.DetectedAt,
            DeepLinkRoute = correctionLink.Route,
            CorrectionLink = correctionLink,
            Recommendations = recommendations,
            Lines = a.Lines.Select(l => new AccountingAnomalyLineDto
            {
                Id = l.Id,
                JournalEntryId = l.JournalEntryId,
                EntryDate = l.EntryDate,
                AccountNumber = l.AccountNumber,
                Label = l.Label,
                Debit = l.Debit,
                Credit = l.Credit,
                PieceRef = l.PieceRef,
                JustificationStatus = l.JustificationStatus
            }).ToList(),
            Activities = a.Activities.OrderByDescending(x => x.CreatedAt).Select(x => new AccountingAnomalyActivityDto
            {
                Id = x.Id,
                ActivityType = (int)x.ActivityType,
                UserName = x.UserName,
                Message = x.Message,
                CreatedAt = x.CreatedAt
            }).ToList()
        };
    }
}

public sealed class AccountingAuditWorkflowService : IAccountingAuditWorkflowService
{
    private readonly ITenantDbContextFactory _contextFactory;

    public AccountingAuditWorkflowService(ITenantDbContextFactory contextFactory) =>
        _contextFactory = contextFactory;

    public Task<Result<AccountingAnomalyDetailDto>> AssignAsync(
        Guid anomalyId, Guid? assigneeUserId, string? assigneeUserName, Guid actorUserId, string? actorUserName,
        CancellationToken cancellationToken = default) =>
        MutateAsync(anomalyId, actorUserId, actorUserName, a =>
        {
            a.AssignedToUserId = assigneeUserId;
            a.AssignedToUserName = assigneeUserName;
            if (a.Status == AnomalyStatus.Open) a.Status = AnomalyStatus.InProgress;
            return (AuditActivityType.Assigned, $"Assigné à {assigneeUserName ?? "—"}");
        }, cancellationToken);

    public Task<Result<AccountingAnomalyDetailDto>> UpdateStatusAsync(
        Guid anomalyId, int status, Guid actorUserId, string? actorUserName,
        CancellationToken cancellationToken = default) =>
        MutateAsync(anomalyId, actorUserId, actorUserName, a =>
        {
            var old = a.Status;
            a.Status = (AnomalyStatus)status;
            if (a.Status == AnomalyStatus.Corrected) a.ResolvedAt = DateTime.UtcNow;
            return (AuditActivityType.StatusChanged, $"Statut : {old} → {a.Status}");
        }, cancellationToken);

    public Task<Result<AccountingAnomalyDetailDto>> AddCommentAsync(
        Guid anomalyId, string comment, Guid actorUserId, string? actorUserName,
        CancellationToken cancellationToken = default) =>
        MutateAsync(anomalyId, actorUserId, actorUserName, a =>
            (AuditActivityType.Commented, comment), cancellationToken);

    public Task<Result<AccountingAnomalyDetailDto>> IgnoreAsync(
        Guid anomalyId, string reason, Guid actorUserId, string? actorUserName,
        CancellationToken cancellationToken = default) =>
        MutateAsync(anomalyId, actorUserId, actorUserName, a =>
        {
            a.Status = AnomalyStatus.Ignored;
            a.IgnoreReason = reason;
            a.ResolvedAt = DateTime.UtcNow;
            return (AuditActivityType.Ignored, reason);
        }, cancellationToken);

    public Task<Result<AccountingAnomalyDetailDto>> ResolveAsync(
        Guid anomalyId, Guid actorUserId, string? actorUserName,
        CancellationToken cancellationToken = default) =>
        MutateAsync(anomalyId, actorUserId, actorUserName, a =>
        {
            a.Status = AnomalyStatus.Corrected;
            a.ResolvedAt = DateTime.UtcNow;
            return (AuditActivityType.Corrected, "Marqué comme corrigé");
        }, cancellationToken);

    private async Task<Result<AccountingAnomalyDetailDto>> MutateAsync(
        Guid anomalyId,
        Guid actorUserId,
        string? actorUserName,
        Func<AccountingAnomaly, (AuditActivityType Type, string Message)> mutate,
        CancellationToken cancellationToken)
    {
        await using var ctx = _contextFactory.CreateContext();
        var anomaly = await ctx.Set<AccountingAnomaly>()
            .Include(a => a.Run)
            .Include(a => a.Lines)
            .Include(a => a.Activities)
            .FirstOrDefaultAsync(a => a.Id == anomalyId, cancellationToken);
        if (anomaly is null)
            return Result.Failure<AccountingAnomalyDetailDto>(Error.NotFound("AccountingAnomaly", anomalyId));

        var (type, message) = mutate(anomaly);
        ctx.Set<AccountingAnomalyActivity>().Add(new AccountingAnomalyActivity
        {
            AnomalyId = anomaly.Id,
            ActivityType = type,
            UserId = actorUserId,
            UserName = actorUserName,
            Message = message
        });
        await ctx.SaveChangesAsync(cancellationToken);
        return Result.Success(AccountingAuditQueryService.MapDetail(anomaly));
    }
}

public sealed class AccountingAuditExportService : IAccountingAuditExportService
{
    /// <summary>
    /// Anomalies détaillées dans le PDF. Au-delà, le rapport le signale et renvoie vers le CSV :
    /// un dossier pathologique produirait sinon un document de plusieurs centaines de pages.
    /// </summary>
    private const int MaxAnomaliesInPdf = 300;

    private readonly IAccountingAuditQueryService _queries;
    private readonly IPdfService _pdf;
    private readonly ICompanyRepository _companies;

    public AccountingAuditExportService(
        IAccountingAuditQueryService queries,
        IPdfService pdf,
        ICompanyRepository companies)
    {
        _queries = queries;
        _pdf = pdf;
        _companies = companies;
    }

    public async Task<Result<byte[]>> ExportCsvAsync(AccountingAnomalyFilterDto filter, CancellationToken cancellationToken = default)
    {
        filter = filter with { Page = 1, PageSize = 10_000 };
        var result = await _queries.GetAnomaliesAsync(filter, cancellationToken);
        if (result.IsFailure) return Result.Failure<byte[]>(result.Error);

        var sb = new StringBuilder();
        sb.AppendLine("Sévérité;Catégorie;Titre;Compte;Montant;Statut;Assigné à;Détecté le");
        foreach (var item in result.Value.Items)
        {
            sb.AppendLine($"{item.Severity};{item.Category};{Escape(item.Title)};{Escape(item.AccountRef)};{item.Amount:N3};{item.Status};{Escape(item.AssignedToUserName)};{item.DetectedAt:yyyy-MM-dd}");
        }
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return Result.Success(bytes);
    }

    public async Task<Result<byte[]>> ExportPdfAsync(int fiscalYear, CancellationToken cancellationToken = default)
    {
        var dash = await _queries.GetDashboardAsync(fiscalYear, cancellationToken);
        if (dash.IsFailure) return Result.Failure<byte[]>(dash.Error);

        var filter = new AccountingAnomalyFilterDto { FiscalYear = fiscalYear, PageSize = MaxAnomaliesInPdf };
        var anomalies = await _queries.GetAnomaliesAsync(filter, cancellationToken);
        if (anomalies.IsFailure) return Result.Failure<byte[]>(anomalies.Error);

        // Les modules sont informatifs : leur absence ne doit pas priver l'utilisateur du rapport.
        var modules = await _queries.GetModulesAsync(fiscalYear, cancellationToken);

        var company = await _companies.GetDefaultAsync(cancellationToken);
        var header = new AccountingReportHeader(
            company?.Name ?? "Société",
            company?.VatCode,
            "Rapport de contrôle d'intégrité",
            $"Exercice {fiscalYear}");

        var pdf = await _pdf.GenerateAccountingAuditPdfAsync(
            new AccountingAuditPdfContext
            {
                Header = header,
                Dashboard = dash.Value,
                Anomalies = anomalies.Value.Items,
                Modules = modules.IsSuccess ? modules.Value : Array.Empty<AccountingControlModuleDto>(),
                TotalAnomalyCount = anomalies.Value.TotalCount
            },
            cancellationToken);

        return Result.Success(pdf);
    }

    private static string Escape(string? v) => (v ?? "").Replace(';', ',');
}

public sealed class AccountingAuditScheduleService : IAccountingAuditScheduleService
{
    private readonly ITenantDbContextFactory _contextFactory;

    public AccountingAuditScheduleService(ITenantDbContextFactory contextFactory) =>
        _contextFactory = contextFactory;

    public async Task<Result<IReadOnlyList<AccountingControlScheduleDto>>> ListSchedulesAsync(CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var items = await ctx.Set<AccountingControlSchedule>().AsNoTracking()
            .OrderBy(s => s.Name)
            .ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<AccountingControlScheduleDto>>(items.Select(MapSchedule).ToList());
    }

    public async Task<Result<AccountingControlScheduleDto>> SaveScheduleAsync(
        AccountingControlScheduleDto dto, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        AccountingControlSchedule entity;
        if (dto.Id is { } id && id != Guid.Empty)
        {
            entity = await ctx.Set<AccountingControlSchedule>().FirstOrDefaultAsync(s => s.Id == id, cancellationToken)
                     ?? new AccountingControlSchedule();
            if (entity.Id == Guid.Empty) ctx.Set<AccountingControlSchedule>().Add(entity);
        }
        else
        {
            entity = new AccountingControlSchedule();
            ctx.Set<AccountingControlSchedule>().Add(entity);
        }

        entity.Name = dto.Name;
        entity.CronExpression = dto.CronExpression;
        entity.IsActive = dto.IsActive;
        entity.FiscalYearOffset = dto.FiscalYearOffset;
        entity.ModuleCodesFilter = dto.ModuleCodesFilter;
        entity.NotifyEmails = dto.NotifyEmails;

        await ctx.SaveChangesAsync(cancellationToken);
        return Result.Success(MapSchedule(entity));
    }

    public async Task<Result<bool>> DeleteScheduleAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var entity = await ctx.Set<AccountingControlSchedule>().FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (entity is null) return Result.Success(false);
        ctx.Set<AccountingControlSchedule>().Remove(entity);
        await ctx.SaveChangesAsync(cancellationToken);
        return Result.Success(true);
    }

    private static AccountingControlScheduleDto MapSchedule(AccountingControlSchedule s) => new()
    {
        Id = s.Id,
        Name = s.Name,
        CronExpression = s.CronExpression,
        IsActive = s.IsActive,
        FiscalYearOffset = s.FiscalYearOffset,
        ModuleCodesFilter = s.ModuleCodesFilter,
        NotifyEmails = s.NotifyEmails,
        LastRunAt = s.LastRunAt
    };
}

public sealed class AccountingAuditRuleSettingsService : IAccountingAuditRuleSettingsService
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly AccountingAuditRuleRegistry _registry;

    public AccountingAuditRuleSettingsService(
        ITenantDbContextFactory contextFactory,
        AccountingAuditRuleRegistry registry)
    {
        _contextFactory = contextFactory;
        _registry = registry;
    }

    public async Task<Result<IReadOnlyList<AccountingControlRuleSettingDto>>> GetSettingsAsync(
        CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        var saved = await ctx.Set<AccountingControlRuleSetting>().AsNoTracking().ToListAsync(cancellationToken);
        var dtos = _registry.GetAll().Select(rule =>
        {
            var s = saved.FirstOrDefault(x => x.RuleCode == rule.Code);
            return new AccountingControlRuleSettingDto
            {
                RuleCode = rule.Code,
                Title = rule.Code,
                IsEnabled = s?.IsEnabled ?? true,
                IntThreshold = s?.IntThreshold,
                DecimalThreshold = s?.DecimalThreshold
            };
        }).ToList();
        return Result.Success<IReadOnlyList<AccountingControlRuleSettingDto>>(dtos);
    }

    public async Task<Result<IReadOnlyList<AccountingControlRuleSettingDto>>> SaveSettingsAsync(
        IReadOnlyList<AccountingControlRuleSettingDto> settings,
        CancellationToken cancellationToken = default)
    {
        await using var ctx = _contextFactory.CreateContext();
        foreach (var dto in settings)
        {
            var entity = await ctx.Set<AccountingControlRuleSetting>()
                .FirstOrDefaultAsync(s => s.RuleCode == dto.RuleCode, cancellationToken);
            if (entity is null)
            {
                entity = new AccountingControlRuleSetting { RuleCode = dto.RuleCode };
                ctx.Set<AccountingControlRuleSetting>().Add(entity);
            }
            entity.IsEnabled = dto.IsEnabled;
            entity.IntThreshold = dto.IntThreshold;
            entity.DecimalThreshold = dto.DecimalThreshold;
        }
        await ctx.SaveChangesAsync(cancellationToken);
        return await GetSettingsAsync(cancellationToken);
    }
}
