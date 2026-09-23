using FactuTrust.Domain.Entities.FirmGovernance;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class PermanentFileTests
{
    private static readonly Guid AssignmentId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid FirmId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static PermanentFile CreateDraft() =>
        PermanentFile.Create(AssignmentId, FirmId, CompanyId, "Ste Test").Value;

    [Fact]
    public void Create_with_name_sets_in_progress()
    {
        var file = CreateDraft();
        Assert.Equal(PermanentFileStatus.InProgress, file.Status);
    }

    [Fact]
    public void Create_empty_stays_draft()
    {
        var file = PermanentFile.Create(AssignmentId, FirmId, CompanyId).Value;
        Assert.Equal(PermanentFileStatus.Draft, file.Status);
    }

    [Fact]
    public void AdvanceWizard_past_1_sets_in_progress()
    {
        var file = PermanentFile.Create(AssignmentId, FirmId, CompanyId).Value;
        file.AdvanceWizard(2);
        Assert.Equal(PermanentFileStatus.InProgress, file.Status);
        Assert.Equal(2, file.WizardStep);
    }

    [Fact]
    public void MarkComplete_fails_without_nif()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", null, null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(true, true);

        var result = file.MarkComplete(1);

        Assert.True(result.IsFailure);
        Assert.NotEqual(PermanentFileStatus.Complete, file.Status);
    }

    [Fact]
    public void MarkComplete_fails_without_legal_form()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", "1234567/A/B/C/000", null, null, null, null);
        file.UpdateCompliance(true, true);

        var result = file.MarkComplete(1);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void MarkComplete_fails_without_lab()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", "1234567/A/B/C/000", null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(false, true);

        var result = file.MarkComplete(1);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void MarkComplete_fails_without_representative()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", "1234567/A/B/C/000", null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(true, true);

        var result = file.MarkComplete(0);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void MarkComplete_succeeds_with_full_checklist()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", "1234567/A/B/C/000", null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(true, true);

        var result = file.MarkComplete(1);

        Assert.True(result.IsSuccess);
        Assert.Equal(PermanentFileStatus.Complete, file.Status);
        Assert.Equal(6, file.WizardStep);
        Assert.Equal("1234567A/B/C/000", file.Nif);
    }

    [Fact]
    public void MarkComplete_fails_with_invalid_nif_format()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", "INVALID", null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(true, true);

        var result = file.MarkComplete(1);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void MarkComplete_succeeds_without_billing()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", "1234567/A/B/C/000", null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(true, true);

        var result = file.MarkComplete(1);

        Assert.True(result.IsSuccess);
        Assert.Null(file.AnnualFeeAmount);
    }

    [Fact]
    public void UpdateBilling_sets_fields_and_Archive_sets_status()
    {
        var file = CreateDraft();
        file.UpdateBilling(500m, BillingFrequency.Monthly, "TND", "Notes");
        Assert.Equal(500m, file.AnnualFeeAmount);
        Assert.Equal(BillingFrequency.Monthly, file.BillingFrequency);
        Assert.Equal("Notes", file.BillingNotes);

        file.Archive();
        Assert.Equal(PermanentFileStatus.Archived, file.Status);
    }

    [Fact]
    public void ReopenToInProgress_from_complete()
    {
        var file = CreateDraft();
        file.UpdateIdentity("Ste Test", "1234567/A/B/C/000", null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(true, true);
        file.MarkComplete(1);

        file.ReopenToInProgress();

        Assert.Equal(PermanentFileStatus.InProgress, file.Status);
    }

    [Fact]
    public void EnsureMutable_fails_when_archived()
    {
        var file = CreateDraft();
        file.Archive();

        var result = file.EnsureMutable();

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void EnsureSyncable_requires_complete()
    {
        var file = CreateDraft();

        Assert.True(file.EnsureSyncable().IsFailure);

        file.UpdateIdentity("Ste Test", "1234567/A/B/C/000", null, TunisianLegalForm.Sarl, null, null);
        file.UpdateCompliance(true, true);
        file.MarkComplete(1);

        Assert.True(file.EnsureSyncable().IsSuccess);
    }

    [Fact]
    public void UpdateCompliance_sets_mission_dates_on_first_acceptance()
    {
        var file = CreateDraft();
        Assert.Null(file.LabCompletedAt);
        Assert.Null(file.MissionAcceptedAt);

        file.UpdateCompliance(true, true);

        Assert.NotNull(file.LabCompletedAt);
        Assert.NotNull(file.MissionAcceptedAt);
    }
}
