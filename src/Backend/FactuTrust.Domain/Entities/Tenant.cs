using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Represents a company/tenant in the multi-tenant system.
/// Each tenant has its own dedicated database.
/// </summary>
public sealed class Tenant : AggregateRoot
{
    public string CompanyName { get; private set; } = null!;
    public NIF NIF { get; private set; } = null!;
    public Address Address { get; private set; } = null!;
    public Email? Email { get; private set; }
    public PhoneNumber? Phone { get; private set; }
    public string? Website { get; private set; }
    public string? LogoUrl { get; private set; }
    
    public TaxRegime TaxRegime { get; private set; }
    public TenantKind Kind { get; private set; } = TenantKind.Company;
    public string DatabaseName { get; private set; } = null!;
    public bool IsActive { get; private set; }
    public DateTime? DeactivatedAt { get; private set; }

    /// <summary>
    /// Provisioning mini-saga (plan §1.5): tracks whether the tenant's dedicated database has been
    /// successfully created/seeded. <see cref="Create"/> (self-registration, the only flow with a
    /// two-phase commit — master row committed before database provisioning starts) defaults to
    /// <see cref="TenantProvisioningStatus.Pending"/>; every other factory provisions synchronously
    /// within one transaction like before and defaults to <see cref="TenantProvisioningStatus.Ready"/>
    /// so their behavior stays byte-identical. Login/tenant resolution must refuse a non-Ready tenant.
    /// </summary>
    public TenantProvisioningStatus ProvisioningStatus { get; private set; } = TenantProvisioningStatus.Ready;

    /// <summary>
    /// Cabinet comptable qui a créé et gère ce dossier client (société sans compte plateforme).
    /// Null pour les tenants auto-inscrits.
    /// </summary>
    public Guid? ManagedByFirmTenantId { get; private set; }

    public bool IsFirmManaged => ManagedByFirmTenantId.HasValue;

    /// <summary>
    /// Sector-aware registration wizard (plan §3 C1/C7) — normalized catalog code, e.g. "commerce".
    /// Null for legacy registrations and for firm tenants (register-firm never sets this).
    /// </summary>
    public string? CompanySegment { get; private set; }

    /// <summary>Normalized catalog code, e.g. "sante-paramedical". Null when no domain was captured.</summary>
    public string? BusinessDomain { get; private set; }

    /// <summary>
    /// Plan §2.1 — <see cref="FactuTrust.Domain.SectorConfiguration.SectorRuleSnapshot.CatalogVersionTag"/>
    /// (e.g. "static:0", "db:12") captured at the moment <see cref="CompanySegment"/>/<see cref="BusinessDomain"/>
    /// were last resolved from the sector catalog (registration, or a later reconfiguration). Null for
    /// tenants created before this field existed, or when no sector classification was ever set.
    /// Informational only — never gates behavior; lets support/diagnostics tell which catalog
    /// version drove a given tenant's module set.
    /// </summary>
    public string? SectorCatalogVersion { get; private set; }

    /// <summary>
    /// Réponses de profilage saisies à l'inscription (lot 3) — toutes facultatives : <c>null</c>
    /// signifie « question non posée ou sans réponse », jamais « non ».
    ///
    /// Elles ne gouvernent AUCUN droit : la résolution serveur des modules
    /// (<c>SectorModuleSetCalculator</c> : plafond du plan, fermeture des dépendances, rejet de
    /// <c>Honoraires</c>) est inchangée et reste seule décisionnaire. Elles sont conservées pour
    /// (a) rejouer la recommandation lors d'un changement de secteur en libre-service, et
    /// (b) alimenter plus tard la boucle de calibrage « recommandé vs retenu vs utilisé ».
    /// </summary>
    public bool? HasPhysicalStock { get; private set; }

    /// <summary>Vend à des particuliers (B2C) — voir <see cref="HasPhysicalStock"/>.</summary>
    public bool? SellsToConsumers { get; private set; }

    /// <summary>Tranche d'effectif normalisée : "1", "2-9", "10-49" ou "50+". Voir <see cref="HasPhysicalStock"/>.</summary>
    public string? HeadcountBand { get; private set; }

    /// <summary>Comptabilité tenue par un cabinet externe — voir <see cref="HasPhysicalStock"/>.</summary>
    public bool? AccountingDelegatedToFirm { get; private set; }

    /// <summary>Tranches d'effectif acceptées — liste blanche fermée (aucun texte libre n'est persisté).</summary>
    public static readonly IReadOnlyList<string> AllowedHeadcountBands = new[] { "1", "2-9", "10-49", "50+" };

    private Tenant() { }

    public static Result<Tenant> Create(
        string companyName,
        NIF nif,
        Address address,
        Email email,
        PhoneNumber phone,
        TaxRegime taxRegime,
        string? website = null)
    {
        // Self-registration is the only flow provisioning the tenant database in a second,
        // separate step after this master row is committed (plan §1.5 mini-saga) — starts
        // Pending until AuthController.Register marks it Ready/Failed.
        return BuildCompanyTenant(
            companyName, nif, address, email, phone, taxRegime, website, TenantProvisioningStatus.Pending);
    }

