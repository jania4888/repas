using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Repositories;

public sealed class CashOperationRepositoryTests : IDisposable
{
    private readonly string _databaseName;
    private readonly TestTenantDbContextFactory _contextFactory;
    private readonly CashOperationRepository _repository;

    public CashOperationRepositoryTests()
    {
        _databaseName = $"CashOperationTestDb_{Guid.NewGuid()}";
        _contextFactory = new TestTenantDbContextFactory(_databaseName);
        _repository = new CashOperationRepository(_contextFactory);
    }

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
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;

            return new TenantDbContext(options);
        }
    }

    [Fact]
    public async Task GetNonCancelledTotalsByMethodAsync_ShouldExcludeCancelledOperations()
    {
        var referenceDate = DateTime.UtcNow.Date.AddMonths(-1);
        if (referenceDate.Month == 1)
            referenceDate = referenceDate.AddMonths(-1);

        var year = referenceDate.Year;
        var month = referenceDate.Month;

        var monthStart = new DateTime(year, month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);

        var cashNumber = CashOperationNumber.Create("DEP", year, 1).Value;
        var bankNumber = CashOperationNumber.Create("DEP", year, 2).Value;
        var janCashNumber = CashOperationNumber.Create("DEP", year, 3).Value;

        var cashDay = Math.Min(DateTime.UtcNow.Day, DateTime.DaysInMonth(year, month));
        var bankDay = Math.Min(cashDay + 1, DateTime.DaysInMonth(year, month));

        var cash1 = CashOperation.Create(
            cashNumber,
            CashOperationType.Debit,
            new DateTime(year, month, Math.Max(1, cashDay)),
            PaymentMethod.Cash,
            Money.Create(100m, "TND"),
            "Dépense espèces",
            category: CashExpenseCategory.Other);

        var bank2 = CashOperation.Create(
            bankNumber,
            CashOperationType.Debit,
            new DateTime(year, month, Math.Max(1, bankDay)),
            PaymentMethod.BankTransfer,
            Money.Create(200m, "TND"),
            "Dépense virement",
            category: CashExpenseCategory.Other);

        var janCash = CashOperation.Create(
            janCashNumber,
            CashOperationType.Debit,
            new DateTime(year, 1, 5),
            PaymentMethod.Cash,
            Money.Create(50m, "TND"),
            "Dépense début d'année",
            category: CashExpenseCategory.Other);

        Assert.True(cash1.IsSuccess, cash1.Error?.Description);
        Assert.True(bank2.IsSuccess, bank2.Error?.Description);
        Assert.True(janCash.IsSuccess, janCash.Error?.Description);

        var opCash1 = cash1.Value;
        var opBank2 = bank2.Value;
        var opJanCash = janCash.Value;

        var cancelRes = opBank2.Cancel("Annulation test");
        Assert.True(cancelRes.IsSuccess, cancelRes.Error?.Description);

        await using (var context = _contextFactory.CreateContext())
        {
            context.CashOperations.AddRange(opCash1, opBank2, opJanCash);
            await context.SaveChangesAsync();
        }

        var totals = await _repository.GetNonCancelledTotalsByMethodAsync(monthStart, monthEnd);

        Assert.Equal(100m, totals[PaymentMethod.Cash]);
        Assert.False(totals.ContainsKey(PaymentMethod.BankTransfer));
        Assert.DoesNotContain(PaymentMethod.BankTransfer, totals.Keys);
    }

    [Fact]
    public async Task GetNonCancelledByDateRangeAsync_ShouldReturnOnlyNonCancelledOperationsWithPagination()
    {
        var referenceDate = DateTime.UtcNow.Date.AddMonths(-1);
        if (referenceDate.Month == 1)
            referenceDate = referenceDate.AddMonths(-1);

        var year = referenceDate.Year;
        var month = referenceDate.Month;
        var monthStart = new DateTime(year, month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);

        var cashNumber1 = CashOperationNumber.Create("DEP", year, 10).Value;
        var cashNumber2 = CashOperationNumber.Create("DEP", year, 11).Value;

        var cashDay1 = Math.Min(DateTime.UtcNow.Day, DateTime.DaysInMonth(year, month));
        var cashDay2 = Math.Min(cashDay1 + 1, DateTime.DaysInMonth(year, month));

        var op1 = CashOperation.Create(
            cashNumber1,
            CashOperationType.Debit,
            new DateTime(year, month, Math.Max(1, cashDay1)),
            PaymentMethod.Cash,
            Money.Create(20m, "TND"),
            "Op 1",
            category: CashExpenseCategory.Other);

        var op2 = CashOperation.Create(
            cashNumber2,
            CashOperationType.Debit,
            new DateTime(year, month, Math.Max(1, cashDay2)),
            PaymentMethod.Cash,
            Money.Create(30m, "TND"),
            "Op 2",
            category: CashExpenseCategory.Other);

        Assert.True(op1.IsSuccess);
        Assert.True(op2.IsSuccess);

        op2.Value.Cancel("Annulation test");

        await using (var context = _contextFactory.CreateContext())
        {
            context.CashOperations.AddRange(op1.Value, op2.Value);
            await context.SaveChangesAsync();
        }

        var (items, totalCount) = await _repository.GetNonCancelledByDateRangeAsync(monthStart, monthEnd, page: 1, pageSize: 10);

        Assert.Equal(1, totalCount);
        Assert.Single(items);
        Assert.Equal(op1.Value.Id, items[0].Id);
    }

    [Fact]
    public async Task GetNonCancelledTotalsByMethodAndTypeAsync_ShouldSeparateDebitsAndCredits()
    {
        var referenceDate = DateTime.UtcNow.Date.AddMonths(-1);
        if (referenceDate.Month == 1)
            referenceDate = referenceDate.AddMonths(-1);

        var year = referenceDate.Year;
        var month = referenceDate.Month;

        var monthStart = new DateTime(year, month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);

        var day = Math.Min(DateTime.UtcNow.Day, DateTime.DaysInMonth(year, month));

        var debitOp = CashOperation.Create(
            CashOperationNumber.Create("DEP", year, 1).Value,
            CashOperationType.Debit,
            new DateTime(year, month, Math.Max(1, day)),
            PaymentMethod.Cash,
            Money.Create(100m, "TND"),
            "Dépense espèces",
            category: CashExpenseCategory.Other);

        var creditOp = CashOperation.Create(
            CashOperationNumber.Create("ENC", year, 1).Value,
            CashOperationType.Credit,
            new DateTime(year, month, Math.Max(1, day)),
            PaymentMethod.Cash,
            Money.Create(250m, "TND"),
            "Encaissement ventes",
            revenueCategory: CashRevenueCategory.CashSalesReceipt);

        Assert.True(debitOp.IsSuccess);
        Assert.True(creditOp.IsSuccess);

        await using (var context = _contextFactory.CreateContext())
        {
            context.CashOperations.AddRange(debitOp.Value, creditOp.Value);
            await context.SaveChangesAsync();
        }

        var totals = await _repository.GetNonCancelledTotalsByMethodAndTypeAsync(monthStart, monthEnd);

        Assert.Equal(100m, totals[(PaymentMethod.Cash, CashOperationType.Debit)]);
        Assert.Equal(250m, totals[(PaymentMethod.Cash, CashOperationType.Credit)]);
    }

    [Fact]
    public async Task GetNetBalanceForMethodUpToDateAsync_UpToMidMonth_ExcludesLaterCreditsInSameMonth()
    {
        const int year = 2026;
        const int month = 3;

        var earlyCredit = CashOperation.Create(
            CashOperationNumber.Create("ENC", year, 1).Value,
            CashOperationType.Credit,
            new DateTime(year, month, 10),
            PaymentMethod.Cash,
            Money.Create(800m, "TND"),
            "Encaissement début mars",
            revenueCategory: CashRevenueCategory.CashSalesReceipt);

        var lateCredit = CashOperation.Create(
            CashOperationNumber.Create("ENC", year, 2).Value,
            CashOperationType.Credit,
            new DateTime(year, month, 27),
            PaymentMethod.Cash,
            Money.Create(500m, "TND"),
            "Encaissement fin mars",
            revenueCategory: CashRevenueCategory.ClientReceivablesReceipt);

        var debit = CashOperation.Create(
            CashOperationNumber.Create("DEP", year, 1).Value,
            CashOperationType.Debit,
            new DateTime(year, month, 5),
            PaymentMethod.Cash,
            Money.Create(175m, "TND"),
            "Dépense",
            category: CashExpenseCategory.Other);

        Assert.True(earlyCredit.IsSuccess);
        Assert.True(lateCredit.IsSuccess);
        Assert.True(debit.IsSuccess);

        await using (var context = _contextFactory.CreateContext())
        {
            context.CashOperations.AddRange(earlyCredit.Value, lateCredit.Value, debit.Value);
            await context.SaveChangesAsync();
        }

        var upTo15 = await _repository.GetNetBalanceForMethodUpToDateAsync(
            PaymentMethod.Cash,
            new DateTime(year, month, 15));

        Assert.Equal(625m, upTo15);

        var upTo31 = await _repository.GetNetBalanceForMethodUpToDateAsync(
            PaymentMethod.Cash,
            new DateTime(year, month, 31));

        Assert.Equal(1125m, upTo31);
    }

    [Fact]
    public async Task GetNetBalanceForMethodUpToDateAsync_IncludesAllYearsUpToDate()
    {
        const int year = 2026;

        var oldCredit = CashOperation.Create(
            CashOperationNumber.Create("ENC", year - 1, 1).Value,
            CashOperationType.Credit,
            new DateTime(year - 1, 6, 1),
            PaymentMethod.Check,
            Money.Create(100m, "TND"),
            "Ancien",
            revenueCategory: CashRevenueCategory.Other);

        var newDebit = CashOperation.Create(
            CashOperationNumber.Create("DEP", year, 1).Value,
            CashOperationType.Debit,
            new DateTime(year, 1, 10),
            PaymentMethod.Check,
            Money.Create(40m, "TND"),
            "Remise",
            category: CashExpenseCategory.Other);

        Assert.True(oldCredit.IsSuccess);
        Assert.True(newDebit.IsSuccess);

        await using (var context = _contextFactory.CreateContext())
        {
            context.CashOperations.AddRange(oldCredit.Value, newDebit.Value);
            await context.SaveChangesAsync();
        }

        var net = await _repository.GetNetBalanceForMethodUpToDateAsync(
            PaymentMethod.Check,
            new DateTime(year, 2, 1));

        Assert.Equal(60m, net);
    }

    [Fact]
    public async Task ExistsBySourceAsync_ShouldReturnTrueForLinkedOperation()
    {
        var opResult = CashOperation.CreateFromInvoicePayment(
            number: CashOperationNumber.Create("ENC", 2026, 1).Value,
            paymentId: Guid.NewGuid(),
            invoiceNumber: "FAC-2026-000001",
            amount: Money.Create(300m, "TND"),
            paymentDate: new DateTime(2026, 4, 20));

        Assert.True(opResult.IsSuccess, opResult.Error?.Description);
        var operation = opResult.Value;

        await using (var context = _contextFactory.CreateContext())
        {
            context.CashOperations.Add(operation);
            await context.SaveChangesAsync();
        }

        var exists = await _repository.ExistsBySourceAsync("Payment", operation.SourceId!.Value);
        var fetched = await _repository.GetBySourceAsync("Payment", operation.SourceId!.Value);

        Assert.True(exists);
        Assert.NotNull(fetched);
        Assert.Equal(operation.Id, fetched!.Id);
    }

    [Fact]
    public async Task GetNonCancelledJournal_ExcludesCancelled_GroupsCategories_AndOrdersChronologically()
    {
        var from = new DateTime(2026, 9, 1);
        var to = new DateTime(2026, 9, 30);

        var rent = CashOperation.Create(
            CashOperationNumber.Create("DEP", 2026, 1).Value,
            CashOperationType.Debit,
            new DateTime(2026, 9, 1),
            PaymentMethod.Cash,
            Money.Create(100m, "TND"),
            "Loyer",
            category: CashExpenseCategory.RentPayment).Value;

        var sales = CashOperation.Create(
            CashOperationNumber.Create("ENC", 2026, 1).Value,
            CashOperationType.Credit,
            new DateTime(2026, 9, 2),
            PaymentMethod.Cash,
            Money.Create(250m, "TND"),
            "Ventes",
            revenueCategory: CashRevenueCategory.CashSalesReceipt).Value;

        var deposit = CashOperation.Create(
            CashOperationNumber.Create("DEP", 2026, 2).Value,
            CashOperationType.Debit,
            new DateTime(2026, 9, 3),
            PaymentMethod.BankTransfer,
            Money.Create(40m, "TND"),
            "Remise",
            category: CashExpenseCategory.BankDeposit).Value;

        var cancelled = CashOperation.Create(
            CashOperationNumber.Create("ENC", 2026, 2).Value,
            CashOperationType.Credit,
            new DateTime(2026, 9, 3),
            PaymentMethod.Cash,
            Money.Create(15m, "TND"),
            "Annulé",
            revenueCategory: CashRevenueCategory.Other).Value;
        Assert.True(cancelled.Cancel("Annulation test").IsSuccess);

        var unclassified = CashOperation.Create(
            CashOperationNumber.Create("DEP", 2026, 3).Value,
            CashOperationType.Debit,
            new DateTime(2026, 9, 4),
            PaymentMethod.Cash,
            Money.Create(5m, "TND"),
            "Sans catégorie",
            category: CashExpenseCategory.Other).Value;
        typeof(CashOperation).GetProperty(nameof(CashOperation.Category))!.SetValue(unclassified, null);

        var outside = CashOperation.Create(
            CashOperationNumber.Create("DEP", 2026, 99).Value,
            CashOperationType.Debit,
            new DateTime(2026, 8, 31),
            PaymentMethod.Cash,
            Money.Create(999m, "TND"),
            "Hors période",
            category: CashExpenseCategory.Other).Value;

        await using (var context = _contextFactory.CreateContext())
        {
            context.CashOperations.AddRange(rent, sales, deposit, cancelled, unclassified, outside);
            await context.SaveChangesAsync();
        }

        var totals = await _repository.GetNonCancelledJournalCategoryTotalsAsync(from, to, method: null);
        var credits = totals.Where(t => t.OperationType == CashOperationType.Credit).Sum(t => t.Total);
        var debits = totals.Where(t => t.OperationType == CashOperationType.Debit).Sum(t => t.Total);
        Assert.Equal(250m, credits);
        Assert.Equal(145m, debits);

        var byMethod = await _repository.GetNonCancelledTotalsByMethodAndTypeAsync(from, to);
        var balanceCredits = byMethod.Where(kv => kv.Key.Type == CashOperationType.Credit).Sum(kv => kv.Value);
        var balanceDebits = byMethod.Where(kv => kv.Key.Type == CashOperationType.Debit).Sum(kv => kv.Value);
        Assert.Equal(credits, balanceCredits);
        Assert.Equal(debits, balanceDebits);
        Assert.Equal(credits - debits, balanceCredits - balanceDebits);
        Assert.Contains(totals, t =>
            t.OperationType == CashOperationType.Debit &&
            t.CategoryCode == (int)CashExpenseCategory.BankDeposit &&
            t.Total == 40m &&
            t.Count == 1);
        Assert.Contains(totals, t =>
            t.OperationType == CashOperationType.Debit &&
            t.CategoryCode is null &&
            t.Total == 5m);
        Assert.DoesNotContain(totals, t => t.Total == 15m || t.Total == 999m);

        var (page, totalCount) = await _repository.GetNonCancelledJournalLinesAsync(from, to, null, page: 1, pageSize: 1);
        Assert.Equal(4, totalCount);
        Assert.Single(page);
        Assert.Equal(rent.Id, page[0].Id);

        var (cashOnly, cashCount) = await _repository.GetNonCancelledJournalLinesAsync(
            from, to, PaymentMethod.Cash, page: 1, pageSize: 20);
        Assert.Equal(3, cashCount);
        Assert.DoesNotContain(cashOnly, op => op.Id == deposit.Id);
        Assert.Equal(new[] { rent.Id, sales.Id, unclassified.Id }, cashOnly.Select(op => op.Id).ToArray());
    }

    public void Dispose()
    {
        using var context = _contextFactory.CreateContext();
        context.Database.EnsureDeleted();
    }
}
