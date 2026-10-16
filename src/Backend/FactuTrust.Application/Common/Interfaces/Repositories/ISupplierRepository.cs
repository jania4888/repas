using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for Supplier aggregate.
/// </summary>
public interface ISupplierRepository : IRepository<Supplier>
{
    /// <summary>
    /// Gets a supplier by NIF (normalized, case-insensitive).
    /// </summary>
    Task<Supplier?> GetByNifAsync(string nif, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets a supplier by email (normalized, case-insensitive).
    /// </summary>
    Task<Supplier?> GetByEmailAsync(string email, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets all active suppliers.
    /// </summary>
    Task<IReadOnlyList<Supplier>> GetActiveSuppliersAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Searches suppliers by name, email or NIF; optional filters.
    /// </summary>
    Task<(IReadOnlyList<Supplier> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        SupplierType? type,
        bool? isActive,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Aggregated totals over the ENTIRE filtered set (same filters as <see cref="SearchAsync"/>,
    /// without pagination). Powers the supplier list "totals zone".
    /// </summary>
    Task<SupplierListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        SupplierType? type,
        bool? isActive,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Checks if a supplier has any purchase orders.
    /// </summary>
    Task<bool> HasPurchaseOrdersAsync(Guid supplierId, CancellationToken cancellationToken = default);

    Task<CountedRows<SupplierExportRow>> ListForExportAsync(
        string? searchTerm,
        SupplierType? type,
        bool? isActive,
        int maxRows,
        CancellationToken cancellationToken = default);
}
