using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Validation;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Products;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.Products.Commands;

/// <summary>
/// Command to create a new product.
/// </summary>
public sealed record CreateProductCommand(CreateProductDto Dto) : IRequest<Result<Guid>>;

/// <summary>
/// Validator for CreateProductCommand.
/// </summary>
public sealed class CreateProductCommandValidator : AbstractValidator<CreateProductCommand>
{
    public CreateProductCommandValidator()
    {
        RuleFor(x => x.Dto.Code).NotEmpty().WithMessage("Le code produit est obligatoire");
        RuleFor(x => x.Dto.Name).NotEmpty().WithMessage("Le nom du produit est obligatoire");
        RuleFor(x => x.Dto.UnitPrice).GreaterThanOrEqualTo(0).WithMessage("Le prix unitaire ne peut pas être négatif");
        RuleFor(x => x.Dto.PurchasePrice)
            .GreaterThanOrEqualTo(0)
            .When(x => x.Dto.PurchasePrice.HasValue)
            .WithMessage("Le prix d'achat ne peut pas être négatif");
        RuleFor(x => x.Dto.MaxDiscountPercent)
            .InclusiveBetween(0, TunisianValidationRules.NumericLimits.MaxDiscountPercent)
            .When(x => x.Dto.IsDiscountEnabled && x.Dto.MaxDiscountPercent.HasValue)
            .WithMessage("La remise maximale doit être comprise entre 0 % et 100 %");
        RuleFor(x => x.Dto.MaxDiscountPercent)
            .NotNull()
            .When(x => x.Dto.IsDiscountEnabled)
            .WithMessage("La remise maximale est obligatoire lorsque la remise produit est activée");
        RuleFor(x => x.Dto.MinimumStock)
            .GreaterThanOrEqualTo(0)
            .When(x => x.Dto.MinimumStock.HasValue)
            .WithMessage("Le stock minimum ne peut pas être négatif");
    }
}

/// <summary>
/// Handler for CreateProductCommand.
/// </summary>
public sealed class CreateProductCommandHandler : IRequestHandler<CreateProductCommand, Result<Guid>>
{
    private readonly IProductRepository _productRepository;
    private readonly IProductCategoryRepository _productCategoryRepository;
    private readonly ISupplierRepository _supplierRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly ITenantContext _tenantContext;
    private readonly StockTraceabilityOptions _traceabilityOptions;

    public CreateProductCommandHandler(
        IProductRepository productRepository,
        IProductCategoryRepository productCategoryRepository,
        ISupplierRepository supplierRepository,
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        IUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IAuditService auditService,
        ITenantContext tenantContext,
        IOptions<StockTraceabilityOptions> traceabilityOptions)
    {
        _productRepository = productRepository;
        _productCategoryRepository = productCategoryRepository;
        _supplierRepository = supplierRepository;
        _stockItemRepository = stockItemRepository;
        _warehouseRepository = warehouseRepository;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _auditService = auditService;
        _tenantContext = tenantContext;
        _traceabilityOptions = traceabilityOptions.Value;
    }

