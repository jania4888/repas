using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.PurchaseOrders.Queries;

/// <summary>
/// Query to get purchase order details by ID.
/// </summary>
public sealed record GetPurchaseOrderByIdQuery(Guid Id) : IRequest<Result<PurchaseOrderDetailDto>>;

/// <summary>
/// Handler for GetPurchaseOrderByIdQuery.
/// </summary>
public sealed class GetPurchaseOrderByIdQueryHandler : IRequestHandler<GetPurchaseOrderByIdQuery, Result<PurchaseOrderDetailDto>>
{
    private readonly IPurchaseOrderRepository _purchaseOrderRepository;
    private readonly ISupplierInvoiceRepository _supplierInvoiceRepository;

    public GetPurchaseOrderByIdQueryHandler(
        IPurchaseOrderRepository purchaseOrderRepository,
        ISupplierInvoiceRepository supplierInvoiceRepository)
    {
        _purchaseOrderRepository = purchaseOrderRepository;
        _supplierInvoiceRepository = supplierInvoiceRepository;
    }

    public async Task<Result<PurchaseOrderDetailDto>> Handle(GetPurchaseOrderByIdQuery request, CancellationToken cancellationToken)
    {
        var po = await _purchaseOrderRepository.GetByIdWithLinesAsync(request.Id, cancellationToken);
        if (po is null)
            return Result.Failure<PurchaseOrderDetailDto>(Error.NotFound("PurchaseOrder", request.Id));

        var linkedInvoices = await _supplierInvoiceRepository.GetLinkedSummariesByPurchaseOrderIdAsync(
            request.Id, cancellationToken);

        var dto = new PurchaseOrderDetailDto
        {
            Id = po.Id,
            Number = po.Number.Value,
            OrderDate = po.OrderDate,
            ExpectedDeliveryDate = po.ExpectedDeliveryDate,
            Status = po.Status,
            StatusDisplay = po.Status.ToDisplayString(),
            StatusCss = po.Status.ToCssClass(),
            Reference = po.Reference,
            Notes = po.Notes,
            WarehouseId = po.WarehouseId,
            WarehouseName = po.Warehouse?.Name,
            Supplier = new SupplierSummaryDto
            {
                Id = po.Supplier.Id,
                Name = po.Supplier.Name,
                Nif = po.Supplier.NIF?.Value,
                Email = po.Supplier.Email?.Value,
                Address = po.Supplier.Address.ToString()
            },
            Lines = po.Lines.OrderBy(l => l.LineNumber).Select(l => new PurchaseOrderLineDto
            {
                Id = l.Id,
                LineNumber = l.LineNumber,
                ProductId = l.ProductId,
                ProductCode = l.ProductCode,
                ProductName = l.ProductName,
                ProductDescription = l.ProductDescription,
                Quantity = l.Quantity,
                ReceivedQuantity = l.ReceivedQuantity,
                InvoicedQuantity = l.InvoicedQuantity,
                ReceivedNotInvoicedQuantity = l.ReceivedNotInvoicedQuantity,
                PendingQuantity = l.PendingQuantity,
                IsFullyReceived = l.IsFullyReceived,
                Unit = l.Unit,
                UnitPriceHT = l.UnitPrice.Amount,
                VatRateDisplay = l.VatRate.ToDisplayString(),
                SubTotal = l.SubTotal.Amount,
                VatAmount = l.VatAmount.Amount,
                Total = l.Total.Amount
            }).ToList(),
            SubTotal = po.SubTotal.Amount,
            TotalVat = po.TotalVat.Amount,
            TotalTTC = po.TotalAmount.Amount,
            ConfirmedAt = po.ConfirmedAt,
            ReceivedAt = po.ReceivedAt,
            InvoicedAt = po.InvoicedAt,
            CancelledAt = po.CancelledAt,
            CancellationReason = po.CancellationReason,
            TotalReceivedNotInvoicedQuantity = po.TotalReceivedNotInvoicedQuantity,
            HasReceivedNotInvoiced = po.HasReceivedNotInvoiced,
            LinkedSupplierInvoices = linkedInvoices,
            CreatedAt = po.CreatedAt
        };

        return Result.Success(dto);
    }
}
