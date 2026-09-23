using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Represents a client/customer of a company.
/// </summary>
public sealed class Client : AggregateRoot
{
    public string Name { get; private set; } = null!;
    public ClientType Type { get; private set; }
    public NIF? NIF { get; private set; }
    public Address Address { get; private set; } = null!;
    public Email? Email { get; private set; }
    public PhoneNumber? Phone { get; private set; }
    public string? ContactPerson { get; private set; }
    public string? Notes { get; private set; }
    public Guid? AssignedUserId { get; private set; }
    public string? AssignedUserName { get; private set; }
    public bool IsActive { get; private set; }

    // TEJ / withholding-related fields
    public IdentificationType? TejIdentificationType { get; private set; }
    public DateTime? DateOfBirth { get; private set; }
    public string? CountryCode { get; private set; }
    public bool IsResident { get; private set; } = true;
    public string? Activity { get; private set; }

    /// <summary>
    /// Régime de TVA du client. Décide si la TVA s'applique et sous quelle justification.
    ///
    /// ⚠️ N'est PAS un taux : <c>VatRate</c> reste porté par la ligne, d'après le produit.
    /// Avant ce champ, exonération, suspension et export étaient tous ramenés à « 0 % »,
    /// rendant impossible de distinguer un exportateur d'un exonéré, ou de justifier une
    /// suspension en contrôle.
    /// </summary>
    public ClientVatRegime VatRegime { get; private set; } = ClientVatRegime.Normal;

    /// <summary>
    /// Attestation d'achat en suspension (art. 11). Obligatoire lorsque
    /// <see cref="VatRegime"/> vaut <see cref="ClientVatRegime.Suspension"/>.
    /// </summary>
    public VatExemptionCertificate? VatExemptionCertificate { get; private set; }

    /// <summary>
    /// Grille tarifaire affectée au client, s'il en a une. Le résolveur de prix la consulte
    /// après un éventuel prix négocié et avant le prix catalogue. <c>null</c> = tarif catalogue.
    /// </summary>
    public Guid? PriceListId { get; private set; }

    private readonly List<Invoice> _invoices = new();
    public IReadOnlyCollection<Invoice> Invoices => _invoices.AsReadOnly();

    private Client() { }

    public static Result<Client> Create(
        string name,
        ClientType type,
        Address address,
        Email? email,
        NIF? nif = null,
        PhoneNumber? phone = null,
        string? contactPerson = null,
        string? notes = null)
    {
        if (string.IsNullOrWhiteSpace(name))
            return Result.Failure<Client>(Error.Validation("Name", "Le nom du client est obligatoire"));

        if (name.Length > 200)
            return Result.Failure<Client>(Error.Validation("Name", "Le nom du client ne peut pas dépasser 200 caractères"));

        if ((type == ClientType.Business || type == ClientType.Government || type == ClientType.Association) && nif is null)
            return Result.Failure<Client>(Error.Validation("NIF", "Le NIF est obligatoire pour les clients professionnels"));

        var client = new Client
        {
            Name = name.Trim(),
            Type = type,
            NIF = nif,
            Address = address,
            Email = email,
            Phone = phone,
            ContactPerson = contactPerson?.Trim(),
            Notes = notes?.Trim(),
            IsActive = true
        };

        return Result.Success(client);
    }

    public void Update(
        string name,
        Address address,
        Email? email,
        PhoneNumber? phone,
        string? contactPerson,
        string? notes)
    {
        if (!string.IsNullOrWhiteSpace(name))
            Name = name.Trim();

        Address = address;
        Email = email;
        Phone = phone;
        ContactPerson = contactPerson?.Trim();
        Notes = notes?.Trim();
    }

    public void UpdateNIF(NIF nif)
    {
        NIF = nif;
    }

