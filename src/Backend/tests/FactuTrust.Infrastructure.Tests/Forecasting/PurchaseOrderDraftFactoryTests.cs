using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Forecasting;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Services.PurchaseOrders;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Forecasting;

/// <summary>
/// Covers the additive <c>UnlinkedRecommendationIds</c> reporting on
/// <see cref="PurchaseOrderDraftFactory"/>. The skip logic itself is unchanged — these tests pin
/// the contract that recommendations which cannot be attached to a draft PO (no supplier resolved,
/// supplier missing/inactive) are surfaced to the caller, while a resolvable line still produces a
/// Draft PO with no false unlinked entry. This is the backend half of the "PO never appears as
/// Brouillon" fix: the root cause is a supplier-less recommendation, and the factory must say so.
/// Also pins the M3 numbering contract: every kept draft reserves its number through the atomic
/// <c>IDocumentNumberService</c> (one reservation per draft), and skipped groups never burn a
/// sequence value.
/// </summary>
public sealed class PurchaseOrderDraftFactoryTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static PurchaseOrderDraftFactory CreateFactory(Mock<IDocumentNumberService>? numbering = null)
    {
        numbering ??= new Mock<IDocumentNumberService>();
        var sequence = 0;
        numbering.Setup(s => s.ReserveNextAsync(
                It.IsAny<Guid>(),
                NumberingDocumentType.PurchaseOrder,
                It.IsAny<int>(),
                It.IsAny<DateTime>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, NumberingDocumentType _, int year, DateTime _, CancellationToken _) =>
            {
                var next = Interlocked.Increment(ref sequence);
                return new DocumentNumberResult($"BC-{year}-{next:D6}", year, next, "BC");
            });
        return new PurchaseOrderDraftFactory(numbering.Object, NullLogger<PurchaseOrderDraftFactory>.Instance);
    }

    private static Supplier CreateSupplier(string name = "Fournisseur Test")
    {
        var address = Address.Create("1 rue test", "Tunis", "Tunis").Value;
        var email = Email.Create("supplier.draft@test.com").Value;
        var nif = NIF.Create("1234567/A/B/C/000").Value;
        return Supplier.Create(name, SupplierType.Business, address, email, nif: nif).Value;
    }

    private static Product CreateProduct(string code = "PR-1")
    {
        var category = ProductCategory.Create("CAT", "Catégorie test").Value;
        var unitPrice = Money.Create(100m, Money.DefaultCurrency);
        return Product.Create(
            code,
            "Produit " + code,
            ProductType.Product,
            unitPrice,
            VatRate.Standard,
            category.Id,
            purchasePrice: unitPrice).Value;
    }

    private static Dictionary<Guid, Money> UnitPricesFor(
        IEnumerable<ReplenishmentRecommendation> recs,
        decimal amount = 42.5m) =>
        recs.ToDictionary(r => r.Id, _ => Money.Create(amount, Money.DefaultCurrency));

    /// <summary>Builds a recommendation for <paramref name="productId"/>, optionally giving it a
    /// preferred supplier (mirrors the real V2 enrichment path).</summary>
    private static ReplenishmentRecommendation CreateRec(
        Guid productId, Guid? supplierId = null, string? supplierName = null, Guid? warehouseId = null)
    {
        var rec = ReplenishmentRecommendation.Create(
            productId: productId,
            warehouseId: warehouseId ?? Guid.NewGuid(),
            recommendedQty: 100m,
            rop: 50m,
            safetyStock: 20m,
            leadTimeDays: 7,
            dailyDemand: 5m,
            reasonCodesJson: "[\"BelowSafetyStock\"]");
        if (supplierId is not null)
            rec.SetV2Enrichment(supplierId, supplierName, quantityOnHand: 5m, quantityOnOrder: 0m, daysOfStockRemaining: 1m);
        return rec;
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_WithResolvedActiveSupplier_BuildsDraftAndReportsNoUnlinked()
    {
        var factory = CreateFactory();
        var supplier = CreateSupplier();
        var product = CreateProduct();
        var warehouseId = Guid.NewGuid();
        var rec = CreateRec(product.Id, supplier.Id, supplier.Name, warehouseId);

        var unitPrices = UnitPricesFor(new[] { rec }, 25m);
        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { rec },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            unitPrices,
            actorUserId: "user-1",
            tenantId: TenantId);

        var draft = Assert.Single(result.Drafts);
        Assert.Equal(PurchaseOrderStatus.Draft, draft.PurchaseOrder.Status);
        Assert.Equal(25m, draft.PurchaseOrder.Lines.Single().UnitPrice.Amount);
        Assert.Equal(supplier.Id, draft.PurchaseOrder.SupplierId);
        // C1 regression pin: the PO must carry the recommendation's warehouse so the next
        // generation run counts its lines as on-order stock (no duplicate recommendation).
        Assert.Equal(warehouseId, draft.PurchaseOrder.WarehouseId);
        Assert.Single(draft.PurchaseOrder.Lines);
        Assert.Equal(rec.Id, Assert.Single(draft.RecommendationIds));
        Assert.Empty(result.UnlinkedRecommendationIds);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_SameSupplierTwoWarehouses_BuildsOneDraftPerWarehouse()
    {
        var factory = CreateFactory();
        var supplier = CreateSupplier();
        var product = CreateProduct();
        var warehouseA = Guid.NewGuid();
        var warehouseB = Guid.NewGuid();
        var recA = CreateRec(product.Id, supplier.Id, supplier.Name, warehouseA);
        var recB = CreateRec(product.Id, supplier.Id, supplier.Name, warehouseB);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { recA, recB },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            UnitPricesFor(new[] { recA, recB }),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Equal(2, result.Drafts.Count);
        Assert.Equal(2, result.Drafts.Select(d => d.PurchaseOrder.WarehouseId).Distinct().Count());
        Assert.Contains(result.Drafts, d => d.PurchaseOrder.WarehouseId == warehouseA);
        Assert.Contains(result.Drafts, d => d.PurchaseOrder.WarehouseId == warehouseB);
        Assert.All(result.Drafts, d => Assert.Equal(supplier.Id, d.PurchaseOrder.SupplierId));
        // Each draft links exactly its own warehouse's recommendation.
        Assert.Equal(recA.Id, Assert.Single(result.Drafts.Single(d => d.PurchaseOrder.WarehouseId == warehouseA).RecommendationIds));
        Assert.Equal(recB.Id, Assert.Single(result.Drafts.Single(d => d.PurchaseOrder.WarehouseId == warehouseB).RecommendationIds));
        Assert.Empty(result.UnlinkedRecommendationIds);
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_SameSupplierSameWarehouse_KeepsSingleDraft()
    {
        var factory = CreateFactory();
        var supplier = CreateSupplier();
        var productA = CreateProduct("PR-A");
        var productB = CreateProduct("PR-B");
        var warehouse = Guid.NewGuid();
        var recA = CreateRec(productA.Id, supplier.Id, supplier.Name, warehouse);
        var recB = CreateRec(productB.Id, supplier.Id, supplier.Name, warehouse);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { recA, recB },
            new Dictionary<Guid, Product> { [productA.Id] = productA, [productB.Id] = productB },
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            UnitPricesFor(new[] { recA, recB }),
            actorUserId: "user-1",
            tenantId: TenantId);

        // Regression pin: the historical behaviour (one PO per supplier) is preserved
        // when all lines share the same warehouse.
        var draft = Assert.Single(result.Drafts);
        Assert.Equal(warehouse, draft.PurchaseOrder.WarehouseId);
        Assert.Equal(2, draft.RecommendationIds.Count);
        Assert.Equal(2, draft.PurchaseOrder.Lines.Count);
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_WithNoSupplier_ReportsUnlinkedAndBuildsNoDraft()
    {
        var factory = CreateFactory();
        var product = CreateProduct();
        var rec = CreateRec(product.Id, supplierId: null);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { rec },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier>(),
            UnitPricesFor(new[] { rec }),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Empty(result.Drafts);
        Assert.Equal(rec.Id, Assert.Single(result.UnlinkedRecommendationIds));
        Assert.NotEmpty(result.Warnings);
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_WithSupplierMissingFromDictionary_ReportsUnlinked()
    {
        var factory = CreateFactory();
        var product = CreateProduct();
        // Recommendation references a supplier id that the caller did not supply in the dictionary.
        var rec = CreateRec(product.Id, supplierId: Guid.NewGuid(), supplierName: "Fantôme");

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { rec },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier>(),
            UnitPricesFor(new[] { rec }),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Empty(result.Drafts);
        Assert.Equal(rec.Id, Assert.Single(result.UnlinkedRecommendationIds));
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_WithInactiveSupplier_ReportsUnlinked()
    {
        var factory = CreateFactory();
        var supplier = CreateSupplier();
        supplier.Deactivate();
        var product = CreateProduct();
        var rec = CreateRec(product.Id, supplier.Id, supplier.Name);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { rec },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            UnitPricesFor(new[] { rec }),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Empty(result.Drafts);
        Assert.Equal(rec.Id, Assert.Single(result.UnlinkedRecommendationIds));
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_MixedSelection_LinksResolvableAndReportsTheRest()
    {
        var factory = CreateFactory();
        var supplier = CreateSupplier();
        var withSupplier = CreateProduct("PR-WITH");
        var withoutSupplier = CreateProduct("PR-WITHOUT");
        var recLinked = CreateRec(withSupplier.Id, supplier.Id, supplier.Name);
        var recUnlinked = CreateRec(withoutSupplier.Id, supplierId: null);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { recLinked, recUnlinked },
            new Dictionary<Guid, Product> { [withSupplier.Id] = withSupplier, [withoutSupplier.Id] = withoutSupplier },
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            UnitPricesFor(new[] { recLinked }),
            actorUserId: "user-1",
            tenantId: TenantId);

        var draft = Assert.Single(result.Drafts);
        Assert.Equal(recLinked.Id, Assert.Single(draft.RecommendationIds));
        Assert.Equal(recUnlinked.Id, Assert.Single(result.UnlinkedRecommendationIds));
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_WithEmptyInput_ReturnsEmptyResult()
    {
        var factory = CreateFactory();

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            Array.Empty<ReplenishmentRecommendation>(),
            new Dictionary<Guid, Product>(),
            new Dictionary<Guid, Supplier>(),
            new Dictionary<Guid, Money>(),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Empty(result.Drafts);
        Assert.Empty(result.Warnings);
        Assert.Empty(result.UnlinkedRecommendationIds);
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_TwoGroups_ReservesOneSequentialNumberPerDraft()
    {
        var numbering = new Mock<IDocumentNumberService>();
        var factory = CreateFactory(numbering);
        var supplier = CreateSupplier();
        var product = CreateProduct();
        var warehouseA = Guid.NewGuid();
        var warehouseB = Guid.NewGuid();
        var recA = CreateRec(product.Id, supplier.Id, supplier.Name, warehouseA);
        var recB = CreateRec(product.Id, supplier.Id, supplier.Name, warehouseB);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { recA, recB },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            UnitPricesFor(new[] { recA, recB }),
            actorUserId: "user-1",
            tenantId: TenantId);

        // M3 regression pin: numbers come from the atomic numbering service — exactly one
        // reservation per kept draft, sequential and distinct, never from a read-latest +
        // in-memory increment (which raced and produced duplicate BC numbers).
        Assert.Equal(2, result.Drafts.Count);
        var expectedYear = DateTime.UtcNow.Year;
        Assert.Contains(result.Drafts, d => d.PurchaseOrder.Number.Value == $"BC-{expectedYear}-000001");
        Assert.Contains(result.Drafts, d => d.PurchaseOrder.Number.Value == $"BC-{expectedYear}-000002");
        numbering.Verify(
            s => s.ReserveNextAsync(
                TenantId,
                NumberingDocumentType.PurchaseOrder,
                expectedYear,
                It.IsAny<DateTime>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_NoResolvableSupplier_NeverReservesNumber()
    {
        var numbering = new Mock<IDocumentNumberService>();
        var factory = CreateFactory(numbering);
        var product = CreateProduct();
        var rec = CreateRec(product.Id, supplierId: null);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { rec },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier>(),
            UnitPricesFor(new[] { rec }),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Empty(result.Drafts);
        numbering.Verify(
            s => s.ReserveNextAsync(
                It.IsAny<Guid>(), It.IsAny<NumberingDocumentType>(), It.IsAny<int>(),
                It.IsAny<DateTime>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_NoUsableLine_NeverReservesNumber()
    {
        var numbering = new Mock<IDocumentNumberService>();
        var factory = CreateFactory(numbering);
        var supplier = CreateSupplier();
        var product = CreateProduct();
        var rec = CreateRec(product.Id, supplier.Id, supplier.Name);

        // Product intentionally missing from the dictionary: the only line is unusable, so the
        // group is skipped BEFORE any number is reserved (no burned sequence value / gap).
        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { rec },
            new Dictionary<Guid, Product>(),
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            UnitPricesFor(new[] { rec }),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Empty(result.Drafts);
        Assert.Equal(rec.Id, Assert.Single(result.UnlinkedRecommendationIds));
        numbering.Verify(
            s => s.ReserveNextAsync(
                It.IsAny<Guid>(), It.IsAny<NumberingDocumentType>(), It.IsAny<int>(),
                It.IsAny<DateTime>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task BuildDraftPurchaseOrders_WithoutUnitPrice_ReportsUnlinked()
    {
        var factory = CreateFactory();
        var supplier = CreateSupplier();
        var product = CreateProduct();
        var rec = CreateRec(product.Id, supplier.Id, supplier.Name);

        var result = await factory.BuildDraftPurchaseOrdersAsync(
            new[] { rec },
            new Dictionary<Guid, Product> { [product.Id] = product },
            new Dictionary<Guid, Supplier> { [supplier.Id] = supplier },
            new Dictionary<Guid, Money>(),
            actorUserId: "user-1",
            tenantId: TenantId);

        Assert.Empty(result.Drafts);
        Assert.Equal(rec.Id, Assert.Single(result.UnlinkedRecommendationIds));
        Assert.Contains(result.Warnings, w => w.Contains("prix unitaire", StringComparison.OrdinalIgnoreCase));
    }
}
