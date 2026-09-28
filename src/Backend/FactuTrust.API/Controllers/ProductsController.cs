using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Products.Commands;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Application.Features.Stock.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Controller for managing products and services.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ProductsController : ControllerBase
{
    private const int MaxProductImageSizeBytes = 2 * 1024 * 1024; // 2 MB
    private static readonly HashSet<string> AllowedImageContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/jpg", "image/png", "image/webp"
    };

    private readonly IMediator _mediator;
    private readonly IProductRepository _productRepository;
    private readonly IProductImageSearchService _imageSearchService;
    private readonly IProductImageStorageService _imageStorageService;
    private readonly ITenantContext _tenantContext;
    private readonly StockTraceabilityOptions _stockOptions;
    private readonly IOptions<BarcodeOptions> _barcodeOptions;
    private readonly ILogger<ProductsController> _logger;

    public ProductsController(
        IMediator mediator,
        IProductRepository productRepository,
        IProductImageSearchService imageSearchService,
        IProductImageStorageService imageStorageService,
        ITenantContext tenantContext,
        IOptions<StockTraceabilityOptions> stockOptions,
        IOptions<BarcodeOptions> barcodeOptions,
        ILogger<ProductsController> logger)
    {
        _mediator = mediator;
        _productRepository = productRepository;
        _imageSearchService = imageSearchService;
        _imageStorageService = imageStorageService;
        _tenantContext = tenantContext;
        _stockOptions = stockOptions.Value;
        _barcodeOptions = barcodeOptions;
        _logger = logger;
    }

    private IActionResult? EnsureVariantsEnabled()
    {
        if (!_stockOptions.ProductVariantsEnabled)
            return StatusCode(StatusCodes.Status403Forbidden,
                ApiResponse<object>.Fail("La fonctionnalité variantes produit est désactivée pour cette entreprise."));
        return null;
    }

    /// <summary>
    /// Get paginated list of products with optional search and filters.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<ProductListDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProducts(
        [FromQuery] string? search,
        [FromQuery] ProductType? type,
        [FromQuery] bool? isActive,
        [FromQuery] Guid? categoryId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] bool excludeVariantTemplates = false,
        [FromQuery] Guid? parentProductId = null,
        [FromQuery] bool? isVariantTemplate = null,
        [FromQuery] bool? hasParentProduct = null,
        CancellationToken cancellationToken = default)
    {
        var query = new GetProductsQuery(
            search, type, isActive, categoryId, page, pageSize, warehouseId,
            excludeVariantTemplates, parentProductId, isVariantTemplate, hasParentProduct);
        var result = await _mediator.Send(query, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<PagedResult<ProductListDto>>.Fail(result.Error.Description));
        return Ok(ApiResponse<PagedResult<ProductListDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Lightweight product list for autocomplete / select dropdowns (no stock, no category join).
    /// </summary>
    [HttpGet("select")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<ProductSelectDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SearchProductsForSelect(
        [FromQuery] string? search,
        [FromQuery] bool? isActive = true,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken cancellationToken = default)
    {
        var query = new SearchProductsForSelectQuery(search, isActive, page, pageSize);
        var result = await _mediator.Send(query, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<PagedResult<ProductSelectDto>>.Fail(result.Error.Description));
        return Ok(ApiResponse<PagedResult<ProductSelectDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Search variant template products for grouped picker (step 1).
    /// </summary>
    [HttpGet("templates/select")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ProductSelectDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SearchProductTemplatesForSelect(
        [FromQuery] string? search,
        [FromQuery] bool? isActive = true,
        [FromQuery] int pageSize = 50,
        CancellationToken cancellationToken = default)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(
            new SearchProductTemplatesForSelectQuery(search, isActive, pageSize),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<IReadOnlyList<ProductSelectDto>>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ProductSelectDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Bulk FODEC flag lookup for draft/import reload (avoids N× GET /products/{id}).
    /// </summary>
    [HttpPost("fodec-flags")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ProductFodecFlagDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetFodecFlags(
        [FromBody] GetProductFodecFlagsRequest request,
        CancellationToken cancellationToken = default)
    {
        var query = new GetProductFodecFlagsQuery(request.ProductIds ?? Array.Empty<Guid>());
        var result = await _mediator.Send(query, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<IReadOnlyList<ProductFodecFlagDto>>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ProductFodecFlagDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get product details by ID.
    /// </summary>
    [HttpGet("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<ProductDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetProduct(Guid id, CancellationToken cancellationToken)
    {
        var query = new GetProductByIdQuery(id);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<ProductDetailDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<ProductDetailDto>.Ok(result.Value));
    }

    /// <summary>
    /// Recherche un article par code-barres, en correspondance EXACTE.
    ///
    /// Destiné au scan en caisse : un code qui ne correspond à aucun article renvoie 404,
    /// jamais un article approchant. Le scan interrogeait auparavant le code produit interne
    /// avec repli sur une correspondance partielle, et pouvait encaisser un autre article.
    /// </summary>
    [HttpGet("by-barcode/{barcode}")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<ProductDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetProductByBarcode(string barcode, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetProductByBarcodeQuery(barcode), cancellationToken);

        if (result.IsFailure)
        {
            return result.Error.Code == "NotFound"
                ? NotFound(ApiResponse<ProductDetailDto>.Fail("Aucun article ne correspond à ce code-barres"))
                : BadRequest(ApiResponse<ProductDetailDto>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<ProductDetailDto>.Ok(result.Value));
    }

    /// <summary>
    /// Drapeaux de déploiement des codes-barres (IOptions), pas des données du dossier.
    /// Réservé aux appelants authentifiés — [Authorize] de classe, sans permission fine,
    /// comme <c>GET /api/stock/features</c>.
    /// </summary>
    [HttpGet("barcode-features")]
    [ProducesResponseType(typeof(ApiResponse<BarcodeFeaturesDto>), StatusCodes.Status200OK)]
    public ActionResult<BarcodeFeaturesDto> GetBarcodeFeatures()
    {
        var options = _barcodeOptions.Value;
        return Ok(ApiResponse<BarcodeFeaturesDto>.Ok(new BarcodeFeaturesDto
        {
            ExtendedSymbologiesEnabled = options.ExtendedSymbologiesEnabled,
            LabelPrintingEnabled = options.LabelPrintingEnabled
        }));
    }

    /// <summary>
    /// Propose un code-barres interne pour un article sans code fournisseur.
    ///
    /// <para>
    /// Le code n'est PAS enregistré : il est seulement proposé. C'est l'enregistrement de la
    /// fiche qui le persiste, en repassant par les mêmes contrôles que toute autre saisie.
    /// </para>
    /// </summary>
    [HttpPost("barcode/generate")]
    [Authorize(Policy = PermissionPolicies.ProductsCreate)]
    [ProducesResponseType(typeof(ApiResponse<GeneratedBarcodeDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> GenerateBarcode(
        [FromQuery] Guid? excludeProductId,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new GenerateProductBarcodeCommand(excludeProductId), cancellationToken);

        if (result.IsFailure)
        {
            return result.Error.Code == "Conflict"
                ? Conflict(ApiResponse<GeneratedBarcodeDto>.Fail(result.Error.Description))
                : BadRequest(ApiResponse<GeneratedBarcodeDto>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<GeneratedBarcodeDto>.Ok(result.Value));
    }

    /// <summary>
    /// Gabarits de planches d'étiquettes disponibles.
    /// </summary>
    [HttpGet("label-layouts")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<LabelLayoutDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetLabelLayouts(CancellationToken cancellationToken)
    {
        var layouts = await _mediator.Send(new GetLabelLayoutsQuery(), cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<LabelLayoutDto>>.Ok(layouts));
    }

    /// <summary>
    /// Produit une planche d'étiquettes code-barres en PDF.
    ///
    /// <para>
    /// POST et non GET : la sélection peut porter deux cents identifiants, qui n'ont rien à
    /// faire dans une URL. La permission reste <c>products:read</c> — l'étiquette n'expose
    /// aucune donnée que la fiche article ne montre déjà. Le vrai garde-fou est volumétrique.
    /// </para>
    /// </summary>
    [HttpPost("labels/pdf")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [EnableRateLimiting("labels")]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ExportLabels(
        [FromBody] ProductLabelRequestDto request,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ExportProductLabelsPdfQuery(request), cancellationToken);

        if (result.IsFailure)
        {
            return result.Error.Code is "NotFound" or "Product.NotFound"
                ? NotFound(ApiResponse<object>.Fail(result.Error.Description))
                : BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }

    /// <summary>
    /// Create a new product.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = PermissionPolicies.ProductsCreate)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateProduct(
        [FromBody] CreateProductDto dto,
        CancellationToken cancellationToken)
    {
        var command = new CreateProductCommand(dto);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "Conflict")
                return Conflict(ApiResponse<Guid>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        }

        _logger.LogInformation("Product created with ID {ProductId}", result.Value);

        return CreatedAtAction(
            nameof(GetProduct),
            new { id = result.Value },
            ApiResponse<Guid>.Ok(result.Value, "Produit créé avec succès"));
    }

    /// <summary>
    /// Update an existing product.
    /// </summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<ProductDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateProduct(
        Guid id,
        [FromBody] UpdateProductDto dto,
        CancellationToken cancellationToken)
    {
        var command = new UpdateProductCommand(id, dto);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "NotFound" || result.Error.Code == "Product.NotFound")
                return NotFound(ApiResponse<ProductDetailDto>.Fail(result.Error.Description));
            // Le code (ex. couche d'ouverture requise) est lu par le client : le message peut être traduit.
            return BadRequest(ApiResponse<ProductDetailDto>.FailWithCode(result.Error.Description, result.Error.Code));
        }

        return Ok(ApiResponse<ProductDetailDto>.Ok(result.Value, "Produit mis à jour."));
    }

    /// <summary>
    /// Delete a product. Fails if product is used in invoices.
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsDelete)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteProduct(Guid id, CancellationToken cancellationToken)
    {
        var command = new DeleteProductCommand(id);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "NotFound" || result.Error.Code == "Product.NotFound")
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<object>.Ok(null!, "Produit supprimé."));
    }

    /// <summary>
    /// Toggle product active status.
    /// </summary>
    [HttpPatch("{id:guid}/toggle-active")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<ProductDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ToggleActive(Guid id, CancellationToken cancellationToken)
    {
        var command = new ToggleProductActiveCommand(id);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<ProductDetailDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<ProductDetailDto>.Ok(result.Value,
            result.Value.IsActive ? "Produit activé." : "Produit désactivé."));
    }

    /// <summary>
    /// Gets the product image URL. If the product has no image, searches external APIs (Unsplash, Google)
    /// and caches the result in the database.
    /// </summary>
    [HttpGet("{id:guid}/image-url")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<string?>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetProductImageUrl(Guid id, CancellationToken cancellationToken)
    {
        var product = await _productRepository.GetByIdAsync(id, cancellationToken);
        if (product is null)
            return NotFound(ApiResponse<string?>.Fail("Produit introuvable."));

        if (!string.IsNullOrEmpty(product.ImageUrl))
            return Ok(ApiResponse<string?>.Ok(product.ImageUrl));

        var searchQuery = string.IsNullOrEmpty(product.Category?.Name)
            ? product.Name
            : $"{product.Name} {product.Category.Name}";
        var imageUrl = await _imageSearchService.SearchImageUrlAsync(searchQuery, cancellationToken);

        if (!string.IsNullOrEmpty(imageUrl))
        {
            try
            {
                await _productRepository.UpdateImageUrlAsync(id, imageUrl, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to save image URL for product {ProductId}", id);
            }
        }

        return Ok(ApiResponse<string?>.Ok(imageUrl));
    }

    /// <summary>
    /// Uploads a product image. Replaces any existing image.
    /// Allowed: JPEG, PNG, WebP; max 2 MB.
    /// </summary>
    [HttpPost("{id:guid}/image")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<string>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    public async Task<IActionResult> UploadProductImage(
        Guid id,
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        if (_tenantContext.TenantId is null)
            return BadRequest(ApiResponse<string>.Fail("Contexte tenant manquant."));

        var product = await _productRepository.GetByIdAsync(id, cancellationToken);
        if (product is null)
            return NotFound(ApiResponse<string>.Fail("Produit introuvable."));

        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<string>.Fail("Aucun fichier fourni."));

        if (file.Length > MaxProductImageSizeBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                ApiResponse<string>.Fail("L'image ne doit pas dépasser 2 Mo."));

        var contentType = file.ContentType ?? string.Empty;
        if (!AllowedImageContentTypes.Contains(contentType.Trim()))
            return BadRequest(ApiResponse<string>.Fail("Type de fichier non autorisé. Utilisez JPEG, PNG ou WebP."));

        try
        {
            await using var stream = file.OpenReadStream();
            var relativeUrl = await _imageStorageService.SaveAsync(
                _tenantContext.TenantId.Value,
                id,
                stream,
                contentType,
                cancellationToken);

            await _productRepository.UpdateImageUrlAsync(id, relativeUrl, cancellationToken);

            var absoluteUrl = $"{Request.Scheme}://{Request.Host}{relativeUrl}";
            return Ok(ApiResponse<string>.Ok(absoluteUrl, "Image enregistrée."));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ApiResponse<string>.Fail(ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<string>.Fail(ex.Message));
        }
    }

    /// <summary>
    /// Removes the product image.
    /// </summary>
    [HttpDelete("{id:guid}/image")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteProductImage(Guid id, CancellationToken cancellationToken = default)
    {
        if (_tenantContext.TenantId is null)
            return BadRequest(ApiResponse<object>.Fail("Contexte tenant manquant."));

        var product = await _productRepository.GetByIdAsync(id, cancellationToken);
        if (product is null)
            return NotFound(ApiResponse<object>.Fail("Produit introuvable."));

        await _imageStorageService.DeleteAsync(_tenantContext.TenantId.Value, id, cancellationToken);
        await _productRepository.ClearImageUrlAsync(id, cancellationToken);

        return Ok(ApiResponse<object>.Ok(null!, "Image supprimée."));
    }

    [HttpGet("attributes")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    public async Task<IActionResult> ListAttributes(CancellationToken cancellationToken)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(new ListProductAttributesQuery(), cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<ProductAttributeDto>>.Ok(result));
    }

    [HttpPost("attributes")]
    [Authorize(Policy = PermissionPolicies.ProductsCreate)]
    public async Task<IActionResult> CreateAttribute(
        [FromBody] CreateProductAttributeCommand command,
        CancellationToken cancellationToken)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value, "Attribut créé"));
    }

    [HttpGet("attributes/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    public async Task<IActionResult> GetAttribute(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetProductAttributeByIdQuery(id), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<ProductAttributeDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProductAttributeDto>.Ok(result.Value));
    }

    [HttpPut("attributes/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    public async Task<IActionResult> UpdateAttribute(
        Guid id,
        [FromBody] UpdateProductAttributeRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new UpdateProductAttributeCommand(id, request.Name, request.SortOrder),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<ProductAttributeDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProductAttributeDto>.Ok(result.Value, "Attribut mis à jour"));
    }

    [HttpDelete("attributes/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    public async Task<IActionResult> DeleteAttribute(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new DeleteProductAttributeCommand(id), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<object>.Ok(null!, "Attribut supprimé"));
    }

    [HttpPost("attributes/{id:guid}/values")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    public async Task<IActionResult> AddAttributeValue(
        Guid id,
        [FromBody] AddProductAttributeValueRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new AddProductAttributeValueCommand(id, request.Code, request.Name, request.SortOrder),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value, "Valeur ajoutée"));
    }

    [HttpPut("attributes/{definitionId:guid}/values/{valueId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    public async Task<IActionResult> UpdateAttributeValue(
        Guid definitionId,
        Guid valueId,
        [FromBody] UpdateProductAttributeValueRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new UpdateProductAttributeValueCommand(definitionId, valueId, request.Name, request.SortOrder),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<object>.Ok(null!, "Valeur mise à jour"));
    }

    [HttpDelete("attributes/{definitionId:guid}/values/{valueId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    public async Task<IActionResult> DeleteAttributeValue(
        Guid definitionId,
        Guid valueId,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new DeleteProductAttributeValueCommand(definitionId, valueId),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<object>.Ok(null!, "Valeur supprimée"));
    }

    [HttpPost("{id:guid}/variants")]
    [Authorize(Policy = PermissionPolicies.ProductsCreate)]
    public async Task<IActionResult> GenerateVariants(
        Guid id,
        [FromBody] IReadOnlyList<GenerateProductVariantAxis> axes,
        CancellationToken cancellationToken)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(new GenerateProductVariantsCommand(id, axes), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<IReadOnlyList<Guid>>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<Guid>>.Ok(result.Value, "Variantes générées"));
    }

    [HttpGet("{id:guid}/variants")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<ProductVariantChildDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProductVariants(
        Guid id,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 100,
        [FromQuery] Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(
            new GetProductVariantsQuery(id, page, pageSize, warehouseId),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<PagedResult<ProductVariantChildDto>>.Fail(result.Error.Description));
        return Ok(ApiResponse<PagedResult<ProductVariantChildDto>>.Ok(result.Value));
    }

    [HttpGet("{id:guid}/variant-axes")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ProductVariantAxisDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProductVariantAxes(Guid id, CancellationToken cancellationToken)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(new GetProductVariantAxesQuery(id), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<IReadOnlyList<ProductVariantAxisDto>>.Fail(result.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ProductVariantAxisDto>>.Ok(result.Value));
    }

    [HttpGet("{id:guid}/variant-profile")]
    [Authorize(Policy = PermissionPolicies.ProductsRead)]
    [ProducesResponseType(typeof(ApiResponse<ProductVariantProfileDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProductVariantProfile(Guid id, CancellationToken cancellationToken)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(new GetProductVariantProfileQuery(id), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<ProductVariantProfileDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProductVariantProfileDto>.Ok(result.Value));
    }

    [HttpPatch("{id:guid}/variants/prices")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<int>), StatusCodes.Status200OK)]
    public async Task<IActionResult> BulkUpdateVariantPrices(
        Guid id,
        [FromBody] BulkUpdateVariantPricesRequest request,
        CancellationToken cancellationToken)
    {
        if (EnsureVariantsEnabled() is { } denied)
            return denied;

        var result = await _mediator.Send(
            new BulkUpdateVariantPricesCommand(id, request.Mode, request.Items ?? Array.Empty<BulkUpdateVariantPriceItem>()),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<int>.Fail(result.Error.Description));
        return Ok(ApiResponse<int>.Ok(result.Value, $"{result.Value} variante(s) mise(s) à jour"));
    }

    [HttpPost("{id:guid}/opening-valuation-layer")]
    [Authorize(Policy = PermissionPolicies.ProductsUpdate)]
    public async Task<IActionResult> CreateOpeningValuationLayer(
        Guid id,
        [FromBody] CreateOpeningValuationLayerCommand command,
        CancellationToken cancellationToken)
    {
        if (command.ProductId != id && command.ProductId != Guid.Empty)
            return BadRequest(ApiResponse<object>.Fail("L'identifiant produit ne correspond pas."));

        var result = await _mediator.Send(command with { ProductId = id }, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        return Ok(ApiResponse<object>.Ok(null!, "Couche d'ouverture créée"));
    }
}

/// <summary>Request body for bulk FODEC flag lookup.</summary>
public sealed class GetProductFodecFlagsRequest
{
    public IReadOnlyList<Guid>? ProductIds { get; init; }
}
