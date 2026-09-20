using System.Reflection;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Hangfire;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 4.7b3 : <see cref="StudioWorkflowScheduledJob"/>. Le balayage est testé via
/// <c>FireInScopeAsync</c> sur une <see cref="ServiceCollection"/> réelle peuplée de mocks stricts
/// (motif <c>StudioWorkflowResumeJobTests</c>) ; l'enveloppe <c>FireAsync</c> est testée avec un
/// <see cref="ITenantService"/> mocké. Aucun SQL réel : <see cref="ICustomRecordRepository.QueryAsync"/>
/// est mockée et le <see cref="RecordQuerySpec"/> reçu est capturé pour assertions.
/// </summary>
public sealed class StudioWorkflowScheduledJobTests
{
    private static readonly Guid TenantId = Guid.Parse("ffffffff-0000-0000-0000-000000000001");
    private static readonly Guid EntityId = Guid.Parse("ffffffff-0000-0000-0000-000000000002");
    private static readonly Guid DefinitionId = Guid.Parse("ffffffff-0000-0000-0000-000000000003");

    private const string TriggerConfig =
        """{"cron":"0 6 * * *","filters":[{"field":"status","op":"eq","value":"active"}]}""";

    private readonly Mock<IStudioWorkflowRepository> _workflows = new(MockBehavior.Strict);
    private readonly Mock<ICustomFieldRepository> _fields = new(MockBehavior.Strict);
    private readonly Mock<ICustomRecordRepository> _records = new(MockBehavior.Strict);
    private readonly Mock<IStudioWorkflowEngine> _engine = new(MockBehavior.Strict);
    private readonly Mock<IStudioQuotaService> _quota = new(MockBehavior.Strict);
    private readonly Mock<IStudioWorkflowScheduleService> _schedule = new(MockBehavior.Strict);
    private readonly Mock<ITenantContext> _tenantContext = new(MockBehavior.Strict);
    private readonly Mock<ITenantService> _tenantService = new(MockBehavior.Strict);
    private readonly OllamaSettings _settings = new() { EnableStudioWorkflows = true };
    private readonly ListLogger<StudioWorkflowScheduledJob> _logger = new();

