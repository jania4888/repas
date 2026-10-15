using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using MediatR;
using Microsoft.Extensions.Logging;

using FactuTrust.Application.Features.Stock.Services;

namespace FactuTrust.Application.Features.Stock.EventHandlers;

/// <summary>
/// Handles InvoiceCancelledEvent to restore stock when an invoice is cancelled or a credit note is created.
/// This ensures stock automatically returns when sales are reversed.
/// </summary>
public sealed class RestoreStockOnInvoiceCancelledHandler : INotificationHandler<InvoiceCancelledEvent>
{
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductRepository _productRepository;
    private readonly IStockMovementRepository _stockMovementRepository;
    private readonly IStockMutationService _mutation;
    private readonly IStockValuationReader _valuationReader;
    private readonly ILogger<RestoreStockOnInvoiceCancelledHandler> _logger;

    public RestoreStockOnInvoiceCancelledHandler(
        IInvoiceRepository invoiceRepository,
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        IProductRepository productRepository,
        IStockMovementRepository stockMovementRepository,
        IStockMutationService mutation,
        IStockValuationReader valuationReader,
        ILogger<RestoreStockOnInvoiceCancelledHandler> logger)
    {
        _invoiceRepository = invoiceRepository;
        _stockItemRepository = stockItemRepository;
        _warehouseRepository = warehouseRepository;
        _productRepository = productRepository;
        _stockMovementRepository = stockMovementRepository;
        _mutation = mutation;
        _valuationReader = valuationReader;
        _logger = logger;
    }

    public async Task Handle(InvoiceCancelledEvent notification, CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Processing stock restoration for cancelled invoice {InvoiceId} ({InvoiceNumber}). Reason: {Reason}",
            notification.InvoiceId, notification.InvoiceNumber, notification.Reason);

        var reference = $"Annulation facture {notification.InvoiceNumber}";

        // Idempotency: skip if restoration movements for this reference already exist
        var existingMovements = await _stockMovementRepository.GetByReferenceAsync(reference, cancellationToken);
        if (existingMovements.Count > 0)
        {
            _logger.LogInformation(
                "Stock restoration for cancelled invoice {InvoiceNumber} already processed ({Count} movements found) — skipping",
                notification.InvoiceNumber, existingMovements.Count);
            return;
        }

        // Get the invoice with lines
        var invoice = await _invoiceRepository.GetByIdWithLinesAsync(notification.InvoiceId, cancellationToken);
        if (invoice == null)
        {
            _logger.LogWarning("Invoice {InvoiceId} not found for stock restoration", notification.InvoiceId);
            return;
        }

        // Resolve warehouse: invoice-specific or default fallback
        Warehouse? targetWarehouse = null;
        if (invoice.WarehouseId.HasValue)
            targetWarehouse = await _warehouseRepository.GetByIdAsync(invoice.WarehouseId.Value, cancellationToken);

        targetWarehouse ??= await _warehouseRepository.GetDefaultAsync(cancellationToken);

        if (targetWarehouse == null)
        {
            _logger.LogWarning(
                "No warehouse configured - skipping stock restoration for invoice {InvoiceId}",
                notification.InvoiceId);
            return;
        }

        var deductionReference = $"Facture {notification.InvoiceNumber}";
        var exitMovements = await _stockMovementRepository.GetByReferenceAsync(deductionReference, cancellationToken);
        var exitQuantitiesByStockItem = exitMovements
            .Where(m => m.Type == MovementType.Exit && m.Quantity < 0)
            .GroupBy(m => m.StockItemId)
            .ToDictionary(g => g.Key, g => g.Sum(m => -m.Quantity));

