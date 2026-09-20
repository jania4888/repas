using FactuTrust.Application.Common.Identity;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 4.2c2 : <see cref="StudioWorkflowRunner"/> sur mocks stricts. Vérifie le bail posé puis
/// relâché dans tous les chemins (y compris quand le moteur lève), l'impersonation du lanceur pendant
/// <c>ResumeAsync</c>, le refus fail-closed (lanceur indisponible ⇒ échec + notification 17 + audit) et
/// le démarrage sous l'utilisateur courant. Horloge <see cref="FakeTimeProvider"/>.
/// </summary>
public sealed class StudioWorkflowRunnerTests
{
    private static readonly Guid TenantId = Guid.Parse("cccccccc-0000-0000-0000-000000000001");
    private static readonly Guid EntityId = Guid.Parse("cccccccc-0000-0000-0000-000000000002");
    private static readonly Guid StarterId = Guid.Parse("dddddddd-0000-0000-0000-000000000001");

    private readonly Mock<IStudioWorkflowRepository> _workflows = new(MockBehavior.Strict);
    private readonly Mock<IStudioWorkflowEngine> _engine = new(MockBehavior.Strict);
    private readonly Mock<IImpersonationSnapshotResolver> _impersonation = new(MockBehavior.Strict);
    private readonly Mock<ICurrentUser> _currentUser = new(MockBehavior.Strict);
    private readonly Mock<INotificationService> _notifications = new(MockBehavior.Strict);
    private readonly Mock<ICustomEntityRepository> _entities = new(MockBehavior.Strict);
    private readonly Mock<IAuditService> _audit = new(MockBehavior.Strict);
    private readonly FakeTimeProvider _time = new();

