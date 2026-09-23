using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common;

internal static class SupplierDetailMapper
{
    public static async Task<SupplierDetailDto> ToDetailDtoAsync(
        Supplier supplier,
        IWithholdingTaxRepository withholdingTaxRepository,
        CancellationToken cancellationToken = default)
    {
        SupplierRs7IsBracket? bracket = null;
        string? typeCode = null;
        string? typeLabel = null;

        if (supplier.DefaultWithholdingTaxTypeId is { } tid)
        {
            var wt = await withholdingTaxRepository.GetTypeByIdAsync(tid, cancellationToken);
            typeCode = wt?.Code;
            typeLabel = wt?.Label;
            bracket = SupplierWithholdingDefaultsResolver.InferRs7BracketFromTypeCode(typeCode);
        }

        return ToDetailDto(supplier, bracket, typeCode, typeLabel);
    }

    public static SupplierDetailDto ToDetailDto(
        Supplier supplier,
        SupplierRs7IsBracket? inferredRs7Bracket = null,
        string? defaultWithholdingTaxTypeCode = null,
        string? defaultWithholdingTaxTypeLabel = null)
    {
        return new SupplierDetailDto
        {
            Id = supplier.Id,
            Name = supplier.Name,
            Type = supplier.Type,
            TypeDisplay = supplier.Type.ToDisplayString(),
            Nif = supplier.NIF?.Value,
            Address = new AddressDto
            {
                Street = supplier.Address.Street,
                StreetLine2 = supplier.Address.StreetLine2,
                City = supplier.Address.City,
                PostalCode = supplier.Address.PostalCode,
                Governorate = supplier.Address.Governorate,
                Country = supplier.Address.Country,
                FullAddress = supplier.Address.ToString()
            },
            Email = supplier.Email?.Value,
            Phone = supplier.Phone?.Value,
            ContactPerson = supplier.ContactPerson,
            PaymentTermDays = supplier.PaymentTermDays,
            Notes = supplier.Notes,
            IsActive = supplier.IsActive,
            CreatedAt = supplier.CreatedAt,
            UpdatedAt = supplier.UpdatedAt,
            TejIdentificationType = supplier.TejIdentificationType,
            DateOfBirth = supplier.DateOfBirth,
            CountryCode = supplier.CountryCode,
            IsResident = supplier.IsResident,
            Activity = supplier.Activity,
            IsSubjectToWithholding = supplier.IsSubjectToWithholding,
            DefaultWithholdingTaxTypeId = supplier.DefaultWithholdingTaxTypeId,
            DefaultWithholdingRate = supplier.DefaultWithholdingRate,
            DefaultWithholdingTaxTypeCode = defaultWithholdingTaxTypeCode,
            DefaultWithholdingTaxTypeLabel = defaultWithholdingTaxTypeLabel,
            Rs7IsBracket = inferredRs7Bracket
        };
    }
}
