using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;

using FactuTrust.Application.Features.Stock.Services;

namespace FactuTrust.Application.Features.StockVouchers.Commands;

public sealed record UpdateStockVoucherCommand(Guid Id, UpdateStockVoucherDto Dto) : IRequest<Result>;

public sealed class UpdateStockVoucherCommandHandler : IRequestHandler<UpdateStockVoucherCommand, Result>
{
    private readonly IStockVoucherRepository _repository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductRepository _productRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IStockValuationReader _valuationReader;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;

    public UpdateStockVoucherCommandHandler(
        IStockVoucherRepository repository,
        IWarehouseRepository warehouseRepository,
        IProductRepository productRepository,
        IStockItemRepository stockItemRepository,
        IStockValuationReader valuationReader,
        ICurrentUser currentUser,
        IAuditService auditService)
    {
        _repository = repository;
        _warehouseRepository = warehouseRepository;
        _productRepository = productRepository;
        _stockItemRepository = stockItemRepository;
        _valuationReader = valuationReader;
        _currentUser = currentUser;
        _auditService = auditService;
    }

    public async Task<Result> Handle(UpdateStockVoucherCommand request, CancellationToken cancellationToken)
    {
        var voucher = await _repository.GetByIdWithLinesAsync(request.Id, cancellationToken);
        if (voucher is null)
            return Result.Failure(Error.NotFound("StockVoucher", request.Id));

        if (!voucher.Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Seuls les brouillons peuvent être modifiés."));

        var dto = request.Dto;
        var warehouse = await _warehouseRepository.GetByIdAsync(dto.WarehouseId, cancellationToken);
        if (warehouse is null)
            return Result.Failure(Error.NotFound("Warehouse", dto.WarehouseId));

        if (!warehouse.IsActive)
            return Result.Failure(Error.Validation("Warehouse", "Cet entrepôt est désactivé."));

        var headerResult = voucher.UpdateHeader(
            dto.VoucherDate, dto.WarehouseId, dto.Reason, dto.ExternalReference, dto.Notes);
        if (headerResult.IsFailure)
            return headerResult;

        var clearResult = voucher.ClearLines();
        if (clearResult.IsFailure)
            return clearResult;

        foreach (var lineDto in dto.Lines)
        {
            var product = await _productRepository.GetByIdAsync(lineDto.ProductId, cancellationToken);
            if (product is null)
                return Result.Failure(Error.NotFound("Product", lineDto.ProductId));

            decimal unitCost;
            if (voucher.Kind == StockVoucherKind.Entry)
            {
                unitCost = lineDto.UnitCost ?? product.LastPurchasePrice?.Amount ?? product.GetPurchasePrice().Amount;
            }
            else if (lineDto.UnitCost.HasValue)
            {
                unitCost = lineDto.UnitCost.Value;
            }
            else
            {
                // Même cascade qu'avant, mais le coût d'un article FIFO/LIFO vient de ses couches
                // et non de son cache d'affichage, qui est arrondi et peut avoir dérivé.
                var reading = await _valuationReader.GetByProductAndWarehouseAsync(
                    product.Id, warehouse.Id, cancellationToken);
                unitCost = StockEntryCostResolver
                    .Resolve(reading, product, explicitUnitCost: null, allowPurchasePriceCascade: true)
                    .UnitCost;
            }

            var addResult = voucher.AddLine(product, lineDto.Quantity, unitCost, lineDto.Notes);
            if (addResult.IsFailure)
                return addResult;
        }

        voucher.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);
        await _repository.UpdateAsync(voucher, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.StockVoucher.Updated,
            "StockVoucher",
            voucher.Id,
            newValues: new { Number = voucher.Number.Value },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}