    /// <summary>Capteur de logs minimal (aucun contenu d'enregistrement n'y transite par construction).</summary>
    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
            => Entries.Add((logLevel, formatter(state, exception)));
    }

    private static StudioWorkflowDefinition NewDefinition(
        bool isActive = true,
        StudioWorkflowTriggerKind trigger = StudioWorkflowTriggerKind.Scheduled,
        string triggerConfig = TriggerConfig)
        => StudioWorkflowDefinition.Create(
            TenantId, EntityId, "relance", "Relance client", null, trigger, triggerConfig, "[]", isActive, null);

    private static CustomRecord NewRecord()
        => CustomRecord.Create(TenantId, EntityId, "{}", null);

    private static CustomFieldDefinition TextField(string key)
        => CustomFieldDefinition.Create(
            TenantId, EntityId, key, key, CustomFieldType.Text, false, false, 0, null, null, null, null);

    private (StudioWorkflowScheduledJob Job, ServiceProvider Provider) NewJob()
    {
        var services = new ServiceCollection();
        services.AddSingleton(_tenantContext.Object);
        services.AddSingleton(_workflows.Object);
        services.AddSingleton(_fields.Object);
        services.AddSingleton(_records.Object);
        services.AddSingleton(_engine.Object);
        services.AddSingleton(_quota.Object);
        services.AddSingleton(_schedule.Object);
        var provider = services.BuildServiceProvider();
        return (new StudioWorkflowScheduledJob(
            _tenantService.Object, provider.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(_settings), _logger), provider);
    }

    /// <summary>Lecture de la définition + champs actifs, puis requête vide : le plancher d'un tick sain.</summary>
    private void SetupEmptySweep(StudioWorkflowDefinition definition)
    {
        _workflows.Setup(w => w.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        _fields.Setup(f => f.ListByEntityAsync(TenantId, EntityId, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { TextField("status") });
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Array.Empty<CustomRecord>(), 0));
    }

    /// <summary>Garde-fous par enregistrement : pas de doublon ouvert, quota levé, démarrage système.</summary>
    private void SetupRecordStarted(StudioWorkflowDefinition definition, CustomRecord record, int openInstances = 0)
    {
        _workflows.Setup(w => w.HasOpenInstanceInChainAsync(
                TenantId, definition.Id, record.Id, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _workflows.Setup(w => w.CountInstancesForRecordAsync(TenantId, record.Id, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(openInstances);
        _quota.Setup(q => q.EnsureUnderLimitAsync(
                TenantId, StudioQuotas.MaxWorkflowInstancesPerRecordKey, openInstances,
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback,
                It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _engine.Setup(e => e.StartAsync(
                definition, record.Id, StudioWorkflowTriggerKind.Scheduled,
                null, null, null, 0, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => StudioWorkflowInstance.Start(
                TenantId, definition, record.Id, StudioWorkflowTriggerKind.Scheduled, null, "{}", 0, null));
    }

    /// <summary>4.7★2 (S5) : les attributs Hangfire sont sur la MÉTHODE <c>FireAsync</c> — un tick à la fois par
    /// (type, méthode, args) pendant 540 s, aucun retry automatique (le prochain tick reprend) ; motif du job de reprise.</summary>
    [Fact]
    public void Fire_is_decorated_with_disable_concurrent_execution_540s_and_no_retry()
    {
        var fire = typeof(StudioWorkflowScheduledJob).GetMethod(nameof(StudioWorkflowScheduledJob.FireAsync));
        Assert.NotNull(fire);

        // Hangfire n'expose pas le délai publiquement : on relit l'argument du constructeur via CustomAttributeData.
        var disableData = CustomAttributeData.GetCustomAttributes(fire!)
            .SingleOrDefault(a => a.AttributeType == typeof(DisableConcurrentExecutionAttribute));
        Assert.NotNull(disableData);
        Assert.Equal(540, (int)disableData!.ConstructorArguments[0].Value!);

        var retry = fire.GetCustomAttribute<AutomaticRetryAttribute>();
        Assert.NotNull(retry);
        Assert.Equal(0, retry!.Attempts);

        // Le tick attend un identifiant de tenant et de définition (l'id de job les porte : {tenantId:N}:{definitionId:N}).
        Assert.Equal(new[] { typeof(Guid), typeof(Guid), typeof(CancellationToken) }, fire.GetParameters().Select(p => p.ParameterType).ToArray());
    }

    [Fact]
    public async Task Fire_does_nothing_when_the_studio_workflows_flag_is_off()
    {
        _settings.EnableStudioWorkflows = false;
        var (job, _) = NewJob();

        await job.FireAsync(TenantId, DefinitionId, CancellationToken.None);
        // Mocks stricts : aucune dépendance n'a été touchée.
    }

    [Fact]
    public async Task Fire_skips_the_tick_when_the_tenant_has_no_connection_string()
    {
        _tenantService.Setup(t => t.GetConnectionStringAsync(TenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        var (job, _) = NewJob();

        await job.FireAsync(TenantId, DefinitionId, CancellationToken.None);

        Assert.Contains(_logger.Entries, e => e.Level == LogLevel.Warning);
    }

    [Fact]
    public async Task Tick_starts_one_system_instance_per_matching_record()
    {
        var definition = NewDefinition();
        var first = NewRecord();
        var second = NewRecord();
        SetupEmptySweep(definition);
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((new CustomRecord[] { first, second }, 2));
        SetupRecordStarted(definition, first);
        SetupRecordStarted(definition, second);
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(new StudioWorkflowScheduledJob.StudioWorkflowScheduledReport(2, 2, 0, 0), report);
        _engine.Verify(e => e.StartAsync(
            definition, It.IsAny<Guid>(), StudioWorkflowTriggerKind.Scheduled,
            null, null, null, 0, null, It.IsAny<CancellationToken>()), Times.Exactly(2));
        _schedule.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Tick_passes_the_parsed_filters_and_the_clamped_batch_to_the_query()
    {
        var definition = NewDefinition(triggerConfig:
            """{"cron":"0 6 * * *","filters":[{"field":"due","op":"between","value":"2026-01-01","value2":"2026-12-31"}]}""");
        _settings.StudioWorkflowScheduledBatchSize = 5; // sous le plancher : clampé à 10
        SetupEmptySweep(definition);
        RecordQuerySpec? captured = null;
        IReadOnlyDictionary<string, CustomFieldType>? capturedTypes = null;
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .Callback<RecordQuerySpec, IReadOnlyDictionary<string, CustomFieldType>, CancellationToken>(
                (spec, types, _) => { captured = spec; capturedTypes = types; })
            .ReturnsAsync((Array.Empty<CustomRecord>(), 0));
        var (job, provider) = NewJob();

        await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.NotNull(captured);
        Assert.Equal(TenantId, captured!.TenantId);
        Assert.Equal(EntityId, captured.EntityDefinitionId);
        Assert.Equal(0, captured.Skip);
        Assert.Equal(10, captured.Take);
        var filter = Assert.Single(captured.Filters);
        Assert.Equal("due", filter.FieldKey);
        Assert.Equal("between", filter.Op);
        Assert.Equal("""["2026-01-01","2026-12-31"]""", filter.Value?.ToJsonString());
        Assert.NotNull(capturedTypes);
        Assert.Equal(CustomFieldType.Text, capturedTypes!["status"]);
    }

    [Fact]
    public async Task Tick_skips_a_record_with_an_open_instance_in_the_chain()
    {
        var definition = NewDefinition();
        var blocked = NewRecord();
        var free = NewRecord();
        SetupEmptySweep(definition);
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((new CustomRecord[] { blocked, free }, 2));
        _workflows.Setup(w => w.HasOpenInstanceInChainAsync(
                TenantId, definition.Id, blocked.Id, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        // Anti-doublon d'abord : ni quota ni démarrage pour l'enregistrement bloqué (mocks stricts).
        SetupRecordStarted(definition, free);
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(new StudioWorkflowScheduledJob.StudioWorkflowScheduledReport(2, 1, 1, 0), report);
    }

    [Fact]
    public async Task Tick_restarts_a_record_whose_open_instances_belong_to_other_workflows()
    {
        // D-47-B04 : seule une instance OUVERTE de la même chaîne bloque ; une instance terminée
        // (ou d'un autre workflow) laisse l'enregistrement éligible au prochain tick.
        var definition = NewDefinition();
        var record = NewRecord();
        SetupEmptySweep(definition);
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((new CustomRecord[] { record }, 1));
        SetupRecordStarted(definition, record, openInstances: 1);
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(1, report.Started);
        _engine.Verify(e => e.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.Scheduled,
            null, null, null, 0, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Tick_skips_a_record_when_the_per_record_quota_is_reached()
    {
        var definition = NewDefinition();
        var record = NewRecord();
        SetupEmptySweep(definition);
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((new CustomRecord[] { record }, 1));
        _workflows.Setup(w => w.HasOpenInstanceInChainAsync(
                TenantId, definition.Id, record.Id, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _workflows.Setup(w => w.CountInstancesForRecordAsync(TenantId, record.Id, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StudioQuotas.MaxWorkflowInstancesPerRecordFallback);
        _quota.Setup(q => q.EnsureUnderLimitAsync(
                TenantId, StudioQuotas.MaxWorkflowInstancesPerRecordKey,
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback,
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback,
                It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure(new Error("quota", "limite atteinte")));
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(new StudioWorkflowScheduledJob.StudioWorkflowScheduledReport(1, 0, 1, 0), report);
        _engine.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Tick_removes_the_job_and_starts_nothing_when_the_definition_is_inactive()
    {
        var definition = NewDefinition(isActive: false);
        _workflows.Setup(w => w.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        _schedule.Setup(s => s.RemoveDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(new StudioWorkflowScheduledJob.StudioWorkflowScheduledReport(0, 0, 0, 0), report);
        _schedule.Verify(s => s.RemoveDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()), Times.Once);
        _engine.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Tick_removes_the_job_when_the_definition_was_deleted_or_retyped()
    {
        var deleted = NewDefinition();
        _workflows.Setup(w => w.GetDefinitionAsync(TenantId, deleted.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioWorkflowDefinition?)null);
        var retyped = NewDefinition(trigger: StudioWorkflowTriggerKind.OnCreate);
        _workflows.Setup(w => w.GetDefinitionAsync(TenantId, retyped.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(retyped);
        _schedule.Setup(s => s.RemoveDefinitionAsync(TenantId, It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        var (job, provider) = NewJob();

        await job.FireInScopeAsync(provider, TenantId, deleted.Id, CancellationToken.None);
        await job.FireInScopeAsync(provider, TenantId, retyped.Id, CancellationToken.None);

        _schedule.Verify(s => s.RemoveDefinitionAsync(TenantId, deleted.Id, It.IsAny<CancellationToken>()), Times.Once);
        _schedule.Verify(s => s.RemoveDefinitionAsync(TenantId, retyped.Id, It.IsAny<CancellationToken>()), Times.Once);
        _engine.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Tick_ignores_the_tick_when_the_filters_are_unreadable()
    {
        // Défense en profondeur : b1 rejette ce cas à l'écriture ; le job conserve son enregistrement
        // (une prochaine écriture corrigera la configuration) et ne balaie rien.
        var definition = NewDefinition(triggerConfig: "pas du json");
        _workflows.Setup(w => w.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(new StudioWorkflowScheduledJob.StudioWorkflowScheduledReport(0, 0, 0, 0), report);
        Assert.Contains(_logger.Entries, e => e.Level == LogLevel.Warning);
        _records.VerifyNoOtherCalls();
        _schedule.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Tick_warns_and_processes_only_the_batch_when_the_total_exceeds_it()
    {
        var definition = NewDefinition();
        _settings.StudioWorkflowScheduledBatchSize = 10;
        SetupEmptySweep(definition);
        var batch = Enumerable.Range(0, 10).Select(_ => NewRecord()).ToArray();
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((batch, 25));
        foreach (var record in batch)
            SetupRecordStarted(definition, record);
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(new StudioWorkflowScheduledJob.StudioWorkflowScheduledReport(10, 10, 0, 0), report);
        Assert.Contains(_logger.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("prochain tick"));
    }

    [Fact]
    public async Task Tick_isolates_a_failing_record_and_processes_the_rest()
    {
        var definition = NewDefinition();
        var failing = NewRecord();
        var healthy = NewRecord();
        SetupEmptySweep(definition);
        _records.Setup(r => r.QueryAsync(
                It.IsAny<RecordQuerySpec>(),
                It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((new CustomRecord[] { failing, healthy }, 2));
        _workflows.Setup(w => w.HasOpenInstanceInChainAsync(
                TenantId, definition.Id, failing.Id, null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("base indisponible"));
        SetupRecordStarted(definition, healthy);
        var (job, provider) = NewJob();

        var report = await job.FireInScopeAsync(provider, TenantId, definition.Id, CancellationToken.None);

        Assert.Equal(new StudioWorkflowScheduledJob.StudioWorkflowScheduledReport(2, 1, 0, 1), report);
    }

    [Fact]
    public async Task Fire_sets_the_tenant_context_and_runs_the_sweep_end_to_end()
    {
        var definition = NewDefinition();
        _tenantService.Setup(t => t.GetConnectionStringAsync(TenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync("Server=tenant;");
        _tenantContext.Setup(c => c.SetTenant(TenantId, "Server=tenant;"));
        SetupEmptySweep(definition);
        var (job, _) = NewJob();

        await job.FireAsync(TenantId, definition.Id, CancellationToken.None);

        _tenantContext.Verify(c => c.SetTenant(TenantId, "Server=tenant;"), Times.Once);
        Assert.Contains(_logger.Entries, e => e.Level == LogLevel.Information && e.Message.Contains("balayé"));
    }
}
