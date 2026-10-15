using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Stock.EventHandlers;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Logging.Abstractions;
using FactuTrust.Infrastructure.Tests.Stock;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Validates that a credit-note (AVO) validation triggers a stock entry (restoration)
/// — the dual of the deduction performed for a regular invoice (FAC).
/// </summary>
public sealed class RestoreStockOnCreditNoteValidatedHandlerTests
{
    [Fact]
    public async Task Handle_WhenStandardInvoice_ReturnsImmediatelyWithoutRepositoryCalls()
    {
        var notification = new InvoiceValidatedEvent(Guid.NewGuid(), "FAC-2026-000010", isCreditNote: false);

        var invoiceRepo = new Mock<IInvoiceRepository>(MockBehavior.Strict);
        var stockItemRepo = new Mock<IStockItemRepository>(MockBehavior.Strict);
        var warehouseRepo = new Mock<IWarehouseRepository>(MockBehavior.Strict);
        var productRepo = new Mock<IProductRepository>(MockBehavior.Strict);
        var movementRepo = new Mock<IStockMovementRepository>(MockBehavior.Strict);

        var handler = new RestoreStockOnCreditNoteValidatedHandler(
            invoiceRepo.Object,
            stockItemRepo.Object,
            warehouseRepo.Object,
            productRepo.Object,
            movementRepo.Object,
            StockTestDoubles.Passthrough(stockItemRepo.Object),
            StockTestDoubles.NoValuation(),
            StockTestDoubles.Untracked(),
            NullLogger<RestoreStockOnCreditNoteValidatedHandler>.Instance);

        await handler.Handle(notification, CancellationToken.None);

        // Strict mocks: any unexpected call fails the test.
        invoiceRepo.VerifyNoOtherCalls();
        stockItemRepo.VerifyNoOtherCalls();
        warehouseRepo.VerifyNoOtherCalls();
        productRepo.VerifyNoOtherCalls();
        movementRepo.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Handle_WhenIdempotentReferenceExists_SkipsRestoration()
    {
        var notification = new InvoiceValidatedEvent(Guid.NewGuid(), "AVO-2026-000003", isCreditNote: true);
        var expectedReference = $"Avoir {notification.InvoiceNumber}";

        var movementRepo = new Mock<IStockMovementRepository>();
        movementRepo
            .Setup(x => x.GetByReferenceAsync(expectedReference, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { CreateDummyMovement() });

        var invoiceRepo = new Mock<IInvoiceRepository>(MockBehavior.Strict);
        var stockItemRepo = new Mock<IStockItemRepository>(MockBehavior.Strict);
        var warehouseRepo = new Mock<IWarehouseRepository>(MockBehavior.Strict);
        var productRepo = new Mock<IProductRepository>(MockBehavior.Strict);

        var handler = new RestoreStockOnCreditNoteValidatedHandler(
            invoiceRepo.Object,
            stockItemRepo.Object,
            warehouseRepo.Object,
            productRepo.Object,
            movementRepo.Object,
            StockTestDoubles.Passthrough(stockItemRepo.Object),
            StockTestDoubles.NoValuation(),
            StockTestDoubles.Untracked(),
            NullLogger<RestoreStockOnCreditNoteValidatedHandler>.Instance);

        await handler.Handle(notification, CancellationToken.None);

        // No further repository calls beyond the idempotency check.
        invoiceRepo.VerifyNoOtherCalls();
        stockItemRepo.VerifyNoOtherCalls();
        warehouseRepo.VerifyNoOtherCalls();
        productRepo.VerifyNoOtherCalls();
    }

    private static StockMovement CreateDummyMovement()
    {
        // Build a real StockMovement via the StockItem aggregate so the constructor invariants pass.
        var stockItem = StockItem.Create(Guid.NewGuid(), Guid.NewGuid()).Value;
        var entry = stockItem.RecordEntry(
            quantity: 1m,
            unitCost: 10m,
            reason: MovementReason.CustomerReturn,
            reference: "Avoir AVO-2026-000003",
            notes: "test fixture");
        Assert.True(entry.IsSuccess, entry.Error?.Description);
        return stockItem.Movements.Last();
    }
}
