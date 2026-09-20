using FactuTrust.Application.Common.Identity;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Identity;

public sealed class ImpersonatedUserContextTests
{
    private static ImpersonatedUserSnapshot Snapshot(string origin = "studio-workflow:test") =>
        new(Guid.NewGuid(), Guid.NewGuid(), null, UserRole.Accountant, new HashSet<string>(StringComparer.Ordinal), origin);

    [Fact]
    public void Current_is_null_by_default()
    {
        Assert.Null(ImpersonatedUserContext.Current);
    }

    [Fact]
    public void Enter_sets_current_and_dispose_restores_previous_value()
    {
        Assert.Null(ImpersonatedUserContext.Current);
        var snapshot = Snapshot();

        var scope = ImpersonatedUserContext.Enter(snapshot);
        Assert.Same(snapshot, ImpersonatedUserContext.Current);

        scope.Dispose();
        Assert.Null(ImpersonatedUserContext.Current);

        // Dispose idempotent : un second appel ne réécrit rien.
        using (ImpersonatedUserContext.Enter(Snapshot("outer")))
        {
            scope.Dispose();
            Assert.Equal("outer", ImpersonatedUserContext.Current?.Origin);
        }

        Assert.Throws<ArgumentNullException>(() => ImpersonatedUserContext.Enter(null!));
    }

    [Fact]
    public void Nested_enter_restores_outer_snapshot_in_order()
    {
        var outer = Snapshot("outer");
        var inner = Snapshot("inner");

        using (ImpersonatedUserContext.Enter(outer))
        {
            Assert.Same(outer, ImpersonatedUserContext.Current);

            using (ImpersonatedUserContext.Enter(inner))
            {
                Assert.Same(inner, ImpersonatedUserContext.Current);
            }

            Assert.Same(outer, ImpersonatedUserContext.Current);
        }

        Assert.Null(ImpersonatedUserContext.Current);
    }

    [Fact]
    public async Task Snapshot_flows_to_child_task_but_not_to_sibling_context()
    {
        var snapshot = Snapshot("flow");

        // Flux frère démarré AVANT l'entrée : il ne voit jamais l'instantané.
        var siblingStarted = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        var sibling = Task.Run(async () =>
        {
            siblingStarted.SetResult();
            await release.Task;
            return ImpersonatedUserContext.Current;
        });
        await siblingStarted.Task;

        ImpersonatedUserSnapshot? seenByChild;
        using (ImpersonatedUserContext.Enter(snapshot))
        {
            seenByChild = await Task.Run(() => ImpersonatedUserContext.Current);
        }

        release.SetResult();
        var seenBySibling = await sibling;

        Assert.Same(snapshot, seenByChild);
        Assert.Null(seenBySibling);
        Assert.Null(ImpersonatedUserContext.Current);
    }
}