    private sealed class FakeTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;
    }

    private StudioWorkflowRunner Runner() => new(
        _workflows.Object, _engine.Object, _impersonation.Object, _currentUser.Object,
        _notifications.Object, _entities.Object, _audit.Object,
        Options.Create(new OllamaSettings()), NullLogger<StudioWorkflowRunner>.Instance, _time);

    private static StudioWorkflowDefinition NewDefinition()
        => StudioWorkflowDefinition.Create(
            TenantId, EntityId, "relance", "Relance client", null, StudioWorkflowTriggerKind.OnCreate, "{}", "[]", true, null);

    /// <summary>Instance non terminale (en attente échue), éventuellement sans lanceur (déclencheur système).</summary>
    private StudioWorkflowInstance SuspendedInstance(Guid? startedBy)
        => SuspendedInstance(NewDefinition(), startedBy);

    private StudioWorkflowInstance SuspendedInstance(StudioWorkflowDefinition definition, Guid? startedBy)
    {
        var instance = StudioWorkflowInstance.Start(
            TenantId, definition, Guid.NewGuid(), StudioWorkflowTriggerKind.OnCreate, startedBy, "{}", 0, null);
        instance.Suspend(StudioWorkflowInstanceStatus.Waiting, _time.GetUtcNow().UtcDateTime.AddMinutes(-5), "{}");
        return instance;
    }

    /// <summary>Le dépôt simulé applique le bail en mémoire, comme la vraie implémentation SQL.</summary>
    private void LeaseSucceeds()
        => _workflows.Setup(w => w.TryLeaseInstanceAsync(
                It.IsAny<StudioWorkflowInstance>(), It.IsAny<DateTime>(), It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioWorkflowInstance i, DateTime n, TimeSpan d, CancellationToken _) => i.TryLease(n, d));

    private void ReleasePersists()
        => _workflows.Setup(w => w.UpdateInstanceAsync(It.IsAny<StudioWorkflowInstance>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

    [Fact]
    public async Task Resume_leases_impersonates_starter_and_releases_lease_in_finally()
    {
        var instance = SuspendedInstance(StarterId);
        LeaseSucceeds();
        ReleasePersists();

        var snapshot = new ImpersonatedUserSnapshot(
            StarterId, TenantId, "lanceur@instafact.tn", UserRole.Accountant,
            new HashSet<string>(StringComparer.Ordinal) { "studio:records_write" },
            $"studio-workflow:{instance.Id:N}");
        _impersonation.Setup(i => i.ResolveAsync(
                TenantId, StarterId, $"studio-workflow:{instance.Id:N}", It.IsAny<CancellationToken>()))
            .ReturnsAsync(snapshot);

        ImpersonatedUserSnapshot? observed = null;
        var leasedDuringRun = false;
        _engine.Setup(e => e.ResumeAsync(instance, It.IsAny<CancellationToken>()))
            .Callback(() =>
            {
                observed = ImpersonatedUserContext.Current;
                leasedDuringRun = instance.LeasedAt is not null;
            })
            .Returns(Task.CompletedTask);

        var outcome = await Runner().ResumeUnderStarterAsync(instance, CancellationToken.None);

        Assert.Equal(StudioWorkflowRunOutcome.Resumed, outcome);
        Assert.NotNull(observed);
        Assert.Equal(StarterId, observed!.UserId);
        Assert.True(leasedDuringRun);
        Assert.Null(instance.LeasedAt);
        Assert.Null(ImpersonatedUserContext.Current);
        _workflows.Verify(w => w.UpdateInstanceAsync(instance, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Resume_returns_LeaseBusy_when_lease_is_taken()
    {
        var instance = SuspendedInstance(StarterId);
        _workflows.Setup(w => w.TryLeaseInstanceAsync(
                instance, It.IsAny<DateTime>(), It.IsAny<TimeSpan>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var outcome = await Runner().ResumeUnderStarterAsync(instance, CancellationToken.None);

        Assert.Equal(StudioWorkflowRunOutcome.LeaseBusy, outcome);
        _engine.VerifyNoOtherCalls();
        _impersonation.VerifyNoOtherCalls();
        _workflows.Verify(w => w.UpdateInstanceAsync(It.IsAny<StudioWorkflowInstance>(), It.IsAny<CancellationToken>()), Times.Never);
        _notifications.VerifyNoOtherCalls();
        _entities.VerifyNoOtherCalls();
        _audit.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Resume_fails_instance_and_notifies_starter_when_snapshot_is_null()
    {
        var definition = NewDefinition();
        var instance = SuspendedInstance(definition, StarterId);
        LeaseSucceeds();
        ReleasePersists();
        _impersonation.Setup(i => i.ResolveAsync(
                TenantId, StarterId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((ImpersonatedUserSnapshot?)null);

        _workflows.Setup(w => w.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        _entities.Setup(e => e.GetByIdAsync(TenantId, EntityId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CustomEntityDefinition.Create(TenantId, "matters", "Matter", "Matters", null, null, null));
        _notifications.Setup(n => n.CreateAsync(
                TenantId, null, NotificationType.StudioWorkflowStepFailed,
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), StarterId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _audit.Setup(a => a.LogAsync(
                "Studio.Workflow.InstanceFailed", "StudioWorkflowInstance", instance.Id, null,
                It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var outcome = await Runner().ResumeUnderStarterAsync(instance, CancellationToken.None);

        Assert.Equal(StudioWorkflowRunOutcome.StarterUnavailable, outcome);
        Assert.Equal(StudioWorkflowInstanceStatus.Failed, instance.Status);
        _engine.VerifyNoOtherCalls();
        // Notification 17 : titre au nom du workflow, lien vers la fiche, au lanceur.
        _notifications.Verify(n => n.CreateAsync(
            TenantId, null, NotificationType.StudioWorkflowStepFailed,
            "Workflow « Relance client » en échec",
            "Lanceur introuvable ou inactif : reprise refusée.",
            $"/studio/d/matters/{instance.RecordId}/edit", StarterId, It.IsAny<CancellationToken>()), Times.Once);
        _audit.Verify(a => a.LogAsync(
            "Studio.Workflow.InstanceFailed", "StudioWorkflowInstance", instance.Id, null,
            It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Resume_without_starter_runs_engine_without_impersonation()
    {
        var instance = SuspendedInstance(startedBy: null);
        LeaseSucceeds();
        ReleasePersists();

        var impersonationSeen = true;
        _engine.Setup(e => e.ResumeAsync(instance, It.IsAny<CancellationToken>()))
            .Callback(() => impersonationSeen = ImpersonatedUserContext.Current is not null)
            .Returns(Task.CompletedTask);

        var outcome = await Runner().ResumeUnderStarterAsync(instance, CancellationToken.None);

        Assert.Equal(StudioWorkflowRunOutcome.Resumed, outcome);
        Assert.False(impersonationSeen);
        Assert.Null(instance.LeasedAt);
        _impersonation.VerifyNoOtherCalls();
        _notifications.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Resume_releases_lease_even_when_engine_throws()
    {
        var instance = SuspendedInstance(startedBy: null);
        LeaseSucceeds();
        ReleasePersists();
        _engine.Setup(e => e.ResumeAsync(instance, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("boom"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Runner().ResumeUnderStarterAsync(instance, CancellationToken.None));

        Assert.Null(instance.LeasedAt);
        _workflows.Verify(w => w.UpdateInstanceAsync(instance, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Resume_skips_terminal_instances_without_touching_anything()
    {
        var instance = SuspendedInstance(StarterId);
        instance.Complete("{}");

        var outcome = await Runner().ResumeUnderStarterAsync(instance, CancellationToken.None);

        Assert.Equal(StudioWorkflowRunOutcome.Skipped, outcome);
        _workflows.VerifyNoOtherCalls();
        _engine.VerifyNoOtherCalls();
        _impersonation.VerifyNoOtherCalls();
        _notifications.VerifyNoOtherCalls();
        _entities.VerifyNoOtherCalls();
        _audit.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Resume_preserves_engine_exception_when_release_persistence_fails()
    {
        // Revue 4.2c2 : une panne SQL pendant le relâchement du bail ne doit pas masquer l'exception moteur.
        var instance = SuspendedInstance(startedBy: null);
        LeaseSucceeds();
        _workflows.Setup(w => w.UpdateInstanceAsync(instance, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("sql down"));
        _engine.Setup(e => e.ResumeAsync(instance, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("moteur"));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Runner().ResumeUnderStarterAsync(instance, CancellationToken.None));

        Assert.Equal("moteur", ex.Message);
        Assert.Null(instance.LeasedAt);
    }

    [Fact]
    public async Task Start_under_current_user_forwards_user_id_and_email_to_engine()
    {
        var definition = NewDefinition();
        var recordId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        _currentUser.Setup(c => c.TenantId).Returns(TenantId);
        _currentUser.Setup(c => c.UserId).Returns(userId);
        _currentUser.Setup(c => c.Email).Returns("courant@instafact.tn");

        var started = StudioWorkflowInstance.Start(
            TenantId, definition, recordId, StudioWorkflowTriggerKind.Manual, userId, "{}", 0, null);
        _engine.Setup(e => e.StartAsync(
                definition, recordId, StudioWorkflowTriggerKind.Manual, userId, "courant@instafact.tn",
                null, 0, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(started);

        var result = await Runner().StartUnderCurrentUserAsync(
            definition, recordId, StudioWorkflowTriggerKind.Manual, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(started.Id, result.Value.Id);
        // Pas de bail ni d'impersonation : le segment initial s'exécute dans la requête appelante.
        _workflows.VerifyNoOtherCalls();
        _impersonation.VerifyNoOtherCalls();
    }
}
