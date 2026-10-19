using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using MediatR;

namespace FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;

/// <summary>Issue de <see cref="ProductLineMatcher.MatchAsync"/> pour une ligne du document.</summary>
public sealed record ProductLineMatch(
    string MatchMethod, // "code" | "barcode" | "name" | "ambiguous" | "none"
    Guid? ProductId,
    string? ProductCode,
    string? ProductName,
    decimal? ProductVatRatePercent,
    IReadOnlyList<ProductCandidateDto> Candidates,
    ProductPrefillDto? Prefill,
    bool InactiveOrTemplate);

/// <summary>
/// Rapproche une ligne de document extraite avec un produit existant du tenant.
/// Voir le plan, section 5. Aucune table de correspondance « référence fournisseur → produit » :
/// le rapprochement par code ne fonctionne que si le code interne égale le code fournisseur.
/// </summary>
public sealed class ProductLineMatcher
{
    private const int CandidateQueryPageSize = 10;
    private const int MaxCandidates = 5;
    private static readonly int[] BarcodeLengths = { 8, 12, 13, 14 };

    private readonly IProductRepository _products;
    private readonly IMediator _mediator;

    public ProductLineMatcher(IProductRepository products, IMediator mediator)
    {
        _products = products;
        _mediator = mediator;
    }

    public async Task<ProductLineMatch> MatchAsync(
        ExtractedLineDto line, Guid? preferredSupplierId, CancellationToken cancellationToken)
    {
        var reference = line.Reference?.Trim();

        if (!string.IsNullOrEmpty(reference))
        {
            var byCode = await _products.GetByCodeAsync(reference, cancellationToken);
            if (byCode is not null)
                return Resolve("code", byCode);

            if (reference.Length is 8 or 12 or 13 or 14 && reference.All(char.IsDigit))
            {
                var byBarcode = await _products.GetByBarcodeAsync(reference, cancellationToken);
                if (byBarcode is not null)
                    return Resolve("barcode", byBarcode);
            }
        }

        var designation = line.Designation?.Trim();
        if (!string.IsNullOrEmpty(designation))
        {
            var query = new GetProductsQuery(
                Search: designation, IsActive: true, PageSize: CandidateQueryPageSize, ExcludeVariantTemplates: true);
            var result = await _mediator.Send(query, cancellationToken);
            if (result.IsSuccess)
            {
                var hits = result.Value.Items
                    .Where(p => InvoiceImportParsing.Similarity(p.Name, designation) >= InvoiceImportParsing.NameMatchThreshold
                                || string.Equals(p.Code, designation, StringComparison.OrdinalIgnoreCase))
                    .ToList();

                if (hits.Count == 1)
                {
                    var full = await _products.GetByIdAsync(hits[0].Id, cancellationToken);
                    if (full is not null)
                        return Resolve("name", full);
                }

                if (hits.Count > 1)
                {
                    return new ProductLineMatch(
                        "ambiguous", null, null, null, null,
                        hits.Take(MaxCandidates)
                            .Select(p => new ProductCandidateDto(p.Id, p.Code, p.Name, p.VatRatePercent, p.PurchasePrice))
                            .ToList(),
                        await BuildPrefillAsync(line, reference, preferredSupplierId, cancellationToken),
                        false);
                }
            }
        }

        return new ProductLineMatch(
            "none", null, null, null, null,
            Array.Empty<ProductCandidateDto>(),
            await BuildPrefillAsync(line, reference, preferredSupplierId, cancellationToken),
            false);
    }

    private static ProductLineMatch Resolve(string matchMethod, Product product)
    {
        if (!product.IsActive || ProductCommercialGuards.EnsureCanAppearOnDocument(product).IsFailure)
        {
            return new ProductLineMatch(
                "none", null, null, null, null, Array.Empty<ProductCandidateDto>(), null, InactiveOrTemplate: true);
        }

        return new ProductLineMatch(
            matchMethod, product.Id, product.Code, product.Name, product.VatRate.ToDecimal(),
            Array.Empty<ProductCandidateDto>(), null, false);
    }

    private async Task<ProductPrefillDto> BuildPrefillAsync(
        ExtractedLineDto line, string? reference, Guid? preferredSupplierId, CancellationToken cancellationToken)
    {
        string? code = null;
        var codeConflict = false;
        if (!string.IsNullOrEmpty(reference))
        {
            var cleaned = new string(reference.Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();
            cleaned = cleaned.Length > 50 ? cleaned[..50] : cleaned;
            var existing = await _products.GetByCodeAsync(cleaned, cancellationToken);
            if (existing is null)
                code = cleaned;
            else
                codeConflict = true;
        }

        var name = (line.Designation ?? string.Empty).Trim();
        name = name.Length > 200 ? name[..200] : name;

        var vatRatePercent = InvoiceImportParsing.ClampVatRate(line.VatRatePercent);
        var vatRate = VatRateExtensions.FromPercent(vatRatePercent);

        var isBarcodeShape = !string.IsNullOrEmpty(reference)
            && reference.Length is 8 or 12 or 13 or 14 && reference.All(char.IsDigit);

        return new ProductPrefillDto(
            code, codeConflict, name, ProductType.Product,
            line.UnitPriceHt, vatRate, line.Unit, isBarcodeShape ? reference : null,
            IsStockManaged: true, preferredSupplierId);
    }
}
