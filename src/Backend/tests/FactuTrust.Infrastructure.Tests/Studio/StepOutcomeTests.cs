using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StepOutcomeTests
{
    public static IEnumerable<object[]> KindCases()
    {
        yield return new object[] { new StepOutcome.Continue(), StudioWorkflowStepOutcome.Continue };
        yield return new object[] { new StepOutcome.Skip("condition non remplie"), StudioWorkflowStepOutcome.Skip };
        yield return new object[] { new StepOutcome.Goto("etape_2"), StudioWorkflowStepOutcome.Goto };
        yield return new object[] { new StepOutcome.Stop("fin anticipée"), StudioWorkflowStepOutcome.Stop };
        yield return new object[] { new StepOutcome.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, null), StudioWorkflowStepOutcome.Suspend };
        yield return new object[] { new StepOutcome.Fail("boom"), StudioWorkflowStepOutcome.Fail };
    }

    [Theory]
    [MemberData(nameof(KindCases))]
    public void Kind_maps_each_outcome_to_its_enum_value(StepOutcome outcome, StudioWorkflowStepOutcome expected)
    {
        Assert.Equal(expected, outcome.Kind);
    }

    [Fact]
    public void Fail_defaults_to_not_continue()
    {
        var fail = new StepOutcome.Fail("boom");

        Assert.Equal("boom", fail.Error);
        Assert.False(fail.ContinueAnyway);
    }
}
