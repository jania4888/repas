using FactuTrust.Application.Common.Barcodes;
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
/// Command to update an existing product.
/// </summary>
public sealed record UpdateProductCommand(Guid Id, UpdateProductDto Dto) : IRequest<Result<ProductDetailDto>>;

/// <summary>
/// Validator for UpdateProductCommand.
/// </summary>
public sealed class UpdateProductCommandValidator : AbstractValidator<UpdateProductCommand>
{
    public UpdateProductCommandValidator()
    {
        RuleFor(x => x.Id).NotEqual(Guid.Empty).WithMessage("Identifiant produit invalide.");
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
    }
}

/// <summary>
/// Handler for UpdateProductCommand.
/// </summary>
public sealed class UpdateProductCommandHandler : IRequestHandler<UpdateProductCommand, Result<ProductDetailDto>>
{
    private readonly IProductRepository _productRepository;
    private readonly IProductCategoryRepository _productCategoryRepository;
    private readonly ISupplierRepository _supplierRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly StockTraceabilityOptions _traceabilityOptions;
    private readonly BarcodeOptions _barcodeOptions;

    public UpdateProductCommandHandler(
        IProductRepository productRepository,
        IProductCategoryRepository productCategoryRepository,
        ISupplierRepository supplierRepository,
        IStockItemRepository stockItemRepository,
        IUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IAuditService auditService,
        IOptions<StockTraceabilityOptions> traceabilityOptions,
        IOptions<BarcodeOptions> barcodeOptions)
    {
        _productRepository = productRepository;
        _productCategoryRepository = productCategoryRepository;
        _supplierRepository = supplierRepository;
        _stockItemRepository = stockItemRepository;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _auditService = auditService;
        _traceabilityOptions = traceabilityOptions.Value;
        _barcodeOptions = barcodeOptions.Value;
    }

