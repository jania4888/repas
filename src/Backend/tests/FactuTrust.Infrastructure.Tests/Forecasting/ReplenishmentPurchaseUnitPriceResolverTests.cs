using FactuTrust.Application.Features.Forecasting.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Forecasting;

public sealed class ReplenishmentPurchaseUnitPriceResolverTests
{
    [Fact]
    public void SuggestUnitPrice_ReturnsPurchasePriceOnly_NotSalePrice()
    {
        var category = ProductCategory.Create("CAT", "Cat").Value;
        var sale = Money.Create(200m, Money.DefaultCurrency);
        var purchase = Money.Create(80m, Money.DefaultCurrency);
        var product = Product.Create(
            "P-1", "Produit", ProductType.Product, sale, VatRate.Standard, category.Id,
            purchasePrice: purchase).Value;

        Assert.Equal(80m, ReplenishmentPurchaseUnitPriceResolver.SuggestUnitPrice(product, Guid.NewGuid()));
    }

    [Fact]
    public void SuggestUnitPrice_WhenPurchasePriceMissing_ReturnsNull()
    {
        var category = ProductCategory.Create("CAT", "Cat").Value;
        var sale = Money.Create(200m, Money.DefaultCurrency);
        var product = Product.Create(
            "P-2", "Produit", ProductType.Product, sale, VatRate.Standard, category.Id,
            purchasePrice: null).Value;

        Assert.Null(ReplenishmentPurchaseUnitPriceResolver.SuggestUnitPrice(product));
    }
}
