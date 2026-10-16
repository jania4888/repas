using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.DataExports;

public sealed record ClientExportRow(
    Guid Id,
    string Code,
    string Name,
    ClientType Type,
    string? Nif,
    string? Email,
    string? Phone,
    string? ContactPerson,
    string? Street,
    string? StreetLine2,
    string? PostalCode,
    string? City,
    string? Governorate,
    string? Country,
    bool IsActive,
    decimal? CreditLimit,
    int? DefaultPaymentTermDays,
    string? Notes,
    int TotalInvoices,
    decimal TotalRevenue);

public sealed record ProductExportRow(
    Guid Id,
    string Code,
    string Name,
    string? Description,
    ProductType Type,
    string? CategoryName,
    decimal UnitPrice,
    decimal? PurchasePrice,
    decimal? LastPurchasePrice,
    decimal? WeightedAverageCost,
    VatRate VatRate,
    string? Unit,
    string? Barcode,
    bool IsActive,
    bool IsStockManaged,
    bool IsFodecApplicable,
    bool IsDiscountEnabled,
    decimal? MaxDiscountPercent);

public sealed record SupplierExportRow(
    Guid Id,
    string Name,
    SupplierType Type,
    string? Nif,
    string? Email,
    string? Phone,
    string? ContactPerson,
    string? Street,
    string? StreetLine2,
    string? PostalCode,
    string? City,
    string? Governorate,
    string? Country,
    int PaymentTermDays,
    bool IsActive,
    bool IsResident,
    string? Activity,
    bool IsSubjectToWithholding,
    decimal? DefaultWithholdingRate,
    string? Notes);

public sealed record InvoiceExportRow(
    Guid Id,
    string Number,
    InvoiceType Type,
    DateTime IssueDate,
    DateTime? DueDate,
    InvoiceStatus Status,
    string ClientName,
    decimal SubTotal,
    decimal TotalVat,
    decimal TotalAmount,
    decimal TotalPaid,
    string? Reference,
    string? Notes,
    string? PaymentTerms,
    string? WarehouseName,
    string? LinkedInvoiceNumber,
    DateTime? PaidAt);

public sealed record InvoiceLineExportRow(
    string DocumentNumber,
    int LineNumber,
    string ProductCode,
    string ProductName,
    decimal Quantity,
    string? Unit,
    decimal UnitPrice,
    VatRate VatRate,
    decimal? DiscountPercent,
    decimal SubTotal,
    decimal VatAmount,
    decimal Total,
    bool IsFodecApplicable,
    Guid Id);

public sealed record InvoicePaymentExportRow(
    string DocumentNumber,
    DateTime PaymentDate,
    decimal Amount,
    PaymentMethod Method,
    string? Reference,
    bool IsRefunded,
    Guid Id);

public sealed record SupplierInvoiceExportRow(
    Guid Id,
    string InvoiceNumber,
    DateTime InvoiceDate,
    DateTime DueDate,
    SupplierInvoiceStatus Status,
    string SupplierName,
    decimal SubTotal,
    decimal TotalVat,
    decimal TotalAmount,
    decimal TotalPaid,
    string? ExternalReference,
    string? PurchaseOrderNumber,
    string? WarehouseName,
    decimal? WithholdingRate,
    decimal? WithholdingAmount,
    DateTime? PaidAt);

public sealed record SupplierInvoiceLineExportRow(
    string DocumentNumber,
    int LineNumber,
    string ProductCode,
    string ProductName,
    decimal Quantity,
    string? Unit,
    decimal UnitPrice,
    VatRate VatRate,
    decimal SubTotal,
    decimal VatAmount,
    decimal Total,
    Guid Id);

public sealed record SupplierPaymentExportRow(
    string DocumentNumber,
    DateTime PaymentDate,
    decimal Amount,
    PaymentMethod Method,
    string? Reference,
    Guid Id);

public sealed record QuoteExportRow(
    Guid Id,
    string Number,
    DateTime IssueDate,
    DateTime ExpiryDate,
    QuoteStatus Status,
    string ClientName,
    decimal SubTotal,
    decimal TotalVat,
    decimal TotalAmount,
    string? Reference,
    string? Notes);

public sealed record QuoteLineExportRow(
    string DocumentNumber,
    int LineNumber,
    string ProductCode,
    string ProductName,
    decimal Quantity,
    string? Unit,
    decimal UnitPrice,
    VatRate VatRate,
    decimal? DiscountPercent,
    decimal SubTotal,
    decimal VatAmount,
    decimal Total,
    Guid Id);

public sealed record DeliveryNoteExportRow(
    Guid Id,
    string Number,
    DateTime IssueDate,
    DateTime? DeliveryDate,
    DeliveryNoteStatus Status,
    string ClientName,
    string DeliveryAddress,
    string? DeliveryCity,
    string? WarehouseName,
    string? Reference);

public sealed record DeliveryNoteLineExportRow(
    string DocumentNumber,
    int LineNumber,
    string ProductCode,
    string Designation,
    decimal OrderedQuantity,
    decimal DeliveredQuantity,
    decimal RejectedQuantity,
    decimal ReturnedQuantity,
    string Unit,
    decimal UnitPrice,
    int VatRatePercent,
    decimal? DiscountPercent,
    bool IsFodecApplicable,
    Guid Id);

public sealed record PurchaseOrderExportRow(
    Guid Id,
    string Number,
    DateTime OrderDate,
    DateTime? ExpectedDeliveryDate,
    PurchaseOrderStatus Status,
    string SupplierName,
    decimal SubTotal,
    decimal TotalVat,
    decimal TotalAmount,
    string? Reference,
    string? WarehouseName);

public sealed record PurchaseOrderLineExportRow(
    string DocumentNumber,
    int LineNumber,
    string ProductCode,
    string ProductName,
    decimal Quantity,
    decimal ReceivedQuantity,
    decimal InvoicedQuantity,
    string? Unit,
    decimal UnitPrice,
    decimal SubTotal,
    decimal VatAmount,
    decimal Total,
    Guid Id);

public sealed record WarehouseExportRow(
    Guid Id,
    string Code,
    string Name,
    string? Address,
    bool IsDefault,
    bool IsActive);

public sealed record StockPositionExportRow(
    Guid Id,
    string ProductCode,
    string ProductName,
    string WarehouseName,
    decimal QuantityOnHand,
    decimal QuantityReserved,
    decimal MinimumStock,
    decimal? MaximumStock,
    decimal AverageCost);

public sealed record StockMovementExportRow(
    Guid Id,
    DateTime OccurredAt,
    string ProductCode,
    string ProductName,
    string WarehouseName,
    MovementType Type,
    MovementReason Reason,
    decimal Quantity,
    decimal UnitCost,
    decimal BalanceAfter,
    string? Reference);
