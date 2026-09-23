using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Represents a company/seller entity (the invoice issuer).
/// </summary>
public sealed class Company : AggregateRoot
{
    public string Name { get; private set; } = null!;
    public string? TradeName { get; private set; }
    public Address Address { get; private set; } = null!;
    public NIF Nif { get; private set; } = null!;
    public string? CommerceRegistry { get; private set; }
    public string? VatCode { get; private set; }
    public Email? Email { get; private set; }
    public PhoneNumber? Phone { get; private set; }
    public string? LogoUrl { get; private set; }
    public bool IsDefault { get; private set; }
    public bool IsActive { get; private set; }

    /// <summary>
    /// When false, portal contacts cannot sign in and staff cannot send new invitations.
    /// Existing contacts remain in the directory until revoked.
    /// </summary>
    public bool ClientPortalEnabled { get; private set; } = true;

    // Bank information
    public string? BankName { get; private set; }
    public string? Iban { get; private set; }
    public string? Rib { get; private set; }

    // TEJ platform fields
    public string? EstablishmentCode { get; private set; }
    public DateTime? TejAdherentSince { get; private set; }
    public TejCategory? TejCategory { get; private set; }

    /// <summary>Matricule employeur CNSS (affiliation sociale de l'entreprise).</summary>
    public string? CnssEmployerNumber { get; private set; }

    private Company() { }

    public static Result<Company> Create(
        string name,
        Address address,
        NIF nif,
        Email? email,
        string? tradeName = null,
        string? commerceRegistry = null,
        string? vatCode = null,
        PhoneNumber? phone = null,
        string? logoUrl = null)
    {
        if (string.IsNullOrWhiteSpace(name))
            return Result.Failure<Company>(Error.Validation("Name", "La raison sociale est obligatoire"));

        if (name.Length > 200)
            return Result.Failure<Company>(Error.Validation("Name", "La raison sociale ne peut pas dépasser 200 caractères"));

        var company = new Company
        {
            Name = name.Trim(),
            TradeName = tradeName?.Trim(),
            Address = address,
            Nif = nif,
            CommerceRegistry = commerceRegistry?.Trim(),
            VatCode = vatCode?.Trim(),
            Email = email,
            Phone = phone,
            LogoUrl = logoUrl,
            IsDefault = false,
            IsActive = true,
            ClientPortalEnabled = true
        };

        return Result.Success(company);
    }

    public void Update(
        string name,
        Address address,
        Email email,
        string? tradeName = null,
        string? commerceRegistry = null,
        PhoneNumber? phone = null)
    {
        Name = name.Trim();
        TradeName = tradeName?.Trim();
        Address = address;
        Email = email;
        CommerceRegistry = commerceRegistry?.Trim();
        Phone = phone;
    }

    public void SetLogo(string? logoUrl)
    {
        LogoUrl = logoUrl;
    }

    public void SetBankInfo(string? bankName, string? iban, string? rib)
    {
        BankName = bankName?.Trim();
        Iban = iban?.Replace(" ", "").Trim();
        Rib = rib?.Replace(" ", "").Trim();
    }

    public void SetAsDefault()
    {
        IsDefault = true;
    }

    public void RemoveDefault()
    {
        IsDefault = false;
    }

    public void Activate()
    {
        IsActive = true;
    }

    public void Deactivate()
    {
        IsActive = false;
    }

    public void SetTejInfo(string? establishmentCode, DateTime? tejAdherentSince, TejCategory? tejCategory)
    {
        EstablishmentCode = establishmentCode?.Trim();
        TejAdherentSince = tejAdherentSince;
        TejCategory = tejCategory;
    }

    public void SetClientPortalEnabled(bool enabled)
    {
        ClientPortalEnabled = enabled;
    }

    public void SetCnssEmployerNumber(string? cnssEmployerNumber)
    {
        CnssEmployerNumber = string.IsNullOrWhiteSpace(cnssEmployerNumber)
            ? null
            : cnssEmployerNumber.Trim();
    }

    /// <summary>
    /// Gets the full formatted address for display.
    /// </summary>
    public string GetFullAddress()
    {
        var parts = new List<string> { Address.Street };
        
        if (!string.IsNullOrEmpty(Address.StreetLine2))
            parts.Add(Address.StreetLine2);
        
        var cityLine = string.IsNullOrEmpty(Address.PostalCode)
            ? Address.City
            : $"{Address.PostalCode} {Address.City}";
        parts.Add(cityLine);
        
        parts.Add(Address.Governorate);
        parts.Add(Address.Country);

        return string.Join(", ", parts.Where(p => !string.IsNullOrWhiteSpace(p)));
    }
}
