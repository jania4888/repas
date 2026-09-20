using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class AuditLogQueryServiceTests
{
    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;

        public TestTenantDbContextFactory(string databaseName)
        {
            _databaseName = databaseName;
        }

        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(_databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    [Fact]
    public async Task GetLogsAsync_Empty_ReturnsPagedResultWithZeroTotal()
    {
        var db = $"AuditTest_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var sut = new AuditLogQueryService(factory);
        var r = await sut.GetLogsAsync(null, null, null, null, null, 1, 25, CancellationToken.None);
        Assert.True(r.IsSuccess);
        Assert.Equal(0, r.Value.TotalCount);
        Assert.Empty(r.Value.Items);
        Assert.Equal(1, r.Value.Page);
        Assert.Equal(25, r.Value.PageSize);
    }

    [Fact]
    public async Task GetByIdAsync_Missing_ReturnsNotFound()
    {
        var db = $"AuditTest_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var sut = new AuditLogQueryService(factory);
        var r = await sut.GetByIdAsync(Guid.NewGuid(), CancellationToken.None);
        Assert.True(r.IsFailure);
        Assert.Equal($"{nameof(AuditLog)}.NotFound", r.Error.Code);
    }

    [Fact]
    public async Task VerifyChainAsync_Empty_IsValid()
    {
        var db = $"AuditVerify_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var sut = new AuditLogQueryService(factory);
        var r = await sut.VerifyChainAsync(CancellationToken.None);
        Assert.True(r.IsSuccess);
        Assert.True(r.Value.IsValid);
        Assert.Equal(0, r.Value.EntryCount);
        Assert.Equal(0, r.Value.DuplicatePreviousHashGroupCount);
    }

    [Fact]
    public async Task VerifyChainAsync_SequentialLogs_AfterRepair_IsValid()
    {
        var db = $"AuditVerify_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        await using (var ctx = factory.CreateContext())
        {
            var a = AuditLog.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                "u@x.com",
                "A1",
                "E",
                null,
                null,
                null,
                "127.0.0.1",
                null,
                "GENESIS");
            var b = AuditLog.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                "u@x.com",
                "A2",
                "E",
                null,
                null,
                null,
                "127.0.0.1",
                null,
                "WRONG");
            ctx.AuditLogs.AddRange(a, b);
            await ctx.SaveChangesAsync();
        }

        var r1 = await new AuditLogQueryService(factory).VerifyChainAsync(CancellationToken.None);
        Assert.True(r1.IsSuccess);
        Assert.False(r1.Value.IsValid);

        var repair = new AuditChainRepairService(factory);
        var repairResult = await repair.ResealChainAsync(CancellationToken.None);
        Assert.True(repairResult.IsSuccess);
        Assert.Equal(2, repairResult.Value);

        var r2 = await new AuditLogQueryService(factory).VerifyChainAsync(CancellationToken.None);
        Assert.True(r2.IsSuccess);
        Assert.True(r2.Value.IsValid);
        Assert.Equal(2, r2.Value.EntryCount);
    }
    // ---- 4.7 « v1.1 » hi-b2 : GetEntityHistoryAsync (historique d'un enregistrement, D5) ----

    private static AuditLog NewLog(Guid entityId, string action, DateTime createdAt, string entityType = "CustomRecord")
    {
        var log = AuditLog.Create(
            Guid.NewGuid(), Guid.NewGuid(), "u@x.com", action, entityType, entityId,
            "{\"a\":1}", "{\"a\":2}", "127.0.0.1", null, "GENESIS");
        typeof(FactuTrust.Domain.Common.Entity).GetProperty(nameof(FactuTrust.Domain.Common.Entity.CreatedAt))!
            .SetValue(log, createdAt);
        return log;
    }

    [Fact]
    public async Task GetEntityHistoryAsync_filters_by_type_and_id_and_orders_desc()
    {
        var db = $"AuditHist_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var target = Guid.NewGuid();
        var t0 = new DateTime(2026, 9, 18, 10, 0, 0, DateTimeKind.Utc);
        await using (var ctx = factory.CreateContext())
        {
            ctx.AuditLogs.Add(NewLog(target, "Studio.Record.Created", t0));
            ctx.AuditLogs.Add(NewLog(target, "Studio.Record.Updated", t0.AddMinutes(5)));
            ctx.AuditLogs.Add(NewLog(Guid.NewGuid(), "Studio.Record.Updated", t0.AddMinutes(6))); // autre enregistrement
            ctx.AuditLogs.Add(NewLog(target, "Invoice.Updated", t0.AddMinutes(7), "Invoice"));      // autre type
            await ctx.SaveChangesAsync();
        }
        var sut = new AuditLogQueryService(factory);

        var r = await sut.GetEntityHistoryAsync("CustomRecord", target, 1, 20, CancellationToken.None);

        Assert.True(r.IsSuccess);
        Assert.Equal(2, r.Value.TotalCount);
        Assert.Equal(2, r.Value.Items.Count);
        Assert.Equal("Studio.Record.Updated", r.Value.Items[0].Action);
        Assert.Equal("Studio.Record.Created", r.Value.Items[1].Action);
        Assert.Equal(t0.AddMinutes(5), r.Value.Items[0].CreatedAt);
    }

    [Fact]
    public async Task GetEntityHistoryAsync_pages_over_the_entity_history()
    {
        var db = $"AuditHist_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var target = Guid.NewGuid();
        var t0 = new DateTime(2026, 9, 18, 10, 0, 0, DateTimeKind.Utc);
        await using (var ctx = factory.CreateContext())
        {
            for (var i = 0; i < 3; i++)
                ctx.AuditLogs.Add(NewLog(target, $"A{i}", t0.AddMinutes(i)));
            await ctx.SaveChangesAsync();
        }
        var sut = new AuditLogQueryService(factory);

        var page2 = await sut.GetEntityHistoryAsync("CustomRecord", target, 2, 2, CancellationToken.None);

        Assert.True(page2.IsSuccess);
        Assert.Equal(3, page2.Value.TotalCount);
        var item = Assert.Single(page2.Value.Items);
        Assert.Equal("A0", item.Action); // plus ancien : dernier de l'ordre descendant
        Assert.Equal(2, page2.Value.Page);
        Assert.Equal(2, page2.Value.PageSize);
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(-3, 20)]
    [InlineData(500, 100)]
    [InlineData(5, 5)]
    public async Task GetEntityHistoryAsync_clamps_page_size_to_1_100_with_default_20(int requested, int expected)
    {
        var db = $"AuditHist_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var sut = new AuditLogQueryService(factory);

        var r = await sut.GetEntityHistoryAsync("CustomRecord", Guid.NewGuid(), 1, requested, CancellationToken.None);

        Assert.True(r.IsSuccess);
        Assert.Equal(expected, r.Value.PageSize);
        Assert.Equal(0, r.Value.TotalCount);
    }

    /// <summary>4.7 suite (R52, même motif que D-47-75) : <c>page</c> ≈ <c>int.MaxValue</c> ne fait plus déborder <c>(page - 1) * pageSize</c> de <c>GetLogsAsync</c> non plus.</summary>
    [Fact]
    public async Task GetLogsAsync_bounds_page_so_that_skip_never_overflows()
    {
        var db = $"AuditTest_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var sut = new AuditLogQueryService(factory);

        var r = await sut.GetLogsAsync(null, null, null, null, null, int.MaxValue, 200, CancellationToken.None);

        Assert.True(r.IsSuccess);
        Assert.Equal(int.MaxValue / 200, r.Value.Page);
        Assert.Equal(200, r.Value.PageSize);
        Assert.True((long)(r.Value.Page - 1) * r.Value.PageSize <= int.MaxValue, "le décalage doit rester un int");
        Assert.Empty(r.Value.Items);
        Assert.Equal(0, r.Value.TotalCount);
    }

    /// <summary>4.7★1 (D-47-75, R52) : <c>page</c> ≈ <c>int.MaxValue</c> ne fait plus déborder <c>(page - 1) * pageSize</c> (500 sur SQL Server).</summary>
    [Fact]
    public async Task GetEntityHistoryAsync_bounds_page_so_that_skip_never_overflows()
    {
        var db = $"AuditHist_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var target = Guid.NewGuid();
        await using (var ctx = factory.CreateContext())
        {
            ctx.AuditLogs.Add(NewLog(target, "A0", new DateTime(2026, 9, 18, 10, 0, 0, DateTimeKind.Utc)));
            await ctx.SaveChangesAsync();
        }
        var sut = new AuditLogQueryService(factory);

        var r = await sut.GetEntityHistoryAsync("CustomRecord", target, int.MaxValue, 100, CancellationToken.None);

        Assert.True(r.IsSuccess);
        Assert.Equal(int.MaxValue / 100, r.Value.Page);
        Assert.Equal(100, r.Value.PageSize);
        Assert.True((long)(r.Value.Page - 1) * r.Value.PageSize <= int.MaxValue, "le décalage doit rester un int");
        Assert.Empty(r.Value.Items);
        Assert.Equal(1, r.Value.TotalCount);
    }

    [Fact]
    public async Task GetEntityHistoryAsync_projects_internal_columns_only_and_keeps_values()
    {
        var db = $"AuditHist_{Guid.NewGuid()}";
        var factory = new TestTenantDbContextFactory(db);
        var target = Guid.NewGuid();
        await using (var ctx = factory.CreateContext())
        {
            ctx.AuditLogs.Add(NewLog(target, "Studio.Record.Deleted", DateTime.UtcNow));
            await ctx.SaveChangesAsync();
        }
        var sut = new AuditLogQueryService(factory);

        var r = await sut.GetEntityHistoryAsync("CustomRecord", target, 1, 20, CancellationToken.None);

        var row = Assert.Single(r.Value.Items);
        Assert.Equal("{\"a\":1}", row.OldValues);
        Assert.Equal("{\"a\":2}", row.NewValues);
        Assert.NotNull(row.UserId);
        // Projection interne : jamais d'IP, d'agent utilisateur ni de hash dans ce DTO.
        Assert.Null(typeof(FactuTrust.Application.DTOs.AuditEntityHistoryRowDto).GetProperty("IpAddress"));
        Assert.Null(typeof(FactuTrust.Application.DTOs.AuditEntityHistoryRowDto).GetProperty("UserAgent"));
        Assert.Null(typeof(FactuTrust.Application.DTOs.AuditEntityHistoryRowDto).GetProperty("Hash"));
    }

}
