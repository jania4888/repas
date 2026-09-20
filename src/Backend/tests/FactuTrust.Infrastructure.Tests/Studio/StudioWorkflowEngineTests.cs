using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories.Studio;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 4.1f2 : <see cref="StudioWorkflowEngine"/> contre un SQL Server RÉEL
/// (<see cref="SqlTestDatabase"/>, dépôt 4.1c réel). Handler factice configurable par clé
/// d'étape, notifications/audit mockés, horloge <see cref="FakeTimeProvider"/> imbriquée.
/// Vérifie le checkpoint après chaque étape, la borne de segment (30 étapes / horloge),
/// les issues Continue/Skip/Goto/Stop/Suspend/Fail, l'annulation idempotente et l'absence
/// de données dans les journaux. <c>Skipped</c> explicite sans SQL.
/// </summary>
public sealed class StudioWorkflowEngineTests : IClassFixture<StudioWorkflowEngineTests.SqlFixture>
{
    private const string SkipMessage = "SQL Server/LocalDB indisponible dans ce bac à sable.";

    private readonly SqlFixture _sql;

    public StudioWorkflowEngineTests(SqlFixture sql) => _sql = sql;

    [SkippableFact]
    public async Task Start_runs_all_steps_and_completes_with_one_step_run_per_step()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("three_steps");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02", "s03"));

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, h.StartedBy, "user@example.test", null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Completed, instance.Status);
        Assert.Equal(3, instance.CurrentStepIndex);
        Assert.Null(instance.Error);

        var runs = await h.Workflows.ListStepRunsAsync(h.TenantId, instance.Id);
        Assert.Equal(new[] { 0, 1, 2 }, runs.Select(r => r.StepIndex).ToArray());
        Assert.All(runs, r => Assert.Equal(StudioWorkflowStepRunStatus.Succeeded, r.Status));
        Assert.All(runs, r => Assert.Equal("continue", r.Outcome));
        Assert.All(runs, r => Assert.Equal(h.StartedBy, r.RunBy));
    }

    [SkippableFact]
    public async Task Invalid_definition_fails_the_instance_with_the_frozen_message()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("invalid_def");
        var definition = await h.NewDefinitionAsync(entity, "{");

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Failed, instance.Status);
        Assert.Equal("Définition invalide", instance.Error);

        var persisted = await h.Workflows.GetInstanceAsync(h.TenantId, instance.Id);
        Assert.NotNull(persisted);
        Assert.Equal(StudioWorkflowInstanceStatus.Failed, persisted!.Status);
    }

    [SkippableFact]
    public async Task Suspend_checkpoints_the_context_and_stops_the_segment()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var dueAt = DateTime.UtcNow.AddHours(2);
        var h = NewHarness();
        h.Handler.On("s02", _ => new StepOutcome.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, dueAt));
        var (entity, record) = await h.SeedAsync("suspend");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02", "s03"));

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.WaitingApproval, instance.Status);
        Assert.Equal(dueAt, instance.DueAt);
        Assert.Equal(1, instance.CurrentStepIndex);
        Assert.Equal("s02", instance.CurrentStepKey);

        var runs = await h.Workflows.ListStepRunsAsync(h.TenantId, instance.Id);
        Assert.Equal(2, runs.Count);
        Assert.Equal(StudioWorkflowStepRunStatus.Succeeded, runs[0].Status);
        Assert.Equal(StudioWorkflowStepRunStatus.Suspended, runs[1].Status);

        // Checkpoint : le contexte sérialisé est persisté avec l'instance suspendue.
        var persisted = await h.Workflows.GetInstanceAsync(h.TenantId, instance.Id);
        Assert.Equal(instance.ContextJson, persisted!.ContextJson);
    }

    [SkippableFact]
    public async Task Resume_re_evaluates_the_suspended_step_with_is_resume_true()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        h.Handler.On("s02", ctx => ctx.IsResume
            ? new StepOutcome.Continue()
            : new StepOutcome.Suspend(StudioWorkflowInstanceStatus.Waiting, DateTime.UtcNow.AddHours(1)));
        var (entity, record) = await h.SeedAsync("resume");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02", "s03"));

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);
        Assert.Equal(StudioWorkflowInstanceStatus.Waiting, instance.Status);

        var reloaded = await h.Workflows.GetInstanceAsync(h.TenantId, instance.Id);
        await h.Engine.ResumeAsync(reloaded!);

        Assert.Equal(StudioWorkflowInstanceStatus.Completed, reloaded!.Status);
        // IsResume == true pour la première étape de la reprise (l'étape suspendue), false ensuite.
        Assert.Equal(
            new[] { false, false, true, false },
            h.Handler.Calls.Select(c => c.IsResume).ToArray());
    }

    [SkippableFact]
    public async Task Fail_marks_failed_and_notifies_started_by_once()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        h.Handler.On("s02", _ => new StepOutcome.Fail("Échec volontaire."));
        var (entity, record) = await h.SeedAsync("fail_notify");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02", "s03"));

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, h.StartedBy, "user@example.test", null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Failed, instance.Status);
        Assert.Equal("Échec volontaire.", instance.Error);

        h.Notifications.Verify(n => n.CreateAsync(
            h.TenantId,
            null,
            NotificationType.StudioWorkflowStepFailed,
            It.Is<string>(title => title.Contains("en échec")),
            "Échec volontaire.",
            $"/studio/d/{entity.Key}/{record.Id}/edit",
            h.StartedBy,
            It.IsAny<CancellationToken>()), Times.Once);

        h.Audit.Verify(a => a.LogAsync(
            "Studio.Workflow.InstanceFailed", "StudioWorkflowInstance", instance.Id,
            null, It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);

        var runs = await h.Workflows.ListStepRunsAsync(h.TenantId, instance.Id);
        Assert.Equal(2, runs.Count);
        Assert.Equal(StudioWorkflowStepRunStatus.Failed, runs[1].Status);
        Assert.Equal("fail", runs[1].Outcome);
    }

    [SkippableFact]
    public async Task Fail_with_continue_anyway_records_failure_and_moves_on()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        h.Handler.On("s01", _ => new StepOutcome.Fail("Échec toléré.", ContinueAnyway: true));
        var (entity, record) = await h.SeedAsync("fail_continue");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02"));

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, h.StartedBy, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Completed, instance.Status);
        Assert.Null(instance.Error);

        var runs = await h.Workflows.ListStepRunsAsync(h.TenantId, instance.Id);
        Assert.Equal(2, runs.Count);
        Assert.Equal(StudioWorkflowStepRunStatus.Failed, runs[0].Status);
        Assert.Equal("Échec toléré.", runs[0].Error);
        Assert.Equal(StudioWorkflowStepRunStatus.Succeeded, runs[1].Status);

        // Échec toléré ⇒ aucune notification.
        h.Notifications.Verify(n => n.CreateAsync(
            It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<NotificationType>(),
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<Guid?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [SkippableFact]
    public async Task Goto_jumps_forward_and_backward_target_fails()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        // Saut en avant : s01 → s03, s02 jamais exécutée.
        var forward = NewHarness();
        forward.Handler.On("s01", _ => new StepOutcome.Goto("s03"));
        var (forwardEntity, forwardRecord) = await forward.SeedAsync("goto_forward");
        var forwardDefinition = await forward.NewDefinitionAsync(forwardEntity, StepsJson("s01", "s02", "s03"));

        var forwardInstance = await forward.Engine.StartAsync(
            forwardDefinition, forwardRecord.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Completed, forwardInstance.Status);
        var forwardRuns = await forward.Workflows.ListStepRunsAsync(forward.TenantId, forwardInstance.Id);
        Assert.Equal(new[] { "s01", "s03" }, forwardRuns.Select(r => r.StepKey).ToArray());
        Assert.Equal("goto", forwardRuns[0].Outcome);

        // Saut arrière (ou cible courante) : échec figé.
        var backward = NewHarness();
        backward.Handler.On("s02", _ => new StepOutcome.Goto("s01"));
        var (backwardEntity, backwardRecord) = await backward.SeedAsync("goto_backward");
        var backwardDefinition = await backward.NewDefinitionAsync(backwardEntity, StepsJson("s01", "s02"));

        var backwardInstance = await backward.Engine.StartAsync(
            backwardDefinition, backwardRecord.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Failed, backwardInstance.Status);
        Assert.Equal("Saut arrière interdit.", backwardInstance.Error);
    }

    [SkippableFact]
    public async Task Deleted_record_cancels_the_instance()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("deleted_record");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02"));

        // Suppression (logique) après l'étape 1, avant l'étape 2.
        h.Handler.OnAsync("s01", async ctx =>
        {
            ctx.Record.SoftDelete(null);
            await h.Records.UpdateAsync(ctx.Record);
            return new StepOutcome.Continue();
        });

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Cancelled, instance.Status);
        Assert.Equal("Enregistrement supprimé", instance.Error);

        var runs = await h.Workflows.ListStepRunsAsync(h.TenantId, instance.Id);
        Assert.Single(runs);

        h.Audit.Verify(a => a.LogAsync(
            "Studio.Workflow.InstanceCancelled", "StudioWorkflowInstance", instance.Id,
            null, It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [SkippableFact]
    public async Task Segment_is_capped_by_thirty_steps_and_by_the_clock()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        // 1) Plafond de 30 étapes : un workflow de 30 étapes est suspendu (Waiting) après le segment.
        var capped = NewHarness();
        var (cappedEntity, cappedRecord) = await capped.SeedAsync("segment_cap");
        var cappedDefinition = await capped.NewDefinitionAsync(
            cappedEntity, StepsJson(Enumerable.Range(1, 30).Select(i => $"s{i:00}").ToArray()));

        var cappedInstance = await capped.Engine.StartAsync(
            cappedDefinition, cappedRecord.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Waiting, cappedInstance.Status);
        Assert.Equal(30, cappedInstance.CurrentStepIndex);
        Assert.Equal(30, (await capped.Workflows.ListStepRunsAsync(capped.TenantId, cappedInstance.Id)).Count);

        // 2) Horloge : délai de segment dépassé après l'étape 1 ⇒ suspension immédiate.
        var clocked = NewHarness();
        clocked.Handler.On("s01", _ =>
        {
            clocked.Time.Advance(TimeSpan.FromSeconds(6));
            return new StepOutcome.Continue();
        });
        var (clockedEntity, clockedRecord) = await clocked.SeedAsync("segment_clock");
        var clockedDefinition = await clocked.NewDefinitionAsync(clockedEntity, StepsJson("s01", "s02", "s03"));

        var clockedInstance = await clocked.Engine.StartAsync(
            clockedDefinition, clockedRecord.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Waiting, clockedInstance.Status);
        Assert.Equal(1, clockedInstance.CurrentStepIndex);
        Assert.Single(await clocked.Workflows.ListStepRunsAsync(clocked.TenantId, clockedInstance.Id));
    }

    [SkippableFact]
    public async Task Handler_exception_becomes_a_failed_step_without_leaking_data()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        h.Handler.On("s01", _ => throw new InvalidOperationException("donnée-secrète-123"));
        var (entity, record) = await h.SeedAsync("exception");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02"));

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);

        Assert.Equal(StudioWorkflowInstanceStatus.Failed, instance.Status);
        var runs = await h.Workflows.ListStepRunsAsync(h.TenantId, instance.Id);
        Assert.Single(runs);
        Assert.Equal(StudioWorkflowStepRunStatus.Failed, runs[0].Status);

        // LogWarning émis avec ids uniquement : ni le gabarit ni ses arguments ne contiennent
        // le message de l'exception (qui peut porter des données).
        var warning = Assert.Single(h.Logger.Entries, e => e.Level == LogLevel.Warning);
        Assert.Equal("Workflow step failed {InstanceId} {StepKey}", warning.Template);
        Assert.DoesNotContain("donnée-secrète-123", warning.Formatted);
        Assert.Contains(instance.Id.ToString(), warning.Formatted);
        Assert.Contains("s01", warning.Formatted);
    }

    [SkippableFact]
    public async Task Cancel_is_idempotent_and_cancels_pending_approvals()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var h = NewHarness();
        h.Handler.On("s01", _ => new StepOutcome.Suspend(
            StudioWorkflowInstanceStatus.WaitingApproval, DateTime.UtcNow.AddHours(2)));
        var (entity, record) = await h.SeedAsync("cancel");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01", "s02"));

        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, 0, null);
        Assert.Equal(StudioWorkflowInstanceStatus.WaitingApproval, instance.Status);

        var approval = StudioWorkflowApproval.Create(
            h.TenantId, instance.Id, "s01", null, "Administrators", "Valider", null, DateTime.UtcNow.AddHours(2));
        await h.Workflows.AddApprovalAsync(approval);

        await h.Engine.CancelAsync(instance, "Workflow supprimé", h.StartedBy);
        Assert.Equal(StudioWorkflowInstanceStatus.Cancelled, instance.Status);

        var persistedApproval = await h.Workflows.GetApprovalAsync(h.TenantId, approval.Id);
        Assert.Equal(StudioWorkflowApprovalStatus.Cancelled, persistedApproval!.Status);

        // Deuxième appel : no-op (instance terminale), aucun audit supplémentaire.
        await h.Engine.CancelAsync(instance, "Workflow supprimé", h.StartedBy);

        h.Audit.Verify(a => a.LogAsync(
            "Studio.Workflow.InstanceCancelled", "StudioWorkflowInstance", instance.Id,
            null, It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [SkippableFact]
    public async Task Execution_scope_is_set_during_a_step_with_depth_plus_one()
    {
        Skip.If(!_sql.CanRun, SkipMessage);

        var captured = new List<StudioWorkflowExecutionMarker?>();
        var h = NewHarness();
        h.Handler.On("s01", _ =>
        {
            captured.Add(StudioWorkflowExecutionScope.Current);
            return new StepOutcome.Continue();
        });
        var (entity, record) = await h.SeedAsync("scope");
        var definition = await h.NewDefinitionAsync(entity, StepsJson("s01"));

        Assert.Null(StudioWorkflowExecutionScope.Current);
        var instance = await h.Engine.StartAsync(
            definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, null, null, depth: 0, originInstanceId: null);

        var marker = Assert.Single(captured);
        Assert.NotNull(marker);
        Assert.Equal(instance.Id, marker!.OriginInstanceId);
        Assert.Equal(instance.Depth + 1, marker.Depth);

        // La portée est refermée après le segment.
        Assert.Null(StudioWorkflowExecutionScope.Current);
    }

    // ---- outils de test ----

    private Harness NewHarness(FakeStepHandler? handler = null)
    {
        handler ??= new FakeStepHandler();
        var notifications = new Mock<INotificationService>();
        notifications
            .Setup(n => n.CreateAsync(
                It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<NotificationType>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        var audit = new Mock<IAuditService>();
        audit
            .Setup(a => a.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        return new Harness(_sql, handler, notifications, audit, new CapturingLogger(), new FakeTimeProvider());
    }

    private static string StepsJson(params string[] stepKeys)
    {
        var steps = string.Join(",", stepKeys.Select(k => $"{{\"key\":\"{k}\",\"type\":\"wait\"}}"));
        return $"{{\"version\":1,\"steps\":[{steps}]}}";
    }

    private sealed class Harness
    {
        private readonly SqlFixture _sql;

        public Harness(
            SqlFixture sql,
            FakeStepHandler handler,
            Mock<INotificationService> notifications,
            Mock<IAuditService> audit,
            CapturingLogger logger,
            FakeTimeProvider time)
        {
            _sql = sql;
            Handler = handler;
            Notifications = notifications;
            Audit = audit;
            Logger = logger;
            Time = time;
            TenantId = Guid.NewGuid();
            StartedBy = Guid.NewGuid();
            Workflows = sql.NewWorkflowRepository();
            Records = sql.NewRecordRepository();
            Entities = sql.NewEntityRepository();
            Fields = sql.NewFieldRepository();
            Engine = new StudioWorkflowEngine(
                Workflows, Entities, Fields, Records,
                new IStudioWorkflowStepHandler[] { handler },
                notifications.Object, audit.Object,
                Options.Create(new OllamaSettings()),
                logger, time);
        }

        public Guid TenantId { get; }
        public Guid StartedBy { get; }
        public StudioWorkflowEngine Engine { get; }
        public StudioWorkflowRepository Workflows { get; }
        public CustomRecordRepository Records { get; }
        public CustomEntityRepository Entities { get; }
        public CustomFieldRepository Fields { get; }
        public FakeStepHandler Handler { get; }
        public Mock<INotificationService> Notifications { get; }
        public Mock<IAuditService> Audit { get; }
        public CapturingLogger Logger { get; }
        public FakeTimeProvider Time { get; }

        /// <summary>Crée une table et un enregistrement réels pour un tenant isolé.</summary>
        public async Task<(CustomEntityDefinition Entity, CustomRecord Record)> SeedAsync(string label)
        {
            var entity = CustomEntityDefinition.Create(
                TenantId, $"matters_{label}", "Matter", "Matters", null, null, null);
            await Entities.AddAsync(entity);
            var record = CustomRecord.Create(TenantId, entity.Id, "{\"name\":\"Dossier A\"}", StartedBy);
            await Records.AddAsync(record);
            return (entity, record);
        }

        public async Task<StudioWorkflowDefinition> NewDefinitionAsync(CustomEntityDefinition entity, string stepsJson)
        {
            var definition = StudioWorkflowDefinition.Create(
                TenantId, entity.Id, $"wf_{Guid.NewGuid():N}", "Workflow de test", null,
                StudioWorkflowTriggerKind.OnCreate, "{}", stepsJson, isActive: true, null);
            await Workflows.AddDefinitionAsync(definition);
            return definition;
        }
    }

    /// <summary>Handler factice configurable par clé d'étape ; enregistre chaque appel.</summary>
    private sealed class FakeStepHandler : IStudioWorkflowStepHandler
    {
        private readonly Dictionary<string, Func<StepExecutionContext, Task<StepOutcome>>> _byKey = new(StringComparer.Ordinal);

        public string StepType => "wait";
        public List<StepExecutionContext> Calls { get; } = new();

        public void On(string stepKey, Func<StepExecutionContext, StepOutcome> behavior)
            => _byKey[stepKey] = ctx => Task.FromResult(behavior(ctx));

        public void OnAsync(string stepKey, Func<StepExecutionContext, Task<StepOutcome>> behavior)
            => _byKey[stepKey] = behavior;

        public Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
        {
            Calls.Add(ctx);
            return _byKey.TryGetValue(ctx.Step.Key, out var specific)
                ? specific(ctx)
                : Task.FromResult<StepOutcome>(new StepOutcome.Continue());
        }
    }

    /// <summary>Horloge contrôlée : figée par défaut, avancée explicitement par les étapes.</summary>
    private sealed class FakeTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 9, 16, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan delta) => _now += delta;
    }

    /// <summary>Capture les entrées de journal (gabarit + arguments) pour les assertions anti-fuite.</summary>
    private sealed class CapturingLogger : ILogger<StudioWorkflowEngine>
    {
        public List<(LogLevel Level, string Template, string Formatted)> Entries { get; } = new();

        IDisposable? ILogger.BeginScope<TState>(TState state) => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var template = state is IReadOnlyList<KeyValuePair<string, object?>> pairs
                ? pairs.FirstOrDefault(p => p.Key == "{OriginalFormat}").Value as string ?? formatter(state, exception)
                : formatter(state, exception);
            Entries.Add((logLevel, template, formatter(state, exception)));
        }
    }

    // ---- fixture ----

    /// <summary>Une base SQL dédiée à la classe (tables issues du modèle EF, tranche 4.1b1).</summary>
    public sealed class SqlFixture : IDisposable
    {
        private readonly SqlTestDatabase _db = new(nameof(StudioWorkflowEngineTests));

        public SqlFixture()
        {
            if (!_db.CanRun)
                return;

            Options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseSqlServer(_db.ConnectionString!)
                .Options;
            Factory = new SingleConnectionTenantDbContextFactory(Options);
        }

        public bool CanRun => _db.CanRun;
        public DbContextOptions<TenantDbContext> Options { get; } = null!;
        public ITenantDbContextFactory Factory { get; } = null!;

        public StudioWorkflowRepository NewWorkflowRepository() => new(Factory);
        public CustomEntityRepository NewEntityRepository() => new(Factory);
        public CustomFieldRepository NewFieldRepository() => new(Factory);
        public CustomRecordRepository NewRecordRepository() => new(Factory, new Mock<IJsonIndexManager>().Object);

        public void Dispose() => _db.Dispose();

        private sealed class SingleConnectionTenantDbContextFactory : ITenantDbContextFactory
        {
            private readonly DbContextOptions<TenantDbContext> _options;
            public SingleConnectionTenantDbContextFactory(DbContextOptions<TenantDbContext> options) => _options = options;
            public TenantDbContext CreateContext() => new(_options);
        }
    }
}
