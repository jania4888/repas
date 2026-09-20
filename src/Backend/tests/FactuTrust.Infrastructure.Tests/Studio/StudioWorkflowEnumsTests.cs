using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioWorkflowEnumsTests
{
    [Fact]
    public void Trigger_names_are_snake_case_and_round_trip()
    {
        Assert.Equal("on_create", StudioWorkflowEnumNames.TriggerName(StudioWorkflowTriggerKind.OnCreate));
        Assert.Equal("on_update", StudioWorkflowEnumNames.TriggerName(StudioWorkflowTriggerKind.OnUpdate));
        Assert.Equal("field_changed", StudioWorkflowEnumNames.TriggerName(StudioWorkflowTriggerKind.FieldChanged));
        Assert.Equal("manual", StudioWorkflowEnumNames.TriggerName(StudioWorkflowTriggerKind.Manual));
        Assert.Equal("scheduled", StudioWorkflowEnumNames.TriggerName(StudioWorkflowTriggerKind.Scheduled));

        foreach (var kind in Enum.GetValues<StudioWorkflowTriggerKind>())
        {
            Assert.True(StudioWorkflowEnumNames.TryParseTrigger(StudioWorkflowEnumNames.TriggerName(kind), out var parsed));
            Assert.Equal(kind, parsed);
        }

        Assert.True(StudioWorkflowEnumNames.TryParseTrigger("ON_CREATE", out var upper));
        Assert.Equal(StudioWorkflowTriggerKind.OnCreate, upper);
        Assert.False(StudioWorkflowEnumNames.TryParseTrigger("onCreate", out _));
        Assert.False(StudioWorkflowEnumNames.TryParseTrigger(null, out _));
        Assert.False(StudioWorkflowEnumNames.TryParseTrigger("", out _));
    }

    [Fact]
    public void Instance_status_names_are_snake_case()
    {
        Assert.Equal("running", StudioWorkflowEnumNames.InstanceStatusName(StudioWorkflowInstanceStatus.Running));
        Assert.Equal("waiting", StudioWorkflowEnumNames.InstanceStatusName(StudioWorkflowInstanceStatus.Waiting));
        Assert.Equal("waiting_approval", StudioWorkflowEnumNames.InstanceStatusName(StudioWorkflowInstanceStatus.WaitingApproval));
        Assert.Equal("completed", StudioWorkflowEnumNames.InstanceStatusName(StudioWorkflowInstanceStatus.Completed));
        Assert.Equal("failed", StudioWorkflowEnumNames.InstanceStatusName(StudioWorkflowInstanceStatus.Failed));
        Assert.Equal("cancelled", StudioWorkflowEnumNames.InstanceStatusName(StudioWorkflowInstanceStatus.Cancelled));
    }

    [Fact]
    public void Approval_status_names_round_trip()
    {
        Assert.Equal("pending", StudioWorkflowEnumNames.ApprovalStatusName(StudioWorkflowApprovalStatus.Pending));
        Assert.Equal("approved", StudioWorkflowEnumNames.ApprovalStatusName(StudioWorkflowApprovalStatus.Approved));
        Assert.Equal("rejected", StudioWorkflowEnumNames.ApprovalStatusName(StudioWorkflowApprovalStatus.Rejected));
        Assert.Equal("cancelled", StudioWorkflowEnumNames.ApprovalStatusName(StudioWorkflowApprovalStatus.Cancelled));
        Assert.Equal("expired", StudioWorkflowEnumNames.ApprovalStatusName(StudioWorkflowApprovalStatus.Expired));

        foreach (var status in Enum.GetValues<StudioWorkflowApprovalStatus>())
        {
            Assert.True(StudioWorkflowEnumNames.TryParseApprovalStatus(
                StudioWorkflowEnumNames.ApprovalStatusName(status).ToUpperInvariant(), out var parsed));
            Assert.Equal(status, parsed);
        }

        Assert.False(StudioWorkflowEnumNames.TryParseApprovalStatus("unknown", out _));
        Assert.False(StudioWorkflowEnumNames.TryParseApprovalStatus(null, out _));
    }

    [Fact]
    public void Outcome_names_fit_the_sixteen_character_column()
    {
        Assert.Equal("continue", StudioWorkflowEnumNames.OutcomeName(StudioWorkflowStepOutcome.Continue));
        Assert.Equal("skip", StudioWorkflowEnumNames.OutcomeName(StudioWorkflowStepOutcome.Skip));
        Assert.Equal("goto", StudioWorkflowEnumNames.OutcomeName(StudioWorkflowStepOutcome.Goto));
        Assert.Equal("stop", StudioWorkflowEnumNames.OutcomeName(StudioWorkflowStepOutcome.Stop));
        Assert.Equal("suspend", StudioWorkflowEnumNames.OutcomeName(StudioWorkflowStepOutcome.Suspend));
        Assert.Equal("fail", StudioWorkflowEnumNames.OutcomeName(StudioWorkflowStepOutcome.Fail));

        foreach (var outcome in Enum.GetValues<StudioWorkflowStepOutcome>())
        {
            var name = StudioWorkflowEnumNames.OutcomeName(outcome);
            Assert.True(name.Length <= StudioWorkflowStepRun.OutcomeMaxLength,
                $"Outcome name '{name}' exceeds the {StudioWorkflowStepRun.OutcomeMaxLength}-character column.");
            Assert.Equal(name, name.ToLowerInvariant());
        }

        Assert.Throws<ArgumentOutOfRangeException>(() => StudioWorkflowEnumNames.OutcomeName((StudioWorkflowStepOutcome)42));
    }

    [Fact]
    public void Numeric_values_are_frozen()
    {
        Assert.Equal(0, (int)StudioWorkflowTriggerKind.OnCreate);
        Assert.Equal(1, (int)StudioWorkflowTriggerKind.OnUpdate);
        Assert.Equal(2, (int)StudioWorkflowTriggerKind.FieldChanged);
        Assert.Equal(3, (int)StudioWorkflowTriggerKind.Manual);
        Assert.Equal(4, (int)StudioWorkflowTriggerKind.Scheduled);

        Assert.Equal(0, (int)StudioWorkflowInstanceStatus.Running);
        Assert.Equal(1, (int)StudioWorkflowInstanceStatus.Waiting);
        Assert.Equal(2, (int)StudioWorkflowInstanceStatus.WaitingApproval);
        Assert.Equal(3, (int)StudioWorkflowInstanceStatus.Completed);
        Assert.Equal(4, (int)StudioWorkflowInstanceStatus.Failed);
        Assert.Equal(5, (int)StudioWorkflowInstanceStatus.Cancelled);

        Assert.Equal(0, (int)StudioWorkflowStepRunStatus.Succeeded);
        Assert.Equal(1, (int)StudioWorkflowStepRunStatus.Skipped);
        Assert.Equal(2, (int)StudioWorkflowStepRunStatus.Failed);
        Assert.Equal(3, (int)StudioWorkflowStepRunStatus.Suspended);

        Assert.Equal(0, (int)StudioWorkflowApprovalStatus.Pending);
        Assert.Equal(1, (int)StudioWorkflowApprovalStatus.Approved);
        Assert.Equal(2, (int)StudioWorkflowApprovalStatus.Rejected);
        Assert.Equal(3, (int)StudioWorkflowApprovalStatus.Cancelled);
        Assert.Equal(4, (int)StudioWorkflowApprovalStatus.Expired);

        Assert.Equal(0, (int)StudioWorkflowStepOutcome.Continue);
        Assert.Equal(1, (int)StudioWorkflowStepOutcome.Skip);
        Assert.Equal(2, (int)StudioWorkflowStepOutcome.Goto);
        Assert.Equal(3, (int)StudioWorkflowStepOutcome.Stop);
        Assert.Equal(4, (int)StudioWorkflowStepOutcome.Suspend);
        Assert.Equal(5, (int)StudioWorkflowStepOutcome.Fail);
    }

    [Fact]
    public void Legacy_automation_trigger_is_unchanged()
    {
        Assert.Equal(0, (int)StudioAutomationTrigger.OnCreate);
        Assert.Equal(1, (int)StudioAutomationTrigger.OnUpdate);
        Assert.Equal(2, (int)StudioAutomationTrigger.Manual);
        Assert.Equal(3, (int)StudioAutomationTrigger.Scheduled);
    }
}
