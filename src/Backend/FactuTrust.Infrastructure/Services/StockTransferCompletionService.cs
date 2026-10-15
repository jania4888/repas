using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Stock.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Executes stock exit/entry and transfer completion in one transaction and one SaveChanges.
/// </summary>
public sealed class StockTransferCompletionService : IStockTransferCompletionService
{
    private const int MaxConcurrencyAttempts = 3;

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IStockMutationService _mutation;
    private readonly ILogger<StockTransferCompletionService> _logger;
    private readonly StockTraceabilityOptions _options;

    /// <param name="options">
    /// Facultatif : les options ne servent qu'au repli de valorisation. Paramètre optionnel pour
    /// ne pas casser les sites de construction existants, qui n'en dépendent pas.
    /// </param>
    public StockTransferCompletionService(
        ITenantDbContextFactory contextFactory,
        IStockMutationService mutation,
        ILogger<StockTransferCompletionService> logger,
        IOptions<StockTraceabilityOptions>? options = null)
    {
        _contextFactory = contextFactory;
        _mutation = mutation;
        _logger = logger;
        _options = options?.Value ?? new StockTraceabilityOptions();
    }

    public async Task<Result> CompleteTransferAsync(Guid stockTransferId, CancellationToken cancellationToken = default)
    {
        for (var attempt = 1; attempt <= MaxConcurrencyAttempts; attempt++)
        {
            try
            {
                await using var context = _contextFactory.CreateIsolatedContext();
                var strategy = context.Database.CreateExecutionStrategy();

                // ExecutionStrategy may retry the delegate after transient failures; the inner work must be idempotent.
                return await strategy.ExecuteAsync(() =>
                    ExecuteCompleteSingleTransactionAsync(context, stockTransferId, cancellationToken));
            }
            catch (DbUpdateConcurrencyException ex)
            {
                LogConcurrencyConflictEntries(ex, stockTransferId, attempt);
                _logger.LogWarning(ex,
                    "Concurrency conflict completing stock transfer {StockTransferId}, attempt {Attempt}/{MaxAttempts}",
                    stockTransferId, attempt, MaxConcurrencyAttempts);

                if (attempt == MaxConcurrencyAttempts)
                {
                    return Result.Failure(Error.Conflict(
                        "Les données de stock ont été modifiées entre-temps. Actualisez la page et réessayez."));
                }
            }
        }

        return Result.Failure(Error.Conflict(
            "Les données de stock ont été modifiées entre-temps. Actualisez la page et réessayez."));
    }

    private void LogConcurrencyConflictEntries(
        DbUpdateConcurrencyException ex,
        Guid stockTransferId,
        int attempt)
    {
        foreach (var entry in ex.Entries)
        {
            _logger.LogWarning(
                "Stock transfer {StockTransferId} concurrency detail (attempt {Attempt}): {EntityType} State={State} Key={Key}",
                stockTransferId,
                attempt,
                entry.Entity.GetType().Name,
                entry.State,
                FormatPrimaryKey(entry));
        }
    }

    private static string FormatPrimaryKey(EntityEntry entry)
    {
        var key = entry.Metadata.FindPrimaryKey();
        if (key is null)
            return "?";

        return string.Join(", ", key.Properties.Select(p => $"{p.Name}={entry.Property(p.Name).CurrentValue}"));
    }

    /// <summary>
    /// EF Core can track new movements as Modified when they are added via the domain collection on a tracked StockItem;
    /// that produces UPDATE with 0 rows and DbUpdateConcurrencyException. Force INSERT for movements created after the snapshot.
    /// </summary>
    private static void EnsureNewStockMovementsAreAdded(
        TenantDbContext context,
        StockItem item,
        IReadOnlySet<Guid> movementIdsBefore)
    {
        foreach (var movement in item.Movements)
        {
            if (movementIdsBefore.Contains(movement.Id))
                continue;

            var entry = context.Entry(movement);
            if (entry.State != EntityState.Added)
                entry.State = EntityState.Added;
        }
    }

    private async Task<Result> ExecuteCompleteSingleTransactionAsync(
        TenantDbContext context,
        Guid stockTransferId,
        CancellationToken cancellationToken)
    {
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var transfer = await context.StockTransfers
                .Include(t => t.Lines)
                .FirstOrDefaultAsync(t => t.Id == stockTransferId, cancellationToken);

            if (transfer is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Result.Failure(Error.NotFound("StockTransfer", stockTransferId));
            }

            // Idempotent: execution strategy (or client retry) may run this delegate more than once after a successful commit.
            if (transfer.Status == StockTransferStatus.Completed)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Result.Success();
            }

            var reference = $"TR {transfer.Number.Value}";

