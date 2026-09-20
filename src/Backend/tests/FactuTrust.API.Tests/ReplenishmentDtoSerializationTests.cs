using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.Features.Forecasting.Dtos;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Sanity checks for the V2 DTO serialization contract. Confirms the JSON shape Angular receives
/// (camelCase, enums as strings, optional fields preserved) for the Replenishment V2 endpoints.
/// </summary>
public sealed class ReplenishmentDtoSerializationTests
{
    private static JsonSerializerOptions Options()
    {
        var o = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        };
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return o;
    }

    [Fact]
    public void ReplenishmentRecommendationDto_RoundtripsAllFields()
    {
        var dto = new ReplenishmentRecommendationDto(
            Id: Guid.NewGuid(),
            ProductId: Guid.NewGuid(),
            ProductCode: "PROD-1",
            ProductName: "Produit X",
            WarehouseId: Guid.NewGuid(),
            WarehouseName: "Entrepôt Principal",
            GeneratedAt: new DateTime(2026, 5, 12, 9, 0, 0, DateTimeKind.Utc),
            CurrentStockOnHand: 10m,
            RecommendedQty: 100m,
            Rop: 50m,
            SafetyStock: 20m,
            LeadTimeDays: 7,
            DailyDemand: 5m,
            ReasonCodes: new[] { "BelowSafetyStock", "DailyDemand:5" },
            Status: ReplenishmentStatus.Pending,
            LinkedPurchaseOrderId: null,
            ProcessedAt: null,
            ProductUnit: "Pièce",
            PreferredSupplierId: Guid.NewGuid(),
            PreferredSupplierName: "Fournisseur X",
            QuantityOnOrder: 20m,
            EffectiveQty: 30m,
            ManualQtyOverride: null,
            ManualSupplierOverride: null,
            DaysOfStockRemaining: 2m,
            UserNotes: "Urgent: supplier confirmed.",
            UrgencyLevel: "Urgent",
            SuggestedPurchaseUnitPrice: 12.5m);

        var json = JsonSerializer.Serialize(dto, Options());

        Assert.Contains("\"productCode\":\"PROD-1\"", json);
        Assert.Contains("\"status\":\"pending\"", json);
        Assert.Contains("\"urgencyLevel\":\"Urgent\"", json);
        Assert.Contains("\"effectiveQty\":30", json);
        Assert.Contains("\"daysOfStockRemaining\":2", json);
        Assert.Contains("\"preferredSupplierName\":\"Fournisseur X\"", json);
        Assert.Contains("\"userNotes\":\"Urgent: supplier confirmed.\"", json);
        Assert.Contains("\"suggestedPurchaseUnitPrice\":12.5", json);

        var roundtrip = JsonSerializer.Deserialize<ReplenishmentRecommendationDto>(json, Options())!;
        Assert.Equal(dto.Id, roundtrip.Id);
        Assert.Equal(dto.UrgencyLevel, roundtrip.UrgencyLevel);
        Assert.Equal(dto.ReasonCodes.Count, roundtrip.ReasonCodes.Count);
    }

    [Fact]
    public void DismissReplenishmentRequestDto_RequiresReasonInJson()
    {
        var dto = new DismissReplenishmentRequestDto("budget cancelled");
        var json = JsonSerializer.Serialize(dto, Options());
        Assert.Contains("\"reason\":\"budget cancelled\"", json);
    }

    [Fact]
    public void OverrideReplenishmentRequestDto_AllowsBothNulls()
    {
        var dto = new OverrideReplenishmentRequestDto(null, null);
        var json = JsonSerializer.Serialize(dto, Options());
        var roundtrip = JsonSerializer.Deserialize<OverrideReplenishmentRequestDto>(json, Options())!;
        Assert.Null(roundtrip.ManualQty);
        Assert.Null(roundtrip.ManualSupplierId);
    }

    [Fact]
    public void CreatePurchaseOrdersRequestDto_RoundtripsLinePrices()
    {
        var recId = Guid.NewGuid();
        var dto = new CreatePurchaseOrdersRequestDto(
            new[] { recId },
            new[] { new CreatePurchaseOrderLinePriceDto(recId, 19.5m) });

        var json = JsonSerializer.Serialize(dto, Options());
        Assert.Contains("\"linePrices\"", json);
        Assert.Contains("\"unitPrice\":19.5", json);

        var roundtrip = JsonSerializer.Deserialize<CreatePurchaseOrdersRequestDto>(json, Options())!;
        Assert.Single(roundtrip.RecommendationIds);
        Assert.Single(roundtrip.LinePrices!);
        Assert.Equal(19.5m, roundtrip.LinePrices![0].UnitPrice);
    }

    [Fact]
    public void CreatePurchaseOrdersResultDto_ExposesCreatedOrdersAndWarnings()
    {
        var poId = Guid.NewGuid();
        var supplierId = Guid.NewGuid();
        var recId = Guid.NewGuid();
        var unlinkedId = Guid.NewGuid();

        var dto = new CreatePurchaseOrdersResultDto(
            CreatedPurchaseOrdersCount: 1,
            LinkedRecommendationsCount: 1,
            TotalEstimatedQty: 100m,
            CreatedPurchaseOrders: new[]
            {
                new CreatedPurchaseOrderDto(poId, "BC-2026-000001", supplierId, "Fournisseur A", 1, 1234.5m, new[] { recId })
            },
            Warnings: new[] { "Recommandation X non liée : aucun fournisseur." },
            UnlinkedRecommendationIds: new[] { unlinkedId });

        var json = JsonSerializer.Serialize(dto, Options());
        Assert.Contains("\"createdPurchaseOrdersCount\":1", json);
        Assert.Contains("\"purchaseOrderNumber\":\"BC-2026-000001\"", json);
        Assert.Contains("\"warnings\":[", json);
        Assert.Contains("\"unlinkedRecommendationIds\":[", json);
        Assert.Contains(unlinkedId.ToString(), json);

        var roundtrip = JsonSerializer.Deserialize<CreatePurchaseOrdersResultDto>(json, Options())!;
        Assert.Single(roundtrip.UnlinkedRecommendationIds);
        Assert.Equal(unlinkedId, roundtrip.UnlinkedRecommendationIds[0]);
    }

    [Fact]
    public void ReplenishmentKpiDto_RoundtripsTopUrgencies()
    {
        var dto = new ReplenishmentKpiDto(
            PendingCount: 12,
            UrgentCount: 3,
            OutOfStockCount: 1,
            EstimatedValueToOrder: 9876.5m,
            Currency: "TND",
            ServiceLevelPercent: 97.5m,
            StockOutRatePercent: 2.5m,
            ComputedAt: DateTime.UtcNow,
            TopUrgencies: new[]
            {
                new KpiTopUrgencyDto(Guid.NewGuid(), "P-1", "Produit 1", 0m, 0m, 50m),
                new KpiTopUrgencyDto(Guid.NewGuid(), "P-2", "Produit 2", 5m, 1m, 80m),
            });

        var json = JsonSerializer.Serialize(dto, Options());
        var roundtrip = JsonSerializer.Deserialize<ReplenishmentKpiDto>(json, Options())!;
        Assert.Equal(12, roundtrip.PendingCount);
        Assert.Equal(2, roundtrip.TopUrgencies.Count);
        Assert.Equal("Produit 1", roundtrip.TopUrgencies[0].ProductName);
    }

    [Fact]
    public void ReplenishmentDecisionAuditDto_PreservesAllFields()
    {
        var dto = new ReplenishmentDecisionAuditDto(
            Id: Guid.NewGuid(),
            RecommendationId: Guid.NewGuid(),
            FromStatus: ReplenishmentStatus.Pending,
            ToStatus: ReplenishmentStatus.Approved,
            ActionType: "Approve",
            Reason: null,
            ActorUserId: "user-1",
            ActedAt: DateTime.UtcNow,
            PayloadJson: "{\"k\":\"v\"}");

        var json = JsonSerializer.Serialize(dto, Options());
        Assert.Contains("\"actionType\":\"Approve\"", json);
        Assert.Contains("\"fromStatus\":\"pending\"", json);
        Assert.Contains("\"toStatus\":\"approved\"", json);
    }

    [Fact]
    public void ReplenishmentFiltersDto_DefaultsAreSafe()
    {
        var filters = new ReplenishmentFiltersDto();
        Assert.Null(filters.WarehouseId);
        Assert.Null(filters.Status);
        Assert.True(filters.OrderDesc);
        Assert.Equal(1, filters.Page);
        Assert.Equal(50, filters.PageSize);
    }
}
