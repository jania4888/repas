using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using Hangfire;
using Hangfire.Common;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — 4.7b2 / D-47-B03 : <see cref="StudioWorkflowScheduleService"/> (IRecurringJobManager mocké,
/// aucun stockage). AddOrUpdate (actif + planifié, cron relu et normalisé, UTC, identifiant contractuel),
/// RemoveIfExists (inactif / non planifié / cron illisible / suppression), erreurs Hangfire absorbées.
/// </summary>
public sealed class StudioWorkflowScheduleServiceTests
{
    private static readonly Guid Tid = Guid.NewGuid();

    private readonly Mock<IRecurringJobManager> _recurring = new(MockBehavior.Strict);
    private readonly StudioWorkflowScheduleService _service;

    public StudioWorkflowScheduleServiceTests()
        => _service = new StudioWorkflowScheduleService(_recurring.Object, NullLogger<StudioWorkflowScheduleService>.Instance);

    private static StudioWorkflowDefinition Definition(
        StudioWorkflowTriggerKind trigger = StudioWorkflowTriggerKind.Scheduled,
        bool isActive = true,
        string triggerConfig = """{ "cron": "0 6 * * 1" }""")
        => StudioWorkflowDefinition.Create(
            Tid, Guid.NewGuid(), "relance", "Relance", null, trigger, triggerConfig,
            """{ "version": 1, "steps": [ { "key": "a", "type": "notify", "to": { "kind": "startedBy" }, "title": "x" } ] }""",
            isActive, Guid.NewGuid());

    private static string JobIdOf(StudioWorkflowDefinition def) => StudioWorkflowScheduleService.JobId(Tid, def.Id);

    [Fact]
    public async Task Sync_registers_the_job_for_an_active_scheduled_definition()
    {
        var def = Definition(triggerConfig: """{ "cron": "  0  6 * * 1 " }""");
        _recurring.Setup(r => r.AddOrUpdate(It.IsAny<string>(), It.IsAny<Job>(), It.IsAny<string>(), It.IsAny<RecurringJobOptions>()));

        await _service.SyncDefinitionAsync(def, CancellationToken.None);

        // Identifiant contractuel + cron relu de TriggerConfigJson et NORMALISÉ + fuseau UTC + args (tenant, définition).
        _recurring.Verify(r => r.AddOrUpdate(
            $"studio-workflow-scheduled:{Tid:N}:{def.Id:N}",
            It.Is<Job>(j => j.Type == typeof(StudioWorkflowScheduledJob)
                && j.Args.Count == 3 && Equals(j.Args[0], Tid) && Equals(j.Args[1], def.Id)),
            "0 6 * * 1",
            It.Is<RecurringJobOptions>(o => o.TimeZone == TimeZoneInfo.Utc)), Times.Once);
        _recurring.Verify(r => r.RemoveIfExists(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Sync_removes_the_job_for_an_inactive_or_deleted_definition()
    {
        var inactive = Definition(isActive: false);
        _recurring.Setup(r => r.RemoveIfExists(It.IsAny<string>()));

        await _service.SyncDefinitionAsync(inactive, CancellationToken.None);

        _recurring.Verify(r => r.RemoveIfExists(JobIdOf(inactive)), Times.Once);
        _recurring.Verify(r => r.AddOrUpdate(It.IsAny<string>(), It.IsAny<Job>(), It.IsAny<string>(), It.IsAny<RecurringJobOptions>()), Times.Never);

        var deleted = Definition();
        deleted.SoftDelete(null);
        await _service.SyncDefinitionAsync(deleted, CancellationToken.None);
        _recurring.Verify(r => r.RemoveIfExists(JobIdOf(deleted)), Times.Once);
    }

    [Fact]
    public async Task Sync_removes_the_job_for_a_non_scheduled_trigger()
    {
        var manual = Definition(trigger: StudioWorkflowTriggerKind.Manual, triggerConfig: "{}");
        _recurring.Setup(r => r.RemoveIfExists(It.IsAny<string>()));

        await _service.SyncDefinitionAsync(manual, CancellationToken.None);

        _recurring.Verify(r => r.RemoveIfExists(JobIdOf(manual)), Times.Once);
        _recurring.Verify(r => r.AddOrUpdate(It.IsAny<string>(), It.IsAny<Job>(), It.IsAny<string>(), It.IsAny<RecurringJobOptions>()), Times.Never);
    }

    [Fact]
    public async Task Sync_removes_the_job_without_throwing_when_the_cron_is_unreadable()
    {
        _recurring.Setup(r => r.RemoveIfExists(It.IsAny<string>()));

        // cron absent du JSON.
        await _service.SyncDefinitionAsync(Definition(triggerConfig: "{}"), CancellationToken.None);
        // JSON illisible.
        await _service.SyncDefinitionAsync(Definition(triggerConfig: "pas du json"), CancellationToken.None);
        // cron invalide (défense en profondeur : la validation 4.7b1 rejette ce cas à l'écriture).
        var invalid = Definition(triggerConfig: """{ "cron": "chaque jour" }""");
        await _service.SyncDefinitionAsync(invalid, CancellationToken.None);

        _recurring.Verify(r => r.RemoveIfExists(JobIdOf(invalid)), Times.Once);
        _recurring.Verify(r => r.RemoveIfExists(It.IsAny<string>()), Times.Exactly(3));
        _recurring.Verify(r => r.AddOrUpdate(It.IsAny<string>(), It.IsAny<Job>(), It.IsAny<string>(), It.IsAny<RecurringJobOptions>()), Times.Never);
    }

    [Fact]
    public async Task Sync_swallows_a_hangfire_failure_best_effort()
    {
        var def = Definition();
        _recurring.Setup(r => r.AddOrUpdate(It.IsAny<string>(), It.IsAny<Job>(), It.IsAny<string>(), It.IsAny<RecurringJobOptions>()))
            .Throws(new InvalidOperationException("stockage Hangfire indisponible"));

        // L'écriture métier n'est jamais cassée par l'ordonnanceur (D-47-B03).
        await _service.SyncDefinitionAsync(def, CancellationToken.None);
    }

    [Fact]
    public async Task RemoveDefinition_removes_the_job_id_and_swallows_failures()
    {
        var definitionId = Guid.NewGuid();
        _recurring.Setup(r => r.RemoveIfExists(It.IsAny<string>()));

        await _service.RemoveDefinitionAsync(Tid, definitionId, CancellationToken.None);
        _recurring.Verify(r => r.RemoveIfExists($"studio-workflow-scheduled:{Tid:N}:{definitionId:N}"), Times.Once);

        // Une erreur de retrait est absorbée (le job s'auto-retirera à son prochain tick).
        _recurring.Setup(r => r.RemoveIfExists(It.IsAny<string>())).Throws(new InvalidOperationException("boom"));
        await _service.RemoveDefinitionAsync(Tid, definitionId, CancellationToken.None);
    }
}