        if (exitQuantitiesByStockItem.Count > 0)
        {
            foreach (var movement in exitMovements.Where(m => m.Type == MovementType.Exit && m.Quantity < 0))
            {
                var stockItem = await _stockItemRepository.GetByIdAsync(movement.StockItemId, cancellationToken);
                if (stockItem == null)
                {
                    _logger.LogWarning(
                        "Stock item {StockItemId} not found for restoration (invoice {InvoiceNumber})",
                        movement.StockItemId, notification.InvoiceNumber);
                    continue;
                }

                var quantityToRestore = -movement.Quantity;
                var notes = $"Réintégration suite à annulation - Motif: {notification.Reason}";
                var allocations = new[]
                {
                    new StockAllocationInput(
                        quantityToRestore,
                        movement.ProductLotId,
                        SerialId: movement.SerialId,
                        UnitCost: movement.UnitCost,
                        RestoreValuationLayerId: movement.ValuationLayerId)
                };

                var entryResult = await _mutation.ApplyAsync(new StockMutationRequest
                {
                    ProductId = stockItem.ProductId,
                    WarehouseId = stockItem.WarehouseId,
                    Kind = StockMutationKind.Entry,
                    Quantity = quantityToRestore,
                    UnitCost = movement.UnitCost,
                    Reason = MovementReason.CustomerReturn,
                    Reference = reference,
                    Notes = notes,
                    Allocations = allocations
                }, cancellationToken);

                if (entryResult.IsFailure)
                {
                    _logger.LogWarning(
                        "Stock restoration failed for stock item {StockItemId}, product {ProductId}, invoice {InvoiceNumber}: {Error}",
                        movement.StockItemId, stockItem.ProductId, notification.InvoiceNumber, entryResult.Error.Description);
                    continue;
                }

                _logger.LogInformation(
                    "Stock restored for product {ProductId}: {Quantity} units added (from movements). New balance: {NewBalance}",
                    stockItem.ProductId, quantityToRestore, entryResult.Value.QuantityOnHand);
            }
        }
        else
        {
            foreach (var line in invoice.Lines)
            {
                if (!line.ProductId.HasValue)
                {
                    _logger.LogDebug(
                        "Skipping stock restoration for custom line {LineNumber} (no product reference)",
                        line.LineNumber);
                    continue;
                }

                var product = await _productRepository.GetByIdAsync(line.ProductId.Value, cancellationToken);
                if (product == null || !product.IsStockManaged)
                {
                    _logger.LogDebug(
                        "Skipping stock restoration for product {ProductId} (not stock-managed)",
                        line.ProductId);
                    continue;
                }

                // Repli : ce chemin n'est pris que si la restauration par couches n'a pas pu
                // s'appliquer plus haut. Le coût suit la méthode de l'article, plus le cache.
                var stockItem = await _stockItemRepository.GetByProductAndWarehouseAsync(
                    line.ProductId.Value, targetWarehouse.Id, cancellationToken);
                var reading = await _valuationReader.GetByProductAndWarehouseAsync(
                    line.ProductId.Value, targetWarehouse.Id, cancellationToken);
                var unitCost = StockEntryCostResolver
                    .Resolve(reading, product, cachedAverageCost: stockItem?.AverageCost)
                    .UnitCost;

                var notes = $"Réintégration suite à annulation - Motif: {notification.Reason}";
                var entryResult = await _mutation.ApplyAsync(new StockMutationRequest
                {
                    ProductId = line.ProductId.Value,
                    WarehouseId = targetWarehouse.Id,
                    Kind = StockMutationKind.Entry,
                    Quantity = line.Quantity,
                    UnitCost = unitCost,
                    Reason = MovementReason.CustomerReturn,
                    Reference = reference,
                    Notes = notes
                }, cancellationToken);

                if (entryResult.IsFailure)
                {
                    _logger.LogWarning(
                        "Stock restoration failed for product {ProductId}, invoice {InvoiceNumber}: {Error}",
                        line.ProductId,
                        notification.InvoiceNumber,
                        entryResult.Error.Description);
                    continue;
                }

                _logger.LogInformation(
                    "Stock restored for product {ProductId}: {Quantity} units added. New balance: {NewBalance}",
                    line.ProductId, line.Quantity, entryResult.Value.QuantityOnHand);
            }
        }

        _logger.LogInformation(
            "Completed stock restoration processing for cancelled invoice {InvoiceNumber}", 
            notification.InvoiceNumber);
    }
}
