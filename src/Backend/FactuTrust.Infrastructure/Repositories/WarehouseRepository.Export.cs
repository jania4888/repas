using FactuTrust.Application.Features.DataExports;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class WarehouseRepository
{
    public async Task<CountedRows<WarehouseExportRow>> ListForExportAsync(
        int maxRows,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.Warehouses.AsNoTracking();
        var count = await query.CountAsync(cancellationToken);
        if (count > maxRows)
            return CountedRows<WarehouseExportRow>.Over(count);

        var rows = await query
            .OrderBy(w => w.Name)
            .Select(w => new WarehouseExportRow(w.Id, w.Code, w.Name, w.Address, w.IsDefault, w.IsActive))
            .ToListAsync(cancellationToken);

        return CountedRows<WarehouseExportRow>.Ready(rows);
    }
}
