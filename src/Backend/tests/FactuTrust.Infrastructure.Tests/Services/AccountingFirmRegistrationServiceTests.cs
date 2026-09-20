using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class AccountingFirmRegistrationServiceTests
{
    [Fact]
    public async Task RegisterAsync_duplicate_email_returns_before_tenant_provision()
    {
        var existing = new ApplicationUser { Id = Guid.NewGuid(), Email = "dup@example.com", UserName = "dup@example.com" };
        var userManager = BuildUserManager(existing);
        var tenantService = new Mock<ITenantService>();

        await using var db = BuildMasterDb();
        var service = new AccountingFirmRegistrationService(
            userManager.Object,
            db,
            tenantService.Object,
            Mock.Of<ITenantAuthTokenService>(),
            Mock.Of<ISubscriptionAdminService>(),
            Mock.Of<ILogger<AccountingFirmRegistrationService>>());

        var dto = ValidDto() with { Email = "dup@example.com" };
        var result = await service.RegisterAsync(dto, AccountingFirmRegistrationContext.Public());

        Assert.False(result.Success);
        Assert.Equal(AccountingFirmRegistrationFailureKind.DuplicateEmail, result.FailureKind);
        tenantService.Verify(
            s => s.CreateAccountingFirmDatabaseAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task RegisterAsync_invalid_nif_returns_validation_failure()
    {
        var userManager = BuildUserManager(null);
        var tenantService = new Mock<ITenantService>();
        await using var db = BuildMasterDb();
        var service = new AccountingFirmRegistrationService(
            userManager.Object,
            db,
            tenantService.Object,
            Mock.Of<ITenantAuthTokenService>(),
            Mock.Of<ISubscriptionAdminService>(),
            Mock.Of<ILogger<AccountingFirmRegistrationService>>());

        var dto = ValidDto() with { Nif = "invalid" };
        var result = await service.RegisterAsync(dto, AccountingFirmRegistrationContext.Public());

        Assert.False(result.Success);
        Assert.Equal(AccountingFirmRegistrationFailureKind.Validation, result.FailureKind);
        tenantService.Verify(
            s => s.CreateAccountingFirmDatabaseAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    private static RegisterAccountingFirmDto ValidDto() => new()
    {
        Email = "manager@cabinet.test",
        Password = "SecurePass123!",
        ConfirmPassword = "SecurePass123!",
        FirstName = "Jean",
        LastName = "Dupont",
        FirmName = "Cabinet Test",
        Nif = "7654321/A/B/C/000",
        Street = "1 rue Test",
        City = "Tunis",
        PostalCode = "1000",
        Governorate = "Tunis",
        FirmEmail = "contact@cabinet.test",
        Phone = "71123456",
        IsPublicInDirectory = true
    };

    private static MasterDbContext BuildMasterDb()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    private static Mock<UserManager<ApplicationUser>> BuildUserManager(ApplicationUser? existing)
    {
        var store = new Mock<IUserStore<ApplicationUser>>();
        var userManager = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        userManager.Setup(m => m.FindByEmailAsync(It.IsAny<string>()))
            .ReturnsAsync(existing);
        return userManager;
    }
}
