using FactuTrust.Application.Features.Clients.Queries;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class ClientRepository
{
    public async Task<CountedRows<ClientExportRow>> ListForExportAsync(
        string? searchTerm,
        ClientType? type,
        bool? isActive,
        string? governorate,
        int maxRows,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var filtered = ApplyClientFilters(context.Clients.AsNoTracking(), searchTerm, type, isActive, governorate);
        var count = await filtered.CountAsync(cancellationToken);
        if (count > maxRows)
            return CountedRows<ClientExportRow>.Over(count);

        var raw = await filtered
            .OrderBy(c => c.Name)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Type,
                Nif = c.NIF == null ? null : c.NIF.Value,
                Email = c.Email == null ? null : c.Email.Value,
                Phone = c.Phone == null ? null : c.Phone.Value,
                c.ContactPerson,
                Street = c.Address.Street,
                StreetLine2 = c.Address.StreetLine2,
                PostalCode = c.Address.PostalCode,
                City = c.Address.City,
                Governorate = c.Address.Governorate,
                Country = c.Address.Country,
                c.IsActive,
                c.CreditLimit,
                c.DefaultPaymentTermDays,
                c.Notes
            })
            .ToListAsync(cancellationToken);

        var stats = await (
            from invoice in context.Invoices.AsNoTracking()
            join client in filtered on invoice.ClientId equals client.Id
            group invoice by invoice.ClientId
            into grouped
            select new
            {
                ClientId = grouped.Key,
                Count = grouped.Count(),
                Revenue = grouped.Sum(invoice =>
                    invoice.Status == InvoiceStatus.Cancelled ? 0m : invoice.TotalAmount.Amount)
            }).ToListAsync(cancellationToken);

        var byClient = stats.ToDictionary(row => row.ClientId);
        var rows = raw.Select(client =>
        {
            byClient.TryGetValue(client.Id, out var stat);
            return new ClientExportRow(
                client.Id,
                GetClientsQueryHandler.GetClientCode(client.Id),
                client.Name,
                client.Type,
                client.Nif,
                client.Email,
                client.Phone,
                client.ContactPerson,
                client.Street,
                client.StreetLine2,
                client.PostalCode,
                client.City,
                client.Governorate,
                client.Country,
                client.IsActive,
                client.CreditLimit,
                client.DefaultPaymentTermDays,
                client.Notes,
                stat?.Count ?? 0,
                stat?.Revenue ?? 0m);
        }).ToList();

        return CountedRows<ClientExportRow>.Ready(rows);
    }
}