    private static Result<Tenant> BuildCompanyTenant(
        string companyName,
        NIF nif,
        Address address,
        Email? email,
        PhoneNumber? phone,
        TaxRegime taxRegime,
        string? website,
        TenantProvisioningStatus provisioningStatus)
    {
        if (string.IsNullOrWhiteSpace(companyName))
            return Result.Failure<Tenant>(Error.Validation("CompanyName", "La raison sociale est obligatoire"));

        if (companyName.Length > 200)
            return Result.Failure<Tenant>(Error.Validation("CompanyName", "La raison sociale ne peut pas dépasser 200 caractères"));

        var tenant = new Tenant
        {
            CompanyName = companyName.Trim(),
            NIF = nif,
            Address = address,
            Email = email,
            Phone = phone,
            TaxRegime = taxRegime,
            Kind = TenantKind.Company,
            Website = website?.Trim(),
            DatabaseName = GenerateDatabaseName(),
            IsActive = true,
            ProvisioningStatus = provisioningStatus
        };

        tenant.AddDomainEvent(new TenantCreatedEvent(tenant.Id, tenant.CompanyName, tenant.DatabaseName));

        return Result.Success(tenant);
    }

    /// <summary>
    /// Crée un tenant société géré par un cabinet comptable (client sans compte utilisateur sur la plateforme).
    /// L'email et le téléphone de contact sont facultatifs : seul ce chemin peut persister <c>null</c>.
    /// </summary>
    public static Result<Tenant> CreateFirmManaged(
        Guid managedByFirmTenantId,
        string companyName,
        NIF nif,
        Address address,
        Email? email,
        PhoneNumber? phone,
        TaxRegime taxRegime,
        string? website = null)
    {
        if (managedByFirmTenantId == Guid.Empty)
            return Result.Failure<Tenant>(Error.Validation("ManagedByFirmTenantId", "Le cabinet gestionnaire est obligatoire"));

        var result = BuildCompanyTenant(
            companyName, nif, address, email, phone, taxRegime, website, TenantProvisioningStatus.Ready);
        if (result.IsFailure)
            return result;

        result.Value.ManagedByFirmTenantId = managedByFirmTenantId;
        return result;
    }

    public static Result<Tenant> CreateAccountingFirm(
        string firmName,
        NIF nif,
        Address address,
        Email email,
        PhoneNumber phone,
        string? website = null)
    {
        if (string.IsNullOrWhiteSpace(firmName))
            return Result.Failure<Tenant>(Error.Validation("CompanyName", "La raison sociale du cabinet est obligatoire"));

        if (firmName.Length > 200)
            return Result.Failure<Tenant>(Error.Validation("CompanyName", "La raison sociale ne peut pas dépasser 200 caractères"));

        var tenant = new Tenant
        {
            CompanyName = firmName.Trim(),
            NIF = nif,
            Address = address,
            Email = email,
            Phone = phone,
            TaxRegime = TaxRegime.RealRegime,
            Kind = TenantKind.AccountingFirm,
            Website = website?.Trim(),
            DatabaseName = GenerateDatabaseName(),
            IsActive = true
        };

        tenant.AddDomainEvent(new TenantCreatedEvent(tenant.Id, tenant.CompanyName, tenant.DatabaseName));

        return Result.Success(tenant);
    }

    public void UpdateCompanyInfo(
        string companyName,
        Address address,
        PhoneNumber phone,
        string? website,
        string? logoUrl)
    {
        if (!string.IsNullOrWhiteSpace(companyName))
            CompanyName = companyName.Trim();

        Address = address;
        Phone = phone;
        Website = website?.Trim();
        LogoUrl = logoUrl?.Trim();

        AddDomainEvent(new TenantUpdatedEvent(Id, CompanyName));
    }

    public void UpdateTaxRegime(TaxRegime newRegime)
    {
        TaxRegime = newRegime;
    }

    /// <summary>Sync raison sociale depuis le dossier permanent cabinet (usage interne gouvernance).</summary>
    public void UpdateCompanyNameFromPermanentFile(string companyName)
    {
        if (!string.IsNullOrWhiteSpace(companyName))
            CompanyName = companyName.Trim();
    }

    /// <summary>Sync NIF depuis le dossier permanent cabinet (usage interne gouvernance).</summary>
    public Result UpdateNifFromPermanentFile(string nifValue)
    {
        var nif = NIF.Create(nifValue);
        if (nif.IsFailure)
            return Result.Failure(nif.Error);
        NIF = nif.Value;
        return Result.Success();
    }

