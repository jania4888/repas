using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class SupplierRepository
{
    public async Task<CountedRows<SupplierExportRow>> ListForExportAsync(
        string? searchTerm,
        SupplierType? type,
        bool? isActive,
        int maxRows,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var filtered = ApplySupplierFilters(context.Suppliers.AsNoTracking(), searchTerm, type, isActive);
        var count = await filtered.CountAsync(cancellationToken);
        if (count > maxRows)
            return CountedRows<SupplierExportRow>.Over(count);

        var rows = await filtered
            .OrderBy(s => s.Name)
            .Select(s => new SupplierExportRow(
                s.Id,
                s.Name,
                s.Type,
                s.NIF == null ? null : s.NIF.Value,
                s.Email == null ? null : s.Email.Value,
                s.Phone == null ? null : s.Phone.Value,
                s.ContactPerson,
                s.Address.Street,
                s.Address.StreetLine2,
                s.Address.PostalCode,
                s.Address.City,
                s.Address.Governorate,
                s.Address.Country,
                s.PaymentTermDays,
                s.IsActive,
                s.IsResident,
                s.Activity,
                s.IsSubjectToWithholding,
                s.DefaultWithholdingRate,
                s.Notes))
            .ToListAsync(cancellationToken);

        return CountedRows<SupplierExportRow>.Ready(rows);
    }
}
