using System.Collections;
using System.Reflection;
using FactuTrust.API.Services.Background;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using Hangfire;
using Xunit;

namespace FactuTrust.API.Tests.Services;

/// <summary>
/// Studio IA — PR 4.2d : registre des jobs récurrents Hangfire. Réflexion sur le champ statique privé
/// <c>Jobs</c> (classe <see langword="internal"/>, visible via <c>InternalsVisibleTo</c>) : le 15ᵉ
/// descripteur est le job des workflows Studio — cron de 10 minutes partagé via
/// <see cref="StudioWorkflowResumeJob.StudioWorkflowResumeCron"/>, sans concurrence ni retry (attributs
/// lus sur la méthode <c>ExecuteAsync</c>).
/// </summary>
public sealed class HangfireRecurringJobsRegistrationTests
{
    private static List<object> JobDescriptors()
    {
        var field = typeof(HangfireRecurringJobsRegistrationService)
            .GetField("Jobs", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(field);
        return ((IEnumerable)field!.GetValue(null)!).Cast<object>().ToList();
    }

    private static string JobIdOf(object descriptor)
    {
        var property = descriptor.GetType().GetProperty("JobId");
        Assert.NotNull(property);
        return (string)property!.GetValue(descriptor)!;
    }

    [Fact]
    public void Registers_exactly_15_recurring_jobs()
        => Assert.Equal(15, JobDescriptors().Count);

    [Fact]
    public void Job_ids_are_unique()
    {
        var ids = JobDescriptors().Select(JobIdOf).ToList();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Studio_workflow_resume_job_is_registered_with_ten_minute_cron_and_no_retry()
    {
        Assert.Contains("studio-workflow-resume", JobDescriptors().Select(JobIdOf));

        // Le descripteur réutilise la constante publique du job : c'est elle qui fait foi pour le cron.
        Assert.Equal("*/10 * * * *", StudioWorkflowResumeJob.StudioWorkflowResumeCron);

        // Une seule exécution à la fois (D-14), aucun retry Hangfire : le prochain tick reprend.
        var execute = typeof(StudioWorkflowResumeJob).GetMethod(nameof(StudioWorkflowResumeJob.ExecuteAsync));
        Assert.NotNull(execute);
        // Hangfire n'expose pas le délai publiquement : on relit l'argument du constructeur
        // via CustomAttributeData (indépendant des champs privés du package).
        var disableData = CustomAttributeData.GetCustomAttributes(execute!)
            .FirstOrDefault(a => a.AttributeType == typeof(DisableConcurrentExecutionAttribute));
        Assert.NotNull(disableData);
        Assert.Equal(540, (int)disableData!.ConstructorArguments[0].Value!);
        var retry = execute.GetCustomAttribute<AutomaticRetryAttribute>();
        Assert.NotNull(retry);
        Assert.Equal(0, retry!.Attempts);
    }
}
