using FactuTrust.Domain.Common;

using FactuTrust.Domain.Enums;

using FactuTrust.Domain.ValueObjects;

using TaxRegime = FactuTrust.Domain.Entities.TaxRegime;



namespace FactuTrust.Domain.Entities.FirmGovernance;



/// <summary>Dossier permanent juridique d'un client cabinet (Master DB).</summary>

public sealed class PermanentFile : AggregateRoot

{

    public Guid FirmClientAssignmentId { get; private set; }

    public Guid FirmTenantId { get; private set; }

    public Guid CompanyTenantId { get; private set; }

    public PermanentFileStatus Status { get; private set; }

    public int WizardStep { get; private set; }



    public string? CompanyName { get; private set; }

    public string? Nif { get; private set; }

    public string? RneIdentifier { get; private set; }

    public TunisianLegalForm? LegalForm { get; private set; }

    public DateTime? IncorporationDate { get; private set; }

    public decimal? ShareCapital { get; private set; }

    public string Currency { get; private set; } = "TND";



    public string? Street { get; private set; }

    public string? City { get; private set; }

    public string? Governorate { get; private set; }

    public string? PostalCode { get; private set; }



    public string? TaxOffice { get; private set; }

    public TaxRegime? TaxRegime { get; private set; }

    public bool HasTaxCertificate { get; private set; }



    public int? FiscalYearStartMonth { get; private set; }

    public int? FiscalYearEndMonth { get; private set; }



    public string? CurrentLegalAct { get; private set; }

    public string? MissionStatus { get; private set; }

    public bool IsDigitized { get; private set; }

    public bool MissionResigned { get; private set; }

    public int? ResignationFiscalYear { get; private set; }

    public string? ResignationNotes { get; private set; }



    public bool LabCompleted { get; private set; }

    public bool MissionAccepted { get; private set; }

    public DateTime? LabCompletedAt { get; private set; }

    public DateTime? MissionAcceptedAt { get; private set; }

    public decimal? AnnualFeeAmount { get; private set; }

    public BillingFrequency? BillingFrequency { get; private set; }

    public string? BillingNotes { get; private set; }



    public Guid? AssignedAccountantUserId { get; private set; }

    public string? AssignedAccountantName { get; private set; }



    public DateTime? SyncedToTenantAt { get; private set; }



    private PermanentFile() { }



    public static Result<PermanentFile> Create(

        Guid firmClientAssignmentId,

        Guid firmTenantId,

        Guid companyTenantId,

        string? companyName = null,

        string? nif = null,

        TaxRegime? taxRegime = null)

    {

        if (firmClientAssignmentId == Guid.Empty || firmTenantId == Guid.Empty || companyTenantId == Guid.Empty)

            return Result.Failure<PermanentFile>(Error.Validation("Assignment", "Identifiants dossier invalides"));



        var file = new PermanentFile

        {

            FirmClientAssignmentId = firmClientAssignmentId,

            FirmTenantId = firmTenantId,

            CompanyTenantId = companyTenantId,

            CompanyName = companyName?.Trim(),

            Nif = CanonicalNifOrTrim(nif),

            TaxRegime = taxRegime,

            Status = PermanentFileStatus.Draft,

            WizardStep = 1

        };



        if (!string.IsNullOrWhiteSpace(file.CompanyName) || !string.IsNullOrWhiteSpace(file.Nif) || taxRegime.HasValue)

            file.EnsureInProgress();



        return Result.Success(file);

    }



    public void UpdateIdentity(

        string? companyName,

        string? nif,

        string? rneIdentifier,

        TunisianLegalForm? legalForm,

        DateTime? incorporationDate,

        decimal? shareCapital)

    {

        CompanyName = companyName?.Trim();

        Nif = CanonicalNifOrTrim(nif);

        RneIdentifier = rneIdentifier?.Trim();

        LegalForm = legalForm;

        IncorporationDate = incorporationDate;

        ShareCapital = shareCapital;

        WizardStep = Math.Max(WizardStep, 1);

        EnsureInProgress();

    }



    public void UpdateRegisteredOffice(string? street, string? city, string? governorate, string? postalCode)

    {

        Street = street?.Trim();

        City = city?.Trim();

        Governorate = governorate?.Trim();

        PostalCode = postalCode?.Trim();

        EnsureInProgress();

    }



    public void UpdateTaxAdministration(string? taxOffice, TaxRegime? taxRegime, bool hasTaxCertificate)

    {

        TaxOffice = taxOffice?.Trim();

        TaxRegime = taxRegime;

        HasTaxCertificate = hasTaxCertificate;

        EnsureInProgress();

    }



    public void UpdateAccountingYear(int? startMonth, int? endMonth)

