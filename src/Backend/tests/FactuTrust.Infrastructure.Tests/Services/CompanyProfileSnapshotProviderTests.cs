using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class CompanyProfileSnapshotProviderTests
{
    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    private static async Task SeedCompanyTenantAsync(MasterDbContext db)
    {
        var nif = NIF.Create("1234567/A/B/C/000").Value;
        var address = Address.Create("12 rue Habib Bourguiba", "Tunis", "Tunis", postalCode: "1000").Value;
        var email = Email.Create("contact@hadad.tn").Value;
        var phone = PhoneNumber.Create("20123456").Value;
        var tenant = Tenant.Create("Société Hadad", nif, address, email, phone, TaxRegime.RealRegime).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(tenant, CompanyId);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task CaptureForCompanyTenantAsync_builds_snapshot_from_master_tenant()
    {
        await using var db = BuildMaster();
        await SeedCompanyTenantAsync(db);

        var tenantService = new Mock<ITenantService>();
        tenantService
            .Setup(t => t.GetConnectionStringAsync(CompanyId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        var provider = new CompanyProfileSnapshotProvider(db, tenantService.Object, NullLogger<CompanyProfileSnapshotProvider>.Instance);

        var snapshot = await provider.CaptureForCompanyTenantAsync(CompanyId);

        Assert.Equal("Société Hadad", snapshot.CompanyName);
        Assert.Equal("1234567A/B/C/000", snapshot.Nif);
        Assert.Equal((int)TaxRegime.RealRegime, snapshot.TaxRegime);
        Assert.Equal("12 rue Habib Bourguiba", snapshot.Street);
        Assert.Equal("Tunis", snapshot.City);
        Assert.Equal("contact@hadad.tn", snapshot.Email);
    }

    [Fact]
    public void Serialize_and_TryDeserialize_roundtrip()
    {
        var provider = new CompanyProfileSnapshotProvider(
            BuildMaster(),
            Mock.Of<ITenantService>(),
            NullLogger<CompanyProfileSnapshotProvider>.Instance);

        var original = new CompanyProfileSnapshotDto
        {
            SchemaVersion = 1,
            CapturedAtUtc = DateTime.UtcNow,
            CompanyName = "Ste Test",
            Nif = "1234567/A/B/C/000",
            TaxRegime = 0,
            Street = "Rue A",
            City = "Sfax",
            Governorate = "Sfax",
            Email = "a@b.tn"
        };

        var json = provider.Serialize(original);
        var restored = provider.TryDeserialize(json);

        Assert.NotNull(restored);
        Assert.Equal(original.CompanyName, restored!.CompanyName);
        Assert.Equal(original.Nif, restored.Nif);
        Assert.Equal(original.City, restored.City);
    }

    [Fact]
    public void TryDeserialize_returns_null_for_invalid_json()
    {
        var provider = new CompanyProfileSnapshotProvider(
            BuildMaster(),
            Mock.Of<ITenantService>(),
            NullLogger<CompanyProfileSnapshotProvider>.Instance);

        Assert.Null(provider.TryDeserialize("{not-json"));
    }
}
