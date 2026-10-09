using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Accounting;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class BankGlTreasuryProjectionServiceTests
{
    private readonly Guid _companyId = Guid.NewGuid();
    private readonly string _dbName = $"BankGlProjection_{Guid.NewGuid():N}";
    private readonly InMemoryFactory _factory;

    public BankGlTreasuryProjectionServiceTests()
    {
        _factory = new InMemoryFactory(_dbName);
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankGlTreasuryProjectionService Service()
    {
        var companies = new Mock<IEnsureDefaultCompanyService>();
        companies.Setup(c => c.GetOrCreateDefaultCompanyIdAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(_companyId));
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.TenantId).Returns(Guid.NewGuid());
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");
        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        return new BankGlTreasuryProjectionService(
            _factory, companies.Object, user.Object, audit.Object,
            NullLogger<BankGlTreasuryProjectionService>.Instance);
    }

    private static ChartOfAccount Leaf(string number, string label, bool active = true)
    {
        var parent = number.StartsWith("5324", StringComparison.Ordinal) ? "5324" : "5321";
        var account = ChartOfAccount.Create(number, label, 5, parent, AccountNatureType.Debit, accountType: AccountType.Other).Value;
        if (!active)
            account.ToggleActive();
        return account;
    }

    [Fact]
    public async Task Ensure_53211_creates_tnd_projection_once()
    {
        var service = Service();
        var account = Leaf("53211", "Banque Biat");

        var first = await service.EnsureForChartAccountAsync(account, null, CancellationToken.None);
        var second = await service.EnsureForChartAccountAsync(account, null, CancellationToken.None);

        Assert.True(first.IsSuccess);
        Assert.Equal(1, first.Value.CreatedCount);
        Assert.Equal(0, second.Value.CreatedCount);
        Assert.Equal(1, second.Value.SkippedCount);

        await using var ctx = _factory.CreateContext();
        var bank = await ctx.BankAccounts.SingleAsync();
        Assert.Equal("53211", bank.ChartOfAccountNumber);
        Assert.Equal("TND", bank.Currency);
        Assert.False(bank.IsDefault);
        Assert.Equal("BIAT", bank.BankCode);
        Assert.Null(bank.Rib);
    }

    [Fact]
    public async Task Ensure_53241_uses_xxx_when_currency_missing()
    {
        var service = Service();
        var result = await service.EnsureForChartAccountAsync(Leaf("53241", "Compte devise"), null, CancellationToken.None);
        Assert.True(result.IsSuccess);

        await using var ctx = _factory.CreateContext();
        var bank = await ctx.BankAccounts.SingleAsync();
        Assert.Equal(BankGlAccountRules.UnspecifiedFxCurrency, bank.Currency);
    }

    [Fact]
    public async Task Non_bank_account_does_not_create_a_treasury_row()
    {
        var service = Service();
        var account = ChartOfAccount.Create("43671", "TVA", 4, null, AccountNatureType.Credit).Value;
        var result = await service.EnsureForChartAccountAsync(account, new BankGlProjectionIdentity { Rib = "08001000123456789012" }, CancellationToken.None);

        Assert.Equal(0, result.Value.CreatedCount);
        await using var ctx = _factory.CreateContext();
        Assert.Equal(0, await ctx.BankAccounts.CountAsync());
    }

    [Fact]
    public async Task EnsureMissing_backfills_existing_leaf_and_is_idempotent()
    {
        await using (var ctx = _factory.CreateContext())
        {
            ctx.ChartOfAccounts.Add(Leaf("53211", "Banque Biat"));
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create("5321", "Comptes en dinars", 5, "532", AccountNatureType.Debit, isSystem: true).Value);
            await ctx.SaveChangesAsync();
        }

        var service = Service();
        var first = await service.EnsureMissingAsync(CancellationToken.None);
        var second = await service.EnsureMissingAsync(CancellationToken.None);

        Assert.Equal(1, first.Value.CreatedCount);
        Assert.Equal(0, second.Value.CreatedCount);

        var list = await service.ListImportableAsync(CancellationToken.None);
        Assert.Contains(list.Value, a => a.ChartOfAccountNumber == "53211" && a.RibMasked == null);
    }

    [Fact]
    public async Task Toggle_off_hides_account_from_importable_list()
    {
        var service = Service();
        await service.EnsureForChartAccountAsync(Leaf("53211", "Banque Biat"), null, CancellationToken.None);
        await service.SyncActiveFlagAsync("53211", false, CancellationToken.None);

        var hidden = await service.ListImportableAsync(CancellationToken.None);
        Assert.Empty(hidden.Value);

        await service.SyncActiveFlagAsync("53211", true, CancellationToken.None);
        var shown = await service.ListImportableAsync(CancellationToken.None);
        Assert.Single(shown.Value);
    }

    [Fact]
    public async Task List_does_not_expose_clear_rib()
    {
        var rib = "08001000123456789012";
        var iban = FactuTrust.Domain.Banking.TunisianIban.FromRib(rib)!;
        var service = Service();
        await service.EnsureForChartAccountAsync(
            Leaf("53211", "Banque Biat"),
            new BankGlProjectionIdentity { Rib = rib, Iban = iban },
            CancellationToken.None);

        var list = await service.ListImportableAsync(CancellationToken.None);
        var row = Assert.Single(list.Value);
        Assert.True(row.HasBankingIdentity);
        Assert.DoesNotContain(rib, row.RibMasked ?? "", StringComparison.Ordinal);
        Assert.EndsWith(rib[^4..], row.RibMasked);
    }
}
