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

/// <summary>
/// Regression coverage for the "Réapprovisionnement → Créer les BC" fix: a product can now carry a
/// preferred supplier so that generated recommendations are pre-linked to a supplier. Previously the
/// Create/Update handlers never persisted <c>PreferredSupplierId</c>, so every recommendation was
/// "Sans fournisseur" and no purchase order could be created.
/// </summary>
public sealed class CreateProductCommandPreferredSupplierTests
{
    private readonly Mock<IProductRepository> _products = new();
    private readonly Mock<IProductCategoryRepository> _categories = new();
    private readonly Mock<ISupplierRepository> _suppliers = new();
    private readonly Mock<IUnitOfWork> _unitOfWork = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ITenantContext> _tenant = new();

    private readonly Guid _categoryId = Guid.NewGuid();

    public CreateProductCommandPreferredSupplierTests()
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
    }

    private CreateProductCommandHandler BuildHandler(out List<Product> added)
    {
        var captured = new List<Product>();
        added = captured;
        _products.Setup(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()))
            .Callback<Product, CancellationToken>((p, _) => captured.Add(p))
            .ReturnsAsync((Product p, CancellationToken _) => p);

        return new CreateProductCommandHandler(
            _products.Object, _categories.Object, _suppliers.Object,
            _unitOfWork.Object, _currentUser.Object, _audit.Object, _tenant.Object,
            Options.Create(new StockTraceabilityOptions
            {
                LotTrackingEnabled = true,
                SerialTrackingEnabled = true,
                ExpiryTrackingEnabled = true,
                FifoLifoValuationEnabled = true
            }),
            Options.Create(new BarcodeOptions()));
    }

    private CreateProductDto Dto(Guid? preferredSupplierId) => new()
    {
        Code = "P-001",
        Name = "Produit test",
        Type = ProductType.Product,
        UnitPrice = 10m,
        VatRate = VatRate.Standard,
        Unit = "Unité",
        IsStockManaged = true,
        CategoryId = _categoryId,
        PreferredSupplierId = preferredSupplierId
    };

    [Fact]
    public async Task Handle_WithExistingPreferredSupplier_PersistsPreferredSupplierId()
    {
        var supplierId = Guid.NewGuid();
        _suppliers.Setup(x => x.ExistsAsync(supplierId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var handler = BuildHandler(out var added);

        var result = await handler.Handle(new CreateProductCommand(Dto(supplierId)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var product = Assert.Single(added);
        Assert.Equal(supplierId, product.PreferredSupplierId);
        _suppliers.Verify(x => x.ExistsAsync(supplierId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_WithUnknownPreferredSupplier_ReturnsValidationFailureAndDoesNotPersist()
    {
        var supplierId = Guid.NewGuid();
        _suppliers.Setup(x => x.ExistsAsync(supplierId, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        var handler = BuildHandler(out var added);

        var result = await handler.Handle(new CreateProductCommand(Dto(supplierId)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.PreferredSupplierId", result.Error.Code);
        Assert.Empty(added);
        _products.Verify(x => x.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_WithoutPreferredSupplier_CreatesProductWithNoSupplierAndSkipsLookup()
    {
        var handler = BuildHandler(out var added);

        var result = await handler.Handle(new CreateProductCommand(Dto(null)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var product = Assert.Single(added);
        Assert.Null(product.PreferredSupplierId);
        _suppliers.Verify(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
