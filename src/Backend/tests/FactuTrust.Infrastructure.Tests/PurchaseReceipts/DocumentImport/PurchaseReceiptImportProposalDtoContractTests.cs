using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PurchaseReceipts.DocumentImport;

/// <summary>
/// Fige la forme JSON de <see cref="PurchaseReceiptImportProposalDto"/>, le contrat consommé par
/// le frontend (voir le plan, section 7 et la note de coordination du pair frontend : enums
/// sérialisées en PascalCase via <c>JsonStringEnumConverter</c>, propriétés en camelCase). Un
/// renommage accidentel de propriété casserait silencieusement le mapping Angular sans faire
/// échouer la compilation C#.
/// </summary>
public sealed class PurchaseReceiptImportProposalDtoContractTests
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
    };

    private static PurchaseReceiptImportProposalDto BuildFullyPopulatedProposal()
    {
        var supplierPrefill = new SupplierPrefillDto(
            "Fournisseur Test", SupplierType.Business, "1772793W/A/M/000",
            "Rue X", "Tunis", "1000", "Tunis", "f@example.com", "20123456",
            new List<string> { "Street" });

        var productPrefill = new ProductPrefillDto(
            "PROD-1", false, "Produit Test", ProductType.Product,
            100m, VatRate.Standard, "pcs", null, true, null);

        var line = new PurchaseReceiptImportLineDto(
            0, "PROD-1", "Produit Test", "pcs", 1m, 100m, null, 19m, 100m,
            "name", Guid.NewGuid(), "PROD-1", "Produit Test", 19m, false,
            new List<ProductCandidateDto>(), productPrefill);

        var supplier = new PurchaseReceiptImportSupplierDto(
            "NotFound", null, null, "Fournisseur Test", "1772793W/A/M/000",
            new List<SupplierCandidateDto>(), supplierPrefill);

        var header = new PurchaseReceiptImportHeaderDto(
            DateTime.UtcNow, "BL-42", null, "TND", "Document d'origine : FA-42", null);

        var totals = new PurchaseReceiptImportTotalsDto(
            100m, 19m, null, null, null, 119m,
            new List<PurchaseReceiptImportVatBreakdownDto> { new(19m, 100m, 19m) });

        var expectedTotals = new PurchaseReceiptImportExpectedTotalsDto(100m, 19m, 119m);

        var warning = new PurchaseReceiptImportWarningDto(
            PurchaseReceiptImportWarningCodes.CurrencyNotTnd, PurchaseReceiptImportWarningSeverities.Warning,
            "Message de test", null);

        return new PurchaseReceiptImportProposalDto(
            "docstrange", true, "INVOICE", "FA-42", header, supplier,
            new List<PurchaseReceiptImportLineDto> { line }, totals, expectedTotals,
            "high", new List<PurchaseReceiptImportWarningDto> { warning }, true, true, true);
    }

    [Fact]
    public void Wire_shape_uses_stable_camel_case_paths_for_the_frontend()
    {
        var json = JsonSerializer.Serialize(BuildFullyPopulatedProposal(), Options);
        var node = JsonNode.Parse(json)!;

        Assert.NotNull(node["extractionProvider"]);
        Assert.NotNull(node["ocrApplied"]);
        Assert.NotNull(node["documentType"]);
        Assert.NotNull(node["header"]?["deliveryNoteNumber"]);
        Assert.NotNull(node["header"]?["suggestedNotes"]);
        Assert.NotNull(node["supplier"]?["matchOutcome"]);
        Assert.NotNull(node["supplier"]?["prefill"]?["missingRequiredFields"]);
        Assert.NotNull(node["lines"]?[0]?["matchMethod"]);
        Assert.NotNull(node["lines"]?[0]?["prefill"]?["vatRate"]);
        Assert.NotNull(node["documentTotals"]?["vatBreakdown"]);
        Assert.NotNull(node["expectedReceiptTotals"]?["totalAmount"]);
        Assert.NotNull(node["warnings"]?[0]?["code"]);
        Assert.NotNull(node["canCreateSupplier"]);
        Assert.NotNull(node["canCreateProduct"]);
        Assert.NotNull(node["canAttach"]);
    }

    [Fact]
    public void Enums_are_serialised_verbatim_as_pascal_case_strings_not_camel_case()
    {
        var json = JsonSerializer.Serialize(BuildFullyPopulatedProposal(), Options);
        var node = JsonNode.Parse(json)!;

        Assert.Equal("Business", node["supplier"]?["prefill"]?["type"]?.GetValue<string>());
        Assert.Equal("Standard", node["lines"]?[0]?["prefill"]?["vatRate"]?.GetValue<string>());
    }
}