    /// <summary>
    /// Fixe le régime de TVA et, s'il l'exige, l'attestation qui le justifie.
    ///
    /// Le couple est posé d'un seul geste : un régime de suspension sans attestation est
    /// refusé ici plutôt que découvert à la validation d'une facture, quand il est trop tard
    /// pour que le commercial réagisse.
    /// </summary>
    public Result SetVatRegime(ClientVatRegime regime, VatExemptionCertificate? certificate = null)
    {
        if (regime.RequiresCertificate() && certificate is null)
        {
            return Result.Failure(Error.Validation("VatExemptionCertificate",
                "Une attestation de suspension est obligatoire pour ce régime"));
        }

        VatRegime = regime;

        // L'attestation ne survit pas à un changement de régime qui ne l'exige plus :
        // la conserver laisserait croire à une justification encore active.
        VatExemptionCertificate = regime.RequiresCertificate() ? certificate : null;

        return Result.Success();
    }

    /// <summary>
    /// Vrai si le client peut être facturé en suspension à la date donnée — attestation
    /// présente ET couvrant cette date.
    /// </summary>
    public bool HasValidVatExemptionAt(DateTime date) =>
        VatExemptionCertificate is not null && VatExemptionCertificate.CoversDate(date);

    /// <summary>Affecte une grille tarifaire au client (ou la retire si <paramref name="priceListId"/> est null).</summary>
    public void AssignPriceList(Guid? priceListId) => PriceListId = priceListId;

    /// <summary>
    /// Plafond d'encours accordé au client, en TND. <c>null</c> = pas de plafond.
    ///
    /// ⚠️ <b>Le dépassement AVERTIT, il ne bloque jamais.</b> C'est une décision produit
    /// assumée : le commercial connaît son client et son contexte mieux que la règle. Bloquer
    /// une commande sur un plafond mal tenu coûterait plus cher que le risque couvert.
    /// </summary>
    public decimal? CreditLimit { get; private set; }

    /// <summary>Délai de règlement habituel du client, en jours. Sert de proposition à la saisie.</summary>
    public int? DefaultPaymentTermDays { get; private set; }

    /// <summary>
    /// Fixe (ou retire) le plafond d'encours et le délai de règlement habituel.
    /// </summary>
    public Result SetCreditTerms(decimal? creditLimit, int? defaultPaymentTermDays)
    {
        if (creditLimit is < 0)
            return Result.Failure(Error.Validation("CreditLimit", "Le plafond d'encours ne peut pas être négatif"));

        if (defaultPaymentTermDays is < 0 or > 365)
            return Result.Failure(Error.Validation("DefaultPaymentTermDays", "Le délai doit être compris entre 0 et 365 jours"));

        CreditLimit = creditLimit;
        DefaultPaymentTermDays = defaultPaymentTermDays;

        return Result.Success();
    }

    public void Deactivate()
    {
        IsActive = false;
    }

    public void Reactivate()
    {
        IsActive = true;
    }

    public void AssignToUser(Guid userId, string userName)
    {
        AssignedUserId = userId;
        AssignedUserName = userName?.Trim();
    }

    public void UnassignUser()
    {
        AssignedUserId = null;
        AssignedUserName = null;
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
}

/// <summary>
/// Type of client.
/// </summary>
public enum ClientType
{
    /// <summary>
    /// Individual/private person.
    /// </summary>
    Individual = 0,

    /// <summary>
    /// Business/company.
    /// </summary>
    Business = 1,

    /// <summary>
    /// Public administration or government entity.
    /// </summary>
    Government = 2,

    /// <summary>
    /// Non-profit association or NGO.
    /// </summary>
    Association = 3
}

public static class ClientTypeExtensions
{
    public static string ToDisplayString(this ClientType type) => type switch
    {
        ClientType.Individual => "Particulier",
        ClientType.Business => "Entreprise",
        ClientType.Government => "Administration",
        ClientType.Association => "Association",
        _ => throw new ArgumentOutOfRangeException(nameof(type))
    };
}
