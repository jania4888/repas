using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// CWE-89 hardening: <c>Nct01ChartMigrationService.DistinctValuesAsync</c> interpolates
/// <c>table</c>/<c>column</c> into raw SQL text (bracket-quoted identifiers). The allow-list check
/// happens before any DB access, so an InMemory <see cref="TenantDbContext"/> is enough to exercise it
/// without a real SQL Server connection.
/// </summary>
public sealed class Nct01ChartMigrationServiceAllowListTests
{
    private static TenantDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase($"Nct01AllowList_{Guid.NewGuid():N}")
            .Options;
        return new TenantDbContext(options);
    }

    [Theory]
    [InlineData("JournalEntryLines", "AccountNumber")]
    [InlineData("BudgetPosts", "AccountPrefixes")]
    [InlineData("AccountingAnomalyLines", "AccountNumber")]
    [InlineData("MonthlyDeclarationRubricAccounts", "AccountNumber")]
    public void Allow_list_contains_known_call_site_pairs(string table, string column)
    {
        Assert.Contains((table, column), Nct01ChartMigrationService.DistinctValuesAllowList);
    }

    [Theory]
    [InlineData("Users", "PasswordHash")]
    [InlineData("JournalEntryLines", "TenantId")] // valid table, but not an allow-listed column
    [InlineData("JournalEntryLines]; DROP TABLE Users; --", "AccountNumber")]
    public async Task DistinctValuesAsync_rejects_table_column_pairs_outside_allow_list(string table, string column)
    {
        await using var db = CreateInMemoryContext();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Nct01ChartMigrationService.DistinctValuesAsync(db, table, column, CancellationToken.None));
    }
}
