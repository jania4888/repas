using FactuTrust.Application.Features.Studio.Common;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>Clés Studio : noms de systèmes réservés (littéraux de route, PR 3.3 tranche 3.3d).</summary>
public sealed class StudioKeyTests
{
    [Fact]
    public void Import_is_a_reserved_system_key()
    {
        Assert.True(StudioKey.IsReservedSystemKey("import"));
        Assert.True(StudioKey.IsReservedSystemKey("Import"));
        Assert.False(StudioKey.IsReservedSystemKey("imports"));
    }
}
