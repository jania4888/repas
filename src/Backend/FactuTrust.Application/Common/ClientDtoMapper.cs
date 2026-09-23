using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common;

internal static class ClientDtoMapper
{
    public static string GetClientCode(Guid id) =>
        "CLI-" + id.ToString("N")[..8].ToUpperInvariant();

    public static ClientDetailDto ToDetailDto(Client client)
    {
        return new ClientDetailDto
        {
            Id = client.Id,
            Code = GetClientCode(client.Id),
            Name = client.Name,
            Type = client.Type,
            TypeDisplay = client.Type.ToDisplayString(),
            Nif = client.NIF?.Value,
            Address = new AddressDto
            {
                Street = client.Address.Street,
                StreetLine2 = client.Address.StreetLine2,
                City = client.Address.City,
                PostalCode = client.Address.PostalCode,
                Governorate = client.Address.Governorate,
                Country = client.Address.Country,
                FullAddress = client.Address.ToSingleLine()
            },
            Email = client.Email?.Value,
            Phone = client.Phone?.Value,
            ContactPerson = client.ContactPerson,
            Notes = client.Notes,
            IsActive = client.IsActive,
            CreditLimit = client.CreditLimit,
            DefaultPaymentTermDays = client.DefaultPaymentTermDays,
            CreatedAt = client.CreatedAt,
            UpdatedAt = client.UpdatedAt
        };
    }
}
