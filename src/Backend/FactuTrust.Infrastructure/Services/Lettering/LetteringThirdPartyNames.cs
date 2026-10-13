using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Résolution des noms de tiers pour le lettrage, partagée par l'écran et, en Phase 3, par les
/// propositions. Extraction de l'ancienne méthode privée de <see cref="LetteringQueryService"/>,
/// généralisée sur des paires (identifiant, nature) ; mêmes requêtes, même résultat.
/// </summary>
internal static class LetteringThirdPartyNames
{
    /// <summary>
    /// Résout les noms des tiers référencés (clients, fournisseurs, salariés) en au plus trois
    /// requêtes. Les références sans identifiant sont ignorées.
    /// </summary>
    internal static async Task<Dictionary<(ThirdPartyKind, Guid), string>> ResolveAsync(
        TenantDbContext ctx, IEnumerable<(Guid? Id, ThirdPartyKind Kind)> refs, CancellationToken cancellationToken)
    {
        var result = new Dictionary<(ThirdPartyKind, Guid), string>();
        var rows = refs.Where(r => r.Id.HasValue).Select(r => (Id: r.Id!.Value, r.Kind)).ToList();

        var clientIds = rows.Where(r => r.Kind == ThirdPartyKind.Client).Select(r => r.Id).Distinct().ToList();
        var supplierIds = rows.Where(r => r.Kind == ThirdPartyKind.Supplier).Select(r => r.Id).Distinct().ToList();
        var employeeIds = rows.Where(r => r.Kind == ThirdPartyKind.Employee).Select(r => r.Id).Distinct().ToList();

        if (clientIds.Count > 0)
        {
            var clients = await ctx.Clients.AsNoTracking()
                .Where(c => clientIds.Contains(c.Id))
                .Select(c => new { c.Id, c.Name })
                .ToListAsync(cancellationToken);
            foreach (var c in clients)
                result[(ThirdPartyKind.Client, c.Id)] = c.Name;
        }
        if (supplierIds.Count > 0)
        {
            var suppliers = await ctx.Suppliers.AsNoTracking()
                .Where(s => supplierIds.Contains(s.Id))
                .Select(s => new { s.Id, s.Name })
                .ToListAsync(cancellationToken);
            foreach (var s in suppliers)
                result[(ThirdPartyKind.Supplier, s.Id)] = s.Name;
        }
        if (employeeIds.Count > 0)
        {
            var employees = await ctx.Employees.AsNoTracking()
                .Where(e => employeeIds.Contains(e.Id))
                .Select(e => new { e.Id, e.FirstName, e.LastName })
                .ToListAsync(cancellationToken);
            foreach (var e in employees)
                result[(ThirdPartyKind.Employee, e.Id)] = $"{e.FirstName} {e.LastName}".Trim();
        }

        return result;
    }
}
