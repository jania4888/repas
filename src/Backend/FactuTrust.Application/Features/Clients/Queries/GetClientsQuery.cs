using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using MediatR;

namespace FactuTrust.Application.Features.Clients.Queries;

/// <summary>
/// Query to get paginated clients with optional search and filters.
/// </summary>
public sealed record GetClientsQuery(
    string? Search = null,
    ClientType? Type = null,
    bool? IsActive = null,
    string? Governorate = null,
    int Page = 1,
    int PageSize = 20) : IRequest<PagedResult<ClientListDto>>;

/// <summary>
/// Handler for GetClientsQuery.
/// </summary>
public sealed class GetClientsQueryHandler : IRequestHandler<GetClientsQuery, PagedResult<ClientListDto>>
{
    private readonly IClientRepository _clientRepository;
    private readonly IInvoiceRepository _invoiceRepository;

    public GetClientsQueryHandler(IClientRepository clientRepository, IInvoiceRepository invoiceRepository)
    {
        _clientRepository = clientRepository;
        _invoiceRepository = invoiceRepository;
    }

    public static string GetClientCode(Guid id) => "CLI-" + id.ToString("N")[..8].ToUpperInvariant();

    public async Task<PagedResult<ClientListDto>> Handle(GetClientsQuery request, CancellationToken cancellationToken)
    {
        var (items, totalCount) = await _clientRepository.SearchAsync(
            request.Search,
            request.Type,
            request.IsActive,
            request.Governorate,
            request.Page,
            request.PageSize,
            cancellationToken);

        var dtos = new List<ClientListDto>();
        foreach (var c in items)
        {
            var invoices = await _invoiceRepository.GetByClientIdAsync(c.Id, cancellationToken);
            var totalRevenue = invoices
                .Where(i => i.Status != Domain.Enums.InvoiceStatus.Cancelled)
                .Sum(i => i.TotalAmount.Amount);

            dtos.Add(new ClientListDto
            {
                Id = c.Id,
                Code = GetClientCode(c.Id),
                Name = c.Name,
                Type = c.Type.ToString(),
                TypeDisplay = c.Type.ToDisplayString(),
                Nif = c.NIF?.Value,
                Email = c.Email?.Value,
                Phone = c.Phone?.Value,
                Street = c.Address.Street,
                StreetLine2 = c.Address.StreetLine2,
                PostalCode = c.Address.PostalCode,
                City = c.Address.City,
                Governorate = c.Address.Governorate,
                Country = c.Address.Country,
                IsActive = c.IsActive,
                TotalInvoices = invoices.Count,
                TotalRevenue = totalRevenue,
                CreditLimit = c.CreditLimit,
                DefaultPaymentTermDays = c.DefaultPaymentTermDays
            });
        }

        return PagedResult<ClientListDto>.Create(dtos, request.Page, request.PageSize, totalCount);
    }
}
