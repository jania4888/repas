using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Products.Commands;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class ProductMinimumStockTests
{
    private readonly Mock<IProductRepository> _products = new();
    private readonly Mock<IProductCategoryRepository> _categories = new();
    private readonly Mock<ISupplierRepository> _suppliers = new();
    private readonly Mock<IStockItemRepository> _stockItems = new();
    private readonly Mock<IWarehouseRepository> _warehouses = new();
    private readonly Mock<IUnitOfWork> _unitOfWork = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ITenantContext> _tenant = new();

    private readonly Guid _categoryId = Guid.NewGuid();
    private readonly Guid _warehouseId = Guid.NewGuid();

    public ProductMinimumStockTests()
    {
        _tenant.Setup(x => x.TenantId).Returns(Guid.NewGuid());
        _currentUser.Setup(x => x.UserId).Returns(Guid.NewGuid());
        _products.Setup(x => x.GetByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);
        _categories.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        _unitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        _audit.Setup(x => x.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _warehouses.Setup(x => x.GetDefaultAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Warehouse.Create("WH-01", "Principal", isDefault: true).Value);
    }

    [Fact]
    public async Task Create_WithMinimumStock_CreatesDefaultWarehouseStockItem()
    {
        var addedProducts = new List<Product>();
        var addedStockItems = new List<StockItem>();

        _products.Setup(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .Callback<Product, CancellationToken>((p, _) => addedProducts.Add(p))
            .ReturnsAsync((Product p, CancellationToken _) => p);
        _stockItems.Setup(x => x.GetByProductAndWarehouseAsync(
                It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((StockItem?)null);
        _stockItems.Setup(x => x.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()))
            .Callback<StockItem, CancellationToken>((s, _) => addedStockItems.Add(s))
            .ReturnsAsync((StockItem s, CancellationToken _) => s);

        var handler = new CreateProductCommandHandler(
            _products.Object, _categories.Object, _suppliers.Object,
            _stockItems.Object, _warehouses.Object,
            _unitOfWork.Object, _currentUser.Object, _audit.Object, _tenant.Object,
            Options.Create(new StockTraceabilityOptions()));

        var result = await handler.Handle(new CreateProductCommand(new CreateProductDto
        {
            Code = "P-MIN",
            Name = "Produit min stock",
            Type = ProductType.Product,
            UnitPrice = 10m,
            VatRate = VatRate.Standard,
            Unit = "Unité",
            IsStockManaged = true,
            CategoryId = _categoryId,
            MinimumStock = 20m
        }), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var stockItem = Assert.Single(addedStockItems);
        Assert.Equal(20m, stockItem.MinimumStock);
        Assert.Equal(addedProducts[0].Id, stockItem.ProductId);
    }

    [Fact]
    public async Task Create_WithoutMinimumStock_DoesNotCreateStockItem()
    {
        _products.Setup(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product p, CancellationToken _) => p);

        var handler = new CreateProductCommandHandler(
            _products.Object, _categories.Object, _suppliers.Object,
            _stockItems.Object, _warehouses.Object,
            _unitOfWork.Object, _currentUser.Object, _audit.Object, _tenant.Object,
            Options.Create(new StockTraceabilityOptions()));

        var result = await handler.Handle(new CreateProductCommand(new CreateProductDto
        {
            Code = "P-NOMIN",
            Name = "Produit sans min",
            Type = ProductType.Product,
            UnitPrice = 10m,
            VatRate = VatRate.Standard,
            Unit = "Unité",
            IsStockManaged = true,
            CategoryId = _categoryId
        }), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _stockItems.Verify(x => x.AddAsync(It.IsAny<StockItem>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
