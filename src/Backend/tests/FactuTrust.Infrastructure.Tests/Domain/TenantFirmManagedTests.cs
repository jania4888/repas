using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class TenantFirmManagedTests
{
    private static readonly Guid FirmId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static (NIF Nif, Address Address, Email Email, PhoneNumber Phone) ValidValueObjects()
    {
        return (
            NIF.Create("1234567/A/B/C/000").Value,
            Address.Create("1 rue Test", "Tunis", "Tunis").Value,
            Email.Create("client@example.com").Value,
            PhoneNumber.Create("70123456").Value);
    }

    [Fact]
    public void CreateFirmManaged_sets_managing_firm_and_company_kind()
    {
        var (nif, address, email, phone) = ValidValueObjects();

        var result = Tenant.CreateFirmManaged(
            FirmId, "Client Géré SARL", nif, address, email, phone, TaxRegime.RealRegime);

        Assert.True(result.IsSuccess);
        Assert.Equal(FirmId, result.Value.ManagedByFirmTenantId);
        Assert.True(result.Value.IsFirmManaged);
        Assert.Equal(TenantKind.Company, result.Value.Kind);
        Assert.True(result.Value.IsActive);
    }

    [Fact]
    public void CreateFirmManaged_allows_null_phone()
    {
        var (nif, address, email, _) = ValidValueObjects();

        var result = Tenant.CreateFirmManaged(
            FirmId, "Client Géré SARL", nif, address, email, null, TaxRegime.RealRegime);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.Phone);
        Assert.Equal(FirmId, result.Value.ManagedByFirmTenantId);
    }

    [Fact]
    public void CreateFirmManaged_rejects_empty_firm_id()
    {
        var (nif, address, email, phone) = ValidValueObjects();

        var result = Tenant.CreateFirmManaged(
            Guid.Empty, "Client Géré SARL", nif, address, email, phone, TaxRegime.RealRegime);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Create_leaves_managing_firm_null()
    {
        var (nif, address, email, phone) = ValidValueObjects();

        var result = Tenant.Create("Société Normale", nif, address, email, phone, TaxRegime.RealRegime);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.ManagedByFirmTenantId);
        Assert.False(result.Value.IsFirmManaged);
    }
}
