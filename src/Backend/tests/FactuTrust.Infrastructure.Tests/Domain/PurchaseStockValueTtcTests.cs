using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class PurchaseStockValueTtcTests
{
    [Fact]
    public void Exempt_IsBitIdenticalToHt()
    {
        const decimal ht = 8055.257m;

        var ttc = PurchaseStockValueTtc.FromHt(ht, VatRate.Exempt);

        Assert.Equal(ht, ttc);
        Assert.Equal(0, PurchaseStockValueTtc.Percent(VatRate.Exempt));
    }

    [Theory]
    [InlineData(VatRate.Reduced, 7, 107)]
    [InlineData(VatRate.Intermediate, 13, 113)]
    [InlineData(VatRate.Standard, 19, 119)]
    public void KnownRates_ScaleTheHtValue(VatRate rate, int percent, int expectedOnHundred)
    {
        Assert.Equal(percent, PurchaseStockValueTtc.Percent(rate));
        Assert.Equal(expectedOnHundred, PurchaseStockValueTtc.FromHt(100m, rate));
    }

    [Fact]
    public void ZeroHt_StaysZeroEvenAtStandardRate()
    {
        Assert.Equal(0m, PurchaseStockValueTtc.FromHt(0m, VatRate.Standard));
    }

    [Theory]
    [InlineData(42)]
    [InlineData(-1)]
    public void UnknownRate_KeepsHtAndReportsZeroPercent(int raw)
    {
        var rate = (VatRate)raw;
        const decimal ht = 80m;

        Assert.Equal(0, PurchaseStockValueTtc.Percent(rate));
        Assert.Equal(ht, PurchaseStockValueTtc.FromHt(ht, rate));
    }

    [Fact]
    public void Fifo_NextExitTimesQuantityTimesVat_IsNotTheTtcValue()
    {
        // Couches 10 @ 2, 10 @ 3, 10 @ 4 : valeur HT = 90. P.U. de prochaine sortie FIFO = 2, qté = 30.
        const decimal stockValueHt = 90m;
        const decimal nextExitUnitCost = 2m;
        const decimal quantity = 30m;

        var ttc = PurchaseStockValueTtc.FromHt(stockValueHt, VatRate.Standard);

        Assert.Equal(90m * 1.19m, ttc);
        Assert.NotEqual(nextExitUnitCost * quantity * 1.19m, ttc);
    }
}
