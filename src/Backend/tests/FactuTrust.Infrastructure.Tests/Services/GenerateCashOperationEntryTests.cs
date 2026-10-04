using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Écritures générées par <see cref="AccountingService.GenerateCashOperationEntryAsync"/> :
/// mapping NCT 01, routage trésorerie 5411/5321, NetSalaries conditionnel, idempotence, skip
/// BankDeposit, statut Brouillon/Validee, et décomposition TVA à 3 lignes (plan §9.2 + §9.5).
/// </summary>
public sealed class GenerateCashOperationEntryTests
{
    private static ChartOfAccount Acc(string number) =>
        ChartOfAccount.Create(number, $"Compte {number}", int.Parse(number[..1].ToString()), null, AccountNatureType.Debit).Value;

    private static (AccountingService service, Mock<IJournalEntryRepository> journals, List<JournalEntry> captured) BuildService(
        JournalEntry? existingBySource = null,
        bool brouillardEnabled = false,
        bool cashDeskVatEnabled = false,
        bool payrollCycleExists = false)
    {
        var chart = new Mock<IChartOfAccountRepository>();
        chart.Setup(x => x.CountAsync(It.IsAny<CancellationToken>())).ReturnsAsync(50);
        chart.Setup(x => x.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string n, CancellationToken _) => Acc(n));

        var periodService = new Mock<IAccountingPeriodService>();
        var period = AccountingPeriod.Create(2026, 4, new DateTime(2026, 4, 1), new DateTime(2026, 4, 30));
        periodService.Setup(x => x.EnsureOpenPeriodAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(period));

