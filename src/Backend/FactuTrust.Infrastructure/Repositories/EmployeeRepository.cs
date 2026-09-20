using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities.Payroll;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for the Employee aggregate.
/// </summary>
public sealed class EmployeeRepository : IEmployeeRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public EmployeeRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Employee?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Employees.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    }

    public async Task<Employee?> GetByIdWithContractsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Employees
            .Include(e => e.Contracts)
            .ThenInclude(c => c.Allowances)
            .FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<Employee>> GetActiveWithContractsAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Employees
            .Include(e => e.Contracts)
            .ThenInclude(c => c.Allowances)
            .Where(e => e.IsActive)
            .OrderBy(e => e.LastName)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Employee>> GetEligibleForPayrollMonthAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default)
    {
        var monthStart = new DateTime(year, month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);

        await using var context = _contextFactory.CreateContext();
        return await context.Employees
            .Include(e => e.Contracts)
            .ThenInclude(c => c.Allowances)
            .Where(e => e.Contracts.Any(c =>
                c.StartDate <= monthEnd &&
                (c.EndDate == null || c.EndDate >= monthStart) &&
                (
                    e.IsActive ||
                    (e.TerminationDate.HasValue && e.TerminationDate >= monthStart && e.TerminationDate <= monthEnd) ||
                    (c.EndDate.HasValue && c.EndDate >= monthStart && c.EndDate <= monthEnd)
                )))
            .OrderBy(e => e.LastName)
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// R-29 : salariés actifs OU partis en cours du mois (TerminationDate dans le mois), avec un
    /// contrat couvrant au moins un jour du mois. Contrairement au chemin prorata, on n'exige pas
    /// que le contrat couvre la fin du mois : un départ mi-mois reçoit un bulletin plein mois.
    /// </summary>
    public async Task<IReadOnlyList<Employee>> GetActiveOrTerminatedInMonthAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default)
    {
        var monthStart = new DateTime(year, month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);

        await using var context = _contextFactory.CreateContext();
        return await context.Employees
            .Include(e => e.Contracts)
            .ThenInclude(c => c.Allowances)
            .Where(e =>
                e.Contracts.Any(c => c.StartDate <= monthEnd && (c.EndDate == null || c.EndDate >= monthStart))
                && (e.IsActive
                    || (e.TerminationDate.HasValue && e.TerminationDate >= monthStart && e.TerminationDate <= monthEnd)))
            .OrderBy(e => e.LastName)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Employee>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Employees
            .OrderBy(e => e.LastName)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> ExistsByEmployeeNumberAsync(string employeeNumber, Guid? excludeId = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(employeeNumber)) return false;
        var normalized = employeeNumber.Trim();
        await using var context = _contextFactory.CreateContext();
        return await context.Employees
            .AnyAsync(e => e.EmployeeNumber == normalized && (excludeId == null || e.Id != excludeId), cancellationToken);
    }

    public async Task<(IReadOnlyList<Employee> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        bool? isActive,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.Employees.AsQueryable();

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(e =>
                e.FirstName.Contains(term) ||
                e.LastName.Contains(term) ||
                e.EmployeeNumber.Contains(term) ||
                (e.CnssNumber != null && e.CnssNumber.Contains(term)));
        }

        if (isActive.HasValue)
            query = query.Where(e => e.IsActive == isActive.Value);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderBy(e => e.LastName).ThenBy(e => e.FirstName)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<IReadOnlyDictionary<Guid, string>> GetFullNamesByIdsAsync(
        IReadOnlyList<Guid> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();

        await using var context = _contextFactory.CreateContext();
        return await context.Employees
            .AsNoTracking()
            .Where(e => ids.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.FullName, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, Employee>> GetByIdsAsync(
        IEnumerable<Guid> ids,
        CancellationToken cancellationToken = default)
    {
        var idList = ids.Distinct().ToList();
        if (idList.Count == 0)
            return new Dictionary<Guid, Employee>();

        await using var context = _contextFactory.CreateContext();
        var employees = await context.Employees
            .AsNoTracking()
            .Where(e => idList.Contains(e.Id))
            .ToListAsync(cancellationToken);

        return employees.ToDictionary(e => e.Id);
    }

    public async Task<Employee> AddAsync(Employee entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Employees.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    /// <summary>
    /// Updates employee personal information (scalars + owned value objects). Contracts are
    /// managed separately via the contract operations, so a personal-info update never touches them.
    /// </summary>
    public async Task UpdateAsync(Employee entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Employees.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Employee entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var tracked = await context.Employees
            .Include(e => e.Contracts)
            .FirstOrDefaultAsync(e => e.Id == entity.Id, cancellationToken);
        if (tracked is null) return;
        context.Employees.Remove(tracked);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Employees.AnyAsync(e => e.Id == id, cancellationToken);
    }

    public async Task<EmploymentContract> AddContractAsync(EmploymentContract contract, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.EmploymentContracts.Add(contract);
        await context.SaveChangesAsync(cancellationToken);
        return contract;
    }

    public async Task<EmploymentContract?> GetContractAsync(Guid contractId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.EmploymentContracts
            .Include(c => c.Allowances)
            .FirstOrDefaultAsync(c => c.Id == contractId, cancellationToken);
    }

    public async Task UpdateContractAsync(EmploymentContract contract, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Replace allowances so removed ones are deleted rather than orphaned.
        await context.ContractAllowances
            .Where(a => a.ContractId == contract.Id)
            .ExecuteDeleteAsync(cancellationToken);

        var tracked = await context.EmploymentContracts
            .FirstOrDefaultAsync(c => c.Id == contract.Id, cancellationToken);

        if (tracked is null)
        {
            context.EmploymentContracts.Add(contract);
        }
        else
        {
            context.Entry(tracked).CurrentValues.SetValues(contract);
            foreach (var allowance in contract.Allowances)
                context.ContractAllowances.Add(allowance);
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteContractAsync(Guid contractId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        await context.ContractAllowances
            .Where(a => a.ContractId == contractId)
            .ExecuteDeleteAsync(cancellationToken);
        await context.EmploymentContracts
            .Where(c => c.Id == contractId)
            .ExecuteDeleteAsync(cancellationToken);
    }
}
