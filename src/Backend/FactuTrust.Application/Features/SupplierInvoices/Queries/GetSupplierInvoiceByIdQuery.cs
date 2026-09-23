using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.SupplierInvoices.Queries;

/// <summary>
/// Query to get supplier invoice details by ID.
/// </summary>
public sealed record GetSupplierInvoiceByIdQuery(Guid Id) : IRequest<Result<SupplierInvoiceDetailDto>>;

/// <summary>
/// Handler for GetSupplierInvoiceByIdQuery.
/// </summary>
public sealed class GetSupplierInvoiceByIdQueryHandler : IRequestHandler<GetSupplierInvoiceByIdQuery, Result<SupplierInvoiceDetailDto>>
{
    private readonly ISupplierInvoiceRepository _repository;
    private readonly IFixedAssetRepository _fixedAssets;

    public GetSupplierInvoiceByIdQueryHandler(
        ISupplierInvoiceRepository repository,
        IFixedAssetRepository fixedAssets)
    {
        _repository = repository;
        _fixedAssets = fixedAssets;
    }

    public async Task<Result<SupplierInvoiceDetailDto>> Handle(GetSupplierInvoiceByIdQuery request, CancellationToken cancellationToken)
    {
        var si = await _repository.GetByIdWithLinesAsync(request.Id, cancellationToken);
        if (si is null)
            return Result.Failure<SupplierInvoiceDetailDto>(Error.NotFound("SupplierInvoice", request.Id));

        var linkedAssets = await _fixedAssets.GetBySupplierInvoiceIdAsync(si.Id, cancellationToken);
        var assetByLineId = linkedAssets
            .Where(a => a.SupplierInvoiceLineId.HasValue)
            .ToDictionary(a => a.SupplierInvoiceLineId!.Value, a => a);

        var totalPaid = si.Payments.Sum(p => p.Amount.Amount);
        var remainingAmount = si.TotalAmount.Amount - totalPaid;

        var dto = new SupplierInvoiceDetailDto
        {
            Id = si.Id,
            InvoiceNumber = si.InvoiceNumber,
            InvoiceDate = si.InvoiceDate,
            DueDate = si.DueDate,
            Status = si.Status,
            StatusDisplay = si.Status.ToDisplayString(),
            StatusCss = si.Status.ToCssClass(),
            ExternalReference = si.ExternalReference,
            Notes = si.Notes,
            WarehouseId = si.WarehouseId,
            WarehouseName = si.Warehouse?.Name,
            Supplier = new SupplierSummaryDto
            {
                Id = si.Supplier.Id,
                Name = si.Supplier.Name,
                Nif = si.Supplier.NIF?.Value,
                Email = si.Supplier.Email?.Value,
                Address = si.Supplier.Address.ToString()
            },
            PurchaseOrderId = si.PurchaseOrderId,
            PurchaseOrderNumber = si.PurchaseOrder?.Number.Value,
            SourcePurchaseReceiptId = si.SourcePurchaseReceiptId,
            SourcePurchaseReceiptNumber = si.SourcePurchaseReceipt?.Number.Value,
            Lines = si.Lines.OrderBy(l => l.LineNumber).Select(l =>
            {
                assetByLineId.TryGetValue(l.Id, out var linkedAsset);
                return new SupplierInvoiceLineDto
                {
                    Id = l.Id,
                    LineNumber = l.LineNumber,
                    ProductId = l.ProductId,
                    ProductCode = l.ProductCode,
                    ProductName = l.ProductName,
                    ProductDescription = l.ProductDescription,
                    Quantity = l.Quantity,
                    Unit = l.Unit,
                    UnitPriceHT = l.UnitPrice.Amount,
                    VatRateDisplay = l.VatRate.ToDisplayString(),
                    SubTotal = l.SubTotal.Amount,
                    VatAmount = l.VatAmount.Amount,
                    Total = l.Total.Amount,
                    IsFixedAsset = l.IsFixedAsset,
                    AssetAccountNumber = l.AssetAccountNumber,
                    DepreciationRateCategoryId = l.DepreciationRateCategoryId,
                    FixedAssetId = linkedAsset?.Id,
                    FixedAssetInventoryNumber = linkedAsset?.InventoryNumber
                };
            }).ToList(),
            SubTotal = si.SubTotal.Amount,
            TotalVat = si.TotalVat.Amount,
            TotalTTC = si.TotalAmount.Amount,
            TotalPaid = totalPaid,
            RemainingAmount = remainingAmount,
            Payments = si.Payments.OrderByDescending(p => p.PaymentDate).ThenByDescending(p => p.CreatedAt).Select(p => new SupplierPaymentDto
            {
                Id = p.Id,
                Amount = p.Amount.Amount,
                Currency = p.Amount.Currency,
                PaymentDate = p.PaymentDate,
                Method = (int)p.Method,
                MethodDisplay = p.Method.ToDisplayString(),
                Reference = p.Reference,
                Notes = p.Notes,
                CreatedAt = p.CreatedAt,
                EffetDueDate = p.EffetDueDate,
                EffetStatus = (int?)p.EffetStatus,
                EffetStatusDisplay = p.EffetStatus?.ToDisplayString()
            }).ToList(),
            PaidAt = si.PaidAt,
            PaymentReference = si.PaymentReference,
            PaymentMethod = si.PaymentMethod,
            CancelledAt = si.CancelledAt,
            CancellationReason = si.CancellationReason,
            CreatedAt = si.CreatedAt,
            IsSubjectToWithholding = si.IsSubjectToWithholding,
            WithholdingRate = si.WithholdingRate,
            WithholdingAmount = si.WithholdingAmount,
            NetAmountAfterWithholding = si.NetAmountAfterWithholding
        };

        return Result.Success(dto);
    }
}
