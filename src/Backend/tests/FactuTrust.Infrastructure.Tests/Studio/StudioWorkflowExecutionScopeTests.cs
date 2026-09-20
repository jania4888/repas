using FactuTrust.Application.Features.Studio.Workflows.Engine;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioWorkflowExecutionScopeTests
{
    [Fact]
    public void Current_is_null_outside_a_scope()
    {
        Assert.Null(StudioWorkflowExecutionScope.Current);
    }

    [Fact]
    public void Enter_sets_origin_and_depth_and_dispose_restores_previous()
    {
        Assert.Null(StudioWorkflowExecutionScope.Current);
        var origin = Guid.NewGuid();

        var scope = StudioWorkflowExecutionScope.Enter(origin, 1);

        var marker = Assert.IsType<StudioWorkflowExecutionMarker>(StudioWorkflowExecutionScope.Current);
        Assert.Equal(origin, marker.OriginInstanceId);
        Assert.Equal(1, marker.Depth);

        scope.Dispose();

        Assert.Null(StudioWorkflowExecutionScope.Current);
    }

    [Fact]
    public void Nested_scopes_restore_in_order()
    {
        var outer = Guid.NewGuid();
        var inner = Guid.NewGuid();

        using (StudioWorkflowExecutionScope.Enter(outer, 1))
        {
            Assert.Equal(outer, StudioWorkflowExecutionScope.Current?.OriginInstanceId);

            using (StudioWorkflowExecutionScope.Enter(inner, 2))
            {
                var marker = StudioWorkflowExecutionScope.Current;
                Assert.Equal(inner, marker?.OriginInstanceId);
                Assert.Equal(2, marker?.Depth);
            }

            var restored = StudioWorkflowExecutionScope.Current;
            Assert.Equal(outer, restored?.OriginInstanceId);
            Assert.Equal(1, restored?.Depth);
        }

        Assert.Null(StudioWorkflowExecutionScope.Current);
    }

    [Fact]
    public async Task Scope_flows_to_child_tasks_but_not_to_the_parent()
    {
        var origin = Guid.NewGuid();
        using (StudioWorkflowExecutionScope.Enter(origin, 1))
        {
            // AsyncLocal flows into the child task.
            var observedInChild = await Task.Run(() => StudioWorkflowExecutionScope.Current);
            Assert.Equal(origin, observedInChild?.OriginInstanceId);
            Assert.Equal(1, observedInChild?.Depth);
        }

        // A scope entered inside a child task never flows back to this flow.
        await Task.Run(() =>
        {
            using (StudioWorkflowExecutionScope.Enter(Guid.NewGuid(), 2))
            {
                Assert.NotNull(StudioWorkflowExecutionScope.Current);
            }
        });
        Assert.Null(StudioWorkflowExecutionScope.Current);
    }

    [Fact]
    public void Max_depth_is_two()
    {
        Assert.Equal(2, StudioWorkflowExecutionScope.MaxDepth);
    }
}
