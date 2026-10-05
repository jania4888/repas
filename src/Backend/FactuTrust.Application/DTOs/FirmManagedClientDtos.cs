using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// Payload du wizard « Nouveau dossier client » (type Sage) : création par le cabinet
/// d'une société cliente gérée, sans compte utilisateur sur la plateforme.
/// </summary>
public sealed record CreateFirmManagedClientDto
{
    // ── Étape 1 : Informations générales ────────────────────────────────────────
    public string CompanyName { get; init; } = null!;
    public string Nif { get; init; } = null!;
    public TunisianLegalForm? LegalForm { get; init; }
    public string? RneIdentifier { get; init; }
    public DateTime? IncorporationDate { get; init; }
    public decimal? ShareCapital { get; init; }

    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public string? PostalCode { get; init; }

    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Website { get; init; }

    // ── Étape 2 : Options comptables ─────────────────────────────────────────────
    /// <summary>Mois de début d'exercice (1-12). Défaut janvier.</summary>
    public int FiscalYearStartMonth { get; init; } = 1;
    /// <summary>Mois de fin d'exercice (1-12). Défaut décembre.</summary>
    public int FiscalYearEndMonth { get; init; } = 12;
    /// <summary>Premier exercice comptable géré (ex. 2026). Défaut : année courante.</summary>
    public int? FirstFiscalYear { get; init; }

    // ── Étape 3 : Options fiscales et sociales ───────────────────────────────────
    public TaxRegime TaxRegime { get; init; } = TaxRegime.RealRegime;
    public string? TaxOffice { get; init; }
    /// <summary>Taux IS de droit commun (%) — si renseigné, remplace le défaut légal de l'exercice.</summary>
    public decimal? IsStandardRate { get; init; }

    // ── Étape 4 : Paramètres du dossier cabinet ──────────────────────────────────
    public decimal? AnnualFeeAmount { get; init; }
    public BillingFrequency? BillingFrequency { get; init; }
    public string? BillingNotes { get; init; }
    /// <summary>Gestionnaire du dossier (collaborateur cabinet). Optionnel.</summary>
    public Guid? AssignedAccountantUserId { get; init; }
    public string? Notes { get; init; }
}

/// <summary>Résultat de la création d'un dossier client géré par le cabinet.</summary>
public sealed record FirmManagedClientCreatedDto
{
    public Guid CompanyTenantId { get; init; }
    public Guid AssignmentId { get; init; }
    public string CompanyName { get; init; } = null!;
}
