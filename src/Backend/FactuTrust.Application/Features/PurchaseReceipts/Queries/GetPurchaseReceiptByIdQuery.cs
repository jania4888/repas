using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.PurchaseReceipts.Queries;

/// <summary>
/// Query to get purchase receipt details by ID.
/// </summary>
public sealed record GetPurchaseReceiptByIdQuery(Guid Id) : IRequest<Result<PurchaseReceiptDetailDto>>;

/// <summary>
/// Handler for GetPurchaseReceiptByIdQuery.
/// </summary>
public sealed class GetPurchaseReceiptByIdQueryHandler
    : IRequestHandler<GetPurchaseReceiptByIdQuery, Result<PurchaseReceiptDetailDto>>
{
    private readonly IPurchaseReceiptRepository _purchaseReceiptRepository;
    private readonly ISupplierInvoiceRepository _supplierInvoiceRepository;

    public GetPurchaseReceiptByIdQueryHandler(
        IPurchaseReceiptRepository purchaseReceiptRepository,
        ISupplierInvoiceRepository supplierInvoiceRepository)
    {
        _purchaseReceiptRepository = purchaseReceiptRepository;
        _supplierInvoiceRepository = supplierInvoiceRepository;
    }

    public async Task<Result<PurchaseReceiptDetailDto>> Handle(
        GetPurchaseReceiptByIdQuery request,
        CancellationToken cancellationToken)
    {
        var receipt = await _purchaseReceiptRepository.GetByIdWithDetailsAsync(request.Id, cancellationToken);
        if (receipt is null)
            return Result.Failure<PurchaseReceiptDetailDto>(Error.NotFound("PurchaseReceipt", request.Id));

        var linkedInvoices = await _supplierInvoiceRepository.GetLinkedSummariesByPurchaseReceiptIdAsync(
            request.Id, cancellationToken);

        var dto = new PurchaseReceiptDetailDto
        {
            Id = receipt.Id,
            Number = receipt.Number.Value,
            ReceiptDate = receipt.ReceiptDate,
            Status = receipt.Status,
            StatusDisplay = receipt.Status.ToDisplayString(),
            StatusCss = receipt.Status.ToCssClass(),
            SupplierReference = receipt.SupplierReference,
            TransporterName = receipt.TransporterName,
            DeliveryNoteNumber = receipt.DeliveryNoteNumber,
            Notes = receipt.Notes,
            WarehouseId = receipt.WarehouseId,
            WarehouseName = receipt.Warehouse?.Name,
            PurchaseOrderId = receipt.PurchaseOrderId,
            PurchaseOrderNumber = receipt.PurchaseOrder?.Number.Value,
            Supplier = new SupplierSummaryDto
            {
                Id = receipt.Supplier.Id,
                Name = receipt.Supplier.Name,
                Nif = receipt.Supplier.NIF?.Value,
                Email = receipt.Supplier.Email?.Value,
                Address = receipt.Supplier.Address.ToString()
            },
            Lines = receipt.Lines.OrderBy(l => l.LineNumber).Select(l => new PurchaseReceiptLineDto
            {
                Id = l.Id,
                LineNumber = l.LineNumber,
                PurchaseOrderLineId = l.PurchaseOrderLineId,
                ProductId = l.ProductId,
                ProductCode = l.ProductCode,
                ProductName = l.ProductName,
                ProductDescription = l.ProductDescription,
                OrderedQuantity = l.OrderedQuantity,
                ReceivedQuantity = l.ReceivedQuantity,
                InvoicedQuantity = l.InvoicedQuantity,
                ReceivedNotInvoicedQuantity = l.ReceivedNotInvoicedQuantity,
                Unit = l.Unit,
                UnitPriceHT = l.UnitPrice.Amount,
                DiscountPercent = l.DiscountPercent,
                VatRateDisplay = l.VatRate.ToDisplayString(),
                SubTotal = l.SubTotal.Amount,
                VatAmount = l.VatAmount.Amount,
                Total = l.Total.Amount,
                TrackingMode = l.Product.TrackingMode,
                PickingPolicy = l.Product.PickingPolicy
            }).ToList(),
            Attachments = receipt.Attachments.OrderByDescending(a => a.UploadedAt).Select(a => new PurchaseReceiptAttachmentDto
            {
                Id = a.Id,
                FileName = a.FileName,
                ContentType = a.ContentType,
                SizeBytes = a.SizeBytes,
                UploadedAt = a.UploadedAt,
                UploadedBy = a.UploadedBy
            }).ToList(),
            SubTotal = receipt.SubTotal.Amount,
            TotalVat = receipt.TotalVat.Amount,
            TotalTTC = receipt.TotalAmount.Amount,
            IsPartialRelativeToOrdered = receipt.IsPartialRelativeToOrdered,
            TotalReceivedNotInvoicedQuantity = receipt.TotalReceivedNotInvoicedQuantity,
            HasReceivedNotInvoiced = receipt.HasReceivedNotInvoiced,
            LinkedSupplierInvoices = linkedInvoices,
            ValidatedAt = receipt.ValidatedAt,
            CancelledAt = receipt.CancelledAt,
            CancellationReason = receipt.CancellationReason,
            CreatedAt = receipt.CreatedAt
        };

        return Result.Success(dto);
    }
}
