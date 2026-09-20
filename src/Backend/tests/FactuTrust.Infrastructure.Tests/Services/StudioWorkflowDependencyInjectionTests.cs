using FactuTrust.Application;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Infrastructure;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using MediatR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// PR 4.1h — garde DI des workflows Studio : les 7 handlers d'étapes sont enregistrés dans le
/// conteneur de production (<c>FactuTrust.Infrastructure.DependencyInjection.AddInfrastructure</c>)
/// avec des <see cref="IStudioWorkflowStepHandler.StepType"/> distincts correspondant exactement à
/// <see cref="StudioWorkflowStepTypes.All"/>. Patron repris de
/// <c>AccountingNonRegressionTests.BuildAccountingHandlersProvider</c> : vraies extensions de
/// production (<c>AddApplication</c> + <c>AddInfrastructure</c>, comme Program.cs), dépendances de
/// persistance/services remplacées par des mocks loose pour ne pas exiger un vrai SQL Server.
/// </summary>
public sealed class StudioWorkflowDependencyInjectionTests
{
    [Fact]
    public void Seven_step_handlers_are_registered_with_distinct_step_types()
    {
        var services = BuildProductionServices();
        using var provider = services.BuildServiceProvider();

        var handlers = provider.GetServices<IStudioWorkflowStepHandler>().ToList();

        Assert.Equal(7, handlers.Count);
        Assert.Equal(
            StudioWorkflowStepTypes.All.OrderBy(t => t, StringComparer.Ordinal),
            handlers.Select(h => h.StepType).OrderBy(t => t, StringComparer.Ordinal));
    }

    /// <summary>
    /// 4.7★3 (D-47-79, S16) : le job des déclencheurs planifiés est enregistré (scoped, comme le job
    /// de reprise) et se résout depuis un scope du conteneur de production — l'activateur Hangfire
    /// n'a plus à le construire implicitement. <c>ITenantService</c> est remplacé par un mock loose
    /// (il dépend d'un DbContext) ; le reste du graphe est le câblage réel.
    /// </summary>
    [Fact]
    public void Scheduled_and_resume_jobs_are_registered_scoped_and_the_scheduled_job_resolves()
    {
        var services = BuildProductionServices();
        RegisterLooseMock<ITenantService>(services);

        foreach (var jobType in new[] { typeof(StudioWorkflowScheduledJob), typeof(StudioWorkflowResumeJob) })
        {
            var descriptor = Assert.Single(services, d => d.ServiceType == jobType);
            Assert.Equal(ServiceLifetime.Scoped, descriptor.Lifetime);
            Assert.Equal(jobType, descriptor.ImplementationType);
        }

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        Assert.NotNull(scope.ServiceProvider.GetRequiredService<StudioWorkflowScheduledJob>());
    }

    /// <summary>Câblage de production (Program.cs) + mocks loose des dépendances de persistance/services.</summary>
    private static ServiceCollection BuildProductionServices()
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

        // Câblage de production réel (Program.cs) — voir doc de classe ci-dessus.
        services.AddApplication();
        services.AddInfrastructure(configuration);

        // Dépendances des 7 constructeurs de handlers remplacées (la dernière inscription l'emporte
        // pour une résolution simple) — aucun DbContext n'est construit ici.
        RegisterLooseMock<INotificationService>(services);
        RegisterLooseMock<IStudioWorkflowRepository>(services);
        RegisterLooseMock<ICustomEntityRepository>(services);
        RegisterLooseMock<ICustomFieldRepository>(services);
        RegisterLooseMock<ICustomRecordRepository>(services);
        RegisterLooseMock<IStudioQuotaService>(services);
        RegisterLooseMock<IStudioComputedFieldWriter>(services);
        RegisterLooseMock<ICustomAutomationRepository>(services);
        RegisterLooseMock<IAiToolExecutor>(services);
        RegisterLooseMock<IPublisher>(services);
        return services;
    }

    private static void RegisterLooseMock<T>(IServiceCollection services) where T : class
        => services.AddSingleton(new Mock<T>().Object);
}
