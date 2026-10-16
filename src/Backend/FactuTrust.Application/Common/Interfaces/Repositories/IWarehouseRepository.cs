using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for Warehouse aggregate.
/// </summary>
public interface IWarehouseRepository : IRepository<Warehouse>
{
    /// <summary>
    /// Gets a warehouse by its code.
    /// </summary>
    Task<Warehouse?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets the default warehouse for the tenant.
    /// </summary>
    Task<Warehouse?> GetDefaultAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all active warehouses.
    /// </summary>
    Task<IReadOnlyList<Warehouse>> GetActiveWarehousesAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Checks if a warehouse code already exists.
    /// </summary>
    Task<bool> CodeExistsAsync(string code, Guid? excludeId = null, CancellationToken cancellationToken = default);

    Task<CountedRows<WarehouseExportRow>> ListForExportAsync(
        int maxRows,
        CancellationToken cancellationToken = default);
}
