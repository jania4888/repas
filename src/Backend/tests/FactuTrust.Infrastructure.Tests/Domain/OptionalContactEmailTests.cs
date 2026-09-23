using FactuTrust.Domain.Constants;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class OptionalContactEmailTests
{
    [Fact]
    public void Create_RejectsBlankEmail()
    {
        var result = Email.Create("  ");

        Assert.True(result.IsFailure);
        Assert.Equal("L'email est obligatoire", result.Error.Description);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void CreateOptional_Blank_IsAbsent(string? value)
    {
        var result = Email.CreateOptional(value);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value);
    }

    [Fact]
    public void CreateOptional_ValidEmail_IsNormalized()
    {
        var result = Email.CreateOptional("  Contact@Exemple.TN ");

        Assert.True(result.IsSuccess);
        Assert.Equal("contact@exemple.tn", result.Value!.Value);
    }

    [Fact]
    public void CreateOptional_InvalidEmail_Fails()
    {
        var result = Email.CreateOptional("pas-un-email");

        Assert.True(result.IsFailure);
        Assert.Equal("Format d'email invalide", result.Error.Description);
    }

    [Fact]
    public void Client_CanBeCreatedAndUpdatedWithoutEmail()
    {
        var first = Client.Create("Alpha", ClientType.Individual, SampleAddress(), email: null);
        var second = Client.Create("Beta", ClientType.Individual, SampleAddress(), email: null);

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        Assert.Null(first.Value.Email);
        Assert.Null(second.Value.Email);

        var email = Email.Create("a@b.tn").Value;
        first.Value.Update("Alpha", SampleAddress(), email, phone: null, contactPerson: null, notes: null);
        Assert.Equal("a@b.tn", first.Value.Email!.Value);

        first.Value.Update("Alpha", SampleAddress(), email: null, phone: null, contactPerson: null, notes: null);
        Assert.Null(first.Value.Email);
    }

    [Fact]
    public void Supplier_CanBeCreatedAndUpdatedWithoutEmail()
    {
        var supplier = Supplier.Create("Fournisseur", SupplierType.Individual, SampleAddress(), email: null);

        Assert.True(supplier.IsSuccess);
        Assert.Null(supplier.Value.Email);

        supplier.Value.Update("Fournisseur", SampleAddress(), email: null, phone: null, contactPerson: null, paymentTermDays: 30, notes: null);
        Assert.Null(supplier.Value.Email);
    }

    [Fact]
    public void Company_CanBeCreatedWithoutEmail_WhileUpdateStillRequiresOne()
    {
        var company = Company.Create("Société", SampleAddress(), SampleNif(), email: null);

        Assert.True(company.IsSuccess);
        Assert.Null(company.Value.Email);

        company.Value.Update("Société", SampleAddress(), Email.Create("societe@exemple.tn").Value);
        Assert.Equal("societe@exemple.tn", company.Value.Email!.Value);
    }

    [Fact]
    public void FirmManagedTenant_AllowsNullEmail_SelfRegistrationStillStoresOne()
    {
        var managed = Tenant.CreateFirmManaged(
            Guid.NewGuid(), "Dossier", SampleNif(), SampleAddress(), email: null, SamplePhone(), TaxRegime.RealRegime);

        Assert.True(managed.IsSuccess);
        Assert.Null(managed.Value.Email);
        Assert.True(managed.Value.IsFirmManaged);
        Assert.Equal(TenantProvisioningStatus.Ready, managed.Value.ProvisioningStatus);

        var registered = Tenant.Create("Société", SampleNif(), SampleAddress(), Email.Create("societe@exemple.tn").Value, SamplePhone(), TaxRegime.RealRegime);
        Assert.True(registered.IsSuccess);
        Assert.Equal("societe@exemple.tn", registered.Value.Email!.Value);
        Assert.Equal(TenantProvisioningStatus.Pending, registered.Value.ProvisioningStatus);

        var firm = Tenant.CreateAccountingFirm("Cabinet", SampleNif(), SampleAddress(), Email.Create("cabinet@exemple.tn").Value, SamplePhone());
        Assert.True(firm.IsSuccess);
        Assert.Equal("cabinet@exemple.tn", firm.Value.Email!.Value);
    }

    [Fact]
    public void PassengerClient_KeepsSentinelEmail()
    {
        var email = Email.Create(DefaultPassengerClient.Email);

        Assert.True(email.IsSuccess);
        Assert.Equal("passager@factutrust.local", email.Value.Value);
    }

    private static Address SampleAddress() => FactuTrust.Domain.ValueObjects.Address.Create("1 rue", "Tunis", "Tunis").Value;

    private static NIF SampleNif() => NIF.Create("1234567/A/B/C/000").Value;

    private static PhoneNumber SamplePhone() => PhoneNumber.Create("71123456").Value;
}
