using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.Billing;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// 4.7 suite (R52, motif D-45-28 / D-47-75) : « page » ≈ int.MaxValue ne doit plus faire déborder
/// « (page - 1) * pageSize » (Skip négatif ⇒ 500 sur SQL Server) dans les services paginés de la
/// base master. Chaque service borne désormais page à « int.MaxValue / taille max » : avec
/// page = int.MaxValue et la taille maximale, le service doit RÉPONDRE une page vide (au lieu de
/// lever) — l'exception InMemory (« offset must not be negative ») est exactement ce que SQL Server
/// rejette quand le décalage déborde.
/// </summary>
public sealed class PagingOverflowGuardTests
{
    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase($"PagingGuard_{Guid.NewGuid()}")
            .Options;
        return new MasterDbContext(options);
    }

    [Fact]
    public async Task CouponAdminService_ListAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new CouponAdminService(db).ListAsync(null, null, int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task NotificationService_GetListAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new NotificationService(db).GetListAsync(Guid.NewGuid(), null, false, int.MaxValue, 50, null, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task EmailMessageQueryService_ListAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new EmailMessageQueryService(db, Mock.Of<IBackgroundJobClient>())
            .ListAsync(null, null, null, int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task FailedLoginAttemptService_ListAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new FailedLoginAttemptService(db).ListAsync(null, null, null, null, int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task UserSessionService_ListPlatformSessionsAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new UserSessionService(db).ListPlatformSessionsAsync(null, int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task UserSessionService_ListByUserAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new UserSessionService(db).ListByUserAsync(Guid.NewGuid(), int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task PaymentIntentQueryService_ListAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new PaymentIntentQueryService(db).ListAsync(null, null, null, null, null, int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task DunningStateQueryService_ListAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new DunningStateQueryService(db).ListAsync(null, null, int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task TenantCreditAdminService_ListAllAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new TenantCreditAdminService(db).ListAllAsync(null, int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task TenantCreditAdminService_ListByTenantAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new TenantCreditAdminService(db).ListByTenantAsync(Guid.NewGuid(), int.MaxValue, 200, CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }

    [Fact]
    public async Task PlatformTenantQueryService_ListAsync_bounds_page()
    {
        await using var db = BuildMaster();
        var r = await new PlatformTenantQueryService(db).ListAsync(
            new FactuTrust.Application.DTOs.PlatformTenantListQuery { Page = int.MaxValue, PageSize = 100 },
            CancellationToken.None);
        Assert.Equal(0, r.TotalCount);
        Assert.Empty(r.Items);
    }
}
