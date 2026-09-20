using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 4.1i — déclencheur des workflows Studio : routage par déclencheur (on_create / on_update /
/// field_changed), flag off inerte, bornes anti-boucle (profondeur, chaîne ouverte, quota par
/// enregistrement) et isolation des échecs par définition. Aucune donnée d'enregistrement dans
/// les journaux (ids uniquement).
/// </summary>
public sealed class StudioWorkflowTriggerHandlerTests
{
    private static readonly Guid Tid = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();
    private static readonly Guid RecordId = Guid.NewGuid();
    private static readonly Guid RunBy = Guid.NewGuid();

    private sealed record Mocks(
        Mock<IStudioWorkflowRepository> Workflows,
        Mock<IStudioWorkflowEngine> Engine,
        Mock<IStudioQuotaService> Quota,
        Mock<ILogger<StudioWorkflowTriggerHandler>> Logger,
        StudioWorkflowTriggerHandler Handler);

    private static Mocks NewHandler(bool enabled = true, MockBehavior behavior = MockBehavior.Loose)
    {
        var workflows = new Mock<IStudioWorkflowRepository>(behavior);
        var engine = new Mock<IStudioWorkflowEngine>(behavior);
        var quota = new Mock<IStudioQuotaService>(behavior);
        var logger = new Mock<ILogger<StudioWorkflowTriggerHandler>>(behavior);
        var handler = new StudioWorkflowTriggerHandler(
            workflows.Object, engine.Object, quota.Object,
            Options.Create(new OllamaSettings { EnableStudioWorkflows = enabled }), logger.Object);
        return new Mocks(workflows, engine, quota, logger, handler);
    }

    private static CustomRecordWorkflowNotification Notif(
        StudioAutomationTrigger trigger,
        string dataJson = "{}",
        string? previous = null,
        Guid? origin = null,
        int depth = 0) =>
        new(Tid, EntityId, RecordId, dataJson, previous, trigger, RunBy, origin, depth);

    private static StudioWorkflowDefinition Def(StudioWorkflowTriggerKind kind, string config = "{}", string key = "wf_test") =>
        StudioWorkflowDefinition.Create(Tid, EntityId, key, "WF " + key, null, kind, config, "{}", true, RunBy);

    /// <summary>Branche heureuse : une définition éligible, aucune chaîne ouverte, quota OK.</summary>
    private static void SetupHappyPath(
        Mocks m, StudioWorkflowTriggerKind kind, IReadOnlyList<StudioWorkflowDefinition> definitions)
    {
        m.Workflows
            .Setup(w => w.ListActiveByTriggerAsync(Tid, EntityId, kind, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definitions);
        m.Workflows
            .Setup(w => w.HasOpenInstanceInChainAsync(Tid, It.IsAny<Guid>(), RecordId, It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        m.Workflows
            .Setup(w => w.CountInstancesForRecordAsync(Tid, RecordId, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);
        m.Quota
            .Setup(q => q.EnsureUnderLimitAsync(
                Tid, StudioQuotas.MaxWorkflowInstancesPerRecordKey, It.IsAny<int>(),
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        m.Engine
            .Setup(e => e.StartAsync(
                It.IsAny<StudioWorkflowDefinition>(), It.IsAny<Guid>(), It.IsAny<StudioWorkflowTriggerKind>(),
                It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioWorkflowDefinition def, Guid recordId, StudioWorkflowTriggerKind trigger,
                Guid? startedBy, string? _, string? _, int depth, Guid? origin, CancellationToken _) =>
                StudioWorkflowInstance.Start(Tid, def, recordId, trigger, startedBy, "{}", depth, origin));
    }

    private static void VerifyWarning(Mocks m, Times times) =>
        m.Logger.Verify(
            l => l.Log(
                LogLevel.Warning, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            times);

    [Fact]
    public async Task Flag_off_returns_without_touching_the_repository()
    {
        var m = NewHandler(enabled: false, behavior: MockBehavior.Strict);

        await m.Handler.Handle(Notif(StudioAutomationTrigger.OnCreate), CancellationToken.None);

        // Mocks stricts : le moindre appel aurait levé. Explicite pour la relecture.
        m.Workflows.VerifyNoOtherCalls();
        m.Engine.VerifyNoOtherCalls();
        m.Quota.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task On_create_starts_each_active_on_create_definition_in_order()
    {
        var m = NewHandler();
        var d1 = Def(StudioWorkflowTriggerKind.OnCreate, key: "wf_a");
        var d2 = Def(StudioWorkflowTriggerKind.OnCreate, key: "wf_b");
        SetupHappyPath(m, StudioWorkflowTriggerKind.OnCreate, new[] { d1, d2 });

        await m.Handler.Handle(Notif(StudioAutomationTrigger.OnCreate), CancellationToken.None);

        var started = new List<Guid>();
        m.Engine.Verify(
            e => e.StartAsync(
                It.IsAny<StudioWorkflowDefinition>(), RecordId, StudioWorkflowTriggerKind.OnCreate,
                RunBy, null, null, 0, null, It.IsAny<CancellationToken>()),
            Times.Exactly(2));
        m.Engine.Invocations
            .Where(i => i.Method.Name == nameof(IStudioWorkflowEngine.StartAsync))
            .ToList()
            .ForEach(i => started.Add(((StudioWorkflowDefinition)i.Arguments[0]).Id));
        Assert.Equal(new[] { d1.Id, d2.Id }, started);

        // Aucune résolution field_changed sur un on_create.
        m.Workflows.Verify(
            w => w.ListActiveByTriggerAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), StudioWorkflowTriggerKind.FieldChanged, It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task On_update_starts_on_update_and_field_changed_definitions()
    {
        var m = NewHandler();
        var onUpdate = Def(StudioWorkflowTriggerKind.OnUpdate, key: "wf_upd");
        var fieldChanged = Def(StudioWorkflowTriggerKind.FieldChanged, """{"field":"statut"}""", key: "wf_fc");
        SetupHappyPath(m, StudioWorkflowTriggerKind.OnUpdate, new[] { onUpdate });
        SetupHappyPath(m, StudioWorkflowTriggerKind.FieldChanged, new[] { fieldChanged });

        await m.Handler.Handle(
            Notif(StudioAutomationTrigger.OnUpdate, """{"statut":"clos"}""", """{"statut":"ouvert"}"""),
            CancellationToken.None);

        m.Engine.Verify(
            e => e.StartAsync(onUpdate, RecordId, StudioWorkflowTriggerKind.OnUpdate,
                RunBy, null, It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()),
            Times.Once);
        m.Engine.Verify(
            e => e.StartAsync(fieldChanged, RecordId, StudioWorkflowTriggerKind.FieldChanged,
                RunBy, null, It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    /// <summary>Le champ configuré doit avoir réellement changé ; « from »/« to » restreignent.</summary>
    [Theory]
    [InlineData("""{"statut":"ouvert"}""", """{"statut":"ouvert"}""", """{"field":"statut"}""", false)] // inchangé
    [InlineData("""{"statut":"ouvert"}""", """{"statut":"clos"}""", """{"field":"statut"}""", true)] // changé
    [InlineData("""{"statut":"ouvert"}""", """{"statut":"clos"}""", """{"field":"statut","from":"archive","to":"clos"}""", false)] // from non satisfait
    public async Task Field_changed_only_fires_when_the_field_value_actually_changes(
        string previous, string current, string config, bool expectStart)
    {
        var m = NewHandler();
        var def = Def(StudioWorkflowTriggerKind.FieldChanged, config);
        SetupHappyPath(m, StudioWorkflowTriggerKind.OnUpdate, Array.Empty<StudioWorkflowDefinition>());
        SetupHappyPath(m, StudioWorkflowTriggerKind.FieldChanged, new[] { def });

        await m.Handler.Handle(Notif(StudioAutomationTrigger.OnUpdate, current, previous), CancellationToken.None);

        m.Engine.Verify(
            e => e.StartAsync(def, RecordId, StudioWorkflowTriggerKind.FieldChanged,
                It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()),
            expectStart ? Times.Once() : Times.Never());
    }

    [Fact]
    public async Task Depth_above_two_is_ignored()
    {
        var m = NewHandler(behavior: MockBehavior.Strict);
        var logger = new Mock<ILogger<StudioWorkflowTriggerHandler>>();
        var handler = new StudioWorkflowTriggerHandler(
            m.Workflows.Object, m.Engine.Object, m.Quota.Object,
            Options.Create(new OllamaSettings { EnableStudioWorkflows = true }), logger.Object);

        await handler.Handle(Notif(StudioAutomationTrigger.OnCreate, origin: Guid.NewGuid(), depth: 3), CancellationToken.None);

        m.Workflows.VerifyNoOtherCalls();
        m.Engine.VerifyNoOtherCalls();
        logger.Verify(
            l => l.Log(
                LogLevel.Information, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task Open_instance_in_chain_skips_the_definition()
    {
        var m = NewHandler();
        var def = Def(StudioWorkflowTriggerKind.OnCreate);
        m.Workflows
            .Setup(w => w.ListActiveByTriggerAsync(Tid, EntityId, StudioWorkflowTriggerKind.OnCreate, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { def });
        m.Workflows
            .Setup(w => w.HasOpenInstanceInChainAsync(Tid, def.Id, RecordId, It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await m.Handler.Handle(Notif(StudioAutomationTrigger.OnCreate), CancellationToken.None);

        m.Engine.VerifyNoOtherCalls();
        // Le verrou anti-doublon court-circuite avant même le comptage de quota.
        m.Workflows.Verify(
            w => w.CountInstancesForRecordAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Quota_overflow_skips_and_warns()
    {
        var m = NewHandler();
        var def = Def(StudioWorkflowTriggerKind.OnCreate);
        SetupHappyPath(m, StudioWorkflowTriggerKind.OnCreate, new[] { def });
        m.Quota
            .Setup(q => q.EnsureUnderLimitAsync(
                Tid, StudioQuotas.MaxWorkflowInstancesPerRecordKey, It.IsAny<int>(),
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure(Error.Conflict("quota atteint")));

        await m.Handler.Handle(Notif(StudioAutomationTrigger.OnCreate), CancellationToken.None);

        m.Engine.VerifyNoOtherCalls();
        VerifyWarning(m, Times.Once());
    }

    [Fact]
    public async Task One_failing_definition_does_not_prevent_the_others()
    {
        var m = NewHandler();
        var failing = Def(StudioWorkflowTriggerKind.OnCreate, key: "wf_ko");
        var healthy = Def(StudioWorkflowTriggerKind.OnCreate, key: "wf_ok");
        SetupHappyPath(m, StudioWorkflowTriggerKind.OnCreate, new[] { failing, healthy });
        m.Engine
            .Setup(e => e.StartAsync(
                failing, It.IsAny<Guid>(), It.IsAny<StudioWorkflowTriggerKind>(),
                It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("boom"));

        await m.Handler.Handle(Notif(StudioAutomationTrigger.OnCreate), CancellationToken.None);

        m.Engine.Verify(
            e => e.StartAsync(healthy, RecordId, StudioWorkflowTriggerKind.OnCreate,
                It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
        VerifyWarning(m, Times.Once());
    }

    [Fact]
    public async Task Depth_and_origin_are_propagated_to_the_engine()
    {
        var m = NewHandler();
        var def = Def(StudioWorkflowTriggerKind.OnUpdate);
        SetupHappyPath(m, StudioWorkflowTriggerKind.OnUpdate, new[] { def });
        SetupHappyPath(m, StudioWorkflowTriggerKind.FieldChanged, Array.Empty<StudioWorkflowDefinition>());
        var origin = Guid.NewGuid();

        await m.Handler.Handle(
            Notif(StudioAutomationTrigger.OnUpdate, """{"statut":"clos"}""", """{"statut":"ouvert"}""", origin, depth: 1),
            CancellationToken.None);

        m.Engine.Verify(
            e => e.StartAsync(def, RecordId, StudioWorkflowTriggerKind.OnUpdate,
                RunBy, null, """{"statut":"ouvert"}""", 2, origin, It.IsAny<CancellationToken>()),
            Times.Once);
    }
}
