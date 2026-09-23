using FactuTrust.Domain.Common;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Billing;

/// <summary>
/// Lot C4 — Paramètres fiscaux singleton de la plateforme FactuTrust.
///
/// Une seule ligne dans la table <c>PlatformFiscalSettings</c>. Contient les
/// informations de l'émetteur (FactuTrust SARL), le taux de TVA standard appliqué
/// aux abonnements, le timbre fiscal légal tunisien (1 TND/facture en 2025+) et
/// les options de retenue à la source côté client.
///
/// Ces paramètres sont lus à chaque émission de facture. Les modifications
/// n'affectent que les nouvelles factures (les factures déjà émises figent
/// leurs propres mentions fiscales).
/// </summary>
public sealed class PlatformFiscalSettings : Entity
{
    /// <summary>NIF (matricule fiscal) de FactuTrust SARL — obligatoire DGI.</summary>
    public string Nif { get; private set; } = null!;

    /// <summary>Code TVA — figure sur la facture si fourni.</summary>
    public string? CodeTva { get; private set; }

    /// <summary>Raison sociale de l'émetteur (ex. « FactuTrust SARL »).</summary>
    public string CompanyName { get; private set; } = null!;

    /// <summary>Adresse complète émetteur, sur 1 à 4 lignes.</summary>
    public string Address { get; private set; } = null!;

    /// <summary>Téléphone affiché sur la facture (optionnel).</summary>
    public string? Phone { get; private set; }

    /// <summary>Email contact affiché sur la facture (optionnel).</summary>
    public string? Email { get; private set; }

    /// <summary>Site web affiché sur la facture (optionnel).</summary>
    public string? Website { get; private set; }

    /// <summary>RIB / IBAN affichés en pied de facture (virement).</summary>
    public string? Iban { get; private set; }
    public string? BankName { get; private set; }

    /// <summary>Si false, les factures sont émises HT = TTC sans TVA (régime exonéré).</summary>
    public bool ApplyVat { get; private set; }

    /// <summary>Taux de TVA standard appliqué aux services SaaS (généralement 19% en TN).</summary>
    public decimal DefaultVatRate { get; private set; }

    /// <summary>Montant du timbre fiscal en TND (1.000 TND par facture en 2025+).</summary>
    public decimal TimbreFiscalAmount { get; private set; }

    /// <summary>Si true, retenue à la source à 1.5% si client B2B en régime réel.</summary>
    public bool ApplyClientWithholding { get; private set; }

    /// <summary>Taux retenue à la source (généralement 1.5%).</summary>
    public decimal ClientWithholdingRate { get; private set; }

    /// <summary>Préfixe numérotation factures (par défaut « FT »).</summary>
    public string InvoiceNumberPrefix { get; private set; } = "FT";

    /// <summary>Préfixe numérotation reçus (par défaut « FT-RC »).</summary>
    public string ReceiptNumberPrefix { get; private set; } = "FT-RC";

    /// <summary>Mentions légales obligatoires en pied de facture.</summary>
    public string? LegalMentions { get; private set; }

    private PlatformFiscalSettings() { }

    public static PlatformFiscalSettings CreateDefaults()
    {
        return new PlatformFiscalSettings
        {
            Nif = NIF.Create("0000000A/A/M/000").Value.Value,
            CodeTva = null,
            CompanyName = "FactuTrust SARL",
            Address = "Tunis, Tunisie",
            Phone = null,
            Email = null,
            Website = null,
            Iban = null,
            BankName = null,
            ApplyVat = true,
            DefaultVatRate = 19m,
            TimbreFiscalAmount = 1.000m,
            ApplyClientWithholding = false,
            ClientWithholdingRate = 1.5m,
            InvoiceNumberPrefix = "FT",
            ReceiptNumberPrefix = "FT-RC",
            LegalMentions =
                "Facture émise conformément au Code de la TVA tunisien. " +
                "Le timbre fiscal de 1 TND est inclus selon l'article 117 du CDPF."
        };
    }

    public void Update(
        string nif,
        string? codeTva,
        string companyName,
        string address,
        string? phone,
        string? email,
        string? website,
        string? iban,
        string? bankName,
        bool applyVat,
        decimal defaultVatRate,
        decimal timbreFiscalAmount,
        bool applyClientWithholding,
        decimal clientWithholdingRate,
        string invoiceNumberPrefix,
        string receiptNumberPrefix,
        string? legalMentions)
    {
        var nifResult = NIF.Create(nif);
        if (nifResult.IsFailure)
            throw new ArgumentException(nifResult.Error.Description, nameof(nif));
        if (string.IsNullOrWhiteSpace(companyName)) throw new ArgumentException("Raison sociale requise", nameof(companyName));
        if (string.IsNullOrWhiteSpace(address)) throw new ArgumentException("Adresse requise", nameof(address));
        if (defaultVatRate < 0 || defaultVatRate > 100) throw new ArgumentOutOfRangeException(nameof(defaultVatRate));
        if (timbreFiscalAmount < 0) throw new ArgumentOutOfRangeException(nameof(timbreFiscalAmount));
        if (clientWithholdingRate < 0 || clientWithholdingRate > 100) throw new ArgumentOutOfRangeException(nameof(clientWithholdingRate));

        Nif = nifResult.Value.Value;
        CodeTva = string.IsNullOrWhiteSpace(codeTva) ? null : codeTva.Trim();
        CompanyName = companyName.Trim();
        Address = address.Trim();
        Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
        Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        Website = string.IsNullOrWhiteSpace(website) ? null : website.Trim();
        Iban = string.IsNullOrWhiteSpace(iban) ? null : iban.Trim();
        BankName = string.IsNullOrWhiteSpace(bankName) ? null : bankName.Trim();
        ApplyVat = applyVat;
        DefaultVatRate = defaultVatRate;
        TimbreFiscalAmount = timbreFiscalAmount;
        ApplyClientWithholding = applyClientWithholding;
        ClientWithholdingRate = clientWithholdingRate;
        InvoiceNumberPrefix = string.IsNullOrWhiteSpace(invoiceNumberPrefix) ? "FT" : invoiceNumberPrefix.Trim().ToUpperInvariant();
        ReceiptNumberPrefix = string.IsNullOrWhiteSpace(receiptNumberPrefix) ? "FT-RC" : receiptNumberPrefix.Trim().ToUpperInvariant();
        LegalMentions = string.IsNullOrWhiteSpace(legalMentions) ? null : legalMentions.Trim();
    }
}
