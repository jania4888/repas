using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Files;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Stock.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Projects;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace FactuTrust.Infrastructure.Services.Projects;

public sealed class ProjectService : IProjectService, IAsyncDisposable
{
    private readonly TenantDbContext _db;
    private readonly MasterDbContext _master;
    private readonly IClientRepository _clients;
    private readonly IPurchaseOrderRepository _purchaseOrders;
    private readonly ISupplierRepository _suppliers;
    private readonly IProductRepository _products;
    private readonly IInvoiceNumberGenerator _numbers;
    private readonly ICurrentUser _currentUser;
    private readonly ITenantContext _tenantContext;
    private readonly IMediator _mediator;
    private readonly IConfiguration _configuration;

    public ProjectService(
        ITenantDbContextFactory tenantFactory,
        MasterDbContext master,
        IClientRepository clients,
        IPurchaseOrderRepository purchaseOrders,
        ISupplierRepository suppliers,
        IProductRepository products,
        IInvoiceNumberGenerator numbers,
        ICurrentUser currentUser,
        ITenantContext tenantContext,
        IMediator mediator,
        IConfiguration configuration)
    {
        _db = tenantFactory.CreateIsolatedContext();
        _master = master;
        _clients = clients;
        _purchaseOrders = purchaseOrders;
        _suppliers = suppliers;
        _products = products;
        _numbers = numbers;
        _currentUser = currentUser;
        _tenantContext = tenantContext;
        _mediator = mediator;
        _configuration = configuration;
    }

    public ValueTask DisposeAsync() => _db.DisposeAsync();

    public async Task<PagedResult<ProjectListItemDto>> ListAsync(
        ProjectListQuery query, CancellationToken cancellationToken = default)
    {
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var q = ApplyListFilters(_db.Projects.AsNoTracking().AsQueryable(), query);
        if (query.OverdueOnly == true)
            q = ApplyOverdueFilter(q);

        var total = await q.CountAsync(cancellationToken);
        var items = await q.OrderByDescending(p => p.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        var dtos = await MapListItemsAsync(items, cancellationToken);
        return PagedResult<ProjectListItemDto>.Create(dtos, page, pageSize, total);
    }

    public async Task<byte[]> ExportListCsvAsync(ProjectListQuery query, CancellationToken cancellationToken = default)
    {
        var exportQuery = query with { Page = 1, PageSize = ProjectListCsvExporter.MaxRows };
        var q = ApplyListFilters(_db.Projects.AsNoTracking().AsQueryable(), exportQuery);
        if (exportQuery.OverdueOnly == true)
            q = ApplyOverdueFilter(q);
        var items = await q.OrderByDescending(p => p.CreatedAt).Take(ProjectListCsvExporter.MaxRows).ToListAsync(cancellationToken);
        var dtos = await MapListItemsAsync(items, cancellationToken);
        return ProjectListCsvExporter.ToCsvBytes(dtos);
    }

    private static IQueryable<Project> ApplyListFilters(IQueryable<Project> q, ProjectListQuery query)
    {
        if (query.Status.HasValue) q = q.Where(p => p.Status == query.Status.Value);
        if (query.Kind.HasValue) q = q.Where(p => p.Kind == query.Kind.Value);
        if (query.ClientId.HasValue) q = q.Where(p => p.ClientId == query.ClientId.Value);
        if (query.OwnerUserId.HasValue) q = q.Where(p => p.OwnerUserId == query.OwnerUserId.Value);
        if (query.BillingMode.HasValue) q = q.Where(p => p.BillingMode == query.BillingMode.Value);
        if (query.EndDateFrom.HasValue) q = q.Where(p => p.EndDate != null && p.EndDate >= query.EndDateFrom.Value);
        if (query.EndDateTo.HasValue) q = q.Where(p => p.EndDate != null && p.EndDate <= query.EndDateTo.Value);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            q = q.Where(p =>
                p.Name.Contains(term)
                || (p.ContractNumber != null && p.ContractNumber.Contains(term))
                || (p.Description != null && p.Description.Contains(term)));
        }

        return q;
    }

    private IQueryable<Project> ApplyOverdueFilter(IQueryable<Project> q)
    {
        var today = DateTime.UtcNow.Date;
        return q.Where(p => _db.ProjectTasks.Any(t =>
            t.ProjectId == p.Id
            && t.DueDate != null
            && t.DueDate < today
            && t.Status != ProjectTaskStatus.Done
            && t.Status != ProjectTaskStatus.Cancelled));
    }

    private async Task<IReadOnlyList<ProjectListItemDto>> MapListItemsAsync(
        IReadOnlyList<Project> items, CancellationToken cancellationToken)
    {
        var names = await LoadClientNamesAsync(items.Select(p => p.ClientId), cancellationToken);
        var projectIds = items.Select(p => p.Id).ToList();
        var today = DateTime.UtcNow.Date;
        var taskStats = projectIds.Count == 0
            ? []
            : await _db.ProjectTasks.AsNoTracking()
                .Where(t => projectIds.Contains(t.ProjectId) && t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled)
                .GroupBy(t => t.ProjectId)
                .Select(g => new { g.Key, Open = g.Count(), Overdue = g.Count(t => t.DueDate != null && t.DueDate < today) })
                .ToListAsync(cancellationToken);
        var openMap = taskStats.ToDictionary(x => x.Key, x => (x.Open, x.Overdue));

        var progressStats = projectIds.Count == 0
            ? new Dictionary<Guid, (int Total, int Completed)>()
            : await _db.ProjectTasks.AsNoTracking()
                .Where(t => projectIds.Contains(t.ProjectId) && t.ParentTaskId == null && t.Status != ProjectTaskStatus.Cancelled)
                .GroupBy(t => t.ProjectId)
                .Select(g => new
                {
                    g.Key,
                    Total = g.Count(),
                    Completed = g.Count(t => t.Status == ProjectTaskStatus.Done)
                })
                .ToDictionaryAsync(x => x.Key, x => (x.Total, x.Completed), cancellationToken);

        var ownerNames = await LoadUserNamesAsync(
            items.Where(p => p.OwnerUserId.HasValue).Select(p => p.OwnerUserId!.Value),
            cancellationToken);

        return items.Select(p =>
        {
            openMap.TryGetValue(p.Id, out var stats);
            progressStats.TryGetValue(p.Id, out var prog);
            var progressPercent = prog.Total > 0
                ? (int)Math.Round(prog.Completed * 100.0 / prog.Total)
                : 0;
            return new ProjectListItemDto
            {
                Id = p.Id,
                Name = p.Name,
                ClientId = p.ClientId,
                ClientName = names.GetValueOrDefault(p.ClientId, "—"),
                Kind = p.Kind,
                KindDisplay = p.Kind.ToDisplayString(),
                BillingMode = p.BillingMode,
                BillingModeDisplay = p.BillingMode.ToDisplayString(),
                Status = p.Status,
                StatusDisplay = p.Status.ToDisplayString(),
                StartDate = p.StartDate,
                EndDate = p.EndDate,
                BudgetHt = p.BudgetHt,
                OpenTaskCount = stats.Open,
                OverdueTaskCount = stats.Overdue,
                OwnerUserName = p.OwnerUserId is { } oid ? ownerNames.GetValueOrDefault(oid) : null,
                ProgressPercent = progressPercent,
                CompletedTaskCount = prog.Completed,
                TotalTaskCount = prog.Total,
                TimesheetsEnabled = p.TimesheetsEnabled
            };
        }).ToList();
    }

    public async Task<ProjectSearchResponseDto> SearchAsync(string? query, int limit, CancellationToken cancellationToken = default)
    {
        var q = query?.Trim() ?? string.Empty;
        if (q.Length < 2)
            return new ProjectSearchResponseDto { Query = q };

        if (q.Length > 100)
            q = q[..100];

        limit = Math.Clamp(limit, 1, 20);
        var perKind = Math.Max(1, (limit + 2) / 3);
        var merged = new List<ProjectSearchResultDto>();

        if (_currentUser.HasPermission(Permissions.Projects.Read))
        {
            var (matchingClients, _) = await _clients.SearchAsync(q, null, null, null, 1, 50, cancellationToken);
            var clientIds = matchingClients.Select(c => c.Id).ToHashSet();

            var projects = await _db.Projects.AsNoTracking()
                .Where(p =>
                    p.Name.Contains(q)
                    || (p.Description != null && p.Description.Contains(q))
                    || (p.ContractNumber != null && p.ContractNumber.Contains(q))
                    || clientIds.Contains(p.ClientId))
                .OrderByDescending(p => p.UpdatedAt)
                .Take(perKind * 4)
                .ToListAsync(cancellationToken);

            var clientNames = await LoadClientNamesAsync(projects.Select(p => p.ClientId), cancellationToken);
            foreach (var p in projects)
            {
                var clientName = clientNames.GetValueOrDefault(p.ClientId, "—");
                var score = ProjectSearchScoring.ScoreMatch(q, p.Name, p.Description, p.ContractNumber, clientName);
                if (score <= 0) continue;
                merged.Add(new ProjectSearchResultDto
                {
                    Kind = ProjectSearchResultKind.Project,
                    Id = p.Id,
                    ProjectId = p.Id,
                    Title = p.Name,
                    Subtitle = $"{clientName} · {p.Status.ToDisplayString()}",
                    StatusDisplay = p.Status.ToDisplayString(),
                    Score = score
                });
            }
        }

        if (_currentUser.HasPermission(Permissions.ProjectTasks.Read))
        {
            var tasks = await _db.ProjectTasks.AsNoTracking()
                .Where(t => t.Title.Contains(q) || (t.Description != null && t.Description.Contains(q)))
                .OrderByDescending(t => t.UpdatedAt)
                .Take(perKind * 4)
                .ToListAsync(cancellationToken);

            var projectIds = tasks.Select(t => t.ProjectId).Distinct().ToList();
            var projectNames = projectIds.Count == 0
                ? new Dictionary<Guid, string>()
                : await _db.Projects.AsNoTracking()
                    .Where(p => projectIds.Contains(p.Id))
                    .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

            foreach (var t in tasks)
            {
                var projectName = projectNames.GetValueOrDefault(t.ProjectId, "—");
                var score = ProjectSearchScoring.ScoreMatch(q, t.Title, t.Description, projectName);
                if (score <= 0) continue;
                merged.Add(new ProjectSearchResultDto
                {
                    Kind = ProjectSearchResultKind.Task,
                    Id = t.Id,
                    ProjectId = t.ProjectId,
                    Title = t.Title,
                    Subtitle = $"{projectName} · {t.Status.ToDisplayString()}",
                    StatusDisplay = t.Status.ToDisplayString(),
                    Score = score
                });
            }
        }

        if (_currentUser.HasPermission(Permissions.Projects.Read))
        {
            var attachments = await _db.ProjectAttachments.AsNoTracking()
                .Where(a => a.FileName.Contains(q))
                .OrderByDescending(a => a.CreatedAt)
                .Take(perKind * 4)
                .ToListAsync(cancellationToken);

            var attachmentProjectIds = attachments.Select(a => a.ProjectId).Distinct().ToList();
            var attachmentProjectNames = attachmentProjectIds.Count == 0
                ? new Dictionary<Guid, string>()
                : await _db.Projects.AsNoTracking()
                    .Where(p => attachmentProjectIds.Contains(p.Id))
                    .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

            var taskIds = attachments.Where(a => a.TaskId.HasValue).Select(a => a.TaskId!.Value).Distinct().ToList();
            var taskTitles = taskIds.Count == 0
                ? new Dictionary<Guid, string>()
                : await _db.ProjectTasks.AsNoTracking()
                    .Where(t => taskIds.Contains(t.Id))
                    .ToDictionaryAsync(t => t.Id, t => t.Title, cancellationToken);

            foreach (var a in attachments)
            {
                var projectName = attachmentProjectNames.GetValueOrDefault(a.ProjectId, "—");
                var taskTitle = a.TaskId is { } tid ? taskTitles.GetValueOrDefault(tid) : null;
                var score = ProjectSearchScoring.ScoreMatch(q, a.FileName, projectName, taskTitle);
                if (score <= 0) continue;
                var subtitle = taskTitle != null ? $"{projectName} · {taskTitle}" : projectName;
                merged.Add(new ProjectSearchResultDto
                {
                    Kind = ProjectSearchResultKind.Attachment,
                    Id = a.Id,
                    ProjectId = a.ProjectId,
                    Title = a.FileName,
                    Subtitle = subtitle,
                    Score = score
                });
            }
        }

        var results = merged
            .OrderByDescending(r => r.Score)
            .ThenBy(r => r.Title)
            .Take(limit)
            .ToList();

        return new ProjectSearchResponseDto { Query = q, Results = results };
    }

    public async Task<ProjectDashboardDto> GetDashboardAsync(CancellationToken cancellationToken = default)
    {
        var today = DateTime.UtcNow.Date;
        return new ProjectDashboardDto
        {
            ActiveProjects = await _db.Projects.CountAsync(p => p.Status == ProjectStatus.Active, cancellationToken),
            OpenTasks = await _db.ProjectTasks.CountAsync(t => t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled, cancellationToken),
            OverdueTasks = await _db.ProjectTasks.CountAsync(t => t.DueDate != null && t.DueDate < today && t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled, cancellationToken),
            UninvoicedBillableHours = await _db.ProjectTimeEntries
                .Where(t => t.IsBillable && t.Status == ProjectTimeEntryStatus.Validated && t.InvoicedInvoiceId == null)
                .SumAsync(t => (decimal?)t.Hours, cancellationToken) ?? 0m
        };
    }

