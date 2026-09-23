using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.SalesOrders.Queries;

// ─────────────────────────────── Détail ───────────────────────────────

public sealed record GetSalesOrderByIdQuery(Guid Id) : IRequest<Result<SalesOrderDetailDto>>;

public sealed class GetSalesOrderByIdQueryHandler
    : IRequestHandler<GetSalesOrderByIdQuery, Result<SalesOrderDetailDto>>
{
    private readonly ISalesOrderRepository _repository;
    private readonly IQuoteRepository _quoteRepository;

    public GetSalesOrderByIdQueryHandler(
        ISalesOrderRepository repository,
        IQuoteRepository quoteRepository)
    {
        _repository = repository;
        _quoteRepository = quoteRepository;
    }

    public async Task<Result<SalesOrderDetailDto>> Handle(
        GetSalesOrderByIdQuery request, CancellationToken cancellationToken)
    {
        var order = await _repository.GetByIdWithLinesAsync(request.Id, cancellationToken);
        if (order is null)
            return Result.Failure<SalesOrderDetailDto>(Error.NotFound("Commande", request.Id));

        // Numéro du devis d'origine, pour rendre la chaîne documentaire lisible à l'écran.
        string? sourceQuoteNumber = null;
        if (order.SourceQuoteId.HasValue)
        {
            var quote = await _quoteRepository.GetByIdAsync(order.SourceQuoteId.Value, cancellationToken);
            sourceQuoteNumber = quote?.Number.Value;
        }

        var vatBreakdown = order.GetVatBreakdown();

        return Result.Success(new SalesOrderDetailDto
        {
            Id = order.Id,
            Number = order.Number.Value,
            OrderDate = order.OrderDate,
            ExpectedDeliveryDate = order.ExpectedDeliveryDate,
            Status = order.Status,
            StatusDisplay = order.Status.ToDisplayString(),
            ClientId = order.ClientId,
            Client = new ClientSummaryDto
            {
                Id = order.Client.Id,
                Name = order.Client.Name,
                Nif = order.Client.NIF?.Value,
                Email = order.Client.Email?.Value,
                Address = order.Client.Address.ToSingleLine()
            },
            Reference = order.Reference,
            Notes = order.Notes,
            PaymentTerms = order.PaymentTerms,
            WarehouseId = order.WarehouseId,
            WarehouseName = order.Warehouse?.Name,
            SourceQuoteId = order.SourceQuoteId,
            SourceQuoteNumber = sourceQuoteNumber,
            Lines = order.Lines.OrderBy(l => l.LineNumber).Select(MapLine).ToList(),
            SubTotal = order.SubTotal.Amount,
            SubTotalBeforeGlobalDiscount = order.SubTotalBeforeGlobalDiscount.Amount,
            GlobalDiscountPercent = order.GlobalDiscountPercent,
            GlobalDiscountAmount = order.GlobalDiscountAmount.Amount,
            FodecAmount = order.FodecAmount.Amount,
            TotalVat = order.TotalVat.Amount,
            FiscalStampAmount = order.FiscalStampAmount.Amount,
            TotalAmount = order.TotalAmount.Amount,
            Currency = order.TotalAmount.Currency,
            VatBreakdown = vatBreakdown.Select(kv => new VatBreakdownDto
            {
                Rate = (int)kv.Key,
                RateDisplay = kv.Key.ToDisplayString(),
                BaseAmount = order.Lines
                    .Where(l => l.VatRate == kv.Key)
                    .Sum(l => l.SubTotal.Amount + l.FodecAmount.Amount),
                VatAmount = kv.Value.Amount
            }).ToList(),
            IsFullyDelivered = order.IsFullyDelivered,
            IsFullyInvoiced = order.IsFullyInvoiced,
            TotalPendingDeliveryQuantity = order.TotalPendingDeliveryQuantity,
            TotalPendingInvoiceQuantity = order.TotalPendingInvoiceQuantity,
            BacklogAmountHt = order.BacklogAmountHt,
            IsStockReserved = order.IsStockReserved,
            ConfirmedAt = order.ConfirmedAt,
            CompletedAt = order.CompletedAt,
            CancelledAt = order.CancelledAt,
            CancellationReason = order.CancellationReason,
            ClosedAt = order.ClosedAt,
            ClosureReason = order.ClosureReason,
            CreatedAt = order.CreatedAt,
            UpdatedAt = order.UpdatedAt
        });
    }

    internal static SalesOrderLineDto MapLine(SalesOrderLine l) => new()
    {
        Id = l.Id,
        LineNumber = l.LineNumber,
        ProductId = l.ProductId,
        ProductCode = l.ProductCode,
        ProductName = l.ProductName,
        ProductDescription = l.ProductDescription,
        Unit = l.Unit,
        Quantity = l.Quantity,
        DeliveredQuantity = l.DeliveredQuantity,
        InvoicedQuantity = l.InvoicedQuantity,
        PendingDeliveryQuantity = l.PendingDeliveryQuantity,
        PendingInvoiceQuantity = l.PendingInvoiceQuantity,
        DeliveredNotInvoicedQuantity = l.DeliveredNotInvoicedQuantity,
        UnitPrice = l.UnitPrice.Amount,
        VatRatePercent = (int)l.VatRate,
        DiscountPercent = l.DiscountPercent,
        AppliedPromotionId = l.AppliedPromotionId,
        AppliedPromotionName = l.AppliedPromotionName,
        DiscountAmount = l.DiscountAmount.Amount,
        IsFodecApplicable = l.IsFodecApplicable,
        FodecRatePercent = l.FodecRatePercent,
        FodecAmount = l.FodecAmount.Amount,
        SubTotal = l.SubTotal.Amount,
        VatAmount = l.VatAmount.Amount,
        Total = l.Total.Amount,
        IsFullyDelivered = l.IsFullyDelivered,
        IsFullyInvoiced = l.IsFullyInvoiced,
        Notes = l.Notes
    };
}

