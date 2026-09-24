using FactuTrust.Domain.Entities;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class AccountingFirmProfileTests
{
    private static AccountingFirmProfile NewProfile()
    {
        var email = Email.Create("cabinet@example.com").Value;
        var phone = PhoneNumber.Create("71123456").Value;
        return AccountingFirmProfile.Create(
            Guid.Parse("22222222-2222-2222-2222-222222222222"),
            "Cabinet Test",
            "Tunis",
            "Tunis",
            email,
            phone).Value;
    }

    private static AccountingFirmProfileUpdate ValidUpdate() => new()
    {
        DisplayName = "Cabinet Test",
        City = "Tunis",
        Governorate = "Tunis",
        Description = new string('a', 80),
        ProfessionalRegistrationNumber = "ORDRE-1",
        ContactEmail = "cabinet@example.com",
        ContactPhone = "71123456",
        IsPublicInDirectory = true,
        PracticeAreas = ["tva"],
        Languages = ["fr"],
        ClientSegments = ["pme"]
    };

    [Fact]
    public void Create_leaves_new_directory_fields_empty()
    {
        var profile = NewProfile();

        Assert.Empty(profile.PracticeAreas);
        Assert.Empty(profile.ClientSegments);
        Assert.Empty(profile.Languages);
        Assert.Null(profile.PublicWebsite);
        Assert.Null(profile.AcceptsRemote);
        Assert.Null(profile.YearsOfExperience);
    }

    [Fact]
    public void Update_rejects_html_description_without_writing()
    {
        var profile = NewProfile();
        var update = ValidUpdate() with { Description = "<script>alert(1)</script>" };

        var result = profile.Update(update);

        Assert.True(result.IsFailure);
        Assert.Null(profile.Description);
    }

    [Fact]
    public void Update_rejects_non_https_website_without_writing()
    {
        var profile = NewProfile();
        var result = profile.Update(ValidUpdate() with { PublicWebsite = "http://cabinet.tn" });

        Assert.True(result.IsFailure);
        Assert.Null(profile.PublicWebsite);
    }

    [Fact]
    public void Update_rejects_unknown_practice_area_without_writing()
    {
        var profile = NewProfile();
        var result = profile.Update(ValidUpdate() with { PracticeAreas = ["audit-illegal"] });

        Assert.True(result.IsFailure);
        Assert.Empty(profile.PracticeAreas);
    }

    [Fact]
    public void Update_rejects_unknown_governorate_without_writing()
    {
        var profile = NewProfile();
        var result = profile.Update(ValidUpdate() with { Governorate = "Paris" });

        Assert.True(result.IsFailure);
        Assert.Equal("Tunis", profile.Governorate);
    }

    [Fact]
    public void Update_rejects_invalid_email_and_phone()
    {
        var profile = NewProfile();

        Assert.True(profile.Update(ValidUpdate() with { ContactEmail = "pas-un-email" }).IsFailure);
        Assert.Equal("cabinet@example.com", profile.ContactEmail);

        Assert.True(profile.Update(ValidUpdate() with { ContactPhone = "123" }).IsFailure);
        Assert.Equal("+21671123456", profile.ContactPhone);
    }

    [Fact]
    public void Directory_item_type_does_not_expose_contact_or_nif()
    {
        var names = typeof(FactuTrust.Application.DTOs.AccountingFirmDirectoryItemDto)
            .GetProperties()
            .Select(p => p.Name)
            .ToArray();

        Assert.DoesNotContain("ContactEmail", names);
        Assert.DoesNotContain("ContactPhone", names);
        Assert.DoesNotContain("Nif", names);
        Assert.DoesNotContain("Completeness", names);
    }

    [Fact]
    public void Completeness_reaches_100_only_when_every_criterion_is_met()
    {
        var score = AccountingFirmProfileCatalog.CompletenessScore(
            new string('a', 80), ["tva"], ["fr"], "Tunis", "ORDRE-1", true);
        Assert.Equal(100, score);

        var partial = AccountingFirmProfileCatalog.CompletenessScore(null, [], [], "Tunis", null, false);
        Assert.True(partial < 80);
    }
}
