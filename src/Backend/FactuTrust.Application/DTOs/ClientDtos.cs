using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// Aggregated totals for a client list, computed over the ENTIRE filtered set
/// (not just the current page) so the UI "totals zone" reflects the active filters.
/// </summary>
public sealed record ClientListSummaryDto
{
    public int Count { get; init; }
    public int ActiveCount { get; init; }
    public int InactiveCount { get; init; }
}

/// <summary>
/// DTO for client list.
/// </summary>
public sealed record ClientListDto
{
    public Guid Id { get; init; }
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public string Type { get; init; } = null!;
    public string TypeDisplay { get; init; } = null!;
    public string? Nif { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string? PostalCode { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public string Country { get; init; } = null!;
    public bool IsActive { get; init; }
    public int TotalInvoices { get; init; }
    public decimal TotalRevenue { get; init; }
    public decimal? CreditLimit { get; init; }
    public int? DefaultPaymentTermDays { get; init; }
}

/// <summary>
/// DTO for client summary (used in invoice).
/// </summary>
public sealed record ClientSummaryDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public string? Nif { get; init; }
    public string? Email { get; init; }
    public string Address { get; init; } = null!;
}

/// <summary>
/// DTO for client details.
/// </summary>
public sealed record ClientDetailDto
{
    public Guid Id { get; init; }
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public ClientType Type { get; init; }
    public string TypeDisplay { get; init; } = null!;
    public string? Nif { get; init; }
    
    public AddressDto Address { get; init; } = null!;
    public string? Email { get; init; }
    public string? Phone { get; init; }
    
    public string? ContactPerson { get; init; }
    public string? Notes { get; init; }
    public bool IsActive { get; init; }

    /// <summary>Plafond d'encours en TND. <c>null</c> = pas de plafond.</summary>
    public decimal? CreditLimit { get; init; }

    /// <summary>Délai de règlement habituel en jours. <c>null</c> = non renseigné.</summary>
    public int? DefaultPaymentTermDays { get; init; }
    
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

/// <summary>
/// DTO for address.
/// </summary>
public sealed record AddressDto
{
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string? PostalCode { get; init; }
    public string Governorate { get; init; } = null!;
    public string Country { get; init; } = null!;
    public string FullAddress { get; init; } = null!;
}

/// <summary>
/// DTO for creating a client.
/// </summary>
public sealed record CreateClientDto
{
    public string Name { get; init; } = null!;
    public ClientType Type { get; init; }
    public string? Nif { get; init; }
    
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string? PostalCode { get; init; }
    public string Governorate { get; init; } = null!;
    
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? ContactPerson { get; init; }
    public string? Notes { get; init; }

    /// <summary>Plafond d'encours en TND. <c>null</c> = pas de plafond.</summary>
    public decimal? CreditLimit { get; init; }

    /// <summary>Délai de règlement habituel en jours. <c>null</c> = non renseigné.</summary>
    public int? DefaultPaymentTermDays { get; init; }
}

/// <summary>
/// DTO for updating a client.
/// </summary>
public sealed record UpdateClientDto
{
    public string Name { get; init; } = null!;
    
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string? PostalCode { get; init; }
    public string Governorate { get; init; } = null!;
    
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? ContactPerson { get; init; }
    public string? Notes { get; init; }
    public bool IsActive { get; init; }

    /// <summary>Plafond d'encours en TND. <c>null</c> = pas de plafond.</summary>
    public decimal? CreditLimit { get; init; }

    /// <summary>Délai de règlement habituel en jours. <c>null</c> = non renseigné.</summary>
    public int? DefaultPaymentTermDays { get; init; }
}

/// <summary>
/// DTO for client statistics (fiche client).
/// </summary>
public sealed record ClientStatsDto
{
    public int TotalInvoices { get; init; }
    public int PaidInvoices { get; init; }
    public int PendingInvoices { get; init; }
    public int OverdueInvoices { get; init; }
    public decimal TotalRevenue { get; init; }
    public decimal AverageInvoiceAmount { get; init; }
    public DateTime? LastInvoiceDate { get; init; }
    public int TotalQuotes { get; init; }
    public DateTime? LastQuoteDate { get; init; }
}