    /// <summary>
    /// Sector-aware registration wizard (plan §6.1 B1/B5) — records the resolved segment/domain
    /// codes on the tenant. Normalizes (trim/lower-invariant); null/whitespace clears the field.
    /// Factory signatures are untouched: existing callers (register-firm, firm-managed clients)
    /// simply never call this, leaving both columns null.
    /// </summary>
    public void SetSectorClassification(string? companySegment, string? businessDomain)
    {
        CompanySegment = Normalize(companySegment);
        BusinessDomain = Normalize(businessDomain);

        static string? Normalize(string? code)
        {
            if (string.IsNullOrWhiteSpace(code))
                return null;

            var trimmed = code.Trim().ToLowerInvariant();
            return trimmed.Length > 50 ? trimmed[..50] : trimmed;
        }
    }

    /// <summary>Plan §2.1 — records the catalog version tag active when the sector classification was last resolved. Null clears it.</summary>
    /// <summary>
    /// Enregistre les réponses de profilage de l'inscription (lot 3). Purement additif : un appel
    /// avec tout à <c>null</c> laisse le tenant dans l'état d'un espace créé sans profilage, donc
    /// strictement identique au comportement d'avant ce lot.
    ///
    /// <paramref name="headcountBand"/> est validé contre <see cref="AllowedHeadcountBands"/> :
    /// une valeur inconnue est traitée comme absente (null) plutôt que persistée. Aucun texte libre
    /// venu du client n'atteint donc la base par ce chemin.
    /// </summary>
    public void SetRegistrationProfile(
        bool? hasPhysicalStock,
        bool? sellsToConsumers,
        string? headcountBand,
        bool? accountingDelegatedToFirm)
    {
        HasPhysicalStock = hasPhysicalStock;
        SellsToConsumers = sellsToConsumers;
        AccountingDelegatedToFirm = accountingDelegatedToFirm;

        var trimmed = headcountBand?.Trim();
        HeadcountBand = !string.IsNullOrEmpty(trimmed) && AllowedHeadcountBands.Contains(trimmed, StringComparer.Ordinal)
            ? trimmed
            : null;
    }

    public void SetSectorCatalogVersion(string? catalogVersionTag)
    {
        if (string.IsNullOrWhiteSpace(catalogVersionTag))
        {
            SectorCatalogVersion = null;
            return;
        }

        var trimmed = catalogVersionTag.Trim();
        SectorCatalogVersion = trimmed.Length > 50 ? trimmed[..50] : trimmed;
    }

    public void Deactivate()
    {
        if (!IsActive)
            return;

        IsActive = false;
        DeactivatedAt = DateTime.UtcNow;
        AddDomainEvent(new TenantDeactivatedEvent(Id, CompanyName));
    }

    public void Reactivate()
    {
        if (IsActive)
            return;

        IsActive = true;
        DeactivatedAt = null;
        AddDomainEvent(new TenantReactivatedEvent(Id, CompanyName));
    }

    /// <summary>Provisioning mini-saga (plan §1.5): dedicated database created/seeded and connection string persisted.</summary>
    public void MarkProvisioningReady()
    {
        ProvisioningStatus = TenantProvisioningStatus.Ready;
    }

    /// <summary>Provisioning mini-saga (plan §1.5): database provisioning failed — best-effort cleanup follows.</summary>
    public void MarkProvisioningFailed()
    {
        ProvisioningStatus = TenantProvisioningStatus.Failed;
    }

    private static string GenerateDatabaseName()
    {
        var uniqueId = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        return $"FactuTrust_Tenant_{uniqueId}";
    }
}

/// <summary>
/// Provisioning mini-saga status (plan §1.5) for a tenant's dedicated database.
/// <see cref="Ready"/> is deliberately the enum's zero/CLR-default value: EF Core treats a property
/// holding its CLR default as "not explicitly set" and would otherwise substitute the column's
/// database-generated default on every insert, silently discarding an explicit
/// <see cref="Pending"/> — see the `HasDefaultValue` sentinel-value warning this ordering avoids.
/// </summary>
public enum TenantProvisioningStatus
{
    /// <summary>Database provisioned, seeded, and connection string persisted — tenant usable.</summary>
    Ready = 0,

    /// <summary>Master row committed; database provisioning not completed yet.</summary>
    Pending = 1,

    /// <summary>Database provisioning failed; tenant/database are candidates for orphan cleanup.</summary>
    Failed = 2
}

/// <summary>
/// Tunisian tax regimes.
/// </summary>
public enum TaxRegime
{
    /// <summary>
    /// Régime réel - Full VAT accounting.
    /// </summary>
    RealRegime = 0,

    /// <summary>
    /// Régime forfaitaire - Simplified taxation for small businesses.
    /// </summary>
    FlatRateRegime = 1,

    /// <summary>
    /// Exonéré - VAT exempt.
    /// </summary>
    Exempt = 2
}

public static class TaxRegimeExtensions
{
    public static string ToDisplayString(this TaxRegime regime) => regime switch
    {
        TaxRegime.RealRegime => "Régime réel",
        TaxRegime.FlatRateRegime => "Régime forfaitaire",
        TaxRegime.Exempt => "Exonéré",
        _ => throw new ArgumentOutOfRangeException(nameof(regime))
    };
}