    {

        FiscalYearStartMonth = startMonth;

        FiscalYearEndMonth = endMonth;

        EnsureInProgress();

    }



    public void UpdateLegalStatus(

        string? currentLegalAct,

        string? missionStatus,

        bool isDigitized,

        bool missionResigned,

        int? resignationFiscalYear,

        string? resignationNotes)

    {

        CurrentLegalAct = currentLegalAct?.Trim();

        MissionStatus = missionStatus?.Trim();

        IsDigitized = isDigitized;

        MissionResigned = missionResigned;

        ResignationFiscalYear = resignationFiscalYear;

        ResignationNotes = resignationNotes?.Trim();

    }



    public void UpdateCompliance(bool labCompleted, bool missionAccepted)

    {

        if (labCompleted && !LabCompleted)

            LabCompletedAt = DateTime.UtcNow;

        if (missionAccepted && !MissionAccepted)

            MissionAcceptedAt = DateTime.UtcNow;

        LabCompleted = labCompleted;

        MissionAccepted = missionAccepted;

        WizardStep = Math.Max(WizardStep, 4);

        EnsureInProgress();

    }



    public Result EnsureMutable()

    {

        if (Status == PermanentFileStatus.Archived)

            return Result.Failure(Error.Conflict("Ce dossier permanent est archivé et ne peut plus être modifié."));

        return Result.Success();

    }



    public Result EnsureSyncable()

    {

        if (Status != PermanentFileStatus.Complete)

            return Result.Failure(Error.Validation("Status", "Seuls les dossiers complets peuvent être synchronisés."));

        return Result.Success();

    }



    public void UpdateBilling(decimal? annualFeeAmount, BillingFrequency? billingFrequency, string? currency, string? billingNotes)

    {

        AnnualFeeAmount = annualFeeAmount;

        BillingFrequency = billingFrequency;

        if (!string.IsNullOrWhiteSpace(currency))

            Currency = currency.Trim().ToUpperInvariant();

        BillingNotes = billingNotes?.Trim();

        WizardStep = Math.Max(WizardStep, 5);

        EnsureInProgress();

    }



    public void Archive()

    {

        Status = PermanentFileStatus.Archived;

    }



    public void AssignAccountant(Guid? userId, string? name)

    {

        AssignedAccountantUserId = userId;

        AssignedAccountantName = name?.Trim();

    }



    public void AdvanceWizard(int step)

    {

        WizardStep = Math.Max(WizardStep, step);

        if (step > 1)

            EnsureInProgress();

    }



    /// <summary>

    /// Marks the permanent file as complete when identity, LAB, mission and at least one representative are valid.

    /// </summary>

    public Result MarkComplete(int activeRepresentativeCount)

    {

        if (string.IsNullOrWhiteSpace(CompanyName))

            return Result.Failure(Error.Validation("CompanyName", "La raison sociale est obligatoire pour finaliser le dossier."));



        if (string.IsNullOrWhiteSpace(Nif))

            return Result.Failure(Error.Validation("NIF", "Le matricule fiscal (NIF) est obligatoire pour finaliser le dossier."));



        var nifResult = NIF.Create(Nif);

        if (nifResult.IsFailure)

            return Result.Failure(nifResult.Error);



        Nif = nifResult.Value.Value;



        if (!LegalForm.HasValue)

            return Result.Failure(Error.Validation("LegalForm", "La forme juridique est obligatoire pour finaliser le dossier."));



        if (!LabCompleted)

            return Result.Failure(Error.Validation("LabCompleted", "Le questionnaire LAB doit être complété."));



        if (!MissionAccepted)

            return Result.Failure(Error.Validation("MissionAccepted", "La lettre de mission doit être acceptée."));



        if (activeRepresentativeCount < 1)

            return Result.Failure(Error.Validation("Representatives", "Au moins un dirigeant actif est requis."));



        Status = PermanentFileStatus.Complete;

        WizardStep = 6;

        return Result.Success();

    }



    /// <summary>Reopens a complete file that no longer meets completion criteria.</summary>

    public void ReopenToInProgress()

    {

        if (Status == PermanentFileStatus.Complete)

            Status = PermanentFileStatus.InProgress;

    }



    public void MarkSyncedToTenant() => SyncedToTenantAt = DateTime.UtcNow;



    private void EnsureInProgress()

    {

        if (Status == PermanentFileStatus.Draft)

            Status = PermanentFileStatus.InProgress;

    }



    /// <summary>
    /// Valid company NIFs are stored on the fiscal card. Incomplete drafts stay as typed.
    /// </summary>
    private static string? CanonicalNifOrTrim(string? nif)
    {
        if (string.IsNullOrWhiteSpace(nif))
            return nif?.Trim();

        return NIF.TryCanonicalize(nif, out var canonical) ? canonical : nif.Trim();
    }

}

