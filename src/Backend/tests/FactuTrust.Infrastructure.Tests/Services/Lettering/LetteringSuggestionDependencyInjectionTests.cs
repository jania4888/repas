using FactuTrust.Application;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Infrastructure.Services.Lettering;
using Hangfire;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Validators;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// Câblage de production (AddApplication + AddInfrastructure, comme Program.cs) : le service des
/// propositions de lettrage est enregistré « scoped » et se résout (patron
/// <c>BankStatementImportDependencyInjectionTests</c>).
/// </summary>
public sealed class LetteringSuggestionDependencyInjectionTests
{
    /// <summary>Câblage de production (AddApplication + AddInfrastructure), sans base réelle.</summary>
    private static ServiceCollection ProductionServices()
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
        services.AddSingleton(new Mock<ICurrentUser>().Object);
        var host = new Mock<Microsoft.Extensions.Hosting.IHostEnvironment>();
        host.SetupGet(h => h.ContentRootPath).Returns(AppContext.BaseDirectory);
        host.SetupGet(h => h.EnvironmentName).Returns("Development");
        services.AddSingleton(host.Object);
        services.AddSingleton(new Mock<FactuTrust.Infrastructure.MultiTenancy.ITenantDbContextFactory>().Object);

        return services;
    }

    [Fact]
    public async Task SuggestionService_IsRegisteredScoped_AndResolvesFromTheProductionWiring()
    {
        var services = ProductionServices();

        var descriptor = Assert.Single(services, d => d.ServiceType == typeof(ILetteringSuggestionService));
        Assert.Equal(ServiceLifetime.Scoped, descriptor.Lifetime);

        await using var provider = services.BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        Assert.IsType<LetteringSuggestionService>(scope.ServiceProvider.GetRequiredService<ILetteringSuggestionService>());
    }

    /// <summary>
    /// p3-12 : la sonde IAmbientTransactionState est la MÊME instance que TenantAmbientTransaction
    /// dans un scope. Sinon le handler de masse lirait une transaction toujours inactive.
    /// </summary>
    [Fact]
    public async Task AmbientTransactionState_IsTheScopedTenantAmbientTransaction()
    {
        await using var provider = ProductionServices().BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();

        var state = scope.ServiceProvider.GetRequiredService<IAmbientTransactionState>();
        var ambient = scope.ServiceProvider.GetRequiredService<FactuTrust.Infrastructure.MultiTenancy.TenantAmbientTransaction>();
        Assert.Same(ambient, state);
        Assert.False(state.IsActive);

        await using var other = provider.CreateAsyncScope();
        Assert.NotSame(state, other.ServiceProvider.GetRequiredService<IAmbientTransactionState>());
    }

    /// <summary>
    /// p3-12 : le validator de masse injecte IOptions&lt;AccountingSettings&gt; (risque du plan) ;
    /// AddValidatorsFromAssembly doit le résoudre, sinon le pipeline échouerait à l'exécution.
    /// </summary>
    [Fact]
    public async Task BulkLetterCommandValidator_ResolvesWithItsOptions()
    {
        await using var provider = ProductionServices().BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();

        var validators = scope.ServiceProvider.GetServices<FluentValidation.IValidator<BulkLetterCommand>>().ToList();
        Assert.IsType<BulkLetterCommandValidator>(Assert.Single(validators));
    }
}
