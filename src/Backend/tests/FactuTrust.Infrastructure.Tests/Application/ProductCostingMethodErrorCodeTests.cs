using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Products;
using FactuTrust.Application.Features.Products.Commands;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Le passage CMUP → FIFO/LIFO refusé (stock non nul) porte un code dédié : le formulaire produit
/// y ajoute l'aide « Créer la couche d'ouverture » en lisant ce code, jamais le texte du message,
/// qui est traduit en interface arabe.
/// </summary>
public sealed class ProductCostingMethodErrorCodeTests
{
    private readonly Mock<IProductRepository> _products = new();
    private readonly Mock<IProductCategoryRepository> _categories = new();
    private readonly Mock<ISupplierRepository> _suppliers = new();
    private readonly Mock<IStockItemRepository> _stockItems = new();
    private readonly Mock<IWarehouseRepository> _warehouses = new();
    private readonly Mock<IUnitOfWork> _unitOfWork = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _audit = new();

    public ProductCostingMethodErrorCodeTests()
    {
        _currentUser.Setup(x => x.UserId).Returns(Guid.NewGuid());
        _categories.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _products.Setup(x => x.UpdateAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _unitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
    }

    [Fact]
    public async Task Average_to_Fifo_with_physical_stock_fails_with_the_opening_layer_code()
    {
        var product = StockManagedProduct();
        var stock = StockItem.Create(product.Id, Guid.NewGuid()).Value;
        Assert.True(stock.RecordEntry(10m, 5m, MovementReason.Purchase, "INIT").IsSuccess);
        _stockItems.Setup(x => x.GetByProductAsync(product.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<StockItem> { stock });

        var result = await Handler(product).Handle(
            new UpdateProductCommand(product.Id, Dto(CostingMethod.Fifo)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ProductErrorCodes.OpeningLayerRequired, result.Error.Code);
        Assert.Equal("Validation.CostingMethod.OpeningLayerRequired", result.Error.Code);
    }

    [Fact]
    public async Task Average_to_Fifo_without_stock_succeeds()
    {
        var product = StockManagedProduct();
        _stockItems.Setup(x => x.GetByProductAsync(product.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<StockItem>());

        var result = await Handler(product).Handle(
            new UpdateProductCommand(product.Id, Dto(CostingMethod.Fifo)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
    }

    private UpdateProductCommandHandler Handler(Product existing)
    {
        _products.Setup(x => x.GetByIdAsync(existing.Id, It.IsAny<CancellationToken>())).ReturnsAsync(existing);
        return new UpdateProductCommandHandler(
            _products.Object, _categories.Object, _suppliers.Object, _stockItems.Object, _warehouses.Object,
            _unitOfWork.Object, _currentUser.Object, _audit.Object,
            Options.Create(new StockTraceabilityOptions { FifoLifoValuationEnabled = true }),
            Options.Create(new BarcodeOptions()));
    }

    private static UpdateProductDto Dto(CostingMethod costing) => new()
    {
        Name = "Produit test",
        UnitPrice = 100m,
        VatRate = VatRate.Standard,
        Unit = "Unité",
        CostingMethod = costing
    };

    private static Product StockManagedProduct()
    {
        var product = Product.Create(
            "P-001", "Produit test", ProductType.Product,
            Money.Create(100m, Money.DefaultCurrency),
            VatRate.Standard, Guid.NewGuid(), unit: "Unité", isStockManaged: true).Value;
        typeof(Product).GetProperty(nameof(Product.Category))!
            .SetValue(product, ProductCategory.Create("GEN", "Général").Value);
        Assert.Equal(CostingMethod.Average, product.CostingMethod);
        return product;
    }
}
