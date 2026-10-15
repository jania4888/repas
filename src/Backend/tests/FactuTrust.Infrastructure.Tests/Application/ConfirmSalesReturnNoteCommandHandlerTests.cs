using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.SalesReturnNotes.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Logging.Abstractions;
using FactuTrust.Infrastructure.Tests.Stock;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class ConfirmSalesReturnNoteCommandHandlerTests
{
    [Fact]
    public async Task Confirm_RestoresStockAtAverageCost_AndIncrementsReturnedQuantity()
    {
        var warehouse = Warehouse.Create("WH1", "Monastir").Value;
        var product = StockProduct();
        var (bl, blLine) = DeliveredNote(10m, product, warehouse.Id);
        var note = DraftReturn(bl, blLine, 3m);

        var stockItem = StockItem.Create(product.Id, warehouse.Id).Value;
        Assert.True(stockItem.RecordEntry(20m, 12m, MovementReason.Purchase, "INIT").IsSuccess);
        var costBefore = stockItem.AverageCost;

        var handler = CreateHandler(
            note, bl, warehouse, product, stockItem,
            out var stockRepo, out var movementRepo);

        var result = await handler.Handle(new ConfirmSalesReturnNoteCommand(note.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(SalesReturnNoteStatus.Confirmed, note.Status);
        Assert.Equal(3m, blLine.ReturnedQuantity);
        Assert.Equal(7m, blLine.InvoiceableQuantity);
        Assert.Equal(23m, stockItem.QuantityOnHand);
        Assert.Equal(costBefore, stockItem.AverageCost);

        var movement = Assert.Single(stockItem.Movements.Where(m => m.Reason == MovementReason.CustomerReturn));
        Assert.Equal($"BRT {note.Number.Value}", movement.Reference);
        Assert.Contains("bon de retour", movement.Notes, StringComparison.OrdinalIgnoreCase);

        stockRepo.Verify(r => r.UpdateAsync(stockItem, It.IsAny<CancellationToken>()), Times.Once);
        movementRepo.Verify(r => r.GetByReferenceAsync($"BRT {note.Number.Value}", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Confirm_SecondCall_FailsOnceAlreadyConfirmed()
    {
        var warehouse = Warehouse.Create("WH1", "Monastir").Value;
        var product = StockProduct();
        var (bl, blLine) = DeliveredNote(10m, product, warehouse.Id);
        var note = DraftReturn(bl, blLine, 3m);
        var stockItem = StockItem.Create(product.Id, warehouse.Id).Value;
        Assert.True(stockItem.RecordEntry(10m, 8m, MovementReason.Purchase, "INIT").IsSuccess);

        var handler = CreateHandler(note, bl, warehouse, product, stockItem, out _, out _);

        Assert.True((await handler.Handle(new ConfirmSalesReturnNoteCommand(note.Id), CancellationToken.None)).IsSuccess);
        var second = await handler.Handle(new ConfirmSalesReturnNoteCommand(note.Id), CancellationToken.None);
        Assert.True(second.IsFailure);
    }

    [Fact]
    public async Task Confirm_NonStockProduct_SkipsMovement_ButRecordsReturn()
    {
        var warehouse = Warehouse.Create("WH1", "Monastir").Value;
        var product = Product.Create(
            "SVC-1", "Prestation", ProductType.Service, Money.Create(20m), VatRate.Standard,
            Guid.NewGuid()).Value;
        var (bl, blLine) = DeliveredNote(5m, product, warehouse.Id);
        var note = DraftReturn(bl, blLine, 2m);

        var stockRepo = new Mock<IStockItemRepository>();
        var handler = CreateHandler(note, bl, warehouse, product, stockItem: null, out stockRepo, out _, setupStock: false);

        var result = await handler.Handle(new ConfirmSalesReturnNoteCommand(note.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(2m, blLine.ReturnedQuantity);
        stockRepo.Verify(r => r.GetByProductAndWarehouseAsync(
            It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Confirm_WhenBlInvoiced_ReturnsConflict()
    {
        var warehouse = Warehouse.Create("WH1", "Monastir").Value;
        var product = StockProduct();
        var (bl, blLine) = DeliveredNote(5m, product, warehouse.Id);
        var note = DraftReturn(bl, blLine, 1m);
        var invoice = Invoice.CreateFromDeliveryNote(
            InvoiceNumber.Create("FAC", 2026, 9),
            bl.Client,
            new DateTime(2026, 8, 16),
            bl.Id).Value;
        Assert.True(bl.MarkAsInvoiced(invoice).IsSuccess);

        var handler = CreateHandler(note, bl, warehouse, product, stockItem: null, out _, out _, setupStock: false);
        var result = await handler.Handle(new ConfirmSalesReturnNoteCommand(note.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
    }

    [Fact]
    public async Task Confirm_ImputesSalesOrderWithoutReopeningPendingDelivery()
    {
        var warehouse = Warehouse.Create("WH1", "Monastir").Value;
        var product = StockProduct();
        var order = SalesOrder.Create(
            SalesOrderNumber.Create("CDE", 2026, 1),
            NewClient(),
            new DateTime(2026, 8, 1)).Value;
        Assert.True(order.AddLine(product, 10m, Money.Create(20m)).IsSuccess);
        Assert.True(order.Confirm().IsSuccess);
        var orderLine = Assert.Single(order.Lines);
        Assert.True(order.RecordDeliveries(new[] { (orderLine.Id, 10m) }).IsSuccess);

        var (bl, blLine) = DeliveredNote(10m, product, warehouse.Id, order.Client);
        bl.AttachSalesOrderOrigin(order.Id);
        var note = DraftReturn(bl, blLine, 3m);
        var stockItem = StockItem.Create(product.Id, warehouse.Id).Value;
        Assert.True(stockItem.RecordEntry(10m, 8m, MovementReason.Purchase, "INIT").IsSuccess);

        var soRepo = new Mock<ISalesOrderRepository>();
        soRepo.Setup(r => r.GetByIdWithLinesAsync(order.Id, It.IsAny<CancellationToken>())).ReturnsAsync(order);

        var handler = CreateHandler(note, bl, warehouse, product, stockItem, out _, out _, salesOrderRepo: soRepo);

        var result = await handler.Handle(new ConfirmSalesReturnNoteCommand(note.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(0m, orderLine.PendingDeliveryQuantity);
        Assert.Equal(7m, orderLine.DeliveredNotInvoicedQuantity);
        Assert.Equal(3m, orderLine.ReturnedQuantity);
        soRepo.Verify(r => r.UpdateAsync(order, It.IsAny<CancellationToken>()), Times.Once);
    }

    private static ConfirmSalesReturnNoteCommandHandler CreateHandler(
        SalesReturnNote note,
        DeliveryNote bl,
        Warehouse warehouse,
        Product product,
        StockItem? stockItem,
        out Mock<IStockItemRepository> stockRepo,
        out Mock<IStockMovementRepository> movementRepo,
        bool setupStock = true,
        Mock<ISalesOrderRepository>? salesOrderRepo = null)
    {
        var returnRepo = new Mock<ISalesReturnNoteRepository>();
        returnRepo.Setup(r => r.GetByIdWithDetailsAsync(note.Id, It.IsAny<CancellationToken>())).ReturnsAsync(note);

        var blRepo = new Mock<IDeliveryNoteRepository>();
        blRepo.Setup(r => r.GetByIdWithDetailsAsync(bl.Id, It.IsAny<CancellationToken>())).ReturnsAsync(bl);
        blRepo
            .Setup(r => r.ApplyReturnsAsync(
                bl.Id,
                It.IsAny<IReadOnlyList<(Guid LineId, decimal Quantity)>>(),
                It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        returnRepo
            .Setup(r => r.ConfirmPersistedAsync(note.Id, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        var whRepo = new Mock<IWarehouseRepository>();
        whRepo.Setup(r => r.GetByIdAsync(warehouse.Id, It.IsAny<CancellationToken>())).ReturnsAsync(warehouse);
        whRepo.Setup(r => r.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync(warehouse);

        stockRepo = new Mock<IStockItemRepository>();
        movementRepo = new Mock<IStockMovementRepository>();
        movementRepo
            .Setup(r => r.GetByReferenceAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StockMovement>());

        if (setupStock && stockItem != null)
        {
            stockRepo
                .Setup(r => r.GetByProductAndWarehouseAsync(product.Id, warehouse.Id, It.IsAny<CancellationToken>()))
                .ReturnsAsync(stockItem);
        }

        var productRepo = new Mock<IProductRepository>();
        productRepo.Setup(r => r.GetByIdAsync(product.Id, It.IsAny<CancellationToken>())).ReturnsAsync(product);

        return new ConfirmSalesReturnNoteCommandHandler(
            returnRepo.Object,
            blRepo.Object,
            salesOrderRepo?.Object ?? new Mock<ISalesOrderRepository>().Object,
            stockRepo.Object,
            movementRepo.Object,
            whRepo.Object,
            productRepo.Object,
            StockTestDoubles.Passthrough(stockRepo.Object),
            StockTestDoubles.NoValuation(),
            new Mock<ICurrentUser>().Object,
            new Mock<IAuditService>().Object,
            NullLogger<ConfirmSalesReturnNoteCommandHandler>.Instance);
    }

    private static SalesReturnNote DraftReturn(DeliveryNote bl, DeliveryNoteLine line, decimal qty)
    {
        var note = SalesReturnNote.Create(
            SalesReturnNoteNumber.Generate(2026, 1).Value,
            bl,
            new DateTime(2026, 8, 16),
            "Marchandise endommagée").Value;
        Assert.True(note.AddLine(line, qty).IsSuccess);
        return note;
    }

    private static (DeliveryNote Note, DeliveryNoteLine Line) DeliveredNote(
        decimal quantity,
        Product product,
        Guid warehouseId,
        Client? client = null)
    {
        var note = DeliveryNote.Create(
            DeliveryNoteNumber.Generate(2026, 40).Value,
            client ?? NewClient(),
            new DateTime(2026, 8, 1),
            "12 avenue Habib Bourguiba",
            warehouseId: warehouseId).Value;
        Assert.True(note.AddLine(product, quantity).IsSuccess);
        Assert.True(note.Confirm().IsSuccess);
        var line = Assert.Single(note.Lines);
        Assert.True(line.RecordDelivery(quantity).IsSuccess);
        Assert.True(note.RecordDelivery(new DateTime(2026, 8, 2), "Réceptionnaire").IsSuccess);
        return (note, line);
    }

    private static Client NewClient()
    {
        var address = Address.Create("1 rue de la République", "Tunis", "Tunis").Value;
        var email = Email.Create("client-ret@example.com").Value;
        return Client.Create("Client retour", ClientType.Individual, address, email).Value;
    }

    private static Product StockProduct() =>
        Product.Create(
            "P-STK", "Produit stocké", ProductType.Product, Money.Create(20m), VatRate.Standard,
            Guid.NewGuid(), isStockManaged: true).Value;
}
