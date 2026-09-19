using FactuTrust.Application.Common.Barcodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Products.Commands;

public sealed record BulkUpdateVariantPricesCommand(
    Guid ParentProductId,
    string Mode,
    IReadOnlyList<BulkUpdateVariantPriceItem> Items) : IRequest<Result<int>>;

public sealed class BulkUpdateVariantPricesCommandHandler
    : IRequestHandler<BulkUpdateVariantPricesCommand, Result<int>>
{
    private readonly IProductRepository _products;
    private readonly ICurrentUser _currentUser;
    private readonly BarcodeOptions _barcodeOptions;

    public BulkUpdateVariantPricesCommandHandler(
        IProductRepository products,
        ICurrentUser currentUser,
        IOptions<BarcodeOptions> barcodeOptions)
    {
        _products = products;
        _currentUser = currentUser;
        _barcodeOptions = barcodeOptions.Value;
    }

    public async Task<Result<int>> Handle(
        BulkUpdateVariantPricesCommand request,
        CancellationToken cancellationToken)
    {
        var parent = await _products.GetByIdAsync(request.ParentProductId, cancellationToken);
        if (parent is null)
            return Result.Failure<int>(Error.NotFound("Product", request.ParentProductId));

        if (!parent.IsVariantTemplate)
            return Result.Failure<int>(Error.Validation("IsVariantTemplate", "Le produit parent doit être un modèle de variantes."));

        var mode = request.Mode?.Trim().ToLowerInvariant() ?? "absolute";
        var updated = 0;

        if (mode == "copyfromparent")
        {
            var (children, _) = await _products.GetChildrenByParentIdAsync(
                parent.Id, 1, 500, cancellationToken);

            foreach (var child in children)
            {
                child.UpdatePrice(parent.UnitPrice);
                child.UpdatePurchasePrice(parent.PurchasePrice);
                child.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");
                await _products.UpdateAsync(child, cancellationToken);
                updated++;
            }

            return Result.Success(updated);
        }

        if (request.Items is null || request.Items.Count == 0)
            return Result.Failure<int>(Error.Validation("Items", "Aucune variante à mettre à jour."));

        foreach (var item in request.Items)
        {
            var child = await _products.GetByIdAsync(item.ChildId, cancellationToken);
            if (child is null)
                return Result.Failure<int>(Error.NotFound("Product", item.ChildId));

            if (child.ParentProductId != parent.Id)
                return Result.Failure<int>(Error.Validation("ChildId", $"La variante {child.Code} n'appartient pas à ce modèle."));

            if (item.UnitPrice.HasValue)
                child.UpdatePrice(Money.Create(item.UnitPrice.Value, child.UnitPrice.Currency));

            if (item.PurchasePrice.HasValue)
                child.UpdatePurchasePrice(Money.Create(item.PurchasePrice.Value, child.UnitPrice.Currency));

            // Troisième point d'écriture du code-barres, avec la même chaîne de contrôles
            // que la création et la mise à jour d'article. Ici, null signifie « ne touche pas »
            // (la matrice n'efface donc jamais un code existant) ; chaîne vide signifie effacer.
            if (item.Barcode is not null)
            {
                var barcodeCheck = await ValidateBarcodeAsync(item.Barcode, child.Id, cancellationToken);
                if (barcodeCheck.IsFailure)
                    return Result.Failure<int>(barcodeCheck.Error);

                var barcodeResult = child.SetBarcode(item.Barcode);
                if (barcodeResult.IsFailure)
                    return Result.Failure<int>(barcodeResult.Error);
            }

            child.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");
            await _products.UpdateAsync(child, cancellationToken);
            updated++;
        }

        return Result.Success(updated);
    }

    /// <summary>
    /// Même chaîne de contrôles que les handlers de création et de mise à jour : format,
    /// symbologie autorisée par le déploiement, puis absence de conflit avec un autre article.
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

        var taken = await _products.BarcodeExistsAsync(
            parsed.Value.Value, excludeProductId, cancellationToken);

        return taken
            ? Result.Failure(Error.Conflict("Ce code-barres est déjà utilisé par un autre article."))
            : Result.Success();
    }
}
