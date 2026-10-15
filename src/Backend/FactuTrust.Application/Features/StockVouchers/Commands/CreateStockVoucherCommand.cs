using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;

using FactuTrust.Application.Features.Stock.Services;

namespace FactuTrust.Application.Features.StockVouchers.Commands;

public sealed record CreateStockVoucherCommand(CreateStockVoucherDto Dto) : IRequest<Result<Guid>>;

public sealed class CreateStockVoucherCommandHandler : IRequestHandler<CreateStockVoucherCommand, Result<Guid>>
{
    private readonly IStockVoucherRepository _repository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductRepository _productRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IStockValuationReader _valuationReader;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly ITenantContext _tenantContext;
    private readonly IDocumentNumberService _documentNumberService;

    public CreateStockVoucherCommandHandler(
        IStockVoucherRepository repository,
        IWarehouseRepository warehouseRepository,
        IProductRepository productRepository,
        IStockItemRepository stockItemRepository,
        IStockValuationReader valuationReader,
        ICurrentUser currentUser,
        IAuditService auditService,
        ITenantContext tenantContext,
        IDocumentNumberService documentNumberService)
    {
        _repository = repository;
        _warehouseRepository = warehouseRepository;
        _productRepository = productRepository;
        _stockItemRepository = stockItemRepository;
        _valuationReader = valuationReader;
        _currentUser = currentUser;
        _auditService = auditService;
        _tenantContext = tenantContext;
        _documentNumberService = documentNumberService;
    }

    public async Task<Result<Guid>> Handle(CreateStockVoucherCommand request, CancellationToken cancellationToken)
    {
        var dto = request.Dto;

        if (_tenantContext.TenantId is null)
            return Result.Failure<Guid>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        var warehouse = await _warehouseRepository.GetByIdAsync(dto.WarehouseId, cancellationToken);
        if (warehouse is null)
            return Result.Failure<Guid>(Error.NotFound("Warehouse", dto.WarehouseId));

        if (!warehouse.IsActive)
            return Result.Failure<Guid>(Error.Validation("Warehouse", "Cet entrepôt est désactivé."));

        var year = dto.VoucherDate.Year;
        var numberingType = dto.Kind.ToNumberingDocumentType();
        var docResult = await _documentNumberService.ReserveNextAsync(
            _tenantContext.TenantId.Value,
            numberingType,
            year,
            dto.VoucherDate,
            cancellationToken);
        var number = StockVoucherNumber.Create(
            docResult.Prefix ?? dto.Kind.DefaultPrefix(),
            docResult.Year,
            docResult.Sequence);

        var createResult = Domain.Entities.StockVoucher.Create(
            number,
            dto.Kind,
            warehouse,
            dto.VoucherDate,
            dto.Reason,
            dto.ExternalReference,
            dto.Notes);

        if (createResult.IsFailure)
            return Result.Failure<Guid>(createResult.Error);

        var voucher = createResult.Value;

        foreach (var lineDto in dto.Lines)
        {
            var product = await _productRepository.GetByIdAsync(lineDto.ProductId, cancellationToken);
            if (product is null)
                return Result.Failure<Guid>(Error.NotFound("Product", lineDto.ProductId));

            var unitCost = await ResolveUnitCostAsync(
                dto.Kind, product, warehouse.Id, lineDto.UnitCost, cancellationToken);

            var addResult = voucher.AddLine(product, lineDto.Quantity, unitCost, lineDto.Notes);
            if (addResult.IsFailure)
                return Result.Failure<Guid>(addResult.Error);
        }

        voucher.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");
        await _repository.AddAsync(voucher, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.StockVoucher.Created,
            "StockVoucher",
            voucher.Id,
            newValues: new { Number = voucher.Number.Value, Kind = voucher.Kind.ToString() },
            cancellationToken: cancellationToken);

        return Result.Success(voucher.Id);
    }

    private async Task<decimal> ResolveUnitCostAsync(
        StockVoucherKind kind,
        Domain.Entities.Product product,
        Guid warehouseId,
        decimal? requestedCost,
        CancellationToken cancellationToken)
    {
        if (kind == StockVoucherKind.Entry)
            return requestedCost ?? product.LastPurchasePrice?.Amount ?? product.GetPurchasePrice().Amount;

        if (requestedCost.HasValue)
            return requestedCost.Value;

        // Même cascade qu'avant, mais le coût d'un article FIFO/LIFO vient désormais de ses couches
        // et non de son cache d'affichage. Hors transaction ici : le résolveur lit la valorisation
        // déjà chargée, jamais les couches une par une.
        var reading = await _valuationReader.GetByProductAndWarehouseAsync(
            product.Id, warehouseId, cancellationToken);
        return StockEntryCostResolver
            .Resolve(reading, product, explicitUnitCost: null, allowPurchasePriceCascade: true)
            .UnitCost;
    }
}
