using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;
using DomainEmail = FactuTrust.Domain.ValueObjects.Email;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// La reprise de provisionnement commence par <b>supprimer</b> une base. Ces tests cadrent la
/// seule question qui compte : dans quels cas exacts a-t-elle le droit de le faire.
/// </summary>
public sealed class TenantProvisioningRetryServiceTests
{
    [Fact]
    public async Task RetryAsync_unknown_tenant_returns_not_found()
    {
        var harness = new Harness();

        var result = await harness.Service.RetryAsync(Guid.NewGuid(), Guid.NewGuid());

        Assert.False(result.Success);
        Assert.Equal(TenantProvisioningRetryFailureKind.NotFound, result.FailureKind);
        harness.VerifyNothingDropped();
    }

    [Fact]
    public async Task RetryAsync_refuses_a_tenant_already_ready()
    {
        var harness = new Harness();
        var tenant = harness.SeedTenant(TenantProvisioningStatus.Ready);

        var result = await harness.Service.RetryAsync(tenant.Id, Guid.NewGuid());

        Assert.False(result.Success);
        Assert.Equal(TenantProvisioningRetryFailureKind.AlreadyReady, result.FailureKind);
        harness.VerifyNothingDropped();
    }

    /// <summary>
    /// Le cas destructeur. La phase 2 écrit la chaîne de connexion <b>puis</b> bascule le statut :
    /// mourir entre les deux laisse un dossier <c>Pending</c> dont la base est complète et peuplée.
    /// C'est exactement le cas que <c>OrphanTenantDatabaseCleanupJob</c> répare au lieu de
    /// détruire ; la reprise manuelle doit s'aligner.
    /// </summary>
    [Fact]
    public async Task RetryAsync_repairs_the_status_instead_of_dropping_a_provisioned_database()
    {
        var harness = new Harness();
        var tenant = harness.SeedTenant(TenantProvisioningStatus.Pending);
        harness.SeedConnectionStringFor(tenant.Id);

        var result = await harness.Service.RetryAsync(tenant.Id, Guid.NewGuid());

        Assert.True(result.Success);
        Assert.True(result.Repaired);
        harness.VerifyNothingDropped();
        harness.VerifyNothingCreated();
        Assert.Equal(TenantProvisioningStatus.Ready, harness.Reload(tenant.Id).ProvisioningStatus);
    }

    [Fact]
    public async Task RetryAsync_repairs_a_failed_tenant_whose_database_actually_exists()
    {
        var harness = new Harness();
        var tenant = harness.SeedTenant(TenantProvisioningStatus.Failed);
        harness.SeedConnectionStringFor(tenant.Id);

        var result = await harness.Service.RetryAsync(tenant.Id, Guid.NewGuid());

        Assert.True(result.Repaired);
        harness.VerifyNothingDropped();
    }

    /// <summary>
    /// Sans chaîne de connexion, la phase 2 n'est jamais allée à son terme : il n'existe au pire
    /// qu'une base à demi créée, sans données métier. La recréation est alors légitime.
    /// </summary>
    [Fact]
    public async Task RetryAsync_recreates_the_database_when_provisioning_never_completed()
    {
        var harness = new Harness();
        var tenant = harness.SeedTenant(TenantProvisioningStatus.Failed);

        var result = await harness.Service.RetryAsync(tenant.Id, Guid.NewGuid());

        Assert.True(result.Success);
        Assert.False(result.Repaired);
        harness.TenantService.Verify(
            s => s.TryDropDatabaseAsync(tenant.DatabaseName, It.IsAny<CancellationToken>()),
            Times.Once);
        harness.TenantService.Verify(
            s => s.CreateTenantDatabaseAsync(
                tenant.Id, tenant.DatabaseName, It.IsAny<string?>(), It.IsAny<CancellationToken>()),
            Times.Once);
        Assert.Equal(TenantProvisioningStatus.Ready, harness.Reload(tenant.Id).ProvisioningStatus);
    }

