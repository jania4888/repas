using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 4.2d : <see cref="StudioWorkflowResumeJob"/>. Le passage par tenant est testé via
/// <c>ProcessTenantAsync</c> sur une <see cref="ServiceCollection"/> réelle peuplée de mocks stricts ;
/// l'enveloppe <c>ExecuteAsync</c> est testée avec un <see cref="MasterDbContext"/> InMemory (2 tenants
/// actifs + 1 inactif) et un <see cref="ITenantService"/> mocké. Horloge fixe pour les seuils exacts.
/// </summary>
public sealed class StudioWorkflowResumeJobTests
{
    private static readonly Guid TenantA = Guid.Parse("eeeeeeee-0000-0000-0000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("eeeeeeee-0000-0000-0000-000000000002");
    private static readonly Guid TenantInactive = Guid.Parse("eeeeeeee-0000-0000-0000-000000000003");
    private static readonly Guid StarterId = Guid.Parse("eeeeeeee-1111-0000-0000-000000000001");
    private static readonly Guid EntityId = Guid.Parse("eeeeeeee-2222-0000-0000-000000000001");

    private readonly Mock<IStudioWorkflowRepository> _workflows = new(MockBehavior.Strict);
    private readonly Mock<IStudioWorkflowRunner> _runner = new(MockBehavior.Strict);
    private readonly Mock<INotificationService> _notifications = new(MockBehavior.Strict);
    private readonly Mock<ITenantContext> _tenantContext = new(MockBehavior.Strict);
    private readonly Mock<ITenantService> _tenantService = new(MockBehavior.Strict);
    private readonly FakeTimeProvider _time = new();
    private readonly OllamaSettings _settings = new() { EnableStudioWorkflows = true };

    private sealed class FakeTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _now = new(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;
    }

    private DateTime Now => _time.GetUtcNow().UtcDateTime;

    private static MasterDbContext BuildMaster()
        => new(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static void AddTenant(MasterDbContext master, Guid id, bool isActive)
    {
        var tenant = Tenant.Create(
            "Société Test",
            NIF.Create("1234567/A/B/C/000").Value,
            Address.Create("1 rue Test", "Tunis", "Tunis").Value,
            Email.Create("contact@societe.tn").Value,
            PhoneNumber.Create("20123456").Value,
            TaxRegime.RealRegime).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(tenant, id);
        if (!isActive)
            typeof(Tenant).GetProperty(nameof(Tenant.IsActive))!.SetValue(tenant, false);
        master.Tenants.Add(tenant);
    }

    private static StudioWorkflowDefinition NewDefinition()
        => StudioWorkflowDefinition.Create(
            TenantA, EntityId, "relance", "Relance client", null, StudioWorkflowTriggerKind.OnCreate, "{}", "[]", true, null);

    private StudioWorkflowInstance SuspendedInstance(Guid? startedBy = null)
    {
        var instance = StudioWorkflowInstance.Start(
            TenantA, NewDefinition(), Guid.NewGuid(), StudioWorkflowTriggerKind.OnCreate, startedBy, "{}", 0, null);
        instance.Suspend(StudioWorkflowInstanceStatus.Waiting, Now.AddMinutes(-5), "{}");
        return instance;
    }

    /// <summary>Les quatre lectures du passage, vides par défaut (chaque test remplace ce qu'il étudie).</summary>
    private void SetupEmptyPass()
    {
        _workflows.Setup(w => w.ListStaleLeasesAsync(
                It.IsAny<Guid>(), It.IsAny<DateTime>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StudioWorkflowInstance>());
        _workflows.Setup(w => w.ListExpiredApprovalsAsync(
                It.IsAny<Guid>(), It.IsAny<DateTime>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StudioWorkflowApproval>());
        _workflows.Setup(w => w.ListDueAsync(
                It.IsAny<Guid>(), It.IsAny<DateTime>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StudioWorkflowInstance>());
        _workflows.Setup(w => w.PurgeTerminalOlderThanAsync(
                It.IsAny<Guid>(), It.IsAny<DateTime>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);
    }

    private (StudioWorkflowResumeJob Job, ServiceProvider Provider) NewJob(MasterDbContext master)
    {
        var services = new ServiceCollection();
        services.AddSingleton(_tenantContext.Object);
        services.AddSingleton(_workflows.Object);
        services.AddSingleton(_runner.Object);
        services.AddSingleton(_notifications.Object);
        var provider = services.BuildServiceProvider();
        return (new StudioWorkflowResumeJob(
            master, _tenantService.Object, provider.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(_settings), NullLogger<StudioWorkflowResumeJob>.Instance, _time), provider);
    }

    [Fact]
    public async Task Execute_does_nothing_when_flag_is_off()
    {
        _settings.EnableStudioWorkflows = false;
        var (job, _) = NewJob(BuildMaster());

        await job.ExecuteAsync(CancellationToken.None);

        _tenantService.VerifyNoOtherCalls();
        _tenantContext.VerifyNoOtherCalls();
        _workflows.VerifyNoOtherCalls();
        _runner.VerifyNoOtherCalls();
        _notifications.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Execute_sets_tenant_context_and_processes_each_active_tenant_only()
    {
        await using var master = BuildMaster();
        AddTenant(master, TenantA, isActive: true);
        AddTenant(master, TenantB, isActive: true);
        AddTenant(master, TenantInactive, isActive: false);
        await master.SaveChangesAsync();

        _tenantService.Setup(t => t.GetConnectionStringAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid id, CancellationToken _) => $"cs-{id}");
        _tenantContext.Setup(t => t.SetTenant(It.IsAny<Guid>(), It.IsAny<string>()));
        SetupEmptyPass();

        var (job, _) = NewJob(master);
        await job.ExecuteAsync(CancellationToken.None);

        _tenantContext.Verify(t => t.SetTenant(TenantA, $"cs-{TenantA}"), Times.Once);
        _tenantContext.Verify(t => t.SetTenant(TenantB, $"cs-{TenantB}"), Times.Once);
        _tenantContext.Verify(t => t.SetTenant(TenantInactive, It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Process_releases_stale_leases_first()
    {
        var stale1 = SuspendedInstance();
        var stale2 = SuspendedInstance();
        Assert.True(stale1.TryLease(Now.AddHours(-2), TimeSpan.FromMinutes(30)));
        Assert.True(stale2.TryLease(Now.AddHours(-3), TimeSpan.FromMinutes(30)));

        var order = new List<string>();
        var due = SuspendedInstance();

        SetupEmptyPass();
        // Seuil du reaper = now - bail (30 min par défaut).
        _workflows.Setup(w => w.ListStaleLeasesAsync(
                TenantA, Now.AddMinutes(-30), 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { stale1, stale2 });
        _workflows.Setup(w => w.UpdateInstanceAsync(It.IsAny<StudioWorkflowInstance>(), It.IsAny<CancellationToken>()))
            .Callback<StudioWorkflowInstance, CancellationToken>((i, _) => order.Add($"release:{i.Id}"))
            .Returns(Task.CompletedTask);
        _workflows.Setup(w => w.ListDueAsync(TenantA, Now, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { due });
        _runner.Setup(r => r.ResumeUnderStarterAsync(due, It.IsAny<CancellationToken>()))
            .Callback(() => order.Add("resume"))
            .ReturnsAsync(StudioWorkflowRunOutcome.Resumed);

        var (job, provider) = NewJob(BuildMaster());
        var report = await job.ProcessTenantAsync(provider, TenantA, CancellationToken.None);

        Assert.Equal(2, report.LeasesReleased);
        Assert.Equal(1, report.Resumed);
        Assert.Null(stale1.LeasedAt);
        Assert.Null(stale2.LeasedAt);
        // Le reaper passe AVANT toute reprise.
        Assert.Equal(3, order.Count);
        Assert.Equal("resume", order[2]);
        Assert.All(order.Take(2), entry => Assert.StartsWith("release:", entry, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Process_expires_due_approvals_writes_expired_status_in_context_and_makes_instance_due()
    {
        var instance = SuspendedInstance(StarterId);
        instance.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, Now.AddHours(-1), "{}");
        var approval = StudioWorkflowApproval.Create(
            TenantA, instance.Id, "approve_step", null, "Administrators", "Valider le devis", null, Now.AddMinutes(-30));

        SetupEmptyPass();
        _workflows.Setup(w => w.ListExpiredApprovalsAsync(TenantA, Now, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { approval });
        _workflows.Setup(w => w.UpdateApprovalAsync(approval, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _workflows.Setup(w => w.GetInstanceAsync(TenantA, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(instance);
        _workflows.Setup(w => w.UpdateInstanceAsync(instance, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _notifications.Setup(n => n.CreateAsync(
                TenantA, null, NotificationType.StudioWorkflowApprovalDecided,
                "Approbation « Valider le devis » expirée", It.IsAny<string>(), "/studio/approvals",
                StarterId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        var (job, provider) = NewJob(BuildMaster());
        var report = await job.ProcessTenantAsync(provider, TenantA, CancellationToken.None);

        Assert.Equal(1, report.ApprovalsExpired);
        Assert.Equal(StudioWorkflowApprovalStatus.Expired, approval.Status);
        // Instance : même statut, mais rendue due à « now » (D-05) ; statut « expired » mémorisé au contexte.
        Assert.Equal(StudioWorkflowInstanceStatus.WaitingApproval, instance.Status);
        Assert.Equal(Now, instance.DueAt);
        using var doc = JsonDocument.Parse(instance.ContextJson);
        Assert.Equal(
            "expired",
            doc.RootElement.GetProperty("approval").GetProperty("approve_step").GetProperty("status").GetString());
        _notifications.VerifyAll();
    }

    [Fact]
    public async Task Process_resumes_due_instances_through_runner_and_counts_outcomes()
    {
        var resumed = SuspendedInstance();
        var busy = SuspendedInstance();
        var unavailable = SuspendedInstance();
        var skipped = SuspendedInstance();

        SetupEmptyPass();
        _workflows.Setup(w => w.ListDueAsync(TenantA, Now, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { resumed, busy, unavailable, skipped });
        _runner.Setup(r => r.ResumeUnderStarterAsync(resumed, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StudioWorkflowRunOutcome.Resumed);
        _runner.Setup(r => r.ResumeUnderStarterAsync(busy, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StudioWorkflowRunOutcome.LeaseBusy);
        _runner.Setup(r => r.ResumeUnderStarterAsync(unavailable, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StudioWorkflowRunOutcome.StarterUnavailable);
        _runner.Setup(r => r.ResumeUnderStarterAsync(skipped, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StudioWorkflowRunOutcome.Skipped);

        var (job, provider) = NewJob(BuildMaster());
        var report = await job.ProcessTenantAsync(provider, TenantA, CancellationToken.None);

        Assert.Equal(new StudioWorkflowResumeJob.StudioWorkflowResumeReport(0, 0, 1, 1, 1, 0), report);
    }

    [Fact]
    public async Task Process_purges_terminal_instances_older_than_retention()
    {
        var capturedThreshold = DateTime.MinValue;
        var capturedMax = 0;
        SetupEmptyPass();
        _workflows.Setup(w => w.PurgeTerminalOlderThanAsync(
                TenantA, It.IsAny<DateTime>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .Callback<Guid, DateTime, int, CancellationToken>((_, threshold, max, _) =>
            {
                capturedThreshold = threshold;
                capturedMax = max;
            })
            .ReturnsAsync(7);

        var (job, provider) = NewJob(BuildMaster());
        var report = await job.ProcessTenantAsync(provider, TenantA, CancellationToken.None);

        Assert.Equal(7, report.Purged);
        Assert.Equal(Now.AddDays(-180), capturedThreshold);
        Assert.Equal(100, capturedMax);
    }

    [Fact]
    public async Task Process_isolates_failures_per_instance_and_continues()
    {
        var bad = SuspendedInstance();
        var good = SuspendedInstance();

        SetupEmptyPass();
        _workflows.Setup(w => w.ListDueAsync(TenantA, Now, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { bad, good });
        _runner.Setup(r => r.ResumeUnderStarterAsync(bad, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("boom"));
        _runner.Setup(r => r.ResumeUnderStarterAsync(good, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StudioWorkflowRunOutcome.Resumed);

        var (job, provider) = NewJob(BuildMaster());
        var report = await job.ProcessTenantAsync(provider, TenantA, CancellationToken.None);

        Assert.Equal(1, report.Resumed);
        _runner.Verify(r => r.ResumeUnderStarterAsync(It.IsAny<StudioWorkflowInstance>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }
}
