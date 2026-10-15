using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.Extensions.Logging;

using FactuTrust.Application.Features.Stock.Services;

namespace FactuTrust.Application.Features.SalesReturnNotes.Commands;

public sealed record ConfirmSalesReturnNoteCommand(Guid Id) : IRequest<Result>;

public sealed class ConfirmSalesReturnNoteCommandHandler : IRequestHandler<ConfirmSalesReturnNoteCommand, Result>
{
    private readonly ISalesReturnNoteRepository _returnNoteRepository;
    private readonly IDeliveryNoteRepository _deliveryNoteRepository;
    private readonly ISalesOrderRepository _salesOrderRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IStockMovementRepository _stockMovementRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductRepository _productRepository;
    private readonly IStockMutationService _mutation;
    private readonly IStockValuationReader _valuationReader;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly ILogger<ConfirmSalesReturnNoteCommandHandler> _logger;

    public ConfirmSalesReturnNoteCommandHandler(
        ISalesReturnNoteRepository returnNoteRepository,
        IDeliveryNoteRepository deliveryNoteRepository,
        ISalesOrderRepository salesOrderRepository,
        IStockItemRepository stockItemRepository,
        IStockMovementRepository stockMovementRepository,
        IWarehouseRepository warehouseRepository,
        IProductRepository productRepository,
        IStockMutationService mutation,
        IStockValuationReader valuationReader,
        ICurrentUser currentUser,
        IAuditService auditService,
        ILogger<ConfirmSalesReturnNoteCommandHandler> logger)
    {
        _returnNoteRepository = returnNoteRepository;
        _deliveryNoteRepository = deliveryNoteRepository;
        _salesOrderRepository = salesOrderRepository;
        _stockItemRepository = stockItemRepository;
        _stockMovementRepository = stockMovementRepository;
        _warehouseRepository = warehouseRepository;
        _productRepository = productRepository;
        _mutation = mutation;
        _valuationReader = valuationReader;
        _currentUser = currentUser;
        _auditService = auditService;
        _logger = logger;
    }

    public async Task<Result> Handle(ConfirmSalesReturnNoteCommand request, CancellationToken cancellationToken)
    {
        var note = await _returnNoteRepository.GetByIdWithDetailsAsync(request.Id, cancellationToken);
        if (note is null)
            return Result.Failure(Error.NotFound("SalesReturnNote", request.Id));

        var deliveryNote = await _deliveryNoteRepository.GetByIdWithDetailsAsync(note.DeliveryNoteId, cancellationToken);
        if (deliveryNote is null)
            return Result.Failure(Error.NotFound("DeliveryNote", note.DeliveryNoteId));

        if (deliveryNote.InvoiceId.HasValue)
            return Result.Failure(Error.Conflict(
                "Le bon de livraison a été facturé entre-temps. Rechargez la page."));

        var confirmResult = note.Confirm();
        if (confirmResult.IsFailure)
            return confirmResult;

        foreach (var line in note.Lines.OrderBy(l => l.LineNumber))
        {
            var recordResult = deliveryNote.RecordReturn(line.DeliveryNoteLineId, line.ReturnedQuantity);
            if (recordResult.IsFailure)
                return recordResult;
        }

        var stockResult = await RestoreStockAsync(note, deliveryNote, cancellationToken);
        if (stockResult.IsFailure)
            return stockResult;

        if (deliveryNote.SourceSalesOrderId is { } salesOrderId)
        {
            var orderResult = await ImputeSalesOrderReturnsAsync(salesOrderId, note, cancellationToken);
            if (orderResult.IsFailure)
                return orderResult;
        }

        var userId = _currentUser.UserId?.ToString() ?? "system";
        note.SetAuditInfo(userId, isUpdate: true);
        note.ClearParentNavigationsForPersistence();

        var applyResult = await _deliveryNoteRepository.ApplyReturnsAsync(
            deliveryNote.Id,
            note.Lines
                .OrderBy(l => l.LineNumber)
                .Select(l => (l.DeliveryNoteLineId, l.ReturnedQuantity))
                .ToList(),
            userId,
            cancellationToken);
        if (applyResult.IsFailure)
            return applyResult;

        var persistConfirm = await _returnNoteRepository.ConfirmPersistedAsync(
            note.Id, userId, cancellationToken);
        if (persistConfirm.IsFailure)
            return persistConfirm;

        await _auditService.LogAsync(
            AuditActions.SalesReturnNote.Confirmed,
            "SalesReturnNote",
            note.Id,
            newValues: new { note.Number.Value, DeliveryNote = deliveryNote.Number.Value },
            cancellationToken: cancellationToken);

        return Result.Success();
    }

