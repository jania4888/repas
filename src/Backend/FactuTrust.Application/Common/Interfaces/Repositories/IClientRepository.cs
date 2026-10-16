using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for Client aggregate.
/// </summary>
public interface IClientRepository : IRepository<Client>
{
    /// <summary>
    /// Gets a client by NIF (normalized, case-insensitive).
    /// </summary>
    Task<Client?> GetByNifAsync(string nif, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets a client by email (normalized, case-insensitive).
    /// </summary>
    Task<Client?> GetByEmailAsync(string email, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets another client (excluding given id) with same email.
    /// </summary>
    Task<Client?> GetByEmailExcludingIdAsync(string email, Guid excludeId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets another client (excluding given id) with same NIF.
    /// </summary>
    Task<Client?> GetByNifExcludingIdAsync(string nif, Guid excludeId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Gets all active clients.
    /// </summary>
    Task<IReadOnlyList<Client>> GetActiveClientsAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Searches clients by name, email or NIF; optional filters by type, status, governorate.
    /// </summary>
    Task<(IReadOnlyList<Client> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        ClientType? type,
        bool? isActive,
        string? governorate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Aggregated totals over the ENTIRE filtered set (same filters as <see cref="SearchAsync"/>,
    /// without pagination). Powers the client list "totals zone".
    /// </summary>
    Task<ClientListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        ClientType? type,
        bool? isActive,
        string? governorate,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Checks if a client has any invoices.
    /// </summary>
    Task<bool> HasInvoicesAsync(Guid clientId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Checks if a client has any quotes.
    /// </summary>
    Task<bool> HasQuotesAsync(Guid clientId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Batch lookup of client display names by id (tenant DB).
    /// </summary>
    Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesByIdsAsync(
        IReadOnlyCollection<Guid> ids,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Export filtré (mêmes prédicats que <see cref="SearchAsync"/>). Ne charge pas les lignes si le plafond est dépassé.
    /// Le chiffre d'affaires est un seul GROUP BY, pas un chargement de factures par client.
    /// </summary>
    Task<CountedRows<ClientExportRow>> ListForExportAsync(
        string? searchTerm,
        ClientType? type,
        bool? isActive,
        string? governorate,
        int maxRows,
        CancellationToken cancellationToken = default);
}