        var journals = new Mock<IJournalEntryRepository>();
        journals.Setup(x => x.GetBySourceAsync(It.IsAny<string>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingBySource);
        journals.Setup(x => x.ExistsActiveBySourceTypeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(payrollCycleExists);
        journals.Setup(x => x.ReserveNextEntryNumberAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(7);
        var captured = new List<JournalEntry>();
        journals.Setup(x => x.AddAsync(It.IsAny<JournalEntry>(), It.IsAny<CancellationToken>()))
            .Callback<JournalEntry, CancellationToken>((e, _) => captured.Add(e))
            .ReturnsAsync((JournalEntry e, CancellationToken _) => e);

        var withholding = new Mock<IWithholdingTaxRepository>();
        var ctxFactory = new Mock<ITenantDbContextFactory>();
        var settings = Options.Create(new AccountingSettings
        {
            BrouillardEnabled = brouillardEnabled,
            CashDeskVatEnabled = cashDeskVatEnabled
        });

        var service = new AccountingService(
            chart.Object, periodService.Object, journals.Object, withholding.Object,
            new Mock<IDepreciationRateCategoryRepository>().Object,
            ctxFactory.Object, NullLogger<AccountingService>.Instance, settings);

        return (service, journals, captured);
    }

    private static CashOperation Debit(
        PaymentMethod method,
        CashExpenseCategory category,
        decimal amount = 100m,
        string prefix = CashOperationNumber.DebitPrefix)
    {
        var number = CashOperationNumber.Create(prefix, 2026, 1).Value;
        return CashOperation.Create(
            number,
            CashOperationType.Debit,
            new DateTime(2026, 4, 10),
            method,
            Money.Create(amount, Money.DefaultCurrency),
            label: "Test décaissement",
            category: category).Value;
    }

    private static CashOperation Credit(
        PaymentMethod method,
        CashRevenueCategory category,
        decimal amount = 100m,
        VatRate? vatRate = null)
    {
        var number = CashOperationNumber.Create(CashOperationNumber.CreditPrefix, 2026, 1).Value;
        return CashOperation.Create(
            number,
            CashOperationType.Credit,
            new DateTime(2026, 4, 10),
            method,
            Money.Create(amount, Money.DefaultCurrency),
            label: "Test encaissement",
            revenueCategory: category,
            vatRate: vatRate).Value;
    }

    // ─────────────── §9.2 Mapping / routage trésorerie ───────────────

    [Fact]
    public async Task Debit_Cash_Insurance_ProducesTwoLines_616Debit_5411Credit()
    {
        var (service, _, captured) = BuildService();
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.Insurance, 100m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.JournalCode.Should().Be("JC");
        entry.SourceEntityType.Should().Be(AccountingService.SourceCashOperation);
        entry.Lines.Should().HaveCount(2);
        var debit = entry.Lines.Single(l => l.DebitAmount.Amount > 0);
        var credit = entry.Lines.Single(l => l.CreditAmount.Amount > 0);
        debit.AccountNumber.Should().Be("616");
        debit.DebitAmount.Amount.Should().Be(100m);
        credit.AccountNumber.Should().Be("5411");
        credit.CreditAmount.Amount.Should().Be(100m);
    }

    [Fact]
    public async Task Debit_BankTransfer_ProducesTreasuryOn5321()
    {
        var (service, _, captured) = BuildService();
        var operation = Debit(PaymentMethod.BankTransfer, CashExpenseCategory.Insurance, 100m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        var credit = entry.Lines.Single(l => l.CreditAmount.Amount > 0);
        credit.AccountNumber.Should().Be("5321");
    }

    [Fact]
    public async Task Credit_Cash_ClientReceivablesReceipt_Debits5411_Credits4111()
    {
        var (service, _, captured) = BuildService();
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.ClientReceivablesReceipt, 200m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        var debit = entry.Lines.Single(l => l.DebitAmount.Amount > 0);
        var credit = entry.Lines.Single(l => l.CreditAmount.Amount > 0);
        debit.AccountNumber.Should().Be("5411");
        credit.AccountNumber.Should().Be("4111");
    }

    [Fact]
    public async Task Credit_Check_PartnerContributionsReceipt_Debits5321_Credits446()
    {
        var (service, _, captured) = BuildService();
        var operation = Credit(PaymentMethod.Check, CashRevenueCategory.PartnerContributionsReceipt, 300m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        var debit = entry.Lines.Single(l => l.DebitAmount.Amount > 0);
        var credit = entry.Lines.Single(l => l.CreditAmount.Amount > 0);
        debit.AccountNumber.Should().Be("5321");
        credit.AccountNumber.Should().Be("446");
    }

    [Fact]
    public async Task NetSalaries_NoPayrollCycle_Debits640()
    {
        var (service, _, captured) = BuildService(payrollCycleExists: false);
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.NetSalaries, 500m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        var debit = entry.Lines.Single(l => l.DebitAmount.Amount > 0);
        debit.AccountNumber.Should().Be("640");
    }

    [Fact]
    public async Task NetSalaries_WithPayrollCycle_Debits425()
    {
        var (service, journals, captured) = BuildService(payrollCycleExists: true);
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.NetSalaries, 500m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        var debit = entry.Lines.Single(l => l.DebitAmount.Amount > 0);
        debit.AccountNumber.Should().Be("425");
        journals.Verify(
            x => x.ExistsActiveBySourceTypeAsync(AccountingService.SourcePayrollRun, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task NonNetSalariesCategory_DoesNotQueryPayrollCycle()
    {
        var (service, journals, _) = BuildService();
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.Insurance, 50m);

        await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        journals.Verify(
            x => x.ExistsActiveBySourceTypeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Idempotence_ExistingEntry_DoesNotCreateSecondEntry()
    {
        var existing = SampleExistingEntry();
        var (service, journals, captured) = BuildService(existingBySource: existing);
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.Insurance, 50m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        captured.Should().BeEmpty();
        journals.Verify(x => x.AddAsync(It.IsAny<JournalEntry>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task BankDeposit_ProducesNoEntry()
    {
        var (service, journals, captured) = BuildService();
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.BankDeposit, 50m);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        captured.Should().BeEmpty();
        journals.Verify(x => x.AddAsync(It.IsAny<JournalEntry>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task BrouillardEnabled_AutoEntryIsCreatedAsValidee()
    {
        var (service, _, captured) = BuildService(brouillardEnabled: true);
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.Insurance, 50m);

        await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        var entry = Assert.Single(captured);
        entry.Status.Should().Be(JournalEntryStatus.Validee);
        entry.IsAutoGenerated.Should().BeTrue();
        entry.ValidatedBy.Should().BeNull();
        entry.ValidatedAt.Should().BeNull();
    }

    [Fact]
    public async Task BrouillardDisabled_EntryIsCreatedAsValidee()
    {
        var (service, _, captured) = BuildService(brouillardEnabled: false);
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.Insurance, 50m);

        await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        var entry = Assert.Single(captured);
        entry.Status.Should().Be(JournalEntryStatus.Validee);
    }

    private static JournalEntry SampleExistingEntry()
    {
        var period = AccountingPeriod.Create(2026, 4, new DateTime(2026, 4, 1), new DateTime(2026, 4, 30));
        var lines = new List<JournalLineInput>
        {
            new("616", "Existing", 50m, 0, null, ThirdPartyKind.None),
            new("5411", "Existing", 0, 50m, null, ThirdPartyKind.None)
        };
        var create = JournalEntry.Create(1, "JC", new DateTime(2026, 4, 10), "Existing", period.Id, true,
            AccountingService.SourceCashOperation, Guid.NewGuid(), lines, Money.DefaultCurrency);
        return create.Value;
    }

    // ─────────────── §9.5 Décomposition TVA à 3 lignes ───────────────

    [Theory]
    [InlineData(19, 1.000, 0.840, 0.160)]
    [InlineData(19, 0.100, 0.084, 0.016)]
    [InlineData(13, 10.505, 9.296, 1.209)]
    [InlineData(7, 25.000, 23.364, 1.636)]
    public async Task CashSalesReceipt_FlagOn_VatRateSet_Produces3Lines(int ratePercent, decimal ttc, decimal expectedHt, decimal expectedVat)
    {
        var rate = VatRateExtensions.FromPercent(ratePercent);
        var (service, _, captured) = BuildService(cashDeskVatEnabled: true);
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.CashSalesReceipt, ttc, rate);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(3);

        var treasury = entry.Lines.Single(l => l.AccountNumber == "5411");
        var revenue = entry.Lines.Single(l => l.AccountNumber == "707");
        var vat = entry.Lines.Single(l => l.AccountNumber == "436711");

        treasury.DebitAmount.Amount.Should().Be(ttc);
        revenue.CreditAmount.Amount.Should().Be(expectedHt);
        vat.CreditAmount.Amount.Should().Be(expectedVat);

        // Écriture équilibrée : débit total == crédit total.
        entry.Lines.Sum(l => l.DebitAmount.Amount).Should().Be(entry.Lines.Sum(l => l.CreditAmount.Amount));
    }

    [Theory]
    [InlineData(19, 99.999)]
    [InlineData(13, 99.999)]
    [InlineData(7, 99.999)]
    public async Task CashSalesReceipt_ViciousAmounts_RemainBalanced(int ratePercent, decimal ttc)
    {
        var rate = VatRateExtensions.FromPercent(ratePercent);
        var (service, _, captured) = BuildService(cashDeskVatEnabled: true);
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.CashSalesReceipt, ttc, rate);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Sum(l => l.DebitAmount.Amount).Should().Be(entry.Lines.Sum(l => l.CreditAmount.Amount));
    }

    [Fact]
    public async Task CashSalesReceipt_FlagOn_VatZeroByRounding_Produces2Lines_No436711()
    {
        var (service, _, captured) = BuildService(cashDeskVatEnabled: true);
        // 0.001 à 19% -> HT 0.001, TVA 0.000 (arrondi) : la ligne 436711 doit être omise.
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.CashSalesReceipt, 0.001m, VatRate.Standard);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(2);
        entry.Lines.Should().NotContain(l => l.AccountNumber == "436711");
        var treasury = entry.Lines.Single(l => l.AccountNumber == "5411");
        var revenue = entry.Lines.Single(l => l.AccountNumber == "707");
        treasury.DebitAmount.Amount.Should().Be(0.001m);
        revenue.CreditAmount.Amount.Should().Be(0.001m);
    }

    [Fact]
    public async Task CashSalesReceipt_FlagOn_Exempt_Produces2LinesFullAmount()
    {
        var (service, _, captured) = BuildService(cashDeskVatEnabled: true);
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.CashSalesReceipt, 150m, VatRate.Exempt);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(2);
        entry.Lines.Single(l => l.AccountNumber == "707").CreditAmount.Amount.Should().Be(150m);
    }

    [Fact]
    public async Task CashSalesReceipt_FlagOn_VatRateNull_Produces2Lines()
    {
        var (service, _, captured) = BuildService(cashDeskVatEnabled: true);
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.CashSalesReceipt, 150m, null);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(2);
    }

    [Fact]
    public async Task CashSalesReceipt_FlagOff_VatRateSet_FallsBackTo2Lines()
    {
        // Simule le basculement du flag après la sauvegarde de l'opération (VatRate déjà persisté).
        var (service, _, captured) = BuildService(cashDeskVatEnabled: false);
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.CashSalesReceipt, 150m, VatRate.Standard);

        var result = await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        result.IsSuccess.Should().BeTrue(result.Error?.Description);
        var entry = Assert.Single(captured);
        entry.Lines.Should().HaveCount(2);
        entry.Lines.Should().NotContain(l => l.AccountNumber == "436711");
        entry.Lines.Single(l => l.AccountNumber == "707").CreditAmount.Amount.Should().Be(150m);
    }

    [Fact]
    public async Task CashSalesReceipt_FlagOn_LineLabels_AreSuffixedCorrectly()
    {
        var (service, _, captured) = BuildService(cashDeskVatEnabled: true);
        var operation = Credit(PaymentMethod.Cash, CashRevenueCategory.CashSalesReceipt, 1.000m, VatRate.Standard);

        await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        var entry = Assert.Single(captured);
        var treasury = entry.Lines.Single(l => l.AccountNumber == "5411");
        var revenue = entry.Lines.Single(l => l.AccountNumber == "707");
        var vat = entry.Lines.Single(l => l.AccountNumber == "436711");

        revenue.Label.Should().EndWith(" — HT");
        vat.Label.Should().EndWith(" — TVA 19%");
        treasury.Label.Should().NotEndWith(" — HT").And.NotEndWith("%");
        treasury.Label.Should().Be(revenue.Label.Replace(" — HT", string.Empty));
    }

    [Fact]
    public async Task TwoLineEntry_KeepsIdenticalLabelOnBothLines()
    {
        var (service, _, captured) = BuildService();
        var operation = Debit(PaymentMethod.Cash, CashExpenseCategory.Insurance, 50m);

        await service.GenerateCashOperationEntryAsync(operation, CancellationToken.None);

        var entry = Assert.Single(captured);
        var labels = entry.Lines.Select(l => l.Label).Distinct().ToList();
        labels.Should().ContainSingle();
    }
}