    private async Task<Result> RestoreStockAsync(
        Domain.Entities.SalesReturnNote note,
        DeliveryNote deliveryNote,
        CancellationToken cancellationToken)
    {
        var reference = $"BRT {note.Number.Value}";
        var existing = await _stockMovementRepository.GetByReferenceAsync(reference, cancellationToken);
        if (existing.Count > 0)
        {
            _logger.LogInformation(
                "Stock restoration for return note {Number} already processed ({Count} movements) — skipping",
                note.Number.Value, existing.Count);
            return Result.Success();
        }

        Warehouse? warehouse = null;
        var warehouseId = note.WarehouseId ?? deliveryNote.WarehouseId;
        if (warehouseId.HasValue)
            warehouse = await _warehouseRepository.GetByIdAsync(warehouseId.Value, cancellationToken);
        warehouse ??= await _warehouseRepository.GetDefaultAsync(cancellationToken);

        foreach (var line in note.Lines)
        {
            var product = line.Product ?? await _productRepository.GetByIdAsync(line.ProductId, cancellationToken);
            if (product is null || !product.IsStockManaged)
                continue;

            if (warehouse is null)
                return Result.Failure(Error.Validation("Warehouse",
                    "Aucun dépôt n'est configuré pour réintégrer le stock."));

            var stockItem = await _stockItemRepository.GetByProductAndWarehouseAsync(
                line.ProductId, warehouse.Id, cancellationToken);

            IReadOnlyList<StockAllocationInput>? allocations = null;
            if (note.DeliveryNoteId is { } deliveryNoteId)
            {
                var delivery = await _deliveryNoteRepository.GetByIdWithLinesAsync(deliveryNoteId, cancellationToken);
                if (delivery is not null && stockItem is not null)
                {
                    var original = await _stockMovementRepository.GetByReferenceAsync(
                        $"BL {delivery.Number.Value}", cancellationToken);
                    var remaining = line.ReturnedQuantity;
                    var restore = new List<StockAllocationInput>();
                    foreach (var movement in original.Where(m =>
                                 m.Type == MovementType.Exit && m.StockItemId == stockItem.Id))
                    {
                        if (remaining <= 0)
                            break;
                        var take = Math.Min(remaining, Math.Abs(movement.Quantity));
                        restore.Add(new StockAllocationInput(
                            take,
                            movement.ProductLotId,
                            SerialId: movement.SerialId,
                            UnitCost: movement.UnitCost,
                            RestoreValuationLayerId: movement.ValuationLayerId));
                        remaining -= take;
                    }

                    if (restore.Count > 0)
                        allocations = restore;
                }
            }

            var entryResult = await _mutation.ApplyAsync(new StockMutationRequest
            {
                ProductId = line.ProductId,
                WarehouseId = warehouse.Id,
                Kind = StockMutationKind.Entry,
                Quantity = line.ReturnedQuantity,
                // Coût issu des couches pour un article FIFO/LIFO, du CMUP sinon. Les lignes dont
                // les couches d'origine sont restaurées portent déjà leur propre coût : ce champ
                // n'est alors qu'un repli.
                UnitCost = StockEntryCostResolver.Resolve(
                    await _valuationReader.GetByProductAndWarehouseAsync(
                        line.ProductId, warehouse.Id, cancellationToken),
                    product,
                    cachedAverageCost: stockItem?.AverageCost).UnitCost,
                Reason = MovementReason.CustomerReturn,
                Reference = reference,
                Notes = "Réintégration suite à bon de retour",
                DocumentLineId = line.Id,
                DocumentKind = StockDocumentKind.SalesReturnNote,
                Allocations = allocations
            }, cancellationToken);

            if (entryResult.IsFailure)
                return Result.Failure(entryResult.Error);
        }

        return Result.Success();
    }

    private async Task<Result> ImputeSalesOrderReturnsAsync(
        Guid salesOrderId,
        Domain.Entities.SalesReturnNote note,
        CancellationToken cancellationToken)
    {
        var order = await _salesOrderRepository.GetByIdWithLinesAsync(salesOrderId, cancellationToken);
        if (order is null)
            return Result.Failure(Error.NotFound("SalesOrder", salesOrderId));

        var returnedByProduct = note.Lines
            .GroupBy(l => l.ProductId)
            .ToDictionary(g => g.Key, g => g.Sum(l => l.ReturnedQuantity));

        var imputations = new List<(Guid LineId, decimal Quantity)>();
        foreach (var (productId, returned) in returnedByProduct)
        {
            var remaining = returned;
            foreach (var line in order.Lines
                         .Where(l => l.ProductId == productId && l.DeliveredNotInvoicedQuantity > 0)
                         .OrderBy(l => l.LineNumber))
            {
                var take = Math.Min(remaining, line.DeliveredNotInvoicedQuantity);
                if (take <= 0)
                    continue;

                imputations.Add((line.Id, take));
                remaining -= take;
                if (remaining <= 0)
                    break;
            }
        }

        if (imputations.Count == 0)
            return Result.Success();

        var recordResult = order.RecordReturns(imputations);
        if (recordResult.IsFailure)
            return recordResult;

        await _salesOrderRepository.UpdateAsync(order, cancellationToken);
        return Result.Success();
    }
}
