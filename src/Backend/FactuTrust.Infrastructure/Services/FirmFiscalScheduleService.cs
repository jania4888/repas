using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.FiscalSchedule;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

public sealed class FirmFiscalScheduleService : IFirmFiscalScheduleService
{
    private readonly MasterDbContext _masterContext;
    private readonly ITenantService _tenantService;
    private readonly IFirmAssignmentService _assignmentService;
    private readonly IFirmDossierAccessService _dossierAccess;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<FirmFiscalScheduleService> _logger;

    public FirmFiscalScheduleService(
        MasterDbContext masterContext,
        ITenantService tenantService,
        IFirmAssignmentService assignmentService,
        IFirmDossierAccessService dossierAccess,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<FirmFiscalScheduleService> logger)
    {
        _masterContext = masterContext;
        _tenantService = tenantService;
        _assignmentService = assignmentService;
        _dossierAccess = dossierAccess;
        _currentUser = currentUser;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task<FiscalScheduleListDto> GetScheduleAsync(
        Guid firmTenantId,
        FiscalScheduleFiltersDto filters,
        CancellationToken cancellationToken = default)
    {
        IReadOnlySet<Guid>? allowedCompanyIds = null;
        if (_currentUser.TryGetAccessScope(out var scope))
        {
            allowedCompanyIds = await _dossierAccess.GetAccessibleCompanyTenantIdsAsync(
                firmTenantId, scope, cancellationToken);
            if (allowedCompanyIds is { Count: 0 })
            {
                return new FiscalScheduleListDto
                {
                    Items = [],
                    Companies = [],
                    Summary = FiscalScheduleMappings.BuildSummary([], _timeProvider.GetLocalNow().DateTime.Date),
                    Page = Math.Max(filters.Page, 1),
                    PageSize = Math.Clamp(filters.PageSize, 1, 200),
                    TotalCount = 0
                };
            }
        }

        var clientsQuery =
            from assignment in _masterContext.FirmClientAssignments.AsNoTracking()
            join tenant in _masterContext.Tenants.AsNoTracking() on assignment.CompanyTenantId equals tenant.Id
            where assignment.FirmTenantId == firmTenantId && assignment.Status == FirmAssignmentStatus.Active
            select new { assignment.CompanyTenantId, tenant.CompanyName };

        if (allowedCompanyIds is not null)
            clientsQuery = clientsQuery.Where(c => allowedCompanyIds.Contains(c.CompanyTenantId));

        if (filters.CompanyTenantId.HasValue)
            clientsQuery = clientsQuery.Where(c => c.CompanyTenantId == filters.CompanyTenantId.Value);

        var clients = await clientsQuery.OrderBy(c => c.CompanyName).ToListAsync(cancellationToken);
        var companies = await _assignmentService.GetActiveClientsAsync(firmTenantId, cancellationToken);
        var today = _timeProvider.GetLocalNow().DateTime.Date;
        var rows = new List<FiscalScheduleEntryDto>();

        foreach (var client in clients)
        {
            try
            {
                var connectionString = await _tenantService.GetConnectionStringAsync(client.CompanyTenantId, cancellationToken);
                if (string.IsNullOrWhiteSpace(connectionString))
                    continue;

                await using var ctx = CreateTenantContext(connectionString);
                var query = ctx.FiscalScheduleEntries
                    .AsNoTracking()
                    .Include(e => e.Attachments)
                    .Include(e => e.History)
                    .AsQueryable();

                query = ApplyBaseFilters(query, filters);
                var tenantRows = await query.ToListAsync(cancellationToken);

                foreach (var entry in tenantRows)
                {
                    var dto = FiscalScheduleMappings.ToDto(entry, today, client.CompanyTenantId, client.CompanyName);
                    if (filters.Status.HasValue && dto.Status != filters.Status.Value)
                        continue;
                    if (!string.IsNullOrWhiteSpace(filters.Search) &&
                        !Contains(dto.CompanyName, filters.Search) &&
                        !Contains(dto.ObligationLabel, filters.Search) &&
                        !Contains(dto.ResponsibleName, filters.Search) &&
                        !Contains(dto.Observations, filters.Search))
                        continue;
                    rows.Add(dto);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to aggregate fiscal schedule for tenant {TenantId}", client.CompanyTenantId);
            }
        }

        rows = rows
            .OrderBy(r => r.DueDate)
            .ThenBy(r => r.CompanyName)
            .ThenBy(r => r.ObligationType)
            .ToList();

        var totalCount = rows.Count;
        // 4.7 suite (R52, motif D-45-28) : borne haute pour que (page - 1) * pageSize reste un int.
        var page = Math.Clamp(filters.Page, 1, int.MaxValue / 200);
        var pageSize = Math.Clamp(filters.PageSize, 1, 200);
        var items = rows.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        return new FiscalScheduleListDto
        {
            Items = items,
            Summary = FiscalScheduleMappings.BuildSummary(rows, today),
            Companies = companies,
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount
        };
    }

    private static IQueryable<FiscalScheduleEntry> ApplyBaseFilters(
        IQueryable<FiscalScheduleEntry> query,
        FiscalScheduleFiltersDto filters)
    {
        if (!filters.IncludeCancelled)
            query = query.Where(e => !e.IsCancelled);
        if (filters.FiscalYear.HasValue)
            query = query.Where(e => e.FiscalYear == filters.FiscalYear.Value);
        if (filters.PeriodMonth.HasValue)
            query = query.Where(e => e.PeriodMonth == filters.PeriodMonth.Value);
        if (filters.PeriodQuarter.HasValue)
            query = query.Where(e => e.PeriodQuarter == filters.PeriodQuarter.Value);
        if (filters.ObligationType.HasValue && Enum.IsDefined(typeof(FiscalObligationType), filters.ObligationType.Value))
            query = query.Where(e => e.ObligationType == (FiscalObligationType)filters.ObligationType.Value);
        if (filters.ResponsibleUserId.HasValue)
            query = query.Where(e => e.ResponsibleUserId == filters.ResponsibleUserId.Value);
        if (filters.DueFrom.HasValue)
            query = query.Where(e => e.DueDate >= filters.DueFrom.Value.Date);
        if (filters.DueTo.HasValue)
            query = query.Where(e => e.DueDate <= filters.DueTo.Value.Date);
        if (!string.IsNullOrWhiteSpace(filters.Search))
        {
            var search = filters.Search.Trim();
            query = query.Where(e =>
                e.ObligationLabel.Contains(search) ||
                (e.ResponsibleName != null && e.ResponsibleName.Contains(search)) ||
                (e.Observations != null && e.Observations.Contains(search)));
        }

        return query;
    }

    private static bool Contains(string? source, string? search)
        => !string.IsNullOrWhiteSpace(source) &&
           !string.IsNullOrWhiteSpace(search) &&
           source.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase);

    private static TenantDbContext CreateTenantContext(string connectionString)
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        return new TenantDbContext(options);
    }
}
