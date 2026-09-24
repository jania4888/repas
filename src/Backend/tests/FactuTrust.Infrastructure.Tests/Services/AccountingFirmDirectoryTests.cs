using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using FactuTrust.Application.Common.Interfaces;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class AccountingFirmDirectoryTests
{
    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    private static FirmAssignmentService BuildService(MasterDbContext db)
    {
        var notifications = new Mock<INotificationService>();
        var snapshot = new Mock<ICompanyProfileSnapshotProvider>();
        snapshot.Setup(p => p.TryDeserialize(It.IsAny<string?>())).Returns((CompanyProfileSnapshotDto?)null);
        var dossier = new Mock<IFirmDossierAccessService>();
        var currentUser = new Mock<ICurrentUser>();
        return new FirmAssignmentService(
            db,
            notifications.Object,
            snapshot.Object,
            dossier.Object,
            currentUser.Object,
            NullLogger<FirmAssignmentService>.Instance);
    }

    private static async Task<Guid> SeedFirmAsync(
        MasterDbContext db,
        string name,
        string city,
        string governorate,
        string nif,
        bool isPublic = true,
        bool active = true,
        string? practice = null)
    {
        var tenant = Tenant.CreateAccountingFirm(
            name,
            NIF.Create(nif).Value,
            Address.Create("1 rue Test", city, governorate).Value,
            Email.Create($"{name.Replace(' ', '.').ToLowerInvariant()}@example.com").Value,
            PhoneNumber.Create("71123456").Value).Value;

        if (!active)
            tenant.Deactivate();

        db.Tenants.Add(tenant);

        var profile = AccountingFirmProfile.Create(
            tenant.Id,
            name,
            city,
            governorate,
            Email.Create("contact@example.com").Value,
            PhoneNumber.Create("98111222").Value,
            description: "Cabinet de test spécialisé TVA et tenue",
            professionalRegistrationNumber: "99887766",
            isPublicInDirectory: isPublic).Value;

        if (practice is not null)
        {
            var updated = profile.Update(new AccountingFirmProfileUpdate
            {
                DisplayName = name,
                City = city,
                Governorate = governorate,
                Description = "Cabinet de test spécialisé TVA et tenue",
                ProfessionalRegistrationNumber = "99887766",
                ContactEmail = "contact@example.com",
                ContactPhone = "98111222",
                IsPublicInDirectory = isPublic,
                PracticeAreas = [practice],
                Languages = ["fr"]
            });
            Assert.True(updated.IsSuccess);
        }

        db.AccountingFirmProfiles.Add(profile);
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    private static async Task SeedCompanyAsync(MasterDbContext db)
    {
        var company = Tenant.Create(
            "Société Cliente",
            NIF.Create("1234567/A/B/C/000").Value,
            Address.Create("2 rue Client", "Tunis", "Tunis").Value,
            Email.Create("societe@example.com").Value,
            PhoneNumber.Create("20111222").Value,
            TaxRegime.RealRegime).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(company, CompanyId);
        db.Tenants.Add(company);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Directory_hides_private_and_inactive_firms_and_contact_fields()
    {
        await using var db = BuildMaster();
        await SeedCompanyAsync(db);
        var visible = await SeedFirmAsync(db, "Cabinet Visible", "Tunis", "Tunis", "1111111/A/B/C/000");
        await SeedFirmAsync(db, "Cabinet Prive", "Sfax", "Sfax", "2222222/A/B/C/000", isPublic: false);
        await SeedFirmAsync(db, "Cabinet Inactif", "Sousse", "Sousse", "3333333/A/B/C/000", active: false);

        var page = await BuildService(db).SearchDirectoryAsync(new AccountingFirmDirectoryQuery(), CompanyId);

        Assert.True(page.IsSuccess);
        var item = Assert.Single(page.Value.Items);
        Assert.Equal(visible, item.FirmTenantId);
        Assert.Equal("Tunis", page.Value.CompanyGovernorate);
        Assert.True(item.SameGovernorate);
    }

    [Fact]
    public async Task Directory_rejects_unknown_filter_and_clamps_page_size()
    {
        await using var db = BuildMaster();
        await SeedCompanyAsync(db);
        await SeedFirmAsync(db, "Cabinet Alpha", "Tunis", "Tunis", "4444444/A/B/C/000", practice: "tva");

        var service = BuildService(db);
        var invalid = await service.SearchDirectoryAsync(
            new AccountingFirmDirectoryQuery { PracticeArea = "audit-illegal" }, CompanyId);

        Assert.True(invalid.IsFailure);
        Assert.Equal("Cabinet Alpha", (await db.AccountingFirmProfiles.SingleAsync()).DisplayName);

        for (var i = 0; i < 51; i++)
        {
            await SeedFirmAsync(db, $"Cabinet Page {i:00}", "Sfax", "Sfax", $"{1000000 + i:0000000}/A/B/C/000");
        }

        var huge = await service.SearchDirectoryAsync(new AccountingFirmDirectoryQuery { PageSize = 500 }, CompanyId);
        Assert.True(huge.IsSuccess);
        Assert.Equal(50, huge.Value.Items.Count);
    }

    [Fact]
    public async Task Same_governorate_is_sorted_first()
    {
        await using var db = BuildMaster();
        await SeedCompanyAsync(db);
        await SeedFirmAsync(db, "Cabinet Sousse", "Sousse", "Sousse", "5555555/A/B/C/000");
        await SeedFirmAsync(db, "Cabinet Tunis", "Tunis", "Tunis", "6666666/A/B/C/000");

        var page = await BuildService(db).SearchDirectoryAsync(new AccountingFirmDirectoryQuery(), CompanyId);

        Assert.Equal("Cabinet Tunis", page.Value.Items[0].DisplayName);
        Assert.True(page.Value.Items[0].SameGovernorate);
        Assert.False(page.Value.Items[1].SameGovernorate);
    }

    [Fact]
    public async Task Active_current_assignment_exposes_firm_phone_history_does_not()
    {
        await using var db = BuildMaster();
        await SeedCompanyAsync(db);
        var firmId = await SeedFirmAsync(db, "Cabinet Actif", "Tunis", "Tunis", "7777777/A/B/C/000");
        var userId = Guid.Parse("33333333-3333-3333-3333-333333333333");

        var pending = FirmClientAssignment.Request(CompanyId, firmId, userId).Value;
        db.FirmClientAssignments.Add(pending);
        await db.SaveChangesAsync();

        var service = BuildService(db);
        var currentPending = await service.GetCompanyCurrentAssignmentAsync(CompanyId);
        Assert.NotNull(currentPending);
        Assert.Equal("Tunis", currentPending!.FirmCity);
        Assert.Null(currentPending.FirmContactPhone);
        Assert.Null(currentPending.FirmContactEmail);

        Assert.True(pending.Accept(userId).IsSuccess);
        await db.SaveChangesAsync();

        var currentActive = await service.GetCompanyCurrentAssignmentAsync(CompanyId);
        Assert.Equal("+21698111222", currentActive!.FirmContactPhone);
        Assert.Equal("contact@example.com", currentActive.FirmContactEmail);

        Assert.True(pending.RevokeByCompany(userId).IsSuccess);
        await db.SaveChangesAsync();

        var history = await service.GetCompanyAssignmentHistoryAsync(CompanyId);
        Assert.All(history, row =>
        {
            Assert.Null(row.FirmContactPhone);
            Assert.Null(row.FirmContactEmail);
        });

        var directory = await service.SearchDirectoryAsync(new AccountingFirmDirectoryQuery(), CompanyId);
        Assert.DoesNotContain("contact@example.com", System.Text.Json.JsonSerializer.Serialize(directory.Value.Items));
        Assert.DoesNotContain("98111222", System.Text.Json.JsonSerializer.Serialize(directory.Value.Items));
    }

    [Fact]
    public async Task Update_rejects_invalid_profile_and_keeps_previous_values()
    {
        await using var db = BuildMaster();
        var firmId = await SeedFirmAsync(db, "Cabinet Actif", "Tunis", "Tunis", "8888888/A/B/C/000");
        var service = BuildService(db);

        var result = await service.UpdateFirmProfileAsync(firmId, new UpdateAccountingFirmProfileDto
        {
            DisplayName = "Cabinet Actif",
            City = "Tunis",
            Governorate = "Paris",
            ContactEmail = "contact@example.com",
            ContactPhone = "98111222",
            IsPublicInDirectory = true
        });

        Assert.True(result.IsFailure);
        Assert.Equal("Tunis", (await db.AccountingFirmProfiles.SingleAsync()).Governorate);
    }
}
