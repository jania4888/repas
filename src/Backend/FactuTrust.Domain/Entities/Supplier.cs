using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Represents a supplier (fournisseur) from whom the company purchases goods.
/// Follows the same pattern as Client entity.
/// </summary>
public sealed class Supplier : AggregateRoot
{
    public string Name { get; private set; } = null!;
    public SupplierType Type { get; private set; }
    public NIF? NIF { get; private set; }
    public Address Address { get; private set; } = null!;
    public Email? Email { get; private set; }
    public PhoneNumber? Phone { get; private set; }
    public string? ContactPerson { get; private set; }
    public int PaymentTermDays { get; private set; }
    public string? Notes { get; private set; }
    public bool IsActive { get; private set; }

    // TEJ / withholding-related fields
    public IdentificationType? TejIdentificationType { get; private set; }
    public DateTime? DateOfBirth { get; private set; }
    public string? CountryCode { get; private set; }
    public bool IsResident { get; private set; } = true;
    public string? Activity { get; private set; }
    public Guid? DefaultWithholdingTaxTypeId { get; private set; }
    public decimal? DefaultWithholdingRate { get; private set; }
    public bool IsSubjectToWithholding { get; private set; }

    private readonly List<PurchaseOrder> _purchaseOrders = new();
    public IReadOnlyCollection<PurchaseOrder> PurchaseOrders => _purchaseOrders.AsReadOnly();

    private Supplier() { }

    public static Result<Supplier> Create(
        string name,
        SupplierType type,
        Address address,
        Email? email,
        NIF? nif = null,
        PhoneNumber? phone = null,
        string? contactPerson = null,
        int paymentTermDays = 30,
        string? notes = null)
    {
        if (string.IsNullOrWhiteSpace(name))
            return Result.Failure<Supplier>(Error.Validation("Name", "Le nom du fournisseur est obligatoire"));

        if (name.Length > 200)
            return Result.Failure<Supplier>(Error.Validation("Name", "Le nom du fournisseur ne peut pas dépasser 200 caractères"));

        if (type == SupplierType.Business && nif is null)
            return Result.Failure<Supplier>(Error.Validation("NIF", "Le NIF est obligatoire pour les fournisseurs professionnels"));

        if (paymentTermDays < 0 || paymentTermDays > 365)
            return Result.Failure<Supplier>(Error.Validation("PaymentTermDays", "Le délai de paiement doit être compris entre 0 et 365 jours"));

        var supplier = new Supplier
        {
            Name = name.Trim(),
            Type = type,
            NIF = nif,
            Address = address,
            Email = email,
            Phone = phone,
            ContactPerson = contactPerson?.Trim(),
            PaymentTermDays = paymentTermDays,
            Notes = notes?.Trim(),
            IsActive = true
        };

        return Result.Success(supplier);
    }

    public void Update(
        string name,
        Address address,
        Email? email,
        PhoneNumber? phone,
        string? contactPerson,
        int paymentTermDays,
        string? notes)
    {
        if (!string.IsNullOrWhiteSpace(name))
            Name = name.Trim();

        Address = address;
        Email = email;
        Phone = phone;
        ContactPerson = contactPerson?.Trim();
        PaymentTermDays = paymentTermDays;
        Notes = notes?.Trim();
    }

    public void UpdateNIF(NIF nif)
    {
        NIF = nif;
    }

    public void Deactivate()
    {
        IsActive = false;
    }

    public void Reactivate()
    {
        IsActive = true;
    }

    public void UpdateTejInfo(
        IdentificationType? identificationType,
        DateTime? dateOfBirth,
        string? countryCode,
        bool isResident,
        string? activity)
    {
        TejIdentificationType = identificationType;
        DateOfBirth = dateOfBirth;
        CountryCode = countryCode?.Trim();
        IsResident = isResident;
        Activity = activity?.Trim();
    }

    public void SetWithholdingDefaults(
        Guid? defaultWithholdingTaxTypeId,
        decimal? defaultWithholdingRate,
        bool isSubjectToWithholding)
    {
        DefaultWithholdingTaxTypeId = defaultWithholdingTaxTypeId;
        DefaultWithholdingRate = defaultWithholdingRate;
        IsSubjectToWithholding = isSubjectToWithholding;
    }
}

/// <summary>
/// Type of supplier.
/// </summary>
public enum SupplierType
{
    /// <summary>
    /// Individual/private person.
    /// </summary>
    Individual = 0,

    /// <summary>
    /// Business/company.
    /// </summary>
    Business = 1
}

public static class SupplierTypeExtensions
{
    public static string ToDisplayString(this SupplierType type) => type switch
    {
        SupplierType.Individual => "Particulier",
        SupplierType.Business => "Entreprise",
        _ => throw new ArgumentOutOfRangeException(nameof(type))
    };
}