    public async Task<ProjectDashboardExtendedDto> GetDashboardExtendedAsync(string? period, CancellationToken cancellationToken = default)
    {
        var today = DateTime.UtcNow.Date;
        var isMonth = string.Equals(period, "month", StringComparison.OrdinalIgnoreCase);
        var periodDays = isMonth ? 30 : 7;
        var currentStart = today.AddDays(-(periodDays - 1));
        var previousEnd = currentStart.AddDays(-1);
        var previousStart = previousEnd.AddDays(-(periodDays - 1));

        var baseDash = await GetDashboardAsync(cancellationToken);
        var completedTasks = await _db.ProjectTasks.CountAsync(t => t.Status == ProjectTaskStatus.Done, cancellationToken);

        var statusCounts = await _db.Projects.AsNoTracking()
            .GroupBy(p => p.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var totalProjects = statusCounts.Sum(x => x.Count);
        var breakdown = statusCounts
            .OrderBy(x => x.Status)
            .Select(x => new ProjectStatusBreakdownDto
            {
                Status = x.Status,
                StatusDisplay = x.Status.ToDisplayString(),
                Count = x.Count,
                Percent = totalProjects > 0 ? (int)Math.Round(x.Count * 100.0 / totalProjects) : 0
            })
            .ToList();

        var inProgressProjectIds = await _db.Projects.AsNoTracking()
            .Where(p => p.Status == ProjectStatus.Active || p.Status == ProjectStatus.OnHold)
            .Select(p => p.Id)
            .ToListAsync(cancellationToken);
        var averageProgressPercent = 0;
        if (inProgressProjectIds.Count > 0)
        {
            var progressByProject = await _db.ProjectTasks.AsNoTracking()
                .Where(t => inProgressProjectIds.Contains(t.ProjectId) && t.ParentTaskId == null && t.Status != ProjectTaskStatus.Cancelled)
                .GroupBy(t => t.ProjectId)
                .Select(g => new { g.Key, Total = g.Count(), Completed = g.Count(t => t.Status == ProjectTaskStatus.Done) })
                .ToListAsync(cancellationToken);
            if (progressByProject.Count > 0)
            {
                var sum = progressByProject.Sum(x => x.Total > 0 ? (int)Math.Round(x.Completed * 100.0 / x.Total) : 0);
                averageProgressPercent = (int)Math.Round(sum / (double)progressByProject.Count);
            }
        }

        var trendStart = currentStart;
        var allTasks = await _db.ProjectTasks.AsNoTracking()
            .Where(t => t.CreatedAt.Date >= trendStart
                || (t.DueDate != null && t.DueDate >= trendStart)
                || (t.Status == ProjectTaskStatus.Done && t.UpdatedAt != null && t.UpdatedAt.Value.Date >= trendStart))
            .Select(t => new { t.CreatedAt, t.Status, t.DueDate, t.UpdatedAt })
            .ToListAsync(cancellationToken);

        var taskTrend = Enumerable.Range(0, periodDays)
            .Select(i =>
            {
                var d = trendStart.AddDays(i);
                return new ProjectTaskTrendPointDto
                {
                    Date = d,
                    Created = allTasks.Count(t => t.CreatedAt.Date == d),
                    Completed = allTasks.Count(t =>
                        t.Status == ProjectTaskStatus.Done
                        && t.UpdatedAt.HasValue
                        && t.UpdatedAt.Value.Date == d),
                    Pending = allTasks.Count(t =>
                        (t.Status == ProjectTaskStatus.Todo || t.Status == ProjectTaskStatus.Waiting)
                        && t.CreatedAt.Date <= d),
                    Overdue = allTasks.Count(t =>
                        t.DueDate != null && t.DueDate < d
                        && t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled)
                };
            })
            .ToList();

        var kpiTrends = await BuildKpiTrendsAsync(currentStart, today, previousStart, previousEnd, cancellationToken);

        var recentProjects = await _db.Projects.AsNoTracking()
            .OrderByDescending(p => p.UpdatedAt)
            .Take(10)
            .ToListAsync(cancellationToken);
        var recentIds = recentProjects.Select(p => p.Id).ToList();
        var recentClientNames = await LoadClientNamesAsync(recentProjects.Select(p => p.ClientId), cancellationToken);
        var recentOwnerNames = await LoadUserNamesAsync(
            recentProjects.Where(p => p.OwnerUserId.HasValue).Select(p => p.OwnerUserId!.Value),
            cancellationToken);
        var recentProgress = recentIds.Count == 0
            ? new Dictionary<Guid, (int Total, int Completed)>()
            : await _db.ProjectTasks.AsNoTracking()
                .Where(t => recentIds.Contains(t.ProjectId) && t.ParentTaskId == null && t.Status != ProjectTaskStatus.Cancelled)
                .GroupBy(t => t.ProjectId)
                .Select(g => new { g.Key, Total = g.Count(), Completed = g.Count(t => t.Status == ProjectTaskStatus.Done) })
                .ToDictionaryAsync(x => x.Key, x => (x.Total, x.Completed), cancellationToken);

        var recentRows = recentProjects.Select(p =>
        {
            recentProgress.TryGetValue(p.Id, out var prog);
            var progressPercent = prog.Total > 0 ? (int)Math.Round(prog.Completed * 100.0 / prog.Total) : 0;
            return new ProjectRecentRowDto
            {
                Id = p.Id,
                Name = p.Name,
                Description = p.Description,
                Kind = p.Kind,
                KindDisplay = p.Kind.ToDisplayString(),
                ClientName = recentClientNames.GetValueOrDefault(p.ClientId, "—"),
                OwnerUserName = p.OwnerUserId is { } oid ? recentOwnerNames.GetValueOrDefault(oid) : null,
                ProgressPercent = progressPercent,
                Status = p.Status,
                StatusDisplay = p.Status.ToDisplayString(),
                EndDate = p.EndDate
            };
        }).ToList();

        var upcomingRaw = await _db.ProjectTasks.AsNoTracking()
            .Where(t => t.DueDate != null && t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled)
            .OrderBy(t => t.DueDate)
            .Take(10)
            .ToListAsync(cancellationToken);
        var upcomingProjectIds = upcomingRaw.Select(t => t.ProjectId).Distinct().ToList();
        var upcomingProjectNames = upcomingProjectIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.Projects.AsNoTracking()
                .Where(p => upcomingProjectIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        var upcomingAssigneeNames = await LoadUserNamesAsync(
            upcomingRaw.Where(t => t.AssigneeUserId.HasValue).Select(t => t.AssigneeUserId!.Value),
            cancellationToken);

        var upcomingTasks = upcomingRaw.Select(t => new ProjectUpcomingTaskRowDto
        {
            Id = t.Id,
            ProjectId = t.ProjectId,
            ProjectName = upcomingProjectNames.GetValueOrDefault(t.ProjectId, "—"),
            Title = t.Title,
            DueDate = t.DueDate,
            AssigneeUserName = t.AssigneeUserId is { } aid ? upcomingAssigneeNames.GetValueOrDefault(aid) : null,
            Priority = t.Priority,
            PriorityDisplay = t.Priority.ToDisplayString(),
            IsOverdue = t.DueDate != null && t.DueDate < today
        }).ToList();

        var recentActivity = await _db.ProjectActivities.AsNoTracking()
            .OrderByDescending(a => a.CreatedAt)
            .Take(50)
            .ToListAsync(cancellationToken);
        var activeUserIds = recentActivity
            .Where(a => a.ActorUserId.HasValue)
            .Select(a => a.ActorUserId!.Value)
            .Distinct()
            .Take(8)
            .ToList();
        var activeUserNames = await LoadUserNamesAsync(activeUserIds, cancellationToken);
        var memberRoles = activeUserIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.ProjectMembers.AsNoTracking()
                .Where(m => activeUserIds.Contains(m.UserId))
                .GroupBy(m => m.UserId)
                .Select(g => new { g.Key, Role = g.OrderByDescending(m => m.CreatedAt).First().Role })
                .ToDictionaryAsync(x => x.Key, x => x.Role.ToDisplayString(), cancellationToken);

        var activeMembers = activeUserIds.Select(uid =>
        {
            var lastAt = recentActivity.FirstOrDefault(a => a.ActorUserId == uid)?.CreatedAt;
            return new ProjectActiveMemberRowDto
            {
                UserId = uid,
                DisplayName = activeUserNames.GetValueOrDefault(uid, "—"),
                RoleDisplay = memberRoles.GetValueOrDefault(uid),
                LastActivityAt = lastAt,
                ActivityStatus = ResolveActivityStatus(lastAt, today)
            };
        }).ToList();

        var performanceSummary = BuildPerformanceSummary(kpiTrends, baseDash.OverdueTasks);

        return new ProjectDashboardExtendedDto
        {
            ActiveProjects = baseDash.ActiveProjects,
            OpenTasks = baseDash.OpenTasks,
            OverdueTasks = baseDash.OverdueTasks,
            UninvoicedBillableHours = baseDash.UninvoicedBillableHours,
            CompletedTasks = completedTasks,
            TotalProjects = totalProjects,
            AverageProgressPercent = averageProgressPercent,
            ProgressTargetPercent = 90,
            KpiTrends = kpiTrends,
            PerformanceSummary = performanceSummary,
            ProjectStatusBreakdown = breakdown,
            TaskTrend = taskTrend,
            RecentProjects = recentRows,
            UpcomingTasks = upcomingTasks,
            ActiveMembers = activeMembers
        };
    }

    private async Task<ProjectDashboardKpiTrendsDto> BuildKpiTrendsAsync(
        DateTime currentStart,
        DateTime currentEnd,
        DateTime previousStart,
        DateTime previousEnd,
        CancellationToken cancellationToken)
    {
        var activeCurrent = await _db.Projects.CountAsync(
            p => p.Status == ProjectStatus.Active, cancellationToken);
        var activePrevious = await _db.Projects.CountAsync(
            p => p.Status == ProjectStatus.Active && p.CreatedAt.Date <= previousEnd, cancellationToken);

        var openCurrent = await _db.ProjectTasks.CountAsync(
            t => t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled, cancellationToken);
        var openPrevious = await _db.ProjectTasks.CountAsync(
            t => t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled
                 && t.CreatedAt.Date <= previousEnd, cancellationToken);

        var completedCurrent = await _db.ProjectTasks.CountAsync(
            t => t.Status == ProjectTaskStatus.Done
                 && t.UpdatedAt != null
                 && t.UpdatedAt.Value.Date >= currentStart
                 && t.UpdatedAt.Value.Date <= currentEnd,
            cancellationToken);
        var completedPrevious = await _db.ProjectTasks.CountAsync(
            t => t.Status == ProjectTaskStatus.Done
                 && t.UpdatedAt != null
                 && t.UpdatedAt.Value.Date >= previousStart
                 && t.UpdatedAt.Value.Date <= previousEnd,
            cancellationToken);

        var overdueCurrent = await _db.ProjectTasks.CountAsync(
            t => t.DueDate != null && t.DueDate < currentEnd
                 && t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled,
            cancellationToken);
        var overduePrevious = await _db.ProjectTasks.CountAsync(
            t => t.DueDate != null && t.DueDate < previousEnd
                 && t.Status != ProjectTaskStatus.Done && t.Status != ProjectTaskStatus.Cancelled
                 && t.CreatedAt.Date <= previousEnd,
            cancellationToken);

        var hoursCurrent = await _db.ProjectTimeEntries
            .Where(t => t.IsBillable && t.Status == ProjectTimeEntryStatus.Validated && t.InvoicedInvoiceId == null)
            .SumAsync(t => (decimal?)t.Hours, cancellationToken) ?? 0m;
        var hoursPrevious = await _db.ProjectTimeEntries
            .Where(t => t.IsBillable && t.Status == ProjectTimeEntryStatus.Validated
                        && t.InvoicedInvoiceId == null && t.WorkDate <= previousEnd)
            .SumAsync(t => (decimal?)t.Hours, cancellationToken) ?? 0m;

        var progressCurrent = await ComputeAverageProgressPercentAsync(cancellationToken);
        var progressPrevious = await ComputeAverageProgressPercentAsync(previousEnd, cancellationToken);

        return new ProjectDashboardKpiTrendsDto
        {
            ActiveProjectsChangePercent = ComputeChangePercent(activeCurrent, activePrevious),
            OpenTasksChangePercent = ComputeChangePercent(openCurrent, openPrevious),
            CompletedTasksChangePercent = ComputeChangePercent(completedCurrent, completedPrevious),
            OverdueTasksChangePercent = ComputeChangePercent(overdueCurrent, overduePrevious),
            UninvoicedBillableHoursChangePercent = ComputeChangePercent(hoursCurrent, hoursPrevious),
            AverageProgressChangePercent = ComputeChangePercent(progressCurrent, progressPrevious)
        };
    }

    private async Task<int> ComputeAverageProgressPercentAsync(
        CancellationToken cancellationToken)
        => await ComputeAverageProgressPercentAsync(null, cancellationToken);

    private async Task<int> ComputeAverageProgressPercentAsync(
        DateTime? asOfDate,
        CancellationToken cancellationToken)
    {
        var inProgressQuery = _db.Projects.AsNoTracking()
            .Where(p => p.Status == ProjectStatus.Active || p.Status == ProjectStatus.OnHold);
        if (asOfDate.HasValue)
            inProgressQuery = inProgressQuery.Where(p => p.CreatedAt.Date <= asOfDate.Value);

        var inProgressProjectIds = await inProgressQuery.Select(p => p.Id).ToListAsync(cancellationToken);
        if (inProgressProjectIds.Count == 0)
            return 0;

        var progressByProject = await _db.ProjectTasks.AsNoTracking()
            .Where(t => inProgressProjectIds.Contains(t.ProjectId) && t.ParentTaskId == null && t.Status != ProjectTaskStatus.Cancelled)
            .GroupBy(t => t.ProjectId)
            .Select(g => new { g.Key, Total = g.Count(), Completed = g.Count(t => t.Status == ProjectTaskStatus.Done) })
            .ToListAsync(cancellationToken);
        if (progressByProject.Count == 0)
            return 0;

        var sum = progressByProject.Sum(x => x.Total > 0 ? (int)Math.Round(x.Completed * 100.0 / x.Total) : 0);
        return (int)Math.Round(sum / (double)progressByProject.Count);
    }

    private static int? ComputeChangePercent(decimal current, decimal previous)
    {
        if (previous == 0)
            return current > 0 ? 100 : null;
        return (int)Math.Round((double)(current - previous) * 100.0 / (double)previous);
    }

    private static int? ComputeChangePercent(int current, int previous)
    {
        if (previous == 0)
            return current > 0 ? 100 : null;
        return (int)Math.Round((current - previous) * 100.0 / previous);
    }

    private static string ResolveActivityStatus(DateTime? lastActivityAt, DateTime today)
    {
        if (lastActivityAt is null) return "offline";
        var days = (today - lastActivityAt.Value.Date).TotalDays;
        if (days <= 1) return "online";
        if (days <= 7) return "away";
        return "offline";
    }

    private static ProjectPerformanceSummaryDto? BuildPerformanceSummary(
        ProjectDashboardKpiTrendsDto trends,
        int overdueTasks)
    {
        var stats = new List<ProjectPerformanceMiniStatDto>();

        if (trends.CompletedTasksChangePercent is { } completedChange)
        {
            stats.Add(new ProjectPerformanceMiniStatDto
            {
                Label = "Tâches terminées",
                ChangePercent = Math.Abs(completedChange),
                IsPositive = completedChange >= 0
            });
        }

        if (trends.ActiveProjectsChangePercent is { } activeChange)
        {
            stats.Add(new ProjectPerformanceMiniStatDto
            {
                Label = "Projets actifs",
                ChangePercent = Math.Abs(activeChange),
                IsPositive = activeChange >= 0
            });
        }

        if (trends.OverdueTasksChangePercent is { } overdueChange)
        {
            stats.Add(new ProjectPerformanceMiniStatDto
            {
                Label = "Tâches en retard",
                ChangePercent = Math.Abs(overdueChange),
                IsPositive = overdueChange <= 0
            });
        }

        if (stats.Count == 0)
            return null;

        var positiveCount = stats.Count(s => s.IsPositive);
        var title = positiveCount >= 2 && overdueTasks == 0
            ? "Excellente performance !"
            : positiveCount >= stats.Count / 2.0
                ? "Bonne dynamique sur vos projets"
                : "Points d'attention sur vos projets";

        return new ProjectPerformanceSummaryDto
        {
            Title = title,
            Stats = stats.Take(3).ToList()
        };
    }

    public async Task<ProjectDto?> GetAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var p = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (p is null) return null;
        var client = await _clients.GetByIdAsync(p.ClientId, cancellationToken);
        var users = await LoadUserNamesAsync(new[] { p.OwnerUserId }.Where(x => x.HasValue).Select(x => x!.Value), cancellationToken);
        var phases = await _db.ProjectPhases.AsNoTracking().Where(x => x.ProjectId == id).OrderBy(x => x.SortOrder).ToListAsync(cancellationToken);
        return MapProject(p, client?.Name ?? "—", users.GetValueOrDefault(p.OwnerUserId ?? Guid.Empty), phases);
    }

    public async Task<Result<Guid>> CreateAsync(UpsertProjectDto dto, CancellationToken cancellationToken = default)
    {
        var client = await _clients.GetByIdAsync(dto.ClientId, cancellationToken);
        if (client is null)
            return Result.Failure<Guid>(Error.NotFound("Client", dto.ClientId));

        var created = Project.Create(
            dto.ClientId, dto.Name, dto.Kind, dto.BillingMode, dto.OwnerUserId,
            dto.StartDate, dto.EndDate, dto.BudgetHt, dto.Description, dto.SiteAddress, dto.ContractNumber,
            isBillable: dto.IsBillable,
            timesheetsEnabled: dto.TimesheetsEnabled,
            milestonesEnabled: dto.MilestonesEnabled,
            allocatedHours: dto.AllocatedHours,
            analyticAccountCode: dto.AnalyticAccountCode);
        if (created.IsFailure)
            return Result.Failure<Guid>(created.Error);

        var project = created.Value;
        Audit(project);
        _db.Projects.Add(project);
        foreach (var col in ProjectPhase.DefaultColumnsFor(project.Kind))
        {
            var phase = ProjectPhase.Create(project.Id, col.Name, col.Order, col.Color).Value;
            _db.ProjectPhases.Add(phase);
        }

        AddActivity(project.Id, "created", $"Projet « {project.Name} » créé");
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(project.Id);
    }

    public async Task<Result> UpdateAsync(Guid id, UpsertProjectDto dto, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", id));
        var updated = project.Update(dto.Name, dto.Description, dto.BillingMode, dto.OwnerUserId, dto.StartDate, dto.EndDate, dto.BudgetHt, dto.SiteAddress, dto.ContractNumber);
        if (updated.IsFailure) return updated;
        project.SetBillable(dto.IsBillable);
        project.ConfigureTimesheets(dto.TimesheetsEnabled, dto.MilestonesEnabled, dto.AllocatedHours);
        project.SetAnalyticAccountCode(dto.AnalyticAccountCode);
        Audit(project, true);
        AddActivity(project.Id, "updated", "Projet mis à jour");
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public Task<Result> ActivateAsync(Guid id, CancellationToken cancellationToken = default) =>
        MutateProjectAsync(id, p => p.Activate(), "activated", "Projet activé", cancellationToken);

    public Task<Result> HoldAsync(Guid id, CancellationToken cancellationToken = default) =>
        MutateProjectAsync(id, p => p.Hold(), "held", "Projet mis en pause", cancellationToken);

    public async Task<Result> CompleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", id));
        var openTime = await _db.ProjectTimeEntries.AnyAsync(t => t.ProjectId == id && (t.Status == ProjectTimeEntryStatus.Draft || t.Status == ProjectTimeEntryStatus.Submitted), cancellationToken);
        var result = project.Complete(openTime);
        if (result.IsFailure) return result;
        Audit(project, true);
        AddActivity(project.Id, "completed", "Projet clôturé");
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public Task<Result> CancelAsync(Guid id, CancellationToken cancellationToken = default) =>
        MutateProjectAsync(id, p => p.Cancel(), "cancelled", "Projet annulé", cancellationToken);

    public async Task<IReadOnlyList<ProjectTaskDto>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var tasks = await _db.ProjectTasks.AsNoTracking().Where(t => t.ProjectId == projectId).OrderBy(t => t.CreatedAt).ToListAsync(cancellationToken);
        return await MapTasksAsync(tasks, cancellationToken);
    }

    public async Task<ProjectTaskDto?> GetTaskAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        var task = await _db.ProjectTasks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == taskId, cancellationToken);
        if (task is null) return null;
        var mapped = await MapTasksAsync(new[] { task }, cancellationToken);
        return mapped[0];
    }

    public async Task<Result<Guid>> CreateTaskAsync(Guid projectId, UpsertProjectTaskDto dto, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Result.Failure<Guid>(Error.NotFound("Project", projectId));
        if (!await _db.ProjectPhases.AnyAsync(p => p.Id == dto.PhaseId && p.ProjectId == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.Validation("PhaseId", "Colonne Kanban introuvable"));
        if (dto.ParentTaskId is { } parentId)
        {
            var parent = await _db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == parentId && t.ProjectId == projectId, cancellationToken);
            if (parent is null)
                return Result.Failure<Guid>(Error.NotFound("ProjectTask", parentId));
            if (parent.ParentTaskId.HasValue)
                return Result.Failure<Guid>(Error.Validation("ParentTaskId", "Une seule niveau de sous-tâche est autorisé"));
        }

        var created = ProjectTask.Create(projectId, dto.PhaseId, dto.Title, dto.Description, dto.Priority, dto.DueDate, dto.AssigneeUserId, dto.EmployeeId, dto.EstimatedHours, dto.ParentTaskId);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        Audit(created.Value);
        _db.ProjectTasks.Add(created.Value);
        AddActivity(projectId, "task_created", $"Tâche « {created.Value.Title} » créée", created.Value.Id);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateTaskAsync(Guid taskId, UpsertProjectTaskDto dto, CancellationToken cancellationToken = default)
    {
        var task = await _db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId, cancellationToken);
        if (task is null) return Result.Failure(Error.NotFound("ProjectTask", taskId));
        var updated = task.Update(dto.Title, dto.Description, dto.Priority, dto.DueDate, dto.AssigneeUserId, dto.EmployeeId, dto.EstimatedHours, dto.ProgressPercent);
        if (updated.IsFailure) return updated;
        if (dto.PhaseId != task.PhaseId)
        {
            var moved = task.MoveToPhase(dto.PhaseId, null);
            if (moved.IsFailure) return moved;
        }
        if (dto.Status.HasValue)
        {
            var statusSet = task.SetStatus(dto.Status.Value);
            if (statusSet.IsFailure) return statusSet;
            if (dto.Status.Value != ProjectTaskStatus.Done)
            {
                var progressSet = task.SetProgressPercent(dto.ProgressPercent);
                if (progressSet.IsFailure) return progressSet;
            }
        }
        Audit(task, true);
        await _db.SaveChangesAsync(cancellationToken);
        await SyncMilestoneProgressAsync(task.ProjectId, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> MoveTaskAsync(Guid taskId, MoveProjectTaskDto dto, CancellationToken cancellationToken = default)
    {
        var task = await _db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId, cancellationToken);
        if (task is null) return Result.Failure(Error.NotFound("ProjectTask", taskId));
        if (!await _db.ProjectPhases.AnyAsync(p => p.Id == dto.PhaseId && p.ProjectId == task.ProjectId, cancellationToken))
            return Result.Failure(Error.Validation("PhaseId", "Colonne Kanban introuvable"));
        var moved = task.MoveToPhase(dto.PhaseId, dto.Status);
        if (moved.IsFailure) return moved;
        Audit(task, true);
        AddActivity(task.ProjectId, "task_moved", $"Tâche « {task.Title} » déplacée", task.Id);
        await _db.SaveChangesAsync(cancellationToken);
        await SyncMilestoneProgressAsync(task.ProjectId, cancellationToken);
        return Result.Success();
    }

    public async Task<Result> DeleteTaskAsync(Guid taskId, CancellationToken cancellationToken = default)
    {
        var task = await _db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId, cancellationToken);
        if (task is null) return Result.Failure(Error.NotFound("ProjectTask", taskId));
        if (task.InvoicedInvoiceId.HasValue)
            return Result.Failure(Error.Validation("Task", "Impossible de supprimer une tâche déjà facturée"));
        if (await _db.ProjectTimeEntries.AnyAsync(t => t.TaskId == taskId, cancellationToken))
            return Result.Failure(Error.Validation("Task", "Impossible de supprimer une tâche qui a des temps saisis"));
        var children = await _db.ProjectTasks.Where(t => t.ParentTaskId == taskId).ToListAsync(cancellationToken);
        _db.ProjectTasks.RemoveRange(children);
        _db.ProjectTasks.Remove(task);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<ProjectCommentDto>> ListCommentsAsync(Guid projectId, Guid? taskId, CancellationToken cancellationToken = default)
    {
        var q = _db.ProjectComments.AsNoTracking().Where(c => c.ProjectId == projectId);
        if (taskId.HasValue) q = q.Where(c => c.TaskId == taskId);
        var items = await q.OrderByDescending(c => c.CreatedAt).Take(200).ToListAsync(cancellationToken);
        var names = await LoadUserNamesAsync(items.Select(c => c.AuthorUserId), cancellationToken);
        return items.Select(c => new ProjectCommentDto
        {
            Id = c.Id,
            TaskId = c.TaskId,
            AuthorUserId = c.AuthorUserId,
            AuthorName = names.GetValueOrDefault(c.AuthorUserId, "—"),
            Body = c.Body,
            CreatedAt = c.CreatedAt
        }).ToList();
    }

    public async Task<Result<Guid>> AddCommentAsync(Guid projectId, string body, Guid? taskId, CancellationToken cancellationToken = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.NotFound("Project", projectId));
        var userId = RequireUser();
        if (userId.IsFailure) return Result.Failure<Guid>(userId.Error);
        var created = ProjectComment.Create(projectId, userId.Value, body, taskId);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectComments.Add(created.Value);
        AddActivity(projectId, "comment", "Commentaire ajouté", taskId);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<IReadOnlyList<ProjectAttachmentDto>> ListAttachmentsAsync(Guid projectId, Guid? taskId, CancellationToken cancellationToken = default)
    {
        var q = _db.ProjectAttachments.AsNoTracking().Where(a => a.ProjectId == projectId);
        if (taskId.HasValue) q = q.Where(a => a.TaskId == taskId);
        var items = await q.OrderByDescending(a => a.CreatedAt).ToListAsync(cancellationToken);
        return items.Select(a => new ProjectAttachmentDto
        {
            Id = a.Id,
            TaskId = a.TaskId,
            FileName = a.FileName,
            ContentType = a.ContentType,
            SizeBytes = a.SizeBytes,
            CreatedAt = a.CreatedAt
        }).ToList();
    }

    public async Task<Result<Guid>> AddAttachmentAsync(Guid projectId, AddProjectAttachmentDto dto, CancellationToken cancellationToken = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.NotFound("Project", projectId));
        var userId = RequireUser();
        if (userId.IsFailure) return Result.Failure<Guid>(userId.Error);
        var path = string.IsNullOrWhiteSpace(dto.StoragePath)
            ? $"projects/{projectId:N}/{Guid.NewGuid():N}_{dto.FileName}"
            : dto.StoragePath;
        var created = ProjectAttachment.Create(projectId, userId.Value, dto.FileName, path, dto.ContentType, dto.SizeBytes, dto.TaskId);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectAttachments.Add(created.Value);
        AddActivity(projectId, "file", $"Fichier « {created.Value.FileName} » ajouté", dto.TaskId);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result<Guid>> UploadAttachmentAsync(
        Guid projectId, Stream content, string fileName, string contentType, long sizeBytes, Guid? taskId,
        CancellationToken cancellationToken = default)
    {
        if (content is null || sizeBytes <= 0)
            return Result.Failure<Guid>(Error.Validation("File", "Fichier requis."));
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.NotFound("Project", projectId));

        var userId = RequireUser();
        if (userId.IsFailure) return Result.Failure<Guid>(userId.Error);

        var tenantId = _tenantContext.TenantId;
        if (tenantId is null || tenantId == Guid.Empty)
            return Result.Failure<Guid>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

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
        var relative = Path.Combine(
            "tenants",
            tenantId.Value.ToString("N"),
            "projects",
            projectId.ToString("N"),
            $"{Guid.NewGuid():N}_{safeName}");
        var root = Path.GetFullPath(basePath);
        var full = Path.GetFullPath(Path.Combine(root, relative));
        if (!PathContainment.IsContained(root, full))
            return Result.Failure<Guid>(Error.Validation("FileName", "Chemin de fichier invalide"));

        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await using (var fs = File.Create(full))
        {
            if (headerRead > 0)
                await fs.WriteAsync(header.AsMemory(0, headerRead), cancellationToken);
            await content.CopyToAsync(fs, cancellationToken);
        }

        var stored = relative.Replace('\\', '/');
        var created = ProjectAttachment.Create(projectId, userId.Value, safeName, stored, contentType, sizeBytes, taskId);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectAttachments.Add(created.Value);
        AddActivity(projectId, "file", $"Fichier « {created.Value.FileName} » ajouté", taskId);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result<ProjectAttachmentFile>> DownloadAttachmentAsync(
        Guid projectId, Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await _db.ProjectAttachments.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == attachmentId && a.ProjectId == projectId, cancellationToken);
        if (attachment is null)
            return Result.Failure<ProjectAttachmentFile>(Error.NotFound("ProjectAttachment", attachmentId));

        var basePath = _configuration["AccountingAttachments:BasePath"]
            ?? Path.Combine(AppContext.BaseDirectory, "App_Data", "attachments");
        var full = Path.GetFullPath(Path.Combine(basePath, attachment.StoragePath.Replace('/', Path.DirectorySeparatorChar)));
        var root = Path.GetFullPath(basePath);
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            return Result.Failure<ProjectAttachmentFile>(Error.NotFound("ProjectAttachment", attachmentId));

        var stream = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Result.Success(new ProjectAttachmentFile
        {
            Content = stream,
            ContentType = string.IsNullOrWhiteSpace(attachment.ContentType) ? "application/octet-stream" : attachment.ContentType,
            FileName = attachment.FileName
        });
    }

    public async Task<Result> DeleteAttachmentAsync(Guid projectId, Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await _db.ProjectAttachments
            .FirstOrDefaultAsync(a => a.Id == attachmentId && a.ProjectId == projectId, cancellationToken);
        if (attachment is null)
            return Result.Failure(Error.NotFound("ProjectAttachment", attachmentId));

        var basePath = _configuration["AccountingAttachments:BasePath"]
            ?? Path.Combine(AppContext.BaseDirectory, "App_Data", "attachments");
        var full = Path.GetFullPath(Path.Combine(basePath, attachment.StoragePath.Replace('/', Path.DirectorySeparatorChar)));
        var root = Path.GetFullPath(basePath);
        if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase) && File.Exists(full))
            File.Delete(full);

        _db.ProjectAttachments.Remove(attachment);
        AddActivity(projectId, "file", $"Fichier « {attachment.FileName} » supprimé", attachment.TaskId);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<ProjectMemberDto>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectMembers.AsNoTracking().Where(m => m.ProjectId == projectId).ToListAsync(cancellationToken);
        var names = await LoadUserNamesAsync(items.Select(m => m.UserId), cancellationToken);
        return items.Select(m => MapMember(m, names.GetValueOrDefault(m.UserId, "—"))).ToList();
    }

    public async Task<Result<Guid>> AddMemberAsync(Guid projectId, UpsertProjectMemberDto dto, CancellationToken cancellationToken = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.NotFound("Project", projectId));
        if (await _db.ProjectMembers.AnyAsync(m => m.ProjectId == projectId && m.UserId == dto.UserId, cancellationToken))
            return Result.Failure<Guid>(Error.Validation("UserId", "Ce membre est déjà dans l'équipe"));
        var created = ProjectMember.Create(projectId, dto.UserId, dto.Role, dto.SalesRate, dto.HourlyCost, dto.WeeklyCapacityHours);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectMembers.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateMemberAsync(Guid memberId, UpsertProjectMemberDto dto, CancellationToken cancellationToken = default)
    {
        var member = await _db.ProjectMembers.FirstOrDefaultAsync(m => m.Id == memberId, cancellationToken);
        if (member is null) return Result.Failure(Error.NotFound("ProjectMember", memberId));
        var updated = member.Update(dto.Role, dto.SalesRate, dto.HourlyCost, dto.WeeklyCapacityHours);
        if (updated.IsFailure) return updated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> RemoveMemberAsync(Guid memberId, CancellationToken cancellationToken = default)
    {
        var member = await _db.ProjectMembers.FirstOrDefaultAsync(m => m.Id == memberId, cancellationToken);
        if (member is null) return Result.Failure(Error.NotFound("ProjectMember", memberId));
        _db.ProjectMembers.Remove(member);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<ProjectActivityDto>> ListActivitiesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectActivities.AsNoTracking()
            .Where(a => a.ProjectId == projectId)
            .OrderByDescending(a => a.CreatedAt)
            .Take(100)
            .ToListAsync(cancellationToken);
        return items.Select(a => new ProjectActivityDto
        {
            Id = a.Id,
            TaskId = a.TaskId,
            ActorUserId = a.ActorUserId,
            Type = a.Type,
            Message = a.Message,
            CreatedAt = a.CreatedAt
        }).ToList();
    }

    public async Task<IReadOnlyList<ProjectAssignableUserDto>> ListAssignableUsersAsync(CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.TenantId;
        if (tenantId is null) return Array.Empty<ProjectAssignableUserDto>();
        return await _master.Users.AsNoTracking()
            .Where(u => u.TenantId == tenantId.Value && u.IsActive)
            .OrderBy(u => u.LastName)
            .Select(u => new ProjectAssignableUserDto { Id = u.Id, DisplayName = u.FirstName + " " + u.LastName })
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<ProjectTimeEntryDto>> ListTimeEntriesAsync(
        Guid? projectId, DateTime? from, DateTime? to, ProjectTimeEntryStatus? status, CancellationToken cancellationToken = default)
    {
        var q = _db.ProjectTimeEntries.AsNoTracking().AsQueryable();
        if (projectId.HasValue) q = q.Where(t => t.ProjectId == projectId.Value);
        if (from.HasValue) q = q.Where(t => t.WorkDate >= from.Value.Date);
        if (to.HasValue) q = q.Where(t => t.WorkDate <= to.Value.Date);
        if (status.HasValue) q = q.Where(t => t.Status == status.Value);
        var items = await q.OrderByDescending(t => t.WorkDate).Take(500).ToListAsync(cancellationToken);
        var projectNames = await _db.Projects.AsNoTracking()
            .Where(p => items.Select(i => i.ProjectId).Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        var taskTitles = await LoadTaskTitlesAsync(items.Select(i => i.TaskId), cancellationToken);
        var names = await LoadUserNamesAsync(items.Select(i => i.UserId), cancellationToken);
        return items.Select(t => new ProjectTimeEntryDto
        {
            Id = t.Id,
            ProjectId = t.ProjectId,
            ProjectName = projectNames.GetValueOrDefault(t.ProjectId, "—"),
            TaskId = t.TaskId,
            TaskTitle = t.TaskId is { } tid ? taskTitles.GetValueOrDefault(tid) : null,
            UserId = t.UserId,
            UserName = names.GetValueOrDefault(t.UserId, "—"),
            WorkDate = t.WorkDate,
            Hours = t.Hours,
            IsBillable = t.IsBillable,
            Notes = t.Notes,
            Status = t.Status,
            StatusDisplay = t.Status.ToDisplayString(t.InvoicedInvoiceId.HasValue),
            InvoicedInvoiceId = t.InvoicedInvoiceId,
            SalesOrderLineId = t.SalesOrderLineId,
            EntrySource = t.EntrySource,
            IsTimerRunning = t.IsTimerRunning
        }).ToList();
    }

    public async Task<Result<Guid>> CreateTimeEntryAsync(UpsertProjectTimeEntryDto dto, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == dto.ProjectId, cancellationToken);
        if (project is null) return Result.Failure<Guid>(Error.NotFound("Project", dto.ProjectId));
        var guard = EnsureProjectAllowsNewTimeEntry(project);
        if (guard is not null) return Result.Failure<Guid>(guard);
        var userId = dto.UserId ?? _currentUser.UserId;
        if (userId is null || userId == Guid.Empty)
            return Result.Failure<Guid>(Error.Validation("UserId", "L'utilisateur est obligatoire"));

        var taskGuard = await EnsureTimeEntryTaskBelongsToProjectAsync(dto.ProjectId, dto.TaskId, cancellationToken);
        if (taskGuard is not null) return Result.Failure<Guid>(taskGuard);

        var isBillable = ResolveEntryBillable(project, dto.IsBillable, dto.SalesOrderLineId);
        if (isBillable && project.SalesOrderId.HasValue && !dto.SalesOrderLineId.HasValue)
            return Result.Failure<Guid>(Error.Validation("SalesOrderLineId", "Une ligne de commande est requise pour le temps facturable"));

        var created = ProjectTimeEntry.Create(
            dto.ProjectId, userId.Value, dto.WorkDate, dto.Hours, isBillable, dto.Notes, dto.TaskId, dto.SalesOrderLineId);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectTimeEntries.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateTimeEntryAsync(Guid id, UpsertProjectTimeEntryDto dto, CancellationToken cancellationToken = default)
    {
        var entry = await _db.ProjectTimeEntries.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (entry is null) return Result.Failure(Error.NotFound("ProjectTimeEntry", id));
        if (entry.ProjectId != dto.ProjectId)
            return Result.Failure(Error.Validation("ProjectId", "Le projet ne peut pas être modifié"));
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == entry.ProjectId, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", entry.ProjectId));
        var guard = EnsureProjectAllowsTimeWorkflow(project);
        if (guard is not null) return Result.Failure(guard);
        var taskGuard = await EnsureTimeEntryTaskBelongsToProjectAsync(dto.ProjectId, dto.TaskId, cancellationToken);
        if (taskGuard is not null) return Result.Failure(taskGuard);
        var updated = entry.Update(dto.WorkDate, dto.Hours, dto.IsBillable, dto.Notes, dto.TaskId);
        if (updated.IsFailure) return updated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SubmitTimeEntryAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var entry = await _db.ProjectTimeEntries.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (entry is null) return Result.Failure(Error.NotFound("ProjectTimeEntry", id));
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == entry.ProjectId, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", entry.ProjectId));
        var guard = EnsureProjectAllowsTimeWorkflow(project);
        if (guard is not null) return Result.Failure(guard);
        var submitted = entry.Submit();
        if (submitted.IsFailure) return submitted;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ValidateTimeEntryAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var entry = await _db.ProjectTimeEntries.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (entry is null) return Result.Failure(Error.NotFound("ProjectTimeEntry", id));
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == entry.ProjectId, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", entry.ProjectId));
        var guard = EnsureProjectAllowsTimeWorkflow(project);
        if (guard is not null) return Result.Failure(guard);
        var validated = entry.Validate();
        if (validated.IsFailure) return validated;

        if (entry.IsBillable && entry.SalesOrderLineId.HasValue)
        {
            var delivery = await RecordTimesheetDeliveryOnSalesOrderAsync(project, entry.SalesOrderLineId.Value, entry.Hours, cancellationToken);
            if (delivery.IsFailure) return delivery;
        }

        var member = await _db.ProjectMembers.FirstOrDefaultAsync(m => m.ProjectId == entry.ProjectId && m.UserId == entry.UserId, cancellationToken);
        var rate = member?.HourlyCost is > 0 ? member.HourlyCost : null;
        if (rate is > 0)
        {
            var cost = ProjectCostLine.Create(entry.ProjectId, ProjectCostSource.Time, $"Temps {entry.WorkDate:dd/MM/yyyy}", entry.Hours * rate.Value, entry.WorkDate, entry.Id, entry.Id);
            if (cost.IsSuccess)
                _db.ProjectCostLines.Add(cost.Value);
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> DeleteTimeEntryAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var entry = await _db.ProjectTimeEntries.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (entry is null) return Result.Failure(Error.NotFound("ProjectTimeEntry", id));
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == entry.ProjectId, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", entry.ProjectId));
        var guard = EnsureProjectAllowsTimeWorkflow(project);
        if (guard is not null) return Result.Failure(guard);
        if (!entry.CanBeDeleted())
            return Result.Failure(Error.Validation("Status", "Seuls les temps en brouillon peuvent être supprimés"));
        _db.ProjectTimeEntries.Remove(entry);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ReopenTimeEntryAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var entry = await _db.ProjectTimeEntries.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (entry is null) return Result.Failure(Error.NotFound("ProjectTimeEntry", id));
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == entry.ProjectId, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", entry.ProjectId));
        var guard = EnsureProjectAllowsTimeWorkflow(project);
        if (guard is not null) return Result.Failure(guard);

        var permission = entry.Status switch
        {
            ProjectTimeEntryStatus.Submitted => Permissions.ProjectTime.Submit,
            ProjectTimeEntryStatus.Validated => Permissions.ProjectTime.Validate,
            _ => null
        };
        if (permission is null)
            return Result.Failure(Error.Validation("Status", "Seuls les temps soumis ou validés peuvent être rouverts"));
        if (!_currentUser.HasPermission(permission))
            return Result.Failure(Error.Forbidden("Vous n'avez pas la permission de rouvrir ce temps"));

        if (entry.Status == ProjectTimeEntryStatus.Validated)
        {
            var costLines = await _db.ProjectCostLines
                .Where(c => c.TimeEntryId == entry.Id)
                .ToListAsync(cancellationToken);
            _db.ProjectCostLines.RemoveRange(costLines);
        }

        var reopened = entry.ReopenToDraft();
        if (reopened.IsFailure) return reopened;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<ProjectCostLineDto>> ListCostLinesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectCostLines.AsNoTracking().Where(c => c.ProjectId == projectId).OrderByDescending(c => c.OccurredOn).ToListAsync(cancellationToken);
        return items.Select(c => new ProjectCostLineDto
        {
            Id = c.Id,
            Source = c.Source,
            SourceDisplay = c.Source.ToDisplayString(),
            SourceId = c.SourceId,
            Description = c.Description,
            AmountHt = c.AmountHt,
            OccurredOn = c.OccurredOn
        }).ToList();
    }

    public async Task<Result<Guid>> AddManualCostAsync(Guid projectId, AddProjectCostLineDto dto, CancellationToken cancellationToken = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.NotFound("Project", projectId));
        var created = ProjectCostLine.Create(projectId, ProjectCostSource.Manual, dto.Description, dto.AmountHt, dto.OccurredOn);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectCostLines.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<ProjectBudgetDto> GetBudgetAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        var actual = await _db.ProjectCostLines.Where(c => c.ProjectId == projectId).SumAsync(c => (decimal?)c.AmountHt, cancellationToken) ?? 0m;
        var timeCost = await _db.ProjectCostLines.Where(c => c.ProjectId == projectId && c.Source == ProjectCostSource.Time).SumAsync(c => (decimal?)c.AmountHt, cancellationToken) ?? 0m;
        var logged = await _db.ProjectTimeEntries.Where(t => t.ProjectId == projectId).SumAsync(t => (decimal?)t.Hours, cancellationToken) ?? 0m;
        var unbilled = await _db.ProjectTimeEntries
            .Where(t => t.ProjectId == projectId && t.IsBillable && t.Status == ProjectTimeEntryStatus.Validated && t.InvoicedInvoiceId == null)
            .SumAsync(t => (decimal?)t.Hours, cancellationToken) ?? 0m;
        var budget = project?.BudgetHt ?? 0m;
        return new ProjectBudgetDto
        {
            BudgetHt = budget,
            ActualCostHt = actual,
            TimeCostHt = timeCost,
            RemainingHt = budget - actual,
            LoggedHours = logged,
            BillableUninvoicedHours = unbilled
        };
    }

    public async Task<IReadOnlyList<ProjectMilestoneDto>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectMilestones.AsNoTracking().Where(m => m.ProjectId == projectId).OrderBy(m => m.DueDate).ToListAsync(cancellationToken);
        return items.Select(MapMilestone).ToList();
    }

    public async Task<Result<Guid>> AddMilestoneAsync(Guid projectId, UpsertProjectMilestoneDto dto, CancellationToken cancellationToken = default)
    {
        var project = await RequireKindAsync(projectId, ProjectKind.Esn, cancellationToken);
        if (project.IsFailure) return Result.Failure<Guid>(project.Error);
        var created = ProjectMilestone.Create(projectId, dto.Name, dto.Percent, dto.AmountHt, dto.DueDate, dto.SalesOrderLineId);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectMilestones.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateMilestoneAsync(Guid milestoneId, UpsertProjectMilestoneDto dto, CancellationToken cancellationToken = default)
    {
        var milestone = await _db.ProjectMilestones.FirstOrDefaultAsync(m => m.Id == milestoneId, cancellationToken);
        if (milestone is null) return Result.Failure(Error.NotFound("ProjectMilestone", milestoneId));
        var updated = milestone.Update(dto.Name, dto.Percent, dto.AmountHt, dto.DueDate);
        if (updated.IsFailure) return updated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<ProjectBillingReadinessDto?> GetBillingReadinessAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return null;

        var hours = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(t => t.ProjectId == projectId
                && t.IsBillable
                && t.Status == ProjectTimeEntryStatus.Validated
                && t.InvoicedInvoiceId == null)
            .SumAsync(t => (decimal?)t.Hours, cancellationToken) ?? 0m;

        var members = await _db.ProjectMembers.AsNoTracking().Where(m => m.ProjectId == projectId).ToListAsync(cancellationToken);
        var names = await LoadUserNamesAsync(members.Select(m => m.UserId), cancellationToken);
        var withoutRate = members
            .Where(m => SalesHourlyRate(m) <= 0)
            .Select(m => names.GetValueOrDefault(m.UserId, "—"))
            .ToList();

        var blockers = new List<string>();
        if (!project.IsBillable)
            blockers.Add("Ce projet n'est pas facturable.");
        if (!project.Status.CanBeBilled())
            blockers.Add(project.Status.CannotBeBilledMessage());
        if (hours <= 0)
            blockers.Add("Aucun temps validé non facturé.");
        if (withoutRate.Count > 0)
            blockers.Add("Définissez un tarif de vente sur l'équipe.");

        return new ProjectBillingReadinessDto
        {
            CanBill = project.IsBillable && project.Status.CanBeBilled(),
            CanInvoiceTime = project.IsBillable && project.Status.CanBeBilled() && hours > 0 && withoutRate.Count == 0,
            CanReceiveTime = project.Status.CanReceiveTime() && project.TimesheetsEnabled,
            Status = project.Status,
            StatusDisplay = project.Status.ToDisplayString(),
            ValidatedUninvoicedHours = hours,
            MembersWithoutRate = withoutRate,
            Blockers = blockers
        };
    }

    public async Task<Result<ProjectInvoiceResultDto>> InvoiceTimeAsync(Guid projectId, InvoiceTimeDto dto, CancellationToken cancellationToken = default)
    {
        if (string.Equals(dto.GroupBy, "task", StringComparison.OrdinalIgnoreCase))
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("GroupBy", "Utilisez la facturation par tâche (POST /billing/tasks)"));

        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Result.Failure<ProjectInvoiceResultDto>(Error.NotFound("Project", projectId));
        if (!project.IsBillable)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("IsBillable", "Ce projet n'est pas facturable"));
        if (!project.Status.CanBeBilled())
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Status", project.Status.CannotBeBilledMessage()));

        var pool = await LoadEligibleMemberBillingEntriesAsync(projectId, cancellationToken);
        if (pool.Count == 0)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Time", "Aucun temps validé non facturé"));

        List<ProjectTimeEntry> entries;
        if (dto.TimeEntryIds.Count > 0)
        {
            var requested = dto.TimeEntryIds.Distinct().ToList();
            var poolIds = pool.Select(e => e.Id).ToHashSet();
            if (requested.Any(id => !poolIds.Contains(id)))
                return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("TimeEntryIds", "Une ou plusieurs saisies ne sont pas facturables"));

            entries = pool.Where(e => requested.Contains(e.Id)).ToList();
            if (entries.Count == 0)
                return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("TimeEntryIds", "Sélectionnez au moins une saisie de temps"));
        }
        else
        {
            entries = pool;
        }

        var members = await _db.ProjectMembers.Where(m => m.ProjectId == projectId).ToListAsync(cancellationToken);
        var memberMap = members.ToDictionary(m => m.UserId);
        var names = await LoadUserNamesAsync(entries.Select(e => e.UserId), cancellationToken);

        var lines = new List<(string Designation, decimal Hours, decimal UnitPrice)>();
        foreach (var group in entries.GroupBy(e => e.UserId))
        {
            var hours = group.Sum(e => e.Hours);
            var rate = SalesHourlyRate(memberMap.GetValueOrDefault(group.Key));
            if (rate <= 0)
                return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("SalesRate", "Définissez un tarif de vente sur l'équipe"));
            lines.Add(($"Régie — {names.GetValueOrDefault(group.Key, "Intervenant")}", hours, rate));
        }

        var emitted = await EmitProjectInvoiceAsync(
            project,
            ProjectBillingKind.TimeAndMaterials,
            lines.Select(l => (l.Designation, l.Hours, l.UnitPrice, "h")).ToList(),
            dto.Notes,
            invoiceId =>
            {
                foreach (var entry in entries)
                {
                    var marked = entry.MarkInvoiced(invoiceId);
                    if (marked.IsFailure) return marked;
                }
                return Result.Success();
            },
            cancellationToken);
        if (emitted.IsFailure) return emitted;

        var soInvoiced = await RecordTimesheetInvoicingOnSalesOrderAsync(project, entries, cancellationToken);
        if (soInvoiced.IsFailure) return Result.Failure<ProjectInvoiceResultDto>(soInvoiced.Error);
        await _db.SaveChangesAsync(cancellationToken);
        return emitted;
    }

    public async Task<IReadOnlyList<BillableProjectTimeEntryDto>> GetBillableTimeEntriesAsync(
        Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!await _db.Projects.AsNoTracking().AnyAsync(p => p.Id == projectId, cancellationToken))
            return Array.Empty<BillableProjectTimeEntryDto>();

        var entries = await LoadEligibleMemberBillingEntriesAsync(projectId, cancellationToken);
        if (entries.Count == 0)
            return Array.Empty<BillableProjectTimeEntryDto>();

        var members = await _db.ProjectMembers.AsNoTracking().Where(m => m.ProjectId == projectId).ToListAsync(cancellationToken);
        var memberMap = members.ToDictionary(m => m.UserId);
        var names = await LoadUserNamesAsync(entries.Select(e => e.UserId), cancellationToken);
        var taskTitles = await LoadTaskTitlesAsync(entries.Select(e => e.TaskId), cancellationToken);

        return entries
            .Select(e =>
            {
                var rate = SalesHourlyRate(memberMap.GetValueOrDefault(e.UserId));
                var eligible = rate > 0;
                return new BillableProjectTimeEntryDto
                {
                    Id = e.Id,
                    UserId = e.UserId,
                    UserName = names.GetValueOrDefault(e.UserId, "—"),
                    WorkDate = e.WorkDate,
                    TaskId = e.TaskId,
                    TaskTitle = e.TaskId is { } tid ? taskTitles.GetValueOrDefault(tid) : null,
                    Hours = e.Hours,
                    HourlyRate = rate,
                    PreviewAmountHt = eligible ? decimal.Round(e.Hours * rate, 3) : 0m,
                    IsEligible = eligible,
                    BlockReason = eligible ? null : "Pas de tarif de vente"
                };
            })
            .OrderByDescending(d => d.WorkDate)
            .ThenBy(d => d.UserName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(d => d.Id)
            .ToList();
    }

    public async Task<IReadOnlyList<BillableProjectTaskDto>> GetBillableTasksAsync(Guid projectId, string method, CancellationToken cancellationToken = default)
    {
        var isFixed = string.Equals(method, "fixed", StringComparison.OrdinalIgnoreCase);
        var isHourly = string.Equals(method, "hourly", StringComparison.OrdinalIgnoreCase);
        if (!isFixed && !isHourly)
            return Array.Empty<BillableProjectTaskDto>();

        if (!await _db.Projects.AsNoTracking().AnyAsync(p => p.Id == projectId, cancellationToken))
            return Array.Empty<BillableProjectTaskDto>();

        var tasks = await _db.ProjectTasks.AsNoTracking()
            .Where(t => t.ProjectId == projectId && t.Status != ProjectTaskStatus.Cancelled && t.InvoicedInvoiceId == null)
            .OrderBy(t => t.Title)
            .ToListAsync(cancellationToken);
        if (tasks.Count == 0)
            return Array.Empty<BillableProjectTaskDto>();

        var taskIds = tasks.Select(t => t.Id).ToList();
        var entries = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(e => e.ProjectId == projectId && e.TaskId != null && taskIds.Contains(e.TaskId.Value))
            .ToListAsync(cancellationToken);

        var members = await _db.ProjectMembers.AsNoTracking()
            .Where(m => m.ProjectId == projectId)
            .ToListAsync(cancellationToken);
        var memberMap = members.ToDictionary(m => m.UserId);

        var result = new List<BillableProjectTaskDto>();
        foreach (var task in tasks)
        {
            var taskEntries = entries
                .Where(e => e.TaskId == task.Id
                    && e.IsBillable
                    && e.Status == ProjectTimeEntryStatus.Validated
                    && e.InvoicedInvoiceId == null)
                .ToList();

            var hours = taskEntries.Sum(e => e.Hours);
            var rate = WeightedSalesHourlyRate(taskEntries, memberMap);

            if (isHourly)
            {
                if (hours <= 0)
                    continue;

                if (rate <= 0)
                {
                    result.Add(new BillableProjectTaskDto
                    {
                        Id = task.Id,
                        Title = task.Title,
                        UninvoicedBillableHours = hours,
                        HourlyRate = rate,
                        PreviewAmountHt = decimal.Round(hours * rate, 3),
                        IsEligible = false,
                        BlockReason = "Définissez un tarif de vente sur l'équipe."
                    });
                    continue;
                }

                result.Add(new BillableProjectTaskDto
                {
                    Id = task.Id,
                    Title = task.Title,
                    UninvoicedBillableHours = hours,
                    HourlyRate = rate,
                    PreviewAmountHt = decimal.Round(hours * rate, 3),
                    IsEligible = true,
                    BlockReason = null
                });
                continue;
            }

            result.Add(new BillableProjectTaskDto
            {
                Id = task.Id,
                Title = task.Title,
                UninvoicedBillableHours = hours,
                HourlyRate = rate,
                PreviewAmountHt = decimal.Round(hours * rate, 3),
                IsEligible = true,
                BlockReason = null
            });
        }

        return result;
    }

    public async Task<Result<ProjectInvoiceResultDto>> InvoiceTasksAsync(Guid projectId, InvoiceTasksDto dto, CancellationToken cancellationToken = default)
    {
        var isFixed = string.Equals(dto.Method, "fixed", StringComparison.OrdinalIgnoreCase);
        var isHourly = string.Equals(dto.Method, "hourly", StringComparison.OrdinalIgnoreCase);
        if (!isFixed && !isHourly)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Method", "Le mode de facturation doit être « fixed » ou « hourly »"));

        if (dto.Tasks is null || dto.Tasks.Count == 0)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Tasks", "Sélectionnez au moins une tâche"));

        var taskIds = dto.Tasks.Select(t => t.TaskId).ToList();
        if (taskIds.Distinct().Count() != taskIds.Count)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Tasks", "Chaque tâche ne peut être sélectionnée qu'une fois"));

        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Result.Failure<ProjectInvoiceResultDto>(Error.NotFound("Project", projectId));
        if (!project.Status.CanBeBilled())
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Status", project.Status.CannotBeBilledMessage()));

        var tasks = await _db.ProjectTasks
            .Where(t => t.ProjectId == projectId && taskIds.Contains(t.Id))
            .ToListAsync(cancellationToken);
        if (tasks.Count != taskIds.Count)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Tasks", "Une ou plusieurs tâches sont introuvables sur ce projet"));

        var billable = await GetBillableTasksAsync(projectId, dto.Method, cancellationToken);
        var billableMap = billable.ToDictionary(t => t.Id);

        var members = await _db.ProjectMembers.Where(m => m.ProjectId == projectId).ToListAsync(cancellationToken);
        var memberMap = members.ToDictionary(m => m.UserId);

        var allEntries = await _db.ProjectTimeEntries
            .Where(e => e.ProjectId == projectId && e.TaskId != null && taskIds.Contains(e.TaskId.Value))
            .ToListAsync(cancellationToken);

        var billingMethod = isFixed ? ProjectTaskBillingMethod.Fixed : ProjectTaskBillingMethod.Hourly;
        var billingKind = isFixed ? ProjectBillingKind.TaskFixed : ProjectBillingKind.TaskHourly;
        var lines = new List<(string Designation, decimal Quantity, decimal UnitPrice, string Unit)>();
        var tasksToMark = new List<(ProjectTask Task, List<ProjectTimeEntry> Entries)>();

        foreach (var line in dto.Tasks)
        {
            var task = tasks.First(t => t.Id == line.TaskId);
            if (task.InvoicedInvoiceId.HasValue)
                return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Tasks", $"La tâche « {task.Title} » a déjà été facturée"));

            if (!billableMap.TryGetValue(task.Id, out var eligibility))
                return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Tasks", $"La tâche « {task.Title} » n'est pas facturable"));

            if (isHourly && !eligibility.IsEligible)
                return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Tasks", eligibility.BlockReason ?? $"La tâche « {task.Title} » n'est pas facturable à l'heure"));

            var taskEntries = allEntries
                .Where(e => e.TaskId == task.Id
                    && e.IsBillable
                    && e.Status == ProjectTimeEntryStatus.Validated
                    && e.InvoicedInvoiceId == null)
                .ToList();

            if (isFixed)
            {
                if (line.AmountHt is not > 0)
                    return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("AmountHt", $"Le montant forfaitaire de « {task.Title} » doit être positif"));
                lines.Add(($"Forfait — {task.Title}", 1m, line.AmountHt.Value, "u"));
            }
            else
            {
                var hours = taskEntries.Sum(e => e.Hours);
                var defaultRate = WeightedSalesHourlyRate(taskEntries, memberMap);
                var rate = line.HourlyRate is > 0 ? line.HourlyRate.Value : defaultRate;
                if (hours <= 0 || rate <= 0)
                    return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Tasks", $"La tâche « {task.Title} » n'a pas de temps facturable"));
                lines.Add(($"Régie — {task.Title}", hours, rate, "h"));
            }

            tasksToMark.Add((task, taskEntries));
        }

        return await EmitProjectInvoiceAsync(
            project,
            billingKind,
            lines,
            dto.Notes,
            invoiceId =>
            {
                foreach (var (task, taskEntries) in tasksToMark)
                {
                    var markedTask = task.MarkInvoiced(invoiceId, billingMethod);
                    if (markedTask.IsFailure) return markedTask;

                    foreach (var entry in taskEntries)
                    {
                        var markedEntry = entry.MarkInvoiced(invoiceId);
                        if (markedEntry.IsFailure) return markedEntry;
                    }
                }
                return Result.Success();
            },
            cancellationToken);
    }

    public async Task<Result<ProjectInvoiceResultDto>> InvoiceMilestoneAsync(Guid projectId, InvoiceMilestoneDto dto, CancellationToken cancellationToken = default)
    {
        var project = await RequireKindAsync(projectId, ProjectKind.Esn, cancellationToken);
        if (project.IsFailure) return Result.Failure<ProjectInvoiceResultDto>(project.Error);
        var milestone = await _db.ProjectMilestones.FirstOrDefaultAsync(m => m.Id == dto.MilestoneId && m.ProjectId == projectId, cancellationToken);
        if (milestone is null) return Result.Failure<ProjectInvoiceResultDto>(Error.NotFound("ProjectMilestone", dto.MilestoneId));

        return await EmitProjectInvoiceAsync(
            project.Value,
            ProjectBillingKind.Milestone,
            new List<(string, decimal, decimal, string)> { ($"Jalon — {milestone.Name}", 1m, milestone.AmountHt, "u") },
            dto.Notes,
            invoiceId => milestone.MarkInvoiced(invoiceId),
            cancellationToken);
    }

    public async Task<Result<ProjectInvoiceResultDto>> InvoiceFixedPriceAsync(Guid projectId, InvoiceFixedPriceDto dto, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Result.Failure<ProjectInvoiceResultDto>(Error.NotFound("Project", projectId));
        if (project.BillingMode != ProjectBillingMode.FixedPrice)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("BillingMode", "Ce projet n'est pas en mode forfait"));
        if (!project.Status.CanBeBilled())
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Status", project.Status.CannotBeBilledMessage()));
        if (dto.AmountHt <= 0)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("AmountHt", "Le montant forfait doit être positif"));

        var alreadyInvoiced = await _db.ProjectBillings
            .AnyAsync(b => b.ProjectId == projectId && b.Kind == ProjectBillingKind.FixedPrice, cancellationToken);
        if (alreadyInvoiced)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Billing", "Une facture forfait existe déjà pour ce projet"));

        return await EmitProjectInvoiceAsync(
            project,
            ProjectBillingKind.FixedPrice,
            new List<(string, decimal, decimal, string)> { ($"Forfait — {project.Name}", 1m, dto.AmountHt, "u") },
            dto.Notes,
            _ => Result.Success(),
            cancellationToken);
    }

    public async Task<ProjectProfitabilityDto?> GetProfitabilityAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return null;

        var budget = await GetBudgetAsync(projectId, cancellationToken);
        var invoicedRevenue = await _db.ProjectBillings.AsNoTracking()
            .Where(b => b.ProjectId == projectId)
            .SumAsync(b => (decimal?)b.AmountHt, cancellationToken) ?? 0m;

        var members = await _db.ProjectMembers.AsNoTracking().Where(m => m.ProjectId == projectId).ToListAsync(cancellationToken);
        var validatedBillable = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(t => t.ProjectId == projectId && t.IsBillable && t.Status == ProjectTimeEntryStatus.Validated && t.InvoicedInvoiceId == null)
            .ToListAsync(cancellationToken);

        decimal toInvoiceRevenue = 0m;
        foreach (var group in validatedBillable.GroupBy(e => e.UserId))
        {
            var rate = SalesHourlyRate(members.FirstOrDefault(m => m.UserId == group.Key));
            toInvoiceRevenue += group.Sum(e => e.Hours) * rate;
        }

        var reachedMilestones = await _db.ProjectMilestones.AsNoTracking()
            .Where(m => m.ProjectId == projectId && m.IsReached && m.InvoicedInvoiceId == null)
            .SumAsync(m => (decimal?)m.AmountHt, cancellationToken) ?? 0m;
        toInvoiceRevenue += reachedMilestones;

        var revenues = new List<ProjectProfitabilityLineDto>
        {
            new() { Category = "Feuilles de temps", Expected = project.BudgetHt, ToInvoiceOrBill = toInvoiceRevenue, InvoicedOrBilled = invoicedRevenue },
            new() { Category = "Jalons", Expected = 0m, ToInvoiceOrBill = reachedMilestones, InvoicedOrBilled = 0m }
        };

        var costs = new List<ProjectProfitabilityLineDto>
        {
            new() { Category = "Feuilles de temps (coût)", Expected = budget.TimeCostHt, ToInvoiceOrBill = budget.TimeCostHt, InvoicedOrBilled = budget.TimeCostHt },
            new() { Category = "Autres coûts", Expected = budget.ActualCostHt - budget.TimeCostHt, ToInvoiceOrBill = budget.ActualCostHt - budget.TimeCostHt, InvoicedOrBilled = budget.ActualCostHt - budget.TimeCostHt }
        };

        return new ProjectProfitabilityDto
        {
            ProjectId = projectId,
            Revenues = revenues,
            Costs = costs,
            TotalRevenueExpected = project.BudgetHt,
            TotalRevenueToInvoice = toInvoiceRevenue + reachedMilestones,
            TotalRevenueInvoiced = invoicedRevenue,
            TotalCostExpected = budget.ActualCostHt,
            TotalCostToBill = budget.ActualCostHt,
            TotalCostBilled = budget.ActualCostHt,
            MarginInvoiced = invoicedRevenue - budget.ActualCostHt
        };
    }

    public async Task<Result> LinkSalesOrderAsync(Guid projectId, LinkProjectSalesOrderDto dto, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", projectId));
        var order = await _db.SalesOrders.FirstOrDefaultAsync(o => o.Id == dto.SalesOrderId, cancellationToken);
        if (order is null) return Result.Failure(Error.NotFound("SalesOrder", dto.SalesOrderId));

        var linked = project.LinkSalesOrder(dto.SalesOrderId);
        if (linked.IsFailure) return linked;
        order.LinkProject(projectId);
        Audit(project, true);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<ProjectUpdateDto>> ListProjectUpdatesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectUpdates.AsNoTracking()
            .Where(u => u.ProjectId == projectId)
            .OrderByDescending(u => u.UpdateDate)
            .ToListAsync(cancellationToken);
        var names = await LoadUserNamesAsync(items.Select(i => i.AuthorUserId), cancellationToken);
        return items.Select(u => new ProjectUpdateDto
        {
            Id = u.Id,
            ProjectId = u.ProjectId,
            Status = u.Status,
            StatusDisplay = u.Status.ToDisplayString(),
            ProgressPercent = u.ProgressPercent,
            AuthorUserId = u.AuthorUserId,
            AuthorUserName = names.GetValueOrDefault(u.AuthorUserId, "—"),
            UpdateDate = u.UpdateDate,
            Description = u.Description
        }).ToList();
    }

    public async Task<Result<Guid>> CreateProjectUpdateAsync(Guid projectId, CreateProjectUpdateDto dto, CancellationToken cancellationToken = default)
    {
        var userId = RequireUser();
        if (userId.IsFailure) return Result.Failure<Guid>(userId.Error);
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.NotFound("Project", projectId));

        var created = ProjectUpdate.Create(projectId, userId.Value, dto.Status, dto.ProgressPercent, dto.Description);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectUpdates.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> MarkMilestoneReachedAsync(Guid milestoneId, bool reached, CancellationToken cancellationToken = default)
    {
        var milestone = await _db.ProjectMilestones.FirstOrDefaultAsync(m => m.Id == milestoneId, cancellationToken);
        if (milestone is null) return Result.Failure(Error.NotFound("ProjectMilestone", milestoneId));

        var result = reached ? milestone.MarkReached(true) : milestone.MarkUnreached();
        if (result.IsFailure) return result;

        if (reached && milestone.SalesOrderLineId.HasValue)
        {
            var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == milestone.ProjectId, cancellationToken);
            if (project?.SalesOrderId is { } soId)
            {
                var order = await _db.SalesOrders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == soId, cancellationToken);
                if (order is not null)
                {
                    var deliverQty = milestone.Percent / 100m;
                    var delivery = order.RecordDeliveries(new[] { (milestone.SalesOrderLineId.Value, deliverQty) });
                    if (delivery.IsFailure) return delivery;
                }
            }
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SyncMilestoneProgressAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var milestones = await _db.ProjectMilestones.Where(m => m.ProjectId == projectId && m.InvoicedInvoiceId == null).ToListAsync(cancellationToken);
        foreach (var milestone in milestones)
        {
            var tasks = await _db.ProjectTasks.Where(t => t.MilestoneId == milestone.Id).ToListAsync(cancellationToken);
            if (tasks.Count == 0) continue;
            if (tasks.All(t => t.IsTerminal))
                milestone.MarkReached();
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> SetProductServiceBillingPolicyAsync(ServiceProductBillingPolicyDto dto, CancellationToken cancellationToken = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == dto.ProductId, cancellationToken);
        if (product is null) return Result.Failure(Error.NotFound("Product", dto.ProductId));
        var updated = product.SetServiceBillingPolicy(dto.ServiceInvoicingPolicy, dto.ServiceCreateOnOrder);
        if (updated.IsFailure) return updated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<SalesOrderLineOptionDto>> ListProjectSalesOrderLinesAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project?.SalesOrderId is null) return Array.Empty<SalesOrderLineOptionDto>();

        var order = await _db.SalesOrders.AsNoTracking()
            .Include(o => o.Lines)
            .FirstOrDefaultAsync(o => o.Id == project.SalesOrderId, cancellationToken);
        if (order is null) return Array.Empty<SalesOrderLineOptionDto>();

        return order.Lines.Select(l => new SalesOrderLineOptionDto
        {
            LineId = l.Id,
            LineNumber = l.LineNumber,
            ProductName = l.ProductName,
            Quantity = l.Quantity,
            DeliveredQuantity = l.DeliveredQuantity,
            PendingDeliveryQuantity = l.PendingDeliveryQuantity
        }).OrderBy(l => l.LineNumber).ToList();
    }

    public async Task<IReadOnlyList<ProjectWorkloadRowDto>> GetWorkloadAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var members = await _db.ProjectMembers.AsNoTracking().Where(m => m.ProjectId == projectId).ToListAsync(cancellationToken);
        var names = await LoadUserNamesAsync(members.Select(m => m.UserId), cancellationToken);
        var estimated = await _db.ProjectTasks.AsNoTracking()
            .Where(t => t.ProjectId == projectId && t.AssigneeUserId != null)
            .GroupBy(t => t.AssigneeUserId!.Value)
            .Select(g => new { g.Key, Hours = g.Sum(t => t.EstimatedHours) })
            .ToDictionaryAsync(x => x.Key, x => x.Hours, cancellationToken);
        var logged = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(t => t.ProjectId == projectId)
            .GroupBy(t => t.UserId)
            .Select(g => new { g.Key, Hours = g.Sum(t => t.Hours) })
            .ToDictionaryAsync(x => x.Key, x => x.Hours, cancellationToken);

        return members.Select(m => new ProjectWorkloadRowDto
        {
            UserId = m.UserId,
            UserName = names.GetValueOrDefault(m.UserId, "—"),
            WeeklyCapacityHours = m.WeeklyCapacityHours,
            EstimatedHours = estimated.GetValueOrDefault(m.UserId),
            LoggedHours = logged.GetValueOrDefault(m.UserId)
        }).ToList();
    }

    public async Task<IReadOnlyList<ProjectSituationDto>> ListSituationsAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectSituations.AsNoTracking().Where(s => s.ProjectId == projectId).OrderBy(s => s.Number).ToListAsync(cancellationToken);
        return items.Select(MapSituation).ToList();
    }

    public async Task<Result<Guid>> CreateSituationAsync(Guid projectId, UpsertProjectSituationDto dto, CancellationToken cancellationToken = default)
    {
        var project = await RequireKindAsync(projectId, ProjectKind.Btp, cancellationToken);
        if (project.IsFailure) return Result.Failure<Guid>(project.Error);
        var previous = await PreviousValidatedPercentAsync(projectId, null, cancellationToken);
        var nextNumber = (await _db.ProjectSituations.Where(s => s.ProjectId == projectId).MaxAsync(s => (int?)s.Number, cancellationToken) ?? 0) + 1;
        var created = ProjectSituation.Create(projectId, nextNumber, dto.PeriodStart, dto.PeriodEnd, dto.CumulativePercent, dto.GrossAmountHt, dto.RetainageAmountHt, dto.VatRatePercent, previous);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectSituations.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateSituationAsync(Guid situationId, UpsertProjectSituationDto dto, CancellationToken cancellationToken = default)
    {
        var situation = await _db.ProjectSituations.FirstOrDefaultAsync(s => s.Id == situationId, cancellationToken);
        if (situation is null) return Result.Failure(Error.NotFound("ProjectSituation", situationId));
        var previous = await PreviousValidatedPercentAsync(situation.ProjectId, situation.Id, cancellationToken);
        var updated = situation.UpdateDraft(dto.PeriodStart, dto.PeriodEnd, dto.CumulativePercent, dto.GrossAmountHt, dto.RetainageAmountHt, dto.VatRatePercent, previous);
        if (updated.IsFailure) return updated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> ValidateSituationAsync(Guid situationId, CancellationToken cancellationToken = default)
    {
        var situation = await _db.ProjectSituations.FirstOrDefaultAsync(s => s.Id == situationId, cancellationToken);
        if (situation is null) return Result.Failure(Error.NotFound("ProjectSituation", situationId));
        var previous = await PreviousValidatedPercentAsync(situation.ProjectId, situation.Id, cancellationToken);
        var validated = situation.Validate(previous);
        if (validated.IsFailure) return validated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<ProjectInvoiceResultDto>> InvoiceSituationAsync(Guid projectId, InvoiceSituationDto dto, CancellationToken cancellationToken = default)
    {
        var project = await RequireKindAsync(projectId, ProjectKind.Btp, cancellationToken);
        if (project.IsFailure) return Result.Failure<ProjectInvoiceResultDto>(project.Error);
        var situation = await _db.ProjectSituations.FirstOrDefaultAsync(s => s.Id == dto.SituationId && s.ProjectId == projectId, cancellationToken);
        if (situation is null) return Result.Failure<ProjectInvoiceResultDto>(Error.NotFound("ProjectSituation", dto.SituationId));
        if (situation.Status != ProjectSituationStatus.Validated)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Status", "Validez la situation avant de facturer"));

        var vat = VatRateExtensions.FromPercent(situation.VatRatePercent);
        return await EmitProjectInvoiceAsync(
            project.Value,
            ProjectBillingKind.Situation,
            new List<(string, decimal, decimal, string)> { ($"Situation n°{situation.Number} — net HT après retenue", 1m, situation.NetAmountHt, "u") },
            dto.Notes,
            invoiceId => situation.AttachInvoice(invoiceId),
            cancellationToken,
            vat);
    }

    public async Task<IReadOnlyList<ProjectSubcontractorDto>> ListSubcontractorsAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectSubcontractors.AsNoTracking().Where(s => s.ProjectId == projectId).ToListAsync(cancellationToken);
        var result = new List<ProjectSubcontractorDto>();
        foreach (var item in items)
        {
            var supplier = await _suppliers.GetByIdAsync(item.SupplierId, cancellationToken);
            result.Add(new ProjectSubcontractorDto
            {
                Id = item.Id,
                SupplierId = item.SupplierId,
                SupplierName = supplier?.Name ?? "—",
                ContractReference = item.ContractReference,
                AmountHt = item.AmountHt,
                RetainagePercent = item.RetainagePercent
            });
        }
        return result;
    }

    public async Task<Result<Guid>> AddSubcontractorAsync(Guid projectId, UpsertProjectSubcontractorDto dto, CancellationToken cancellationToken = default)
    {
        var project = await RequireKindAsync(projectId, ProjectKind.Btp, cancellationToken);
        if (project.IsFailure) return Result.Failure<Guid>(project.Error);
        var supplier = await _suppliers.GetByIdAsync(dto.SupplierId, cancellationToken);
        if (supplier is null) return Result.Failure<Guid>(Error.NotFound("Supplier", dto.SupplierId));
        var created = ProjectSubcontractor.Create(projectId, dto.SupplierId, dto.ContractReference, dto.AmountHt, dto.RetainagePercent);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.ProjectSubcontractors.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateSubcontractorAsync(Guid subcontractorId, UpsertProjectSubcontractorDto dto, CancellationToken cancellationToken = default)
    {
        var sub = await _db.ProjectSubcontractors.FirstOrDefaultAsync(s => s.Id == subcontractorId, cancellationToken);
        if (sub is null) return Result.Failure(Error.NotFound("ProjectSubcontractor", subcontractorId));
        var updated = sub.Update(dto.ContractReference, dto.AmountHt, dto.RetainagePercent);
        if (updated.IsFailure) return updated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<Guid>> RecordStockExitAsync(Guid projectId, RecordProjectStockExitDto dto, CancellationToken cancellationToken = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure<Guid>(Error.NotFound("Project", projectId));
        var product = await _products.GetByIdAsync(dto.ProductId, cancellationToken);
        if (product is null) return Result.Failure<Guid>(Error.NotFound("Produit", dto.ProductId));

        var reference = $"PRJ:{projectId:N}";
        var exit = await _mediator.Send(
            new RecordStockExitCommand(dto.ProductId, dto.WarehouseId, dto.Quantity, MovementReason.Transfer, reference, dto.Notes),
            cancellationToken);
        if (exit.IsFailure) return Result.Failure<Guid>(exit.Error);

        var movement = await _db.StockMovements.AsNoTracking()
            .Where(m => m.Reference == reference)
            .OrderByDescending(m => m.OccurredAt)
            .FirstOrDefaultAsync(cancellationToken);

        var amount = Math.Abs((movement?.UnitCost ?? 0m) * dto.Quantity);
        var cost = ProjectCostLine.Create(
            projectId,
            ProjectCostSource.StockExit,
            $"Sortie stock — {product.Name} × {dto.Quantity:0.###}",
            amount,
            DateTime.UtcNow.Date,
            movement?.Id);
        if (cost.IsFailure) return Result.Failure<Guid>(cost.Error);
        _db.ProjectCostLines.Add(cost.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(cost.Value.Id);
    }

    public async Task<IReadOnlyList<ProjectPurchaseOrderDto>> ListPurchaseOrdersAsync(
        Guid projectId, CancellationToken cancellationToken = default)
    {
        var items = await _db.PurchaseOrders
            .AsNoTracking()
            .Include(po => po.Supplier)
            .Where(po => po.ProjectId == projectId)
            .OrderByDescending(po => po.OrderDate)
            .ToListAsync(cancellationToken);

        return items
            .OrderByDescending(po => po.OrderDate)
            .ThenByDescending(po => po.Number.Value, StringComparer.OrdinalIgnoreCase)
            .Select(po => new ProjectPurchaseOrderDto
            {
                Id = po.Id,
                Number = po.Number.Value,
                SupplierName = po.Supplier?.Name ?? "—",
                OrderDate = po.OrderDate,
                Status = po.Status,
                StatusDisplay = po.Status.ToDisplayString(),
                StatusCss = po.Status.ToCssClass(),
                TotalHt = po.SubTotal.Amount
            })
            .ToList();
    }

    public async Task<Result> AssignPurchaseOrderAsync(Guid projectId, AssignPurchaseOrderDto dto, CancellationToken cancellationToken = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, cancellationToken))
            return Result.Failure(Error.NotFound("Project", projectId));
        var po = await _purchaseOrders.GetByIdAsync(dto.PurchaseOrderId, cancellationToken);
        if (po is null) return Result.Failure(Error.NotFound("PurchaseOrder", dto.PurchaseOrderId));
        var assigned = po.AssignToProject(projectId);
        if (assigned.IsFailure) return assigned;
        await _purchaseOrders.UpdateAsync(po, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// Factures liées au projet : émises via facturation projet (SourceProjectId) ∪ avoirs
    /// rattachés via LinkedInvoiceId. Tri IssueDate desc, CreatedAt desc.
    /// </summary>
    public async Task<IReadOnlyList<ProjectLinkedInvoiceDto>?> GetLinkedInvoicesAsync(
        Guid projectId, CancellationToken cancellationToken = default)
    {
        var exists = await _db.Projects.AsNoTracking()
            .AnyAsync(p => p.Id == projectId, cancellationToken);
        if (!exists) return null;

        var invoices = await _db.Invoices.AsNoTracking()
            .Include(i => i.Client)
            .Where(i => i.SourceProjectId == projectId)
            .ToListAsync(cancellationToken);
        var invoiceIds = invoices.Select(i => i.Id).ToList();

        var creditNotes = invoiceIds.Count == 0
            ? new List<Invoice>()
            : await _db.Invoices.AsNoTracking()
                .Include(i => i.Client)
                .Where(i => i.Type == InvoiceType.CreditNote
                    && i.LinkedInvoiceId != null
                    && invoiceIds.Contains(i.LinkedInvoiceId.Value)
                    && i.SourceProjectId == null)
                .ToListAsync(cancellationToken);

        var billingIds = invoices
            .Where(i => i.SourceProjectBillingId.HasValue)
            .Select(i => i.SourceProjectBillingId!.Value)
            .Distinct()
            .ToList();
        var billingKindById = billingIds.Count == 0
            ? new Dictionary<Guid, ProjectBillingKind>()
            : await _db.ProjectBillings.AsNoTracking()
                .Where(b => billingIds.Contains(b.Id))
                .ToDictionaryAsync(b => b.Id, b => b.Kind, cancellationToken);

        return invoices.Concat(creditNotes)
            .Select(i =>
            {
                ProjectBillingKind? kind = i.SourceProjectBillingId.HasValue
                    && billingKindById.TryGetValue(i.SourceProjectBillingId.Value, out var k)
                        ? k
                        : null;

                return new ProjectLinkedInvoiceDto
                {
                    InvoiceId = i.Id,
                    Number = i.Number.Value,
                    IssueDate = i.IssueDate,
                    ClientName = i.Client.Name,
                    AmountHT = i.SubTotal.Amount,
                    AmountVat = i.TotalVat.Amount,
                    AmountTTC = i.TotalAmount.Amount,
                    Currency = i.TotalAmount.Currency,
                    Status = i.Status,
                    StatusDisplay = i.Status.ToDisplayString(),
                    IsCreditNote = i.IsCreditNote,
                    CreatedAt = i.CreatedAt,
                    BillingKind = kind
                };
            })
            .OrderByDescending(d => d.IssueDate)
            .ThenByDescending(d => d.CreatedAt)
            .ToList();
    }

    private async Task<Result<ProjectInvoiceResultDto>> EmitProjectInvoiceAsync(
        Project project,
        ProjectBillingKind kind,
        IReadOnlyList<(string Designation, decimal Quantity, decimal UnitPrice, string Unit)> lines,
        string? notes,
        Func<Guid, Result> afterInvoice,
        CancellationToken cancellationToken,
        VatRate vatRate = VatRate.Standard)
    {
        if (!project.Status.CanBeBilled())
            return Result.Failure<ProjectInvoiceResultDto>(Error.Validation("Status", project.Status.CannotBeBilledMessage()));

        var tenantId = _tenantContext.TenantId;
        if (tenantId is null || tenantId == Guid.Empty)
            return Result.Failure<ProjectInvoiceResultDto>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        var client = await _clients.GetByIdAsync(project.ClientId, cancellationToken);
        if (client is null)
            return Result.Failure<ProjectInvoiceResultDto>(Error.NotFound("Client", project.ClientId));

        var issueDate = DateTime.UtcNow.Date;
        var number = await _numbers.ReserveNextNumberAsync(tenantId.Value, "FAC", issueDate.Year, cancellationToken);
        var invoiceResult = Invoice.Create(
            number,
            client,
            issueDate,
            issueDate.AddDays(30),
            $"PRJ-{project.Name}",
            notes ?? $"Facturation projet {project.Name}",
            null);
        if (invoiceResult.IsFailure)
            return Result.Failure<ProjectInvoiceResultDto>(invoiceResult.Error);

        var invoice = invoiceResult.Value;
        foreach (var line in lines)
        {
            var added = invoice.AddCustomLine(line.Designation, null, line.Quantity, line.Unit, Money.Create(line.UnitPrice), vatRate);
            if (added.IsFailure)
                return Result.Failure<ProjectInvoiceResultDto>(added.Error);
        }

        var billing = ProjectBilling.Create(project.Id, kind, invoice.Id, invoice.SubTotal.Amount, notes);
        if (billing.IsFailure)
            return Result.Failure<ProjectInvoiceResultDto>(billing.Error);

        invoice.SetProjectBillingSource(project.Id, billing.Value.Id);
        var tagged = afterInvoice(invoice.Id);
        if (tagged.IsFailure)
            return Result.Failure<ProjectInvoiceResultDto>(tagged.Error);

        var trackedClient = _db.ChangeTracker.Entries<Client>()
            .FirstOrDefault(e => e.Entity.Id == client.Id)?.Entity;
        if (trackedClient is null)
        {
            _db.Clients.Attach(client);
            _db.Entry(client).State = EntityState.Unchanged;
        }

        _db.Invoices.Add(invoice);
        _db.ProjectBillings.Add(billing.Value);
        AddActivity(project.Id, "invoiced", $"Facture brouillon {invoice.Number.Value}");
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(new ProjectInvoiceResultDto { InvoiceId = invoice.Id, BillingId = billing.Value.Id });
    }

    private async Task<Result> MutateProjectAsync(Guid id, Func<Project, Result> mutate, string type, string message, CancellationToken cancellationToken)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (project is null) return Result.Failure(Error.NotFound("Project", id));
        var result = mutate(project);
        if (result.IsFailure) return result;
        Audit(project, true);
        AddActivity(project.Id, type, message);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<Result<Project>> RequireKindAsync(Guid projectId, ProjectKind kind, CancellationToken cancellationToken)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null) return Result.Failure<Project>(Error.NotFound("Project", projectId));
        if (project.Kind != kind && project.Kind != ProjectKind.Generic)
            return Result.Failure<Project>(Error.Validation("Kind", kind == ProjectKind.Esn ? "Fonction réservée au pack ESN" : "Fonction réservée au pack BTP"));
        if (kind == ProjectKind.Btp && project.Kind == ProjectKind.Generic)
            return Result.Failure<Project>(Error.Validation("Kind", "Passez le projet en BTP pour les situations de travaux"));
        if (kind == ProjectKind.Esn && project.Kind == ProjectKind.Generic && project.BillingMode != ProjectBillingMode.Milestone && project.BillingMode != ProjectBillingMode.TimeAndMaterials)
            return Result.Failure<Project>(Error.Validation("Kind", "Passez le projet en ESN ou activez un mode jalon / régie"));
        return Result.Success(project);
    }

    private async Task<decimal> PreviousValidatedPercentAsync(Guid projectId, Guid? exceptId, CancellationToken cancellationToken)
    {
        var q = _db.ProjectSituations.AsNoTracking()
            .Where(s => s.ProjectId == projectId && s.Status == ProjectSituationStatus.Validated);
        if (exceptId.HasValue) q = q.Where(s => s.Id != exceptId.Value);
        return await q.MaxAsync(s => (decimal?)s.CumulativePercent, cancellationToken) ?? 0m;
    }

    private async Task<IReadOnlyList<ProjectTaskDto>> MapTasksAsync(IReadOnlyList<ProjectTask> tasks, CancellationToken cancellationToken)
    {
        var phaseIds = tasks.Select(t => t.PhaseId).Distinct().ToList();
        var phases = await _db.ProjectPhases.AsNoTracking().Where(p => phaseIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        var names = await LoadUserNamesAsync(tasks.Where(t => t.AssigneeUserId.HasValue).Select(t => t.AssigneeUserId!.Value), cancellationToken);
        var taskIds = tasks.Select(t => t.Id).Distinct().ToList();
        var logged = taskIds.Count == 0
            ? new Dictionary<Guid, decimal>()
            : await _db.ProjectTimeEntries.AsNoTracking()
                .Where(e => e.TaskId != null && taskIds.Contains(e.TaskId.Value))
                .GroupBy(e => e.TaskId!.Value)
                .Select(g => new { g.Key, Hours = g.Sum(x => x.Hours) })
                .ToDictionaryAsync(x => x.Key, x => x.Hours, cancellationToken);
        var today = DateTime.UtcNow.Date;
        return tasks.Select(t => new ProjectTaskDto
        {
            Id = t.Id,
            ProjectId = t.ProjectId,
            PhaseId = t.PhaseId,
            PhaseName = phases.GetValueOrDefault(t.PhaseId, "—"),
            ParentTaskId = t.ParentTaskId,
            Title = t.Title,
            Description = t.Description,
            Status = t.Status,
            StatusDisplay = t.Status.ToDisplayString(),
            Priority = t.Priority,
            PriorityDisplay = t.Priority.ToDisplayString(),
            DueDate = t.DueDate,
            ProgressPercent = t.ProgressPercent,
            AssigneeUserId = t.AssigneeUserId,
            AssigneeUserName = t.AssigneeUserId is { } uid ? names.GetValueOrDefault(uid) : null,
            EmployeeId = t.EmployeeId,
            EstimatedHours = t.EstimatedHours,
            LoggedHours = logged.GetValueOrDefault(t.Id),
            IsOverdue = t.DueDate.HasValue && t.DueDate.Value.Date < today && t.Status is not ProjectTaskStatus.Done and not ProjectTaskStatus.Cancelled
        }).ToList();
    }

    private static ProjectDto MapProject(Project p, string clientName, string? ownerName, IReadOnlyList<ProjectPhase> phases) => new()
    {
        Id = p.Id,
        Name = p.Name,
        Description = p.Description,
        ClientId = p.ClientId,
        ClientName = clientName,
        Kind = p.Kind,
        KindDisplay = p.Kind.ToDisplayString(),
        BillingMode = p.BillingMode,
        BillingModeDisplay = p.BillingMode.ToDisplayString(),
        Status = p.Status,
        StatusDisplay = p.Status.ToDisplayString(),
        StartDate = p.StartDate,
        EndDate = p.EndDate,
        BudgetHt = p.BudgetHt,
        Currency = p.Currency,
        OwnerUserId = p.OwnerUserId,
        OwnerUserName = ownerName,
        SiteAddress = p.SiteAddress,
        ContractNumber = p.ContractNumber,
        IsBillable = p.IsBillable,
        TimesheetsEnabled = p.TimesheetsEnabled,
        SalesOrderId = p.SalesOrderId,
        AnalyticAccountCode = p.AnalyticAccountCode,
        MilestonesEnabled = p.MilestonesEnabled,
        AllocatedHours = p.AllocatedHours,
        Phases = phases.Select(x => new ProjectPhaseDto { Id = x.Id, Name = x.Name, SortOrder = x.SortOrder, Color = x.Color }).ToList()
    };

    private static ProjectMemberDto MapMember(ProjectMember m, string name) => new()
    {
        Id = m.Id,
        UserId = m.UserId,
        UserName = name,
        Role = m.Role,
        RoleDisplay = m.Role.ToDisplayString(),
        SalesRate = m.SalesRate,
        HourlyCost = m.HourlyCost,
        WeeklyCapacityHours = m.WeeklyCapacityHours
    };

    private static ProjectMilestoneDto MapMilestone(ProjectMilestone m) => new()
    {
        Id = m.Id,
        Name = m.Name,
        Percent = m.Percent,
        AmountHt = m.AmountHt,
        DueDate = m.DueDate,
        InvoicedInvoiceId = m.InvoicedInvoiceId,
        SalesOrderLineId = m.SalesOrderLineId,
        IsReached = m.IsReached,
        ReachedAt = m.ReachedAt
    };

    private static ProjectSituationDto MapSituation(ProjectSituation s) => new()
    {
        Id = s.Id,
        Number = s.Number,
        PeriodStart = s.PeriodStart,
        PeriodEnd = s.PeriodEnd,
        CumulativePercent = s.CumulativePercent,
        GrossAmountHt = s.GrossAmountHt,
        RetainageAmountHt = s.RetainageAmountHt,
        NetAmountHt = s.NetAmountHt,
        VatRatePercent = s.VatRatePercent,
        VatAmount = s.VatAmount,
        TotalTtc = s.TotalTtc,
        Status = s.Status,
        StatusDisplay = s.Status == ProjectSituationStatus.Validated ? "Validée" : "Brouillon",
        InvoiceId = s.InvoiceId
    };

    private async Task<Dictionary<Guid, string>> LoadClientNamesAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return new Dictionary<Guid, string>();
        return await _db.Clients.AsNoTracking()
            .Where(c => list.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);
    }

    private async Task<Dictionary<Guid, string>> LoadTaskTitlesAsync(IEnumerable<Guid?> taskIds, CancellationToken cancellationToken)
    {
        var list = taskIds.Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();
        if (list.Count == 0) return new Dictionary<Guid, string>();
        return await _db.ProjectTasks.AsNoTracking()
            .Where(t => list.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.Title, cancellationToken);
    }

    private async Task<Dictionary<Guid, string>> LoadUserNamesAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return new Dictionary<Guid, string>();
        return await _master.Users.AsNoTracking()
            .Where(u => list.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.FirstName + " " + u.LastName, cancellationToken);
    }

    private async Task<Error?> EnsureTimeEntryTaskBelongsToProjectAsync(
        Guid projectId,
        Guid? taskId,
        CancellationToken cancellationToken)
    {
        if (taskId is null || taskId == Guid.Empty)
            return Error.Validation("TaskId", "La tâche est obligatoire");
        var exists = await _db.ProjectTasks.AsNoTracking()
            .AnyAsync(t => t.Id == taskId.Value && t.ProjectId == projectId, cancellationToken);
        if (!exists)
            return Error.Validation("TaskId", "La tâche n'appartient pas à ce projet");
        return null;
    }

    private static Error? EnsureProjectAllowsNewTimeEntry(Project project)
    {
        if (!project.TimesheetsEnabled)
            return Error.Validation("TimesheetsEnabled", ProjectEnumExtensions.TimesheetsDisabledMessage);
        if (!project.Status.CanReceiveTime())
            return Error.Validation("Status", project.Status.CannotReceiveTimeMessage());
        return null;
    }

    private static Error? EnsureProjectAllowsTimeWorkflow(Project project)
    {
        if (!project.TimesheetsEnabled)
            return Error.Validation("TimesheetsEnabled", ProjectEnumExtensions.TimesheetsDisabledMessage);
        if (!project.Status.CanProcessExistingTime())
            return Error.Validation("Status", project.Status.CannotProcessExistingTimeMessage());
        return null;
    }

    private void AddActivity(Guid projectId, string type, string message, Guid? taskId = null)
    {
        _db.ProjectActivities.Add(ProjectActivity.Create(projectId, type, message, _currentUser.UserId, taskId));
    }

    private void Audit(Entity entity, bool update = false)
    {
        var id = _currentUser.UserId?.ToString() ?? _currentUser.Email ?? "system";
        entity.SetAuditInfo(id, update);
    }

    private Result<Guid> RequireUser()
    {
        if (_currentUser.UserId is not { } id || id == Guid.Empty)
            return Result.Failure<Guid>(Error.Unauthorized("Utilisateur non authentifié"));
        return Result.Success(id);
    }

    private static bool ResolveEntryBillable(Project project, bool requestedBillable, Guid? salesOrderLineId)
    {
        if (!project.IsBillable) return false;
        if (!requestedBillable) return false;
        if (project.SalesOrderId.HasValue && !salesOrderLineId.HasValue) return false;
        return true;
    }

    private async Task<Result> RecordTimesheetDeliveryOnSalesOrderAsync(
        Project project, Guid salesOrderLineId, decimal hours, CancellationToken cancellationToken)
    {
        if (!project.SalesOrderId.HasValue) return Result.Success();
        var order = await _db.SalesOrders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == project.SalesOrderId, cancellationToken);
        if (order is null) return Result.Failure(Error.NotFound("SalesOrder", project.SalesOrderId.Value));
        return order.RecordDeliveries(new[] { (salesOrderLineId, hours) });
    }

    private async Task<Result> RecordTimesheetInvoicingOnSalesOrderAsync(
        Project project, IReadOnlyList<ProjectTimeEntry> entries, CancellationToken cancellationToken)
    {
        if (!project.SalesOrderId.HasValue) return Result.Success();
        var groups = entries.Where(e => e.SalesOrderLineId.HasValue).GroupBy(e => e.SalesOrderLineId!.Value)
            .Select(g => (LineId: g.Key, Quantity: g.Sum(x => x.Hours))).ToList();
        if (groups.Count == 0) return Result.Success();

        var order = await _db.SalesOrders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == project.SalesOrderId, cancellationToken);
        if (order is null) return Result.Failure(Error.NotFound("SalesOrder", project.SalesOrderId.Value));
        return order.RecordInvoiced(groups);
    }

    private static decimal SalesHourlyRate(ProjectMember? member)
    {
        if (member?.SalesRate is > 0)
            return decimal.Round(member.SalesRate.Value / 8m, 3);
        return 0m;
    }

    private async Task<List<ProjectTimeEntry>> LoadEligibleMemberBillingEntriesAsync(
        Guid projectId, CancellationToken cancellationToken)
    {
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null || !project.IsBillable)
            return new List<ProjectTimeEntry>();

        var entries = await _db.ProjectTimeEntries
            .Where(t => t.ProjectId == projectId
                && t.IsBillable
                && t.Status == ProjectTimeEntryStatus.Validated
                && t.InvoicedInvoiceId == null)
            .ToListAsync(cancellationToken);

        var invoicedTaskIds = await _db.ProjectTasks.AsNoTracking()
            .Where(t => t.ProjectId == projectId && t.InvoicedInvoiceId != null)
            .Select(t => t.Id)
            .ToListAsync(cancellationToken);

        return entries
            .Where(e => e.TaskId == null || !invoicedTaskIds.Contains(e.TaskId.Value))
            .ToList();
    }

    private static decimal WeightedSalesHourlyRate(
        IReadOnlyList<ProjectTimeEntry> entries,
        IReadOnlyDictionary<Guid, ProjectMember> memberMap)
    {
        decimal weightedSum = 0m;
        decimal totalHours = 0m;
        foreach (var entry in entries)
        {
            var rate = SalesHourlyRate(memberMap.GetValueOrDefault(entry.UserId));
            if (rate <= 0) return 0m;
            weightedSum += entry.Hours * rate;
            totalHours += entry.Hours;
        }

        return totalHours <= 0 ? 0m : decimal.Round(weightedSum / totalHours, 3);
    }
}

internal static class ProjectSearchScoring
{
    public static int ScoreMatch(string query, params string?[] fields)
    {
        var normalizedQuery = Normalize(query);
        if (string.IsNullOrEmpty(normalizedQuery)) return 0;
        var best = 0;
        foreach (var field in fields)
        {
            if (string.IsNullOrWhiteSpace(field)) continue;
            var normalizedField = Normalize(field);
            if (normalizedField == normalizedQuery) best = Math.Max(best, 100);
            else if (normalizedField.StartsWith(normalizedQuery, StringComparison.Ordinal)) best = Math.Max(best, 80);
            else if (normalizedField.Contains(normalizedQuery, StringComparison.Ordinal)) best = Math.Max(best, 50);
        }
        return best;
    }

    private static string Normalize(string value) => value.Trim().ToLowerInvariant();
}