    public async Task<Result<Guid>> Handle(CreateProductCommand request, CancellationToken cancellationToken)
    {
        if (_tenantContext.TenantId is null)
            return Result.Failure<Guid>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        var dto = request.Dto;

        // Check if code already exists
        var existingByCode = await _productRepository.GetByCodeAsync(dto.Code, cancellationToken);
        if (existingByCode is not null)
            return Result.Failure<Guid>(Error.Conflict("Un produit existe déjà avec ce code."));

        // Resolve category ID
        var categoryId = dto.CategoryId ?? await _productCategoryRepository.GetDefaultCategoryIdAsync(cancellationToken);
        if (categoryId == Guid.Empty)
            return Result.Failure<Guid>(Error.Validation("CategoryId", "La catégorie produit est obligatoire"));

        var categoryExists = await _productCategoryRepository.ExistsAsync(categoryId, cancellationToken);
        if (!categoryExists)
            return Result.Failure<Guid>(Error.Validation("CategoryId", "La catégorie sélectionnée n'existe pas"));

        // Create Money value object
        var unitPrice = Money.Create(dto.UnitPrice, Money.DefaultCurrency);
        Money? purchasePrice = dto.PurchasePrice.HasValue
            ? Money.Create(dto.PurchasePrice.Value, Money.DefaultCurrency)
            : null;

        // Create VatRate from percent
        var vatRate = VatRateExtensions.FromPercent((int)dto.VatRate);

        // Create product
        var productResult = Product.Create(
            dto.Code.Trim(),
            dto.Name.Trim(),
            dto.Type,
            unitPrice,
            vatRate,
            categoryId,
            dto.Description?.Trim(),
            dto.Unit?.Trim(),
            dto.IsStockManaged ?? false,
            purchasePrice,
            dto.IsFodecApplicable,
            dto.ProfitMarginPercent,
            dto.IsDiscountEnabled,
            dto.MaxDiscountPercent);

        if (productResult.IsFailure)
            return Result.Failure<Guid>(productResult.Error);

        var product = productResult.Value;

        // Code-barres : la clé de contrôle est vérifiée ici, de sorte qu'un code mal recopié
        // soit refusé à la saisie plutôt que découvert au premier scan en caisse.
        var barcodeResult = product.SetBarcode(dto.Barcode);
        if (barcodeResult.IsFailure)
            return Result.Failure<Guid>(barcodeResult.Error);

        // Fournisseur préféré (optionnel) — Guid.Empty traité comme « aucun ».
        var preferredSupplierId = dto.PreferredSupplierId is { } sid && sid != Guid.Empty ? sid : (Guid?)null;
        if (preferredSupplierId.HasValue)
        {
            var supplierExists = await _supplierRepository.ExistsAsync(preferredSupplierId.Value, cancellationToken);
            if (!supplierExists)
                return Result.Failure<Guid>(Error.Validation("PreferredSupplierId", "Le fournisseur sélectionné n'existe pas"));
            product.SetPreferredSupplier(preferredSupplierId);
        }

        product.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");

        if (dto.IsVariantTemplate)
        {
            var template = product.MarkAsVariantTemplate();
            if (template.IsFailure)
                return Result.Failure<Guid>(template.Error);
        }

        var traceState = ProductTraceabilityRules.ValidateAndNormalize(
            product.Type,
            product.IsStockManaged,
            ProductTraceabilityFeatureMapper.ToDomainFlags(_traceabilityOptions),
            new ProductTraceabilityState(
                dto.TrackingMode,
                dto.HasExpiryTracking,
                dto.PickingPolicy,
                dto.CostingMethod,
                dto.ExpiryAlertDays));
        if (traceState.IsFailure)
            return Result.Failure<Guid>(traceState.Error);

        var normalized = traceState.Value;
        var trace = product.ConfigureTraceability(
            normalized.TrackingMode,
            normalized.HasExpiryTracking,
            normalized.PickingPolicy,
            normalized.CostingMethod,
            normalized.ExpiryAlertDays);
        if (trace.IsFailure)
            return Result.Failure<Guid>(trace.Error);

        await _productRepository.AddAsync(product, cancellationToken);

        var minimumStockResult = await ProductMinimumStockApplicator.ApplyAsync(
            _stockItemRepository,
            _warehouseRepository,
            product.Id,
            product.IsStockManaged,
            dto.MinimumStock,
            cancellationToken);
        if (minimumStockResult.IsFailure)
            return Result.Failure<Guid>(minimumStockResult.Error);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Product.Created,
            "Product",
            product.Id,
            newValues: new { product.Code, product.Name, product.Type },
            cancellationToken: cancellationToken);

        return Result.Success(product.Id);
    }
}
