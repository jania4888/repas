namespace FactuTrust.Domain.Enums;

/// <summary>When a Studio workflow fires on a record of its table.</summary>
public enum StudioWorkflowTriggerKind
{
    /// <summary>Runs right after a record is created.</summary>
    OnCreate = 0,

    /// <summary>Runs right after a record is updated.</summary>
    OnUpdate = 1,

    /// <summary>Runs when a configured field changes value.</summary>
    FieldChanged = 2,

    /// <summary>Runs only when explicitly started by a user on a record.</summary>
    Manual = 3,

    /// <summary>Runs on the <c>triggerConfig.cron</c> schedule (UTC), one instance per record matching <c>triggerConfig.filters</c> (4.7b1, D5 levé).</summary>
    Scheduled = 4
}

/// <summary>Lifecycle status of a running Studio workflow instance.</summary>
public enum StudioWorkflowInstanceStatus
{
    Running = 0,

    /// <summary>Suspended until a due date (wait step) — resumed by the deferred job.</summary>
    Waiting = 1,

    /// <summary>Suspended until an approval is decided.</summary>
    WaitingApproval = 2,

    Completed = 3,
    Failed = 4,
    Cancelled = 5
}

/// <summary>Outcome status of one step execution (append-only step run).</summary>
public enum StudioWorkflowStepRunStatus
{
    Succeeded = 0,
    Skipped = 1,
    Failed = 2,

    /// <summary>The step suspended the instance (wait / approval).</summary>
    Suspended = 3
}

/// <summary>Status of an approval request emitted by a workflow step.</summary>
public enum StudioWorkflowApprovalStatus
{
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Cancelled = 3,
    Expired = 4
}

/// <summary>What the engine should do after a step (D6) — stored as its snake_case name.</summary>
public enum StudioWorkflowStepOutcome
{
    Continue = 0,
    Skip = 1,
    Goto = 2,
    Stop = 3,
    Suspend = 4,
    Fail = 5
}

/// <summary>
/// Frozen snake_case API/database names of the Studio workflow enums. These strings are persisted
/// (e.g. step-run <c>Outcome</c> column) and exchanged with the frontend — never rename them.
/// </summary>
public static class StudioWorkflowEnumNames
{
    public static string TriggerName(StudioWorkflowTriggerKind kind) => kind switch
    {
        StudioWorkflowTriggerKind.OnCreate => "on_create",
        StudioWorkflowTriggerKind.OnUpdate => "on_update",
        StudioWorkflowTriggerKind.FieldChanged => "field_changed",
        StudioWorkflowTriggerKind.Manual => "manual",
        StudioWorkflowTriggerKind.Scheduled => "scheduled",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null)
    };

    public static bool TryParseTrigger(string? value, out StudioWorkflowTriggerKind kind)
    {
        foreach (var candidate in Enum.GetValues<StudioWorkflowTriggerKind>())
        {
            if (string.Equals(TriggerName(candidate), value, StringComparison.OrdinalIgnoreCase))
            {
                kind = candidate;
                return true;
            }
        }

        kind = default;
        return false;
    }

    public static string InstanceStatusName(StudioWorkflowInstanceStatus status) => status switch
    {
        StudioWorkflowInstanceStatus.Running => "running",
        StudioWorkflowInstanceStatus.Waiting => "waiting",
        StudioWorkflowInstanceStatus.WaitingApproval => "waiting_approval",
        StudioWorkflowInstanceStatus.Completed => "completed",
        StudioWorkflowInstanceStatus.Failed => "failed",
        StudioWorkflowInstanceStatus.Cancelled => "cancelled",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, null)
    };

    public static string StepRunStatusName(StudioWorkflowStepRunStatus status) => status switch
    {
        StudioWorkflowStepRunStatus.Succeeded => "succeeded",
        StudioWorkflowStepRunStatus.Skipped => "skipped",
        StudioWorkflowStepRunStatus.Failed => "failed",
        StudioWorkflowStepRunStatus.Suspended => "suspended",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, null)
    };

    public static string ApprovalStatusName(StudioWorkflowApprovalStatus status) => status switch
    {
        StudioWorkflowApprovalStatus.Pending => "pending",
        StudioWorkflowApprovalStatus.Approved => "approved",
        StudioWorkflowApprovalStatus.Rejected => "rejected",
        StudioWorkflowApprovalStatus.Cancelled => "cancelled",
        StudioWorkflowApprovalStatus.Expired => "expired",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, null)
    };

    public static bool TryParseApprovalStatus(string? value, out StudioWorkflowApprovalStatus status)
    {
        foreach (var candidate in Enum.GetValues<StudioWorkflowApprovalStatus>())
        {
            if (string.Equals(ApprovalStatusName(candidate), value, StringComparison.OrdinalIgnoreCase))
            {
                status = candidate;
                return true;
            }
        }

        status = default;
        return false;
    }

    public static string OutcomeName(StudioWorkflowStepOutcome outcome) => outcome switch
    {
        StudioWorkflowStepOutcome.Continue => "continue",
        StudioWorkflowStepOutcome.Skip => "skip",
        StudioWorkflowStepOutcome.Goto => "goto",
        StudioWorkflowStepOutcome.Stop => "stop",
        StudioWorkflowStepOutcome.Suspend => "suspend",
        StudioWorkflowStepOutcome.Fail => "fail",
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, null)
    };
}