    public async Task<Result<ProductDetailDto>> Handle(UpdateProductCommand request, CancellationToken cancellationToken)
    {
        var product = await _productRepository.GetByIdAsync(request.Id, cancellationToken);
        if (product is null)
            return Result.Failure<ProductDetailDto>(Error.NotFound("Product", request.Id));

        var dto = request.Dto;

        if (dto.CategoryId.HasValue && dto.CategoryId.Value != Guid.Empty)
        {
            var categoryExists = await _productCategoryRepository.ExistsAsync(dto.CategoryId.Value, cancellationToken);
            if (!categoryExists)
                return Result.Failure<ProductDetailDto>(Error.Validation("CategoryId", "La catégorie sélectionnée n'existe pas"));
        }

        // Create Money value object
        var unitPrice = Money.Create(dto.UnitPrice, Money.DefaultCurrency);
        Money? purchasePrice = dto.PurchasePrice.HasValue
            ? Money.Create(dto.PurchasePrice.Value, Money.DefaultCurrency)
            : null;

        // Create VatRate from percent
        var vatRate = VatRateExtensions.FromPercent((int)dto.VatRate);

        // Update product
        product.Update(
            dto.Name.Trim(),
            dto.Description?.Trim(),
            unitPrice,
            vatRate,
            dto.Unit?.Trim(),
            purchasePrice,
            dto.CategoryId,
            dto.IsFodecApplicable,
            dto.IsDiscountEnabled,
            dto.MaxDiscountPercent);

        // Code-barres : format, drapeau de déploiement, puis unicité — même ordre qu'à la
        // création. L'article courant est exclu du contrôle d'unicité, sans quoi réenregistrer
        // une fiche sans toucher au code-barres serait refusé.
        var barcodeCheck = await ValidateBarcodeAsync(dto.Barcode, product.Id, cancellationToken);
        if (barcodeCheck.IsFailure)
            return Result.Failure<ProductDetailDto>(barcodeCheck.Error);

        // Un code invalide est refusé sans laisser le produit dans un état partiellement modifié.
        var barcodeResult = product.SetBarcode(dto.Barcode);
        if (barcodeResult.IsFailure)
            return Result.Failure<ProductDetailDto>(barcodeResult.Error);

        if (dto.IsStockManaged.HasValue)
        {
            if (dto.IsStockManaged.Value)
            {
                var enableResult = product.EnableStockManagement();
                if (enableResult.IsFailure)
                    return Result.Failure<ProductDetailDto>(enableResult.Error);
            }
            else
            {
                product.DisableStockManagement();
            }
        }

        // Fournisseur préféré (optionnel) — Guid.Empty traité comme « aucun » ; null efface la préférence.
        var preferredSupplierId = dto.PreferredSupplierId is { } sid && sid != Guid.Empty ? sid : (Guid?)null;
        if (preferredSupplierId.HasValue)
        {
            var supplierExists = await _supplierRepository.ExistsAsync(preferredSupplierId.Value, cancellationToken);
            if (!supplierExists)
                return Result.Failure<ProductDetailDto>(Error.Validation("PreferredSupplierId", "Le fournisseur sélectionné n'existe pas"));
        }
        product.SetPreferredSupplier(preferredSupplierId);

        if (dto.IsVariantTemplate == true && !product.IsVariantTemplate)
        {
            var template = product.MarkAsVariantTemplate();
            if (template.IsFailure)
                return Result.Failure<ProductDetailDto>(template.Error);
        }

        var traceabilityTouched = dto.TrackingMode.HasValue || dto.HasExpiryTracking.HasValue
            || dto.PickingPolicy.HasValue || dto.CostingMethod.HasValue || dto.ExpiryAlertDays.HasValue;
        var stockDisabled = dto.IsStockManaged == false;

        if (traceabilityTouched || stockDisabled)
        {
            var candidate = new ProductTraceabilityState(
                dto.TrackingMode ?? product.TrackingMode,
                dto.HasExpiryTracking ?? product.HasExpiryTracking,
                dto.PickingPolicy ?? product.PickingPolicy,
                dto.CostingMethod ?? product.CostingMethod,
                dto.ExpiryAlertDays ?? product.ExpiryAlertDays);

            var traceState = ProductTraceabilityRules.ValidateAndNormalize(
                product.Type,
                product.IsStockManaged,
                ProductTraceabilityFeatureMapper.ToDomainFlags(_traceabilityOptions),
                candidate);
            if (traceState.IsFailure)
                return Result.Failure<ProductDetailDto>(traceState.Error);

            var normalized = traceState.Value;

            if (product.TrackingMode == TrackingMode.None && normalized.TrackingMode != TrackingMode.None)
            {
                var stocks = await _stockItemRepository.GetByProductAsync(product.Id, cancellationToken);
                if (stocks.Any(s => s.QuantityOnHand > 0))
                {
                    return Result.Failure<ProductDetailDto>(Error.Validation("TrackingMode",
                        "Impossible d'activer le suivi par lot/série tant qu'un stock physique existe. Passez par un inventaire d'ouverture."));
                }
            }

            if (product.CostingMethod == CostingMethod.Average
                && normalized.CostingMethod is CostingMethod.Fifo or CostingMethod.Lifo)
            {
                var stocks = await _stockItemRepository.GetByProductAsync(product.Id, cancellationToken);
                if (stocks.Any(s => s.QuantityOnHand > 0))
                {
                    return Result.Failure<ProductDetailDto>(Error.Validation("CostingMethod",
                        "Le passage CMUP → FIFO/LIFO exige une couche d'ouverture (inventaire). Stock physique non nul."));
                }
            }

            if (product.CostingMethod is CostingMethod.Fifo or CostingMethod.Lifo
                && normalized.CostingMethod == CostingMethod.Average)
            {
                var stocks = await _stockItemRepository.GetByProductAsync(product.Id, cancellationToken);
                if (stocks.Any(s => s.QuantityOnHand > 0))
                {
                    return Result.Failure<ProductDetailDto>(Error.Validation("CostingMethod",
                        "Le passage FIFO/LIFO → CMUP est interdit tant qu'un stock physique existe. Clôturez les couches ou soldez le stock."));
                }
            }

            var trace = product.ConfigureTraceability(
                normalized.TrackingMode,
                normalized.HasExpiryTracking,
                normalized.PickingPolicy,
                normalized.CostingMethod,
                normalized.ExpiryAlertDays);
            if (trace.IsFailure)
                return Result.Failure<ProductDetailDto>(trace.Error);
        }

        product.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);

        await _productRepository.UpdateAsync(product, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Product.Updated,
            "Product",
            product.Id,
            newValues: new { product.Code, product.Name, product.UnitPrice.Amount },
            cancellationToken: cancellationToken);

        var detail = ProductDetailMapper.ToDetailDto(product);
        return Result.Success(detail);
    }

    /// <summary>
    /// Contrôle un code-barres avant de le poser sur l'article : format (clé de contrôle),
    /// symbologie autorisée par le déploiement, puis absence de conflit avec un AUTRE article.
    /// Voir <c>docs/runbooks/barcode-cutover.md</c> pour la raison pour laquelle l'unicité est
    /// applicative et non portée par un index.
    /// </summary>
    private async Task<Result> ValidateBarcodeAsync(
        string? rawBarcode,
        Guid excludeProductId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rawBarcode))
            return Result.Success();

        var parsed = Barcode.Create(rawBarcode);
        if (parsed.IsFailure)
            return Result.Failure(parsed.Error);

        var writable = BarcodePolicy.EnsureWritable(parsed.Value, _barcodeOptions);
        if (writable.IsFailure)
            return writable;

        var taken = await _productRepository.BarcodeExistsAsync(
            parsed.Value.Value, excludeProductId, cancellationToken);

        return taken
            ? Result.Failure(Error.Conflict("Ce code-barres est déjà utilisé par un autre article."))
            : Result.Success();
    }
}
