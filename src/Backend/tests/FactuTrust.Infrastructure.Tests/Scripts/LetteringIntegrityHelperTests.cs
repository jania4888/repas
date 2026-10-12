using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Scripts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Scripts;

/// <summary>
/// Lot A (plan de refonte du lettrage, Annexe A §4.2) : <see cref="LetteringIntegrityHelper"/>
/// doit être fail-closed — un tenant injoignable (chaîne de connexion absente) ne doit jamais
/// être compté comme propre, et le rapport consolidé reflète cette règle. Les requêtes SQL brutes
/// (sys.indexes, détection d'anomalies) nécessitent un vrai SQL Server et sont donc hors de portée
/// de ce test InMemory : elles sont couvertes par le script jumeau et une vérification manuelle,
/// comme <c>InvoiceNumberIntegrityHelper</c> dont ce test reprend le modèle.
/// </summary>
public sealed class LetteringIntegrityHelperTests
{
    private static MasterDbContext NewMasterDb() =>
        new(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options);

    private static async Task<Guid> AddActiveTenantAsync(MasterDbContext db, string companyName)
    {
        var nif = NIF.Create("1234567/A/B/C/000").Value;
        var address = Address.Create("1 rue Test", "Tunis", "Tunis", postalCode: "1000").Value;
        var email = Email.Create("tenant@test.tn").Value;
        var phone = PhoneNumber.Create("20123456").Value;
        var tenant = Tenant.Create(companyName, nif, address, email, phone, TaxRegime.RealRegime).Value;
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    private static ServiceProvider BuildServices(MasterDbContext db, Mock<ITenantService> tenantServiceMock)
    {
        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(tenantServiceMock.Object);
        services.AddLogging(b => b.AddProvider(NullLoggerProvider.Instance));
        return services.BuildServiceProvider();
    }

    [Fact]
    public async Task ScanAllTenantsAsync_NoTenants_IsNotSafe()
    {
        // Fail-closed : zéro tenant scanné ne doit jamais se traduire par "sûr" (évite un
        // environnement mal configuré qui déclarerait les index déployables par erreur).
        using var db = NewMasterDb();
        var tenantService = new Mock<ITenantService>();
        using var services = BuildServices(db, tenantService);

        var report = await LetteringIntegrityHelper.ScanAllTenantsAsync(services);

        Assert.Equal(0, report.TotalTenants);
        Assert.False(report.IsUniqueIndexSafe);
        Assert.Empty(report.Tenants);
    }

    [Fact]
    public async Task ScanAllTenantsAsync_MissingConnectionString_IsUnreachable_AndNotSafe()
    {
        using var db = NewMasterDb();
        var tenantId = await AddActiveTenantAsync(db, "Ste Sans Connexion");

        var tenantService = new Mock<ITenantService>();
        tenantService
            .Setup(s => s.GetConnectionStringAsync(tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        using var services = BuildServices(db, tenantService);

        var report = await LetteringIntegrityHelper.ScanAllTenantsAsync(services);

        Assert.Equal(1, report.TotalTenants);
        Assert.Equal(0, report.CleanTenants);
        Assert.Equal(1, report.UnreachableTenants);
        Assert.False(report.IsUniqueIndexSafe);
        var tenantReport = Assert.Single(report.Tenants);
        Assert.Equal("Unreachable", tenantReport.Status);
        Assert.NotNull(tenantReport.Error);
    }

    [Fact]
    public async Task ScanAllTenantsAsync_UnreachableConnection_IsUnreachable_NotCountedClean()
    {
        // Chaîne de connexion syntaxiquement valide mais injoignable (hôte inexistant, port
        // fermé) : la connexion échoue à l'ouverture, le tenant doit rester "Unreachable" et
        // ne doit JAMAIS être compté comme propre, même sans aucune anomalie de données.
        using var db = NewMasterDb();
        var tenantId = await AddActiveTenantAsync(db, "Ste Injoignable");

        var tenantService = new Mock<ITenantService>();
        tenantService
            .Setup(s => s.GetConnectionStringAsync(tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync("Server=127.0.0.1,1;Database=DoesNotExist;Connection Timeout=1;TrustServerCertificate=True;");
        using var services = BuildServices(db, tenantService);

        var report = await LetteringIntegrityHelper.ScanAllTenantsAsync(services);

        Assert.Equal(1, report.TotalTenants);
        Assert.Equal(1, report.UnreachableTenants);
        Assert.Equal(0, report.CleanTenants);
        Assert.False(report.IsUniqueIndexSafe);
    }

    [Fact]
    public async Task ScanAllTenantsAsync_InactiveTenant_IsExcluded()
    {
        using var db = NewMasterDb();
        var tenantId = await AddActiveTenantAsync(db, "Ste Inactive");
        var tenant = await db.Tenants.SingleAsync(t => t.Id == tenantId);
        tenant.Deactivate();
        await db.SaveChangesAsync();

        var tenantService = new Mock<ITenantService>();
        using var services = BuildServices(db, tenantService);

        var report = await LetteringIntegrityHelper.ScanAllTenantsAsync(services);

        Assert.Equal(0, report.TotalTenants);
        Assert.Empty(report.Tenants);
    }
}
