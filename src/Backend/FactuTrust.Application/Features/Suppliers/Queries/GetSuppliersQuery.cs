using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using MediatR;

namespace FactuTrust.Application.Features.Suppliers.Queries;

/// <summary>
/// Query to get paginated suppliers with optional search and filters.
/// </summary>
public sealed record GetSuppliersQuery(
    string? Search = null,
    SupplierType? Type = null,
    bool? IsActive = null,
    int Page = 1,
    int PageSize = 20) : IRequest<PagedResult<SupplierListDto>>;

/// <summary>
/// Handler for GetSuppliersQuery.
/// </summary>
public sealed class GetSuppliersQueryHandler : IRequestHandler<GetSuppliersQuery, PagedResult<SupplierListDto>>
{
    private readonly ISupplierRepository _supplierRepository;
    private readonly IPurchaseOrderRepository _purchaseOrderRepository;

    public GetSuppliersQueryHandler(
        ISupplierRepository supplierRepository,
        IPurchaseOrderRepository purchaseOrderRepository)
    {
        _supplierRepository = supplierRepository;
        _purchaseOrderRepository = purchaseOrderRepository;
    }

    public async Task<PagedResult<SupplierListDto>> Handle(GetSuppliersQuery request, CancellationToken cancellationToken)
    {
        var (items, totalCount) = await _supplierRepository.SearchAsync(
            request.Search,
            request.Type,
            request.IsActive,
            request.Page,
            request.PageSize,
            cancellationToken);

        var dtos = items.Select(s => new SupplierListDto
        {
            Id = s.Id,
            Name = s.Name,
            Type = s.Type.ToString(),
            TypeDisplay = s.Type.ToDisplayString(),
            Nif = s.NIF?.Value,
            Email = s.Email?.Value,
            Phone = s.Phone?.Value,
            City = s.Address.City,
            Governorate = s.Address.Governorate,
            ContactPerson = s.ContactPerson,
            PaymentTermDays = s.PaymentTermDays,
            IsActive = s.IsActive,
            TotalOrders = 0 // Optimized: skip count query for list view
        }).ToList();

        return PagedResult<SupplierListDto>.Create(dtos, request.Page, request.PageSize, totalCount);
    }
}
