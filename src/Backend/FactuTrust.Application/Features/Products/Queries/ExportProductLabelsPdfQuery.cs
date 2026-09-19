using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Models;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.Options;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Application.Features.Products.Queries;

public sealed record ExportProductLabelsPdfQuery(ProductLabelRequestDto Request)
    : IRequest<Result<ProductLabelsPdfResult>>;

public sealed class ExportProductLabelsPdfQueryValidator : AbstractValidator<ExportProductLabelsPdfQuery>
{
    public ExportProductLabelsPdfQueryValidator()
    {
        RuleFor(x => x.Request.Items)
            .NotEmpty().WithMessage("Sélectionnez au moins un article.");
    }
}

public sealed class ExportProductLabelsPdfQueryHandler
    : IRequestHandler<ExportProductLabelsPdfQuery, Result<ProductLabelsPdfResult>>
{
    /// <summary>
    /// Plafonds de volume. Ils ne protègent pas d'un abus mais d'une <b>erreur de sélection</b> :
    /// « tout cocher » sur un catalogue de dix mille références produirait un PDF que personne
    /// ne veut imprimer et une requête qui expirerait. Mieux vaut un refus immédiat et explicite
    /// qu'un délai d'attente sans message.
    /// </summary>
    public const int MaxLabels = 500;
    public const int MaxDistinctProducts = 200;
    public const int MaxQuantityPerProduct = 500;

    private readonly IProductRepository _products;
    private readonly IProductLabelPdfRenderer _renderer;
    private readonly IAuditService _auditService;
    private readonly BarcodeOptions _options;

    public ExportProductLabelsPdfQueryHandler(
        IProductRepository products,
        IProductLabelPdfRenderer renderer,
        IAuditService auditService,
        IOptions<BarcodeOptions> options)
    {
        _products = products;
        _renderer = renderer;
        _auditService = auditService;
        _options = options.Value;
    }

    public async Task<Result<ProductLabelsPdfResult>> Handle(
        ExportProductLabelsPdfQuery request,
        CancellationToken cancellationToken)
    {
        // 404 et non 503 : drapeau éteint, la fonctionnalité n'existe pas encore pour ce
        // déploiement. Un 503 laisserait croire à un incident.
        if (!_options.LabelPrintingEnabled)
            return Result.Failure<ProductLabelsPdfResult>(
                Error.NotFound("L'impression d'étiquettes n'est pas activée sur cette installation."));

        var dto = request.Request;

        var layout = LabelSheetLayout.Find(dto.Layout);
        if (layout is null)
            return Result.Failure<ProductLabelsPdfResult>(
                Error.Validation("Layout", $"Gabarit d'étiquettes inconnu : « {dto.Layout} »."));

        var items = dto.Items
            .Where(i => i.ProductId != Guid.Empty)
            .GroupBy(i => i.ProductId)
            .Select(g => new { ProductId = g.Key, Quantity = g.Sum(x => x.Quantity) })
            .ToList();

        if (items.Count == 0)
            return Result.Failure<ProductLabelsPdfResult>(
                Error.Validation("Items", "Sélectionnez au moins un article."));

        if (items.Count > MaxDistinctProducts)
            return Result.Failure<ProductLabelsPdfResult>(Error.Validation("Items",
                $"Réduisez la sélection : {MaxDistinctProducts} articles distincts au maximum par impression."));

        if (items.Any(i => i.Quantity < 1 || i.Quantity > MaxQuantityPerProduct))
            return Result.Failure<ProductLabelsPdfResult>(Error.Validation("Items",
                $"La quantité par article doit être comprise entre 1 et {MaxQuantityPerProduct}."));

        var total = items.Sum(i => i.Quantity);
        if (total > MaxLabels)
            return Result.Failure<ProductLabelsPdfResult>(Error.Validation("Items",
                $"Réduisez la sélection : {MaxLabels} étiquettes au maximum par impression (demandé : {total})."));

        var labels = new List<ProductLabelContent>(total);

        foreach (var item in items)
        {
            var product = await _products.GetByIdAsync(item.ProductId, cancellationToken);
            if (product is null)
                return Result.Failure<ProductLabelsPdfResult>(Error.NotFound("Product", item.ProductId));

            var content = new ProductLabelContent
            {
                Name = product.Name,
                Code = product.Code,
                Barcode = product.Barcode?.Value,
                Symbology = product.Barcode?.Symbology,
                Price = dto.IncludePrice
                    ? $"{product.CalculateSalePriceTtc():N3} {product.UnitPrice.Currency}"
                    : null
            };

            for (var i = 0; i < item.Quantity; i++)
                labels.Add(content);
        }

        var pdf = _renderer.Render(new ProductLabelsPdfContext
        {
            Layout = layout,
            Labels = labels,
            IncludeCode = dto.IncludeCode
        });

        await _auditService.LogAsync(
            AuditActions.Product.LabelsExported,
            "Product",
            null,
            newValues: new { Layout = layout.Key, Labels = labels.Count, Products = items.Count },
            cancellationToken: cancellationToken);

        var fileName = $"etiquettes_{layout.Key}_{DateTime.UtcNow:yyyyMMdd_HHmm}.pdf";
        return Result.Success(new ProductLabelsPdfResult(pdf, fileName, "application/pdf"));
    }
}

/// <summary>Gabarits disponibles, pour alimenter le choix de planche côté front.</summary>
public sealed record GetLabelLayoutsQuery : IRequest<IReadOnlyList<LabelLayoutDto>>;

public sealed class GetLabelLayoutsQueryHandler
    : IRequestHandler<GetLabelLayoutsQuery, IReadOnlyList<LabelLayoutDto>>
{
    public Task<IReadOnlyList<LabelLayoutDto>> Handle(
        GetLabelLayoutsQuery request, CancellationToken cancellationToken)
    {
        IReadOnlyList<LabelLayoutDto> layouts = LabelSheetLayout.All
            .Select(l => new LabelLayoutDto
            {
                Key = l.Key,
                Label = l.Label,
                LabelsPerPage = l.LabelsPerPage,
                IsRoll = l.IsRoll
            })
            .ToList();

        return Task.FromResult(layouts);
    }
}
