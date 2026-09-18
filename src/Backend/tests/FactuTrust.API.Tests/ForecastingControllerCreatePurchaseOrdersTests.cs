using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Forecasting;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Forecasting.Dtos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
// ForecastingController lives in namespace FactuTrust.API.Controllers, which also declares its own
// ApiResponse<T> (in InventoryController.cs). That same-namespace type shadows the one in
// FactuTrust.Application.DTOs, so the controller returns the Controllers variant — alias it
// explicitly here to avoid the CS0104 ambiguity and assert against the real runtime type.
using PoApiResponse = FactuTrust.API.Controllers.ApiResponse<FactuTrust.Application.Features.Forecasting.Dtos.CreatePurchaseOrdersResultDto>;

namespace FactuTrust.API.Tests;

/// <summary>
/// Controller-level tests for <c>POST replenishment/create-purchase-orders</c>. They pin the
/// user-facing message contract introduced by the "PO never appears as Brouillon" fix:
///   • when nothing is created because the recommendations have no supplier, the response must
///     explicitly tell the user to assign one and retry (not a generic "0 created");
///   • the nominal path still reports the created/linked counts.
/// </summary>
public sealed class ForecastingControllerCreatePurchaseOrdersTests
{
    private static ForecastingController CreateController(IReplenishmentService replenishment) =>
        new(
            Mock.Of<IForecastingService>(),
            replenishment,
            Mock.Of<IPromotionRecommendationService>(),
            Mock.Of<IAbcXyzClassifier>(),
            Mock.Of<ITunisianCalendarService>(),
            Mock.Of<IForecastRecomputeOrchestrator>(),
            Mock.Of<ICurrentUser>(),
            Options.Create(new ForecastingOptions { Enabled = true }));

    private static CreatePurchaseOrdersResultDto Result(
        int created, int linked, IReadOnlyList<Guid>? unlinked = null) =>
        new(
            CreatedPurchaseOrdersCount: created,
            LinkedRecommendationsCount: linked,
            TotalEstimatedQty: 0m,
            CreatedPurchaseOrders: Array.Empty<CreatedPurchaseOrderDto>(),
            Warnings: Array.Empty<string>(),
            UnlinkedRecommendationIds: unlinked ?? Array.Empty<Guid>());

    [Fact]
    public async Task CreatePurchaseOrders_WhenNoneCreatedBecauseNoSupplier_ReturnsExplicitGuidance()
    {
        var recId = Guid.NewGuid();
        var service = new Mock<IReplenishmentService>();
        service.Setup(s => s.CreatePurchaseOrdersAsync(It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<IReadOnlyList<CreatePurchaseOrderLinePriceDto>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result(created: 0, linked: 0, unlinked: new[] { recId }));
        var controller = CreateController(service.Object);

        var result = await controller.CreatePurchaseOrders(
            new CreatePurchaseOrdersRequestDto(new[] { recId }, null), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = Assert.IsType<PoApiResponse>(ok.Value);
        Assert.True(payload.Success);
        Assert.Contains("sans fournisseur", payload.Message);
        Assert.Equal(0, payload.Data!.CreatedPurchaseOrdersCount);
        Assert.Single(payload.Data.UnlinkedRecommendationIds);
    }

    [Fact]
    public async Task CreatePurchaseOrders_WhenNoneCreatedAndNoUnlinked_ReturnsGenericMessage()
    {
        var service = new Mock<IReplenishmentService>();
        service.Setup(s => s.CreatePurchaseOrdersAsync(It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<IReadOnlyList<CreatePurchaseOrderLinePriceDto>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result(created: 0, linked: 0));
        var controller = CreateController(service.Object);

        var result = await controller.CreatePurchaseOrders(
            new CreatePurchaseOrdersRequestDto(new[] { Guid.NewGuid() }, null), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = Assert.IsType<PoApiResponse>(ok.Value);
        Assert.DoesNotContain("sans fournisseur", payload.Message);
    }

    [Fact]
    public async Task CreatePurchaseOrders_WhenCreated_ReturnsCountMessage()
    {
        var service = new Mock<IReplenishmentService>();
        service.Setup(s => s.CreatePurchaseOrdersAsync(It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<IReadOnlyList<CreatePurchaseOrderLinePriceDto>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result(created: 1, linked: 1));
        var controller = CreateController(service.Object);

        var result = await controller.CreatePurchaseOrders(
            new CreatePurchaseOrdersRequestDto(new[] { Guid.NewGuid() }, null), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = Assert.IsType<PoApiResponse>(ok.Value);
        Assert.True(payload.Success);
        Assert.Contains("1 bon(s) de commande créé(s)", payload.Message);
        Assert.Equal(1, payload.Data!.CreatedPurchaseOrdersCount);
    }

    [Fact]
    public async Task CreatePurchaseOrders_WithEmptySelection_ReturnsBadRequest()
    {
        var service = new Mock<IReplenishmentService>();
        var controller = CreateController(service.Object);

        var result = await controller.CreatePurchaseOrders(
            new CreatePurchaseOrdersRequestDto(Array.Empty<Guid>(), null), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        service.Verify(
            s => s.CreatePurchaseOrdersAsync(It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<IReadOnlyList<CreatePurchaseOrderLinePriceDto>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}
