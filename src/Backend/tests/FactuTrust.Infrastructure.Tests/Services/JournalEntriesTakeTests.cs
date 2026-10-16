using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// <c>take</c> limite les dernières pièces. Son absence restitue toute la période.
/// </summary>
public sealed class JournalEntriesTakeTests
{
    private readonly string _dbName = $"JournalTakeDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;

    public JournalEntriesTakeTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);
        using var ctx = _factory.CreateContext();
        for (var n = 1; n <= 31; n++)
        {
            ctx.JournalEntries.Add(MakeEntry(n));
        }

        ctx.SaveChanges();
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;
        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    private static JournalEntry MakeEntry(int number)
    {
        var lines = new[]
        {
            new JournalLineInput("4111", "Client", 10m, 0m, null, ThirdPartyKind.None),
            new JournalLineInput("707", "Vente", 0m, 10m, null, ThirdPartyKind.None)
        };
        var entry = JournalEntry.Create(
            number, "JV", new DateTime(2026, 5, 15), $"Vente {number}", Guid.NewGuid(),
            false, "Manual", null, lines, initialStatus: JournalEntryStatus.Validee).Value;
        entry.SetAuditInfo("test", false);
        return entry;
    }

    private AccountingReportingService Service()
        => new(_factory, Options.Create(new AccountingSettings { IncludeBrouillardInReports = true }));

    private static readonly DateTime From = new(2026, 1, 1);
    private static readonly DateTime To = new(2026, 12, 31);

    [Fact]
    public async Task WithoutTake_ReturnsTheWholePeriod()
    {
        var result = await Service().GetJournalEntriesAsync(null, From, To);

        Assert.True(result.IsSuccess);
        Assert.Equal(31, result.Value.Count);
        Assert.Equal(31, result.Value[0].EntryNumber);
        Assert.Equal(1, result.Value[^1].EntryNumber);
    }

    [Fact]
    public async Task Take_LimitsToTheNewestEntries()
    {
        var result = await Service().GetJournalEntriesAsync(null, From, To, take: 2);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Count);
        Assert.Equal(31, result.Value[0].EntryNumber);
        Assert.Equal(30, result.Value[1].EntryNumber);
    }

    [Fact]
    public async Task Take_IsClampedToThirty()
    {
        var result = await Service().GetJournalEntriesAsync(null, From, To, take: 100);

        Assert.True(result.IsSuccess);
        Assert.Equal(30, result.Value.Count);
        Assert.Equal(31, result.Value[0].EntryNumber);
        Assert.DoesNotContain(result.Value, e => e.EntryNumber == 1);
    }
}
