using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 4.1i — anti-boucle des workflows chaînés : la publication de cycle de vie propage
/// l'origine et la profondeur du marqueur ambiant <see cref="StudioWorkflowExecutionScope"/>,
/// une exception du bus est journalisée en avertissement puis absorbée, et la chaîne s'arrête
/// à la profondeur <see cref="StudioWorkflowExecutionScope.MaxDepth"/> (2).
/// </summary>
public sealed class StudioWorkflowAntiLoopTests
{
    private static readonly Guid Tid = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();
    private static readonly Guid RecordId = Guid.NewGuid();
    private static readonly Guid RunBy = Guid.NewGuid();

    private static Mock<IPublisher> CapturingPublisher(out Func<CustomRecordWorkflowNotification?> read)
    {
        CustomRecordWorkflowNotification? captured = null;
        var publisher = new Mock<IPublisher>();
        publisher
            .Setup(p => p.Publish(It.IsAny<CustomRecordWorkflowNotification>(), It.IsAny<CancellationToken>()))
            .Callback<CustomRecordWorkflowNotification, CancellationToken>((n, _) => captured = n)
            .Returns(Task.CompletedTask);
        read = () => captured;
        return publisher;
    }

    [Fact]
    public async Task Publication_inside_an_execution_scope_carries_origin_and_depth()
    {
        var publisher = CapturingPublisher(out var read);
        var origin = Guid.NewGuid();

        using (StudioWorkflowExecutionScope.Enter(origin, 1))
        {
            await StudioWorkflowLifecycle.PublishAsync(
                publisher.Object, Tid, EntityId, RecordId, "{}", """{"a":1}""",
                StudioAutomationTrigger.OnUpdate, RunBy, NullLogger.Instance, CancellationToken.None);
        }

        var notification = Assert.IsType<CustomRecordWorkflowNotification>(read());
        Assert.Equal(origin, notification.OriginWorkflowInstanceId);
        Assert.Equal(1, notification.Depth);
    }

    [Fact]
    public async Task Publication_outside_a_scope_has_depth_zero_and_no_origin()
    {
        var publisher = CapturingPublisher(out var read);
        Assert.Null(StudioWorkflowExecutionScope.Current); // garde : aucune portée parasite.

        await StudioWorkflowLifecycle.PublishAsync(
            publisher.Object, Tid, EntityId, RecordId, "{}", null,
            StudioAutomationTrigger.OnCreate, RunBy, NullLogger.Instance, CancellationToken.None);

        var notification = Assert.IsType<CustomRecordWorkflowNotification>(read());
        Assert.Null(notification.OriginWorkflowInstanceId);
        Assert.Equal(0, notification.Depth);
    }

    [Fact]
    public async Task Publisher_exception_is_logged_as_warning_and_swallowed()
    {
        var publisher = new Mock<IPublisher>();
        publisher
            .Setup(p => p.Publish(It.IsAny<CustomRecordWorkflowNotification>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("bus en panne"));
        var logger = new Mock<ILogger>();

        // Ne doit PAS lever : le flux de sauvegarde de l'enregistrement est déjà terminé.
        await StudioWorkflowLifecycle.PublishAsync(
            publisher.Object, Tid, EntityId, RecordId, "{}", null,
            StudioAutomationTrigger.OnCreate, RunBy, logger.Object, CancellationToken.None);

        logger.Verify(
            l => l.Log(
                LogLevel.Warning, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task Chain_stops_at_depth_two()
    {
        var engine = new Mock<IStudioWorkflowEngine>();
        engine
            .Setup(e => e.StartAsync(
                It.IsAny<StudioWorkflowDefinition>(), It.IsAny<Guid>(), It.IsAny<StudioWorkflowTriggerKind>(),
                It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioWorkflowDefinition def, Guid recordId, StudioWorkflowTriggerKind trigger,
                Guid? startedBy, string? _, string? _, int depth, Guid? origin, CancellationToken _) =>
                StudioWorkflowInstance.Start(Tid, def, recordId, trigger, startedBy, "{}", depth, origin));

        var workflows = new Mock<IStudioWorkflowRepository>();
        var definition = StudioWorkflowDefinition.Create(
            Tid, EntityId, "wf_chain", "WF chaîne", null, StudioWorkflowTriggerKind.OnUpdate, "{}", "{}", true, RunBy);
        workflows
            .Setup(w => w.ListActiveByTriggerAsync(Tid, EntityId, StudioWorkflowTriggerKind.OnUpdate, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { definition });
        workflows
            .Setup(w => w.ListActiveByTriggerAsync(Tid, EntityId, StudioWorkflowTriggerKind.FieldChanged, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StudioWorkflowDefinition>());
        workflows
            .Setup(w => w.HasOpenInstanceInChainAsync(Tid, definition.Id, RecordId, It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        workflows
            .Setup(w => w.CountInstancesForRecordAsync(Tid, RecordId, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);
        var quota = new Mock<IStudioQuotaService>();
        quota
            .Setup(q => q.EnsureUnderLimitAsync(
                Tid, StudioQuotas.MaxWorkflowInstancesPerRecordKey, It.IsAny<int>(),
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        var handler = new StudioWorkflowTriggerHandler(
            workflows.Object, engine.Object, quota.Object,
            Options.Create(new OllamaSettings { EnableStudioWorkflows = true }),
            NullLogger<StudioWorkflowTriggerHandler>.Instance);

        CustomRecordWorkflowNotification Notif(Guid? origin, int depth) =>
            new(Tid, EntityId, RecordId, "{}", null, StudioAutomationTrigger.OnUpdate, RunBy, origin, depth);

        // Profondeur 3 (au-delà du maximum 2) : le déclencheur n'appelle JAMAIS le moteur.
        await handler.Handle(Notif(Guid.NewGuid(), depth: 3), CancellationToken.None);
        engine.Verify(
            e => e.StartAsync(
                It.IsAny<StudioWorkflowDefinition>(), It.IsAny<Guid>(), It.IsAny<StudioWorkflowTriggerKind>(),
                It.IsAny<Guid?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()),
            Times.Never);

        // Profondeur 2 avec origine : le dernier maillon démarre à depth = 3 (refusé au tour suivant).
        await handler.Handle(Notif(Guid.NewGuid(), depth: 2), CancellationToken.None);
        engine.Verify(
            e => e.StartAsync(definition, RecordId, StudioWorkflowTriggerKind.OnUpdate,
                RunBy, null, null, 3, It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Once);

        // Profondeur 2 SANS origine (publication directe) : la chaîne n'existe pas ⇒ depth 0.
        engine.Invocations.Clear();
        await handler.Handle(Notif(origin: null, depth: 2), CancellationToken.None);
        engine.Verify(
            e => e.StartAsync(definition, RecordId, StudioWorkflowTriggerKind.OnUpdate,
                RunBy, null, null, 0, null, It.IsAny<CancellationToken>()),
            Times.Once);
    }
}
