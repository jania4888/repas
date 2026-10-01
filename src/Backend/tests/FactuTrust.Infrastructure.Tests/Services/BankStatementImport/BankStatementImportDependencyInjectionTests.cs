using FactuTrust.Application;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Hangfire;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Câblage de production (AddApplication + AddInfrastructure, comme Program.cs) : les services de
/// l'import de relevés sont enregistrés SANS condition (ValidateOnBuild) et se résolvent ; la
/// tâche Hangfire est « scoped » pour que l'activateur la construise.
/// </summary>
public sealed class BankStatementImportDependencyInjectionTests
{
    [Fact]
    public async Task Services_are_registered_and_resolve_from_the_production_wiring()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:MasterConnection"] = "Server=(localdb)\\mssqllocaldb;Database=FactuTrust_DiProbe_Unused;Trusted_Connection=True;TrustServerCertificate=True;"
            })
            .Build();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddApplication();
        services.AddInfrastructure(configuration);
        services.AddHttpContextAccessor();
        services.AddSingleton(new Mock<IBackgroundJobClient>().Object);
        services.AddSingleton(new Mock<ITenantService>().Object);
        services.AddSingleton(new Mock<ICurrentUser>().Object); // fourni par l'API (Program.cs)
        // Persistance / hôte remplacés par des mocks loose (patron StudioWorkflowDependencyInjectionTests).
        var host = new Mock<Microsoft.Extensions.Hosting.IHostEnvironment>();
        host.SetupGet(h => h.ContentRootPath).Returns(AppContext.BaseDirectory);
        host.SetupGet(h => h.EnvironmentName).Returns("Development");
        services.AddSingleton(host.Object);
        services.AddSingleton(new Mock<FactuTrust.Infrastructure.MultiTenancy.ITenantDbContextFactory>().Object);
        services.AddSingleton(new Mock<ITenantUnitOfWork>().Object);
        services.AddSingleton(new Mock<FactuTrust.Application.Common.Interfaces.Repositories.IJournalEntryRepository>().Object);
        services.AddSingleton(new Mock<FactuTrust.Application.Common.Interfaces.Services.IAccountingPeriodService>().Object);
        services.AddSingleton(new Mock<FactuTrust.Application.Common.Interfaces.Services.IAuditService>().Object);

        var job = Assert.Single(services, d => d.ServiceType == typeof(BankStatementAiExtractionJob));
        Assert.Equal(ServiceLifetime.Scoped, job.Lifetime);

        await using var provider = services.BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        Assert.IsType<BankStatementImportService>(scope.ServiceProvider.GetRequiredService<IBankStatementImportService>());
        Assert.IsType<BankStatementPostingService>(scope.ServiceProvider.GetRequiredService<IBankStatementPostingService>());
        Assert.IsType<BankStatementAiExtraction>(scope.ServiceProvider.GetRequiredService<IBankStatementAiExtraction>());
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<BankStatementAiExtractionJob>());
        Assert.Same(BankStatementProfileRegistry.Default, scope.ServiceProvider.GetRequiredService<BankStatementProfileRegistry>());
    }
}
