using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Stock.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using MediatR;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Application.Features.Stock.EventHandlers;

/// <summary>
/// Handles InvoiceValidatedEvent for credit notes (AVO) only — restores stock for each line
/// (the dual of <see cref="DeductStockOnInvoiceValidatedHandler"/> which short-circuits on AVO).
/// Uses the line quantity as a positive entry; sign is carried by the invoice header,
/// not the line, so a 5-unit AVO line restores 5 units to stock.
/// </summary>
public sealed class RestoreStockOnCreditNoteValidatedHandler : INotificationHandler<InvoiceValidatedEvent>
{
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductRepository _productRepository;
    private readonly IStockMovementRepository _stockMovementRepository;
    private readonly IStockMutationService _mutation;
    private readonly IStockValuationReader _valuationReader;
    private readonly ITrackedDocumentStockService _trackedStock;
    private readonly ILogger<RestoreStockOnCreditNoteValidatedHandler> _logger;

    public RestoreStockOnCreditNoteValidatedHandler(
        IInvoiceRepository invoiceRepository,
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        IProductRepository productRepository,
        IStockMovementRepository stockMovementRepository,
        IStockMutationService mutation,
        IStockValuationReader valuationReader,
        ITrackedDocumentStockService trackedStock,
        ILogger<RestoreStockOnCreditNoteValidatedHandler> logger)
    {
        _invoiceRepository = invoiceRepository;
        _stockItemRepository = stockItemRepository;
        _warehouseRepository = warehouseRepository;
        _productRepository = productRepository;
        _stockMovementRepository = stockMovementRepository;
        _mutation = mutation;
        _valuationReader = valuationReader;
        _trackedStock = trackedStock;
        _logger = logger;
    }

    public async Task Handle(InvoiceValidatedEvent notification, CancellationToken cancellationToken)
    {
        if (!notification.IsCreditNote)
            return;

        _logger.LogInformation("Processing stock restoration for credit note {InvoiceId} ({InvoiceNumber})",
            notification.InvoiceId, notification.InvoiceNumber);

        var reference = $"Avoir {notification.InvoiceNumber}";

        var existingMovements = await _stockMovementRepository.GetByReferenceAsync(reference, cancellationToken);
        if (existingMovements.Count > 0)
        {
            _logger.LogInformation(
                "Stock restoration for credit note {InvoiceNumber} already processed ({Count} movements found) — skipping",
                notification.InvoiceNumber, existingMovements.Count);
            return;
        }

        var invoice = await _invoiceRepository.GetByIdWithLinesAsync(notification.InvoiceId, cancellationToken);
        if (invoice == null)
        {
            _logger.LogWarning("Credit note {InvoiceId} not found for stock restoration", notification.InvoiceId);
            return;
        }

        Warehouse? targetWarehouse = null;
        if (invoice.WarehouseId.HasValue)
            targetWarehouse = await _warehouseRepository.GetByIdAsync(invoice.WarehouseId.Value, cancellationToken);

        targetWarehouse ??= await _warehouseRepository.GetDefaultAsync(cancellationToken);

        if (targetWarehouse == null)
        {
            _logger.LogWarning("No warehouse configured - skipping stock restoration for credit note {InvoiceId}",
                notification.InvoiceId);
            return;
        }

        foreach (var line in invoice.Lines)
        {
            if (!line.ProductId.HasValue)
            {
                _logger.LogDebug("Skipping stock restoration for custom line {LineNumber} (no product reference)",
                    line.LineNumber);
                continue;
            }

            var product = await _productRepository.GetByIdAsync(line.ProductId.Value, cancellationToken);
            if (product == null || !product.IsStockManaged)
            {
                _logger.LogDebug("Skipping stock restoration for product {ProductId} (not stock-managed)",
                    line.ProductId);
                continue;
            }

            if (_trackedStock.IsLiveTracked(product))
            {
                _logger.LogInformation(
                    "Skipping event-handler restoration for tracked product {ProductId} on credit note {InvoiceNumber}",
                    line.ProductId, notification.InvoiceNumber);
                continue;
            }

            // Ce chemin ne traite que du CMUP (les articles tracés sortent plus haut), mais il
            // lisait le cache sans passer par la règle commune : aligné pour qu'il ne puisse pas
            // devenir une source de dérive si la garde change.
            var stockItem = await _stockItemRepository.GetByProductAndWarehouseAsync(
                line.ProductId.Value, targetWarehouse.Id, cancellationToken);
            var reading = await _valuationReader.GetByProductAndWarehouseAsync(
                line.ProductId.Value, targetWarehouse.Id, cancellationToken);
            var unitCost = StockEntryCostResolver
                .Resolve(reading, product, cachedAverageCost: stockItem?.AverageCost)
                .UnitCost;

            var entryResult = await _mutation.ApplyAsync(new StockMutationRequest
            {
                ProductId = line.ProductId.Value,
                WarehouseId = targetWarehouse.Id,
                Kind = StockMutationKind.Entry,
                Quantity = line.Quantity,
                UnitCost = unitCost,
                Reason = MovementReason.CustomerReturn,
                Reference = reference,
                Notes = "Réintégration suite à avoir client"
            }, cancellationToken);

            if (entryResult.IsFailure)
            {
                _logger.LogWarning(
                    "Stock restoration failed for product {ProductId}, credit note {InvoiceNumber}: {Error}. Quantity: {Quantity}",
                    line.ProductId,
                    notification.InvoiceNumber,
                    entryResult.Error.Description,
                    line.Quantity);
                continue;
            }

            _logger.LogInformation(
                "Stock restored for product {ProductId}: +{Quantity} units. New balance: {NewBalance}",
                line.ProductId, line.Quantity, entryResult.Value.QuantityOnHand);
        }

        _logger.LogInformation("Completed stock restoration processing for credit note {InvoiceNumber}",
            notification.InvoiceNumber);
    }
}