// ─────────────────────────────── Liste ───────────────────────────────

public sealed record GetSalesOrdersQuery(
    string? Search = null,
    SalesOrderStatus? Status = null,
    Guid? ClientId = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    bool OpenOnly = false,
    int Page = 1,
    int PageSize = 20) : IRequest<PagedResult<SalesOrderListDto>>;

public sealed class GetSalesOrdersQueryHandler
    : IRequestHandler<GetSalesOrdersQuery, PagedResult<SalesOrderListDto>>
{
    private readonly ISalesOrderRepository _repository;

    public GetSalesOrdersQueryHandler(ISalesOrderRepository repository) => _repository = repository;

    public async Task<PagedResult<SalesOrderListDto>> Handle(
        GetSalesOrdersQuery request, CancellationToken cancellationToken)
    {
        var (items, totalCount) = await _repository.SearchAsync(
            request.Search, request.Status, request.ClientId,
            request.FromDate, request.ToDate, request.OpenOnly,
            request.Page, request.PageSize, cancellationToken);

        var dtos = items.Select(o => new SalesOrderListDto
        {
            Id = o.Id,
            Number = o.Number.Value,
            OrderDate = o.OrderDate,
            ExpectedDeliveryDate = o.ExpectedDeliveryDate,
            Status = o.Status,
            StatusDisplay = o.Status.ToDisplayString(),
            StatusCssClass = o.Status.ToCssClass(),
            ClientId = o.ClientId,
            ClientName = o.Client?.Name ?? string.Empty,
            Reference = o.Reference,
            TotalAmount = o.TotalAmount.Amount,
            Currency = o.TotalAmount.Currency,
            LineCount = o.Lines.Count,
            PendingDeliveryQuantity = o.TotalPendingDeliveryQuantity,
            BacklogAmountHt = o.Status.IsOpen() ? o.BacklogAmountHt : 0m,
            IsOpen = o.Status.IsOpen(),
            IsStockReserved = o.IsStockReserved,
            SourceQuoteId = o.SourceQuoteId
        }).ToList();

        return PagedResult<SalesOrderListDto>.Create(dtos, request.Page, request.PageSize, totalCount);
    }
}

// ─────────────────────────────── Totaux ───────────────────────────────

public sealed record GetSalesOrdersSummaryQuery(
    string? Search = null,
    SalesOrderStatus? Status = null,
    Guid? ClientId = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    bool OpenOnly = false) : IRequest<SalesOrderListSummaryDto>;

public sealed class GetSalesOrdersSummaryQueryHandler
    : IRequestHandler<GetSalesOrdersSummaryQuery, SalesOrderListSummaryDto>
{
    private readonly ISalesOrderRepository _repository;

    public GetSalesOrdersSummaryQueryHandler(ISalesOrderRepository repository) => _repository = repository;

    public Task<SalesOrderListSummaryDto> Handle(
        GetSalesOrdersSummaryQuery request, CancellationToken cancellationToken) =>
        _repository.GetSummaryAsync(
            request.Search, request.Status, request.ClientId,
            request.FromDate, request.ToDate, request.OpenOnly, cancellationToken);
}

// ─────────────────────────── Carnet de commandes ───────────────────────────

/// <summary>
/// Carnet de commandes : ce qui reste à livrer, ligne par ligne, avec sa valeur.
/// Indicateur central du module — il n'existait pas avant la commande client.
/// </summary>
public sealed record GetSalesOrderBacklogQuery(
    Guid? ClientId = null,
    DateTime? DueBefore = null) : IRequest<IReadOnlyList<SalesOrderBacklogRowDto>>;

public sealed class GetSalesOrderBacklogQueryHandler
    : IRequestHandler<GetSalesOrderBacklogQuery, IReadOnlyList<SalesOrderBacklogRowDto>>
{
    private readonly ISalesOrderRepository _repository;

    public GetSalesOrderBacklogQueryHandler(ISalesOrderRepository repository) => _repository = repository;

    public Task<IReadOnlyList<SalesOrderBacklogRowDto>> Handle(
        GetSalesOrderBacklogQuery request, CancellationToken cancellationToken) =>
        _repository.GetBacklogAsync(request.ClientId, request.DueBefore, cancellationToken);
}
