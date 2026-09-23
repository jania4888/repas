using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// Aggregated totals for a supplier list, computed over the ENTIRE filtered set
/// (not just the current page) so the UI "totals zone" reflects the active filters.
/// </summary>
public sealed record SupplierListSummaryDto
{
    public int Count { get; init; }
    public int ActiveCount { get; init; }
    public int InactiveCount { get; init; }
}

/// <summary>
/// DTO for supplier list.
/// </summary>
public sealed record SupplierListDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public string Type { get; init; } = null!;
    public string TypeDisplay { get; init; } = null!;
    public string? Nif { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public string? ContactPerson { get; init; }
    public int PaymentTermDays { get; init; }
    public bool IsActive { get; init; }
    public int TotalOrders { get; init; }
}

/// <summary>
/// DTO for supplier details.
/// </summary>
public sealed record SupplierDetailDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public SupplierType Type { get; init; }
    public string TypeDisplay { get; init; } = null!;
    public string? Nif { get; init; }

    public AddressDto Address { get; init; } = null!;
    public string? Email { get; init; }
    public string? Phone { get; init; }

    public string? ContactPerson { get; init; }
    public int PaymentTermDays { get; init; }
    public string? Notes { get; init; }
    public bool IsActive { get; init; }

    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }

    // TEJ / retenue à la source
    public IdentificationType? TejIdentificationType { get; init; }
    public DateTime? DateOfBirth { get; init; }
    public string? CountryCode { get; init; }
    public bool IsResident { get; init; } = true;
    public string? Activity { get; init; }
    public bool IsSubjectToWithholding { get; init; }
    public Guid? DefaultWithholdingTaxTypeId { get; init; }
    public decimal? DefaultWithholdingRate { get; init; }
    public string? DefaultWithholdingTaxTypeCode { get; init; }
    public string? DefaultWithholdingTaxTypeLabel { get; init; }
    /// <summary>Tranche IS pour achats RS7 (guidage) ; sinon <see cref="SupplierRs7IsBracket.Unspecified"/>.</summary>
    public SupplierRs7IsBracket? Rs7IsBracket { get; init; }
}

/// <summary>
/// DTO for supplier summary (used in purchase orders).
/// </summary>
public sealed record SupplierSummaryDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public string? Nif { get; init; }
    public string? Email { get; init; }
    public string Address { get; init; } = null!;
}

/// <summary>
/// DTO for creating a supplier.
/// </summary>
public sealed record CreateSupplierDto
{
    public string Name { get; init; } = null!;
    public SupplierType Type { get; init; }
    public string? Nif { get; init; }

    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string? PostalCode { get; init; }
    public string Governorate { get; init; } = null!;

    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? ContactPerson { get; init; }
    public int PaymentTermDays { get; init; } = 30;
    public string? Notes { get; init; }

    public IdentificationType? TejIdentificationType { get; init; }
    public DateTime? DateOfBirth { get; init; }
    public string? CountryCode { get; init; }
    public bool IsResident { get; init; } = true;
    public string? Activity { get; init; }
    public bool IsSubjectToWithholding { get; init; }
    public Guid? DefaultWithholdingTaxTypeId { get; init; }
    public decimal? DefaultWithholdingRate { get; init; }
    public SupplierRs7IsBracket? Rs7IsBracket { get; init; }
}

/// <summary>
/// DTO for updating a supplier.
/// </summary>
public sealed record UpdateSupplierDto
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
    public int PaymentTermDays { get; init; }
    public string? Notes { get; init; }

    public IdentificationType? TejIdentificationType { get; init; }
    public DateTime? DateOfBirth { get; init; }
    public string? CountryCode { get; init; }
    public bool IsResident { get; init; } = true;
    public string? Activity { get; init; }
    public bool IsSubjectToWithholding { get; init; }
    public Guid? DefaultWithholdingTaxTypeId { get; init; }
    public decimal? DefaultWithholdingRate { get; init; }
    public SupplierRs7IsBracket? Rs7IsBracket { get; init; }
}
