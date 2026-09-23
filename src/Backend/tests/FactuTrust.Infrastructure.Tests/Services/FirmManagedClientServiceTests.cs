using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class FirmManagedClientServiceTests
{
    private static readonly Guid FirmId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid FirmUserId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new MasterDbContext(options);
    }

    private static async Task<Tenant> SeedFirmAsync(MasterDbContext db)
    {
        var nif = NIF.Create("7654321/A/B/C/000").Value;
        var address = Address.Create("2 avenue Cabinet", "Tunis", "Tunis").Value;
        var email = Email.Create("cabinet@example.com").Value;
        var phone = PhoneNumber.Create("71123456").Value;

        var firm = Tenant.CreateAccountingFirm("Cabinet Test", nif, address, email, phone).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(firm, FirmId);
        db.Tenants.Add(firm);
        await db.SaveChangesAsync();
        return firm;
    }

    private static CreateFirmManagedClientDto ValidDto() => new()
    {
        CompanyName = "Client Géré SARL",
        Nif = "1234567/A/B/C/000",
        LegalForm = TunisianLegalForm.Sarl,
        Street = "5 rue Client",
        City = "Sousse",
        Governorate = "Sousse",
        Email = "client@example.com",
        Phone = "73123456",
        TaxRegime = TaxRegime.RealRegime,
        FiscalYearStartMonth = 1,
        FiscalYearEndMonth = 12,
        AnnualFeeAmount = 2400m,
        BillingFrequency = BillingFrequency.Monthly
    };

    private static FirmManagedClientService BuildService(
        MasterDbContext db,
        Mock<ITenantService>? tenantService = null,
        Mock<IFirmGovernanceService>? governance = null)
    {
        if (tenantService is null)
        {
            tenantService = new Mock<ITenantService>();
            tenantService
                .Setup(s => s.CreateTenantDatabaseAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync("Server=test;Database=tenant;");
        }

        governance ??= new Mock<IFirmGovernanceService>();

        return new FirmManagedClientService(
            db,
            tenantService.Object,
            governance.Object,
            NullLogger<FirmManagedClientService>.Instance);
    }

    [Fact]
    public async Task Create_provisions_tenant_subscription_active_assignment_and_permanent_file()
    {
        await using var db = BuildMaster();
        await SeedFirmAsync(db);
        var tenantService = new Mock<ITenantService>();
        tenantService
            .Setup(s => s.CreateTenantDatabaseAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("Server=test;Database=tenant;");
        var service = BuildService(db, tenantService);

        var result = await service.CreateManagedClientAsync(FirmId, FirmUserId, ValidDto());

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);

        var tenant = await db.Tenants.SingleAsync(t => t.Id == result.Value.CompanyTenantId);
        Assert.Equal(TenantKind.Company, tenant.Kind);
        Assert.True(tenant.IsActive);
        Assert.Equal(FirmId, tenant.ManagedByFirmTenantId);

        tenantService.Verify(
            s => s.CreateTenantDatabaseAsync(tenant.Id, tenant.DatabaseName, null, It.IsAny<CancellationToken>()),
            Times.Once);

        var subscription = await db.Subscriptions.SingleAsync(s => s.TenantId == tenant.Id);
        Assert.NotNull(subscription);

        var assignment = await db.FirmClientAssignments.SingleAsync(a => a.CompanyTenantId == tenant.Id);
        Assert.Equal(FirmAssignmentStatus.Active, assignment.Status);
        Assert.Equal(FirmAssignmentOrigin.FirmCreated, assignment.Origin);
        Assert.Equal(FirmUserId, assignment.RequestedByUserId);
        Assert.Equal(FirmUserId, assignment.RespondedByUserId);

        var file = await db.PermanentFiles.SingleAsync(p => p.FirmClientAssignmentId == assignment.Id);
        Assert.Equal("Client Géré SARL", file.CompanyName);
        Assert.Equal("1234567A/B/C/000", file.Nif);
        Assert.Equal(TunisianLegalForm.Sarl, file.LegalForm);
        Assert.Equal("client@example.com", tenant.Email!.Value);
        Assert.Equal(1, file.FiscalYearStartMonth);
        Assert.Equal(12, file.FiscalYearEndMonth);
        Assert.Equal(2400m, file.AnnualFeeAmount);
        Assert.Equal(BillingFrequency.Monthly, file.BillingFrequency);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_without_email_provisions_dossier(string? email)
    {
        await using var db = BuildMaster();
        await SeedFirmAsync(db);
        var service = BuildService(db);
        var dto = ValidDto();
        dto = dto with { Email = email, CompanyName = "Sans Email " + (email ?? "null") };

        var result = await service.CreateManagedClientAsync(FirmId, FirmUserId, dto);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var tenant = await db.Tenants.SingleAsync(t => t.Id == result.Value.CompanyTenantId);
        Assert.Null(tenant.Email);
    }

    [Fact]
    public async Task Create_invalid_email_is_rejected_without_tenant()
    {
        await using var db = BuildMaster();
        await SeedFirmAsync(db);
        var service = BuildService(db);

        var result = await service.CreateManagedClientAsync(
            FirmId, FirmUserId, ValidDto() with { Email = "pas-un-email" });

        Assert.True(result.IsFailure);
        Assert.Contains("invalide", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(1, await db.Tenants.CountAsync());
    }

    [Fact]
    public async Task Create_rejects_duplicate_nif()
    {
        await using var db = BuildMaster();
        await SeedFirmAsync(db);
        var service = BuildService(db);

        var first = await service.CreateManagedClientAsync(FirmId, FirmUserId, ValidDto());
        Assert.True(first.IsSuccess);

        var duplicate = await service.CreateManagedClientAsync(
            FirmId, FirmUserId, ValidDto() with { CompanyName = "Autre Société" });

        Assert.True(duplicate.IsFailure);
        Assert.Contains("matricule fiscal", duplicate.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_rejects_when_home_tenant_is_not_an_accounting_firm()
    {
        await using var db = BuildMaster();

        var nif = NIF.Create("9999999/A/B/C/000").Value;
        var address = Address.Create("1 rue Société", "Tunis", "Tunis").Value;
        var email = Email.Create("societe@example.com").Value;
        var phone = PhoneNumber.Create("70123456").Value;
        var company = Tenant.Create("Société Simple", nif, address, email, phone, TaxRegime.RealRegime).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(company, FirmId);
        db.Tenants.Add(company);
        await db.SaveChangesAsync();

        var service = BuildService(db);

        var result = await service.CreateManagedClientAsync(FirmId, FirmUserId, ValidDto());

        Assert.True(result.IsFailure);
        Assert.Empty(await db.FirmClientAssignments.ToListAsync());
    }

    [Fact]
    public async Task Create_assigns_manager_via_governance_when_provided()
    {
        await using var db = BuildMaster();
        await SeedFirmAsync(db);
        var accountantId = Guid.NewGuid();
        var governance = new Mock<IFirmGovernanceService>();
        governance
            .Setup(g => g.AssignDossierManagerAsync(FirmId, FirmUserId, It.IsAny<AssignDossierManagerDto>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(FactuTrust.Domain.Common.Result.Success());

        var service = BuildService(db, governance: governance);

        var result = await service.CreateManagedClientAsync(
            FirmId, FirmUserId, ValidDto() with { AssignedAccountantUserId = accountantId });

        Assert.True(result.IsSuccess);
        governance.Verify(
            g => g.AssignDossierManagerAsync(
                FirmId,
                FirmUserId,
                It.Is<AssignDossierManagerDto>(d => d.AssignmentId == result.Value.AssignmentId && d.AccountantUserId == accountantId),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Create_rejects_invalid_fiscal_months()
    {
        await using var db = BuildMaster();
        await SeedFirmAsync(db);
        var service = BuildService(db);

        var result = await service.CreateManagedClientAsync(
            FirmId, FirmUserId, ValidDto() with { FiscalYearStartMonth = 0 });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Create_returns_failure_when_tenant_database_provisioning_throws()
    {
        await using var db = BuildMaster();
        await SeedFirmAsync(db);

        var tenantService = new Mock<ITenantService>();
        tenantService
            .Setup(s => s.CreateTenantDatabaseAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("SQL migrate failed"));

        var service = BuildService(db, tenantService);

        var result = await service.CreateManagedClientAsync(FirmId, FirmUserId, ValidDto());

        Assert.True(result.IsFailure);
        Assert.Contains("provisioning", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.FirmClientAssignments.ToListAsync());
        Assert.Empty(await db.PermanentFiles.ToListAsync());
        tenantService.Verify(
            s => s.TryDropDatabaseAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }
}