    [Fact]
    public async Task RetryAsync_routes_an_accounting_firm_to_its_own_provisioning()
    {
        var harness = new Harness();
        var tenant = harness.SeedTenant(TenantProvisioningStatus.Failed, TenantKind.AccountingFirm);

        await harness.Service.RetryAsync(tenant.Id, Guid.NewGuid());

        harness.TenantService.Verify(
            s => s.CreateAccountingFirmDatabaseAsync(tenant.Id, tenant.DatabaseName, It.IsAny<CancellationToken>()),
            Times.Once);
        harness.TenantService.Verify(
            s => s.CreateTenantDatabaseAsync(
                It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task RetryAsync_marks_the_tenant_failed_when_provisioning_throws_again()
    {
        var harness = new Harness();
        var tenant = harness.SeedTenant(TenantProvisioningStatus.Pending);
        harness.TenantService
            .Setup(s => s.CreateTenantDatabaseAsync(
                It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("SQL indisponible"));

        var result = await harness.Service.RetryAsync(tenant.Id, Guid.NewGuid());

        Assert.False(result.Success);
        Assert.Equal(TenantProvisioningRetryFailureKind.ProvisioningFailed, result.FailureKind);
        // Le message technique ne doit jamais atteindre l'opérateur ; la référence, si.
        Assert.DoesNotContain("SQL indisponible", result.ErrorMessage);
        Assert.False(string.IsNullOrWhiteSpace(result.CorrelationId));
        Assert.Equal(TenantProvisioningStatus.Failed, harness.Reload(tenant.Id).ProvisioningStatus);
    }

    private sealed class Harness
    {
        public Harness()
        {
            var options = new DbContextOptionsBuilder<MasterDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            Db = new MasterDbContext(options);

            TenantService = new Mock<ITenantService>();
            TenantService
                .Setup(s => s.CreateTenantDatabaseAsync(
                    It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync("Server=test;Database=test;");

            Service = new TenantProvisioningRetryService(
                Db,
                TenantService.Object,
                NullLogger<TenantProvisioningRetryService>.Instance);
        }

        public MasterDbContext Db { get; }
        public Mock<ITenantService> TenantService { get; }
        public TenantProvisioningRetryService Service { get; }

        public Tenant SeedTenant(TenantProvisioningStatus status, TenantKind kind = TenantKind.Company)
        {
            // `Kind` est en lecture seule : on passe par la fabrique correspondante.
            var tenant = kind == TenantKind.AccountingFirm
                ? Tenant.CreateAccountingFirm(
                    "Cabinet Test",
                    NIF.Create("7654321/A/B/C/000").Value,
                    Address.Create("1 rue", "Tunis", "Tunis").Value,
                    DomainEmail.Create("contact@cabinet.test").Value,
                    PhoneNumber.Create("71123456").Value).Value
                : Tenant.Create(
                    "Société Test",
                    NIF.Create("1234567/A/B/C/000").Value,
                    Address.Create("1 rue", "Tunis", "Tunis").Value,
                    DomainEmail.Create("contact@societe.test").Value,
                    PhoneNumber.Create("71123456").Value,
                    TaxRegime.RealRegime).Value;

            switch (status)
            {
                case TenantProvisioningStatus.Ready:
                    tenant.MarkProvisioningReady();
                    break;
                case TenantProvisioningStatus.Failed:
                    tenant.MarkProvisioningFailed();
                    break;
            }

            Db.Tenants.Add(tenant);
            Db.SaveChanges();
            return tenant;
        }

        public void SeedConnectionStringFor(Guid tenantId)
        {
            Db.TenantConnectionStrings.Add(new TenantConnectionString
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                EncryptedConnectionString = "chiffré"
            });
            Db.SaveChanges();
        }

        public Tenant Reload(Guid tenantId) => Db.Tenants.AsNoTracking().Single(t => t.Id == tenantId);

        public void VerifyNothingDropped() =>
            TenantService.Verify(
                s => s.TryDropDatabaseAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
                Times.Never);

        public void VerifyNothingCreated()
        {
            TenantService.Verify(
                s => s.CreateTenantDatabaseAsync(
                    It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()),
                Times.Never);
            TenantService.Verify(
                s => s.CreateAccountingFirmDatabaseAsync(
                    It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
                Times.Never);
        }
    }
}