            foreach (var line in transfer.Lines.OrderBy(l => l.LineNumber))
            {
                var sourceStockItem = await context.StockItems
                    .Include(s => s.Movements)
                    .FirstOrDefaultAsync(
                        s => s.ProductId == line.ProductId && s.WarehouseId == transfer.SourceWarehouseId,
                        cancellationToken);

                if (sourceStockItem is null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return Result.Failure(Error.Validation("Stock",
                        $"Aucun stock trouvé pour le produit '{line.ProductName}' dans l'entrepôt source"));
                }

                if (sourceStockItem.QuantityAvailable < line.RequestedQuantity)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return Result.Failure(Error.Validation("Stock",
                        $"Stock insuffisant pour '{line.ProductName}'. Disponible: {sourceStockItem.QuantityAvailable}, Demandé: {line.RequestedQuantity}"));
                }

                var product = await context.Products.FirstOrDefaultAsync(p => p.Id == line.ProductId, cancellationToken);
                var store = new EfStockTraceabilityStore(context);
                var sourceMovementIdsBefore = sourceStockItem.Movements.Select(m => m.Id).ToHashSet();

                var exitResult = _mutation.Apply(sourceStockItem, new StockMutationRequest
                {
                    ProductId = line.ProductId,
                    WarehouseId = transfer.SourceWarehouseId,
                    Kind = StockMutationKind.Exit,
                    Quantity = line.RequestedQuantity,
                    Reason = MovementReason.Transfer,
                    Reference = reference,
                    Notes = "Transfert sortie vers entrepôt destination",
                    DocumentLineId = line.Id,
                    DocumentKind = StockDocumentKind.Transfer
                }, product, store);

                if (exitResult.IsFailure)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return exitResult;
                }

                EnsureNewStockMovementsAreAdded(context, sourceStockItem, sourceMovementIdsBefore);

                var destStockItem = await context.StockItems
                    .Include(s => s.Movements)
                    .FirstOrDefaultAsync(
                        s => s.ProductId == line.ProductId && s.WarehouseId == transfer.DestinationWarehouseId,
                        cancellationToken);

                if (destStockItem is null)
                {
                    var createResult = StockItem.Create(line.ProductId, transfer.DestinationWarehouseId);
                    if (createResult.IsFailure)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return Result.Failure(createResult.Error);
                    }

                    destStockItem = createResult.Value;
                    context.StockItems.Add(destStockItem);
                }

                var destMovementIdsBefore = destStockItem.Movements.Select(m => m.Id).ToHashSet();
                var newExits = sourceStockItem.Movements
                    .Where(m => !sourceMovementIdsBefore.Contains(m.Id) && m.Type == MovementType.Exit)
                    .OrderBy(m => m.OccurredAt)
                    .ThenBy(m => m.Id)
                    .ToList();
                var destAllocations = StockValuationRestore.FromExitMovements(
                    newExits,
                    line.RequestedQuantity,
                    restoreSameWarehouse: false,
                    receivedAtByLayerId: id => store.GetLayer(id)?.ReceivedAt).ToList();
                // Chemin nominal inchangé : les couches recopiées portent déjà leur propre coût.
                // Seuls les REPLIS changent — ils lisaient le cache de l'article source, dérivé en
                // FIFO/LIFO. Attention : la sortie source a déjà été appliquée plus haut, donc ses
                // couches sont consommées ; le résolveur retombe alors sur le cache, comme avant.
                var fallbackUnitCost = StockEntryCostResolver
                    .Resolve(sourceStockItem, product, store, _options)
                    .UnitCost;

                if (destAllocations.Count == 0)
                {
                    destAllocations = store.ListAllocations(StockDocumentKind.Transfer, line.Id)
                        .Select(a => new StockAllocationInput(a.Quantity, a.ProductLotId, SerialId: a.SerialId, UnitCost: fallbackUnitCost))
                        .ToList();
                }

                var destUnitCost = destAllocations.Count > 0
                    ? destAllocations.Sum(a => a.Quantity * (a.UnitCost ?? 0m)) / destAllocations.Sum(a => a.Quantity)
                    : fallbackUnitCost;

                var entryResult = _mutation.Apply(destStockItem, new StockMutationRequest
                {
                    ProductId = line.ProductId,
                    WarehouseId = transfer.DestinationWarehouseId,
                    Kind = StockMutationKind.Entry,
                    Quantity = line.RequestedQuantity,
                    UnitCost = destUnitCost,
                    Reason = MovementReason.Transfer,
                    Reference = reference,
                    Notes = "Transfert entrée depuis entrepôt source",
                    DocumentLineId = null,
                    DocumentKind = null,
                    Allocations = destAllocations.Count > 0 ? destAllocations : null
                }, product, store);

                if (entryResult.IsFailure)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return entryResult;
                }

                EnsureNewStockMovementsAreAdded(context, destStockItem, destMovementIdsBefore);

                _logger.LogInformation(
                    "Stock transferred for product {ProductId}: {Quantity} units from warehouse {SourceId} to {DestId}",
                    line.ProductId, line.RequestedQuantity, transfer.SourceWarehouseId, transfer.DestinationWarehouseId);
            }

            var completeResult = transfer.Complete();
            if (completeResult.IsFailure)
            {
                await transaction.RollbackAsync(cancellationToken);
                return completeResult;
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return Result.Success();
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
