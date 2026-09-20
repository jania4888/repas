using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Projects;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Projects;

public sealed class TimesheetService : ITimesheetService, IAsyncDisposable
{
    private readonly TenantDbContext _db;
    private readonly MasterDbContext _master;
    private readonly ICurrentUser _currentUser;

    public TimesheetService(
        ITenantDbContextFactory tenantFactory,
        MasterDbContext master,
        ICurrentUser currentUser)
    {
        _db = tenantFactory.CreateIsolatedContext();
        _master = master;
        _currentUser = currentUser;
    }

    public ValueTask DisposeAsync() => _db.DisposeAsync();

    public async Task<TenantTimesheetSettingsDto> GetSettingsAsync(CancellationToken cancellationToken = default)
    {
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        return MapSettings(settings);
    }

    public async Task<Result> UpdateSettingsAsync(UpdateTenantTimesheetSettingsDto dto, CancellationToken cancellationToken = default)
    {
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        var updated = settings.Update(
            dto.BillingRateIndicatorsEnabled,
            dto.BillingRateLeaderboardEnabled,
            dto.TimeOffEntriesEnabled,
            dto.EncodingMethod,
            dto.TimeOffProjectId,
            dto.TimeOffTaskId,
            dto.DefaultDailyWorkingHours);
        if (updated.IsFailure) return updated;
        Audit(settings, true);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<EmployeeBillingTimeTargetDto>> ListTargetsAsync(int year, int month, CancellationToken cancellationToken = default)
    {
        var targets = await _db.EmployeeBillingTimeTargets.AsNoTracking()
            .Where(t => t.Year == year && t.Month == month)
            .ToListAsync(cancellationToken);
        var names = await LoadUserNamesAsync(targets.Select(t => t.UserId), cancellationToken);
        return targets.Select(t => new EmployeeBillingTimeTargetDto
        {
            UserId = t.UserId,
            UserName = names.GetValueOrDefault(t.UserId, "—"),
            Year = t.Year,
            Month = t.Month,
            TargetHours = t.TargetHours
        }).OrderBy(t => t.UserName).ToList();
    }

    public async Task<Result> UpsertTargetAsync(UpsertEmployeeBillingTimeTargetDto dto, CancellationToken cancellationToken = default)
    {
        var existing = await _db.EmployeeBillingTimeTargets
            .FirstOrDefaultAsync(t => t.UserId == dto.UserId && t.Year == dto.Year && t.Month == dto.Month, cancellationToken);
        if (existing is null)
        {
            var created = EmployeeBillingTimeTarget.Create(dto.UserId, dto.Year, dto.Month, dto.TargetHours);
            if (created.IsFailure) return created;
            _db.EmployeeBillingTimeTargets.Add(created.Value);
        }
        else
        {
            var updated = existing.Update(dto.TargetHours);
            if (updated.IsFailure) return updated;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<IReadOnlyList<TimesheetTipDto>> ListTipsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.TimesheetTips.AsNoTracking()
            .OrderBy(t => t.CreatedAt)
            .Select(t => new TimesheetTipDto { Id = t.Id, Text = t.Text, IsActive = t.IsActive })
            .ToListAsync(cancellationToken);
    }

    public async Task<Result<Guid>> CreateTipAsync(UpsertTimesheetTipDto dto, CancellationToken cancellationToken = default)
    {
        var created = TimesheetTip.Create(dto.Text);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        if (!dto.IsActive) created.Value.Update(dto.Text, false);
        _db.TimesheetTips.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> UpdateTipAsync(Guid id, UpsertTimesheetTipDto dto, CancellationToken cancellationToken = default)
    {
        var tip = await _db.TimesheetTips.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (tip is null) return Result.Failure(Error.NotFound("TimesheetTip", id));
        var updated = tip.Update(dto.Text, dto.IsActive);
        if (updated.IsFailure) return updated;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> DeleteTipAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var tip = await _db.TimesheetTips.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (tip is null) return Result.Failure(Error.NotFound("TimesheetTip", id));
        _db.TimesheetTips.Remove(tip);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<TimesheetBillingRateKpiDto> GetBillingRateKpiAsync(int year, int month, Guid? userId, CancellationToken cancellationToken = default)
    {
        userId ??= _currentUser.UserId;
        if (userId is null || userId == Guid.Empty)
            return EmptyKpi();

        var (from, to) = MonthRange(year, month);
        var entries = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(e => e.UserId == userId.Value && e.WorkDate >= from && e.WorkDate <= to)
            .ToListAsync(cancellationToken);

        var billable = entries.Where(e => e.IsBillable).Sum(e => e.Hours);
        var total = entries.Sum(e => e.Hours);
        var target = await _db.EmployeeBillingTimeTargets.AsNoTracking()
            .Where(t => t.UserId == userId.Value && t.Year == year && t.Month == month)
            .Select(t => t.TargetHours)
            .FirstOrDefaultAsync(cancellationToken);

        return BuildKpi(billable, total, target);
    }

    public async Task<TimesheetLeaderboardDto> GetLeaderboardAsync(int year, int month, string mode, CancellationToken cancellationToken = default)
    {
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        var (from, to) = MonthRange(year, month);
        var entries = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(e => e.WorkDate >= from && e.WorkDate <= to)
            .ToListAsync(cancellationToken);

        var userIds = entries.Select(e => e.UserId).Distinct().ToList();
        var names = await LoadUserNamesAsync(userIds, cancellationToken);
        var targets = await _db.EmployeeBillingTimeTargets.AsNoTracking()
            .Where(t => t.Year == year && t.Month == month && userIds.Contains(t.UserId))
            .ToDictionaryAsync(t => t.UserId, t => t.TargetHours, cancellationToken);

        var ranking = userIds.Select(uid =>
        {
            var userEntries = entries.Where(e => e.UserId == uid).ToList();
            var billable = userEntries.Where(e => e.IsBillable).Sum(e => e.Hours);
            var total = userEntries.Sum(e => e.Hours);
            var target = targets.GetValueOrDefault(uid);
            var percent = target > 0 ? decimal.Round(billable / target * 100m, 1) : 0m;
            return new TimesheetLeaderboardEntryDto
            {
                UserId = uid,
                UserName = names.GetValueOrDefault(uid, "—"),
                BillableLoggedHours = billable,
                TargetHours = target,
                CompletionPercent = percent,
                TotalLoggedHours = total
            };
        }).ToList();

        ranking = string.Equals(mode, "totalTime", StringComparison.OrdinalIgnoreCase)
            ? ranking.OrderByDescending(r => r.TotalLoggedHours).ThenBy(r => r.UserName).ToList()
            : ranking.OrderByDescending(r => r.CompletionPercent).ThenByDescending(r => r.BillableLoggedHours).ThenBy(r => r.UserName).ToList();

        for (var i = 0; i < ranking.Count; i++)
            ranking[i] = ranking[i] with { Rank = i + 1 };

        var currentUserId = _currentUser.UserId;
        TimesheetBillingRateKpiDto? current = null;
        if (currentUserId.HasValue)
        {
            var me = ranking.FirstOrDefault(r => r.UserId == currentUserId.Value);
            if (me is not null)
                current = BuildKpi(me.BillableLoggedHours, me.TotalLoggedHours, me.TargetHours);
        }

        var tip = await GetDailyTipAsync(cancellationToken);

        return new TimesheetLeaderboardDto
        {
            TopThree = ranking.Take(3).ToList(),
            FullRanking = ranking,
            CurrentUser = current,
            DailyTip = tip,
            Mode = string.Equals(mode, "totalTime", StringComparison.OrdinalIgnoreCase) ? "totalTime" : "billingRate"
        };
    }

    public async Task<TimesheetGridDto> GetGridAsync(TimesheetGridQuery query, CancellationToken cancellationToken = default)
    {
        var userId = query.UserId ?? _currentUser.UserId;
        if (userId is null || userId == Guid.Empty)
            return new TimesheetGridDto { From = query.From.Date, To = query.To.Date };

        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        var from = query.From.Date;
        var to = query.To.Date;
        var days = Enumerable.Range(0, (to - from).Days + 1).Select(i => from.AddDays(i)).ToList();

        var entries = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(e => e.UserId == userId.Value && e.WorkDate >= from && e.WorkDate <= to)
            .ToListAsync(cancellationToken);

        var projectIds = entries.Select(e => e.ProjectId).Distinct().ToList();
        var projects = await _db.Projects.AsNoTracking()
            .Where(p => projectIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, cancellationToken);

        var rows = projectIds.Select(pid =>
        {
            var project = projects.GetValueOrDefault(pid);
            var projectEntries = entries.Where(e => e.ProjectId == pid).ToList();
            var dayCells = days.Select(d =>
            {
                var hours = projectEntries.Where(e => e.WorkDate == d).Sum(e => e.Hours);
                return new TimesheetGridDayCellDto
                {
                    Date = d,
                    Hours = hours,
                    ExpectedHours = settings.DefaultDailyWorkingHours,
                    ColorCode = ColorForHours(hours, settings.DefaultDailyWorkingHours)
                };
            }).ToList();
            var periodTotal = dayCells.Sum(c => c.Hours);
            var expectedPeriod = settings.DefaultDailyWorkingHours * days.Count;
            return new TimesheetGridProjectRowDto
            {
                ProjectId = pid,
                ProjectName = project?.Name ?? "—",
                TimesheetsEnabled = project?.TimesheetsEnabled ?? false,
                Days = dayCells,
                PeriodTotalHours = periodTotal,
                ExpectedPeriodHours = expectedPeriod,
                PeriodColorCode = ColorForHours(periodTotal, expectedPeriod)
            };
        }).OrderBy(r => r.ProjectName).ToList();

        var dailyTotals = days.Select(d =>
        {
            var hours = entries.Where(e => e.WorkDate == d).Sum(e => e.Hours);
            return new TimesheetGridDayCellDto
            {
                Date = d,
                Hours = hours,
                ExpectedHours = settings.DefaultDailyWorkingHours,
                ColorCode = ColorForHours(hours, settings.DefaultDailyWorkingHours)
            };
        }).ToList();

        var year = from.Year;
        var month = from.Month;
        TimesheetBillingRateKpiDto? kpi = null;
        TimesheetLeaderboardDto? leaderboard = null;
        if (settings.BillingRateIndicatorsEnabled)
            kpi = await GetBillingRateKpiAsync(year, month, userId, cancellationToken);
        if (settings.BillingRateLeaderboardEnabled)
            leaderboard = await GetLeaderboardAsync(year, month, "billingRate", cancellationToken);

        return new TimesheetGridDto
        {
            From = from,
            To = to,
            Rows = rows,
            DailyTotals = dailyTotals,
            BillingRateKpi = kpi,
            Leaderboard = leaderboard
        };
    }

    public async Task<Result<TimesheetTimerStateDto>> StartTimerAsync(StartTimesheetTimerDto dto, CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;
        if (userId is null || userId == Guid.Empty)
            return Result.Failure<TimesheetTimerStateDto>(Error.Unauthorized("Utilisateur non authentifié"));

        var active = await _db.ProjectTimeEntries
            .FirstOrDefaultAsync(e => e.UserId == userId.Value && e.TimerStartedAtUtc != null, cancellationToken);
        if (active is not null)
            return Result.Failure<TimesheetTimerStateDto>(Error.Validation("Timer", "Un chronomètre est déjà en cours"));

        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == dto.ProjectId, cancellationToken);
        if (project is null)
            return Result.Failure<TimesheetTimerStateDto>(Error.NotFound("Project", dto.ProjectId));
        if (!project.TimesheetsEnabled || !project.Status.CanReceiveTime())
            return Result.Failure<TimesheetTimerStateDto>(Error.Validation("Project", "Ce projet n'accepte pas de saisie de temps"));
        if (!dto.TaskId.HasValue || dto.TaskId == Guid.Empty)
            return Result.Failure<TimesheetTimerStateDto>(Error.Validation("TaskId", "La tâche est obligatoire"));
        var taskExists = await _db.ProjectTasks.AsNoTracking()
            .AnyAsync(t => t.Id == dto.TaskId.Value && t.ProjectId == dto.ProjectId, cancellationToken);
        if (!taskExists)
            return Result.Failure<TimesheetTimerStateDto>(Error.Validation("TaskId", "La tâche n'appartient pas à ce projet"));

        var isBillable = ProjectTimeBillablePolicy.Resolve(true, project.SalesOrderId, dto.SalesOrderLineId);
        var created = ProjectTimeEntry.Create(
            dto.ProjectId, userId.Value, DateTime.UtcNow.Date, 0m, isBillable, dto.Notes, dto.TaskId,
            dto.SalesOrderLineId, TimesheetEntrySource.Timer);
        if (created.IsFailure) return Result.Failure<TimesheetTimerStateDto>(created.Error);
        var started = created.Value.StartTimer();
        if (started.IsFailure) return Result.Failure<TimesheetTimerStateDto>(started.Error);

        _db.ProjectTimeEntries.Add(created.Value);
        await _db.SaveChangesAsync(cancellationToken);

        return Result.Success(new TimesheetTimerStateDto
        {
            EntryId = created.Value.Id,
            ProjectId = dto.ProjectId,
            ProjectName = project.Name,
            TaskId = dto.TaskId,
            StartedAtUtc = created.Value.TimerStartedAtUtc!.Value
        });
    }

    public async Task<Result<decimal>> StopTimerAsync(Guid entryId, CancellationToken cancellationToken = default)
    {
        var entry = await _db.ProjectTimeEntries.FirstOrDefaultAsync(e => e.Id == entryId, cancellationToken);
        if (entry is null) return Result.Failure<decimal>(Error.NotFound("ProjectTimeEntry", entryId));
        var userId = _currentUser.UserId;
        if (userId != entry.UserId)
            return Result.Failure<decimal>(Error.Unauthorized("Chronomètre d'un autre utilisateur"));

        var stopped = entry.StopTimer();
        if (stopped.IsFailure) return Result.Failure<decimal>(stopped.Error);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(entry.Hours);
    }

    public async Task<TimesheetTimerStateDto?> GetActiveTimerAsync(CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;
        if (userId is null) return null;
        var entry = await _db.ProjectTimeEntries.AsNoTracking()
            .FirstOrDefaultAsync(e => e.UserId == userId.Value && e.TimerStartedAtUtc != null, cancellationToken);
        if (entry is null) return null;
        var project = await _db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == entry.ProjectId, cancellationToken);
        return new TimesheetTimerStateDto
        {
            EntryId = entry.Id,
            ProjectId = entry.ProjectId,
            ProjectName = project?.Name ?? "—",
            TaskId = entry.TaskId,
            StartedAtUtc = entry.TimerStartedAtUtc!.Value
        };
    }

    public async Task<IReadOnlyList<TimeOffRequestDto>> ListTimeOffRequestsAsync(CancellationToken cancellationToken = default)
    {
        var items = await _db.TimeOffRequests.AsNoTracking().OrderByDescending(r => r.StartDate).Take(200).ToListAsync(cancellationToken);
        var names = await LoadUserNamesAsync(items.Select(i => i.UserId), cancellationToken);
        return items.Select(r => new TimeOffRequestDto
        {
            Id = r.Id,
            UserId = r.UserId,
            UserName = names.GetValueOrDefault(r.UserId, "—"),
            StartDate = r.StartDate,
            EndDate = r.EndDate,
            HoursPerDay = r.HoursPerDay,
            TypeName = r.TypeName,
            Status = r.Status,
            StatusDisplay = r.Status.ToString()
        }).ToList();
    }

    public async Task<Result<Guid>> CreateTimeOffRequestAsync(CreateTimeOffRequestDto dto, CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;
        if (userId is null || userId == Guid.Empty)
            return Result.Failure<Guid>(Error.Unauthorized("Utilisateur non authentifié"));

        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        if (!settings.TimeOffEntriesEnabled)
            return Result.Failure<Guid>(Error.Validation("TimeOff", "Les entrées congés ne sont pas activées"));

        var created = TimeOffRequest.Create(userId.Value, dto.StartDate, dto.EndDate, dto.HoursPerDay, dto.TypeName, dto.RequiresApproval);
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);
        _db.TimeOffRequests.Add(created.Value);

        if (created.Value.Status == TimeOffRequestStatus.Approved)
        {
            var gen = await GenerateTimeOffEntriesAsync(created.Value, settings, cancellationToken);
            if (gen.IsFailure) return Result.Failure<Guid>(gen.Error);
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success(created.Value.Id);
    }

    public async Task<Result> ApproveTimeOffRequestAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var request = await _db.TimeOffRequests.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (request is null) return Result.Failure(Error.NotFound("TimeOffRequest", id));
        var approved = request.Approve();
        if (approved.IsFailure) return approved;
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        var gen = await GenerateTimeOffEntriesAsync(request, settings, cancellationToken);
        if (gen.IsFailure) return gen;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public Task<Result> RefuseTimeOffRequestAsync(Guid id, CancellationToken cancellationToken = default) =>
        MutateTimeOffAsync(id, r => r.Refuse(), cancellationToken);

    public async Task<IReadOnlyList<ProjectTimeEntryDto>> ListPendingValidationAsync(CancellationToken cancellationToken = default)
    {
        var items = await _db.ProjectTimeEntries.AsNoTracking()
            .Where(e => e.Status == ProjectTimeEntryStatus.Submitted)
            .OrderByDescending(e => e.WorkDate)
            .Take(500)
            .ToListAsync(cancellationToken);
        var projectNames = await _db.Projects.AsNoTracking()
            .Where(p => items.Select(i => i.ProjectId).Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        var names = await LoadUserNamesAsync(items.Select(i => i.UserId), cancellationToken);
        return items.Select(t => new ProjectTimeEntryDto
        {
            Id = t.Id,
            ProjectId = t.ProjectId,
            ProjectName = projectNames.GetValueOrDefault(t.ProjectId, "—"),
            TaskId = t.TaskId,
            UserId = t.UserId,
            UserName = names.GetValueOrDefault(t.UserId, "—"),
            WorkDate = t.WorkDate,
            Hours = t.Hours,
            IsBillable = t.IsBillable,
            Notes = t.Notes,
            Status = t.Status,
            StatusDisplay = t.Status.ToDisplayString(t.InvoicedInvoiceId.HasValue),
            InvoicedInvoiceId = t.InvoicedInvoiceId
        }).ToList();
    }

    private async Task<Result> GenerateTimeOffEntriesAsync(TimeOffRequest request, TenantTimesheetSettings settings, CancellationToken cancellationToken)
    {
        if (!settings.TimeOffProjectId.HasValue)
            return Result.Failure(Error.Validation("TimeOffProjectId", "Configurez le projet congés dans les paramètres timesheets"));

        var projectId = settings.TimeOffProjectId.Value;
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, cancellationToken);
        if (project is null)
            return Result.Failure(Error.NotFound("Project", projectId));

        Guid? firstEntryId = null;
        for (var d = request.StartDate; d <= request.EndDate; d = d.AddDays(1))
        {
            if (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) continue;
            var entry = ProjectTimeEntry.Create(
                projectId, request.UserId, d, request.HoursPerDay, false,
                request.TypeName, settings.TimeOffTaskId, null, TimesheetEntrySource.TimeOff);
            if (entry.IsFailure) return entry;
            entry.Value.Submit();
            entry.Value.Validate();
            _db.ProjectTimeEntries.Add(entry.Value);
            firstEntryId ??= entry.Value.Id;
        }

        if (firstEntryId.HasValue)
            request.LinkTimesheetEntry(firstEntryId.Value);
        return Result.Success();
    }

    private async Task<Result> MutateTimeOffAsync(Guid id, Func<TimeOffRequest, Result> mutate, CancellationToken cancellationToken)
    {
        var request = await _db.TimeOffRequests.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (request is null) return Result.Failure(Error.NotFound("TimeOffRequest", id));
        var result = mutate(request);
        if (result.IsFailure) return result;
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<TenantTimesheetSettings> GetOrCreateSettingsAsync(CancellationToken cancellationToken)
    {
        var settings = await _db.TenantTimesheetSettings.FirstOrDefaultAsync(cancellationToken);
        if (settings is not null) return settings;
        settings = TenantTimesheetSettings.CreateDefault();
        Audit(settings);
        _db.TenantTimesheetSettings.Add(settings);
        await _db.SaveChangesAsync(cancellationToken);
        return settings;
    }

    private async Task<string?> GetDailyTipAsync(CancellationToken cancellationToken)
    {
        var tips = await _db.TimesheetTips.AsNoTracking().Where(t => t.IsActive).Select(t => t.Text).ToListAsync(cancellationToken);
        if (tips.Count == 0) return null;
        var index = Math.Abs(DateTime.UtcNow.Date.GetHashCode()) % tips.Count;
        return tips[index];
    }

    private async Task<Dictionary<Guid, string>> LoadUserNamesAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return new Dictionary<Guid, string>();
        return await _master.Users.AsNoTracking()
            .Where(u => list.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.FirstName + " " + u.LastName, cancellationToken);
    }

    private void Audit(Entity entity, bool update = false)
    {
        var id = _currentUser.UserId?.ToString() ?? _currentUser.Email ?? "system";
        entity.SetAuditInfo(id, update);
    }

    private static TenantTimesheetSettingsDto MapSettings(TenantTimesheetSettings s) => new()
    {
        BillingRateIndicatorsEnabled = s.BillingRateIndicatorsEnabled,
        BillingRateLeaderboardEnabled = s.BillingRateLeaderboardEnabled,
        TimeOffEntriesEnabled = s.TimeOffEntriesEnabled,
        EncodingMethod = s.EncodingMethod,
        TimeOffProjectId = s.TimeOffProjectId,
        TimeOffTaskId = s.TimeOffTaskId,
        DefaultDailyWorkingHours = s.DefaultDailyWorkingHours
    };

    private static (DateTime from, DateTime to) MonthRange(int year, int month)
    {
        var from = new DateTime(year, month, 1);
        var to = from.AddMonths(1).AddDays(-1);
        return (from, to);
    }

    private static TimesheetBillingRateKpiDto BuildKpi(decimal billable, decimal total, decimal target)
    {
        var percent = target > 0 ? decimal.Round(billable / target * 100m, 1) : 0m;
        return new TimesheetBillingRateKpiDto
        {
            BillableLoggedHours = billable,
            TargetHours = target,
            TotalLoggedHours = total,
            CompletionPercent = percent,
            TargetReached = target > 0 && billable >= target
        };
    }

    private static TimesheetBillingRateKpiDto EmptyKpi() => new();

    private static string ColorForHours(decimal hours, decimal expected)
    {
        if (expected <= 0) return "neutral";
        if (hours == expected) return "green";
        if (hours > expected) return "orange";
        return "red";
    }
}
