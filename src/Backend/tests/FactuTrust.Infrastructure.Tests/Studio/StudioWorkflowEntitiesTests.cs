using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioWorkflowEntitiesTests
{
    private const string StepsJson = """{ "version": 1, "steps": [ { "key": "verifier", "type": "condition" } ] }""";

    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid EntityDefinitionId = Guid.NewGuid();

    private static StudioWorkflowDefinition NewDefinition() =>
        StudioWorkflowDefinition.Create(TenantId, EntityDefinitionId, "validation_conges", "Validation des congés",
            null, StudioWorkflowTriggerKind.OnCreate, "{}", StepsJson, true, null);

    private StudioWorkflowInstance NewInstance(StudioWorkflowDefinition? definition = null) =>
        StudioWorkflowInstance.Start(TenantId, definition ?? NewDefinition(), Guid.NewGuid(),
            StudioWorkflowTriggerKind.OnCreate, null, "{}", depth: 0, originInstanceId: null);

    [Fact]
    public void Definition_update_bumps_version_only_when_trigger_or_steps_change()
    {
        var definition = NewDefinition();
        Assert.Equal(1, definition.Version);

        // Name / description alone never bump the version.
        definition.Update("Nouveau nom", "Une description", StudioWorkflowTriggerKind.OnCreate, "{}", StepsJson, null);
        Assert.Equal(1, definition.Version);
        Assert.Equal("Nouveau nom", definition.Name);

        definition.Update("Nouveau nom", "Une description", StudioWorkflowTriggerKind.OnCreate, "{}",
            """{ "version": 1, "steps": [] }""", null);
        Assert.Equal(2, definition.Version); // steps changed

        definition.Update("Nouveau nom", "Une description", StudioWorkflowTriggerKind.OnUpdate, "{}",
            """{ "version": 1, "steps": [] }""", null);
        Assert.Equal(3, definition.Version); // trigger changed

        definition.Update("Nouveau nom", "Une description", StudioWorkflowTriggerKind.OnUpdate,
            """{ "field": "statut" }""", """{ "version": 1, "steps": [] }""", null);
        Assert.Equal(4, definition.Version); // trigger config changed
    }

    [Fact]
    public void Definition_soft_delete_sets_flags_and_keeps_row()
    {
        var definition = NewDefinition();
        var id = definition.Id;

        definition.SoftDelete(Guid.NewGuid());

        Assert.True(definition.IsDeleted);
        Assert.NotNull(definition.DeletedAt);
        Assert.False(definition.IsActive);
        Assert.Equal(id, definition.Id); // the row is kept, only flagged
        Assert.Equal("validation_conges", definition.Key);
    }

    [Fact]
    public void Instance_start_sets_running_and_depth()
    {
        var definition = NewDefinition();
        var recordId = Guid.NewGuid();
        var startedBy = Guid.NewGuid();
        var originId = Guid.NewGuid();

        var instance = StudioWorkflowInstance.Start(TenantId, definition, recordId,
            StudioWorkflowTriggerKind.Manual, startedBy, """{ "x": 1 }""", depth: 2, originInstanceId: originId);

        Assert.Equal(StudioWorkflowInstanceStatus.Running, instance.Status);
        Assert.Equal(2, instance.Depth);
        Assert.Equal(definition.Id, instance.WorkflowDefinitionId);
        Assert.Equal(definition.Version, instance.DefinitionVersion);
        Assert.Equal(definition.EntityDefinitionId, instance.EntityDefinitionId);
        Assert.Equal(recordId, instance.RecordId);
        Assert.Equal(StudioWorkflowTriggerKind.Manual, instance.TriggerKind);
        Assert.Equal(startedBy, instance.StartedBy);
        Assert.Equal(originId, instance.OriginInstanceId);
        Assert.Equal(0, instance.CurrentStepIndex);
        Assert.Null(instance.CompletedAt);
        Assert.False(instance.IsTerminal);
        Assert.True(instance.StartedAt > DateTime.MinValue);
    }

    [Fact]
    public void Instance_suspend_rejects_terminal_statuses()
    {
        var instance = NewInstance();

        // A terminal (or running) target status is not a valid suspension.
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            instance.Suspend(StudioWorkflowInstanceStatus.Completed, null, "{}"));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            instance.Suspend(StudioWorkflowInstanceStatus.Running, null, "{}"));

        var dueAt = DateTime.UtcNow.AddHours(2);
        instance.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, dueAt, """{ "s": 1 }""");
        Assert.Equal(StudioWorkflowInstanceStatus.WaitingApproval, instance.Status);
        Assert.Equal(dueAt, instance.DueAt);

        // A terminal instance can no longer be suspended.
        instance.Fail("boom");
        Assert.Throws<InvalidOperationException>(() =>
            instance.Suspend(StudioWorkflowInstanceStatus.Waiting, null, "{}"));
    }

    [Fact]
    public void Instance_try_lease_refuses_a_fresh_lease_and_accepts_an_expired_one()
    {
        var instance = NewInstance();
        var now = DateTime.UtcNow;
        var lease = TimeSpan.FromMinutes(5);

        Assert.True(instance.TryLease(now, lease)); // no lease yet
        Assert.Equal(now, instance.LeasedAt);

        Assert.False(instance.TryLease(now.AddMinutes(1), lease)); // still fresh
        Assert.Equal(now, instance.LeasedAt); // untouched

        Assert.True(instance.TryLease(now.AddMinutes(6), lease)); // expired → re-leased
        Assert.Equal(now.AddMinutes(6), instance.LeasedAt);

        instance.ReleaseLease();
        Assert.Null(instance.LeasedAt);
    }

    [Fact]
    public void Instance_fail_truncates_error_to_2000()
    {
        var instance = NewInstance();

        instance.Fail(new string('x', 5000));

        Assert.Equal(StudioWorkflowInstanceStatus.Failed, instance.Status);
        Assert.NotNull(instance.Error);
        Assert.Equal(StudioWorkflowInstance.ErrorMaxLength, instance.Error!.Length);
        Assert.True(instance.IsTerminal);
        Assert.NotNull(instance.CompletedAt);
    }

    [Fact]
    public void Instance_mark_due_sets_due_at_without_changing_status()
    {
        var instance = NewInstance();
        instance.Suspend(StudioWorkflowInstanceStatus.Waiting, DateTime.UtcNow.AddHours(1), "{}");

        var now = DateTime.UtcNow;
        instance.MarkDue(now);

        Assert.Equal(now, instance.DueAt);
        Assert.Equal(StudioWorkflowInstanceStatus.Waiting, instance.Status); // D20: status unchanged

        instance.Cancel("stop");
        Assert.Throws<InvalidOperationException>(() => instance.MarkDue(now)); // terminal rejected
    }

    [Fact]
    public void Step_run_stores_outcome_name()
    {
        var startedAt = DateTime.UtcNow;

        var run = StudioWorkflowStepRun.Record(TenantId, Guid.NewGuid(), 0, "verifier", "condition",
            StudioWorkflowStepRunStatus.Succeeded, StudioWorkflowStepOutcome.Goto, null,
            """{ "ok": true }""", null, startedAt, startedAt.AddMilliseconds(5), null);

        Assert.Equal("goto", run.Outcome); // snake_case name, not the enum integer
        Assert.Equal(StudioWorkflowStepRunStatus.Succeeded, run.Status);
        Assert.Equal("verifier", run.StepKey);

        var noOutcome = StudioWorkflowStepRun.Record(TenantId, Guid.NewGuid(), 1, "maj", "update_field",
            StudioWorkflowStepRunStatus.Failed, null, null, null, "boom", startedAt, startedAt, null);
        Assert.Null(noOutcome.Outcome);
        Assert.Equal("boom", noOutcome.Error);
    }

    [Fact]
    public void Approval_decide_requires_pending_and_records_decider()
    {
        var approval = StudioWorkflowApproval.Create(TenantId, Guid.NewGuid(), "approbation",
            Guid.NewGuid(), null, "Valider le congé", null, null);
        var decider = Guid.NewGuid();
        var now = DateTime.UtcNow;

        // Only Approved / Rejected are decisions.
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            approval.Decide(StudioWorkflowApprovalStatus.Pending, decider, null, now));

        approval.Decide(StudioWorkflowApprovalStatus.Approved, decider, "OK pour moi", now);
        Assert.Equal(StudioWorkflowApprovalStatus.Approved, approval.Status);
        Assert.Equal(decider, approval.DecidedBy);
        Assert.Equal(now, approval.DecidedAt);
        Assert.Equal("OK pour moi", approval.Comment);

        // Already decided → refused.
        Assert.Throws<InvalidOperationException>(() =>
            approval.Decide(StudioWorkflowApprovalStatus.Rejected, decider, null, now));
    }

    [Fact]
    public void Approval_can_be_decided_by_user_or_role_only()
    {
        var userId = Guid.NewGuid();
        var byUser = StudioWorkflowApproval.Create(TenantId, Guid.NewGuid(), "etape",
            userId, null, "t", null, null);
        Assert.True(byUser.CanBeDecidedBy(userId, null));
        Assert.False(byUser.CanBeDecidedBy(Guid.NewGuid(), null));
        Assert.False(byUser.CanBeDecidedBy(Guid.NewGuid(), "Administrator"));

        var byRole = StudioWorkflowApproval.Create(TenantId, Guid.NewGuid(), "etape",
            null, "Administrator", "t", null, null);
        Assert.True(byRole.CanBeDecidedBy(Guid.NewGuid(), "Administrator"));
        Assert.True(byRole.CanBeDecidedBy(Guid.NewGuid(), "administrator")); // role match is case-insensitive
        Assert.False(byRole.CanBeDecidedBy(Guid.NewGuid(), "User"));
        Assert.False(byRole.CanBeDecidedBy(Guid.NewGuid(), null));
    }
}
